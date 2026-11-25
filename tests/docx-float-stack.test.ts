// @vitest-environment jsdom
//
// Floating drawings' places in Word's stack (wp:anchor's relativeHeight) and charts kept in our
// part: numbered the same on every save, with no two drawings in one place (office sampler F-W-026).

import { vi, describe, it, expect } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: async () => { throw new Error('no disk here'); } }));

import { unzipSync, strFromU8 } from 'fflate';
import { openAndSave } from './office-sampler/app';
import { docxObjects } from './office-sampler/docx-objects';

const heights = (bytes: Uint8Array) => [...strFromU8(unzipSync(bytes)['word/document.xml']).matchAll(/relativeHeight="(\d+)"/g)].map((m) => Number(m[1]));
const charts = (bytes: Uint8Array) => [...strFromU8(unzipSync(bytes)['customXml/item1.xml']).matchAll(/&quot;chart&quot;:\{&quot;id&quot;:(\d+)/g)].map((m) => Number(m[1]));

describe('a Word file with floating drawings and charts, saved again', () => {
  it('gives each floating drawing its own place in the stack, the same on every save', async () => {
    const once = await openAndSave(docxObjects.build(), docxObjects.name);
    const h = heights(once);
    expect(h.length).toBeGreaterThan(10);
    expect(new Set(h).size).toBe(h.length);
    const twice = await openAndSave(once, docxObjects.name);
    expect(heights(twice)).toEqual(h);
  }, 120_000);

  it('keeps each chart in our part under its number in the file, whatever id it had while open', async () => {
    const once = await openAndSave(docxObjects.build(), docxObjects.name);
    const ids = charts(once);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids).toEqual(ids.map((_, i) => i + 1));
    expect(charts(await openAndSave(once, docxObjects.name))).toEqual(ids);
  }, 120_000);
});
