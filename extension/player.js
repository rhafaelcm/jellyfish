// SPDX-License-Identifier: GPL-3.0-or-later

import Gio from 'gi://Gio';
import GioUnix from 'gi://GioUnix?version=2.0';
import GLib from 'gi://GLib';
import GLibUnix from 'gi://GLibUnix?version=2.0';
import Gst from 'gi://Gst?version=1.0';
import Gtk from 'gi://Gtk?version=4.0';
import System from 'system';

import {
    formatMonitorWindowTitle,
    parseMonitorSpec,
} from './monitors.js';
import {_} from './i18n.js';
import {PlaylistSequence} from './playlist.js';

const SETTINGS_SCHEMA = 'org.gnome.shell.extensions.jellyfish';
const VIDEO_AND_AUDIO_FLAGS = 3;
const HARDWARE_RANK = Gst.Rank.PRIMARY + 100;
const DISABLED_RANK = Gst.Rank.NONE;

function parseArguments(argv) {
    const options = {
        width: 1920,
        height: 1080,
        appId: 'io.github.jellyfish.Player',
        check: false,
        gpuVendor: 'unknown',
        renderNode: '',
        allowSoftware: false,
        monitors: [],
    };
    for (let index = 0; index < argv.length; index++) {
        const value = argv[index + 1];
        switch (argv[index]) {
        case '--check':
            options.check = true;
            break;
        case '--allow-software':
            options.allowSoftware = true;
            break;
        case '--width':
            options.width = Math.max(2, Number.parseInt(value, 10) || 1920);
            index++;
            break;
        case '--height':
            options.height = Math.max(2, Number.parseInt(value, 10) || 1080);
            index++;
            break;
        case '--app-id':
            options.appId = value || options.appId;
            index++;
            break;
        case '--gpu-vendor':
            options.gpuVendor = value || options.gpuVendor;
            index++;
            break;
        case '--render-node':
            options.renderNode = value || '';
            index++;
            break;
        case '--monitor':
            options.monitors.push(parseMonitorSpec(value));
            index++;
            break;
        default:
            throw new Error(`Unknown player argument: ${argv[index]}`);
        }
    }

    if (!options.check && options.monitors.length === 0) {
        options.monitors.push({
            index: 0,
            width: options.width,
            height: options.height,
        });
    }
    const indices = new Set();
    for (const monitor of options.monitors) {
        if (indices.has(monitor.index))
            throw new Error(`Duplicate monitor index: ${monitor.index}`);
        indices.add(monitor.index);
    }
    return options;
}

function loadSettings() {
    const moduleFile = Gio.File.new_for_uri(import.meta.url);
    const schemaDirectory = moduleFile.get_parent().get_child('schemas');
    const source = Gio.SettingsSchemaSource.new_from_directory(
        schemaDirectory.get_path(),
        Gio.SettingsSchemaSource.get_default(),
        false
    );
    const schema = source.lookup(SETTINGS_SCHEMA, false);
    if (!schema)
        throw new Error(`Settings schema ${SETTINGS_SCHEMA} was not found`);
    return new Gio.Settings({settings_schema: schema});
}

function readDevicePath(factory) {
    let element = null;
    try {
        element = factory.create(null);
        if (!element || !element.find_property('device-path'))
            return '';
        return element.get_property('device-path') || '';
    } catch (_error) {
        return '';
    } finally {
        if (element)
            element.set_state(Gst.State.NULL);
    }
}

function configureHardwareDecoders(options) {
    const decoderType = Gst.ELEMENT_FACTORY_TYPE_DECODER +
        Gst.ELEMENT_FACTORY_TYPE_MEDIA_VIDEO;
    const factories = Gst.ElementFactory.list_get_elements(
        decoderType, Gst.Rank.NONE);
    let wantedPlugin = null;
    if (options.gpuVendor === 'nvidia')
        wantedPlugin = 'nvcodec';
    else if (['intel', 'amd'].includes(options.gpuVendor))
        wantedPlugin = 'va';
    const renderName = options.renderNode
        ? GLib.path_get_basename(options.renderNode)
        : '';
    let selectedCount = 0;
    let hardwareCount = 0;

    for (const factory of factories) {
        const klass = factory.get_metadata('klass') || '';
        const pluginName = factory.get_plugin_name() || '';
        const hardware = klass.includes('Hardware') ||
            ['va', 'vaapi', 'nvcodec', 'amfcodec'].includes(pluginName);
        if (!hardware)
            continue;
        hardwareCount++;
        factory.set_rank(DISABLED_RANK);

        if (options.allowSoftware ||
            (wantedPlugin && pluginName !== wantedPlugin))
            continue;

        const devicePath = readDevicePath(factory);
        const factoryName = factory.get_name();
        const deviceMatches = !options.renderNode || !devicePath ||
            devicePath === options.renderNode ||
            (renderName && factoryName.includes(renderName));
        if (!deviceMatches)
            continue;

        factory.set_rank(HARDWARE_RANK);
        selectedCount++;
    }

    print(
        `STATUS HARDWARE_POLICY vendor=${options.gpuVendor} ` +
        `node=${options.renderNode || 'default'} selected=${selectedCount} ` +
        `available=${hardwareCount} software=${options.allowSoftware}`
    );
}

