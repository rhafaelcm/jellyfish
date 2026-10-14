// SPDX-License-Identifier: GPL-3.0-or-later

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export function imageKey(uri, size, modified, microseconds = 0) {
    return GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256,
        JSON.stringify([1, uri, size, modified, microseconds]), -1);
}

export function imagePaths(uri) {
    const file = Gio.File.new_for_uri(uri);
    if (!file.is_native())
        throw new Error('Only local videos are supported');
    const info = file.query_info(
        'standard::size,time::modified,time::modified-usec',
        Gio.FileQueryInfoFlags.NONE, null);
    const key = imageKey(uri, info.get_size(),
        info.get_attribute_uint64('time::modified'),
        info.get_attribute_uint32('time::modified-usec'));
    const directory = GLib.build_filenamev([GLib.get_user_cache_dir(), 'jellyfish']);
    return {
        directory,
        wallpaper: GLib.build_filenamev([directory, `${key}.jpg`]),
        thumbnail: GLib.build_filenamev([directory, `${key}-thumbnail.jpg`]),
    };
}

export function cachedImages(uri) {
    try {
        const paths = imagePaths(uri);
        return ['wallpaper', 'thumbnail'].every(name =>
            GLib.file_test(paths[name], GLib.FileTest.IS_REGULAR)) ? paths : null;
    } catch (_error) {
        return null;
    }
}

// Extraction is only invoked by preferences, never by the playback process.
export async function prepareImages(extensionPath, uri, cancellable) {
    const existing = cachedImages(uri);
    if (existing)
        return existing;
    const paths = imagePaths(uri);
    const process = Gio.Subprocess.new([
        'gjs', '-m', GLib.build_filenamev([extensionPath, 'image-worker.js']),
        uri, paths.wallpaper, paths.thumbnail,
    ], Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
    let timedOut = false;
    const timeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 35, () => {
        timedOut = true;
        process.force_exit();
        return GLib.SOURCE_REMOVE;
    });
    const cancelId = cancellable.connect(() => process.force_exit());
    try {
        await new Promise((resolve, reject) => {
            process.communicate_utf8_async(null, null, (child, result) => {
                try {
                    const [, , stderr] = child.communicate_utf8_finish(result);
                    if (cancellable.is_cancelled())
                        throw new Error('Image preparation cancelled');
                    if (timedOut || !child.get_successful())
                        throw new Error(timedOut ? 'Image preparation timed out' : stderr.trim());
                    resolve();
                } catch (error) {
                    reject(error);
                }
            });
        });
        // A file replaced during extraction must not publish obsolete images.
        if (imagePaths(uri).wallpaper !== paths.wallpaper || !cachedImages(uri))
            throw new Error('The video changed during image preparation');
        return paths;
    } finally {
        if (!timedOut)
            GLib.Source.remove(timeout);
        if (cancelId)
            cancellable.disconnect(cancelId);
    }
}
