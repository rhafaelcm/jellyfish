// SPDX-License-Identifier: GPL-3.0-or-later

const VIDEO_EXTENSIONS = new Set([
    '3g2', '3gp', 'avi', 'flv', 'm2ts', 'm4v', 'mkv', 'mov', 'mp4',
    'mpeg', 'mpg', 'mts', 'ogv', 'ts', 'vob', 'webm', 'wmv',
]);

function unpack(value) {
    while (value && typeof value.deepUnpack === 'function')
        value = value.deepUnpack();
    return value;
}

function metadataValue(metadata, names) {
    for (const name of names) {
        const value = unpack(metadata?.[name]);
        if (typeof value === 'string' && value)
            return value;
    }
    return '';
}

export function isIdentifiableVideo(metadata) {
    const contentType = metadataValue(metadata, [
        'xesam:mimeType',
        'xesam:contentType',
        'mpris:mimeType',
    ]).toLowerCase();
    if (contentType.startsWith('video/'))
        return true;
    if (contentType)
        return false;

    const uri = metadataValue(metadata, ['xesam:url']);
    if (!uri)
        return false;
    const path = uri.split(/[?#]/, 1)[0];
    const extension = path.includes('.')
        ? path.slice(path.lastIndexOf('.') + 1).toLowerCase()
        : '';
    return VIDEO_EXTENSIONS.has(extension);
}
