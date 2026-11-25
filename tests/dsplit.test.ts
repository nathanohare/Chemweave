// @vitest-environment jsdom
//
// d-Orbital splitting diagrams (src/design/dsplit.ts): an MO diagram with MoSpec.dsplit. The
// expected values come from Miessler, Fischer and Tarr, Inorganic Chemistry, 5th ed. (Pearson,
// 2014), chapter 10, never from running the code: cited at each one ("MFT", book page numbers).
import { describe, expect, it } from 'vitest';
import { D_GEOMETRIES, dCount, dFill, dReadout, deltaMarkup, dShell, fromDSplit, lfseMarkup, newDSplit, parseIon, readoutLines, setDSplit, spinMatters, splitLevels, type DSplit } from '../src/design/dsplit';
import { drawMo, moCaptionRoles, moPlain, withLevel, type MoSpec } from '../src/design/mo';
import { Doc } from '../src/model';
import { ACS_1996 } from '../src/style';
import { POINTS } from '../src/editor/arrange';
import { newDSplitPlate, putPlate } from '../src/design/plates';
import { writeCdxml } from '../src/io/cdxml-write';
import { readCdxml } from '../src/io/cdxml';
import { writePptx, type PptxOptions } from '../src/io/pptx-write';
import { readPptx } from '../src/io/pptx-read';

const oh = (d: number, spin: 'high' | 'low'): MoSpec => fromDSplit({ geometry: 'oh', ion: 'M', d, spin, label: 'Δ_{o}', arrow: true, readouts: true });
const td = (d: number, spin: 'high' | 'low' = 'high'): MoSpec => fromDSplit({ geometry: 'td', ion: 'M', d, spin, label: 'Δ_{t}', arrow: true, readouts: true });
const config = (spec: MoSpec) => splitLevels(spec).map((l) => `${moPlain(l.label)}${l.electrons}`).join(' ');

describe('the metal ion', () => {
  it('gives the d electrons from the group and charge', () => {
    // MFT Table 10.6, p. 374: the aqua ions listed by d count
    const table: [string, number][] = [
      ['Ti3+', 1], ['V3+', 2], ['V2+', 3], ['Cr3+', 3], ['Cr2+', 4], ['Mn3+', 4], ['Mn2+', 5], ['Fe3+', 5],
      ['Fe2+', 6], ['Co3+', 6], ['Co2+', 7], ['Ni3+', 7], ['Ni2+', 8], ['Cu2+', 9], ['Zn2+', 10],
    ];
    for (const [ion, d] of table) { const p = parseIon(ion)!; expect(dCount(p.z, p.charge), ion).toBe(d); }
    // MFT Table 10.3, p. 361, lists V⁴⁺ and Cu²⁺ with one unpaired electron (d¹, d⁹) and Mn²⁺, Fe³⁺ with five (d⁵)
    const v4 = parseIon('V4+')!;
    expect(dCount(v4.z, v4.charge)).toBe(1);
  });

  it('reads the ways an ion is written, and names the d shell by row', () => {
    for (const t of ['Co3+', 'Co^{3+}', 'Co³⁺', 'Co+3', 'Co(III)', 'Co 3+']) expect(parseIon(t), t).toEqual({ symbol: 'Co', z: 27, charge: 3 });
    expect(parseIon('Cu+')).toEqual({ symbol: 'Cu', z: 29, charge: 1 });
    expect(parseIon('Xx3+')).toBeNull();
    expect(parseIon('hello')).toBeNull();
    // first, second and third transition series (MFT Figure 10.14 labels the first row's metal d orbitals 3d)
    expect(dShell(parseIon('Co3+')!.z)).toBe('3d');
    expect(dShell(parseIon('Pd2+')!.z)).toBe('4d');
    expect(dShell(parseIon('Pt2+')!.z)).toBe('5d');
    // not a d-block element
    const na = parseIon('Na+')!;
    expect(dCount(na.z, na.charge)).toBeNull();
  });
});

