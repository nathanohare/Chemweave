// @vitest-environment jsdom
//
// A plain box's outline from a PowerPoint file (ECMA-376 Part 1, §20.1.2.2.24 ln@w, §20.1.10.49
// prstDash sysDot): a 3 pt Round Dot outline was saved as a 1.2 pt dash (F-P-011).

import { describe, it, expect, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: async () => { throw new Error('no disk here'); } }));

import { unzipSync, strFromU8 } from 'fflate';
import { openAndSave } from './office-sampler/app';
import { pptxFormat } from './office-sampler/pptx-format';

const shapesWith = (bytes: Uint8Array, text: string) => Object.entries(unzipSync(bytes))
  .filter(([p]) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
  .flatMap(([, d]) => strFromU8(d).match(/<p:sp>.*?<\/p:sp>/gs) ?? [])
  .filter((s) => s.includes(text));

describe('a plain box\'s dotted outline (F-P-011)', () => {
  it('keeps its Round Dot dash and its width through two saves', async () => {
    const once = await openAndSave(pptxFormat.build(), 'pptx-format.pptx');
    const twice = await openAndSave(once, 'pptx-format.pptx');
    for (const saved of [once, twice]) {
      const built = shapesWith(pptxFormat.build(), 'Round Dot on a plain box');
      const w = /<a:ln w="(\d+)"/.exec(built[0] ?? '')?.[1];
      const box = shapesWith(saved, 'Round Dot on a plain box')[0] ?? '';
      expect(box).toMatch(/<a:prstDash val="sysDot"\/>/);
      expect(/<a:ln w="(\d+)"/.exec(box)?.[1]).toBe(w);
    }
  });
});
