// @vitest-environment jsdom
//
// What a new install starts with: the web version in Dark Gray with the one-row (Simplified) Canvas
// ribbon, the desktop app in Dark Gray with the Classic ribbon. A saved choice always wins.
import { describe, expect, it, vi } from 'vitest';

describe('the web version\'s defaults', () => {
  it('starts in Dark Gray with the Simplified ribbon', async () => {
    const { parseSettings } = await import('../src/settings');
    for (const text of [null, '', '{}']) {
      const s = parseSettings(text);
      expect(s.appTheme).toBe('darkgray');
      expect(s.canvasRibbon).toBe('simple');
    }
  });

  it('keeps a theme and a ribbon look that were chosen', async () => {
    const { parseSettings } = await import('../src/settings');
    const s = parseSettings(JSON.stringify({ appTheme: 'light', canvasRibbon: 'classic', webLook: 1 }));
    expect(s.appTheme).toBe('light');
    expect(s.canvasRibbon).toBe('classic');
    expect(parseSettings(JSON.stringify({ canvasRibbon: 'simple' })).canvasRibbon).toBe('simple');
  });

  it('moves settings saved before the new look to it once, and saves that it did', async () => {
    const { parseSettings, DEFAULT_SETTINGS } = await import('../src/settings');
    const old = parseSettings(JSON.stringify({ appTheme: 'system', canvasRibbon: 'classic', density: 'normal' }));
    expect(old.appTheme).toBe('darkgray');
    // (a Light or Dark theme was a choice: only the ribbon moves)
    for (const chosen of ['light', 'dark'] as const) {
      const kept = parseSettings(JSON.stringify({ appTheme: chosen, canvasRibbon: 'classic' }));
      expect(kept.appTheme).toBe(chosen);
      expect(kept.canvasRibbon).toBe('simple');
    }
    expect(old.canvasRibbon).toBe('simple');
    expect(old.density).toBe('normal');
    // what is saved from then on carries the mark, so a later choice of Classic or Light stays
    expect(old.webLook).toBe(1);
    expect(DEFAULT_SETTINGS.webLook).toBe(1);
    const later = parseSettings(JSON.stringify({ ...old, appTheme: 'light', canvasRibbon: 'classic' }));
    expect(later.appTheme).toBe('light');
    expect(later.canvasRibbon).toBe('classic');
  });
});

describe('the desktop app\'s defaults', () => {
  it('start in Dark Gray with the Classic ribbon', async () => {
    vi.resetModules();
    vi.doMock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: async () => null }));
    const { parseSettings } = await import('../src/settings');
    const s = parseSettings('{}');
    expect(s.appTheme).toBe('darkgray');
    expect(s.canvasRibbon).toBe('classic');
    // the desktop app's saved choices are never moved
    const kept = parseSettings(JSON.stringify({ appTheme: 'light', canvasRibbon: 'classic' }));
    expect(kept.appTheme).toBe('light');
    expect(kept.canvasRibbon).toBe('classic');
    vi.doUnmock('@tauri-apps/api/core');
  });
});
