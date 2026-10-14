// SPDX-License-Identifier: GPL-3.0-or-later

const HARDWARE_PLUGINS = new Set([
    'va', 'vaapi', 'nvcodec', 'amfcodec', 'qsv', 'msdk', 'v4l2codecs',
]);

// Ranks belong to the current process; this never changes the player or registry.
export function disableHardwareImageDecoders(factories) {
    let disabled = 0;
    for (const factory of factories) {
        const klass = factory.get_metadata('klass') || '';
        if (!klass.includes('Decoder') || !klass.includes('Video'))
            continue;
        if (klass.includes('Hardware') || HARDWARE_PLUGINS.has(factory.get_plugin_name())) {
            factory.set_rank(0);
            disabled++;
        }
    }
    return disabled;
}
