// SPDX-License-Identifier: GPL-3.0-or-later

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';

const STOP_TIMEOUT_MS = 1500;

export class PlayerProcess {
    constructor(onLine, onExit) {
        this._onLine = onLine;
        this._onExit = onExit;
        this._process = null;
        this._waylandClient = null;
        this._output = null;
        this._input = null;
        this._outputCancellable = null;
        this._stopTimeoutId = 0;
        this._stopping = false;
        this._ready = false;
        this._pendingPaused = false;
    }

    start(argv, cwd, environment = {}) {
        if (this._process)
            throw new Error('The Jellyfish player is already running');

        const launcher = new Gio.SubprocessLauncher({
            flags: Gio.SubprocessFlags.STDIN_PIPE |
                Gio.SubprocessFlags.STDOUT_PIPE |
                Gio.SubprocessFlags.STDERR_MERGE,
        });
        launcher.set_cwd(cwd);
        for (const [name, value] of Object.entries(environment))
            launcher.setenv(name, value, true);

        try {
            this._waylandClient = Meta.WaylandClient.new_subprocess(
                global.context, launcher, argv);
            this._process = this._waylandClient.get_subprocess();
        } finally {
            if (launcher.close)
                launcher.close();
        }

        this._stopping = false;
        this._ready = false;
        this._input = this._process.get_stdin_pipe();
        this._outputCancellable = new Gio.Cancellable();
        this._output = Gio.DataInputStream.new(
            this._process.get_stdout_pipe());
        this._readOutput();
        this._process.wait_async(null, (process, result) => {
            let error = null;
            try {
                process.wait_finish(result);
            } catch (caughtError) {
                error = caughtError;
            }

            const expected = this._stopping;
            this._clearStopTimeout();
            if (this._outputCancellable)
                this._outputCancellable.cancel();
            this._output = null;
            this._input = null;
            this._outputCancellable = null;
            this._process = null;
            this._waylandClient = null;
            this._stopping = false;
            this._onExit(expected, error);
        });
    }

    markReady() {
        this._ready = true;
        this._writeCommand({
            type: 'set-paused',
            paused: this._pendingPaused,
        });
    }

    setPaused(paused) {
        this._pendingPaused = paused;
        if (this._ready)
            this._writeCommand({type: 'set-paused', paused});
    }

    ownsWindow(window) {
        if (!this._waylandClient || !this._process)
            return false;

        try {
            return this._waylandClient.owns_window(window);
        } catch (error) {
            console.error(error, 'Failed to identify the Jellyfish window');
            return false;
        }
    }

    hideFromWindowList(window) {
        if (!this._waylandClient)
            return;

        if (window.hide_from_window_list)
            window.hide_from_window_list();
        else
            this._waylandClient.hide_from_window_list(window);
    }

    stop() {
        if (!this._process || this._stopping)
            return;

        this._stopping = true;
        try {
            this._process.send_signal(15);
        } catch (error) {
            console.error(error, 'Failed to stop the Jellyfish player');
            this._process.force_exit();
            return;
        }

        this._stopTimeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT, STOP_TIMEOUT_MS, () => {
                this._stopTimeoutId = 0;
                if (this._process)
                    this._process.force_exit();
                return GLib.SOURCE_REMOVE;
            });
    }

    destroy() {
        this._onLine = () => {};
        this._onExit = () => {};
        this.stop();
    }

    _writeCommand(command) {
        if (!this._input || this._stopping)
            return;
        try {
            const bytes = new TextEncoder().encode(
                `${JSON.stringify(command)}\n`);
            this._input.write_all(bytes, null);
        } catch (error) {
            console.error(error, 'Failed to control the Jellyfish player');
        }
    }

    _clearStopTimeout() {
        if (!this._stopTimeoutId)
            return;
        GLib.Source.remove(this._stopTimeoutId);
        this._stopTimeoutId = 0;
    }

    _readOutput() {
        if (!this._output || !this._outputCancellable)
            return;

        this._output.read_line_async(
            GLib.PRIORITY_DEFAULT,
            this._outputCancellable,
            (stream, result) => {
                try {
                    const [line, length] = stream.read_line_finish_utf8(result);
                    if (!line && length === 0)
                        return;
                    this._onLine(line);
                    this._readOutput();
                } catch (error) {
                    if (!error.matches(
                        Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        console.error(error, 'Failed to read player output');
                }
            }
        );
    }
}

