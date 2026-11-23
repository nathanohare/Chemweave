// @vitest-environment jsdom
//
// The Document's Picture Format tab, as Word's (S84; Nate, F8b item 4): its Adjust group holds
// what the Picture Format window had behind one button (Remove Background, Corrections, Color,
// Transparency, Reset Picture), Size holds Crop, and the Insert tab's Picture Format button is gone.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BRIGHTNESS_STEPS, TRANSPARENCY_STEPS, pct, withFx } from '../src/document/picture-presets';

const page = new DOMParser().parseFromString(readFileSync(join(__dirname, '../index.html'), 'utf8'), 'text/html');

describe('Document ▸ Picture Format tab', () => {
  const panel = page.querySelector('[data-doc-panel="picture"]')!;
  const labels = [...panel.querySelectorAll(':scope > .rb-group > .rb-label')].map((l) => l.textContent);
  it('has Word\'s groups', () => {
    expect(labels).toEqual(['Chemistry', 'Adjust', 'Accessibility', 'Arrange', 'Size']);
    const cmds = [...panel.querySelectorAll<HTMLElement>('[data-doc]')].map((b) => b.dataset.doc);
    for (const c of ['pic-remove-bg', 'pic-corrections', 'pic-color', 'pic-transparency', 'pic-reset', 'alt-text', 'pic-crop']) expect(cmds).toContain(c);
  });
  it('is a contextual tab, and the Insert tab no longer has a Picture Format button', () => {
    expect(page.querySelector('[data-doc-tab="picture"]')!.classList.contains('rb-context')).toBe(true);
    expect(page.querySelector('[data-doc-panel="insert"] [data-doc="picture-format"]')).toBeNull();
  });
});

describe('Picture Format presets', () => {
  it('are Word\'s steps', () => {
    // Word ▸ Picture Format ▸ Corrections (−40% to +40%) and Transparency (0% to 95%)
    expect(BRIGHTNESS_STEPS.map(pct)).toEqual(['−40%', '−20%', '0%', '+20%', '+40%']);
    expect(TRANSPARENCY_STEPS.map((v) => Math.round(v * 100))).toEqual([0, 15, 30, 50, 65, 80, 95]);
  });
  it('change one setting and keep the others, and take everything off back to none', () => {
    const fx = withFx({ contrast: 0.2, recolor: { kind: 'sepia' } }, { bright: 0.4 });
    expect(fx).toEqual({ bright: 0.4, contrast: 0.2, recolor: { kind: 'sepia' } });
    expect(withFx(fx, { bright: 0 })).toEqual({ contrast: 0.2, recolor: { kind: 'sepia' } });
    expect(withFx(fx, { bright: undefined, contrast: undefined, recolor: undefined })).toBeUndefined();
    expect(withFx(undefined, { alpha: 0 })).toBeUndefined();
  });
});

describe('Reset Picture and the Crop menu (review R02, R10)', () => {
  const pic = { kind: 'picture', src: 'data:image/png;base64,AAAA', w: 200, h: 200, px: { w: 200, h: 100 }, crop: { l: 0.25, t: 0, r: 0.25, b: 0 }, fx: { bright: 0.2, alpha: 0.5 } };

  it('takes off the looks and keeps the crop and size, so a picture cropped to 1:1 is not stretched', async () => {
    const { docMode } = await import('./doc-mode-harness');
    const { objectRun } = await import('../src/document/document');
    const { dm, f } = await docMode({ runs: [{ text: 'A ' }], paras: [{}], objects: { 3: pic } as never });
    f.ed.update({ ...f.t, runs: [...f.t.runs, objectRun(3, {})] }, 'Insert picture');
    f.ed.select(2, 3);
    dm.run('pic-reset');
    const o = f.t.objects[3] as typeof pic;
    expect(o.fx).toBeUndefined();
    expect([o.w, o.h]).toEqual([200, 200]);
    expect(o.crop).toEqual(pic.crop);
    dm.run('undo');
    expect((f.t.objects[3] as typeof pic).fx).toEqual(pic.fx);
  }, 60000);

  it('names the shapes in Title Case', async () => {
    const { docMode } = await import('./doc-mode-harness');
    const { objectRun } = await import('../src/document/document');
    const { dm, f } = await docMode({ runs: [{ text: 'A ' }], paras: [{}], objects: { 3: pic } as never });
    f.ed.update({ ...f.t, runs: [...f.t.runs, objectRun(3, {})] }, 'Insert picture');
    f.ed.select(2, 3);
    (dm as never as { pictureMenu(w: string, x: number, y: number): void }).pictureMenu('crop', 0, 0);
    const items = [...document.querySelectorAll('[role=menuitem], [role=menuitemradio], [role=menuitemcheckbox]')].map((b) => b.textContent ?? '');
    expect(items.some((t) => t.includes('Crop to Shape: Rounded Rectangle'))).toBe(true);
    expect(items.some((t) => /Crop to Shape: \w+ [a-z]/.test(t))).toBe(false);
  }, 60000);
});
