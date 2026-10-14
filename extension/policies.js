// SPDX-License-Identifier: GPL-3.0-or-later

import Gio from 'gi://Gio';
import Meta from 'gi://Meta';

import {isIdentifiableVideo} from './media.js';

const MPRIS_PREFIX = 'org.mpris.MediaPlayer2.';
const MPRIS_PATH = '/org/mpris/MediaPlayer2';
const MPRIS_PLAYER = 'org.mpris.MediaPlayer2.Player';
const UPOWER_NAME = 'org.freedesktop.UPower';
const UPOWER_PATH = '/org/freedesktop/UPower/devices/DisplayDevice';
const UPOWER_DEVICE = 'org.freedesktop.UPower.Device';
const UPOWER_DISCHARGING = 2;

function disconnect(object, id) {
    if (!object || !id)
        return;
    try {
        object.disconnect(id);
    } catch (_error) {
        // D-Bus proxies and windows may disappear before extension shutdown.
    }
}

export class BatteryWatcher {
    constructor(onChanged, onError) {
        this._onChanged = onChanged;
        this._onError = onError;
        this._cancellable = new Gio.Cancellable();
        this._proxy = null;
        this._signalId = 0;
        this._load();
    }

    destroy() {
        this._cancellable.cancel();
        disconnect(this._proxy, this._signalId);
        this._proxy = null;
        this._onChanged = () => {};
        this._onError = () => {};
    }

    _load() {
        Gio.DBusProxy.new_for_bus(
            Gio.BusType.SYSTEM,
            Gio.DBusProxyFlags.DO_NOT_AUTO_START,
            null,
            UPOWER_NAME,
            UPOWER_PATH,
            UPOWER_DEVICE,
            this._cancellable,
            (_source, result) => {
                try {
                    this._proxy = Gio.DBusProxy.new_for_bus_finish(result);
                    this._signalId = this._proxy.connect(
                        'g-properties-changed', () => this._update());
                    this._update();
                } catch (error) {
                    if (!error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        this._onError(error);
                }
            }
        );
    }

    _update() {
        const percentage = this._proxy
            .get_cached_property('Percentage')?.unpack();
        const state = this._proxy.get_cached_property('State')?.unpack();
        this._onChanged({
            available: Number.isFinite(percentage),
            percentage: Number.isFinite(percentage) ? percentage : 100,
            discharging: state === UPOWER_DISCHARGING,
        });
    }
}

export class MediaWatcher {
    constructor(onChanged, onError) {
        this._onChanged = onChanged;
        this._onError = onError;
        this._cancellable = new Gio.Cancellable();
        this._players = new Map();
        this._nameOwnerId = Gio.DBus.session.signal_subscribe(
            'org.freedesktop.DBus',
            'org.freedesktop.DBus',
            'NameOwnerChanged',
            '/org/freedesktop/DBus',
            null,
            Gio.DBusSignalFlags.NONE,
            (_connection, _sender, _path, _interface, _signal, parameters) => {
                const [name, oldOwner, newOwner] = parameters.deepUnpack();
                if (!name.startsWith(MPRIS_PREFIX))
                    return;
                if (newOwner)
                    this._addPlayer(name);
                else if (oldOwner)
                    this._removePlayer(name);
            }
        );
        this._loadPlayers();
    }

    destroy() {
        this._cancellable.cancel();
        if (this._nameOwnerId)
            Gio.DBus.session.signal_unsubscribe(this._nameOwnerId);
        this._nameOwnerId = 0;
        for (const {proxy, signalId} of this._players.values())
            disconnect(proxy, signalId);
        this._players.clear();
        this._onChanged = () => {};
        this._onError = () => {};
    }

