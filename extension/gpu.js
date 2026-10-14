// SPDX-License-Identifier: GPL-3.0-or-later

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const DRM_DIRECTORY = '/sys/class/drm';

const VENDORS = new Map([
    ['0x8086', 'intel'],
    ['0x10de', 'nvidia'],
    ['0x1002', 'amd'],
    ['0x1022', 'amd'],
]);

function readText(path) {
    try {
        const [success, contents] = GLib.file_get_contents(path);
        if (success)
            return new TextDecoder().decode(contents).trim();
    } catch (_error) {
        // A DRM entry can disappear while monitors or GPUs are changing.
    }
    return '';
}

function listNames(path) {
    const names = [];
    try {
        const directory = Gio.File.new_for_path(path);
        const enumerator = directory.enumerate_children(
            'standard::name', Gio.FileQueryInfoFlags.NONE, null);
        let info;
        while ((info = enumerator.next_file(null)))
            names.push(info.get_name());
        enumerator.close(null);
    } catch (_error) {
        // Missing or inaccessible sysfs directories mean no usable device.
    }
    return names;
}

function parseUevent(path) {
    const result = {};
    for (const line of readText(path).split('\n')) {
        const separator = line.indexOf('=');
        if (separator > 0)
            result[line.slice(0, separator)] = line.slice(separator + 1);
    }
    return result;
}

function findRenderNode(cardName) {
    const directory = `${DRM_DIRECTORY}/${cardName}/device/drm`;
    const renderName = listNames(directory)
        .find(name => /^renderD\d+$/.test(name));
    return renderName ? `/dev/dri/${renderName}` : '';
}

export function detectGpuDevices() {
    const drmNames = listNames(DRM_DIRECTORY);
    const cardNames = drmNames
        .filter(name => /^card\d+$/.test(name))
        .sort();

    return cardNames.map(cardName => {
        const base = `${DRM_DIRECTORY}/${cardName}`;
        const vendorId = readText(`${base}/device/vendor`).toLowerCase();
        const vendor = VENDORS.get(vendorId) || 'unknown';
        const bootVga = readText(`${base}/device/boot_vga`) === '1';
        const uevent = parseUevent(`${base}/device/uevent`);
        const hasInternalDisplay = drmNames.some(name =>
            name.startsWith(`${cardName}-eDP-`) ||
            name.startsWith(`${cardName}-LVDS-`) ||
            name.startsWith(`${cardName}-DSI-`));

        return {
            id: cardName,
            vendor,
            vendorId,
            renderNode: findRenderNode(cardName),
            pciSlot: uevent.PCI_SLOT_NAME || '',
            driver: uevent.DRIVER || '',
            default: bootVga,
            integrated: hasInternalDisplay ||
                (bootVga && vendor !== 'nvidia'),
        };
    }).filter(gpu => gpu.renderNode);
}

function automaticScore(gpu) {
    let score = 0;
    if (gpu.integrated)
        score += 4;
    if (gpu.default)
        score += 2;
    if (gpu.vendor !== 'unknown')
        score += 1;
    return score;
}

export function orderGpuCandidates(gpus, mode = 'auto') {
    const available = [...gpus].sort((left, right) =>
        automaticScore(right) - automaticScore(left));
    if (mode === 'auto')
        return available;

    const preferred = available.filter(gpu => gpu.vendor === mode);
    const fallback = available.filter(gpu => gpu.vendor !== mode);
    return [...preferred, ...fallback];
}

export function getGpuEnvironment(gpu) {
    if (!gpu)
        return {};

    if (gpu.vendor === 'nvidia') {
        if (gpu.default)
            return {};
        return {
            __NV_PRIME_RENDER_OFFLOAD: '1',
            __GLX_VENDOR_LIBRARY_NAME: 'nvidia',
            __VK_LAYER_NV_optimus: 'NVIDIA_only',
        };
    }

    const environment = {};
    if (gpu.pciSlot)
        environment.DRI_PRIME = `pci-${gpu.pciSlot.replace(/[:.]/g, '_')}`;
    if (gpu.vendor === 'intel')
        environment.LIBVA_DRIVER_NAME = 'iHD';
    else if (gpu.vendor === 'amd')
        environment.LIBVA_DRIVER_NAME = 'radeonsi';
    return environment;
}
