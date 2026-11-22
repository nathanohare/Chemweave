// The chemistry engine on very big structures (G4-01, G4-08): a 1,000-atom chain and a
// 1,000-atom ring system must get an answer (formula, masses, SI facts) without breaking the
// engine, and a small request after them must still be answered. Structures are made in code.
// Formulas: a saturated hydrocarbon with n carbons and r rings is CnH(2n+2−2r) (the general
// formula of alkanes, each ring taking away two H): an unbranched chain CnH2n+2, one ring CnH2n,
// and k fused six-membered rings in a row (perhydro-polyacene, 4k+2 carbons) C(4k+2)H(6k+6).
import { beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { DEEP_LIMIT, TOO_DEEP, hasMacrocycle, longestPathBound, molfileGraph, smilesGraph, tooDeep } from '../src/chem/engine-guard';
import { respond, engineWorks } from '../src/worker/chem-respond';
import type { ChemResponse } from '../src/worker/chem-worker';
import { molFacts } from '../src/si/chem';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let RDKit: any;
beforeAll(async () => { RDKit = await createRequire(import.meta.url)('@rdkit/rdkit')(); });

/** A V3000 molfile (V2000 holds at most 999 atoms) of carbons at the given places and single bonds. */
function v3000(xy: [number, number][], bonds: [number, number][]): string {
  return ['', '  test', '', '  0  0  0     0  0            999 V3000', 'M  V30 BEGIN CTAB', `M  V30 COUNTS ${xy.length} ${bonds.length} 0 0 0`, 'M  V30 BEGIN ATOM',
    ...xy.map(([x, y], i) => `M  V30 ${i + 1} C ${x.toFixed(4)} ${y.toFixed(4)} 0 0`), 'M  V30 END ATOM', 'M  V30 BEGIN BOND',
    ...bonds.map(([a, b], i) => `M  V30 ${i + 1} 1 ${a + 1} ${b + 1}`), 'M  V30 END BOND', 'M  V30 END CTAB', 'M  END', ''].join('\n');
}
const chainXY = (n: number): [number, number][] => Array.from({ length: n }, (_, i) => [i * 1.3, (i % 2) * 0.75]);
const chain = (n: number): string => v3000(chainXY(n), Array.from({ length: n - 1 }, (_, i) => [i, i + 1]));
const ring = (n: number): string => v3000(Array.from({ length: n }, (_, i) => [50 * Math.cos((2 * Math.PI * i) / n), 50 * Math.sin((2 * Math.PI * i) / n)]), Array.from({ length: n }, (_, i) => [i, (i + 1) % n]));
/** k fused six-membered rings in a row: two zigzag rows of 2k+1 atoms joined at every other atom. */
function acene(k: number): string {
  const m = 2 * k + 1;
  const xy: [number, number][] = [];
  for (let i = 0; i < m; i++) xy.push([i * 1.3, i % 2 ? 0.75 : 0]);
  for (let i = 0; i < m; i++) xy.push([i * 1.3, i % 2 ? -2.25 : -1.5]);
  const bonds: [number, number][] = [];
  for (let i = 0; i + 1 < m; i++) bonds.push([i, i + 1], [m + i, m + i + 1]);
  for (let i = 0; i < m; i += 2) bonds.push([i, m + i]);
  return v3000(xy, bonds);
}
/** A branched tree (each atom with two branches) of the given depth: 2^(d+1) − 1 atoms, longest route 2d + 1. */
function dendrimer(depth: number): string {
  const xy: [number, number][] = [[0, 0]];
  const bonds: [number, number][] = [];
  let level = [0];
  for (let d = 1; d <= depth; d++) {
    const next: number[] = [];
    for (const p of level) for (let c = 0; c < 2; c++) { const id = xy.length; xy.push([id * 0.7, d * 1.5]); bonds.push([p, id]); next.push(id); }
    level = next;
  }
  return v3000(xy, bonds);
}
const ask = (m: Parameters<typeof respond>[1]): ChemResponse => respond(RDKit, m);
const stillWorks = (): void => {
  const r = ask({ type: 'molToSmiles', id: 99, molblock: RDKit.get_mol('CCO').get_molblock() });
  expect(r).toEqual({ type: 'molToSmiles', id: 99, smiles: 'CCO' });
  expect(engineWorks(RDKit)).toBe(true);
};

describe('the longest run of atoms (engine-guard.ts)', () => {
  it('bounds chains, rings and fused rings by their size, and trees by their longest route', () => {
    expect(longestPathBound(molfileGraph(chain(1000))!)).toBe(1000);
    expect(longestPathBound(molfileGraph(ring(1000))!)).toBe(1000);
    expect(longestPathBound(molfileGraph(acene(249))!)).toBe(998);
    // a 1,023-atom dendrimer of depth 9: its longest route is 19 atoms
    expect(longestPathBound(molfileGraph(dendrimer(9))!)).toBe(19);
    // a chain with rings strung along it: rings whole, chain bonds one atom each
    expect(longestPathBound(smilesGraph('C1CC1CC1CCC1C'))).toBe(3 + 1 + 4 + 1);
    expect(longestPathBound(smilesGraph('CC(C)(C)C'))).toBe(3);
    expect(longestPathBound({ n: 0, edges: [] })).toBe(0);
  });
  it('reads V2000 and V3000 molfiles and SMILES the same way', () => {
    const v2 = RDKit.get_mol('C1CCCCC1CCO').get_molblock();
    expect(molfileGraph(v2)!.n).toBe(9);
    expect(longestPathBound(molfileGraph(v2)!)).toBe(9);
    expect(longestPathBound(smilesGraph('C1CCCCC1CCO'))).toBe(9);
    expect(smilesGraph('[NH4+].[Cl-]').edges).toEqual([]);
    expect(smilesGraph('c1ccc2ccccc2c1').edges.length).toBe(11);
  });
  it('lets ordinary and branched big structures through, and holds back long runs', () => {
    expect(tooDeep('C'.repeat(DEEP_LIMIT))).toBe(false);
    expect(tooDeep('C'.repeat(DEEP_LIMIT + 1))).toBe(true);
    expect(tooDeep(chain(1000))).toBe(true);
    expect(tooDeep(ring(1000))).toBe(true);
    expect(tooDeep(acene(249))).toBe(true);
    expect(tooDeep(dendrimer(9))).toBe(false);
    expect(tooDeep(chain(300))).toBe(false);
    expect(tooDeep('')).toBe(false);
  });
});

describe('the worker on very big structures', () => {
  it('a 1,000-atom chain: formula and masses, SI facts and pieces, then a small request still answers', () => {
    const t0 = performance.now();
    const a = ask({ type: 'analyze', id: 1, mols: [{ molblock: chain(1000), map: [] }] });
    expect(a.type).toBe('analyze');
    if (a.type !== 'analyze') return;
    expect(a.results[0].formula).toBe('C1000H2002');
    expect(a.results[0].smiles).toBe('');
    stillWorks();
    const f = ask({ type: 'siFacts', id: 2, mols: [chain(1000)] });
    expect(f.type).toBe('siFacts');
    if (f.type !== 'siFacts') return;
    expect(f.results[0]!.info!.formula).toBe('C1000H2002');
    expect(f.results[0]!.pieces.length).toBe(1);
    // CH3, then CH2 1 to 499 away from the end: 500 classes
    expect(f.results[0]!.uniqueCarbons).toBe(500);
    stillWorks();
    // (G4-08: the symmetry classes no longer take seconds at this size)
    expect(performance.now() - t0).toBeLessThan(15000);
  }, 30000);
  it('a 1,000-atom ring and a 998-atom fused ring system answer too', () => {
    const r = ask({ type: 'siFacts', id: 3, mols: [ring(1000), acene(249)] });
    if (r.type !== 'siFacts') throw new Error(r.type);
    expect(r.results[0]!.info!.formula).toBe('C1000H2000');
    expect(r.results[0]!.uniqueCarbons).toBe(1);
    expect(r.results[1]!.info!.formula).toBe('C998H1500');
    stillWorks();
  }, 30000);
  it('says why instead of writing SMILES for a long run, and keeps working', () => {
    expect(ask({ type: 'molToSmiles', id: 4, molblock: chain(700) })).toEqual({ type: 'error', id: 4, message: TOO_DEEP });
    expect(ask({ type: 'smilesToMol', id: 5, smiles: 'C'.repeat(1000) })).toEqual({ type: 'error', id: 5, message: TOO_DEEP });
    expect(ask({ type: 'props', id: 6, mols: [chain(700), 'CCO'] })).toMatchObject({ results: [{ error: TOO_DEEP }, { formula: 'C2H6O' }] });
    stillWorks();
  });
});

describe('2-D layouts for Clean Up (review F4-R04)', () => {
  it('finds a macrocycle by its smallest ring, not by the size of a ring system', () => {
    // CoordGen measured: a 34-atom ring 3.4 s, a 40-atom ring over 60 s; cyclosporin (a 33-atom
    // ring), β-cyclodextrin, C60 and a 10-ring acene under half a second
    const ringSmiles = (n: number) => `C1${'C'.repeat(n - 2)}C1`;
    expect(hasMacrocycle(smilesGraph(ringSmiles(40)))).toBe(true);
    expect(hasMacrocycle(smilesGraph(ringSmiles(36)))).toBe(false);
    expect(hasMacrocycle(smilesGraph('C'.repeat(300)))).toBe(false);
    expect(hasMacrocycle(molfileGraph(acene(20))!)).toBe(false);
    expect(hasMacrocycle(smilesGraph('c12c3c4c5c1c1c6c7c2c2c8c3c3c9c4c4c%10c5c5c1c1c6c6c%11c7c2c2c7c8c3c3c8c9c4c4c9c%10c5c5c1c1c6c6c%11c2c2c7c3c3c8c4c4c9c5c1c1c6c2c3c41'))).toBe(false);
    // a 30-atom ring fused to a benzene: the big ring's own bonds have no smaller way round
    expect(hasMacrocycle(smilesGraph(`c1ccc2c(c1)CCCCCCCCCCCCCCCCCCCCCCCCCCCC2`))).toBe(false);
    expect(hasMacrocycle(smilesGraph(`c1ccc2c(c1)${'C'.repeat(40)}2`))).toBe(true);
  });
  it('gives no layouts for a long chain (which breaks the engine) and the classic one only for a big ring', () => {
    // a 900-atom chain broke set_new_coords ("memory access out of bounds")
    expect(ask({ type: 'layouts', id: 20, molblock: chain(900) })).toEqual({ type: 'layouts', id: 20, coords: [] });
    stillWorks();
    // a 60-atom ring: CoordGen would run for minutes; the classic layout comes back at once
    const t0 = performance.now();
    const r = ask({ type: 'layouts', id: 21, molblock: ring(60) });
    expect(r.type === 'layouts' && r.coords.length).toBe(1);
    expect(performance.now() - t0).toBeLessThan(10000);
    // a small structure still gets both
    const both = ask({ type: 'layouts', id: 22, molblock: RDKit.get_mol('c1ccccc1CCO').get_molblock() });
    expect(both.type === 'layouts' && both.coords.length).toBe(2);
    stillWorks();
  }, 30000);
});
