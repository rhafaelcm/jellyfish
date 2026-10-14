UUID := jellyfish@rhafaelcm.github.io
SCHEMA_DIR := extension/schemas
SCHEMA := $(SCHEMA_DIR)/org.gnome.shell.extensions.jellyfish.gschema.xml
PACK_SCHEMA := schemas/org.gnome.shell.extensions.jellyfish.gschema.xml
PACKAGE := dist/$(UUID).shell-extension.zip
EXTRA_SOURCES := \
	--extra-source=background.js \
	--extra-source=background-state.js \
	--extra-source=image-worker.js \
	--extra-source=image-decoding.js \
	--extra-source=image-errors.js \
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

# name, version, and url come from extension/metadata.json.
define READ_METADATA
package_name=$$(jq -r '.name // empty' extension/metadata.json); \
package_version=$$(jq -r '.version // empty' extension/metadata.json); \
package_url=$$(jq -r '.url // empty' extension/metadata.json); \
if [ -z "$$package_name" ] || [ -z "$$package_version" ] || [ -z "$$package_url" ]; then \
	echo 'extension/metadata.json must define name, version, and url.' >&2; \
	exit 1; \
fi; \
bugs_address=$${package_url%/}/issues
endef

# Rewrites catalog headers that must follow the metadata above.
define APPLY_CATALOG_HEADER
sed \
	-e "s|^\"Project-Id-Version: .*\\\\n\"|\"Project-Id-Version: $$package_name $$package_version\\\\n\"|" \
	-e "s|^\"Report-Msgid-Bugs-To: .*\\\\n\"|\"Report-Msgid-Bugs-To: $$bugs_address\\\\n\"|"
endef

define REQUIRE_CATALOG_HEADER
grep -F -q -x "\"Project-Id-Version: $$package_name $$package_version\\n\"" "$$catalog_file" && \
grep -F -q -x "\"Report-Msgid-Bugs-To: $$bugs_address\\n\"" "$$catalog_file" || { \
	echo "Could not apply catalog headers from extension/metadata.json to $$catalog_file." >&2; \
	exit 1; \
}
endef

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
	gjs -m tests/test-image-decoding.js
	gjs -m extension/player.js --check
	gjs -m extension/image-worker.js --check

translations:
	@command -v msgfmt >/dev/null || { echo 'Install GNU gettext (msgfmt and xgettext) to build Jellyfish.'; exit 1; }
	@command -v jq >/dev/null || { echo 'Install jq to read extension/metadata.json.'; exit 1; }
	@$(READ_METADATA); \
	for catalog in po/*.po; do \
		language=$$(basename "$$catalog" .po); \
		mkdir -p "extension/locale/$$language/LC_MESSAGES"; \
		tmp=$$(mktemp); \
		$(APPLY_CATALOG_HEADER) "$$catalog" > "$$tmp" || exit 1; \
		catalog_file="$$tmp"; \
		$(REQUIRE_CATALOG_HEADER); \
		msgfmt --check --check-format -o "extension/locale/$$language/LC_MESSAGES/jellyfish.mo" "$$tmp" || exit 1; \
		rm -f "$$tmp"; \
	done

pot:
	@command -v xgettext >/dev/null || { echo 'Install GNU gettext (msgfmt and xgettext) to build Jellyfish.'; exit 1; }
	@command -v msgmerge >/dev/null || { echo 'Install GNU gettext (msgfmt and xgettext) to build Jellyfish.'; exit 1; }
	@command -v jq >/dev/null || { echo 'Install jq to read extension/metadata.json.'; exit 1; }
	@$(READ_METADATA); \
	xgettext --language=JavaScript --from-code=UTF-8 --keyword=_ \
		--package-name="$$package_name" \
		--package-version="$$package_version" \
		--copyright-holder="$$package_name contributors" \
		--msgid-bugs-address="$$bugs_address" \
		--output=po/jellyfish.pot extension/*.js && \
	for catalog in po/*.po; do \
		merged=$$(mktemp); \
		tmp=$$(mktemp); \
		msgmerge --quiet -o "$$merged" "$$catalog" po/jellyfish.pot || exit 1; \
		$(APPLY_CATALOG_HEADER) "$$merged" > "$$tmp" || exit 1; \
		rm -f "$$merged"; \
		catalog_file="$$tmp"; \
		$(REQUIRE_CATALOG_HEADER); \
		mv "$$tmp" "$$catalog"; \
	done

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

