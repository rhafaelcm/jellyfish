// SPDX-License-Identifier: GPL-3.0-or-later

import {PlaylistSequence} from '../extension/playlist.js';

function assertEqual(actual, expected, message) {
    if (actual !== expected)
        throw new Error(`${message}: expected ${expected}, got ${actual}`);
}

const sequence = new PlaylistSequence(['a', 'b'], 2);
assertEqual(sequence.current, 'a', 'first item');
assertEqual(sequence.completeCurrent().uri, 'a', 'first repetition');
assertEqual(sequence.completeCurrent().uri, 'b', 'advance to second item');
assertEqual(sequence.completeCurrent().uri, 'b', 'second item repetition');
assertEqual(sequence.completeCurrent().uri, 'a', 'wrap to first item');

const minimum = new PlaylistSequence(['a', 'b'], 0);
assertEqual(minimum.completeCurrent().uri, 'b', 'repeat count has minimum one');
print('playlist tests: ok');