describe('octahedral filling and LFSE (MFT Table 10.7, p. 375)', () => {
  // [d, LFSE in fifths of Δo, unpaired] for the weak-field (high-spin) and strong-field (low-spin) arrangements
  const weak: [number, number, number][] = [[1, -2, 1], [2, -4, 2], [3, -6, 3], [4, -3, 4], [5, 0, 5], [6, -2, 4], [7, -4, 3], [8, -6, 2], [9, -3, 1], [10, 0, 0]];
  const strong: [number, number, number][] = [[1, -2, 1], [2, -4, 2], [3, -6, 3], [4, -8, 2], [5, -10, 1], [6, -12, 0], [7, -9, 1], [8, -6, 2], [9, -3, 1], [10, 0, 0]];
  it('matches the weak-field arrangements', () => {
    for (const [d, lfse, unpaired] of weak) { const r = dReadout(oh(d, 'high')); expect([r.lfse, r.unpaired], `d${d}`).toEqual([lfse, unpaired]); }
  });
  it('matches the strong-field arrangements', () => {
    for (const [d, lfse, unpaired] of strong) { const r = dReadout(oh(d, 'low')); expect([r.lfse, r.unpaired], `d${d}`).toEqual([lfse, unpaired]); }
  });
  it('gives the configurations of the table', () => {
    // Table 10.7's arrows: d⁶ strong field t2g⁶, weak field t2g⁴eg²; d⁴ weak field t2g³eg¹; d⁷ strong field t2g⁶eg¹
    expect(config(oh(6, 'low'))).toBe('t2g6 eg0');
    expect(config(oh(6, 'high'))).toBe('t2g4 eg2');
    expect(config(oh(4, 'high'))).toBe('t2g3 eg1');
    expect(config(oh(7, 'low'))).toBe('t2g6 eg1');
  });
  it('says spin makes a difference only from d⁴ to d⁷', () => {
    // p. 375: "For one to three and eight to ten electrons, there is no difference" between the arrangements
    const sets = D_GEOMETRIES[0].sets;
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].filter((d) => spinMatters(sets, d))).toEqual([4, 5, 6, 7]);
  });
  it('writes the LFSE in fifths, as the table does', () => {
    expect(lfseMarkup(-12, 'Δ_{o}')).toBe('−12/5 Δ_{o}');
    expect(lfseMarkup(-10, 'Δ_{o}')).toBe('−10/5 Δ_{o}');
    expect(lfseMarkup(0, 'Δ_{o}')).toBe('0');
  });
});

describe('tetrahedral', () => {
  it('puts e below t2 and allows two spins only from d³ to d⁶', () => {
    // MFT section 10.3.5 and Figure 10.18, p. 381: e lower, t2 higher; p. 396: high and low spin
    // are possible in a tetrahedral field for d³ to d⁶
    const g = D_GEOMETRIES.find((x) => x.id === 'td')!;
    expect(g.sets.map((s) => moPlain(s.label))).toEqual(['e', 't2']);
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].filter((d) => spinMatters(g.sets, d))).toEqual([3, 4, 5, 6]);
  });
  it('fills Co²⁺ (d⁷) high spin with three unpaired electrons', () => {
    // MFT Table 10.3, p. 361: Co²⁺, n = 3, μS = 3.87 μB
    const r = dReadout(td(7));
    expect(config(td(7))).toBe('e4 t23');
    expect(r.unpaired).toBe(3);
    expect(r.moment.toFixed(2)).toBe('3.87');
  });
  it('gives the LFSE in fifths of Δt', () => {
    // Worked by hand from MFT's definition (section 10.3.3, p. 374: each electron's energy relative
    // to the average of the five orbitals) with the tetrahedral order of Figure 10.18: two e
    // orbitals at −3/5 Δt and three t2 at +2/5 Δt average to zero. High spin d⁷ (e⁴t2³):
    // 4(−3/5) + 3(+2/5) = −6/5 Δt; d⁵ (e²t2³): 0; d¹ (e¹): −3/5; d² (e²): −6/5; d³ (e²t2¹): −4/5
    expect(dReadout(td(7)).lfse).toBe(-6);
    expect(dReadout(td(5)).lfse).toBe(0);
    expect([1, 2, 3].map((d) => dReadout(td(d)).lfse)).toEqual([-3, -6, -4]);
  });
});

describe('square planar', () => {
  it('puts dx²−y² (b1g) far above the rest and gives no LFSE', () => {
    // MFT p. 379 and Figure 10.16: x² − y² ≫ z² > xz, yz > xy
    const sq = fromDSplit({ geometry: 'sq', ion: 'Ni^{2+}', d: 8, spin: 'low', label: 'Δ_{1}', arrow: true, readouts: true });
    expect(splitLevels(sq).map((l) => moPlain(l.label))).toEqual(['b2g', 'eg', 'a1g', 'b1g']);
    // p. 380: Ni²⁺ and Pt²⁺ (d⁸) square-planar complexes are diamagnetic, b1g empty
    const r = dReadout(sq);
    expect(r.unpaired).toBe(0);
    expect(splitLevels(sq).at(-1)!.electrons).toBe(0);
    expect(r.lfse).toBeNull();
    // and a diagram turned square planar starts low spin, even from a high-spin tetrahedral one
    expect(setDSplit(setDSplit(newDSplit(), { geometry: 'td' }), { geometry: 'sq' }).dsplit!.spin).toBe('low');
    expect(readoutLines(sq)[1]).toBe('μ_{S} = 0.00 μ_{B}');
  });
});

