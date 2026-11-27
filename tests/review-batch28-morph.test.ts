// @vitest-environment jsdom
//
// Code review 2026-11-26, batch 28 (Animate Reaction and Map Atoms): F139, F140, F141, F142,
// F143, F644, F645, F646, F649, F650, F653.
//
// The structures are made-up skeletons (rings and chains of carbon at a 14.4 pt bond length);
// what is checked is how atoms are paired and how much work it takes, not chemistry values.

import { describe, expect, it, vi } from 'vitest';

// counts of the expensive calls, through the real functions
const calls = vi.hoisted(() => ({ procrustes: 0, lsa: 0, resolve: 0 }));
vi.mock('../src/morph/assign', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/morph/assign')>();
  return {
    ...real,
    procrustes: (...a: Parameters<typeof real.procrustes>) => { calls.procrustes++; return real.procrustes(...a); },
    linearSumAssignment: (...a: Parameters<typeof real.linearSumAssignment>) => { calls.lsa++; return real.linearSumAssignment(...a); },
  };
});
vi.mock('../src/morph/mapping', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/morph/mapping')>();
  return { ...real, resolve: (...a: Parameters<typeof real.resolve>) => { calls.resolve++; return real.resolve(...a); } };
});

import { Doc } from '../src/model';
import { Renderer, withMeasure } from '../src/render/renderer';
import { arialWidth } from '../src/text-metrics';
import { MScene, type MBond, type MNode, type MStyle } from '../src/morph/scene';
import { matchBonds, matchConnectivity, matchEquivalent, matchNodes, SEEDS } from '../src/morph/match';
import { resolve } from '../src/morph/mapping';
import { turnPlan } from '../src/morph/turn';
import { buildSteps, planOf, type Step } from '../src/morph/clip';
import { bondChanges } from '../src/morph/scheme-clip';
import { mapAtoms } from '../src/morph/atom-map';
import { readMapping, MappingFileError } from '../src/morph/numbers';
import { encodeMp4 } from '../src/morph/mp4';

const L = 14.4;
const STYLE: MStyle = { lineWidth: 0.6, boldWidth: 2, marginWidth: 1.6, hashSpacing: 2.5, bondLength: L, gap: 2.6, wedge: 4.5, labelSize: 10, font: 'Arial' };

/** A scene of carbons at these points (keys "1", "2"… unless given) joined by these bonds (single unless an order is given). */
function scene(points: [number, number][], bonds: [number, number, number?][], keys?: string[], frags?: string[]): MScene {
  const sc = new MScene(STYLE);
  points.forEach(([x, y], i) => {
    const key = keys?.[i] ?? String(i + 1);
    sc.nodes.set(key, { key, atom: Number(key), p: { x, y }, label: null, charge: null, color: [0, 0, 0], frag: frags?.[i] ?? '1', el: '6' } as MNode);
  });
  bonds.forEach(([a, b, order], i) => {
    const key = String(i + 1);
    const ka = keys?.[a] ?? String(a + 1), kb = keys?.[b] ?? String(b + 1);
    sc.bonds.set(key, { key, id: 1000 + i, b: ka, e: kb, order: order ?? 1, aromatic: false, display: 'solid', dpos: 'center', z: 0, color: [0, 0, 0], w: 0.6, s: 1, rungs: 0 } as unknown as MBond);
  });
  return sc;
}
/** A regular ring of n carbons, centred at (cx, cy). */
const ring = (n: number, cx = 0, cy = 0, turn = 0): [number, number][] =>
  Array.from({ length: n }, (_, i) => { const a = turn + (2 * Math.PI * i) / n; const r = L / (2 * Math.sin(Math.PI / n)); return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; });
const cycleBonds = (n: number, from = 0): [number, number][] => Array.from({ length: n }, (_, i) => [from + i, from + ((i + 1) % n)]);
/** A zigzag chain of n carbons. */
const chain = (n: number, x0 = 0): [number, number][] => Array.from({ length: n }, (_, i) => [x0 + i * L * 0.866, i % 2 ? -L / 2 : 0]);
const chainBonds = (n: number): [number, number][] => Array.from({ length: n - 1 }, (_, i) => [i, i + 1]);

describe('F139: a scene finds the bond between two atoms without a pass over its bonds', () => {
  it('answers from a lookup made once', () => {
    const sc = scene(chain(40), chainBonds(40));
    expect(sc.bondBetween('3', '4')).toBe('3');
    expect(sc.bondBetween('4', '3')).toBe('3');
    expect(sc.bondBetween('3', '5')).toBeUndefined();
    const values = vi.spyOn(sc.bonds, 'values');
    const entries = vi.spyOn(sc.bonds, Symbol.iterator);
    for (let i = 1; i < 40; i++) expect(sc.bondBetween(String(i), String(i + 1))).toBe(String(i));
    expect(values.mock.calls.length + entries.mock.calls.length).toBe(0);
  });
});

