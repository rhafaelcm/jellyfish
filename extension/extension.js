// SPDX-License-Identifier: GPL-3.0-or-later

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {VideoBackground} from './background.js';
import {parseVideoEvent} from './background-state.js';
import {detectGpuDevices, getGpuEnvironment, orderGpuCandidates} from './gpu.js';
import {JellyfishIndicator} from './indicator.js';
import {
    classifyMonitorWindowTitle,
    formatMonitorSpec,
    MonitorWindowTitleStatus,
} from './monitors.js';
import {GLOBAL_SCOPE, PauseState} from './pause-state.js';
import {PlayerProcess} from './player-process.js';
import {BatteryWatcher, MediaWatcher, WindowWatcher} from './policies.js';
import {WallpaperSurface} from './wallpaper.js';

const PLAYER_APP_ID = 'io.github.jellyfish.Player';
const WINDOW_IDENTIFY_RETRY_MS = 50;
const WINDOW_IDENTIFY_RETRY_LIMIT = 100;
const WINDOW_ATTACH_RETRY_MS = 50;
const WINDOW_ATTACH_RETRY_LIMIT = 100;
const WINDOW_HIDE_VERIFY_MS = 50;
const WINDOW_HIDE_VERIFY_LIMIT = 20;
const WINDOW_SET_TIMEOUT_MS = 7000;

function isWaylandCompositor() {
    return Meta.is_wayland_compositor === undefined || Meta.is_wayland_compositor();
}

