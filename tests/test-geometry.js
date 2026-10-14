// SPDX-License-Identifier: GPL-3.0-or-later

import {calculateCoverGeometry} from '../extension/geometry.js';

function assertClose(actual, expected, message) {
    if (Math.abs(actual - expected) > 0.0001)
        throw new Error(`${message}: expected ${expected}, got ${actual}`);
}

function testSameAspectRatio() {
    const result = calculateCoverGeometry(1920, 1080, 1280, 720);
    assertClose(result.scale, 2 / 3, '16:9 scale');
    assertClose(result.width, 1280, '16:9 width');
    assertClose(result.height, 720, '16:9 height');
    assertClose(result.x, 0, '16:9 x');
    assertClose(result.y, 0, '16:9 y');
}

function testWideVideoOnTallMonitor() {
    const result = calculateCoverGeometry(1920, 1080, 1200, 1920);
    assertClose(result.height, 1920, 'portrait height');
    assertClose(result.y, 0, 'portrait y');
    if (result.width <= 1200 || result.x >= 0)
        throw new Error('Portrait placement must crop both horizontal edges');
}

function testTallVideoOnWideMonitor() {
    const result = calculateCoverGeometry(1080, 1920, 3440, 1440);
    assertClose(result.width, 3440, 'ultrawide width');
    assertClose(result.x, 0, 'ultrawide x');
    if (result.height <= 1440 || result.y >= 0)
        throw new Error('Ultrawide placement must crop both vertical edges');
}

function testInvalidGeometry() {
    let failed = false;
    try {
        calculateCoverGeometry(0, 1080, 1920, 1080);
    } catch (error) {
        failed = error instanceof RangeError;
    }
    if (!failed)
        throw new Error('Invalid dimensions must raise RangeError');
}

testSameAspectRatio();
testWideVideoOnTallMonitor();
testTallVideoOnWideMonitor();
testInvalidGeometry();
print('geometry tests: ok');