describe('F140: a pair chosen by hand on an equivalency (turn) step', () => {
  it('pairs every product atom once, with the rest of the ring following the hand pair', () => {
    // cyclohexane drawn twice (an equivalency sign between): the automatic pairing sends 1 to 1
    const A = scene(ring(6), cycleBonds(6), ['1', '2', '3', '4', '5', '6']);
    const B = scene(ring(6, 100), cycleBonds(6), ['11', '12', '13', '14', '15', '16']);
    const auto = resolve({}, A, B, true).nmap;
    expect(auto.get('1')).toBe('11');
    const m = resolve({ pairs: [['1', '13']] }, A, B, true).nmap;
    expect(m.get('1')).toBe('13');
    expect(m.size).toBe(6);
    expect(new Set(m.values()).size).toBe(6);
    // every ring bond carried through
    expect(matchBonds(A, B, m).size).toBe(6);
  });
});

describe('F142: the isomorphism search for an equivalency sign is bounded', () => {
  /** The atoms listed out of order round the ring (every seventh), so atoms next in the list are not bonded. */
  function shuffled(points: [number, number][], bonds: [number, number][], prefix: string): MScene {
    const n = points.length;
    const order = Array.from({ length: n }, (_, j) => (j * 7) % n);
    const at = new Map(order.map((i, j) => [i, j]));
    return scene(order.map((i) => points[i]), bonds.map(([a, b]) => [at.get(a)!, at.get(b)!]), order.map((i) => `${prefix}${i}`));
  }

  it('gives up quickly on two drawings with the same atoms and degrees that are not the same molecule', () => {
    // one 30-membered ring against two 15-membered rings: every atom a CH2 with two bonds
    const n = 30;
    const A = shuffled(ring(n), cycleBonds(n), 'a');
    const B = shuffled([...ring(15), ...ring(15, 200)], [...cycleBonds(15), ...cycleBonds(15, 15)], 'b');
    const t0 = performance.now();
    expect(matchEquivalent(A, B).size).toBe(0);
    expect(performance.now() - t0).toBeLessThan(5000);
  });

  it('still finds the pairing of a molecule redrawn', () => {
    const n = 24;
    const A = shuffled(ring(n), cycleBonds(n), 'a');
    const B = shuffled(ring(n, 300, 0, 0.4), cycleBonds(n), 'b');
    const m = matchEquivalent(A, B);
    expect(m.size).toBe(n);
    expect(matchBonds(A, B, m).size).toBe(n);
  });
});

describe('F141: pairing by connectivity on a big step tries a bounded number of seeds', () => {
  it('fits each seed once per way round, at most SEEDS of them', () => {
    const n = 110;
    const A = scene(chain(n), chainBonds(n));
    const B = scene(chain(n, 2000), chainBonds(n), Array.from({ length: n }, (_, i) => `p${i}`));
    calls.procrustes = 0;
    const m = matchConnectivity(A, B);
    // (the motion of each pairing grown is measured once: one fit each)
    expect(calls.procrustes).toBeLessThanOrEqual(2 * SEEDS);
    expect(matchBonds(A, B, m).size).toBe(n - 1);
  });
});

describe('F141: the seeds still find the shared skeleton when the rarest atoms are not in it', () => {
  it('pairs a long chain whose one oxygen sits at a different carbon in each drawing', () => {
    const n = 110;
    const withO = (at: number, x0: number, prefix: string) => {
      const pts = chain(n, x0);
      const sc = scene([...pts, [pts[at][0], pts[at][1] - L]], [...chainBonds(n), [at, n]], [...Array.from({ length: n + 1 }, (_, i) => `${prefix}${i}`)]);
      sc.nodes.get(`${prefix}${n}`)!.label = { canon: 'O', attach: 'O' } as never;
      return sc;
    };
    const A = withO(5, 0, 'a'), B = withO(80, 3000, 'b');
    const m = matchConnectivity(A, B);
    // every chain bond carried through (the oxygen's bond can't be)
    expect(matchBonds(A, B, m).size).toBe(n - 1);
  });
});

describe('F644: the position pairing stops once its pairing settles', () => {
  it('needs fewer than its twelve assignments when the drawing is the same both times', () => {
    const A = scene(chain(12), chainBonds(12));
    const B = scene(chain(12, 300), chainBonds(12), Array.from({ length: 12 }, (_, i) => `p${i}`));
    calls.lsa = 0;
    const m = matchNodes(A, B);
    expect(calls.lsa).toBeLessThan(12);
    for (let i = 0; i < 12; i++) expect(m.get(String(i + 1))).toBe(`p${i}`);
  });
});

