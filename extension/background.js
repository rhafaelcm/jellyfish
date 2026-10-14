// SPDX-License-Identifier: GPL-3.0-or-later

import Gio from 'gi://Gio';

import {BACKGROUND_KEYS, restoreValues} from './background-state.js';
import {cachedImages} from './video-images.js';

export class VideoBackground {
    constructor(settings, background = null, findImages = cachedImages) {
        this._settings = settings;
        this._background = background || new Gio.Settings({schema_id: 'org.gnome.desktop.background'});
        this._findImages = findImages;
        this._original = {};
        this._applied = {};
        this._writing = false;
        this._suspended = false;
        this._uri = '';
        // Recover an interrupted session before taking ownership again.
        try {
            const saved = JSON.parse(settings.get_string('wallpaper-state') || '{}');
            this._original = saved.original || {};
            this._applied = saved.applied || {};
        } catch (_error) {
            // Invalid recovery data must not overwrite the user's background.
        }
        this.restore();
        this._changedId = this._background.connect('changed', (_settings, key) => {
            if (this._writing || !BACKGROUND_KEYS.includes(key) ||
                !Object.keys(this._applied).length)
                return;
            if (this._background.get_string(key) !== this._applied[key]) {
                this._suspended = true;
                this.restore();
            }
        });
        this._enabledId = settings.connect('changed::use-video-wallpaper', () => {
            this._suspended = false;
            this.update(this._uri);
        });
        this._imagesId = settings.connect('changed::video-images-revision', () =>
            this.update(this._uri));
    }

    _read() {
        return Object.fromEntries(BACKGROUND_KEYS.map(key =>
            [key, this._background.get_string(key)]));
    }

    _write(values) {
        this._writing = true;
        try {
            for (const [key, value] of Object.entries(values))
                this._background.set_string(key, value);
        } finally {
            this._writing = false;
        }
    }

    update(uri) {
        this._uri = uri;
        if (this._suspended)
            return;
        const images = uri && this._findImages(uri);
        if (!this._settings.get_boolean('use-video-wallpaper') || !images) {
            this.restore();
            return;
        }
        if (!BACKGROUND_KEYS.every(key => this._background.is_writable(key)))
            return;
        if (!Object.keys(this._original).length)
            this._original = this._read();
        const imageUri = Gio.File.new_for_path(images.wallpaper).get_uri();
        this._applied = {
            'picture-uri': imageUri,
            'picture-uri-dark': imageUri,
            'picture-options': 'zoom',
        };
        this._settings.set_string('wallpaper-state', JSON.stringify({
            original: this._original, applied: this._applied,
        }));
        this._write(this._applied);
    }

    restore() {
        this._write(restoreValues(this._original, this._applied, this._read()));
        this._original = {};
        this._applied = {};
        this._settings.set_string('wallpaper-state', '');
    }

    destroy() {
        this._background.disconnect(this._changedId);
        this._settings.disconnect(this._enabledId);
        this._settings.disconnect(this._imagesId);
        this.restore();
    }
}
