#!/usr/bin/env bash
# Build Linux bundles (.deb, .AppImage, .rpm) en local.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v npm >/dev/null 2>&1; then
  echo "npm est requis." >&2
  exit 1
fi

[ -d node_modules ] || npm install

npm run build -- --bundles deb,appimage,rpm
echo
echo "Bundles dans src-tauri/target/release/bundle/"
