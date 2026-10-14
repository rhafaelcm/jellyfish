// SPDX-License-Identifier: GPL-3.0-or-later

import {isIdentifiableVideo} from '../extension/media.js';

function assertEqual(actual, expected, message) {
    if (actual !== expected)
        throw new Error(`${message}: expected ${expected}, got ${actual}`);
}

assertEqual(isIdentifiableVideo({'xesam:url': 'file:///tmp/movie.MKV'}), true,
    'video extension');
assertEqual(isIdentifiableVideo({'xesam:mimeType': 'video/mp4'}), true,
    'video MIME type');
assertEqual(isIdentifiableVideo({'xesam:mimeType': 'audio/mpeg'}), false,
    'audio MIME type');
assertEqual(isIdentifiableVideo({'xesam:url': 'https://example.com/watch?v=1'}), false,
    'unknown web media');
print('media tests: ok');
