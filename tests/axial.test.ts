import { describe, it, expect } from 'vitest';
import { axialTags } from '../src/chem/axial';

type A = [string, number, number];
type B = [number, number, number, number?]; // 1-based atoms, order, stereo (1 wedge, 6 hash) from the first atom

function mol(atoms: A[], bonds: B[]): string {
  const f = (v: number) => v.toFixed(4).padStart(10);
  const i3 = (v: number) => String(v).padStart(3);
  return ['t', '  test', '', `${i3(atoms.length)}${i3(bonds.length)}  0  0  0  0  0  0  0  0999 V2000`,
    ...atoms.map(([s, x, y]) => `${f(x)}${f(y)}${f(0)} ${s.padEnd(3)} 0  0  0  0  0  0  0  0  0  0  0  0`),
    ...bonds.map(([a, b, o, st]) => `${i3(a)}${i3(b)}${i3(o)}${i3(st ?? 0)}`), 'M  END', ''].join('\n');
}

const mirror = (atoms: A[]): A[] => atoms.map(([s, x, y]) => [s, -x, y]);
const rotate = (atoms: A[], t: number): A[] => atoms.map(([s, x, y]) => [s, x * Math.cos(t) - y * Math.sin(t), x * Math.sin(t) + y * Math.cos(t)]);
const flipWedges = (bonds: B[]): B[] => bonds.map(([a, b, o, st]) => [a, b, o, st === 1 ? 6 : st === 6 ? 1 : st]);

// 1,3-dichloroallene: Cl in the page on the left end, Cl wedged on the right end
const alleneAtoms: A[] = [['C', 0, 0], ['C', 1, 0], ['C', 2, 0], ['Cl', -0.5, 0.87], ['Cl', 2.5, 0.87]];
const alleneBonds: B[] = [[1, 2, 2], [2, 3, 2], [1, 4, 1], [3, 5, 1, 1]];

// 2,2'-disubstituted biphenyl drawn flat: ring 1 (atoms 1-6) carries OMe at C2, ring 2 (7-12) a Me
// at C2' drawn with a wedge from the ring atom, so ring 2 stands across the page
function biaryl(): { atoms: A[]; bonds: B[] } {
  const atoms: A[] = [];
  const ring = (cx: number, cy: number, start: number) => {
    for (let k = 0; k < 6; k++) atoms.push(['C', cx + Math.cos(start + (k * Math.PI) / 3), cy + Math.sin(start + (k * Math.PI) / 3)]);
  };
  ring(0, 0, 0); // atom 1 at (1, 0): the axis end
  ring(3, 0, Math.PI); // atom 7 at (2, 0)
  atoms.push(['O', 1.5 + 0.0, 1.9], ['C', 1.2, 2.8]); // 13, 14: OMe on atom 2 (0.5, 0.87)
  atoms.push(['C', 2.5, 1.9]); // 15: Me on atom 8 (2.5, 0.87)
  const bonds: B[] = [];
  for (let k = 0; k < 6; k++) bonds.push([1 + k, 1 + ((k + 1) % 6), k % 2 ? 1 : 2]);
  for (let k = 0; k < 6; k++) bonds.push([7 + k, 7 + ((k + 1) % 6), k % 2 ? 1 : 2]);
  bonds.push([1, 7, 1], [2, 13, 1], [13, 14, 1], [8, 15, 1, 1]);
  return { atoms, bonds };
}


