// SPDX-License-Identifier: GPL-3.0-or-later

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {calculateCoverGeometry} from './geometry.js';

/**
 * Owns the private GNOME Shell background integration. Keeping all access to
 * _backgroundGroup here makes future Shell compatibility changes local.
 */
export class WallpaperSurface {
    constructor() {
        this._entries = new Map();
        this._rebuildId = 0;
    }

    get size() {
        return this._entries.size;
    }

    hasMonitor(monitorIndex) {
        return this._entries.has(monitorIndex);
    }

    attach(monitorIndex, windowActor) {
        if (!windowActor)
            throw new Error('The Jellyfish window has no compositor actor');
        if (this._entries.has(monitorIndex))
            throw new Error(`Monitor ${monitorIndex} already has a wallpaper source`);

        if (!windowActor.get_parent())
            throw new Error('The Jellyfish window actor has no parent');

        const viewport = new Clutter.Actor({
            name: `jellyfish-monitor-${monitorIndex}`,
            reactive: false,
            clip_to_allocation: true,
        });
        const clone = new Clutter.Clone({
            source: windowActor,
            reactive: false,
        });
        viewport.add_child(clone);
        Main.layoutManager._backgroundGroup.add_child(viewport);

        const entry = {
            source: windowActor,
            viewport,
            clone,
            frozen: false,
            destroyId: 0,
            allocationId: 0,
        };
        entry.destroyId = windowActor.connect('destroy', () => {
            entry.destroyId = 0;
            this._destroyEntry(monitorIndex, false);
        });
        entry.allocationId = windowActor.connect(
            'notify::allocation', () => this._scheduleRebuild());
        this._entries.set(monitorIndex, entry);
        this._rebuild();
    }

    setMonitorFrozen(monitorIndex, frozen) {
        const entry = this._entries.get(monitorIndex);
        if (!entry || entry.frozen === frozen)
            return;
        if (!entry.source.freeze || !entry.source.thaw)
            throw new Error('Meta.WindowActor freeze API is unavailable');

        if (frozen)
            entry.source.freeze();
        else
            entry.source.thaw();
        entry.frozen = frozen;
    }

    setFrozenMonitors(monitors) {
        for (const monitorIndex of this._entries.keys())
            this.setMonitorFrozen(monitorIndex, monitors.has(monitorIndex));
    }

    rebuild() {
        this._rebuild();
    }

    detach() {
        if (this._rebuildId) {
            GLib.Source.remove(this._rebuildId);
            this._rebuildId = 0;
        }
        for (const monitorIndex of [...this._entries.keys()])
            this._destroyEntry(monitorIndex, true);
    }

    _scheduleRebuild() {
        if (this._rebuildId)
            return;
        this._rebuildId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._rebuildId = 0;
            this._rebuild();
            return GLib.SOURCE_REMOVE;
        });
    }

    _rebuild() {
        for (const [monitorIndex, entry] of this._entries) {
            const monitor = Main.layoutManager.monitors[monitorIndex];
            if (!monitor)
                continue;
            const sourceWidth = entry.source.get_width();
            const sourceHeight = entry.source.get_height();
            if (sourceWidth < 2 || sourceHeight < 2)
                continue;
            const geometry = calculateCoverGeometry(
                sourceWidth, sourceHeight, monitor.width, monitor.height);
            entry.viewport.set_position(monitor.x, monitor.y);
            entry.viewport.set_size(monitor.width, monitor.height);
            entry.clone.set_position(geometry.x, geometry.y);
            entry.clone.set_size(geometry.width, geometry.height);
        }
    }

    _destroyEntry(monitorIndex, disconnectSource) {
        const entry = this._entries.get(monitorIndex);
        if (!entry)
            return;
        this._entries.delete(monitorIndex);

        if (disconnectSource && entry.source) {
            if (entry.frozen && entry.source.thaw)
                entry.source.thaw();
            if (entry.destroyId)
                entry.source.disconnect(entry.destroyId);
            if (entry.allocationId)
                entry.source.disconnect(entry.allocationId);
        }
        entry.clone.set_source(null);
        entry.viewport.destroy();
    }
}

