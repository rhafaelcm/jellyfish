// SPDX-License-Identifier: GPL-3.0-or-later

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gst from 'gi://Gst?version=1.0';
import GstVideo from 'gi://GstVideo?version=1.0';
import System from 'system';

import {disableHardwareImageDecoders} from './image-decoding.js';
import {ImagePreparationError} from './image-errors.js';

Gst.init(null);
let pipeline = null;
const temporary = [];
let exitCode = 0;

function busError() {
    const message = pipeline.get_bus().pop_filtered(Gst.MessageType.ERROR);
    if (!message)
        return null;
    const [error, debug] = message.parse_error();
    const missingPlugin = error.matches(Gst.CoreError, Gst.CoreError.MISSING_PLUGIN) ||
        error.matches(Gst.StreamError, Gst.StreamError.CODEC_NOT_FOUND);
    const sourceError = [Gst.ResourceError.NOT_FOUND, Gst.ResourceError.OPEN_READ,
        Gst.ResourceError.READ].some(code => error.matches(Gst.ResourceError, code));
    return new ImagePreparationError(missingPlugin ? 'missing-plugin' : sourceError ? 'source' : 'decode',
        `${error.message}${debug ? `\n${debug}` : ''}`);
}

function waitForFrame() {
    const [result] = pipeline.get_state(10 * Gst.SECOND);
    const error = busError();
    if (error)
        throw error;
    if (result !== Gst.StateChangeReturn.SUCCESS) {
        throw new ImagePreparationError(
            result === Gst.StateChangeReturn.ASYNC ? 'timeout' : 'decode',
            'The image pipeline did not finish preparing a frame within ten seconds');
    }
}

function writeImage(sample, path, width = null, height = null) {
    const staging = `${path}.${GLib.uuid_string_random()}.tmp`;
    temporary.push(staging);
    const dimensions = width ? `,width=${width},height=${height}` : '';
    let jpeg;
    try {
        jpeg = GstVideo.video_convert_sample(sample,
            Gst.Caps.from_string(`image/jpeg${dimensions}`), 5 * Gst.SECOND);
        if (!jpeg)
            throw new Error('The JPEG converter returned no image');
    } catch (error) {
        throw new ImagePreparationError('convert', error.message);
    }
    try {
        const buffer = jpeg.get_buffer();
        GLib.file_set_contents(staging, buffer.extract_dup(0, buffer.get_size()));
        Gio.File.new_for_path(staging).move(Gio.File.new_for_path(path),
            Gio.FileCopyFlags.OVERWRITE, null, null);
    } catch (error) {
        throw new ImagePreparationError('write', error.message);
    }
}

try {
    // Disable GPU decoders before autoplugging, including inherited high ranks.
    const disabled = disableHardwareImageDecoders(Gst.ElementFactory.list_get_elements(
        Gst.ELEMENT_FACTORY_TYPE_DECODER + Gst.ELEMENT_FACTORY_TYPE_MEDIA_VIDEO,
        Gst.Rank.NONE));
    print(`STATUS IMAGE_DECODERS software=true disabled=${disabled}`);
    for (const name of ['playbin3', 'fakesink', 'videoconvert', 'videoscale', 'jpegenc']) {
        if (!Gst.ElementFactory.find(name))
            throw new ImagePreparationError('missing-plugin', `Missing GStreamer element: ${name}`);
    }
    if (ARGV[0] === '--check') {
        print('image worker dependency check: ok');
    } else {
        if (ARGV.length !== 3 || !Gio.File.new_for_uri(ARGV[0]).is_native())
            throw new Error('Expected a local video URI and two image paths');
        const [uri, wallpaper, thumbnail] = ARGV;
        if (GLib.mkdir_with_parents(GLib.path_get_dirname(wallpaper), 0o700) !== 0)
            throw new ImagePreparationError('write', 'Could not create the image cache directory');
        pipeline = Gst.ElementFactory.make('playbin3', null);
        pipeline.set_property('uri', uri);
        pipeline.set_property('flags', 1);
        // Plain video/x-raw caps require system memory, not GPU-backed buffers.
        const sink = Gst.parse_bin_from_description(
            'videoconvert ! videoscale ! video/x-raw,format=RGB,pixel-aspect-ratio=1/1 ' +
            '! fakesink name=frames enable-last-sample=true', true);
        const frames = sink.get_by_name('frames');
        pipeline.set_property('video-sink', sink);
        pipeline.set_property('audio-sink', Gst.ElementFactory.make('fakesink', null));
        pipeline.set_state(Gst.State.PAUSED);
        waitForFrame();
        const first = frames.last_sample;
        const [known, duration] = pipeline.query_duration(Gst.Format.TIME);
        const position = known ? Math.min(Gst.SECOND, Math.floor(duration / 2)) : Gst.SECOND;
        let sample = first;
        if (pipeline.seek_simple(Gst.Format.TIME,
            Gst.SeekFlags.FLUSH | Gst.SeekFlags.ACCURATE, position)) {
            try {
                waitForFrame();
                sample = frames.last_sample || first;
            } catch (error) {
                if (!first)
                    throw error;
                printerr(`WARNING Using the first video frame: ${error.message}`);
                sample = first;
            }
        }
        if (!sample)
            throw busError() || new ImagePreparationError('decode',
                'No decoded video frame was delivered to the image sink');
        print(`STATUS IMAGE_FRAME caps=${sample.get_caps().to_string()}`);
        const info = GstVideo.VideoInfo.new_from_caps(sample.get_caps());
        const ratio = Math.min(160 / info.width, 90 / info.height, 1);
        writeImage(sample, wallpaper);
        writeImage(sample, thumbnail, Math.max(1, Math.round(info.width * ratio)),
            Math.max(1, Math.round(info.height * ratio)));
    }
} catch (error) {
    print(`ERROR ${JSON.stringify({
        code: error instanceof ImagePreparationError ? error.code : 'decode',
        detail: error.message,
    })}`);
    printerr(error.message);
    exitCode = 1;
} finally {
    pipeline?.set_state(Gst.State.NULL);
    for (const path of temporary) {
        const file = Gio.File.new_for_path(path);
        try {
            if (file.query_exists(null))
                file.delete(null);
        } catch (error) {
            printerr(`WARNING Could not remove temporary image: ${error.message}`);
        }
    }
}
System.exit(exitCode);
