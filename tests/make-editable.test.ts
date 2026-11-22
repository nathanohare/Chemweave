// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readPng } from './png-pixels';
import type { ReadGraph } from '../src/recognise/molscribe';
import { readBonds, parseSymbol } from '../src/recognise/to-drawing';
import { bondLengthPx, labelSizePx, lineWidthPx, refineAtoms, strokeWidthPx, type MeasureBond } from '../src/recognise/measure';
import { editableFromGraph, editableFromParts, readFrame, snapLook, type PartRead } from '../src/recognise/editable';
import { partPixels, schemeParts } from '../src/recognise/leftover';
import { chemWord, findArrows, isFormula, textLineBoxes, textRuns, type ReadLine } from '../src/recognise/scheme-extras';
import { findFrames, withoutFrames } from '../src/recognise/frames';
import { isStructure, partGap } from '../src/ui/doc-make-editable';
import { ACS_1996 } from '../src/style';
import { STYLE_PRESETS } from '../src/drawing-styles';
import { structureDoc } from '../src/sheet/structure-doc';
import { bondWidths } from '../src/style';
import { writeDocx, readDocx, type DocxDeps } from '../src/io/docx';
import { newDocument, objectRun, paraFromStyle, runStyleOf, type DocText, type FromPicture } from '../src/document/document';
import * as rt from '../src/richtext';
import { writeCdxml } from '../src/io/cdxml-write';
import { readCdxml } from '../src/io/cdxml';

const DIR = join(__dirname, 'fixtures', 'make-editable');

interface Fixture { dpi: number; style: typeof ACS_1996; symbols: string[]; truth: [number, number][]; edges: number[][] }

function load(name: string) {
  const p = readPng(new Uint8Array(readFileSync(join(DIR, `${name}.png`))));
  const f = JSON.parse(readFileSync(join(DIR, `${name}.json`), 'utf8')) as Fixture;
  // what the reader would give: the atoms on its 64-step grid across its crop of the picture
  const frame = readFrame(p);
  const q = (v: number) => Math.round(v * 63) / 63;
  const g: ReadGraph = { smiles: '', symbols: f.symbols, edges: f.edges, atomScores: f.symbols.map(() => 1), confidence: 0.95,
    coords: f.truth.map(([x, y]) => [q((x - frame.x) / frame.w), q((y - frame.y) / frame.h)]) };
  const bonds: MeasureBond[] = readBonds(g).map(({ a, b, order, display }) => ({ a, b, order, display }));
  const labelled = g.symbols.map((s) => parseSymbol(s).z !== 6);
  const rough = g.coords.map(([x, y]) => [frame.x + x * frame.w, frame.y + y * frame.h] as [number, number]);
  const k = f.dpi / 72;
  return { p, f, g, frame, bonds, labelled, rough, k };
}

const worst = (a: [number, number][], b: [number, number][], only?: boolean[]) =>
  Math.max(...a.map((p, i) => (only && !only[i] ? 0 : Math.hypot(p[0] - b[i][0], p[1] - b[i][1]))));

