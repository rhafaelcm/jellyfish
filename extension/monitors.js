// SPDX-License-Identifier: GPL-3.0-or-later

const WINDOW_TITLE_PATTERN = /^Jellyfish Wallpaper \[monitor=(\d+)\]$/;
const MONITOR_SPEC_PATTERN = /^(\d+):(\d+)x(\d+)$/;

export const MonitorWindowTitleStatus = Object.freeze({
    WAITING: 'waiting',
    VALID: 'valid',
    OUT_OF_RANGE: 'out-of-range',
});

function requireInteger(value, minimum, name) {
    if (!Number.isInteger(value) || value < minimum)
        throw new RangeError(`${name} must be an integer greater than or equal to ${minimum}`);
}

export function formatMonitorSpec(index, width, height) {
    requireInteger(index, 0, 'Monitor index');
    requireInteger(width, 2, 'Monitor width');
    requireInteger(height, 2, 'Monitor height');
    return `${index}:${width}x${height}`;
}

export function parseMonitorSpec(specification) {
    const match = MONITOR_SPEC_PATTERN.exec(specification || '');
    if (!match)
        throw new Error(`Invalid monitor specification: ${specification}`);

    const monitor = {
        index: Number.parseInt(match[1], 10),
        width: Number.parseInt(match[2], 10),
        height: Number.parseInt(match[3], 10),
    };
    requireInteger(monitor.index, 0, 'Monitor index');
    requireInteger(monitor.width, 2, 'Monitor width');
    requireInteger(monitor.height, 2, 'Monitor height');
    return monitor;
}

export function formatMonitorWindowTitle(index) {
    requireInteger(index, 0, 'Monitor index');
    return `Jellyfish Wallpaper [monitor=${index}]`;
}

export function parseMonitorWindowTitle(title) {
    const match = WINDOW_TITLE_PATTERN.exec(title || '');
    return match ? Number.parseInt(match[1], 10) : null;
}

export function classifyMonitorWindowTitle(title, monitorCount) {
    requireInteger(monitorCount, 0, 'Monitor count');
    const monitorIndex = parseMonitorWindowTitle(title);
    if (monitorIndex === null) {
        return {
            status: MonitorWindowTitleStatus.WAITING,
            monitorIndex: null,
        };
    }
    if (monitorIndex >= monitorCount) {
        return {
            status: MonitorWindowTitleStatus.OUT_OF_RANGE,
            monitorIndex,
        };
    }
    return {
        status: MonitorWindowTitleStatus.VALID,
        monitorIndex,
    };
}
