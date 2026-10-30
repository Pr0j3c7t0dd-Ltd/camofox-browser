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

# Scale by default. noVNC ships `resize=off` (app/ui.js), which draws the remote
# framebuffer at 1:1 -- a viewer then sees only the part of the display that fits
# its window, or a small browser floating in a sea of background. Patch the
# default so a bare /vnc.html scales to the viewer's window like a remote desktop.
UI_JS="${NOVNC_DIR}/app/ui.js"
if grep -q "initSetting('resize', 'off')" "$UI_JS"; then
  sed -i "s/initSetting('resize', 'off')/initSetting('resize', 'scale')/" "$UI_JS"
  echo "[vnc/post-install] noVNC default resize -> scale"
else
  echo "[vnc/post-install] WARNING: noVNC resize default not found; scaling may stay off" >&2
fi

# Bare http://host:6080/ lands on a connected, scaled session instead of the
# directory listing noVNC 1.5 ships without (there is no index.html upstream).
cat > "${NOVNC_DIR}/index.html" <<'HTML'
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Camofox display</title>
  <script>
    // autoconnect + scale: the display fills the window, no params to remember.
    location.replace('vnc.html?' + new URLSearchParams({
      autoconnect: 'true',
      resize: 'scale',
      view_clip: '0',
      reconnect: 'true',
    }));
  </script>
</head>
<body>
  <p>Opening the Camofox display&hellip; <a href="vnc.html?autoconnect=true&amp;resize=scale">continue</a></p>
</body>
</html>
HTML

echo "[vnc/post-install] noVNC entrypoint written to ${NOVNC_DIR}/index.html"
