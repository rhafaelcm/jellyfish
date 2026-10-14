// SPDX-License-Identifier: GPL-3.0-or-later

import {
    classifyMonitorWindowTitle,
    formatMonitorSpec,
    formatMonitorWindowTitle,
    MonitorWindowTitleStatus,
    parseMonitorSpec,
    parseMonitorWindowTitle,
} from '../extension/monitors.js';

function assertEqual(actual, expected, message) {
    if (actual !== expected)
        throw new Error(`${message}: expected ${expected}, got ${actual}`);
}

function assertThrows(callback, message) {
    let failed = false;
    try {
        callback();
    } catch (_error) {
        failed = true;
    }
    if (!failed)
        throw new Error(`${message}: expected an exception`);
}

const specification = formatMonitorSpec(2, 2560, 1600);
assertEqual(specification, '2:2560x1600', 'monitor specification');
const monitor = parseMonitorSpec(specification);
assertEqual(monitor.index, 2, 'monitor index');
assertEqual(monitor.width, 2560, 'monitor width');
assertEqual(monitor.height, 1600, 'monitor height');

const title = formatMonitorWindowTitle(2);
assertEqual(title, 'Jellyfish Wallpaper [monitor=2]', 'window title');
assertEqual(parseMonitorWindowTitle(title), 2, 'parsed window title');
assertEqual(parseMonitorWindowTitle('Unrelated window'), null, 'unrelated title');

let classification = classifyMonitorWindowTitle('', 2);
assertEqual(classification.status, MonitorWindowTitleStatus.WAITING,
    'empty title waits for Wayland propagation');
classification = classifyMonitorWindowTitle('Jellyfish', 2);
assertEqual(classification.status, MonitorWindowTitleStatus.WAITING,
    'temporary title waits for Wayland propagation');
classification = classifyMonitorWindowTitle(
    'Jellyfish Wallpaper [monitor=1]', 2);
assertEqual(classification.status, MonitorWindowTitleStatus.VALID,
    'known monitor title is valid');
assertEqual(classification.monitorIndex, 1, 'known monitor index');
classification = classifyMonitorWindowTitle(
    'Jellyfish Wallpaper [monitor=2]', 2);
assertEqual(classification.status, MonitorWindowTitleStatus.OUT_OF_RANGE,
    'nonexistent monitor is rejected');

assertThrows(() => parseMonitorSpec('2:0x1600'), 'zero width');
assertThrows(() => parseMonitorSpec('monitor-2'), 'malformed specification');
assertThrows(() => formatMonitorWindowTitle(-1), 'negative monitor index');

print('monitor tests: ok');
