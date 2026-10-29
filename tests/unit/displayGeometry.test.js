/**
 * Tests for the CAMOFOX_DISPLAY geometry knob (lib/display.js).
 *
 * Contract: the Xvfb screen must always be the page viewport plus the browser
 * chrome, otherwise the bottom of the page falls off a WM-less display.
 */
import { describe, expect, test } from '@jest/globals';
import { DEFAULT_VIEWPORT, DEFAULT_WINDOW_CHROME, parseDisplaySize, resolveDisplay } from '../../lib/display.js';

describe('parseDisplaySize', () => {
  test('parses WxH', () => {
    expect(parseDisplaySize('1024x640')).toEqual({ width: 1024, height: 640, depth: 24 });
  });

  test('parses WxHx24', () => {
    expect(parseDisplaySize('1280x800x24')).toEqual({ width: 1280, height: 800, depth: 24 });
  });

  test('rejects malformed and out-of-range values', () => {
    expect(parseDisplaySize('')).toBeNull();
    expect(parseDisplaySize('1024')).toBeNull();
    expect(parseDisplaySize('wide x tall')).toBeNull();
    expect(parseDisplaySize('99x99')).toBeNull();
    expect(parseDisplaySize('99999x99999')).toBeNull();
    expect(parseDisplaySize('1024x640x12')).toBeNull();
  });
});

describe('resolveDisplay', () => {
  test('defaults to the standard viewport when unset', () => {
    const display = resolveDisplay({});
    expect(display.viewport).toEqual(DEFAULT_VIEWPORT);
    expect(display.chrome).toBe(DEFAULT_WINDOW_CHROME);
  });

  test('screen is the viewport plus browser chrome', () => {
    const display = resolveDisplay({ CAMOFOX_DISPLAY: '1024x640' });
    expect(display.viewport).toEqual({ width: 1024, height: 640 });
    expect(display.screen).toEqual({ width: 1024, height: 640 + DEFAULT_WINDOW_CHROME, depth: 24 });
    expect(display.screenString).toBe(`1024x${640 + DEFAULT_WINDOW_CHROME}x24`);
  });

  test('honours an explicit chrome height', () => {
    const display = resolveDisplay({ CAMOFOX_DISPLAY: '1024x640', CAMOFOX_WINDOW_CHROME: '80' });
    expect(display.screen.height).toBe(720);
  });

  test('ignores a nonsense chrome height and an invalid display', () => {
    const display = resolveDisplay({ CAMOFOX_DISPLAY: 'nope', CAMOFOX_WINDOW_CHROME: 'tall' });
    expect(display.viewport).toEqual(DEFAULT_VIEWPORT);
    expect(display.chrome).toBe(DEFAULT_WINDOW_CHROME);
  });
});
