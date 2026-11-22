// @vitest-environment jsdom
//
// Drawings kept as data on an invisible frame (energy diagrams, TLC plates, Newman projections,
// torsion charts, SmartArt-style diagrams) are drawn again when their frame is resized or their
// window applied. Bold, italic, a colour or a subscript set by hand on one of their labels stays;
// a look the window sets (a pathway's colour) still changes (design/frame-labels.ts).

import { describe, expect, it } from 'vitest';
import { Doc, type Caption, type TextRun } from '../src/model';
import { plainMeasure } from '../src/chem/reaction';
import { plainText } from '../src/richtext';
import { shapeBox } from '../src/objects';
import { POINTS } from '../src/editor/arrange';
import { ACS_1996 } from '../src/style';
import { writeCdxml } from '../src/io/cdxml-write';
import { readCdxml } from '../src/io/cdxml';
import { handLooks, withLooks } from '../src/design/frame-labels';
import { ENERGY_DEFAULTS, ENERGY_PRESETS, putEnergy, refitEnergy, type EnergyData } from '../src/design/energy';
import { newPlate, putPlate } from '../src/design/plates';
import { newDiagram, putDiagram, refitDiagrams } from '../src/design/diagrams';
import { putTorsion, type TorsionData } from '../src/design/torsion';
import { NEWMAN_LOOK, putNewman, type NewmanData } from '../src/design/newman';
import { extrema, fitProfile } from '../src/chem/torsion-profile';
import type { NewmanGroup } from '../src/chem/newman';

const captionWith = (doc: Doc, frame: number, text: string): Caption =>
  doc.shapes.get(frame)!.frame!.captions.map((id) => doc.captions.get(id)!).find((c) => plainText(c.runs) === text)!;
/** Runs of the first piece of `text` in a caption: the style of its first character. */
const lookAt = (c: Caption, i = 0): Omit<TextRun, 'text'> => {
  let at = 0;
  for (const r of c.runs) { if (i < at + r.text.length) { const { text: _, ...st } = r; return st; } at += r.text.length; }
  return {};
};

describe('looks set by hand on a label', () => {
  it('are what differs from the label as drawn, and go onto the same words drawn again', () => {
    const base: TextRun[] = [{ text: 'TS', size: 10, color: '#000000' }, { text: '1', size: 10, color: '#000000', sub: true }];
    const old: TextRun[] = [{ text: 'T', size: 10, color: '#000000', bold: true }, { text: 'S', size: 10, color: '#cc0000' }, { text: '1', size: 10, color: '#000000', sub: true, italic: true }];
    const hand = handLooks(old, base);
    expect(hand).toEqual([{ bold: true }, { color: '#cc0000' }, { italic: true }]);
    // drawn again bigger and blue (the window's choice): the hand's looks go on top
    const now: TextRun[] = [{ text: 'TS', size: 14, color: '#0000ff' }, { text: '1', size: 14, color: '#0000ff', sub: true }];
    expect(withLooks(now, hand)).toEqual([
      { text: 'T', size: 14, color: '#0000ff', bold: true },
      { text: 'S', size: 14, color: '#cc0000' },
      { text: '1', size: 14, color: '#0000ff', sub: true, italic: true },
    ]);
  });

  it('a look taken off by hand stays off, and a position set by hand replaces the one drawn', () => {
    const base: TextRun[] = [{ text: 'φ', italic: true }, { text: '2', sub: true }];
    const old: TextRun[] = [{ text: 'φ' }, { text: '2', sup: true }];
    const hand = handLooks(old, base);
    expect(withLooks(base, hand)).toEqual([{ text: 'φ' }, { text: '2', sup: true }]);
    // nothing set by hand: the runs as drawn, untouched
    expect(withLooks(base, handLooks(base, base))).toBe(base);
  });
});