describe('F143: a turn inside a starting material with another molecule beside it', () => {
  it('is found with the other molecule in the same group', () => {
    // butane-like: 1–2 fixed, 3 the bond's far end, 4 and 5 a group on 3 that swings across the 2–3 axis
    const pts: [number, number][] = [[-L, L], [0, 0], [L, 0], [1.5 * L, 0.87 * L], [2.5 * L, 0.87 * L]];
    const after: [number, number][] = [[-L, L], [0, 0], [L, 0], [1.5 * L, -0.87 * L], [2.5 * L, -0.87 * L]];
    const bonds: [number, number][] = [[0, 1], [1, 2], [2, 3], [3, 4]];
    const alone = turnPlan(scene(pts, bonds), scene(after, bonds), new Map(['1', '2', '3', '4', '5'].map((k) => [k, k])));
    expect(alone).not.toBeNull();
    // the same with a three-atom molecule drawn beside it, not moving
    const other: [number, number][] = [[-5 * L, 0], [-4 * L, 0.5 * L], [-3 * L, 0]];
    const frags = ['1', '1', '1', '1', '1', '6', '6', '6'];
    const A = scene([...pts, ...other], [...bonds, [5, 6], [6, 7]], undefined, frags);
    const B = scene([...after, ...other], [...bonds, [5, 6], [6, 7]], undefined, frags);
    const plan = turnPlan(A, B, new Map(['1', '2', '3', '4', '5', '6', '7', '8'].map((k) => [k, k])));
    expect(plan).not.toBeNull();
    expect(plan!.bond).toBe(alone!.bond);
  });
});

const noCanvas = { getContext: () => null } as unknown as HTMLCanvasElement;
const arrowTo = (doc: Doc, x1: number, x2: number, y: number) => doc.addArrow({ tail: { x: x1, y }, head: { x: x2, y }, headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'solid', noGo: false, equilibrium: false, sweep: 0, headLength: 6, headWidth: 1.5 });
/** A chain of n carbons drawn at (x0, y). */
function drawChain(doc: Doc, n: number, x0: number, y: number): number[] {
  const ids = chain(n, x0).map(([x, dy]) => doc.addAtom(x, y + dy, 6).id);
  for (let i = 0; i + 1 < n; i++) doc.addBond(ids[i], ids[i + 1], 1);
  return ids;
}

describe('F646: a second reaction of its own is animated too', () => {
  it('plans both A → B and C → D', () => {
    const doc = new Doc();
    doc.edit('Build', () => {
      drawChain(doc, 3, 0, 100); arrowTo(doc, 50, 90, 100); drawChain(doc, 4, 110, 100);
      drawChain(doc, 3, 0, 300); arrowTo(doc, 50, 90, 300); drawChain(doc, 5, 110, 300);
    });
    const plan = planOf(doc);
    expect(plan.groups.length).toBe(4);
    expect(plan.groups.map((g) => g.length).sort()).toEqual([3, 3, 4, 5]);
    // the two reactions by their arrows; between them no made-up reaction, only a move to the next
    expect(plan.kinds).toEqual(['morph', 'next', 'morph']);
    expect(plan.arrows[0]).not.toBeNull();
    expect(plan.arrows[1]).toBeNull();
    expect(plan.arrows[2]).not.toBeNull();
    const steps = withMeasure((t, s2) => arialWidth(t, s2), () => buildSteps(doc, plan, new Renderer(noCanvas, noCanvas)));
    expect(steps[1].kind).toBe('next');
    expect(steps[1].map.nmap.size).toBe(0);
    expect(bondChanges(steps[1])).toEqual({ breaking: [], forming: [] });
  });
});

describe('F645: Map Atoms on a big step with a pair chosen by hand', () => {
  it('uses only the hand pairs there, not the animation\'s full pairing', () => withMeasure((t, s) => arialWidth(t, s), () => {
    const doc = new Doc();
    let a: number[] = [], b: number[] = [], arrow = 0;
    doc.edit('Build', () => {
      a = drawChain(doc, 55, 0, 100);
      const end = 54 * 0.866 * L;
      arrow = arrowTo(doc, end + 20, end + 60, 100).id;
      b = drawChain(doc, 55, end + 80, 100);
    });
    doc.edit('Pair', () => doc.updateArrow(arrow, { morph: { pairs: [[a[0], b[0]]] } }));
    calls.resolve = 0;
    const m = mapAtoms(doc, new Renderer(noCanvas, noCanvas));
    expect(calls.resolve).toBe(0);
    expect(m.steps).toBe(1);
    expect(m.numbers.get(a[0])).toBe(m.numbers.get(b[0]));
  }));
});

