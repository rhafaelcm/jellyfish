// SPDX-License-Identifier: GPL-3.0-or-later

import {getGpuEnvironment, orderGpuCandidates} from '../extension/gpu.js';

const intel = {
    id: 'card2',
    vendor: 'intel',
    renderNode: '/dev/dri/renderD129',
    pciSlot: '0000:00:02.0',
    default: true,
    integrated: true,
};
const nvidia = {
    id: 'card1',
    vendor: 'nvidia',
    renderNode: '/dev/dri/renderD128',
    pciSlot: '0000:01:00.0',
    default: false,
    integrated: false,
};
const amd = {
    id: 'card3',
    vendor: 'amd',
    renderNode: '/dev/dri/renderD130',
    pciSlot: '0000:03:00.0',
    default: false,
    integrated: false,
};

function assertEqual(actual, expected, message) {
    if (actual !== expected)
        throw new Error(`${message}: expected ${expected}, got ${actual}`);
}

function testAutomaticPrefersIntegrated() {
    const ordered = orderGpuCandidates([nvidia, intel, amd], 'auto');
    assertEqual(ordered[0].vendor, 'intel', 'automatic GPU');
}

function testExplicitVendorAndFallback() {
    const ordered = orderGpuCandidates([intel, nvidia, amd], 'nvidia');
    assertEqual(ordered[0].vendor, 'nvidia', 'explicit NVIDIA');
    assertEqual(ordered[1].vendor, 'intel', 'integrated fallback');
}

function testUnavailableVendorUsesAutomaticOrder() {
    const ordered = orderGpuCandidates([nvidia, intel], 'amd');
    assertEqual(ordered[0].vendor, 'intel', 'missing AMD fallback');
}

function testMesaEnvironment() {
    const environment = getGpuEnvironment(intel);
    assertEqual(environment.DRI_PRIME, 'pci-0000_00_02_0', 'Intel PCI GPU');
    assertEqual(environment.LIBVA_DRIVER_NAME, 'iHD', 'Intel VA driver');
}

function testNvidiaEnvironment() {
    const environment = getGpuEnvironment(nvidia);
    assertEqual(environment.__NV_PRIME_RENDER_OFFLOAD, '1', 'NVIDIA offload');
    assertEqual(environment.__GLX_VENDOR_LIBRARY_NAME, 'nvidia', 'NVIDIA GLX');
    assertEqual(environment.__VK_LAYER_NV_optimus, 'NVIDIA_only', 'NVIDIA Vulkan');
}

testAutomaticPrefersIntegrated();
testExplicitVendorAndFallback();
testUnavailableVendorUsesAutomaticOrder();
testMesaEnvironment();
testNvidiaEnvironment();
print('GPU tests: ok');