describe('spin-only moment (MFT Table 10.3, p. 361: μS for n = 1 to 5)', () => {
  it('is √(n(n + 2)) to two decimals', () => {
    // n unpaired from Table 10.7's weak-field d¹ to d⁵
    const want = ['1.73', '2.83', '3.87', '4.90', '5.92'];
    for (let n = 1; n <= 5; n++) expect(dReadout(oh(n, 'high')).moment.toFixed(2), `n = ${n}`).toBe(want[n - 1]);
  });
});

describe('the diagram', () => {
  it('starts as Co³⁺, octahedral, low spin, with the free ion labeled 3d', () => {
    const spec = newDSplit();
    expect(spec.dsplit).toMatchObject({ geometry: 'oh', ion: 'Co^{3+}', d: 6, spin: 'low', label: 'Δ_{o}' });
    const ion = spec.levels.find((l) => l.column === 'left')!;
    expect([ion.label, ion.n, ion.electrons]).toEqual(['3d', 5, 6]);
    expect(spec.titles).toEqual(['Co^{3+} free ion', 'Octahedral', '']);
    // the split levels average (weighted by their orbitals) to the free ion's place: the barycenter
    const split = splitLevels(spec);
    expect(split.reduce((t, l) => t + l.n * l.e, 0) / 5).toBeCloseTo(ion.e, 2);
    expect(readoutLines(spec)).toEqual(['Low spin d^{6}, 0 unpaired', 'LFSE = −12/5 Δ_{o}']);
  });

  it('fills in from a typed ion, and the d count can still be changed by hand', () => {
    let spec = setDSplit(newDSplit(), { ion: 'Fe2+' });
    expect(spec.dsplit!.ion).toBe('Fe^{2+}');
    expect(spec.dsplit!.d).toBe(6);
    spec = setDSplit(spec, { ion: 'Pd2+' });
    expect(spec.dsplit!.d).toBe(8);
    expect(spec.levels.find((l) => l.column === 'left')!.label).toBe('4d');
    spec = setDSplit(spec, { d: 3 });
    expect(spec.dsplit!.d).toBe(3);
    expect(spec.dsplit!.ion).toBe('Pd^{2+}');
    expect(dReadout(spec).electrons).toBe(3);
    // text that is no ion is kept and changes nothing else
    const odd = setDSplit(spec, { ion: 'M' });
    expect(odd.dsplit!.ion).toBe('M');
    expect(odd.dsplit!.d).toBe(3);
  });

  it('turns tetrahedral high spin with Δt, and back to Δo', () => {
    const t = setDSplit(newDSplit(), { geometry: 'td' });
    expect(t.dsplit).toMatchObject({ geometry: 'td', spin: 'high', label: 'Δ_{t}' });
    expect(t.titles[1]).toBe('Tetrahedral');
    expect(setDSplit(t, { geometry: 'oh' }).dsplit!.label).toBe('Δ_{o}');
    // a label typed by hand stays
    const own = setDSplit(setDSplit(newDSplit(), { label: 'Δ_{oct}' }), { geometry: 'td' });
    expect(own.dsplit!.label).toBe('Δ_{oct}');
    expect(deltaMarkup('Δo')).toBe('Δ_{o}');
    expect(deltaMarkup('10Dq')).toBe('10Dq');
  });

  it('keeps dragged levels when the spin changes, and the readout follows the electrons drawn', () => {
    const spec = newDSplit();
    const eg = spec.levels.findIndex((l) => moPlain(l.label) === 'eg');
    const dragged = withLevel(spec, eg, { e: 0.7 });
    const hs = setDSplit(dragged, { spin: 'high' });
    expect(hs.levels[eg].e).toBe(0.7);
    expect(config(hs)).toBe('t2g4 eg2');
    // an electron clicked off by hand: the readout says so, and no longer names a spin
    // (t2g⁴eg¹ is neither d⁵ arrangement of Table 10.7: high spin t2g³eg², low spin t2g⁵)
    const clicked = withLevel(hs, eg, { electrons: 1 });
    expect(dReadout(clicked).electrons).toBe(5);
    expect(readoutLines(clicked)[0]).toBe('d^{5}, 3 unpaired');
  });

  it('draws the arrow, its label and the readouts after the captions an MO diagram names', () => {
    const d = new Doc();
    d.style = { ...ACS_1996 };
    const spec = newDSplit();
    let parts: ReturnType<typeof drawMo> | undefined;
    d.edit('Draw', () => { parts = drawMo(d, POINTS, spec, { x: 0, y: 0 }, 300, 220); });
    const roles = moCaptionRoles(spec);
    const texts = parts!.captions.map((id) => d.captions.get(id)!.runs.map((r) => r.text).join(''));
    expect(texts.length).toBe(roles.length + 3);
    expect(texts.slice(roles.length)).toEqual(['Δo', 'Low spin d6, 0 unpaired', 'LFSE = −12/5 Δo']);
    // the splitting arrow has a head at both ends
    const arrows = parts!.arrows.map((id) => d.arrows.get(id)!);
    expect(arrows.some((a) => a.headStyle === 'full' && a.tailStyle === 'full')).toBe(true);
    // without the extras, only the MO diagram's captions
    const plain = { ...spec, dsplit: { ...spec.dsplit!, arrow: false, readouts: false } as DSplit };
    d.edit('Draw', () => { parts = drawMo(d, POINTS, plain, { x: 0, y: 0 }, 300, 220); });
    expect(parts!.captions.length).toBe(moCaptionRoles(plain).length);
  });

  it('fills high spin one electron to an orbital first', () => {
    expect(dFill([{ n: 3 }, { n: 2 }], 4, 'high')).toEqual([3, 1]);
    expect(dFill([{ n: 3 }, { n: 2 }], 4, 'low')).toEqual([4, 0]);
  });
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 2, 0, 0, 0, 1]);
const pptxOpts: PptxOptions = { async picture() { return null; }, async svgToPng() { return PNG; } };

