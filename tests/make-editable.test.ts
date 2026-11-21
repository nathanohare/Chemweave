// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readPng } from './png-pixels';
import type { ReadGraph } from '../src/recognise/molscribe';
import { readBonds, parseSymbol } from '../src/recognise/to-drawing';
import { bondLengthPx, labelSizePx, lineWidthPx, refineAtoms, strokeWidthPx, type MeasureBond } from '../src/recognise/measure';
import { editableFromGraph, readFrame, snapLook } from '../src/recognise/editable';
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
    const fromPicture: FromPicture = { picture, at: e.at, style: 'match', look: e.look, read: { graph: { symbols: g.symbols, coords: g.coords, edges: g.edges, confidence: g.confidence }, frame, px: { w: p.width, h: p.height } } };
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
