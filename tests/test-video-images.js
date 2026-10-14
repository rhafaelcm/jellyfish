// SPDX-License-Identifier: GPL-3.0-or-later

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {cachedImages, imageKey, imagePaths} from '../extension/video-images.js';

function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}

const key = imageKey('file:///video.webm', 50, 100, 1);
assert(key === imageKey('file:///video.webm', 50, 100, 1), 'Cache key must be stable');
for (const parameters of [
    ['file:///other.webm', 50, 100, 1], ['file:///video.webm', 51, 100, 1],
    ['file:///video.webm', 50, 101, 1], ['file:///video.webm', 50, 100, 2],
])
    assert(imageKey(...parameters) !== key, 'Changed file identity must invalidate images');
assert(cachedImages('https://example.org/video') === null, 'Reject remote videos');
assert(cachedImages('file:///nonexistent-jellyfish-test.webm') === null, 'Handle missing files');
const directory = GLib.dir_make_tmp('jellyfish-cache-test-XXXXXX');
const file = Gio.File.new_for_path(GLib.build_filenamev([directory, 'video with spaces.webm']));
try {
    GLib.file_set_contents(file.get_path(), 'first');
    const before = imagePaths(file.get_uri());
    assert(before.wallpaper.endsWith('.jpg'), 'Use JPEG wallpapers');
    assert(before.thumbnail.endsWith('-thumbnail.jpg'), 'Keep thumbnails separate');
    assert(cachedImages(file.get_uri()) === null, 'Missing images must not be reported ready');
    GLib.file_set_contents(file.get_path(), 'changed source');
    assert(imagePaths(file.get_uri()).wallpaper !== before.wallpaper,
        'Replacing a source must invalidate the prepared images');
} finally {
    file.delete(null);
    Gio.File.new_for_path(directory).delete(null);
}
print('video image cache tests: ok');