describe('energy diagrams', () => {
  const data = (more: Partial<EnergyData> = {}): EnergyData =>
    ({ ...ENERGY_DEFAULTS, ...ENERGY_PRESETS.find((p) => p.id === 'one-step')!.data, w: 200, h: 140, ...more });
  const put = () => {
    const doc = new Doc();
    const m = plainMeasure(doc);
    const frame = doc.edit('e', () => putEnergy(doc, m, data(), { x: 100, y: 100 }));
    return { doc, m, frame };
  };
  const boldOn = (doc: Doc, frame: number, text: string) => doc.edit('Bold', () => {
    const c = captionWith(doc, frame, text);
    doc.updateCaption(c.id, { runs: c.runs.map((r) => ({ ...r, bold: true })) });
  });

  it('a bold species name stays bold when the frame is resized by hand', () => {
    const { doc, m, frame } = put();
    boldOn(doc, frame, 'SM');
    doc.beforeCommit = (before) => refitEnergy(doc, before, m);
    const b = shapeBox(doc.shapes.get(frame)!);
    doc.edit('Resize', () => doc.updateShape(frame, { x2: b.x2 + 100 }));
    expect(doc.shapes.get(frame)!.energy!.w).toBeCloseTo(300, 0);
    expect(lookAt(captionWith(doc, frame, 'SM')).bold).toBe(true);
    // the others as drawn
    expect(lookAt(captionWith(doc, frame, 'P')).bold).toBeUndefined();
  });

  it('stays bold through Edit Energy Diagram, while the pathway colour chosen there still reaches the label', () => {
    const { doc, m, frame } = put();
    boldOn(doc, frame, '22.0');
    const d = doc.shapes.get(frame)!.energy!;
    doc.edit('Edit', () => putEnergy(doc, m, { ...d, paths: [{ ...d.paths[0], color: '#c00000' }] }, { x: 100, y: 100 }, frame));
    const c = captionWith(doc, frame, '22.0');
    expect(lookAt(c).bold).toBe(true);
    expect(lookAt(c).color).toBe('#c00000');
  });

  it('a label renamed in the window is drawn as the window says', () => {
    const { doc, m, frame } = put();
    boldOn(doc, frame, 'SM');
    const d = doc.shapes.get(frame)!.energy!;
    const points = d.paths[0].points.map((q, i) => (i === 0 ? { ...q, label: '1' } : q));
    doc.edit('Edit', () => putEnergy(doc, m, { ...d, paths: [{ ...d.paths[0], points }] }, { x: 100, y: 100 }, frame));
    expect(lookAt(captionWith(doc, frame, '1')).bold).toBeUndefined();
  });

  it('keeps its labels as drawn in the file, so looks set by hand last after saving and opening', () => {
    const { doc, m, frame } = put();
    boldOn(doc, frame, 'SM');
    const back = readCdxml(writeCdxml(doc)).doc;
    const f2 = [...back.shapes.values()].find((s) => s.energy)!;
    expect(f2.madeLabels?.some((l) => l.text === 'SM')).toBe(true);
    const sm = [...back.captions.values()].find((c) => plainText(c.runs) === 'SM')!;
    expect(lookAt(sm).bold).toBe(true);
    back.edit('Edit', () => putEnergy(back, m, f2.energy!, { x: f2.x1 + f2.energy!.margins!.l, y: f2.y1 + f2.energy!.margins!.t }, f2.id));
    expect(lookAt(captionWith(back, f2.id, 'SM')).bold).toBe(true);
  });
});

describe('TLC plates', () => {
  it('a bold lane label stays bold when the plate is edited', () => {
    const doc = new Doc();
    doc.style = { ...ACS_1996 };
    const d = newPlate('tlc', doc.style.bondLength);
    let id = 0;
    doc.edit('TLC', () => { id = putPlate(doc, POINTS, d, { x: 0, y: 0 }); });
    const label = d.lanes[0].label;
    doc.edit('Italic', () => {
      const c = captionWith(doc, id, label);
      doc.updateCaption(c.id, { runs: c.runs.map((r) => ({ ...r, italic: true })) });
    });
    const p = doc.shapes.get(id)!.plate!;
    doc.edit('Edit', () => { putPlate(doc, POINTS, { ...p, lanes: [...p.lanes, { label: 'X', marks: '0.5' }] }, { x: 0, y: 0 }, id); });
    expect(lookAt(captionWith(doc, id, label)).italic).toBe(true);
  });
});

