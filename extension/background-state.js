// SPDX-License-Identifier: GPL-3.0-or-later

export const BACKGROUND_KEYS = ['picture-uri', 'picture-uri-dark', 'picture-options'];

export function restoreValues(original, applied, current) {
    return Object.fromEntries(BACKGROUND_KEYS
        .filter(key => typeof original[key] === 'string' &&
            typeof applied[key] === 'string' && current[key] === applied[key])
        .map(key => [key, original[key]]));
}

export function parseVideoEvent(line) {
    if (!line.startsWith('EVENT VIDEO '))
        return null;
    try {
        const event = JSON.parse(line.slice('EVENT VIDEO '.length));
        return typeof event.uri === 'string' && event.uri.startsWith('file:')
            ? event.uri : null;
    } catch (_error) {
        return null;
    }
}
