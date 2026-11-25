// @vitest-environment jsdom
//
// A flowchart "connector" is a circle (ECMA-376 Part 1, §20.1.10.56 ST_ShapeType:
// flowChartConnector, flowChartOffpageConnector), not a connector line (F-P-006): it was read as
// a straight line, saved as <p:cxnSp> with prstGeom "line", and its text split off into a text box.

import { describe, it, expect, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: async () => { throw new Error('no disk here'); } }));

import { unzipSync, strFromU8 } from 'fflate';
import { openAndSave } from './office-sampler/app';
import { pptxShapes } from './office-sampler/pptx-shapes';

/** Every shape (p:sp or p:cxnSp) on every slide, as XML. */
const shapes = (bytes: Uint8Array) => Object.entries(unzipSync(bytes))
  .filter(([p]) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
  .flatMap(([, d]) => strFromU8(d).match(/<p:(sp|cxnSp)>.*?<\/p:\1>/gs) ?? []);

describe('a flowchart connector through Open and Save (F-P-006)', () => {
  it('stays a circle with its text in it', async () => {
    const saved = shapes(await openAndSave(pptxShapes.build(), 'pptx-shapes.pptx'));
    const circle = saved.filter((s) => s.includes('prst="flowChartConnector"'));
    expect(circle).toHaveLength(1);
    expect(circle[0]).toMatch(/^<p:sp>/);
    expect(circle[0]).toContain('P-GEO-36');
    expect(saved.filter((s) => s.startsWith('<p:cxnSp>') && s.includes('P-GEO-36'))).toHaveLength(0);
  });
});