describe('torsion charts', () => {
  // butane about C2-C3, kcal/mol: syn 5.0, gauche 0.9, eclipsed (CH3/H) 3.6, anti 0 (Clayden,
  // Greeves & Warren, Organic Chemistry, 2nd ed., 2012, ch. 16); only the labels matter here
  const points = [0, 60, 120, 180, 240, 300].map((phi, i) => ({ phi, energy: [5.0, 0.9, 3.6, 0, 3.6, 0.9][i] }));
  const profile = fitProfile(points);
  const H = (atom: number, angle: number): NewmanGroup => ({ atom, angle, label: 'H', size: 0 });
  const chart: TorsionData = {
    profile, extrema: extrema(profile), phi0: 180, unit: 'kcal/mol', insets: 'none', names: 'textbook', barriers: false, barrierColor: '#1a56db', digits: 1,
    front: [{ atom: 1, angle: 0, label: 'CH3', size: 1.7 }, H(5, 120), H(6, 240)], back: [{ atom: 4, angle: 180, label: 'CH3', size: 1.7 }, H(7, 60), H(8, 300)],
    w: 300, h: 160, look: structuredClone(NEWMAN_LOOK), sawhorse: false, points,
  };

  it('an underlined name stays underlined when it is drawn again', () => {
    const doc = new Doc();
    const m = plainMeasure(doc);
    let id = 0;
    doc.edit('Chart', () => { id = putTorsion(doc, m, chart, { x: 100, y: 200 }); });
    expect(captionWith(doc, id, 'antiperiplanar')).toBeDefined();
    doc.edit('Underline', () => {
      const c = captionWith(doc, id, 'antiperiplanar');
      doc.updateCaption(c.id, { runs: c.runs.map((r) => ({ ...r, underline: true })) });
    });
    doc.edit('Again', () => { putTorsion(doc, m, { ...doc.shapes.get(id)!.torsion!, w: 360 }, { x: 100, y: 200 }, id); });
    expect(lookAt(captionWith(doc, id, 'antiperiplanar')).underline).toBe(true);
  });
});

describe('Newman projections', () => {
  it('an italic group label stays italic when the projection is turned', () => {
    const doc = new Doc();
    const m = plainMeasure(doc);
    const g = (atom: number, angle: number, label: string): NewmanGroup => ({ atom, angle, label, size: label === 'H' ? 0 : 1 });
    const d: NewmanData = { kind: 'newman', front: [g(1, 0, 'Ph'), g(2, 120, 'H'), g(3, 240, 'H')], back: [g(4, 60, 'OH'), g(5, 180, 'H'), g(6, 300, 'H')], turn: 0, conformer: 0, source: 'angle', look: structuredClone(NEWMAN_LOOK) };
    let id = 0;
    doc.edit('Newman', () => { id = putNewman(doc, m, d, { x: 300, y: 300 }); });
    doc.edit('Italic', () => {
      const c = captionWith(doc, id, 'Ph');
      doc.updateCaption(c.id, { runs: c.runs.map((r) => ({ ...r, italic: true })) });
    });
    doc.edit('Turn', () => { putNewman(doc, m, { ...d, turn: 60 }, { x: 300, y: 300 }, id); });
    expect(lookAt(captionWith(doc, id, 'Ph')).italic).toBe(true);
    expect(lookAt(captionWith(doc, id, 'OH')).italic).toBeFalsy();
  });
});