describe('Make Editable: measuring a picture', () => {
  for (const name of ['acs-300dpi', 'acs-96dpi', 'heavy-150dpi']) {
    it(`${name}: atoms moved onto the lines, and the style measured`, () => {
      const { p, f, frame, bonds, labelled, rough, k } = load(name);
      const reach = Math.max(1.5, Math.max(frame.w, frame.h) / 64);
      const fixed = refineAtoms(p, rough, bonds, labelled, reach);
      const carbons = labelled.map((l) => !l);
      // the grid puts atoms up to half a step off; moved onto the lines they are within a pixel or so
      expect(worst(fixed, f.truth, carbons)).toBeLessThan(Math.max(1.6, worst(rough, f.truth, carbons) * 0.6));
      const bond = bondLengthPx(fixed, bonds)!;
      expect(bond / (f.style.bondLength * k)).toBeCloseTo(1, 1);
      const lw = lineWidthPx(p, fixed, bonds)!;
      expect(Math.abs(lw / (f.style.lineWidth * k) - 1)).toBeLessThan(0.2);
      const lab = labelSizePx(p, fixed, labelled, bond)!;
      expect(Math.abs(lab / (f.style.labelSize * k) - 1)).toBeLessThan(0.15);
      const sw = strokeWidthPx(p)!;
      expect(Math.abs(sw / (f.style.lineWidth * k) - 1)).toBeLessThan(0.35);
    });
  }

  it('takes an ACS picture as ACS 1996, at its size', () => {
    const { p, g, frame, k } = load('acs-300dpi');
    const e = editableFromGraph(g, p, frame, 1 / k, 'match', ACS_1996, STYLE_PRESETS);
    expect(e.look.preset).toBe('ACS Document 1996');
    expect(e.look.bondLength).toBeCloseTo(14.4, 0);
    expect(e.look.lineWidth! / e.look.bondLength).toBeCloseTo(0.6 / 14.4, 3);
    // drawn at the document's own settings: nothing of its own on the bonds but what ACS 1996 has anyway
    const b = e.contents.bonds[0];
    expect(b.s).toBeCloseTo(e.look.bondLength / 14.4, 1);
  });

  it('keeps a heavier style as measured, on each bond and atom', () => {
    const { p, g, frame, k, f } = load('heavy-150dpi');
    const e = editableFromGraph(g, p, frame, 1 / k, 'match', ACS_1996, STYLE_PRESETS);
    expect(e.look.preset).toBeUndefined();
    expect(Math.abs(e.look.bondLength / f.style.bondLength - 1)).toBeLessThan(0.05);
    for (const b of e.contents.bonds) {
      expect(b.bondLength).toBeCloseTo(e.look.bondLength, 1);
      expect(Math.abs((b.s! * ACS_1996.lineWidth) / f.style.lineWidth - 1)).toBeLessThan(0.2);
    }
    for (const a of e.contents.atoms) expect(Math.abs((a.s! * ACS_1996.labelSize) / f.style.labelSize - 1)).toBeLessThan(0.15);
    // the structure lies where the picture's atoms are: the first atom, in points
    const at0 = e.contents.atoms[0];
    expect(Math.hypot(at0.x - f.truth[0][0] / k, at0.y - f.truth[0][1] / k)).toBeLessThan(1.5);
    expect(e.at.w).toBeCloseTo(p.width / k, 3);
  });

  it('Use Default Style: the document bond length, nothing of its own', () => {
    const { p, g, frame, k } = load('heavy-150dpi');
    const e = editableFromGraph(g, p, frame, 1 / k, 'default', ACS_1996, STYLE_PRESETS);
    const lens = e.contents.bonds.map((b) => {
      const a1 = e.contents.atoms.find((a) => a.id === b.a1)!, a2 = e.contents.atoms.find((a) => a.id === b.a2)!;
      return Math.hypot(a1.x - a2.x, a1.y - a2.y);
    }).sort((x, y) => x - y);
    expect(lens[lens.length >> 1]).toBeCloseTo(14.4, 0);
    expect(e.contents.bonds.every((b) => b.s === undefined && b.bondLength === undefined)).toBe(true);
    expect(e.contents.atoms.every((a) => a.s === undefined)).toBe(true);
    // the picture shrinks with it, to stay over the atoms
    expect(e.at.w).toBeLessThan(p.width / k);
  });

  it('snaps only when both widths fit a journal style', () => {
    expect(snapLook({ bondLength: 28.8, lineWidth: 1.25, labelSize: 19.5 }, STYLE_PRESETS).preset).toBeDefined();
    expect(snapLook({ bondLength: 28.8, lineWidth: 3, labelSize: 19.5 }, STYLE_PRESETS).preset).toBeUndefined();
    expect(snapLook({ bondLength: 14.4, lineWidth: null, labelSize: null }, STYLE_PRESETS).preset).toBeUndefined();
  });
});

