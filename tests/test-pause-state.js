// SPDX-License-Identifier: GPL-3.0-or-later

import {GLOBAL_SCOPE, PauseState} from '../extension/pause-state.js';

function assert(value, message) {
    if (!value)
        throw new Error(message);
}

const state = new PauseState();
state.setAutomatic(new Map([['window:1', 0]]));
assert(state.paused, 'one frozen monitor is an effective pause');
assert(!state.shouldPausePipeline(2), 'one of two monitors must not pause pipeline');
assert(state.getPausedMonitors().has(0), 'monitor zero must be frozen');

state.setAutomatic(new Map([['window:1', 0], ['window:2', 1]]));
assert(state.shouldPausePipeline(2), 'all frozen monitors must pause pipeline');
state.forceContinue();
assert(!state.paused, 'force continue must suppress current reasons');

state.setAutomatic(new Map([
    ['window:1', 0],
    ['window:2', 1],
    ['media:new', GLOBAL_SCOPE],
]));
assert(state.shouldPausePipeline(2), 'a new global reason must pause again');
state.setAutomatic(new Map());
assert(!state.paused, 'inactive reasons must clear suppression');

state.pauseManually();
assert(state.shouldPausePipeline(2), 'manual pause must pause pipeline');
state.forceContinue();
assert(!state.paused, 'continue must clear manual pause');
print('pause state tests: ok');