export default class JellyfishExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._videoBackground = new VideoBackground(this._settings);
        this._surface = new WallpaperSurface();
        this._process = null;
        this._indicator = null;
        this._pauseState = new PauseState();
        this._battery = {available: false, percentage: 100, discharging: false};
        this._playingVideos = new Set();
        this._coveredWindows = new Map();
        this._windowIdentifications = new Map();
        this._actorRetries = new Map();
        this._managedWindows = new Map();
        this._settingsSignalIds = [];
        this._windowSetTimeoutId = 0;
        this._startDelayId = 0;
        this._expectedMonitorCount = 0;
        this._notifiedSoftwareFallback = false;
        this._notifiedMissingSource = false;
        this._playerStopping = false;
        this._restartAfterStop = false;
        this._gpuCandidates = [];
        this._gpuCandidateIndex = 0;
        this._allowSoftwareDecoder = false;
        this._notifiedGpuUnavailable = false;

        this._windowCreatedId = global.display.connect(
            'window-created', (_display, window) => this._onWindowCreated(window));
        this._monitorsChangedId = Main.layoutManager.connect(
            'monitors-changed', () => this._restartPlayer());
        this._connectSetting('video-uri', () => this._onSourceChanged());
        this._connectSetting('video-mode', () => this._onSourceChanged());
        this._connectSetting('playlist-uris', () => this._onSourceChanged());
        this._connectSetting('gpu-mode', () => this._resetPlayerSelection());
        this._connectSetting('show-panel-icon', () => this._syncIndicator());
        this._connectSetting('startup-delay-ms', () => this._rescheduleStart());
        for (const key of [
            'pause-on-maximized', 'pause-on-low-battery',
            'low-battery-threshold', 'pause-on-media-playback',
        ])
            this._connectSetting(key, () => this._rebuildPauseReasons());

        this._syncIndicator();
        if (!isWaylandCompositor()) {
            Main.notifyError('Jellyfish',
                _('This version only works in a Wayland session.'));
            return;
        }

        this._batteryWatcher = new BatteryWatcher(state => {
            this._battery = state;
            this._rebuildPauseReasons();
        }, error => this._debugError(error, 'UPower is unavailable'));
        this._mediaWatcher = new MediaWatcher(players => {
            this._playingVideos = players;
            this._rebuildPauseReasons();
        }, error => this._debugError(error, 'Unable to inspect MPRIS player'));
        this._windowWatcher = new WindowWatcher(
            window => Boolean(this._process?.ownsWindow(window)),
            windows => {
                this._coveredWindows = windows;
                this._rebuildPauseReasons();
            });

        this._refreshGpuCandidates();
        this._rebuildPauseReasons();
        this._syncPlayer();
    }

    disable() {
        this._cancelStartDelay();
        if (this._windowCreatedId)
            global.display.disconnect(this._windowCreatedId);
        if (this._monitorsChangedId)
            Main.layoutManager.disconnect(this._monitorsChangedId);
        this._windowCreatedId = 0;
        this._monitorsChangedId = 0;
        for (const id of this._settingsSignalIds)
            this._settings.disconnect(id);
        this._settingsSignalIds = [];
        this._windowWatcher?.destroy();
        this._mediaWatcher?.destroy();
        this._batteryWatcher?.destroy();
        this._windowWatcher = null;
        this._mediaWatcher = null;
        this._batteryWatcher = null;
        this._destroyIndicator();
        this._cancelWindowIdentifications();
        this._cancelActorRetries();
        this._cancelWindowSetTimeout();
        this._releaseManagedWindows();
        this._surface?.detach();
        this._process?.destroy();
        this._process = null;
        this._surface = null;
        this._pauseState = null;
        this._videoBackground?.destroy();
        this._videoBackground = null;
        this._settings = null;
    }

    _connectSetting(key, callback) {
        this._settingsSignalIds.push(
            this._settings.connect(`changed::${key}`, callback));
    }

    _syncIndicator() {
        if (this._settings.get_boolean('show-panel-icon')) {
            if (this._indicator)
                return;
            const iconPath = GLib.build_filenamev([
                this.path, 'data', 'icons', 'hicolor', 'scalable', 'apps',
                'jellyfish-symbolic.svg',
            ]);
            this._indicator = new JellyfishIndicator(
                iconPath, this._settings,
                () => this._togglePause(), () => this.openPreferences());
            Main.panel.addToStatusArea(this.uuid, this._indicator);
            this._indicator.setPaused(this._pauseState.paused);
        } else {
            this._destroyIndicator();
        }
    }

    _destroyIndicator() {
        this._indicator?.destroy();
        this._indicator = null;
    }

    _togglePause() {
        if (this._pauseState.paused)
            this._pauseState.forceContinue();
        else
            this._pauseState.pauseManually();
        this._applyPauseState();
    }

    _rebuildPauseReasons() {
        if (!this._settings || !this._pauseState)
            return;
        const reasons = new Map();
        if (this._settings.get_boolean('pause-on-low-battery') &&
            this._battery.available && this._battery.discharging &&
            this._battery.percentage <=
                this._settings.get_int('low-battery-threshold'))
            reasons.set('battery', GLOBAL_SCOPE);
        if (this._settings.get_boolean('pause-on-media-playback')) {
            for (const name of this._playingVideos)
                reasons.set(`media:${name}`, GLOBAL_SCOPE);
        }
        if (this._settings.get_boolean('pause-on-maximized')) {
            for (const [name, monitor] of this._coveredWindows)
                reasons.set(name, monitor);
        }
        this._pauseState.setAutomatic(reasons);
        this._applyPauseState();
    }

    _applyPauseState() {
        if (!this._pauseState)
            return;
        try {
            this._surface?.setFrozenMonitors(this._pauseState.getPausedMonitors());
        } catch (error) {
            console.error(error, 'Failed to freeze a Jellyfish monitor');
        }
        this._process?.setPaused(this._pauseState.shouldPausePipeline(
            Main.layoutManager.monitors.length));
        this._indicator?.setPaused(this._pauseState.paused);
    }

    _configuredUris() {
        if (this._settings.get_string('video-mode') === 'playlist')
            return this._settings.get_strv('playlist-uris');
        const uri = this._settings.get_string('video-uri');
        return uri ? [uri] : [];
    }

    _playableUris() {
        return this._configuredUris().filter(uri => {
            try {
                const file = Gio.File.new_for_uri(uri);
                return file.is_native() && file.query_exists(null);
            } catch (_error) {
                return false;
            }
        });
    }

    _syncPlayer() {
        if (!isWaylandCompositor())
            return;
        const configured = this._configuredUris();
        if (this._playableUris().length === 0)
            this._videoBackground.update('');
        if (this._playableUris().length === 0) {
            this._cancelStartDelay();
            this._stopPlayer();
            if (configured.length > 0 && !this._notifiedMissingSource) {
                this._notifiedMissingSource = true;
                Main.notifyError('Jellyfish',
                    _('None of the configured video files could be found.'));
            }
            return;
        }
        if (this._process) {
            if (this._playerStopping)
                this._restartAfterStop = true;
            return;
        }
        this._schedulePlayerStart();
    }

    _schedulePlayerStart() {
        if (this._startDelayId || this._process || !this._settings)
            return;
        const delay = this._settings.get_uint('startup-delay-ms');
        if (delay === 0) {
            this._startPlayer();
            return;
        }
        this._debug(`Player start scheduled in ${delay} ms`);
        this._startDelayId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT, delay, () => {
                this._startDelayId = 0;
                if (this._settings && this._playableUris().length > 0)
                    this._startPlayer();
                return GLib.SOURCE_REMOVE;
            });
    }

    _cancelStartDelay() {
        if (!this._startDelayId)
            return;
        GLib.Source.remove(this._startDelayId);
        this._startDelayId = 0;
    }

    _rescheduleStart() {
        if (!this._startDelayId)
            return;
        this._cancelStartDelay();
        this._syncPlayer();
    }

    _startPlayer() {
        const monitors = Main.layoutManager.monitors;
        if (monitors.length === 0 || this._playableUris().length === 0)
            return;
        this._notifiedSoftwareFallback = false;
        this._playerStopping = false;
        this._restartAfterStop = false;
        this._process = new PlayerProcess(
            line => this._onPlayerLine(line),
            (expected, error) => this._onPlayerExit(expected, error));
        const gjs = GLib.find_program_in_path('gjs');
        if (!gjs) {
            this._process = null;
            Main.notifyError('Jellyfish', _('The gjs executable could not be found.'));
            return;
        }

        const gpu = this._gpuCandidates[this._gpuCandidateIndex] || {
            id: 'default', vendor: 'unknown', renderNode: '', pciSlot: '',
            default: true, integrated: true,
        };
        this._debug(
            `GPU selected vendor=${gpu.vendor} node=${gpu.renderNode || 'default'} ` +
            `candidate=${this._gpuCandidateIndex + 1}/${this._gpuCandidates.length || 1}`);
        monitors.forEach((monitor, index) => {
            const scale = global.display.get_monitor_scale(index);
            this._debug(`Monitor ${index} geometry=${monitor.x},${monitor.y} ` +
                `${monitor.width}x${monitor.height} scale=${scale}`);
        });

        try {
            this._process.start([
                gjs, '-m', GLib.build_filenamev([this.path, 'player.js']),
                '--app-id', PLAYER_APP_ID,
                '--gpu-vendor', gpu.vendor,
                '--render-node', gpu.renderNode,
                ...monitors.flatMap((monitor, index) => [
                    '--monitor', formatMonitorSpec(index,
                        Math.max(2, Math.round(monitor.width)),
                        Math.max(2, Math.round(monitor.height))),
                ]),
                ...(this._allowSoftwareDecoder ? ['--allow-software'] : []),
            ], this.path, getGpuEnvironment(gpu));
            this._expectedMonitorCount = monitors.length;
            this._applyPauseState();
            this._windowSetTimeoutId = GLib.timeout_add(
                GLib.PRIORITY_DEFAULT, WINDOW_SET_TIMEOUT_MS, () => {
                    this._windowSetTimeoutId = 0;
                    if (this._surface &&
                        this._surface.size < this._expectedMonitorCount) {
                        Main.notifyError('Jellyfish',
                            _('Not all monitor windows became available.'));
                        this._stopPlayer();
                    }
                    return GLib.SOURCE_REMOVE;
                });
        } catch (error) {
            console.error(error, 'Failed to launch the Jellyfish player');
            this._process = null;
            Main.notifyError('Jellyfish',
                _('Could not start the video player.'));
        }
    }

    _stopPlayer(restart = false) {
        if (!restart)
            this._videoBackground?.update('');
        this._cancelStartDelay();
        this._cancelWindowIdentifications();
        this._cancelActorRetries();
        this._cancelWindowSetTimeout();
        this._releaseManagedWindows();
        this._surface?.detach();
        if (this._process) {
            this._playerStopping = true;
            this._restartAfterStop = restart;
            this._process.stop();
        } else if (restart) {
            this._schedulePlayerStart();
        }
    }

    _restartPlayer() {
        if (this._playableUris().length === 0)
            this._stopPlayer();
        else
            this._stopPlayer(true);
    }

    _onSourceChanged() {
        this._notifiedMissingSource = false;
        this._syncPlayer();
    }

    _refreshGpuCandidates() {
        const mode = this._settings.get_string('gpu-mode');
        this._gpuCandidates = orderGpuCandidates(detectGpuDevices(), mode);
        this._gpuCandidateIndex = 0;
        this._allowSoftwareDecoder = false;
        if (mode !== 'auto' && this._gpuCandidates.length > 0 &&
            this._gpuCandidates[0].vendor !== mode &&
            !this._notifiedGpuUnavailable) {
            this._notifiedGpuUnavailable = true;
            Main.notify('Jellyfish',
                _('No %s GPU was found; using automatic selection.').format(mode.toUpperCase()));
        }
    }

    _resetPlayerSelection() {
        this._notifiedGpuUnavailable = false;
        this._refreshGpuCandidates();
        this._restartPlayer();
    }

    _tryNextGpu() {
        if (this._playerStopping)
            return;
        if (this._gpuCandidateIndex + 1 < this._gpuCandidates.length) {
            this._gpuCandidateIndex++;
            const gpu = this._gpuCandidates[this._gpuCandidateIndex];
            Main.notify('Jellyfish',
                _('Acceleration is unavailable; trying the %s GPU.').format(gpu.vendor.toUpperCase()));
            this._stopPlayer(true);
        } else if (!this._allowSoftwareDecoder) {
            this._allowSoftwareDecoder = true;
            this._gpuCandidateIndex = 0;
            this._stopPlayer(true);
        }
    }

    _onWindowCreated(window) {
        if (this._playerStopping || !this._process ||
            !this._process.ownsWindow(window) ||
            this._windowIdentifications.has(window))
            return;

        this._process.hideFromWindowList(window);
        window.lower();
        const identification = {
            window,
            retryId: 0,
            retryCount: 0,
            titleId: 0,
            unmanagedId: 0,
            raisedId: 0,
            lastTitle: '',
        };
        identification.titleId = window.connect('notify::title', () => {
            if (identification.retryId) {
                GLib.Source.remove(identification.retryId);
                identification.retryId = 0;
            }
            this._tryIdentifyWindow(window);
        });
        identification.unmanagedId = window.connect('unmanaged', () =>
            this._cancelWindowIdentification(window, false));
        identification.raisedId = window.connect_after('raised', () =>
            window.lower());
        this._windowIdentifications.set(window, identification);
        this._tryIdentifyWindow(window);
    }

    _tryIdentifyWindow(window) {
        const identification = this._windowIdentifications.get(window);
        if (!identification || this._playerStopping || !this._process ||
            !this._process.ownsWindow(window))
            return;

        const title = window.get_title ? window.get_title() : window.title;
        identification.lastTitle = title || '';
        const classification = classifyMonitorWindowTitle(
            title, Main.layoutManager.monitors.length);
        if (classification.status === MonitorWindowTitleStatus.VALID) {
            const retryCount = identification.retryCount;
            this._cancelWindowIdentification(window);
            this._debug(
                `Identified player window title=${JSON.stringify(title)} ` +
                `monitor=${classification.monitorIndex} retries=${retryCount}`);
            this._acceptMonitorWindow(window, classification.monitorIndex);
            return;
        }
        if (classification.status === MonitorWindowTitleStatus.OUT_OF_RANGE) {
            this._cancelWindowIdentification(window);
            Main.notifyError(
                'Jellyfish',
                _('The player reported monitor %d, but only %d monitors exist.').format(
                    classification.monitorIndex, Main.layoutManager.monitors.length)
            );
            this._stopPlayer();
            return;
        }
        if (identification.retryCount >= WINDOW_IDENTIFY_RETRY_LIMIT) {
            const lastTitle = identification.lastTitle || '(empty)';
            this._cancelWindowIdentification(window);
            console.error(
                `[Jellyfish] Timed out identifying player window ` +
                `title=${JSON.stringify(lastTitle)} ` +
                `monitors=${Main.layoutManager.monitors.length}`);
            Main.notifyError(
                'Jellyfish',
                _('Could not identify a player window (title: %s; monitors: %d).').format(
                    lastTitle, Main.layoutManager.monitors.length)
            );
            this._stopPlayer();
            return;
        }

        if (identification.retryCount === 0 ||
            identification.retryCount % 20 === 0) {
            this._debug(
                `Waiting for player window title current=${JSON.stringify(title || '')} ` +
                `attempt=${identification.retryCount + 1}`);
        }
        identification.retryCount++;
        identification.retryId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT, WINDOW_IDENTIFY_RETRY_MS, () => {
                identification.retryId = 0;
                this._tryIdentifyWindow(window);
                return GLib.SOURCE_REMOVE;
            });
    }

    _acceptMonitorWindow(window, monitorIndex) {
        if (this._surface.hasMonitor(monitorIndex) ||
            this._actorRetries.has(monitorIndex)) {
            Main.notifyError('Jellyfish',
                _('The player duplicated the window for monitor %d.').format(monitorIndex));
            this._stopPlayer();
            return;
        }
        const raisedId = window.connect_after('raised', () => window.lower());
        this._actorRetries.set(monitorIndex, {
            window,
            retryId: 0,
            retryCount: 0,
            raisedId,
        });
        window.lower();
        this._moveWindowToMonitor(window, monitorIndex);
        this._tryAttachWindow(monitorIndex);
    }

    _cancelWindowIdentification(window, disconnectWindow = true) {
        const identification = this._windowIdentifications.get(window);
        if (!identification)
            return;
        this._windowIdentifications.delete(window);
        if (identification.retryId)
            GLib.Source.remove(identification.retryId);
        if (!disconnectWindow)
            return;
        for (const signalId of [
            identification.titleId,
            identification.unmanagedId,
            identification.raisedId,
        ]) {
            if (!signalId)
                continue;
            try {
                window.disconnect(signalId);
            } catch (_error) {
                // The Meta.Window may already have been unmanaged.
            }
        }
    }

    _cancelWindowIdentifications() {
        for (const window of [...this._windowIdentifications.keys()])
            this._cancelWindowIdentification(window);
    }

    _tryAttachWindow(monitorIndex) {
        const retry = this._actorRetries.get(monitorIndex);
        if (!retry || this._playerStopping || !this._process ||
            !this._process.ownsWindow(retry.window))
            return;
        const monitor = Main.layoutManager.monitors[monitorIndex];
        if (!monitor) {
            this._failWindowAttach(
                _('The monitor configuration changed during startup.'));
            return;
        }
        const actor = retry.window.get_compositor_private();
        const actorWidth = actor ? Math.round(actor.get_width()) : 0;
        const actorHeight = actor ? Math.round(actor.get_height()) : 0;
        if (actor && actorWidth >= 2 && actorHeight >= 2 &&
            retry.window.get_monitor() === monitorIndex) {
            this._cancelActorRetry(monitorIndex);
            try {
                this._surface.attach(monitorIndex, actor);
                this._manageWindow(monitorIndex, retry.window);
                this._applyPauseState();
                this._debug(`Attached monitor ${monitorIndex} ` +
                    `actor=${Math.round(actor.get_width())}x${Math.round(actor.get_height())} ` +
                    `resource-scale=${actor.get_resource_scale()}`);
                if (this._surface.size === this._expectedMonitorCount)
                    this._cancelWindowSetTimeout();
            } catch (error) {
                console.error(error, 'Failed to attach the video wallpaper');
                this._failWindowAttach(
                    _('Could not attach the video to the GNOME background.'));
            }
            return;
        }
        if (retry.retryCount >= WINDOW_ATTACH_RETRY_LIMIT) {
            this._failWindowAttach(
                _('The window for monitor %d did not become available in time.').format(monitorIndex));
            return;
        }
        if (retry.retryCount === 0 || retry.retryCount % 20 === 0) {
            this._debug(
                `Waiting for player actor monitor=${monitorIndex} ` +
                `actor=${actorWidth}x${actorHeight} ` +
                `window-monitor=${retry.window.get_monitor()}`);
        }
        retry.retryCount++;
        if (retry.retryCount % 10 === 0)
            this._moveWindowToMonitor(retry.window, monitorIndex);
        retry.retryId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT, WINDOW_ATTACH_RETRY_MS, () => {
                retry.retryId = 0;
                this._tryAttachWindow(monitorIndex);
                return GLib.SOURCE_REMOVE;
            });
    }

    _moveWindowToMonitor(window, monitorIndex) {
        const monitor = Main.layoutManager.monitors[monitorIndex];
        if (!monitor)
            return;
        const frame = window.get_frame_rect();
        if (frame.x !== monitor.x || frame.y !== monitor.y)
            window.move_frame(true, monitor.x, monitor.y);
    }

    _manageWindow(monitorIndex, window) {
        if (!window.inhibit_mapped || !window.is_mapped_inhibited) {
            throw new Error(
                'Meta.Window mapped inhibition API is unavailable');
        }

        const actor = window.get_compositor_private();
        const signalIds = [];
        signalIds.push(window.connect_after('raised', () => window.lower()));
        signalIds.push(window.connect('notify::above', () => {
            if (window.above)
                window.unmake_above();
        }));
        signalIds.push(window.connect('position-changed', () =>
            this._moveWindowToMonitor(window, monitorIndex)));
        signalIds.push(window.connect('unmanaged', () =>
            this._onManagedWindowUnmanaged(monitorIndex, window)));
        const managed = {
            window,
            actor,
            signalIds,
            hideVerifyId: 0,
            hideVerifyCount: 0,
        };
        this._managedWindows.set(monitorIndex, managed);
        if (window.above)
            window.unmake_above();
        window.lower();
        window.inhibit_mapped();
        if (!window.is_mapped_inhibited())
            throw new Error('Mutter did not inhibit the player window');
        this._debug(`Mapped state inhibited for monitor ${monitorIndex}`);
        this._verifyManagedWindowHidden(monitorIndex);
    }

    _verifyManagedWindowHidden(monitorIndex) {
        const managed = this._managedWindows.get(monitorIndex);
        if (!managed || this._playerStopping)
            return;
        if (!managed.window.is_mapped_inhibited()) {
            managed.hideVerifyId = 0;
            this._failWindowAttach(
                _('Mutter released the source window for monitor %d.').format(monitorIndex));
            return;
        }
        if (!managed.actor.visible) {
            managed.hideVerifyId = 0;
            this._debug(`Player source hidden for monitor ${monitorIndex}`);
            return;
        }
        if (managed.hideVerifyCount >= WINDOW_HIDE_VERIFY_LIMIT) {
            managed.hideVerifyId = 0;
            console.error(
                `[Jellyfish] Player source remained visible ` +
                `monitor=${monitorIndex}`);
            this._failWindowAttach(
                _('The source window for monitor %d remained visible.').format(monitorIndex));
            return;
        }
        managed.hideVerifyCount++;
        managed.hideVerifyId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT, WINDOW_HIDE_VERIFY_MS, () => {
                managed.hideVerifyId = 0;
                this._verifyManagedWindowHidden(monitorIndex);
                return GLib.SOURCE_REMOVE;
            });
    }

    _onManagedWindowUnmanaged(monitorIndex, window) {
        const managed = this._managedWindows.get(monitorIndex);
        if (!managed || managed.window !== window)
            return;
        if (managed.hideVerifyId)
            GLib.Source.remove(managed.hideVerifyId);
        this._managedWindows.delete(monitorIndex);
        if (!this._playerStopping && this._settings) {
            this._debug(
                `Player window disappeared from monitor ${monitorIndex}; restarting`);
            this._stopPlayer(true);
        }
    }

    _releaseManagedWindows() {
        for (const {
            window,
            signalIds,
            hideVerifyId,
        } of this._managedWindows.values()) {
            if (hideVerifyId)
                GLib.Source.remove(hideVerifyId);
            for (const signalId of signalIds) {
                try {
                    window.disconnect(signalId);
                } catch (_error) {
                    // The Meta.Window may already have been unmanaged.
                }
            }
        }
        this._managedWindows.clear();
    }

    _failWindowAttach(message) {
        Main.notifyError('Jellyfish', message);
        this._stopPlayer();
    }

    _cancelActorRetry(monitorIndex) {
        const retry = this._actorRetries.get(monitorIndex);
        if (!retry)
            return;
        if (retry.retryId)
            GLib.Source.remove(retry.retryId);
        if (retry.raisedId) {
            try {
                retry.window.disconnect(retry.raisedId);
            } catch (_error) {
                // The Meta.Window may already have been unmanaged.
            }
        }
        this._actorRetries.delete(monitorIndex);
    }

    _cancelActorRetries() {
        for (const monitorIndex of [...this._actorRetries.keys()])
            this._cancelActorRetry(monitorIndex);
    }

    _cancelWindowSetTimeout() {
        if (!this._windowSetTimeoutId)
            return;
        GLib.Source.remove(this._windowSetTimeoutId);
        this._windowSetTimeoutId = 0;
    }

    _onPlayerLine(line) {
        const uri = parseVideoEvent(line);
        if (uri && !this._playerStopping && this._configuredUris().includes(uri))
            this._videoBackground?.update(uri);
        if (line === 'EVENT READY') {
            this._process?.markReady();
            this._applyPauseState();
        }
        if (line.startsWith('REQUEST GPU_FALLBACK')) {
            this._tryNextGpu();
        } else if (line.startsWith('WARNING SOFTWARE_DECODER') &&
            !this._notifiedSoftwareFallback) {
            this._notifiedSoftwareFallback = true;
            console.warn(`[Jellyfish player] ${line}`);
            Main.notify('Jellyfish',
                _('Hardware acceleration is unavailable; using the CPU.'));
        } else if (line.startsWith('WARNING ')) {
            console.warn(`[Jellyfish player] ${line}`);
        } else if (line.startsWith('ERROR ')) {
            this._videoBackground?.update('');
            console.error(`[Jellyfish player] ${line}`);
            Main.notifyError('Jellyfish', line.slice('ERROR '.length));
        } else {
            this._debug(`[player] ${line}`);
        }
    }

    _onPlayerExit(expected, error) {
        if (error)
            console.error(error, 'The Jellyfish player exited with an error');
        this._cancelWindowIdentifications();
        this._cancelActorRetries();
        this._cancelWindowSetTimeout();
        this._releaseManagedWindows();
        this._surface?.detach();
        this._process = null;
        this._expectedMonitorCount = 0;
        const restart = this._restartAfterStop;
        this._playerStopping = false;
        this._restartAfterStop = false;
        if (!this._settings)
            return;
        if (!expected) {
            this._videoBackground?.update('');
            Main.notifyError('Jellyfish',
                _('The video player exited unexpectedly.'));
        } else if (restart && this._playableUris().length > 0) {
            this._schedulePlayerStart();
        }
    }

    _debug(message) {
        if (this._settings?.get_boolean('debug-logging'))
            console.log(`[Jellyfish] ${message}`);
    }

    _debugError(error, context) {
        if (this._settings?.get_boolean('debug-logging'))
            console.error(error, `[Jellyfish] ${context}`);
    }
}
