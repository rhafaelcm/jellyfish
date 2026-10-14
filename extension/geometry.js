// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Calculate a centered "cover" placement inside a monitor-sized viewport.
 * Coordinates are relative to the viewport; the caller positions the viewport.
 */
export function calculateCoverGeometry(
    sourceWidth, sourceHeight, viewportWidth, viewportHeight) {
    if (![sourceWidth, sourceHeight, viewportWidth, viewportHeight]
        .every(value => Number.isFinite(value) && value > 0))
        throw new RangeError('Geometry dimensions must be positive numbers');

    const scale = Math.max(
        viewportWidth / sourceWidth,
        viewportHeight / sourceHeight
    );
    const width = sourceWidth * scale;
    const height = sourceHeight * scale;

    return {
        scale,
        width,
        height,
        x: (viewportWidth - width) / 2,
        y: (viewportHeight - height) / 2,
    };
}

