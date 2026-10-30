import { describe, expect, test } from '@jest/globals';
import { buildScrollIndicatorScript, SCROLLBAR_TRACK_ID } from '../../lib/scroll-indicator.js';

describe('scroll indicator injection', () => {
  test('the injected source is syntactically valid JavaScript', () => {
    // addInitScript() hands this to the page verbatim; a syntax error would abort
    // the init script silently and leave the page with no scrollbar at all.
    const src = buildScrollIndicatorScript();
    expect(typeof src).toBe('string');
    expect(() => new Function(src)).not.toThrow();
  });

  test('the source is self-contained and wrapped in a top-level guard', () => {
    const src = buildScrollIndicatorScript();
    // No imports/requires: this runs in the page, not in Node.
    expect(src).not.toMatch(/\brequire\(/);
    expect(src).not.toMatch(/^\s*import\s/m);
    // Top-frame only, so tabs never get several stacked indicators.
    expect(src).toContain('window.top !== window.self');
    // Idempotent: re-injection (or a page that reloads the script) must not double up.
    expect(src).toContain('__camofoxScrollIndicator');
  });

  test('the script targets the documented track element', () => {
    const src = buildScrollIndicatorScript();
    expect(SCROLLBAR_TRACK_ID).toBe('__camofox_scroll_indicator__');
    expect(src).toContain(SCROLLBAR_TRACK_ID);
  });

  test('width and minimum thumb size are configurable', () => {
    const src = buildScrollIndicatorScript({ width: 20, minThumb: 48 });
    expect(src).toContain('const WIDTH = 20;');
    expect(src).toContain('const MIN_THUMB = 48;');
  });

  test('the indicator stays out of the way of page content and clicks', () => {
    const src = buildScrollIndicatorScript();
    // Pinned top-right in the viewport, above page chrome...
    expect(src).toContain('position:fixed');
    expect(src).toContain('z-index:2147483647');
    // ...and hidden entirely when nothing under the pointer scrolls.
    expect(src).toContain("style.display = 'none'");
    expect(src).toContain('pointer-events:auto');
    // It has to actually reach the document, or it renders nowhere.
    expect(src).toContain('document.body.appendChild(el)');
  });
});
