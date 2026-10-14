// SPDX-License-Identifier: GPL-3.0-or-later

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gst from 'gi://Gst?version=1.0';
import GstVideo from 'gi://GstVideo?version=1.0';
import System from 'system';

Gst.init(null);
let pipeline = null;
const temporary = [];
let exitCode = 0;

function waitForFrame() {
    const [result] = pipeline.get_state(10 * Gst.SECOND);
    if (result !== Gst.StateChangeReturn.SUCCESS)
        throw new Error('Could not decode a video frame within ten seconds');
}

function writeImage(sample, path, width = null, height = null) {
    const staging = `${path}.${GLib.uuid_string_random()}.tmp`;
    temporary.push(staging);
    const dimensions = width ? `,width=${width},height=${height}` : '';
    const jpeg = GstVideo.video_convert_sample(sample,
        Gst.Caps.from_string(`image/jpeg${dimensions}`), 5 * Gst.SECOND);
    if (!jpeg)
        throw new Error('Could not encode the video image');
    const buffer = jpeg.get_buffer();
    GLib.file_set_contents(staging, buffer.extract_dup(0, buffer.get_size()));
    Gio.File.new_for_path(staging).move(Gio.File.new_for_path(path),
        Gio.FileCopyFlags.OVERWRITE, null, null);
}

try {
    if (ARGV[0] === '--check') {
        for (const name of ['playbin3', 'fakesink', 'videoconvert', 'videoscale', 'jpegenc']) {
            if (!Gst.ElementFactory.find(name))
                throw new Error(`Missing GStreamer element: ${name}`);
        }
        print('image worker dependency check: ok');
    } else {
        if (ARGV.length !== 3 || !Gio.File.new_for_uri(ARGV[0]).is_native())
            throw new Error('Expected a local video URI and two image paths');
        const [uri, wallpaper, thumbnail] = ARGV;
        GLib.mkdir_with_parents(GLib.path_get_dirname(wallpaper), 0o700);
        pipeline = Gst.ElementFactory.make('playbin3', null);
        pipeline.set_property('uri', uri);
        pipeline.set_property('flags', 1);
        pipeline.set_property('video-sink', Gst.ElementFactory.make('fakesink', null));
        pipeline.set_property('audio-sink', Gst.ElementFactory.make('fakesink', null));
        pipeline.set_state(Gst.State.PAUSED);
        waitForFrame();
        const caps = Gst.Caps.from_string('video/x-raw,format=RGB,pixel-aspect-ratio=1/1');
        const first = pipeline.emit('convert-sample', caps);
        const [known, duration] = pipeline.query_duration(Gst.Format.TIME);
        const position = known ? Math.min(Gst.SECOND, Math.floor(duration / 2)) : Gst.SECOND;
        let sample = first;
        if (pipeline.seek_simple(Gst.Format.TIME,
            Gst.SeekFlags.FLUSH | Gst.SeekFlags.ACCURATE, position)) {
            try {
                waitForFrame();
                sample = pipeline.emit('convert-sample', caps) || first;
            } catch (_error) {
                sample = first;
            }
        }
        if (!sample)
            throw new Error('The file has no decodable video frame');
        const info = GstVideo.VideoInfo.new_from_caps(sample.get_caps());
        const ratio = Math.min(160 / info.width, 90 / info.height, 1);
        writeImage(sample, wallpaper);
        writeImage(sample, thumbnail, Math.max(1, Math.round(info.width * ratio)),
            Math.max(1, Math.round(info.height * ratio)));
    }
} catch (error) {
    printerr(error.message);
    exitCode = 1;
} finally {
    pipeline?.set_state(Gst.State.NULL);
    for (const path of temporary) {
        const file = Gio.File.new_for_path(path);
        if (file.query_exists(null))
            file.delete(null);
    }
}
System.exit(exitCode);