    _loadPlayers() {
        Gio.DBus.session.call(
            'org.freedesktop.DBus',
            '/org/freedesktop/DBus',
            'org.freedesktop.DBus',
            'ListNames',
            null,
            null,
            Gio.DBusCallFlags.NONE,
            -1,
            this._cancellable,
            (connection, result) => {
                try {
                    const [names] = connection.call_finish(result).deepUnpack();
                    for (const name of names) {
                        if (name.startsWith(MPRIS_PREFIX))
                            this._addPlayer(name);
                    }
                } catch (error) {
                    if (!error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        this._onError(error);
                }
            }
        );
    }

    _addPlayer(name) {
        if (this._players.has(name))
            return;
        this._players.set(name, {proxy: null, signalId: 0});
        Gio.DBusProxy.new_for_bus(
            Gio.BusType.SESSION,
            Gio.DBusProxyFlags.DO_NOT_AUTO_START,
            null,
            name,
            MPRIS_PATH,
            MPRIS_PLAYER,
            this._cancellable,
            (_source, result) => {
                try {
                    const proxy = Gio.DBusProxy.new_for_bus_finish(result);
                    if (!this._players.has(name))
                        return;
                    const signalId = proxy.connect(
                        'g-properties-changed', () => this._emit());
                    this._players.set(name, {proxy, signalId});
                    this._emit();
                } catch (error) {
                    this._players.delete(name);
                    if (!error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        this._onError(error);
                }
            }
        );
    }

    _removePlayer(name) {
        const player = this._players.get(name);
        if (!player)
            return;
        disconnect(player.proxy, player.signalId);
        this._players.delete(name);
        this._emit();
    }

    _emit() {
        const playingVideos = new Set();
        for (const [name, {proxy}] of this._players) {
            if (!proxy)
                continue;
            const status = proxy.get_cached_property('PlaybackStatus')?.unpack();
            const metadata = proxy.get_cached_property('Metadata')?.deepUnpack();
            if (status === 'Playing' && isIdentifiableVideo(metadata)) {
                let trackId = metadata?.['mpris:trackid'] || '';
                if (trackId && typeof trackId.deepUnpack === 'function')
                    trackId = trackId.deepUnpack();
                playingVideos.add(`${name}:${trackId}`);
            }
        }
        this._onChanged(playingVideos);
    }
}

export class WindowWatcher {
    constructor(ownsWindow, onChanged) {
        this._ownsWindow = ownsWindow;
        this._onChanged = onChanged;
        this._windows = new Map();
        this._displaySignals = [
            global.display.connect('window-created', (_display, window) => {
                this._watchWindow(window);
                this._emit();
            }),
            global.display.connect('window-entered-monitor', () => this._emit()),
            global.display.connect('window-left-monitor', () => this._emit()),
        ];
        this._workspaceSignal = global.workspace_manager.connect(
            'active-workspace-changed', () => this._emit());

        for (const actor of global.get_window_actors())
            this._watchWindow(actor.get_meta_window());
        this._emit();
    }

    destroy() {
        for (const id of this._displaySignals)
            global.display.disconnect(id);
        if (this._workspaceSignal)
            global.workspace_manager.disconnect(this._workspaceSignal);
        for (const [window, ids] of this._windows) {
            for (const id of ids)
                disconnect(window, id);
        }
        this._windows.clear();
        this._onChanged = () => {};
    }

    refresh() {
        this._emit();
    }

    _watchWindow(window) {
        if (!window || this._windows.has(window))
            return;
        const ids = [];
        const connect = signal => {
            try {
                ids.push(window.connect(signal, () => this._emit()));
            } catch (_error) {
                // Properties vary slightly between Mutter versions.
            }
        };
        for (const signal of [
            'notify::fullscreen',
            'notify::maximized-horizontally',
            'notify::maximized-vertically',
            'notify::minimized',
            'position-changed',
            'workspace-changed',
        ])
            connect(signal);
        ids.push(window.connect('unmanaged', () => {
            this._windows.delete(window);
            this._emit();
        }));
        this._windows.set(window, ids);
    }

    _emit() {
        const activeWorkspace = global.workspace_manager.get_active_workspace();
        const covered = new Map();
        for (const window of this._windows.keys()) {
            if (this._ownsWindow(window) || window.minimized)
                continue;
            if (window.get_window_type() !== Meta.WindowType.NORMAL)
                continue;
            if (window.get_workspace() !== activeWorkspace &&
                !window.is_on_all_workspaces())
                continue;
            if (!window.showing_on_its_workspace())
                continue;

            const fullscreen = window.is_fullscreen
                ? window.is_fullscreen()
                : window.fullscreen;
            const maximized = window.maximized_horizontally &&
                window.maximized_vertically;
            if (!fullscreen && !maximized)
                continue;

            const monitor = window.get_monitor();
            if (monitor < 0)
                continue;
            covered.set(`window:${window.get_stable_sequence()}`, monitor);
        }
        this._onChanged(covered);
    }
}