describe('F653: aromatic bonds in the Whole Scheme animation', () => {
  it('marks no π bond lost when an aromatic ring becomes saturated', () => {
    const A = scene(ring(6), cycleBonds(6));
    for (const bd of A.bonds.values()) { bd.order = 2; bd.aromatic = true; }
    const B = scene(ring(6, 100), cycleBonds(6), ['11', '12', '13', '14', '15', '16']);
    const bmap = new Map([...A.bonds.keys()].map((k) => [k, k]));
    const step = { A, B, kind: 'morph', map: { nmap: new Map(), bmap, shifts: new Map(), slides: [] }, opt: {}, swaps: new Map(), arrow: null } as unknown as Step;
    expect(bondChanges(step)).toEqual({ breaking: [], forming: [] });
  });

  it('marks no π bond made when a ring becomes aromatic, as for a ring drawn with a circle', () => {
    const A = scene(ring(6), cycleBonds(6));
    const B = scene(ring(6, 100), cycleBonds(6), ['11', '12', '13', '14', '15', '16']);
    for (const bd of B.bonds.values()) { bd.order = 2; bd.aromatic = true; }
    const bmap = new Map([...A.bonds.keys()].map((k) => [k, k]));
    const step = { A, B, kind: 'morph', map: { nmap: new Map(), bmap, shifts: new Map(), slides: [] }, opt: {}, swaps: new Map(), arrow: null } as unknown as Step;
    expect(bondChanges(step)).toEqual({ breaking: [], forming: [] });
    // a plain double bond made is still marked
    for (const bd of B.bonds.values()) { bd.aromatic = false; }
    expect(bondChanges(step).forming.length).toBe(6);
  });
});

describe('F650: a mapping file that doesn\'t fit says so', () => {
  it('rejects a one-step file with only a slide on a two-step scheme, and malformed steps', () => {
    const doc = new Doc();
    expect(() => readMapping(doc, JSON.stringify({ slides: [['1-2', '2-3']] }), 2)).toThrow(MappingFileError);
    expect(() => readMapping(doc, JSON.stringify({ exact: true }), 2)).toThrow(MappingFileError);
    expect(() => readMapping(doc, JSON.stringify({ stages: [null, {}] }), 2)).toThrow(MappingFileError);
    expect(() => readMapping(doc, JSON.stringify({ stages: [{ shifts: ['1-2'] }, {}] }), 2)).toThrow(MappingFileError);
    expect(() => readMapping(doc, JSON.stringify({ stages: [{ slides: [['1-2']] }, {}] }), 2)).toThrow(MappingFileError);
    expect(readMapping(doc, JSON.stringify({}), 2)).toEqual([{}, {}]);
    // entries that are neither atom numbers nor text
    expect(() => readMapping(doc, JSON.stringify({ pairs: { 1: { a: 2 } } }), 1)).toThrow(MappingFileError);
    expect(() => readMapping(doc, JSON.stringify({ shifts: [[['1-2'], 3]] }), 1)).toThrow(MappingFileError);
    expect(() => readMapping(doc, JSON.stringify({ slides: [[null, '2-3']] }), 1)).toThrow(MappingFileError);
  });
});

describe('F649: an MP4 encoder that fails reports its own error and is closed', () => {
  /** A stand-in for the system's encoder: `fail` says how it goes wrong. */
  function fakeEncoder(fail: 'error' | 'none') {
    const made: { closed: number }[] = [];
    class FakeEncoder {
      static isConfigSupported = async () => ({ supported: true });
      state = 'unconfigured';
      encodeQueueSize = 0;
      rec = { closed: 0 };
      private onError: (e: Error) => void;
      constructor(init: { error: (e: Error) => void }) { this.onError = init.error; made.push(this.rec); }
      configure() { this.state = 'configured'; }
      encode() { if (fail === 'error') { this.state = 'closed'; this.onError(new Error('The encoder ran out of memory.')); } }
      async flush() { if (this.state === 'closed') throw new DOMException('Cannot call \'flush\' on a closed codec.', 'InvalidStateError'); }
      close() { if (this.state === 'closed') throw new DOMException('closed', 'InvalidStateError'); this.state = 'closed'; this.rec.closed++; }
    }
    class FakeFrame { close() {} }
    vi.stubGlobal('VideoEncoder', FakeEncoder);
    vi.stubGlobal('VideoFrame', FakeFrame);
    return made;
  }
  const canvas = { width: 64, height: 48 } as unknown as HTMLCanvasElement;

  it('throws the encoder\'s error, not the closed codec\'s', async () => {
    fakeEncoder('error');
    await expect(encodeMp4(3, canvas, () => {}, 10)).rejects.toThrow('The encoder ran out of memory.');
    vi.unstubAllGlobals();
  });

  it('closes the encoder when drawing a frame fails', async () => {
    const made = fakeEncoder('none');
    await expect(encodeMp4(3, canvas, (i) => { if (i === 1) throw new Error('no frame'); }, 10)).rejects.toThrow('no frame');
    expect(made[0].closed).toBe(1);
    vi.unstubAllGlobals();
  });
});
