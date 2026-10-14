// SPDX-License-Identifier: GPL-3.0-or-later

const IMAGE_ERROR_CODES = new Set([
    'decode', 'convert', 'timeout', 'write', 'source', 'changed',
    'missing-plugin', 'cancelled', 'unknown',
]);

export class ImagePreparationError extends Error {
    constructor(code, detail) {
        super(detail);
        this.code = IMAGE_ERROR_CODES.has(code) ? code : 'unknown';
    }
}

export function parseImageWorkerError(stdout, stderr) {
    for (const line of stdout.trim().split('\n').reverse()) {
        if (!line.startsWith('ERROR '))
            continue;
        try {
            const result = JSON.parse(line.slice('ERROR '.length));
            if (result && typeof result.code === 'string' && typeof result.detail === 'string')
                return new ImagePreparationError(result.code, result.detail);
        } catch (_error) {
            // Preserve diagnostics even if the helper exits before reporting an error.
        }
    }
    return new ImagePreparationError('unknown', stderr.trim() || 'Image preparation failed');
}
