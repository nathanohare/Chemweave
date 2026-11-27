// @vitest-environment jsdom
//
// Code review 2026-11-26, batch 02: NMR prediction and Check Data.
//   F144: a pasted 13C (or 1H) list took in every number after it (31P lists, HRMS, mp, [α]D).
//   F145: a terminal vinyl CH (R-CH=CH2) was predicted as tt instead of dd.
//   F146: the shared couplings of a CH2 with a predicted gap were not the mean.
//   F654: a solvent written (CD3)2SO in the header was never recognized.
//   F655: Karplus values were worked out for a bond from a small-ring carbon to one outside it.
//   F656, F657: after one worker error, NMR prediction and spectrum simulation never used a worker again.

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { createRequire } from 'node:module';
import { Resources } from 'openchemlib';
import { parsePeakLists } from '../src/chem/nmr/check';
import { protonGroups, type JGraph } from '../src/chem/nmr/coupling';
import { shareGapCouplings } from '../src/chem/nmr/spectrum';
import { vicinal3d } from '../src/chem/nmr/karplus';
import { buildModel } from '../src/chem/model3d-build';

describe('F144: a peak list ends where the paragraph goes on to other data', () => {
  it('leaves out the 31P list and the HRMS masses after a 13C list', () => {
    const [c] = parsePeakLists('13C NMR (101 MHz, CDCl3) δ 171.6, 60.8, 14.3; 31P NMR (162 MHz, CDCl3) δ 29.4; HRMS (ESI) m/z calcd for C10H13O2 165.0910, found 165.0912.');
    expect(c.nuc).toBe('13C');
    expect(c.peaks.map((p) => p.value)).toEqual([171.6, 60.8, 14.3]);
  });

  it('leaves out a 19F list and an optical rotation after a 1H list', () => {
    const [h] = parsePeakLists('1H NMR (400 MHz, CDCl3) δ 7.30 (s, 1H), 2.10 (s, 3H). 19F NMR (376 MHz, CDCl3) δ -62.7 (s, 3F). [α]D +12.3 (c 1.0, CHCl3); mp 102.5-103.0 °C.');
    expect(h.peaks.map((p) => p.value)).toEqual([7.30, 2.10]);
  });

  it('still reads both lists of one paragraph', () => {
    const lists = parsePeakLists('1H NMR (400 MHz, CDCl3) δ 4.12 (q, J = 7.1 Hz, 2H), 1.25 (t, J = 7.1 Hz, 3H); 13C NMR (101 MHz, CDCl3) δ 171.1, 60.4, 14.2; IR (neat) 1735 cm-1.');
    expect(lists.map((l) => [l.nuc, l.peaks.length])).toEqual([['1H', 2], ['13C', 3]]);
  });
});

describe('F654: a solvent written with brackets in the header', () => {
  it('reads (CD3)2SO after or before the frequency', () => {
    const [a] = parsePeakLists('1H NMR (400 MHz, (CD3)2SO) δ 2.50 (s, 0.2H), 7.30 (s, 1H)');
    expect(a).toMatchObject({ sf: 400, solvent: 'DMSO-d6' });
    expect(a.peaks.map((p) => p.value)).toEqual([2.50, 7.30]);
    const [b] = parsePeakLists('1H NMR ((CD3)2CO, 500 MHz) δ 2.05 (s, 1H)');
    expect(b).toMatchObject({ sf: 500, solvent: 'acetone-d6' });
  });
});

describe('F145: a terminal vinyl CH is a dd', () => {
  it('counts each coupling to =CH2 as one proton', () => {
    // styrene's CH= (δ 6.72): dd, J = 17.6, 10.9 Hz (Pretsch, Bühlmann and Badertscher, Structure
    // Determination of Organic Compounds, 4th ed., Springer 2009, alkenes)
    const g: JGraph = { atoms: [{ el: 'C', arom: false, h: 1 }, { el: 'C', arom: false, h: 2 }, { el: 'C', arom: false, h: 0 }], bonds: [{ u: 0, v: 1, o: 2 }, { u: 0, v: 2, o: 1 }] };
    const groups = protonGroups(g, [6.7, 5.5, NaN], ['a', 'b', 'c']);
    const ch = groups.find((x) => x.atoms.includes(0))!;
    expect(ch.mult).toBe('dd');
    expect(ch.j).toHaveLength(2);
  });
});

describe('F146: the protons of a CH2 with a gap share the mean coupling', () => {
  const g = (ha: number, hb: number): JGraph => ({ atoms: [{ el: 'C', arom: false, h: ha }, { el: 'C', arom: false, h: hb }], bonds: [{ u: 0, v: 1, o: 1 }] });
  it('gives both protons the same value', () => {
    const perH = new Map([['0.0,1.0', 11.5], ['0.1,1.0', 3.5]]);
    shareGapCouplings(perH, g(2, 1), { 0: 0.3 });
    expect([...perH.values()]).toEqual([7.5, 7.5]);
  });
  it('averages all four pairs when both atoms are such CH2s', () => {
    const perH = new Map([['0.0,1.0', 12], ['0.0,1.1', 4], ['0.1,1.0', 6], ['0.1,1.1', 2]]);
    shareGapCouplings(perH, g(2, 2), { 0: 0.3, 1: 0.2 });
    expect([...perH.values()]).toEqual([6, 6, 6, 6]);
  });
});

describe('F655: no Karplus value next to a small ring', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let RDKit: any;
  beforeAll(async () => {
    RDKit = await createRequire(import.meta.url)('@rdkit/rdkit')();
    Resources.registerFromNodejs();
  }, 30000);
  it('leaves out the ring CH to the exocyclic CH of isopropylcyclobutane', () => {
    const m = RDKit.get_mol('CC(C)C1CCC1');
    const mol = m.get_molblock();
    m.delete();
    const model = buildModel(mol, 1, 1)!;
    const ring = new Set([3, 4, 5, 6]);
    const pairs = vicinal3d(model);
    expect(pairs.some((v) => ring.has(v.c1) || ring.has(v.c2))).toBe(false);
  });
});

describe('F656, F657: a worker that fails once is started again', () => {
  class FakeWorker {
    static made: FakeWorker[] = [];
    onmessage: ((e: MessageEvent) => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    constructor() { FakeWorker.made.push(this); }
    postMessage() {}
    terminate() {}
  }
  it('makes a new worker for the next request', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const { netInBackground } = await import('../src/chem/nmr/net-client');
    const { spectrumInBackground } = await import('../src/chem/nmr/spectrum-client');
    const g = { atoms: [], bonds: [] } as never;
    const first = netInBackground('x', g, null)!;
    const firstSpec = spectrumInBackground({ atoms: [], bonds: [] }, [], [], 400, 'fast')!;
    expect(FakeWorker.made).toHaveLength(2);
    FakeWorker.made[0].onerror!({});
    FakeWorker.made[1].onerror!({});
    await expect(first).rejects.toThrow(/stopped unexpectedly/);
    await expect(firstSpec).rejects.toThrow(/stopped unexpectedly/);
    expect(netInBackground('x', g, null)).not.toBeNull();
    expect(spectrumInBackground({ atoms: [], bonds: [] }, [], [], 400, 'fast')).not.toBeNull();
    expect(FakeWorker.made).toHaveLength(4);
    vi.unstubAllGlobals();
  });
});