describe('Make Editable: saving', () => {
  const made = () => {
    const { p, g, frame, k } = load('heavy-150dpi');
    const e = editableFromGraph(g, p, frame, 1 / k, 'match', ACS_1996, STYLE_PRESETS);
    const bytes = readFileSync(join(DIR, 'heavy-150dpi.png'));
    const picture = { kind: 'picture' as const, src: `data:image/png;base64,${bytes.toString('base64')}`, w: p.width / k, h: p.height / k, px: { w: p.width, h: p.height } };
    const fromPicture: FromPicture = { picture, at: e.at, style: 'match', look: e.look, parts: [{ graph: { symbols: g.symbols, coords: g.coords, edges: g.edges, confidence: g.confidence }, frame }], px: { w: p.width, h: p.height } };
    return { e, fromPicture };
  };

  it('keeps the picture and the structure\'s own settings in a Word file', async () => {
    const { e, fromPicture } = made();
    const d = newDocument();
    const n = runStyleOf(d.styles.Normal);
    const N = paraFromStyle(d.styles.Normal, {});
    const t: DocText = { ...d, runs: rt.normalizeRuns([{ ...n, text: 'Before\n' }, objectRun(1, n), { ...n, text: '\nAfter' }]), paras: [N, N, N],
      objects: { 1: { kind: 'drawing', contents: e.contents, fromPicture } } };
    const deps: DocxDeps = { async picture() { return { png: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]), w: 100, h: 60 }; } };
    const { doc } = await readDocx(await writeDocx(t, deps));
    const o = Object.values(doc.objects).find((x) => x.kind === 'drawing');
    if (o?.kind !== 'drawing') throw new Error('no structure');
    // (numbers are saved to 9 figures)
    const nine = (x: unknown) => JSON.parse(JSON.stringify(x, (_k, v) => (typeof v === 'number' && !Number.isInteger(v) ? Number(v.toPrecision(9)) : v)));
    expect(o.fromPicture).toEqual(nine(fromPicture));
    expect(o.contents.bonds.map((b) => [b.s, b.bondLength])).toEqual(e.contents.bonds.map((b) => [b.s, b.bondLength]));
    expect(o.contents.atoms.map((a) => a.s)).toEqual(e.contents.atoms.map((a) => a.s));
  });

  it('saves to ChemDraw as a plain structure with its own settings', () => {
    const { e } = made();
    const doc = structureDoc(e.contents, ACS_1996);
    const back = readCdxml(writeCdxml(doc)).doc;
    const lw = [...back.bonds.values()].map((b) => bondWidths(back.style, b).lineWidth);
    const want = ACS_1996.lineWidth * e.contents.bonds[0].s!;
    for (const w of lw) expect(w).toBeCloseTo(want, 1);
    const own = [...back.bonds.values()].map((b) => bondWidths(back.style, b).bondLength);
    for (const l of own) expect(l).toBeCloseTo(e.look.bondLength, 0);
    expect(back.atoms.size).toBe(e.contents.atoms.length);
  });
});

