// @vitest-environment jsdom
//
// A placeholder's own frame through the app's own Open and Save (F-P-002): the sampler's title
// placed by hand at 100, 300 pt, 500 × 80 pt, anchored at the bottom, is saved there; saved by
// Chemweave, retyped in PowerPoint and saved again, it is still there.

import { describe, it, expect, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: async () => { throw new Error('no disk here'); } }));

import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { openAndSave } from './office-sampler/app';
import { pptxMasters } from './office-sampler/pptx-masters';

const EMU = 12700;
/** The slide holding this text, and the p:sp holding it. */
function shapeWith(bytes: Uint8Array, text: string): { path: string; sp: string } {
  const files = unzipSync(bytes);
  for (const [path, data] of Object.entries(files)) {
    if (!/^ppt\/slides\/slide\d+\.xml$/.test(path)) continue;
    const xml = strFromU8(data);
    const sp = (xml.match(/<p:sp>.*?<\/p:sp>/gs) ?? []).find((s) => s.includes(text));
    if (sp) return { path, sp };
  }
  throw new Error(`no slide holds "${text}"`);
}
const frameOf = (sp: string) => /<a:off x="(-?\d+)" y="(-?\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"\/>/.exec(sp)!.slice(1).map((v) => Number(v) / EMU);

describe('a placeholder placed by hand, through Open and Save (F-P-002)', () => {
  it('keeps its place, size and anchoring, also after its text is retyped in PowerPoint', async () => {
    const saved = await openAndSave(pptxMasters.build(), 'pptx-masters.pptx');
    const first = shapeWith(saved, 'moved title');
    expect(frameOf(first.sp)).toEqual([100, 300, 500, 80]);
    expect(first.sp).toMatch(/<a:bodyPr anchor="b">/);

    // PowerPoint retypes the title in the file Chemweave saved (Chemweave's tag stays)
    const files = unzipSync(saved);
    files[first.path] = strToU8(strFromU8(files[first.path]).replace('moved title', 'retyped title'));
    const again = await openAndSave(zipSync(files), 'pptx-masters.pptx');
    const second = shapeWith(again, 'retyped title');
    expect(frameOf(second.sp)).toEqual([100, 300, 500, 80]);
    expect(second.sp).toMatch(/<a:bodyPr anchor="b">/);
  });
});