class VideoPlayer {
    constructor(application, settings, options) {
        this._application = application;
        this._settings = settings;
        this._options = options;
        this._reportedDecoder = false;
        this._reportedCaps = false;
        this._fallbackRequested = false;
        this._screenLocked = false;
        this._shellPaused = false;
        this._currentUri = '';
        this._mode = 'single';
        this._playlist = null;
        this._playlistFailures = new Set();
        this._signalIds = [];
        this._windows = [];
        this._pictures = [];

        this._paintableSink = Gst.ElementFactory.make(
            'gtk4paintablesink', 'jellyfish-video-sink');
        if (!this._paintableSink)
            throw new Error(_('The GStreamer gtk4paintablesink element is unavailable.'));

        this._videoSink = Gst.ElementFactory.make(
            'glsinkbin', 'jellyfish-gl-sink');
        if (this._videoSink) {
            this._videoSink.set_property('sink', this._paintableSink);
            print('STATUS VIDEO_SINK name=glsinkbin+gtk4paintablesink');
        } else {
            this._videoSink = this._paintableSink;
            print('WARNING GL_SINK_UNAVAILABLE using=gtk4paintablesink');
        }

        this._pipeline = Gst.ElementFactory.make('playbin3', 'jellyfish-player');
        if (!this._pipeline)
            throw new Error(_('The GStreamer playbin3 element is unavailable.'));

        const paintable = this._paintableSink.get_property('paintable');
        this._pipeline.set_property('video-sink', this._videoSink);
        this._pipeline.set_property('flags', VIDEO_AND_AUDIO_FLAGS);
        this._pipeline.connect(
            'deep-element-added', (_bin, _subBin, element) =>
                this._inspectDecoder(element));

        this._bus = this._pipeline.get_bus();
        this._bus.add_signal_watch();
        this._busId = this._bus.connect(
            'message', (_bus, message) => this._onBusMessage(message));

        for (const key of [
            'video-uri',
            'video-mode',
            'playlist-uris',
            'playlist-repeat-count',
        ]) {
            this._signalIds.push(settings.connect(
                `changed::${key}`, () => this._reloadConfiguredMedia()));
        }
        this._signalIds.push(settings.connect(
            'changed::volume', () => this._applyAudioSettings()));
        this._signalIds.push(settings.connect(
            'changed::muted', () => this._applyAudioSettings()));

        this._screenSignalId = Gio.DBus.session.signal_subscribe(
            'org.gnome.ScreenSaver',
            'org.gnome.ScreenSaver',
            'ActiveChanged',
            '/org/gnome/ScreenSaver',
            null,
            Gio.DBusSignalFlags.NONE,
            (_connection, _sender, _path, _interface, _signal, parameters) => {
                const [active] = parameters.deepUnpack();
                this._screenLocked = active;
                this._syncPlaybackState();
                print(`STATUS SCREEN_LOCK active=${active}`);
            }
        );

        this._commandCancellable = new Gio.Cancellable();
        this._commandInput = Gio.DataInputStream.new(
            new GioUnix.InputStream({fd: 0, close_fd: false}));
        this._readCommand();

        this._applyAudioSettings();
        for (const monitor of options.monitors)
            this._createWindow(monitor, paintable);
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
            this._reloadConfiguredMedia();
            print('EVENT READY');
            return GLib.SOURCE_REMOVE;
        });
    }

    destroy() {
        for (const id of this._signalIds)
            this._settings.disconnect(id);
        this._signalIds = [];

        if (this._pipeline)
            this._pipeline.set_state(Gst.State.NULL);
        if (this._bus && this._busId)
            this._bus.disconnect(this._busId);
        if (this._bus)
            this._bus.remove_signal_watch();
        if (this._screenSignalId)
            Gio.DBus.session.signal_unsubscribe(this._screenSignalId);
        if (this._commandCancellable)
            this._commandCancellable.cancel();
        if (this._commandInput)
            this._commandInput.close(null);
        for (const window of this._windows)
            window.destroy();
        this._windows = [];
        this._pictures = [];

        this._busId = 0;
        this._bus = null;
        this._pipeline = null;
        this._videoSink = null;
        this._paintableSink = null;
        this._commandInput = null;
        this._commandCancellable = null;
        this._settings = null;
        this._application = null;
    }

    _createWindow(monitor, paintable) {
        const picture = new Gtk.Picture({
            paintable,
            can_shrink: true,
            content_fit: Gtk.ContentFit.COVER,
            hexpand: true,
            vexpand: true,
        });
        const window = new Gtk.ApplicationWindow({
            application: this._application,
            title: formatMonitorWindowTitle(monitor.index),
            decorated: false,
            deletable: false,
            resizable: false,
            default_width: monitor.width,
            default_height: monitor.height,
        });
        window.set_size_request(monitor.width, monitor.height);
        window.set_child(picture);

        const reportGeometry = () => {
            print(
                `STATUS WINDOW monitor=${monitor.index} ` +
                `requested=${monitor.width}x${monitor.height} ` +
                `allocated=${picture.get_width()}x${picture.get_height()} ` +
                `scale=${window.get_scale_factor()}`
            );
        };
        window.connect('map', reportGeometry);
        window.connect('notify::scale-factor', reportGeometry);
        window.connect('close-request', () => {
            print(`STATUS CLOSE_REQUEST_BLOCKED monitor=${monitor.index}`);
            return true;
        });

        this._pictures.push(picture);
        this._windows.push(window);
        window.present();
    }

    _reloadConfiguredMedia() {
        this._pipeline.set_state(Gst.State.NULL);
        this._mode = this._settings.get_string('video-mode');
        this._playlist = null;
        this._playlistFailures.clear();
        let uri = '';
        if (this._mode === 'playlist') {
            const uris = this._settings.get_strv('playlist-uris')
                .filter(item => this._isUsableFile(item));
            this._playlist = new PlaylistSequence(
                uris, this._settings.get_int('playlist-repeat-count'));
            uri = this._playlist.current;
        } else {
            uri = this._settings.get_string('video-uri');
            if (!this._isUsableFile(uri))
                uri = '';
        }

        this._playUri(uri);
    }

    _playUri(uri) {
        this._pipeline.set_state(Gst.State.NULL);
        this._reportedDecoder = false;
        this._reportedCaps = false;
        this._fallbackRequested = false;
        this._currentUri = uri;
        this._videoAnnounced = false;
        if (!this._currentUri)
            return;

        this._pipeline.set_property('uri', this._currentUri);
        const target = this._screenLocked || this._shellPaused
            ? Gst.State.PAUSED
            : Gst.State.PLAYING;
        const result = this._pipeline.set_state(target);
        if (result === Gst.StateChangeReturn.FAILURE)
            printerr(`ERROR ${_('Could not start video playback.')}`);
    }

    _isUsableFile(uri) {
        if (!uri)
            return false;
        try {
            const file = Gio.File.new_for_uri(uri);
            return file.is_native() && file.query_exists(null);
        } catch (_error) {
            return false;
        }
    }

    _syncPlaybackState() {
        if (!this._pipeline || !this._currentUri)
            return;
        const paused = this._screenLocked || this._shellPaused;
        this._pipeline.set_state(paused ? Gst.State.PAUSED : Gst.State.PLAYING);
        print(`STATUS PLAYBACK paused=${paused}`);
    }

    _readCommand() {
        this._commandInput.read_line_async(
            GLib.PRIORITY_DEFAULT,
            this._commandCancellable,
            (stream, result) => {
                try {
                    const [line, length] = stream.read_line_finish_utf8(result);
                    if (!line && length === 0)
                        return;
                    const command = JSON.parse(line);
                    if (command.type === 'set-paused' &&
                        typeof command.paused === 'boolean') {
                        this._shellPaused = command.paused;
                        this._syncPlaybackState();
                    }
                    this._readCommand();
                } catch (error) {
                    if (!error.matches?.(
                        Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                        printerr(`WARNING PLAYER_COMMAND ${error.message}`);
                        this._readCommand();
                    }
                }
            }
        );
    }

    _repeatCurrent() {
        if (!this._pipeline.seek_simple(
            Gst.Format.TIME,
            Gst.SeekFlags.FLUSH | Gst.SeekFlags.KEY_UNIT,
            0
        )) {
            this._playUri(this._currentUri);
        }
    }

    _advancePlaylist(failed = false) {
        if (!this._playlist || this._playlist.length === 0)
            return false;
        if (failed)
            this._playlistFailures.add(this._playlist.index);
        if (this._playlistFailures.size >= this._playlist.length)
            return false;

        const next = failed
            ? this._playlist.skipCurrent()
            : this._playlist.completeCurrent();
        if (!next.changed) {
            this._repeatCurrent();
            return true;
        }

        for (let checked = 0; checked < this._playlist.length; checked++) {
            if (!this._playlistFailures.has(this._playlist.index) &&
                this._isUsableFile(this._playlist.current)) {
                this._playUri(this._playlist.current);
                return true;
            }
            this._playlistFailures.add(this._playlist.index);
            this._playlist.skipCurrent();
        }
        return false;
    }

    _applyAudioSettings() {
        this._pipeline.set_property(
            'volume', this._settings.get_int('volume') / 100);
        this._pipeline.set_property(
            'mute', this._settings.get_boolean('muted'));
    }

    _inspectDecoder(element) {
        if (this._reportedDecoder || !element || !element.get_factory)
            return;
        const factory = element.get_factory();
        if (!factory)
            return;
        const klass = factory.get_metadata('klass') || '';
        const name = factory.get_name();
        if (!klass.includes('Decoder') || !klass.includes('Video') ||
            name.includes('decodebin'))
            return;

        this._reportedDecoder = true;
        const hardware = klass.includes('Hardware');
        let devicePath = '';
        try {
            if (element.find_property('device-path'))
                devicePath = element.get_property('device-path') || '';
        } catch (_error) {
            devicePath = '';
        }
        print(
            `STATUS DECODER name=${name} hardware=${hardware} ` +
            `device=${devicePath || 'unknown'}`
        );
        if (!hardware && !this._options.allowSoftware &&
            !this._fallbackRequested) {
            this._fallbackRequested = true;
            print(`REQUEST GPU_FALLBACK decoder=${name}`);
        } else if (!hardware) {
            print(`WARNING SOFTWARE_DECODER name=${name}`);
        }
    }

    _inspectPipeline() {
        const iterator = this._pipeline.iterate_recurse();
        while (true) {
            const [result, element] = iterator.next();
            if (result === Gst.IteratorResult.OK) {
                this._inspectDecoder(element);
            } else if (result === Gst.IteratorResult.RESYNC) {
                iterator.resync();
            } else {
                break;
            }
        }

        if (this._reportedCaps)
            return;
        const pad = this._paintableSink.get_static_pad('sink');
        const caps = pad ? pad.get_current_caps() : null;
        if (caps) {
            this._reportedCaps = true;
            print(`STATUS VIDEO_CAPS ${caps.to_string()}`);
        }
    }

    _onBusMessage(message) {
        switch (message.type) {
        case Gst.MessageType.EOS:
            if (this._mode === 'playlist') {
                if (!this._advancePlaylist())
                    this._pipeline.set_state(Gst.State.NULL);
            } else {
                this._repeatCurrent();
            }
            break;
        case Gst.MessageType.ERROR: {
            const [error, debug] = message.parse_error();
            this._pipeline.set_state(Gst.State.NULL);
            if (this._mode === 'playlist' && this._advancePlaylist(true)) {
                printerr(`WARNING PLAYLIST_ITEM_SKIPPED ${error.message}`);
                if (debug)
                    printerr(`DEBUG ${debug}`);
                break;
            }
            printerr(`ERROR ${error.message}`);
            if (debug)
                printerr(`DEBUG ${debug}`);
            break;
        }
        case Gst.MessageType.ASYNC_DONE:
            if (this._currentUri && !this._videoAnnounced && !this._fallbackRequested) {
                print(`EVENT VIDEO ${JSON.stringify({uri: this._currentUri})}`);
                this._videoAnnounced = true;
            }
            this._inspectPipeline();
            break;
        case Gst.MessageType.STATE_CHANGED:
            if (message.src === this._pipeline) {
                const [_oldState, newState] = message.parse_state_changed();
                if (newState >= Gst.State.PAUSED)
                    this._inspectPipeline();
            }
            break;
        default:
            break;
        }
    }
}

let player = null;
let application = null;

try {
    const options = parseArguments(ARGV);
    Gst.init(null);
    configureHardwareDecoders(options);
    if (options.check) {
        for (const name of ['playbin3', 'gtk4paintablesink', 'glsinkbin']) {
            if (!Gst.ElementFactory.find(name))
                throw new Error(_('The GStreamer element %s is unavailable.').replace('%s', name));
        }
        print('player dependency check: ok');
        System.exit(0);
    }
    const settings = loadSettings();
    application = new Gtk.Application({
        application_id: options.appId,
        flags: Gio.ApplicationFlags.NON_UNIQUE,
    });
    application.connect('activate', app => {
        try {
            player = new VideoPlayer(app, settings, options);
        } catch (error) {
            printerr(`ERROR ${error.message}`);
            app.quit();
        }
    });
    application.connect('shutdown', () => {
        if (player)
            player.destroy();
        player = null;
    });
    GLibUnix.signal_add(GLib.PRIORITY_DEFAULT, 15, () => {
        application.quit();
        return GLib.SOURCE_REMOVE;
    });
    application.run([]);
} catch (error) {
    printerr(`ERROR ${error.message}`);
    if (application)
        application.quit();
    System.exit(1);
}

