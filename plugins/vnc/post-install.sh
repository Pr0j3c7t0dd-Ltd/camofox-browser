#!/bin/sh
# Install noVNC 1.5.0 from GitHub releases.
# The apt package (novnc) ships 1.3.x which lacks working clipboard support.
# noVNC 1.4+ uses the browser Clipboard API and has a proper paste UI.

set -e

NOVNC_VERSION="1.5.0"
NOVNC_DIR="/usr/share/novnc"
TMP="/tmp/novnc-install"

echo "[vnc/post-install] installing noVNC ${NOVNC_VERSION} from GitHub"

mkdir -p "$TMP"
curl -fsSL "https://github.com/novnc/noVNC/archive/refs/tags/v${NOVNC_VERSION}.zip" \
  -o "$TMP/novnc.zip"
unzip -q "$TMP/novnc.zip" -d "$TMP"
rm -rf "$NOVNC_DIR"
mv "$TMP/noVNC-${NOVNC_VERSION}" "$NOVNC_DIR"
rm -rf "$TMP"

echo "[vnc/post-install] noVNC ${NOVNC_VERSION} installed at ${NOVNC_DIR}"
