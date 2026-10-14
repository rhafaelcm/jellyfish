// SPDX-License-Identifier: GPL-3.0-or-later

import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

export const JellyfishIndicator = GObject.registerClass(
class JellyfishIndicator extends PanelMenu.Button {
    _init(iconPath, settings, onPause, onPreferences) {
        super._init(0.0, 'Jellyfish');
        this._settings = settings;
        this._onPause = onPause;

        const icon = new Gio.FileIcon({file: Gio.File.new_for_path(iconPath)});
        this.add_child(new St.Icon({
            gicon: icon,
            style_class: 'system-status-icon',
        }));

        this._muteItem = new PopupMenu.PopupSwitchMenuItem(
            _('Mute'), settings.get_boolean('muted'));
        this._muteItem.connect('toggled', (_item, state) =>
            settings.set_boolean('muted', state));
        this.menu.addMenuItem(this._muteItem);

        this._pauseItem = new PopupMenu.PopupMenuItem(_('Pause'));
        this._pauseItem.connect('activate', () => this._onPause());
        this.menu.addMenuItem(this._pauseItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const preferencesItem = new PopupMenu.PopupMenuItem(_('Preferences'));
        preferencesItem.connect('activate', onPreferences);
        this.menu.addMenuItem(preferencesItem);

        this._mutedId = settings.connect('changed::muted', () =>
            this._muteItem.setToggleState(settings.get_boolean('muted')));
    }

    setPaused(paused) {
        this._pauseItem.label.text = paused ? _('Resume') : _('Pause');
    }

    destroy() {
        if (this._settings && this._mutedId)
            this._settings.disconnect(this._mutedId);
        this._mutedId = 0;
        this._settings = null;
        this._onPause = null;
        super.destroy();
    }
});
