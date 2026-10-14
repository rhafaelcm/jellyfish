// SPDX-License-Identifier: GPL-3.0-or-later

export function normalizeRepeatCount(value) {
    return Math.max(1, Number.parseInt(value, 10) || 1);
}

export class PlaylistSequence {
    constructor(uris, repeatCount) {
        this._uris = [...uris];
        this._repeatCount = normalizeRepeatCount(repeatCount);
        this._index = 0;
        this._completed = 0;
    }

    get current() {
        return this._uris[this._index] || '';
    }

    get index() {
        return this._index;
    }

    get length() {
        return this._uris.length;
    }

    completeCurrent() {
        if (!this.current)
            return {uri: '', changed: false};

        this._completed++;
        if (this._completed < this._repeatCount)
            return {uri: this.current, changed: false};

        return this.skipCurrent();
    }

    skipCurrent() {
        if (!this.current)
            return {uri: '', changed: false};
        this._completed = 0;
        this._index = (this._index + 1) % this._uris.length;
        return {uri: this.current, changed: true};
    }
}
