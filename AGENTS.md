# Repository Guidelines

## Project Structure & Module Organization

Jellyfish is a GNOME Shell 50 extension for Wayland. Runtime code lives in `extension/`: `extension.js` coordinates lifecycle, `wallpaper.js` owns the private Shell background integration, and `player.js` is the separate GTK/GStreamer process. Preferences and GSettings are in `prefs.js` and `schemas/`. Pure logic tests belong in `tests/`; generated extension archives belong in `dist/` and must not be committed.

Keep GTK imports out of the Shell-side modules. The Shell uses Clutter, while the helper process owns GTK and GStreamer. Isolate any use of private GNOME APIs, especially `Main.layoutManager._backgroundGroup`, in `wallpaper.js`.

## Build, Test, and Development Commands

- `make check` — validate metadata and schemas, lint JavaScript, test geometry, and verify GStreamer elements.
- `make pack` — create `dist/jellyfish@rhafaelcm.github.io.shell-extension.zip`.
- `make install` — package and install the extension for the current user.
- `make enable`, `make disable`, `make prefs` — control or configure the installed extension.
- `journalctl --user -f -o cat /usr/bin/gnome-shell` — inspect extension and player diagnostics.

## Coding Style & Naming Conventions

Use four-space indentation, semicolons, single quotes, and GNOME-compatible ES modules. Use `camelCase` for values and functions, `PascalCase` for classes, `UPPER_SNAKE_CASE` for constants, and lowercase kebab-case filenames such as `player-process.js`. Spawn processes with argument arrays; never construct shell commands from settings or file paths.

## Testing Guidelines

Add deterministic GJS tests under `tests/` for logic independent of GNOME Shell. Run `make check` before every submission. Manually verify enable/disable cycles, video changes, looping, volume and mute, monitor hotplug, DING interaction, and both hardware decoding and software fallback in a GNOME 50 Wayland session.

## Commit & Pull Request Guidelines

Use concise imperative subjects, for example `Add decoder fallback warning`. Keep commits focused. Pull requests should explain behavior changes, identify affected private GNOME APIs, list tested GNOME/GStreamer/GPU versions, and include manual test steps. Add screenshots or a short recording for visible changes and call out new runtime dependencies.
