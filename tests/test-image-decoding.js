// SPDX-License-Identifier: GPL-3.0-or-later

import {disableHardwareImageDecoders} from '../extension/image-decoding.js';
import {parseImageWorkerError} from '../extension/image-errors.js';

function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}

function factory(klass, plugin, rank) {
    return {
        rank,
        get_metadata: () => klass,
        get_plugin_name: () => plugin,
        set_rank(value) { this.rank = value; },
    };
}

const decoders = [
    factory('Codec/Decoder/Video/Hardware', 'nvcodec', 4096),
    factory('Codec/Decoder/Video', 'va', 3000),
    factory('Codec/Decoder/Video/Hardware', 'another-hardware-plugin', 512),
    factory('Codec/Decoder/Video', 'libav', 256),
    factory('Codec/Decoder/Video', 'vpx', 256),
    factory('Codec/Encoder/Video/Hardware', 'nvcodec', 4096),
    factory('Codec/Decoder/Audio', 'libav', 256),
];
assert(disableHardwareImageDecoders(decoders) === 3, 'Disable all hardware video decoders');
assert(decoders.slice(0, 3).every(item => item.rank === 0), 'Override high hardware ranks');
assert(decoders.slice(3, 5).every(item => item.rank === 256), 'Preserve software decoder ranks');
assert(decoders[5].rank === 4096 && decoders[6].rank === 256, 'Leave unrelated elements alone');
assert(disableHardwareImageDecoders([]) === 0, 'Allow systems without hardware plugins');

for (const code of ['decode', 'convert', 'timeout', 'write', 'missing-plugin']) {
    const error = parseImageWorkerError(
        `STATUS IMAGE_DECODERS software=true\nERROR ${JSON.stringify({code, detail: 'Technical details'})}\n`,
        'Other diagnostic output');
    assert(error.code === code && error.message === 'Technical details', 'Preserve structured errors');
}
for (const stdout of ['', 'ERROR {', 'ERROR null', 'ERROR {"code":4}']) {
    const error = parseImageWorkerError(stdout, 'Helper crashed');
    assert(error.code === 'unknown' && error.message === 'Helper crashed', 'Handle malformed output');
}
assert(parseImageWorkerError('', '').message.length > 0, 'Report silent helper exits');
assert(parseImageWorkerError('ERROR {"code":"unexpected","detail":"Details"}', '').code === 'unknown',
    'Reject unknown error categories');
print('image decoding policy and error tests: ok');
