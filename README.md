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

Image preparation uses GStreamer software decoders in a separate process, with
frames kept in system memory before JPEG encoding. Install the GStreamer libav
plugins for software decoding of formats such as H.264 and H.265/HEVC. This
short-lived preparation step does not change the GPU policy used for video
playback. FFmpeg is not required.
Package names vary by distribution; install the libraries, bindings, plugins,
and codecs above. Verify the runtime dependencies with:

```bash
gjs -m extension/player.js --check
gjs -m extension/image-worker.js --check
```

Building requires `make`, `jq`, `eslint`, `glib-compile-schemas`, GNU `gettext`
(`msgfmt` and `xgettext`), `zip`, and `gnome-extensions`. The image integration test
also uses `gst-launch-1.0`, `vp8enc`, `webmmux`, `x265enc`, `h265parse`, and
`mp4mux` to exercise VP8/WebM and H.265/MP4 image preparation.

### Install dependencies

These commands target a regular GNOME installation with distribution packages.
Check `gnome-shell --version` first: **Jellyfish currently supports GNOME Shell
50 on Wayland only**. Installing the packages below does not upgrade an older
Shell to version 50. In particular, [Debian 13 (Trixie)](https://packages.debian.org/trixie/gnome/gnome-shell)
ships GNOME Shell 48;
use a Debian release that actually provides GNOME Shell 50. Check the version
again after any distribution upgrade.

The first command for each distribution installs runtime dependencies. The
second installs tools needed to build and install from this repository.

#### Ubuntu 26.04

```bash
sudo apt update
sudo apt install \
  gjs gir1.2-gtk-4.0 gir1.2-adw-1 gir1.2-gstreamer-1.0 \
  gir1.2-gst-plugins-base-1.0 gstreamer1.0-tools \
  gstreamer1.0-plugins-base gstreamer1.0-plugins-good \
  gstreamer1.0-plugins-bad gstreamer1.0-plugins-extra \
  gstreamer1.0-gl gstreamer1.0-gtk4 gstreamer1.0-libav upower
sudo apt install make jq eslint gettext libglib2.0-bin zip
```

#### Debian with GNOME Shell 50

```bash
sudo apt update
sudo apt install \
  gjs gir1.2-gtk-4.0 gir1.2-adw-1 gir1.2-gstreamer-1.0 \
  gir1.2-gst-plugins-base-1.0 gstreamer1.0-tools \
  gstreamer1.0-plugins-base gstreamer1.0-plugins-good \
  gstreamer1.0-plugins-bad gstreamer1.0-gl \
  gstreamer1.0-gtk4 gstreamer1.0-libav upower
sudo apt install make jq eslint gettext libglib2.0-bin zip
```

#### Fedora with GNOME Shell 50

```bash
sudo dnf install \
  gjs gtk4 libadwaita gstreamer1 gstreamer1-plugins-base \
  gstreamer1-plugins-good gstreamer1-plugins-bad-free \
  gstreamer1-plugin-gtk4 gstreamer1-plugin-libav upower
sudo dnf install make jq eslint gettext glib2 zip
```

#### Arch Linux with GNOME Shell 50

```bash
sudo pacman -Syu
sudo pacman -S --needed \
  gjs gtk4 libadwaita gstreamer gst-plugins-base \
  gst-plugins-good gst-plugins-bad gst-plugin-gtk4 gst-libav upower
sudo pacman -S --needed make jq eslint gettext glib2 zip
```

`gettext` supplies `msgfmt` and `xgettext`. The GLib packages supply
`glib-compile-schemas`; `gnome-extensions` comes with GNOME Shell. These commands
cover the common software decoders, including GStreamer libav. GPU drivers and
additional codecs vary by hardware and video format. On Intel GPUs, install a
VA-API driver so hardware acceleration can be used — for example
`intel-media-va-driver` on Debian and Ubuntu, or `intel-media-driver` on Fedora
and Arch. If a video still cannot be decoded, check the available elements with
`gst-inspect-1.0 avdec_h265` or the decoder matching your file. The optional
`make check-images` test also requires `x265enc`, which may need an additional
codec package on some distributions.

Package names were checked against the [Debian package directory](https://packages.debian.org/search?keywords=gstreamer1.0-gtk4),
[Fedora package directory](https://packages.fedoraproject.org/pkgs/rust-gst-plugin-gtk4/gstreamer1-plugin-gtk4/),
and [Arch package directory](https://archlinux.org/packages/extra/x86_64/gst-plugin-gtk4/).

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
Preparation runs asynchronously with progress and cancellation. Failures are
reported per file, distinguishing missing codecs, decoding, JPEG conversion,
timeouts, and cache write errors. Successfully prepared playlist items can still
be added. Canceling preparation leaves the selection unchanged.

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

`Project-Id-Version` and `Report-Msgid-Bugs-To` are filled from the `name`,
`version`, and `url` fields in `extension/metadata.json`.

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
prove that the GPU driver supports the selected codec. Intel and AMD typically
use VA-API drivers; on Intel, install a driver such as `intel-media-va-driver`.
NVIDIA uses NVDEC with the `nvcodec` plugin. Selecting a dedicated GPU does not
disable the GPU that GNOME uses to compose the desktop.

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

