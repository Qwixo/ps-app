#!/bin/bash
# Installs a PS web build (web/dist-ps) where PS reads it, without touching the app
# itself, so macOS keeps PS's Accessibility permission. Old hashed files are kept so an open PS
# window never breaks; index.html goes in last. An open PS lights its refresh button.
set -euo pipefail
SRC="${1:?usage: install-web.sh <dist-ps folder>}"
DEST="$HOME/Library/Application Support/PS/web"
mkdir -p "$DEST"
rsync -a --exclude index.html "$SRC"/ "$DEST"/
cp "$SRC/index.html" "$DEST/index.html.new"
mv "$DEST/index.html.new" "$DEST/index.html"
echo "PS web files installed: $(cat "$DEST/version.json")"
