<p align="center">
  <img src="extension/data/icons/hicolor/scalable/apps/io.github.jellyfish.svg" width="144" height="144" alt="Jellyfish logo">
</p>

# Jellyfish

Video wallpapers for **GNOME Shell 50 on Wayland**. Play a local video or an
ordered playlist across your monitors, with configurable audio, hardware
decoding, and automatic pause rules.

Jellyfish integrates into the Shell background layer, so Desktop Icons NG (DING)
remains visible and interactive. The panel icon follows your system theme.

## Features

- Single-file looping and an experimental playlist with reordering and repeat counts.
- Video thumbnails and wallpaper images prepared when videos are added.
- A static desktop background that follows the current video.
- Volume, mute, and a panel menu with Pause/Resume and Preferences.
- Automatic pauses for covered monitors, low battery, and other video players.
- GPU selection with hardware-decoding fallback and a final software fallback.
- English interface with a Brazilian Portuguese translation (`pt_BR`).

## Requirements

- GNOME Shell 50 in a Wayland session; X11 and XWayland are not supported.
- GJS, GTK 4, Libadwaita, GStreamer (including GstVideo), and their GObject
  Introspection bindings.
- GStreamer elements: `playbin3`, `glsinkbin`, `gtk4paintablesink`, `fakesink`,
  `videoconvert`, `videoscale`, `jpegenc`, and decoders for your video formats.
- GPU drivers appropriate for hardware decoding on your machine.
- UPower for the low-battery pause rule (normally included with GNOME).

Image preparation uses GStreamer in a separate process. FFmpeg is not required.
Package names vary by distribution; install the libraries, bindings, plugins,
and codecs above. Verify the runtime dependencies with:

```bash
gjs -m extension/player.js --check
gjs -m extension/image-worker.js --check
```

Building requires `make`, `jq`, `eslint`, `glib-compile-schemas`, GNU `gettext`
(`msgfmt` and `xgettext`), `zip`, and `gnome-extensions`. The image integration test
also uses `gst-launch-1.0`, `vp8enc`, and `webmmux` to create a test video.

## Build and install

```bash
make check
make pack
make install
make enable
make prefs
```

The package is written to
`dist/jellyfish@rhafaelcm.github.io.shell-extension.zip`. Build artifacts are not
committed. If GNOME does not discover a newly installed extension immediately,
log out and back in before enabling it. For updates, disable the extension before
installing; a new login may be needed to reload Shell modules.

### Upgrading from the previous UUID

Disable the old extension before enabling the new one:

```bash
gnome-extensions disable jellyfish@rhafaelcm.github.io
make install
make enable
```

The GSettings schema and path remain unchanged, preserving existing videos and
preferences. Do not enable both UUIDs simultaneously. Open Preferences after
upgrading to prepare images for previously configured videos.

## Preferences

### Video

Choose a single video or an experimental playlist. Each selection prepares a
full-size JPEG and a small thumbnail before adding the video to the active source.
Preparation runs asynchronously with progress and cancellation. Unsupported files
are reported; successfully prepared playlist items can still be added. Canceling
preparation leaves the selection unchanged.

Use the arrows to reorder playlist items. Each video plays five times by default
(minimum one) before advancing; the playlist loops back to its beginning. Missing
or unplayable items are skipped when another usable item remains.

**Use video image as wallpaper** is enabled by default. It updates the light and
dark desktop backgrounds whenever a video is loaded, using its prepared image.
The original background is restored when you disable the option, disable the
extension, or clear the active source. Changing the desktop background manually
suspends synchronization until you turn the option off and on again.

Images are prepared even when synchronization is off. They are cached under
`$XDG_CACHE_HOME/jellyfish` (normally `~/.cache/jellyfish`) and reused while the
source URI, size, and modification time remain unchanged. Opening Preferences
prepares missing or outdated images; **Prepare missing images** retries failures.
No frame extraction runs during video transitions. If images are unavailable,
playback continues with the original desktop background.

Volume and Mute control the video audio. Clearing the active source restores the
normal desktop background.

### Advanced

- **Graphics processor:** automatic selection prefers an integrated GPU. If a GPU
  cannot decode a video, Jellyfish tries another GPU and then software decoding.
- **Pause under maximized or fullscreen windows:** freeze only the covered monitor
  in the current workspace. Pause the pipeline when all monitors are covered.
- **Pause on low battery:** pause while discharging at or below the threshold (20%
  by default).
- **Pause when another player plays video:** observe MPRIS players whose metadata
  identifies video; music and unidentified media do not trigger the rule.
- **Startup delay:** wait 1,000 ms before starting the player; zero starts immediately.
- **Enable logging:** include detailed diagnostics in the journal. Critical errors
  and warnings are always logged.

Resume in the panel menu overrides current automatic pause conditions. A new
condition can pause playback again.

### About

View the project logo, installed version, license, warranty notice, and links to
the [GitHub repository](https://github.com/rhafaelcm/jellyfish) and license text.

## Translations

English is the source language. GNOME selects Brazilian Portuguese automatically
for a `pt_BR` session and falls back to English for untranslated strings. Technical
logs, source comments, and this README are in English.

```bash
make pot           # Update the translation template
make translations  # Validate and compile translations
```

Translations live in `po/`; compiled catalogs are included in the package. To
contribute a language, create its `.po` file from `po/jellyfish.pot`, translate the
messages, and run `make check` and `make pack`.

## Diagnostics and development

```bash
make check
make check-images
journalctl --user -f -o cat /usr/bin/gnome-shell
```

Enable logging to inspect GPU selection, decoder status, video caps, and monitor
attachment. `hardware=true` indicates a hardware decoder; `DMABuf` or `GLMemory`
in video caps indicates a suitable memory path. A plugin's presence alone does not
prove that the GPU driver supports the selected codec. Intel/AMD typically use
VA-API drivers; NVIDIA uses NVDEC with the `nvcodec` plugin. Selecting a dedicated
GPU does not disable the GPU that GNOME uses to compose the desktop.

Runtime code is in `extension/`. The Shell side uses Clutter and never imports
GTK. A separate GTK/GStreamer player shares one decoded video across monitor
windows. Private background integration, including
`Main.layoutManager._backgroundGroup`, stays in `wallpaper.js`. Image preparation
runs in another short-lived GStreamer process, invoked only by Preferences.

Before submitting changes, run the checks and manually verify enable/disable,
single files, playlists, audio, wallpaper restoration, monitor hotplug, DING,
hardware decoding, and software fallback in GNOME 50/Wayland. Include the tested
GNOME, GStreamer, and GPU versions in bug reports and pull requests.

## Limitations

- Only local video files are supported; playlists remain experimental.
- MPRIS players without identifiable video metadata cannot trigger automatic pauses.
- Videos changed on disk require image preparation again in Preferences.
- Cached images consume disk space and can be removed while Jellyfish is disabled;
  prepare them again in Preferences afterward.
- Private GNOME Shell APIs may require adaptation for future Shell versions.

## License

Jellyfish is free software licensed under the **GNU General Public License,
version 3 or (at your option) any later version**. See [LICENSE](LICENSE).

**This program comes with absolutely no warranty**, including the implied
warranties of merchantability or fitness for a particular purpose.

