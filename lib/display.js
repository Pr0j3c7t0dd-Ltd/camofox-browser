/**
 * Remote display geometry.
 *
 * One knob -- `CAMOFOX_DISPLAY` ("WxH") -- decides both the page viewport the
 * browser renders and the Xvfb screen noVNC exposes, so the noVNC view is the
 * browser, edge to edge, with nothing clipped and no black canvas around it.
 *
 * The browser window is always viewport + chrome (tab strip + URL bar), and the
 * window is pinned at 0,0 on a WM-less X server -- so the screen has to include
 * that chrome or the bottom of the page falls off the display:
 *
 *     screen = viewport + CAMOFOX_WINDOW_CHROME
 *
 * Keep the display modest (e.g. 1024x640): noVNC scales the framebuffer to fit
 * the viewer's pane, so a smaller display means larger apparent text for a human
 * watching the same session.
 */

export const DEFAULT_VIEWPORT = { width: 1280, height: 720 };
export const DEFAULT_WINDOW_CHROME = 57;
export const DEFAULT_DEPTH = 24;

const MIN_WIDTH = 320;
const MAX_WIDTH = 4000;
const MIN_HEIGHT = 240;
const MAX_HEIGHT = 4000;

/** Parse "WxH" / "WxHx24". Returns null for anything malformed or out of range. */
export function parseDisplaySize(value) {
  const match = /^\s*(\d{2,5})\s*x\s*(\d{2,5})(?:\s*x\s*(\d{1,2}))?\s*$/i.exec(String(value ?? ''));
  if (!match) return null;

  const width = Number(match[1]);
  const height = Number(match[2]);
  const depth = match[3] ? Number(match[3]) : DEFAULT_DEPTH;

  if (width < MIN_WIDTH || width > MAX_WIDTH) return null;
  if (height < MIN_HEIGHT || height > MAX_HEIGHT) return null;
  if (depth !== 16 && depth !== 24 && depth !== 32) return null;

  return { width, height, depth };
}

/**
 * Resolve the viewport and the Xvfb screen that shows it.
 *
 * @param {Record<string, string|undefined>} [env]
 * @returns {{viewport: {width: number, height: number}, screen: {width: number, height: number, depth: number}, chrome: number, screenString: string}}
 */
export function resolveDisplay(env = process.env) {
  const viewport = parseDisplaySize(env.CAMOFOX_DISPLAY) || { ...DEFAULT_VIEWPORT, depth: DEFAULT_DEPTH };

  const parsedChrome = Number.parseInt(env.CAMOFOX_WINDOW_CHROME ?? '', 10);
  const chrome = Number.isFinite(parsedChrome) && parsedChrome >= 0 && parsedChrome <= 200
    ? parsedChrome
    : DEFAULT_WINDOW_CHROME;

  const screen = {
    width: viewport.width,
    height: Math.min(viewport.height + chrome, MAX_HEIGHT),
    depth: viewport.depth || DEFAULT_DEPTH,
  };

  return {
    viewport: { width: viewport.width, height: viewport.height },
    screen,
    chrome,
    screenString: `${screen.width}x${screen.height}x${screen.depth}`,
  };
}