describe('saving', () => {
  const made = () => {
    const doc = new Doc();
    doc.style = { ...ACS_1996 };
    const d = newDSplitPlate(doc.style.bondLength);
    d.mo = setDSplit(setDSplit(d.mo!, { geometry: 'td', ion: 'Co2+' }), { barycenter: true, label: 'Δ_{tet}' });
    doc.edit('d-Orbital Splitting', () => { putPlate(doc, POINTS, d, { x: 100, y: 100 }); });
    return { doc, mo: d.mo };
  };

  it('keeps the diagram and its choices through CDXML', () => {
    const { doc, mo } = made();
    const back = readCdxml(writeCdxml(doc, { name: 't.cdxml' })).doc;
    const f = [...back.shapes.values()].find((s) => s.plate?.mo)!;
    expect(f.plate!.mo!.dsplit).toEqual(mo.dsplit);
    expect(f.plate!.mo!.levels).toEqual(mo.levels);
  });

  it('keeps the diagram and its choices through PowerPoint', async () => {
    const { doc, mo } = made();
    const { Deck } = await import('../src/deck/deck');
    const deck = Deck.blank(new Doc());
    const file = await writePptx({ slides: [{ layout: 'blank', doc, notes: '' }], size: deck.size, master: deck.master }, pptxOpts);
    const f = readPptx(file).slides[0].contents.shapes.find((s) => s.plate?.mo)!;
    expect(f.plate!.mo!.dsplit).toEqual(mo.dsplit);
    expect(f.plate!.mo!.levels.map((l) => l.lf)).toEqual(mo.levels.map((l) => l.lf));
  });

  it('opens an MO diagram saved before d-orbital splitting as it was', () => {
    const doc = new Doc();
    doc.style = { ...ACS_1996 };
    const old = JSON.parse(JSON.stringify(newDSplitPlate(10)));
    delete old.mo.dsplit;
    for (const l of old.mo.levels) delete l.lf;
    doc.edit('MO', () => { putPlate(doc, POINTS, old, { x: 0, y: 0 }); });
    const back = readCdxml(writeCdxml(doc, { name: 't.cdxml' })).doc;
    const f = [...back.shapes.values()].find((s) => s.plate?.mo)!;
    expect(f.plate!.mo!.dsplit).toBeUndefined();
    expect(f.name).toBe('MO diagram');
  });
});
