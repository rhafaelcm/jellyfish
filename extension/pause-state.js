// SPDX-License-Identifier: GPL-3.0-or-later

export const GLOBAL_SCOPE = 'global';

export class PauseState {
    constructor() {
        this._manual = false;
        this._automatic = new Map();
        this._suppressed = new Set();
    }

    setAutomatic(reasons) {
        this._automatic = new Map(reasons);
        for (const reason of [...this._suppressed]) {
            if (!this._automatic.has(reason))
                this._suppressed.delete(reason);
        }
    }

    pauseManually() {
        this._manual = true;
        this._suppressed.clear();
    }

    forceContinue() {
        this._manual = false;
        for (const reason of this._automatic.keys())
            this._suppressed.add(reason);
    }

    get paused() {
        return this._manual || this._effectiveReasons().length > 0;
    }

    getPausedMonitors() {
        const monitors = new Set();
        for (const [, scope] of this._effectiveReasons()) {
            if (Number.isInteger(scope))
                monitors.add(scope);
        }
        return monitors;
    }

    shouldPausePipeline(monitorCount) {
        if (this._manual)
            return true;

        const reasons = this._effectiveReasons();
        if (reasons.some(([, scope]) => scope === GLOBAL_SCOPE))
            return true;

        const pausedMonitors = new Set(reasons
            .map(([, scope]) => scope)
            .filter(scope => Number.isInteger(scope)));
        return monitorCount > 0 && pausedMonitors.size >= monitorCount;
    }

    _effectiveReasons() {
        return [...this._automatic.entries()]
            .filter(([reason]) => !this._suppressed.has(reason));
    }
}
