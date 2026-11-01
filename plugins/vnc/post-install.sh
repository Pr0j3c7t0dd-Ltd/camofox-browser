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
    // view_only=false is not cosmetic: a view-only noVNC session never grabs the
    // keyboard (core/rfb.js: `if (!this._viewOnly) { this._keyboard.grab(); }`),
    // so every keystroke is dropped while clicks still work. The setting is sticky
    // in localStorage, so one accidental ?view_only=true would silently break
    // typing for that browser until it was cleared.
    try { localStorage.setItem('view_only', 'false'); } catch (e) {}
    location.replace('vnc.html?' + new URLSearchParams({
      autoconnect: 'true',
      resize: 'scale',
      view_clip: '0',
      reconnect: 'true',
      view_only: 'false',
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

# Keystroke probe: shows how many keystrokes the remote browser actually received.
# A human whose typing "does nothing" can open /keys.html over noVNC and watch the
# counter: 0 means the client never delivered the keys, non-zero means they arrive
# and the problem is focus in the page/address bar instead. Ansynchronous, reads
# nothing, sends nothing.
cat > "${NOVNC_DIR}/keys.html" <<'HTML'
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Keyboard probe - Camofox display</title>
  <style>
    :root { color-scheme: dark; }
    body { margin: 0; padding: 28px 32px; background: #14161a; color: #e8eaed;
           font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
    h1 { font-size: 22px; margin: 0 0 6px; font-weight: 650; }
    p { margin: 0 0 18px; color: #9aa0a6; max-width: 62ch; }
    #count { font-size: 72px; font-weight: 700; line-height: 1; color: #8ab4f8; }
    #count.zero { color: #f28b82; }
    .row { display: flex; gap: 28px; flex-wrap: wrap; margin: 22px 0 0; }
    .cell { background: #1e2126; border: 1px solid #33373d; border-radius: 10px;
            padding: 12px 16px; min-width: 190px; }
    .k { color: #9aa0a6; font-size: 12px; letter-spacing: .04em; text-transform: uppercase; }
    .v { font: 20px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace; margin-top: 4px;
         word-break: break-all; }
    #log { margin-top: 22px; background: #1e2126; border: 1px solid #33373d; border-radius: 10px;
           padding: 12px 16px; font: 14px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace;
           min-height: 60px; max-height: 320px; overflow: auto; white-space: pre-wrap; }
    #probe { margin-top: 22px; width: 100%; max-width: 520px; box-sizing: border-box;
             background: #1e2126; color: #e8eaed; border: 1px solid #5f6368; border-radius: 10px;
             padding: 14px 16px; font-size: 20px; }
    .hint { margin-top: 10px; color: #9aa0a6; font-size: 14px; }
  </style>
</head>
<body>
  <h1>Keyboard probe</h1>
  <p>Type a few characters now - anywhere on this page. Only the shape of each
     keystroke is recorded (key, physical code, keyCode). Nothing is sent anywhere.</p>
  <div id="count" class="zero">0</div>
  <div class="k" style="margin-top:6px">keystrokes received by this browser</div>
  <div class="row">
    <div class="cell"><div class="k">last key</div><div class="v" id="lkey">-</div></div>
    <div class="cell"><div class="k">physical code</div><div class="v" id="lcode">-</div></div>
    <div class="cell"><div class="k">keyCode</div><div class="v" id="lkc">-</div></div>
    <div class="cell"><div class="k">modifiers</div><div class="v" id="lmod">-</div></div>
  </div>
  <input id="probe" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="type here too...">
  <div class="hint">If the counter stays at 0 while you type, the keystrokes never reach the display.</div>
  <div id="log"></div>
  <script>
    window.__keyProbe = { count: 0, last: null, started: new Date().toISOString() };
    const el = (id) => document.getElementById(id);
    function record(type, ev) {
      window.__keyProbe.count++;
      window.__keyProbe.last = { type: type, key: ev.key, code: ev.code, keyCode: ev.keyCode,
        shift: ev.shiftKey, ctrl: ev.ctrlKey, alt: ev.altKey, meta: ev.metaKey };
      el('count').textContent = window.__keyProbe.count;
      el('count').className = '';
      el('lkey').textContent = JSON.stringify(ev.key);
      el('lcode').textContent = ev.code || 'Unidentified';
      el('lkc').textContent = String(ev.keyCode);
      el('lmod').textContent = [ev.ctrlKey && 'ctrl', ev.altKey && 'alt', ev.shiftKey && 'shift', ev.metaKey && 'meta']
        .filter(Boolean).join('+') || 'none';
      const line = type + '  key=' + JSON.stringify(ev.key) + '  code=' + (ev.code || '?');
      const log = el('log');
      log.textContent = (log.textContent + '\n' + line).trim().split('\n').slice(-40).join('\n');
      log.scrollTop = log.scrollHeight;
    }
    addEventListener('keydown', (ev) => record('down', ev), true);
    addEventListener('keyup', (ev) => record('up', ev), true);
  </script>
</body>
</html>
HTML

echo "[vnc/post-install] keystroke probe written to ${NOVNC_DIR}/keys.html"
