// @vitest-environment jsdom
//
// The Smart Scheme gallery (feature request VI, 2026-11-17): the one way in to Smart Schemes and
// catalytic cycles. Layouts first, then every ready-made cycle; the old Catalytic Cycle command
// is gone, and searching for it finds Smart Scheme.

import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { closeSmartGallery, showSmartGallery, type GalleryOptions } from '../src/ui/smart-gallery';
import { CYCLE_PRESETS, blankCycle } from '../src/chem/cycles';
import { SMART_LAYOUTS } from '../src/chem/smart-scheme';
import { matchScore } from '../src/ui/command-search';
import { COMMAND_NAMES } from '../src/editor/keymap';

const opts = (o: Partial<GalleryOptions> = {}): GalleryOptions => ({
  anchor: null, work: { left: 0, top: 0, right: 800 }, preview: () => '<svg xmlns="http://www.w3.org/2000/svg"/>', selected: 0, canConvert: false, styleKey: 'test', ...o,
});
const tick = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => { closeSmartGallery(); document.body.innerHTML = ''; });

describe('the Smart Scheme gallery', () => {
  it('offers the five layouts and every ready-made cycle', async () => {
    void showSmartGallery(opts());
    const el = document.querySelector('.smart-gallery')!;
    expect([...el.querySelectorAll('.sg-tile')].map((b) => b.textContent)).toEqual(SMART_LAYOUTS.map((l) => l.name));
    const ready = CYCLE_PRESETS.filter((p) => p.group !== 'blank');
    expect(ready).toHaveLength(11);
    expect([...el.querySelectorAll('.sg-card .sg-name')].map((b) => b.textContent)).toEqual(ready.map((p) => p.name));
    // the pictures come one at a time after it opens
    for (let i = 0; i < 15; i++) await tick();
    expect(el.querySelectorAll('.sg-thumb img')).toHaveLength(11);
    expect(document.activeElement).toBe(el.querySelector('.sg-tile'));
  });

  it('resolves with the layout or the cycle picked, and null when closed', async () => {
    let got = showSmartGallery(opts());
    (document.querySelectorAll('.sg-tile')[5] as HTMLButtonElement).click();
    expect(await got).toEqual({ layout: 'cycle' });
    got = showSmartGallery(opts());
    (document.querySelectorAll('.sg-tile')[4] as HTMLButtonElement).click();
    expect(await got).toEqual({ layout: 'tree' });
    expect(document.querySelector('.smart-gallery')).toBeNull();
    got = showSmartGallery(opts());
    (document.querySelectorAll('.sg-card')[6] as HTMLButtonElement).click();
    expect(await got).toMatchObject({ cycle: { id: 'sonogashira' } });
    got = showSmartGallery(opts());
    document.querySelector('.smart-gallery')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(await got).toBeNull();
  });

  it('converts a selected scheme only when there is one', async () => {
    void showSmartGallery(opts());
    expect((document.querySelector('.sg-foot button') as HTMLButtonElement).disabled).toBe(true);
    const got = showSmartGallery(opts({ canConvert: true }));
    const b = document.querySelector('.sg-foot button') as HTMLButtonElement;
    expect(b.disabled).toBe(false);
    b.click();
    expect(await got).toEqual({ convert: true });
  });

  it('moves between tiles with the arrow keys', () => {
    void showSmartGallery(opts());
    const el = document.querySelector('.smart-gallery')!;
    const key = (k: string) => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
    key('ArrowRight');
    expect(document.activeElement).toBe(el.querySelectorAll('.sg-tile')[1]);
    key('End');
    expect(document.activeElement).toBe([...el.querySelectorAll('.sg-card')].pop());
    key('Home');
    expect(document.activeElement).toBe(el.querySelector('.sg-tile'));
  });

  it('a cycle that cannot be drawn leaves its card without a picture', async () => {
    void showSmartGallery(opts({ styleKey: 'broken', preview: () => { throw new Error('no canvas'); } }));
    for (let i = 0; i < 15; i++) await tick();
    expect(document.querySelectorAll('.sg-card')).toHaveLength(11);
    expect(document.querySelectorAll('.sg-thumb img')).toHaveLength(0);
  });
});

describe('one command for schemes and cycles', () => {
  it('searching for "catalytic cycle" finds Smart Scheme', () => {
    const label = COMMAND_NAMES['smart-scheme'];
    expect(label).toBe('Smart Scheme…');
    expect(matchScore({ label, place: 'Chemistry', more: '' }, 'catalytic cycle')).not.toBeNull();
    expect(matchScore({ label: 'Smart Scheme', place: 'Home', more: '' }, 'cycle')).not.toBeNull();
    expect(matchScore({ label: 'Energy Diagram…', place: 'Chemistry', more: '' }, 'catalytic cycle')).toBeNull();
  });

  it('the Catalytic Cycle command is gone from the menus, the ribbon and the labels', () => {
    const html = readFileSync('index.html', 'utf8');
    expect(html).not.toContain('data-cmd="catalytic-cycle"');
    expect(COMMAND_NAMES['catalytic-cycle']).toBeUndefined();
    expect(readFileSync('src/ui/canvas-ribbon.ts', 'utf8')).not.toContain('catalytic-cycle');
    expect(readFileSync('src/main.ts', 'utf8')).not.toContain("'catalytic-cycle'");
    // (Arrange ▸ Catalytic Cycle for plain drawings stays)
    expect(COMMAND_NAMES['smart-add-loop']).toBe('Add Loop…');
    expect(COMMAND_NAMES['smart-add-branch']).toBe('Add Off-Cycle Species…');
  });

  it('a blank cycle has four species, or one for each selected structure', () => {
    expect(blankCycle().loops[0].stations).toHaveLength(4);
    expect(blankCycle(1).loops[0].stations).toHaveLength(4);
    expect(blankCycle(6).loops[0].stations).toHaveLength(6);
    expect(blankCycle(6).loops[0].steps).toHaveLength(6);
  });
});