describe('Make Editable: a picture of a scheme', () => {
  interface Scheme { dpi: number; structures: { symbols: string[]; truth: [number, number][]; edges: number[][] }[]; arrow: { x1: number; x2: number; y: number } }
  const p = readPng(new Uint8Array(readFileSync(join(DIR, 'scheme-150dpi.png'))));
  const f = JSON.parse(readFileSync(join(DIR, 'scheme-150dpi.json'), 'utf8')) as Scheme;
  const k = f.dpi / 72;
  const boxes = schemeParts(p, partGap(1 / k));
  // what the reader would read in each drawing found: the structure inside it, on its 64-step grid
  const reads = (): PartRead[] => (boxes ?? []).flatMap((box) => {
    const s = f.structures.find((st) => st.truth.every(([x, y]) => x > box.x && x < box.x + box.w && y > box.y && y < box.y + box.h));
    if (!s) return [];
    const sub = partPixels(p, box);
    const frame = readFrame(sub);
    const q = (v: number) => Math.round(v * 63) / 63;
    const graph: ReadGraph = { smiles: '', symbols: s.symbols, edges: s.edges, atomScores: s.symbols.map(() => 1), confidence: 0.9,
      coords: s.truth.map(([x, y]) => [q((x - box.x - frame.x) / frame.w), q((y - box.y - frame.y) / frame.h)]) };
    return [{ box, graph, frame }];
  });

  it('finds each structure as a drawing of its own', () => {
    expect(boxes).not.toBeNull();
    expect(reads()).toHaveLength(2);
  });

  it('puts each structure where it is in the picture', () => {
    const e = editableFromParts(reads(), p, 1 / k, 'match', ACS_1996, STYLE_PRESETS);
    const truth = f.structures.flatMap((s) => s.truth);
    expect(e.contents.atoms).toHaveLength(truth.length);
    const at = e.contents.atoms.map((a) => [a.x * k, a.y * k] as [number, number]);
    const off = Math.max(...at.map(([x, y]) => Math.min(...truth.map(([tx, ty]) => Math.hypot(x - tx, y - ty)))));
    expect(off).toBeLessThan(2);
    expect(e.look.preset).toBe('ACS Document 1996');
  });

  it('keeps the arrow, conditions and compound numbers as a picture behind, and rubs out the structures', () => {
    const e = editableFromParts(reads(), p, 1 / k, 'match', ACS_1996, STYLE_PRESETS);
    const rest = e.rest!;
    expect(rest).not.toBeNull();
    const pic = e.contents.shapes.find((s) => s.kind === 'picture');
    expect(pic?.src?.startsWith('data:image/png;base64,')).toBe(true);
    expect(pic!.x2 - pic!.x1).toBeCloseTo(p.width / k, 3);
    const darkAt = (q: typeof p, x: number, y: number) => {
      const i = (Math.round(y) * q.width + Math.round(x)) * 4;
      return q.data[i + 3] / 255 * (1 - (q.data[i] + q.data[i + 1] + q.data[i + 2]) / 765);
    };
    // the arrow's line is kept
    let arrow = 0;
    for (let x = f.arrow.x1 + 4; x < f.arrow.x2 - 12; x++) for (let dy = -2; dy <= 2; dy++) arrow = Math.max(arrow, darkAt(rest, x, f.arrow.y + dy));
    expect(arrow).toBeGreaterThan(0.5);
    // nothing is left on the structures' bonds
    let worst = 0;
    for (const s of f.structures) {
      s.edges.forEach((row, i) => row.forEach((t, j) => {
        if (j <= i || !t) return;
        const [ax, ay] = s.truth[i], [bx, by] = s.truth[j];
        for (let u = 0.3; u <= 0.7; u += 0.05) worst = Math.max(worst, darkAt(rest, ax + (bx - ax) * u, ay + (by - ay) * u));
      }));
    }
    expect(worst).toBeLessThan(0.1);
    // and the compound numbers (under each structure) are still there
    for (const s of f.structures) {
      const xs = s.truth.map((t) => t[0]), ys = s.truth.map((t) => t[1]);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2, y0 = Math.max(...ys) + 8 * k;
      let ink = 0;
      for (let y = y0; y < Math.min(p.height - 1, y0 + 20 * k); y++) for (let x = cx - 6 * k; x < cx + 6 * k; x++) ink += darkAt(rest, x, y);
      expect(ink).toBeGreaterThan(20);
    }
  });

  it('makes every structure the same size in the document style', () => {
    const e = editableFromParts(reads(), p, 1 / k, 'default', ACS_1996, STYLE_PRESETS);
    const atoms = new Map(e.contents.atoms.map((a) => [a.id, a]));
    const lens = e.contents.bonds.map((b) => { const a = atoms.get(b.a1)!, c = atoms.get(b.a2)!; return Math.hypot(a.x - c.x, a.y - c.y); }).sort((x, y) => x - y);
    expect(lens[Math.floor(lens.length / 2)]).toBeCloseTo(ACS_1996.bondLength, 0);
    expect(e.contents.bonds.every((b) => b.s === undefined)).toBe(true);
  });

  it('leaves conditions read as atoms with no bonds in the picture', () => {
    expect(isStructure({ symbols: ['[THF]', '[LiOH]', '[3H]'], edges: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], confidence: 0.61 })).toBe(false);
    expect(isStructure({ symbols: ['C', 'O'], edges: [[0, 1], [1, 0]], confidence: 0.9 })).toBe(true);
  });

  it('reads a picture of one structure whole, with nothing kept behind', () => {
    const one = readPng(new Uint8Array(readFileSync(join(DIR, 'acs-300dpi.png'))));
    expect(schemeParts(one, partGap(72 / 300))).toBeNull();
    const { p: q, g, frame } = load('acs-300dpi');
    const e = editableFromParts([{ graph: g, frame }], q, 72 / 300, 'match', ACS_1996, STYLE_PRESETS);
    const same = editableFromGraph(g, q, frame, 72 / 300, 'match', ACS_1996, STYLE_PRESETS);
    expect(e.contents.atoms.map((a) => [a.x, a.y])).toEqual(same.contents.atoms.map((a) => [a.x, a.y]));
    expect(e.rest).toBeNull();
    expect(e.contents.shapes).toHaveLength(0);
  });
});

