// SPDX-License-Identifier: GPL-3.0-or-later

import Gettext from 'gettext';
import Gio from 'gi://Gio';

const directory = Gio.File.new_for_uri(import.meta.url).get_parent();
Gettext.setlocale(Gettext.LocaleCategory.ALL, '');
Gettext.bindtextdomain('jellyfish', directory.get_child('locale').get_path());
export const _ = Gettext.domain('jellyfish').gettext;
