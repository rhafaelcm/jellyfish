// SPDX-License-Identifier: GPL-3.0-or-later

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import System from 'system';
import {cachedImages, prepareImages} from '../extension/video-images.js';

const directory = ARGV[1] || GLib.dir_make_tmp('jellyfish-image-test-XXXXXX');
if (ARGV[0] !== '--isolated') {
    const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.NONE});
    launcher.setenv('XDG_CACHE_HOME', directory, true);
    let code = 0;
    try {
        launcher.spawnv(['gjs', '-m', Gio.File.new_for_uri(import.meta.url).get_path(),
            '--isolated', directory]).wait_check(null);
    } catch (error) {
        printerr(error.message);
        code = 1;
    } finally {
        launcher.close();
        removeTemporary(Gio.File.new_for_path(directory));
    }
    System.exit(code);
}
const extensionPath = Gio.File.new_for_uri(import.meta.url).get_parent()
    .get_parent().get_child('extension').get_path();
const generated = Gio.File.new_for_path(GLib.build_filenamev([directory, 'sample.webm']));
const source = Gio.File.new_for_path(GLib.build_filenamev([directory, 'vídeo sample & test.webm']));
const invalid = Gio.File.new_for_path(GLib.build_filenamev([directory, 'invalid.webm']));
const loop = new GLib.MainLoop(null, false);
let failure = null;

function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}

function jpegSize(path) {
    const [, bytes] = GLib.file_get_contents(path);
    assert(bytes[0] === 0xff && bytes[1] === 0xd8, 'Write a valid JPEG header');
    for (let offset = 2; offset + 8 < bytes.length;) {
        assert(bytes[offset] === 0xff, 'Write valid JPEG segments');
        if (bytes[offset + 1] === 0xc0 || bytes[offset + 1] === 0xc2)
            return [bytes[offset + 7] * 256 + bytes[offset + 8],
                bytes[offset + 5] * 256 + bytes[offset + 6]];
        const length = bytes[offset + 2] * 256 + bytes[offset + 3];
        assert(length > 0, 'JPEG segments must have a length');
        offset += length + 2;
    }
    throw new Error('No JPEG dimensions found');
}

async function run() {
    const generator = Gio.Subprocess.new([
        'gst-launch-1.0', '-q', 'videotestsrc', 'num-buffers=3', '!',
        'video/x-raw,width=320,height=180,framerate=10/1', '!',
        'vp8enc', '!', 'webmmux', '!', 'filesink', `location=${generated.get_path()}`,
    ], Gio.SubprocessFlags.NONE);
    generator.wait_check(null);
    generated.move(source, Gio.FileCopyFlags.NONE, null, null);
    const result = await prepareImages(extensionPath, source.get_uri(), new Gio.Cancellable());
    assert(JSON.stringify(jpegSize(result.wallpaper)) === '[320,180]',
        'Preserve full video resolution');
    assert(JSON.stringify(jpegSize(result.thumbnail)) === '[160,90]',
        'Generate a correctly sized thumbnail');
    assert(cachedImages(source.get_uri())?.wallpaper === result.wallpaper,
        'Prepared images must be discoverable');
    const image = Gio.File.new_for_path(result.wallpaper);
    const before = image.query_info('time::modified,time::modified-usec',
        Gio.FileQueryInfoFlags.NONE, null);
    // A second call must reuse images, even with an invalid helper path.
    await prepareImages('/nonexistent-jellyfish-helper', source.get_uri(), new Gio.Cancellable());
    const after = image.query_info('time::modified,time::modified-usec',
        Gio.FileQueryInfoFlags.NONE, null);
    assert(before.get_attribute_uint64('time::modified') === after.get_attribute_uint64('time::modified') &&
        before.get_attribute_uint32('time::modified-usec') === after.get_attribute_uint32('time::modified-usec'),
    'Reusing a cache entry must not regenerate images');
    GLib.file_set_contents(invalid.get_path(), 'Not a video');
    let rejected = false;
    try {
        await prepareImages(extensionPath, invalid.get_uri(), new Gio.Cancellable());
    } catch (_error) {
        rejected = true;
    }
    assert(rejected && !cachedImages(invalid.get_uri()), 'Reject undecodable files');
    const cancelled = new Gio.Cancellable();
    cancelled.cancel();
    rejected = false;
    try {
        await prepareImages(extensionPath, invalid.get_uri(), cancelled);
    } catch (_error) {
        rejected = true;
    }
    assert(rejected, 'Honor cancellation');
    print('image worker integration tests: ok');
}

// Cleanup is confined to the unique temporary directory created by this test.
function removeTemporary(file) {
    if (file.query_file_type(Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null) === Gio.FileType.DIRECTORY) {
        const children = file.enumerate_children('standard::name',
            Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
        let info;
        while ((info = children.next_file(null)))
            removeTemporary(file.get_child(info.get_name()));
        children.close(null);
    }
    file.delete(null);
}

run().catch(error => { failure = error; }).finally(() => loop.quit());
loop.run();
if (failure)
    throw failure;
