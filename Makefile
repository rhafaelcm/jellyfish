UUID := jellyfish@rhafaelcm.github.io
SCHEMA_DIR := extension/schemas
SCHEMA := $(SCHEMA_DIR)/org.gnome.shell.extensions.jellyfish.gschema.xml
PACK_SCHEMA := schemas/org.gnome.shell.extensions.jellyfish.gschema.xml
PACKAGE := dist/$(UUID).shell-extension.zip
EXTRA_SOURCES := \
	--extra-source=background.js \
	--extra-source=background-state.js \
	--extra-source=image-worker.js \
	--extra-source=video-images.js \
	--extra-source=i18n.js \
	--extra-source=locale \
	--extra-source=geometry.js \
	--extra-source=gpu.js \
	--extra-source=indicator.js \
	--extra-source=media.js \
	--extra-source=monitors.js \
	--extra-source=pause-state.js \
	--extra-source=player-process.js \
	--extra-source=player.js \
	--extra-source=playlist.js \
	--extra-source=policies.js \
	--extra-source=data \
	--extra-source=wallpaper.js

.PHONY: check check-images translations pot pack install enable disable prefs clean

check: translations
	jq empty extension/metadata.json
	glib-compile-schemas --strict --dry-run $(SCHEMA_DIR)
	eslint extension/*.js tests/*.js
	gjs -m tests/test-geometry.js
	gjs -m tests/test-gpu.js
	gjs -m tests/test-monitors.js
	gjs -m tests/test-pause-state.js
	gjs -m tests/test-playlist.js
	gjs -m tests/test-media.js
	gjs -m tests/test-background-state.js
	gjs -m tests/test-video-images.js
	gjs -m extension/player.js --check
	gjs -m extension/image-worker.js --check

translations:
	@command -v msgfmt >/dev/null || { echo 'Install GNU gettext (msgfmt and xgettext) to build Jellyfish.'; exit 1; }
	@for catalog in po/*.po; do \
		language=$$(basename "$$catalog" .po); \
		mkdir -p "extension/locale/$$language/LC_MESSAGES"; \
		msgfmt --check --check-format -o "extension/locale/$$language/LC_MESSAGES/jellyfish.mo" "$$catalog" || exit 1; \
	done

pot:
	xgettext --language=JavaScript --from-code=UTF-8 --keyword=_ \
		--package-name=Jellyfish --package-version=8 \
		--copyright-holder='Jellyfish contributors' \
		--msgid-bugs-address=https://github.com/rhafaelcm/jellyfish/issues \
		--output=po/jellyfish.pot extension/*.js

check-images:
	gjs -m tests/test-image-worker.js

pack: check
	mkdir -p dist
	gnome-extensions pack --force --out-dir=dist \
		--schema=$(PACK_SCHEMA) $(EXTRA_SOURCES) extension
	zip -q -j $(PACKAGE) LICENSE

install: pack
	gnome-extensions install --force $(PACKAGE)

enable:
	gnome-extensions enable $(UUID)

disable:
	gnome-extensions disable $(UUID)

prefs:
	gnome-extensions prefs $(UUID)

clean:
	rm -f $(PACKAGE) extension/schemas/gschemas.compiled

