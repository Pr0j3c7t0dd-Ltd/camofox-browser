/**
 * An always-visible scrollbar, drawn by the page.
 *
 * Firefox (and therefore Camoufox) on Linux renders *overlay* scrollbars: the bar
 * is invisible until you are actively scrolling, and it reserves no layout space.
 * On a display a human is watching over VNC that reads as "this page cannot be
 * scrolled" -- there is no handle to grab and nothing to see. Every preference
 * that is supposed to turn overlay scrollbars off was measured inert on the
 * shipped build (Firefox 152), including `widget.gtk.overlay-scrollbars.enabled`,
 * `layout.testing.overlay-scrollbars.always-visible`, the non-native-theme
 * scrollbar prefs, GtkSettings `gtk-overlay-scrolling=false` and a custom
 * gtk.css: the layout gutter stayed 0 in every case while prefs provably reached
 * the browser. See references/display-and-scrollbars.md in the camofox-browser
 * skill.
 *
 * So draw one: a fixed track + thumb pinned to the right edge of the viewport,
 * draggable, and absent when there is nothing to scroll. Injected into every new
 * document via context.addInitScript(), so it survives navigation and applies to
 * popups too.
 *
 * The bar follows the *pointer*: whatever scrollable thing is under the cursor
 * (the document, a login modal, a side panel -- x.com scrolls a nested container,
 * not the document) becomes the scrolled element. Without that, pages that scroll
 * internally still look frozen.
 *
 * Kept deliberately dependency-free and defensive: it must never throw into the
 * page, never block clicks outside its own strip, and never fight a page that
 * manages its own scrolling (it only reads scrollTop and writes it on an
 * explicit drag or track click).
 */

export const SCROLLBAR_TRACK_ID = '__camofox_scroll_indicator__';

/** Build the injected script. Returns a self-executing source string. */
export function buildScrollIndicatorScript({ width = 14, minThumb = 32 } = {}) {
  return `(() => {
  'use strict';
  if (window.top !== window.self) return;
  if (window.__camofoxScrollIndicator) return;
  window.__camofoxScrollIndicator = true;

  const TRACK_ID = ${JSON.stringify(SCROLLBAR_TRACK_ID)};
  const WIDTH = ${Number(width)};
  const MIN_THUMB = ${Number(minThumb)};

  let target = null;      // the element currently driving the bar
  let pointer = { x: 0, y: 0 };

  function scrollable(el) {
    if (!el || el.nodeType !== 1) return false;
    const oy = getComputedStyle(el).overflowY;
    if (oy !== 'auto' && oy !== 'scroll' && oy !== 'overlay') return false;
    return el.scrollHeight > el.clientHeight + 4;
  }

  function documentScroller() {
    const el = document.scrollingElement || document.documentElement;
    return el && el.scrollHeight > el.clientHeight + 4 ? el : null;
  }

  // Nearest scrollable thing under a point: modal, panel, or the document.
  function candidateAt(x, y) {
    let el = null;
    try {
      el = document.elementFromPoint(x, y);
    } catch (err) {
      el = null;
    }
    while (el && el !== document.body && el !== document.documentElement) {
      if (el.id !== TRACK_ID && scrollable(el)) return el;
      el = el.parentElement;
    }
    return documentScroller();
  }

  function track() { return document.getElementById(TRACK_ID); }

  function build() {
    if (document.getElementById(TRACK_ID)) return;
    const el = document.createElement('div');
    el.id = TRACK_ID;
    el.style.cssText = [
      'position:fixed', 'top:0', 'right:0', 'height:100%',
      'width:' + WIDTH + 'px', 'z-index:2147483647',
      'background:rgba(140,140,150,0.22)',
      'border-left:1px solid rgba(0,0,0,0.30)',
      'box-sizing:border-box', 'pointer-events:auto',
      'display:none', 'touch-action:none'
    ].join(';');

    const thumb = document.createElement('div');
    thumb.style.cssText = [
      'position:absolute', 'right:2px', 'width:' + (WIDTH - 5) + 'px',
      'top:0', 'height:40px', 'border-radius:7px',
      'background:rgba(45,45,58,0.95)',
      'box-shadow:0 0 0 1px rgba(255,255,255,0.35)',
      'cursor:grab'
    ].join(';');
    el.appendChild(thumb);
    document.body.appendChild(el);

    let dragStart = null;
    let startTop = 0;

    thumb.addEventListener('mousedown', (ev) => {
      if (!target) return;
      ev.preventDefault();
      ev.stopPropagation();
      dragStart = ev.clientY;
      startTop = target.scrollTop;
      thumb.style.cursor = 'grabbing';
    }, true);

    window.addEventListener('mousemove', (ev) => {
      pointer = { x: ev.clientX, y: ev.clientY };
      if (dragStart === null) { retarget(); return; }
      if (!target) return;
      const trackH = el.getBoundingClientRect().height;
      const thumbH = thumb.getBoundingClientRect().height;
      const travel = Math.max(1, trackH - thumbH);
      const maxScroll = Math.max(1, target.scrollHeight - target.clientHeight);
      target.scrollTop = startTop + (ev.clientY - dragStart) * (maxScroll / travel);
      ev.preventDefault();
    }, true);

    window.addEventListener('mouseup', () => {
      if (dragStart === null) return;
      dragStart = null;
      thumb.style.cursor = 'grab';
    }, true);

    // Click the empty part of the track to page up/down, like a native scrollbar.
    el.addEventListener('mousedown', (ev) => {
      if (ev.target === thumb || !target) return;
      const r = thumb.getBoundingClientRect();
      target.scrollTop += ev.clientY < r.top ? -target.clientHeight * 0.9 : target.clientHeight * 0.9;
      ev.preventDefault();
      ev.stopPropagation();
    }, true);

    function sync() {
      if (!target) {
        const el2 = candidateAt(pointer.x, pointer.y);
        if (!el2) { el.style.display = 'none'; return; }
        target = el2;
      }
      if (!target.isConnected) { target = null; el.style.display = 'none'; return; }
      el.style.display = 'block';
      const trackH = el.getBoundingClientRect().height || window.innerHeight;
      const ratio = target.clientHeight / target.scrollHeight;
      const thumbH = Math.max(MIN_THUMB, Math.round(trackH * ratio));
      const travel = Math.max(1, trackH - thumbH);
      const maxScroll = Math.max(1, target.scrollHeight - target.clientHeight);
      const top = Math.round((target.scrollTop / maxScroll) * travel);
      thumb.style.height = thumbH + 'px';
      thumb.style.top = Math.min(Math.max(0, top), travel) + 'px';
    }

    function retarget() {
      const next = dragStart === null ? candidateAt(pointer.x, pointer.y) : target;
      if (next !== target) {
        target = next;
        sync();
      } else {
        sync();
      }
    }

    window.addEventListener('scroll', sync, { passive: true, capture: true });
    window.addEventListener('resize', sync);
    document.addEventListener('visibilitychange', sync);

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', sync, { once: true });
    } else {
      sync();
    }

    // Lazy content, SPA route changes and hover-driven panels all change what is
    // scrollable without any event we could listen to.
    setInterval(sync, 800);
  }

  const start = () => {
    if (!document.body) return;
    build();
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();`;
}