describe('sawhorse projections', () => {
  // (the groups are the atoms of a structure: their labels keep the looks set on them)
  const g = (atom: number, angle: number, label: string): NewmanGroup => ({ atom, angle, label, size: label === 'H' ? 0 : 1 });
  const d: NewmanData = { kind: 'sawhorse', front: [g(1, 0, 'Ph'), g(2, 120, 'H'), g(3, 240, 'H')], back: [g(4, 60, 'OMe'), g(5, 180, 'H'), g(6, 300, 'H')], turn: 0, conformer: 0, source: 'angle', look: structuredClone(NEWMAN_LOOK) };
  const atomWith = (doc: Doc, frame: number, label: string) => doc.shapes.get(frame)!.frame!.atoms.map((a) => doc.atoms.get(a)!).find((a) => a.label === label)!;

  it('a group label made italic and red stays so when the sawhorse is turned', () => {
    const doc = new Doc();
    const m = plainMeasure(doc);
    let id = 0;
    doc.edit('Sawhorse', () => { id = putNewman(doc, m, d, { x: 300, y: 300 }); });
    const ph = atomWith(doc, id, 'Ph');
    expect(ph).toBeDefined();
    doc.edit('Look', () => doc.updateAtom(ph.id, { labelMarks: '/*', color: '#c00000' }));
    doc.edit('Turn', () => { putNewman(doc, m, { ...d, turn: 60 }, { x: 300, y: 300 }, id); });
    const now = atomWith(doc, id, 'Ph');
    expect(now.id).not.toBe(ph.id); // drawn again
    expect(now.labelMarks).toBe('/*');
    expect(now.color).toBe('#c00000');
    expect(atomWith(doc, id, 'OMe').labelMarks).toBeUndefined();
    // and once more (the looks are the hand's, not the drawing's)
    doc.edit('Turn', () => { putNewman(doc, m, { ...d, turn: 120 }, { x: 300, y: 300 }, id); });
    expect(atomWith(doc, id, 'Ph').labelMarks).toBe('/*');
  });

  it('a group label made bold in part keeps it, and its plain part stays plain', () => {
    const doc = new Doc();
    const m = plainMeasure(doc);
    let id = 0;
    doc.edit('Sawhorse', () => { id = putNewman(doc, m, d, { x: 300, y: 300 }); });
    const ome = atomWith(doc, id, 'OMe');
    doc.edit('Bold', () => doc.updateAtom(ome.id, { labelMarks: 'B..' }));
    doc.edit('Turn', () => { putNewman(doc, m, { ...d, turn: 60 }, { x: 300, y: 300 }, id); });
    expect(atomWith(doc, id, 'OMe').labelMarks).toBe('B..');
  });
});

describe('SmartArt-style diagrams', () => {
  const put = (text: string) => {
    const doc = new Doc();
    const frame = doc.edit('d', () => putDiagram(doc, POINTS, newDiagram('blocks', text), { x: 50, y: 40 }));
    doc.beforeCommit = (b) => refitDiagrams(doc, b, POINTS);
    return { doc, frame };
  };
  const item = (doc: Doc, frame: number, words: string) =>
    doc.shapes.get(frame)!.frame!.shapes.map((id) => doc.shapes.get(id)!).find((s) => plainText(s.text?.runs ?? []) === words)!;

  it('part of an item made bold and italic stays so when the frame is resized by hand', () => {
    const { doc, frame } = put('Synthesis\nWorkup');
    const s = item(doc, frame, 'Synthesis');
    const r = s.text!.runs[0];
    doc.edit('Bold', () => doc.updateShape(s.id, { text: { ...s.text!, runs: [{ ...r, text: 'Syn', bold: true, italic: true }, { ...r, text: 'thesis' }] } }));
    const b = shapeBox(doc.shapes.get(frame)!);
    doc.edit('Resize', () => doc.updateShape(frame, { x2: b.x2 + 200 }));
    const now = item(doc, frame, 'Synthesis');
    expect(now.id).not.toBe(s.id); // drawn again
    expect(now.text!.runs[0]).toMatchObject({ text: 'Syn', bold: true, italic: true });
    expect(now.text!.runs[1].bold).toBeUndefined();
    // its text size follows the new frame (not the size it had)
    expect(now.text!.runs[0].size).toBe(now.text!.runs[1].size);
  });

  it('words typed into an item with a colour keep it when the diagram is drawn again', () => {
    const { doc, frame } = put('Synthesis\nWorkup');
    const s = item(doc, frame, 'Workup');
    const r = s.text!.runs[0];
    doc.edit('Type', () => doc.updateShape(s.id, { text: { ...s.text!, runs: [{ ...r, text: 'Dry ' }, { ...r, text: 'MgSO4', color: '#c00000' }] } }));
    expect(doc.shapes.get(frame)!.diagram!.text).toContain('Dry MgSO4');
    const b = shapeBox(doc.shapes.get(frame)!);
    doc.edit('Resize', () => doc.updateShape(frame, { x2: b.x2 + 200 }));
    const now = item(doc, frame, 'Dry MgSO4');
    const red = now.text!.runs.filter((x) => x.color === '#c00000').map((x) => x.text).join('');
    expect(red).toBe('MgSO4');
  });
});
