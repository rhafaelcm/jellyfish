// SPDX-License-Identifier: GPL-3.0-or-later

import {parseVideoEvent, restoreValues} from '../extension/background-state.js';
import {VideoBackground} from '../extension/background.js';

function equal(actual, expected, message) {
    if (JSON.stringify(actual) !== JSON.stringify(expected))
        throw new Error(`${message}: ${JSON.stringify(actual)}`);
}

const original = {
    'picture-uri': 'file:///light.jpg',
    'picture-uri-dark': 'file:///dark.jpg',
    'picture-options': 'scaled',
};
const applied = {
    'picture-uri': 'file:///video.jpg',
    'picture-uri-dark': 'file:///video.jpg',
    'picture-options': 'zoom',
};
equal(restoreValues(original, applied, applied), original, 'Restore owned values');
equal(restoreValues(original, applied, {
    ...applied, 'picture-uri': 'file:///manual.jpg',
}), {
    'picture-uri-dark': original['picture-uri-dark'],
    'picture-options': original['picture-options'],
}, 'Preserve a manual wallpaper change');
equal(restoreValues({}, {}, applied), {}, 'Ignore empty recovery data');
equal(restoreValues({'picture-uri': 7}, applied, applied), {}, 'Ignore invalid recovery data');
const uri = 'file:///tmp/a%20video.webm';
equal(parseVideoEvent(`EVENT VIDEO ${JSON.stringify({uri})}`), uri, 'Read video event');
for (const line of ['EVENT READY', 'EVENT VIDEO {', 'EVENT VIDEO null',
    'EVENT VIDEO {"uri":3}', 'EVENT VIDEO {"uri":"https://example.org/video"}'])
    equal(parseVideoEvent(line), null, 'Ignore malformed or nonlocal event');
// Synchronous signals exercise ownership changes without touching user settings.
class MemorySettings {
    constructor(values) {
        this.values = {...values};
        this.handlers = new Map();
        this.nextId = 1;
    }

    get_string(key) {
        return this.values[key] ?? '';
    }

    get_boolean(key) {
        return Boolean(this.values[key]);
    }

    set_string(key, value) {
        if (this.values[key] === value)
            return;
        this.values[key] = value;
        for (const [signal, callback] of this.handlers.values()) {
            if (signal === 'changed' || signal === `changed::${key}`)
                callback(this, key);
        }
    }

    is_writable() {
        return true;
    }

    connect(signal, callback) {
        const id = this.nextId++;
        this.handlers.set(id, [signal, callback]);
        return id;
    }

    disconnect(id) {
        this.handlers.delete(id);
    }
}

const settings = new MemorySettings({'use-video-wallpaper': true});
const desktop = new MemorySettings(original);
const images = video => video === 'file:///missing.webm' ? null : {
    wallpaper: video === 'file:///second.webm' ? '/tmp/second.jpg' : '/tmp/first.jpg',
};
const background = new VideoBackground(settings, desktop, images);
background.update(uri);
equal(desktop.values['picture-uri'], 'file:///tmp/first.jpg', 'Apply video image');
equal(desktop.values['picture-uri-dark'], 'file:///tmp/first.jpg', 'Apply dark wallpaper');
background.update('file:///second.webm');
equal(desktop.values['picture-uri'], 'file:///tmp/second.jpg', 'Follow playlist advancement');
settings.set_string('use-video-wallpaper', false);
equal(desktop.values, original, 'Restore original when option is disabled');
settings.set_string('use-video-wallpaper', true);
equal(desktop.values['picture-uri'], 'file:///tmp/second.jpg', 'Reapply current video');
desktop.set_string('picture-uri', 'file:///manual.jpg');
background.update(uri);
equal(desktop.values['picture-uri'], 'file:///manual.jpg', 'Suspend after a manual change');
settings.set_string('use-video-wallpaper', false);
settings.set_string('use-video-wallpaper', true);
equal(desktop.values['picture-uri'], 'file:///tmp/first.jpg', 'Explicitly reenable sync');
background.update('file:///missing.webm');
equal(desktop.values['picture-uri'], 'file:///manual.jpg', 'Missing images restore previous wallpaper');
background.update(uri);
background.update('');
equal(desktop.values['picture-uri'], 'file:///manual.jpg', 'Clearing source restores previous wallpaper');
background.update(uri);
background.destroy();
equal(desktop.values['picture-uri'], 'file:///manual.jpg', 'Disable restores previous wallpaper');
equal(desktop.handlers.size, 0, 'Disconnect desktop signals');
equal(settings.handlers.size, 0, 'Disconnect extension signals');
equal(settings.get_string('wallpaper-state'), '', 'Clear recovery state');

const recoverySettings = new MemorySettings({
    'use-video-wallpaper': true,
    'wallpaper-state': JSON.stringify({original, applied}),
});
const recoveryDesktop = new MemorySettings(applied);
const recovered = new VideoBackground(recoverySettings, recoveryDesktop, images);
equal(recoveryDesktop.values, original, 'Recover an interrupted session');
recovered.destroy();
print('background state and lifecycle tests: ok');
