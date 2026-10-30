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

# openbox config for the remote display. Decorations are OFF on purpose: the
# Camoufox window is sized to fill the screen exactly (viewport + chrome, see
# lib/display.js), so a titlebar would push its bottom edge off the display.
# What the WM is here for is focus: raising the clicked window, focusing new
# windows (so an OAuth popup comes to the front instead of hiding behind the
# main window), and Alt+Tab to cycle.
mkdir -p /etc/camofox
cat > /etc/camofox/openbox-rc.xml <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<openbox_config xmlns="http://openbox.org/3.4/rc">
  <theme>
    <name>Clearlooks</name>
    <titleLayout></titleLayout>
    <keepBorder>no</keepBorder>
    <animateIconify>no</animateIconify>
  </theme>
  <desktops>
    <number>1</number>
    <names><name>camofox</name></names>
  </desktops>
  <resize>
    <drawContents>no</drawContents>
  </resize>
  <focus>
    <focusNew>yes</focusNew>
    <followMouse>no</followMouse>
    <focusLast>yes</focusLast>
    <raiseOnFocus>yes</raiseOnFocus>
  </focus>
  <placement>
    <policy>Smart</policy>
    <center>yes</center>
  </placement>
  <applications>
    <application class="*">
      <decor>no</decor>
      <maximized>no</maximized>
      <position force="no"/>
    </application>
  </applications>
  <keyboard>
    <keybind key="A-Tab"><action name="NextWindow"><dialog>none</dialog></action></keybind>
    <keybind key="C-A-Tab"><action name="NextWindow"><dialog>none</dialog></action></keybind>
    <keybind key="C-A-Left"><action name="PreviousWindow"><dialog>none</dialog></action></keybind>
    <keybind key="C-A-Right"><action name="NextWindow"><dialog>none</dialog></action></keybind>
    <keybind key="A-F4"><action name="Close"/></keybind>
    <keybind key="A-F10"><action name="ToggleMaximize"><direction>both</direction></action></keybind>
    <keybind key="C-A-F"><action name="ToggleFullscreen"/></keybind>
    <!-- Decorations are off and Firefox takes the pointer on press, so Alt+drag
         never reaches the WM. Resize with the keyboard instead: the focused
         window grows/shrinks 40px per press. -->
    <keybind key="C-A-S-Right"><action name="ResizeRelative"><right>40</right></action></keybind>
    <keybind key="C-A-S-Left"><action name="ResizeRelative"><right>-40</right></action></keybind>
    <keybind key="C-A-S-Down"><action name="ResizeRelative"><bottom>40</bottom></action></keybind>
    <keybind key="C-A-S-Up"><action name="ResizeRelative"><bottom>-40</bottom></action></keybind>
  </keyboard>
  <mouse>
    <!-- Decorations are off, so there is no titlebar or edge to grab. Alt+Left
         drags a window, Alt+Right drags its corner to resize: the only way to
         resize a popup (or the browser) on this display. -->
    <context name="Frame">
      <mousebind button="A-Left" action="Press">
        <action name="Focus"/>
        <action name="Raise"/>
      </mousebind>
      <mousebind button="A-Left" action="Drag">
        <action name="Move"/>
      </mousebind>
      <mousebind button="A-Right" action="Drag">
        <action name="Resize"/>
      </mousebind>
    </context>
    <context name="Client">
      <mousebind button="A-Left" action="Press">
        <action name="Focus"/>
        <action name="Raise"/>
      </mousebind>
      <mousebind button="A-Left" action="Drag">
        <action name="Move"/>
      </mousebind>
      <mousebind button="A-Right" action="Drag">
        <action name="Resize"/>
      </mousebind>
    </context>
  </mouse>
</openbox_config>
XML

echo "[vnc/post-install] openbox config written to /etc/camofox/openbox-rc.xml"
