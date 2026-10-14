// SPDX-License-Identifier: GPL-3.0-or-later

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from
    'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {cachedImages, prepareImages} from './video-images.js';

Gio._promisify(Gtk.FileDialog.prototype, 'open', 'open_finish');
Gio._promisify(Gtk.FileDialog.prototype, 'open_multiple', 'open_multiple_finish');

function videoDialog(title) {
    const filter = new Gtk.FileFilter({name: _('Video files')});
    filter.add_mime_type('video/*');
    const filters = Gio.ListStore.new(Gtk.FileFilter);
    filters.append(filter);
    return new Gtk.FileDialog({
        title,
        modal: true,
        default_filter: filter,
        filters,
    });
}

function addSwitch(group, settings, key, title, subtitle) {
    const row = new Adw.SwitchRow({title, subtitle});
    settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    group.add(row);
    return row;
}

function fileName(uri) {
    try {
        const file = Gio.File.new_for_uri(uri);
        return file.get_path() || file.get_parse_name();
    } catch (_error) {
        return uri;
    }
}

export default class JellyfishPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.set_default_size(720, 720);

        const page = new Adw.PreferencesPage({
            title: _('Video'),
            icon_name: 'video-x-generic-symbolic',
        });
        window.add(page);
        const advancedPage = new Adw.PreferencesPage({
            title: _('Advanced'),
            icon_name: 'preferences-system-symbolic',
        });
        window.add(advancedPage);
        const aboutPage = new Adw.PreferencesPage({
            title: _('About'),
            icon_name: 'help-about-symbolic',
        });
        window.add(aboutPage);
        this._addAbout(aboutPage);
        this._window = window;
        this._settings = settings;
        this._closed = false;
        this._busy = false;
        this._buttons = [];
        this._cancellable = null;
        this._settingIds = [];
        window.connect('close-request', () => {
            this._closed = true;
            this._cancellable?.cancel();
            for (const id of this._settingIds)
                settings.disconnect(id);
            this._settingIds = [];
            return false;
        });

        const sourceGroup = new Adw.PreferencesGroup({title: _('Video source')});
        page.add(sourceGroup);
        const modes = ['single', 'playlist'];
        const modeRow = new Adw.ComboRow({
            title: _('Playback mode'),
            model: Gtk.StringList.new([
                _('Single video file'),
                _('Video playlist (experimental)'),
            ]),
        });
        sourceGroup.add(modeRow);
        const syncMode = () => {
            const index = modes.indexOf(settings.get_string('video-mode'));
            modeRow.selected = index < 0 ? 0 : index;
        };
        syncMode();
        modeRow.connect('notify::selected', () =>
            settings.set_string('video-mode', modes[modeRow.selected] || 'single'));
        this._settingIds.push(settings.connect('changed::video-mode', syncMode));

        const singleGroup = new Adw.PreferencesGroup({
            title: _('Single video'),
            description: _('The file plays continuously in a loop.'),
        });
        page.add(singleGroup);
        const videoRow = new Adw.ActionRow({
            title: _('Video file'), use_markup: false, subtitle_lines: 1,
        });
        const clearButton = new Gtk.Button({
            icon_name: 'edit-clear-symbolic',
            tooltip_text: _('Clear selection'),
            valign: Gtk.Align.CENTER,
        });
        const selectButton = new Gtk.Button({
            label: _('Select…'),
            valign: Gtk.Align.CENTER,
        });
        this._buttons.push(clearButton, selectButton);
        videoRow.add_suffix(clearButton);
        videoRow.add_suffix(selectButton);
        videoRow.set_activatable_widget(selectButton);
        singleGroup.add(videoRow);
        const updateVideoRow = () => {
            const uri = settings.get_string('video-uri');
            videoRow.subtitle = uri ? fileName(uri) : _('No video selected');
            clearButton.sensitive = Boolean(uri) && !this._busy;
            if (videoRow._preview)
                videoRow.remove(videoRow._preview);
            videoRow._preview = this._preview(uri);
            videoRow.add_prefix(videoRow._preview);
        };
        updateVideoRow();
        this._settingIds.push(settings.connect('changed::video-uri', updateVideoRow));
        selectButton.connect('clicked', async () => {
            const dialog = videoDialog(_('Select a video'));
            const uri = settings.get_string('video-uri');
            if (uri) {
                const current = Gio.File.new_for_uri(uri);
                if (current.query_exists(null))
                    dialog.initial_file = current;
            }
            try {
                const file = await dialog.open(window, null);
                if (file?.is_native()) {
                    const prepared = await this._prepare([file.get_uri()]);
                    if (!this._closed && prepared.length)
                        settings.set_string('video-uri', prepared[0]);
                }
            } catch (error) {
                if (!error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED) &&
                    !error.matches?.(Gtk.DialogError, Gtk.DialogError.DISMISSED))
                    console.error(error, 'Failed to select a video');
            }
        });
        clearButton.connect('clicked', () => settings.set_string('video-uri', ''));

        const playlistGroup = new Adw.PreferencesGroup({
            title: _('Video playlist — Experimental'),
            description: _('Videos play in the order shown below.'),
        });
        page.add(playlistGroup);
        const addRow = new Adw.ActionRow({
            title: _('Add videos'),
            subtitle: _('Only local files are supported.'),
        });
        const addButton = new Gtk.Button({
            label: _('Add…'),
            valign: Gtk.Align.CENTER,
        });
        addRow.add_suffix(addButton);
        addRow.set_activatable_widget(addButton);
        playlistGroup.add(addRow);
        this._buttons.push(addButton);

        const repeatRow = new Adw.SpinRow({
            title: _('Plays per video'),
            subtitle: _('Includes the first play before advancing.'),
            adjustment: new Gtk.Adjustment({
                lower: 1,
                upper: 2147483647,
                step_increment: 1,
                page_increment: 5,
                value: settings.get_int('playlist-repeat-count'),
            }),
            numeric: true,
        });
        repeatRow.connect('notify::value', () => settings.set_int(
            'playlist-repeat-count', Math.max(1, Math.round(repeatRow.value))));
        this._settingIds.push(settings.connect('changed::playlist-repeat-count', () => {
            repeatRow.value = settings.get_int('playlist-repeat-count');
        }));
        playlistGroup.add(repeatRow);

        let itemRows = [];
        const rebuildPlaylist = () => {
            for (const row of itemRows)
                playlistGroup.remove(row);
            itemRows = [];
            const uris = settings.get_strv('playlist-uris');
            uris.forEach((uri, index) => {
                const row = new Adw.ActionRow({
                    title: `${index + 1}. ${fileName(uri).split('/').pop()}`,
                    subtitle: fileName(uri),
                    use_markup: false,
                    title_lines: 1,
                    subtitle_lines: 1,
                });
                const up = new Gtk.Button({
                    icon_name: 'go-up-symbolic',
                    tooltip_text: _('Move up'),
                    sensitive: index > 0,
                    valign: Gtk.Align.CENTER,
                });
                const down = new Gtk.Button({
                    icon_name: 'go-down-symbolic',
                    tooltip_text: _('Move down'),
                    sensitive: index < uris.length - 1,
                    valign: Gtk.Align.CENTER,
                });
                const remove = new Gtk.Button({
                    icon_name: 'user-trash-symbolic',
                    tooltip_text: _('Remove'),
                    valign: Gtk.Align.CENTER,
                });
                up.connect('clicked', () => {
                    [uris[index - 1], uris[index]] = [uris[index], uris[index - 1]];
                    settings.set_strv('playlist-uris', uris);
                });
                down.connect('clicked', () => {
                    [uris[index], uris[index + 1]] = [uris[index + 1], uris[index]];
                    settings.set_strv('playlist-uris', uris);
                });
                remove.connect('clicked', () => {
                    uris.splice(index, 1);
                    settings.set_strv('playlist-uris', uris);
                });
                row.add_prefix(this._preview(uri));
                row.add_suffix(up);
                row.add_suffix(down);
                row.add_suffix(remove);
                playlistGroup.add(row);
                itemRows.push(row);
            });
        };
        rebuildPlaylist();
        this._settingIds.push(settings.connect('changed::playlist-uris', rebuildPlaylist));
        addButton.connect('clicked', async () => {
            try {
                const files = await videoDialog(_('Add videos'))
                    .open_multiple(window, null);
                const selected = [];
                for (let index = 0; index < files.get_n_items(); index++) {
                    const file = files.get_item(index);
                    if (file.is_native())
                        selected.push(file.get_uri());
                }
                const prepared = await this._prepare(selected);
                if (!this._closed && prepared.length)
                    settings.set_strv('playlist-uris',
                        [...settings.get_strv('playlist-uris'), ...prepared]);
            } catch (error) {
                if (!error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    console.error(error, 'Failed to add videos');
            }
        });

        const updateModeVisibility = () => {
            const playlist = settings.get_string('video-mode') === 'playlist';
            singleGroup.visible = !playlist;
            playlistGroup.visible = playlist;
        };
        updateModeVisibility();
        this._settingIds.push(settings.connect('changed::video-mode', updateModeVisibility));

        const imageGroup = new Adw.PreferencesGroup({title: _('Wallpaper image')});
        page.add(imageGroup);
        addSwitch(imageGroup, settings, 'use-video-wallpaper',
            _('Use video image as wallpaper'),
            _('Update the desktop background using each video’s prepared image.'));
        const prepareRow = new Adw.ActionRow({
            title: _('Video images'),
            subtitle: _('Images are prepared when videos are added, even when wallpaper sync is off.'),
        });
        this._progressRow = prepareRow;
        this._cancelButton = new Gtk.Button({
            label: _('Cancel'),
            valign: Gtk.Align.CENTER,
            visible: false,
        });
        this._cancelButton.connect('clicked', () => this._cancellable?.cancel());
        prepareRow.add_suffix(this._cancelButton);
        const retryButton = new Gtk.Button({
            label: _('Prepare missing images'),
            valign: Gtk.Align.CENTER,
        });
        retryButton.connect('clicked', () => this._prepareExisting());
        prepareRow.add_suffix(retryButton);
        imageGroup.add(prepareRow);
        this._buttons.push(retryButton);
        this._refreshPreviews = () => {
            updateVideoRow();
            rebuildPlaylist();
        };

        const behaviorGroup = new Adw.PreferencesGroup({
            title: _('Behavior'),
            description: _('Resume in the panel menu overrides current automatic pauses.'),
        });
        advancedPage.add(behaviorGroup);
        addSwitch(behaviorGroup, settings, 'show-panel-icon',
            _('Show panel icon'),
            _('Show Mute, Pause/Resume, and Preferences in the panel.'));
        addSwitch(behaviorGroup, settings, 'pause-on-maximized',
            _('Pause under maximized or fullscreen windows'),
            _('Freeze only the covered monitor in the current workspace.'));
        const batteryRow = addSwitch(behaviorGroup, settings,
            'pause-on-low-battery', _('Pause on low battery'),
            _('Only applies while the battery is discharging.'));
        const thresholdRow = new Adw.SpinRow({
            title: _('Battery threshold'),
            adjustment: new Gtk.Adjustment({
                lower: 1,
                upper: 100,
                step_increment: 1,
                page_increment: 5,
                value: settings.get_int('low-battery-threshold'),
            }),
            numeric: true,
        });
        thresholdRow.connect('notify::value', () => settings.set_int(
            'low-battery-threshold', Math.round(thresholdRow.value)));
        behaviorGroup.add(thresholdRow);
        const updateThreshold = () => {
            thresholdRow.sensitive = batteryRow.active;
        };
        updateThreshold();
        batteryRow.connect('notify::active', updateThreshold);
        addSwitch(behaviorGroup, settings, 'pause-on-media-playback',
            _('Pause when another player plays video'),
            _('Use MPRIS; ignore audio and unidentified media.'));
        addSwitch(behaviorGroup, settings, 'debug-logging',
            _('Enable logging'), _('Show detailed diagnostics in the journal.'));

        const delayRow = new Adw.SpinRow({
            title: _('Startup delay (ms)'),
            subtitle: _('Set to zero to start immediately.'),
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 4294967295,
                step_increment: 100,
                page_increment: 1000,
                value: settings.get_uint('startup-delay-ms'),
            }),
            numeric: true,
        });
        delayRow.connect('notify::value', () => settings.set_uint(
            'startup-delay-ms', Math.max(0, Math.round(delayRow.value))));
        behaviorGroup.add(delayRow);

        const performanceGroup = new Adw.PreferencesGroup({
            title: _('Performance'),
            description: _('An integrated GPU reduces power use and copies between GPUs.'),
        });
        advancedPage.add(performanceGroup);
        const gpuModes = ['auto', 'intel', 'nvidia', 'amd'];
        const gpuRow = new Adw.ComboRow({
            title: _('Graphics processor'),
            subtitle: _('A dedicated GPU does not turn off the GPU used by GNOME Shell.'),
            model: Gtk.StringList.new([
                _('Automatic (prefer integrated GPU)'), 'Intel', 'NVIDIA', 'AMD',
            ]),
        });
        const updateGpu = () => {
            const index = gpuModes.indexOf(settings.get_string('gpu-mode'));
            gpuRow.selected = index < 0 ? 0 : index;
        };
        updateGpu();
        gpuRow.connect('notify::selected', () => settings.set_string(
            'gpu-mode', gpuModes[gpuRow.selected] || 'auto'));
        this._settingIds.push(settings.connect('changed::gpu-mode', updateGpu));
        performanceGroup.add(gpuRow);

        const audioGroup = new Adw.PreferencesGroup({title: _('Audio')});
        page.add(audioGroup);
        const muteRow = addSwitch(audioGroup, settings, 'muted', _('Mute'),
            _('Mute the video without changing the volume.'));
        const volumeRow = new Adw.ActionRow({title: _('Volume')});
        const volumeScale = Gtk.Scale.new_with_range(
            Gtk.Orientation.HORIZONTAL, 0, 100, 1);
        volumeScale.valign = Gtk.Align.CENTER;
        volumeScale.hexpand = true;
        volumeScale.draw_value = true;
        volumeScale.set_size_request(320, -1);
        volumeScale.set_value(settings.get_int('volume'));
        volumeScale.connect('value-changed', () => settings.set_int(
            'volume', Math.round(volumeScale.get_value())));
        this._settingIds.push(settings.connect('changed::volume', () =>
            volumeScale.set_value(settings.get_int('volume'))));
        const updateVolume = () => {
            volumeRow.sensitive = !muteRow.active;
        };
        updateVolume();
        muteRow.connect('notify::active', updateVolume);
        volumeRow.add_suffix(volumeScale);
        volumeRow.set_activatable_widget(volumeScale);
        audioGroup.add(volumeRow);

        window._jellyfishSettings = settings;
        this._prepareExisting();
    }

    _preview(uri) {
        const images = uri && cachedImages(uri);
        const picture = images
            ? Gtk.Picture.new_for_filename(images.thumbnail)
            : new Gtk.Image({icon_name: 'video-x-generic-symbolic', pixel_size: 32});
        picture.set_size_request(96, 54);
        picture.valign = Gtk.Align.CENTER;
        picture.halign = Gtk.Align.CENTER;
        if (images) {
            picture.content_fit = Gtk.ContentFit.CONTAIN;
            picture.add_css_class('card');
        }
        return picture;
    }

    async _prepare(uris) {
        if (this._busy || this._closed || !uris.length)
            return [];
        this._busy = true;
        this._cancellable = new Gio.Cancellable();
        for (const button of this._buttons)
            button.sensitive = false;
        this._cancelButton.visible = true;
        const prepared = [];
        const failed = [];
        try {
            for (let index = 0; index < uris.length; index++) {
                if (this._cancellable.is_cancelled())
                    break;
                this._progressRow.subtitle = _('Preparing image %d of %d…')
                    .format(index + 1, uris.length);
                try {
                    await prepareImages(this.path, uris[index], this._cancellable);
                    prepared.push(uris[index]);
                } catch (error) {
                    if (!this._cancellable.is_cancelled()) {
                        failed.push(fileName(uris[index]));
                        console.error(error, 'Failed to prepare video images');
                    }
                }
            }
            if (!this._closed && failed.length) {
                const dialog = new Adw.AlertDialog({
                    heading: _('Some video images could not be prepared'),
                    body: _('Check that these files contain a supported video and try again:') +
                        '\n\n' + failed.join('\n'),
                });
                dialog.add_response('close', _('Close'));
                dialog.present(this._window);
            }
            // Cancellation never commits a partially prepared selection.
            return this._cancellable.is_cancelled() ? [] : prepared;
        } finally {
            this._busy = false;
            if (!this._closed) {
                for (const button of this._buttons)
                    button.sensitive = true;
                this._cancelButton.visible = false;
                this._progressRow.subtitle = _('Images are prepared when videos are added, even when wallpaper sync is off.');
                this._refreshPreviews();
                if (prepared.length)
                    this._settings.set_string('video-images-revision', GLib.uuid_string_random());
            }
            this._cancellable = null;
        }
    }

    _prepareExisting() {
        const uris = [...new Set([
            this._settings.get_string('video-uri'),
            ...this._settings.get_strv('playlist-uris'),
        ])].filter(uri => uri && !cachedImages(uri));
        return this._prepare(uris);
    }

    _addAbout(page) {
        const group = new Adw.PreferencesGroup();
        page.add(group);
        const box = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 16,
            margin_top: 24,
            margin_bottom: 24,
        });
        const logo = Gtk.Picture.new_for_filename(GLib.build_filenamev([
            this.path, 'data', 'icons', 'hicolor', 'scalable', 'apps',
            'io.github.jellyfish.svg',
        ]));
        logo.set_size_request(128, 160);
        logo.halign = Gtk.Align.CENTER;
        logo.content_fit = Gtk.ContentFit.CONTAIN;
        box.append(logo);
        const title = new Gtk.Label({label: 'Jellyfish'});
        title.add_css_class('title-1');
        box.append(title);
        box.append(new Gtk.Label({
            label: _('Version %s').format(String(this.metadata.version)),
        }));
        box.append(new Gtk.Label({
            label: _('Video wallpapers for GNOME Shell on Wayland.'),
            wrap: true,
            justify: Gtk.Justification.CENTER,
        }));
        box.append(new Gtk.Label({
            label: _('Free software licensed under the GNU General Public License, version 3 or later.'),
            wrap: true,
            justify: Gtk.Justification.CENTER,
            max_width_chars: 55,
        }));
        box.append(new Gtk.Label({
            label: _('This program comes with absolutely no warranty.'),
            wrap: true,
            justify: Gtk.Justification.CENTER,
        }));
        box.append(Gtk.LinkButton.new_with_label(
            'https://github.com/rhafaelcm/jellyfish', _('Project on GitHub')));
        box.append(Gtk.LinkButton.new_with_label(
            'https://www.gnu.org/licenses/gpl-3.0.html', _('Read the license')));
        group.add(box);
    }
}