describe('Make Editable: the whole scheme', () => {
  const p = readPng(new Uint8Array(readFileSync(join(DIR, 'scheme-150dpi.png'))));
  const f = JSON.parse(readFileSync(join(DIR, 'scheme-150dpi.json'), 'utf8')) as { dpi: number; structures: { symbols: string[]; truth: [number, number][]; edges: number[][] }[]; arrow: { x1: number; x2: number; y: number } };
  // what Tesseract read in the rest of the picture (tests/fixtures/make-editable/scheme-150dpi.text.json, read line by line as the app does)
  const texts = JSON.parse(readFileSync(join(DIR, 'scheme-150dpi.text.json'), 'utf8')) as ReadLine[];
  const k = f.dpi / 72;
  const boxes = schemeParts(p, partGap(1 / k))!;
  const reads: PartRead[] = boxes.flatMap((box) => {
    const s = f.structures.find((st) => st.truth.every(([x, y]) => x > box.x && x < box.x + box.w && y > box.y && y < box.y + box.h));
    if (!s) return [];
    const sub = partPixels(p, box), frame = readFrame(sub), q = (v: number) => Math.round(v * 63) / 63;
    const graph: ReadGraph = { smiles: '', symbols: s.symbols, edges: s.edges, atomScores: s.symbols.map(() => 1), confidence: 0.9,
      coords: s.truth.map(([x, y]) => [q((x - box.x - frame.x) / frame.w), q((y - box.y - frame.y) / frame.h)]) };
    return [{ box, graph, frame }];
  });

  it('finds the arrow: where it is, its full solid head, and its line width', () => {
    const e = editableFromParts(reads, p, 1 / k, 'match', ACS_1996, STYLE_PRESETS, texts);
    expect(e.contents.arrows).toHaveLength(1);
    const a = e.contents.arrows[0];
    expect(a.headStyle).toBe('full');
    expect(a.tailStyle).toBe('none');
    expect(a.headType).toBe('solid');
    expect(a.head.x).toBeGreaterThan(a.tail.x);
    expect(a.tail.x).toBeCloseTo(f.arrow.x1 / k, 0);
    // (a head's point is its faintest pixels: within a point)
    expect(Math.abs(a.head.x - f.arrow.x2 / k)).toBeLessThan(1);
    expect(a.tail.y).toBeCloseTo(f.arrow.y / k, 0);
    expect(a.lineWidth).toBeCloseTo(ACS_1996.lineWidth, 1);
  });

  it('makes the text captions: conditions over and under the arrow, and bold compound numbers', () => {
    const e = editableFromParts(reads, p, 1 / k, 'match', ACS_1996, STYLE_PRESETS, texts);
    const caps = e.contents.captions.map((c) => ({ text: c.runs.map((r) => r.text).join(''), bold: c.runs.every((r) => r.bold), size: c.runs[0].size }));
    expect(caps.map((c) => c.text).sort()).toEqual(['1', '2', 'LiOH', 'THF, 23 °C']);
    expect(caps.filter((c) => c.bold).map((c) => c.text).sort()).toEqual(['1', '2']);
    for (const c of caps) expect(c.size).toBeCloseTo(10, 0);
    // nothing is left as picture
    expect(e.rest).toBeNull();
    expect(e.contents.shapes).toHaveLength(0);
  });

  it('draws the arrow and text in the document style for Use Default Style', () => {
    const e = editableFromParts(reads, p, 1 / k, 'default', ACS_1996, STYLE_PRESETS, texts);
    expect(e.contents.arrows[0].lineWidth).toBeUndefined();
    expect(e.contents.arrows[0].headLength).toBeCloseTo(ACS_1996.lineWidth * 10, 5);
    expect(e.contents.captions.every((c) => c.runs.every((r) => r.size === undefined))).toBe(true);
  });

  it('without the text read, keeps the rest as picture (as before)', () => {
    const e = editableFromParts(reads, p, 1 / k, 'match', ACS_1996, STYLE_PRESETS);
    expect(e.contents.arrows).toHaveLength(0);
    expect(e.contents.shapes).toHaveLength(1);
  });

  it('finds where each line of text is, a lone compound number too', () => {
    const rest = editableFromParts(reads, p, 1 / k, 'match', ACS_1996, STYLE_PRESETS, []).rest!;
    expect(textLineBoxes(rest)).toHaveLength(4);
  });

  it('writes formulas with subscript digits, and leaves other words alone', () => {
    expect(textRuns('Et3N, CH2Cl2, 23 °C')).toEqual([{ text: 'Et3N', formula: true }, { text: ', ' }, { text: 'CH2Cl2', formula: true }, { text: ', 23 °C' }]);
    for (const w of ['H2O', 'NaBH4', 'Pd(PPh3)4', 'BF3·OEt2'.split('·')[0]]) expect(isFormula(w)).toBe(true);
    for (const w of ['23', '1a', 'THF', '4.0', 'rt', '(2)']) expect(isFormula(w)).toBe(false);
  });
});