// (R)-BINOL as it is in the crystal: Mori, Masuda and Kashino, "(+)-(R)- and racemic forms of
// 2,2'-dihydroxy-1,1'-binaphthyl", Acta Cryst. C 1993, 49, 1224 (doi 10.1107/S0108270193000083;
// COD 2001650, space group P3₁, a = b = 10.808, c = 10.883 Å, γ = 120°). The fractional
// coordinates of the heavy atoms, numbered as in the paper (O1 on C2, O2 on C12; C1–C11 is the axis).
const BINOL_R: Record<string, [number, number, number]> = {
  O1: [0.4028, 0.2926, 0.5348], O2: [0.5488, 0.2585, 0.8018],
  C1: [0.3997, 0.4035, 0.7263], C2: [0.3311, 0.3150, 0.6274], C3: [0.1810, 0.2431, 0.6169], C4: [0.1017, 0.2608, 0.7033],
  C5: [0.0834, 0.3741, 0.8953], C6: [0.1477, 0.4660, 0.9899], C7: [0.2967, 0.5395, 1.0015], C8: [0.3794, 0.5200, 0.9167],
  C9: [0.3167, 0.4253, 0.8164], C10: [0.1655, 0.3527, 0.8052], C11: [0.5588, 0.4762, 0.7343], C12: [0.6243, 0.4007, 0.7708],
  C13: [0.7743, 0.4660, 0.7752], C14: [0.8571, 0.6036, 0.7397], C15: [0.8792, 0.8290, 0.6520], C16: [0.8161, 0.9024, 0.6122],
  C17: [0.6688, 0.8411, 0.6165], C18: [0.5856, 0.7040, 0.6566], C19: [0.6447, 0.6211, 0.6971], C20: [0.7964, 0.6857, 0.6973],
};
// the paper's bonds, as one Kekulé structure of each naphthalene
const BINOL_BONDS: [string, string, number][] = [
  ['C1', 'C2', 2], ['C2', 'C3', 1], ['C3', 'C4', 2], ['C4', 'C10', 1], ['C10', 'C9', 2], ['C9', 'C1', 1],
  ['C9', 'C8', 1], ['C8', 'C7', 2], ['C7', 'C6', 1], ['C6', 'C5', 2], ['C5', 'C10', 1],
  ['C11', 'C12', 2], ['C12', 'C13', 1], ['C13', 'C14', 2], ['C14', 'C20', 1], ['C20', 'C19', 2], ['C19', 'C11', 1],
  ['C19', 'C18', 1], ['C18', 'C17', 2], ['C17', 'C16', 1], ['C16', 'C15', 2], ['C15', 'C20', 1],
  ['O1', 'C2', 1], ['C1', 'C11', 1],
];

/**
 * The crystal's molecule drawn as a chemist would: the C1 naphthalene in the page with the axis
 * across it, the C11 naphthalene turned about the axis into the page too, and the bond from C12
 * to its OH a wedge when C12 really stands toward the viewer (a hash when away). `flip` mirrors
 * the crystal first (the (S) enantiomer).
 */
function binolDrawing(flip = false): string {
  const a = 10.808, c = 10.883;
  const cart = (f: [number, number, number]): number[] => [a * (f[0] - f[1] / 2), (a * f[1] * Math.sqrt(3)) / 2, c * f[2] * (flip ? -1 : 1)];
  const P = Object.fromEntries(Object.entries(BINOL_R).map(([k, f]) => [k, cart(f)]));
  const sub = (u: number[], v: number[]) => u.map((x, i) => x - v[i]);
  const dot = (u: number[], v: number[]) => u.reduce((s, x, i) => s + x * v[i], 0);
  const unit = (u: number[]) => u.map((x) => x / Math.hypot(...u));
  const cross = (u: number[], v: number[]) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  // the frame: x along C1 → C11, y toward C2 in the C1 ring's plane, z toward the viewer
  const ex = unit(sub(P.C11, P.C1));
  const c2 = sub(P.C2, P.C1);
  const ey = unit(sub(c2, ex.map((x) => x * dot(c2, ex))));
  const ez = cross(ex, ey);
  const local = (p: number[]) => { const d = sub(p, P.C1); return [dot(d, ex), dot(d, ey), dot(d, ez)]; };
  const L = Object.fromEntries(Object.keys(P).map((k) => [k, local(P[k])]));
  // C12 toward the viewer or away, then the C11 ring turned about the axis into the page (C12 up)
  const towardViewer = L.C12[2] > 0;
  const turn = Math.atan2(L.C12[2], L.C12[1]);
  const far = new Set(['O2', 'C11', 'C12', 'C13', 'C14', 'C15', 'C16', 'C17', 'C18', 'C19', 'C20']);
  const flat = (k: string): [number, number] => {
    const [x, y, z] = L[k];
    if (!far.has(k)) return [x, y];
    return [x, y * Math.cos(-turn) - z * Math.sin(-turn)];
  };
  const names = Object.keys(BINOL_R);
  const atoms: A[] = names.map((k) => [k[0], ...flat(k)] as A);
  const bonds: B[] = BINOL_BONDS.map(([u, v, o]) => [names.indexOf(u) + 1, names.indexOf(v) + 1, o]);
  bonds.push([names.indexOf('C12') + 1, names.indexOf('O2') + 1, 1, towardViewer ? 1 : 6]);
  return mol(atoms, bonds);
}

const label = (atoms: A[], bonds: B[]) => {
  const t = axialTags(mol(atoms, bonds));
  return [...t.bonds.map((b) => b[2]), ...t.atoms.map((a) => a[1])];
};