describe('Make Editable: arrows of other kinds', () => {
  // a picture with lines drawn into it (black on white): `segs` are [x1, y1, x2, y2, width]
  const pic = (w: number, h: number, segs: number[][], tris: number[][][] = []) => {
    const data = new Uint8ClampedArray(w * h * 4).fill(255);
    const ink = (x: number, y: number) => { if (x >= 0 && y >= 0 && x < w && y < h) data.set([0, 0, 0, 255], (y * w + x) * 4); };
    for (const [x1, y1, x2, y2, lw] of segs) {
      const L = Math.hypot(x2 - x1, y2 - y1);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const t = Math.max(0, Math.min(1, ((x - x1) * (x2 - x1) + (y - y1) * (y2 - y1)) / (L * L)));
        if (Math.hypot(x - x1 - t * (x2 - x1), y - y1 - t * (y2 - y1)) <= lw / 2) ink(x, y);
      }
    }
    for (const [a, b, c] of tris) {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const s = (p: number[], q: number[]) => (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0]);
        const d1 = s(a, b), d2 = s(b, c), d3 = s(c, a);
        if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) ink(x, y);
      }
    }
    return { width: w, height: h, data };
  };

  it('a filled head, pointing left', () => {
    const a = findArrows(pic(200, 40, [[30, 20, 180, 20, 2]], [[[10, 20], [32, 12], [32, 28]]]), 20);
    expect(a).toHaveLength(1);
    expect(a[0].headStyle).toBe('full');
    expect(a[0].headType).toBe('solid');
    expect(a[0].head.x).toBeLessThan(a[0].tail.x);
  });

  it('an open head', () => {
    const a = findArrows(pic(200, 40, [[10, 20, 180, 20, 2], [180, 20, 164, 11, 2], [180, 20, 164, 29, 2]]), 20);
    expect(a).toHaveLength(1);
    expect(a[0].headStyle).toBe('full');
    expect(a[0].headType).toBe('angle');
  });

  it('two half-headed arrows: one equilibrium arrow', () => {
    const a = findArrows(pic(200, 60, [[10, 24, 180, 24, 2], [180, 24, 164, 15, 2], [20, 36, 190, 36, 2], [20, 36, 36, 45, 2]]), 20);
    expect(a).toHaveLength(1);
    expect(a[0].equilibrium).toBe(true);
  });

  it('a plain line with no head is a line, and letters are not arrows', () => {
    const a = findArrows(pic(200, 40, [[10, 20, 180, 20, 2]]), 20);
    expect(a.map((x) => [x.headStyle, x.tailStyle])).toEqual([['none', 'none']]);
    expect(findArrows(pic(60, 60, [[10, 10, 30, 50, 3], [30, 50, 50, 10, 3]]), 20)).toHaveLength(0);
  });
});

describe('Make Editable: boxes round structures, and formulas as the text reader reads them', () => {
  const blank = (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(255) });
  const fill = (p: { width: number; data: Uint8ClampedArray }, x1: number, y1: number, x2: number, y2: number) => {
    for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) p.data.set([0, 0, 0, 255], (y * p.width + x) * 4);
  };
  /** A box's four sides, `lw` thick, with `r` of each corner left out (rounded) and a shadow `s` thick on the right and bottom. */
  const box = (p: ReturnType<typeof blank>, x1: number, y1: number, x2: number, y2: number, lw: number, r = 0, s = 0) => {
    fill(p, x1 + r, y1, x2 - r, y1 + lw - 1);
    fill(p, x1 + r, y2 - lw + 1 - s, x2 - r, y2);
    fill(p, x1, y1 + r, x1 + lw - 1, y2 - r);
    fill(p, x2 - lw + 1 - s, y1 + r, x2, y2 - r);
    // a rounded corner's arc, roughly: a short diagonal
    if (r) for (const [cx, cy, dx, dy] of [[x1, y1, 1, 1], [x2, y1, -1, 1], [x1, y2, 1, -1], [x2, y2, -1, -1]]) {
      for (let i = 0; i <= r; i++) fill(p, Math.min(cx + dx * i, cx + dx * i), cy + dy * (r - i), cx + dx * i, cy + dy * (r - i));
    }
  };

  it('finds a plain box and a rounded box with a shadow, and takes them out of the picture', () => {
    const p = blank(400, 200);
    box(p, 10, 10, 180, 180, 2);
    box(p, 210, 10, 390, 180, 2, 10, 4);
    // a structure-like mark inside each (not a box)
    fill(p, 60, 80, 120, 81);
    fill(p, 260, 80, 330, 81);
    const f = findFrames(p).sort((a, b) => a.x1 - b.x1);
    expect(f).toHaveLength(2);
    expect(f[0].radius).toBe(0);
    expect(f[0].shadow).toBe(false);
    expect(f[0].lineWidth).toBe(2);
    expect(f[0].x1).toBeCloseTo(11, 0);
    expect(f[0].x2).toBeCloseTo(179, 0);
    expect(f[1].radius).toBeGreaterThan(5);
    expect(f[1].shadow).toBe(true);
    // the box drawn without its shadow: the right side where the thin line is
    expect(f[1].x2).toBeCloseTo(385, 0);
    const out = withoutFrames(p).p;
    const at = (x: number, y: number) => out.data[(y * 400 + x) * 4];
    expect(at(11, 100)).toBe(255);
    expect(at(90, 80)).toBe(0);
  });

  it('a structure is not a box', () => {
    const p = blank(200, 200);
    fill(p, 20, 20, 180, 21);
    fill(p, 20, 20, 21, 180);
    fill(p, 20, 179, 100, 180);
    expect(findFrames(p)).toHaveLength(0);
  });

  it('puts formulas right: subscripts read as commas, Cl read as CI, O read as a nought', () => {
    const cases: [string, string][] = [
      ['CO,Me', 'CO2Me'], ['Et,0', 'Et2O'], ['H,0', 'H2O'], ['CH,Cl,', 'CH2Cl2'], ['LiBH,', 'LiBH4'], ['CICO,Et', 'ClCO2Et'],
      ['HCI', 'HCl'], ['Ph;P,', 'Ph3P,'], ['Et,N', 'Et3N'], ['CrO;', 'CrO3'], ['(Boc),0', '(Boc)2O'],
      // left alone
      ['THF,', 'THF,'], ['23,', '23,'], ['MeOH,', 'MeOH,'], ['LiHMDS;', 'LiHMDS;'], ['DMP', 'DMP'],
    ];
    for (const [read, meant] of cases) expect(chemWord(read)).toBe(meant);
  });

  it('a word read as two or three atoms is not a structure', () => {
    expect(isStructure({ symbols: ['H', 'B', 'H'], edges: [[0, 1, 0], [1, 0, 1], [0, 1, 0]], confidence: 0.56 })).toBe(false);
    expect(isStructure({ symbols: ['H', 'B', 'H'], edges: [[0, 1, 0], [1, 0, 1], [0, 1, 0]], confidence: 0.56 }, true)).toBe(false);
    // a whole picture the reader is unsure of is still taken (it is shown beside the original)
    const ring = { symbols: ['C', 'C', 'C', 'C'], edges: [[0, 1, 0, 1], [1, 0, 1, 0], [0, 1, 0, 1], [1, 0, 1, 0]], confidence: 0.06 };
    expect(isStructure(ring)).toBe(false);
    expect(isStructure(ring, true)).toBe(true);
  });
});