describe('axial chirality', () => {
  it('labels an allene, looking along the axis (near groups first)', () => {
    // seen from the left end: Cl (left of the axis), H (right), then the far Cl above: anticlockwise
    expect(axialTags(mol(alleneAtoms, alleneBonds)).atoms).toEqual([[1, 'Sa']]);
  });
  it('gives the mirror image the other label, whichever way it is mirrored', () => {
    expect(label(alleneAtoms, flipWedges(alleneBonds))).toEqual(['Ra']);
    expect(label(mirror(alleneAtoms), alleneBonds)).toEqual(['Ra']);
  });
  it('gives the same label however the drawing is turned or numbered', () => {
    for (const t of [0.4, 1.9, 3.1, 4.4]) expect(label(rotate(alleneAtoms, t), alleneBonds)).toEqual(['Sa']);
    // the same allene with its atoms listed from the other end
    const order = [3, 2, 1, 5, 4];
    const at = order.map((i) => alleneAtoms[i - 1]);
    const re = (i: number) => order.indexOf(i) + 1;
    const bonds: B[] = alleneBonds.map(([a, b, o, st]) => [re(a), re(b), o, st]);
    expect(label(at, bonds)).toEqual(['Sa']);
  });
  it('gives the same label when the wedge is on the other end instead', () => {
    // the right end in the page, the left Cl standing up toward the viewer… is a different
    // drawing of one of the two enantiomers; turning the molecule 90° about the axis maps
    // "left Cl in page, right Cl up" onto "left Cl down, right Cl in page"
    const bonds: B[] = [[1, 2, 2], [2, 3, 2], [1, 4, 1, 6], [3, 5, 1]];
    expect(label(alleneAtoms, bonds)).toEqual(['Sa']);
  });
  it('gives no label without a wedge, or when an end has two of the same group', () => {
    expect(label(alleneAtoms, alleneBonds.map(([a, b, o]) => [a, b, o]))).toEqual([]);
    const sym: A[] = [...alleneAtoms, ['Cl', -0.5, -0.87]];
    expect(label(sym, [...alleneBonds, [1, 6, 1]])).toEqual([]);
  });
  it('labels a biaryl whichever Kekulé structure is drawn, and its mirror image the other way', () => {
    const { atoms, bonds } = biaryl();
    const l = label(atoms, bonds);
    // By hand (IUPAC 2013 P-93.5.1.1: near groups rank before far ones, then by CIP): seen along
    // the axis from ring 1, near C2 (O, C, C) is 1 at the top and C6 (C, C, H) 2 at the bottom; far
    // C8 (C, C, C), wedged toward the viewer, is 3, on the right. 1 → 2 → 3 turns anticlockwise: Sa.
    expect(l).toEqual(['Sa']);
    const other = bonds.map(([a, b, o, st]) => (a <= 12 && b <= 12 && !(a === 1 && b === 7) ? [a, b, o === 2 ? 1 : 2, st] : [a, b, o, st]) as B);
    expect(label(atoms, other)).toEqual(l);
    expect(label(atoms, flipWedges(bonds))).toEqual([l[0] === 'Ra' ? 'Sa' : 'Ra']);
    expect(label(mirror(atoms), bonds)).toEqual([l[0] === 'Ra' ? 'Sa' : 'Ra']);
  });
  it('labels (R)-BINOL Ra, drawn from its crystal structure, and its mirror image Sa', () => {
    // the paper's title gives the configuration: (+)-(R); IUPAC 2013 P-93.5.1.1 writes it Ra
    const r = axialTags(binolDrawing());
    expect(r.bonds.map((b) => b[2])).toEqual(['Ra']);
    expect(axialTags(binolDrawing(true)).bonds.map((b) => b[2])).toEqual(['Sa']);
  });
  it('reads a wedge on the ring bond the same as one on the substituent', () => {
    const { atoms, bonds } = biaryl();
    const l = label(atoms, bonds);
    // wedge from the axis atom to the substituted ring atom instead (bond 7-8)
    const moved = bonds.map(([a, b, o, st]) => (a === 8 && b === 15 ? [a, b, o] : a === 7 && b === 8 ? [7, 8, o, 1] : [a, b, o, st]) as B);
    expect(label(atoms, moved)).toEqual(l);
  });
  it('gives no label to a biaryl with no group next to the axis on one ring', () => {
    const { atoms, bonds } = biaryl();
    // move the Me from C2' to C4': ring 2 is the same on both sides of the axis
    const at = atoms.map((a, i) => (i === 14 ? ['C', 4.5, 1.9] : a) as A);
    const bs = bonds.map(([a, b, o, st]) => (a === 8 && b === 15 ? [10, 15, 1] : [a, b, o, st]) as B);
    bs.push([7, 8, 1, 1]);
    expect(label(at, bs.filter((b, i, all) => !(b[0] === 7 && b[1] === 8 && !b[3] && all.some((c) => c[0] === 7 && c[1] === 8 && c[3]))))).toEqual([]);
  });
});
