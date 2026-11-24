// @vitest-environment jsdom
//
// A frame's drawing (an energy diagram, an MO diagram, a SmartArt-style diagram, a TLC plate)
// whose texts were changed in ChemDraw (audit G1-13, review F1b-R07, R08, R14): each change is
// taken into the frame's settings where it can be (an energy typed over as a number, a diagram's
// outline line, an MO label with its sub- and superscripts); where it can't, the settings and
// ChemDraw's drawing are both kept, the frame is marked, and the note names the drawing with its
// article. Any edit that redraws it from the settings goes ahead and clears the mark, in that
// edit's own undo step, so one Undo brings back ChemDraw's drawing (review F1d-R01).
// The values are the program's own one-step energy profile (SM 0, TS 22, P −8 kcal/mol) and a
// Li₂ MO diagram built here, whose 2s orbitals combine into σ2s and σ*2s (Atkins &
// de Paula, Physical Chemistry, 9th ed., §10.4, Fig. 10.30).

import { describe, it, expect } from 'vitest';
import { Doc, type Shape } from '../src/model';
import { readCdxml, frameName, markEditedOutside } from '../src/io/cdxml';
import { writeCdxml } from '../src/io/cdxml-write';
import { putPlate, newPlate, setMarkAt } from '../src/design/plates';
import { putEnergy, refitEnergy, ENERGY_DEFAULTS, ENERGY_PRESETS, type EnergyData } from '../src/design/energy';
import { onFrameRedrawn } from '../src/design/frame-redrawn';
import type { Entity } from '../src/model';
import { newDiagram, putDiagram } from '../src/design/diagrams';
import { fromAtoms, type MoSpec } from '../src/design/mo';
import { POINTS } from '../src/editor/arrange';

const write = (d: Doc) => writeCdxml(d, { name: 't.cdxml' });
const frameOf = (d: Doc, k: 'energy' | 'plate' | 'diagram'): Shape => [...d.shapes.values()].find((s) => s[k])!;

function energy(): Doc {
  const d = new Doc();
  const data = { ...ENERGY_DEFAULTS, ...structuredClone(ENERGY_PRESETS[0].data), w: 200, h: 150 } as EnergyData;
  d.edit('E', () => { putEnergy(d, POINTS, data, { x: 0, y: 0 }); });
  return d;
}

/** Li₂ from its 2s orbitals alone: σ2s (filled) and σ*2s. */
const LI2: MoSpec = { titles: ['Li', 'Li_{2}', 'Li'], axis: true, rich: true, relative: true, levels: [
  { column: 'left', label: '2s', e: 0.46, n: 1, electrons: 1 }, { column: 'right', label: '2s', e: 0.46, n: 1, electrons: 1 },
  { column: 'middle', label: 'σ_{2s}', e: 0, n: 1, electrons: 2, from: '2s' }, { column: 'middle', label: 'σ^{*}_{2s}', e: 1, n: 1, electrons: 0, from: '2s' },
] };

function li2(): Doc {
  const d = new Doc();
  const p = newPlate('mo', d.style.bondLength);
  p.mo = { ...structuredClone(LI2), labelBack: 'white' };
  d.edit('MO', () => { putPlate(d, POINTS, p, { x: 0, y: 0 }); });
  return d;
}

describe('an energy typed over in ChemDraw (review F1b-R08)', () => {
  it('is taken into the diagram as a number', () => {
    const xml = write(energy());
    const edited = xml.replace(/>22\.0</, '>21.0<');
    expect(edited).not.toBe(xml);
    const got = readCdxml(edited);
    expect(frameOf(got.doc, 'energy').energy!.paths[0].points.map((p) => p.g)).toEqual([0, 21, -8]);
    expect(got.stats.notes ?? []).toEqual([]);
  });
  it('takes a negative energy written with a minus sign', () => {
    const xml = write(energy());
    // (the minus sign is a run of its own, in the Symbol font)
    const edited = xml.replace(/>8\.0</, '>9.5<');
    expect(edited).not.toBe(xml);
    expect(frameOf(readCdxml(edited).doc, 'energy').energy!.paths[0].points.map((p) => p.g)).toEqual([0, 22, -9.5]);
  });
  it('names the drawing with its article when a change can\'t be followed', () => {
    // the axis title isn't held as it is shown ("ΔG (kcal mol−1)" is drawn from the quantity and unit)
    const got = readCdxml(write(energy()).replace(/>Reaction coordinate</, '>Reaction progress<'));
    const s = frameOf(got.doc, 'energy');
    expect(s.editedOutside).toBe(true);
    expect(s.energy!.paths[0].points.map((p) => p.g)).toEqual([0, 22, -8]);
    expect(got.stats.notes).toEqual([expect.stringMatching(/^The texts of an energy diagram were changed in another program/)]);
  });
});

describe('an MO label with sub- and superscripts changed in ChemDraw (review F1b-R08)', () => {
  it('takes the change inside the marks', () => {
    const xml = write(li2());
    // σ2s → σ2p: the subscript run "2s" of the σ label (the first subscript 2s; σ*2s comes after it)
    const edited = xml.replace(/(face="32">)2s</, '$12p<');
    expect(edited).not.toBe(xml);
    const got = readCdxml(edited);
    const labels = frameOf(got.doc, 'plate').plate!.mo!.levels.map((l) => l.label);
    expect(labels).toContain('σ_{2p}');
    expect(labels).toContain('σ^{*}_{2s}');
    expect(got.stats.notes ?? []).toEqual([]);
  });
  it('adds letters typed after a subscript after it', () => {
    const got = readCdxml(write(li2()).replace(/(face="32">2<\/s>)/, '$1<s font="3" size="10" color="0" face="0">+</s>')).doc;
    expect(frameOf(got, 'plate').plate!.mo!.titles).toEqual(['Li', 'Li_{2}+', 'Li']);
  });
  it('changes a title but never a level\'s column that reads the same (review F1b-R14)', () => {
    const d = new Doc();
    const p = newPlate('mo', d.style.bondLength);
    const spec = structuredClone(LI2);
    p.mo = { ...spec, titles: ['left', 'Li_{2}', 'right'], labelBack: 'white' };
    d.edit('MO', () => { putPlate(d, POINTS, p, { x: 0, y: 0 }); });
    const xml = write(d);
    expect(xml.match(/>left</g)).toHaveLength(1);
    const mo = frameOf(readCdxml(xml.replace(/>left</, '>Na<')).doc, 'plate').plate!.mo!;
    expect(mo.titles).toEqual(['Na', 'Li_{2}', 'right']);
    expect(mo.levels.map((l) => l.column)).toEqual(spec.levels.map((l) => l.column));
  });
  it('is called an MO diagram in the note', () => {
    expect(frameName(frameOf(li2(), 'plate'))).toBe('an MO diagram');
  });
});

describe('a line of a diagram\'s outline changed in ChemDraw (review F1b-R14)', () => {
  const org = () => {
    const d = new Doc();
    d.edit('d', () => putDiagram(d, POINTS, newDiagram('org', 'Boss\n\tLeft\n\tRight'), { x: 50, y: 40 }));
    return d;
  };
  it('is taken into the outline, keeping its indent', () => {
    const xml = write(org());
    const edited = xml.replace(/>Left</, '>West<');
    expect(edited).not.toBe(xml);
    const got = readCdxml(edited);
    expect(frameOf(got.doc, 'diagram').diagram!.text).toBe('Boss\n\tWest\n\tRight');
    expect(got.stats.notes ?? []).toEqual([]);
  });
  it('is called a diagram in the note', () => {
    const d = org();
    let note = '';
    d.edit('mark', () => { note = markEditedOutside(d, frameOf(d, 'diagram')); });
    expect(note).toMatch(/^The texts of a diagram were changed/);
  });
});

describe('redrawing a marked frame from its settings', () => {
  it('clears the mark, and the mark is kept through save and reopen until then', () => {
    const d = new Doc();
    d.edit('TLC', () => { putPlate(d, POINTS, newPlate('tlc', d.style.bondLength), { x: 0, y: 0 }); });
    const got = readCdxml(write(d).replace(/>SM</, '>1a<').replace(/>0\.30</, '>0.35<')).doc;
    expect(frameOf(got, 'plate').editedOutside).toBe(true);
    const again = readCdxml(write(got)).doc;
    const s = frameOf(again, 'plate');
    expect(s.editedOutside).toBe(true);
    // (redrawn as the Edit command does)
    again.edit('Edit TLC Plate', () => { putPlate(again, POINTS, s.plate!, { x: s.x1, y: s.y1 }, s.id); });
    expect(again.shapes.get(s.id)?.editedOutside).toBeUndefined();
  });
});

describe('an edit that redraws a marked frame goes ahead, and one Undo brings back ChemDraw\'s drawing (review F1d-R01)', () => {
  const captionTexts = (d: Doc) => [...d.captions.values()].map((c) => c.runs.map((r) => r.text).join(''));
  /** Everything a frame's drawing is made of, to compare before and after. */
  const picture = (d: Doc, id: number) => {
    const s = d.shapes.get(id)!;
    return JSON.stringify({
      box: [s.x1, s.y1, s.x2, s.y2], mark: s.editedOutside ?? false, plate: s.plate ?? null, energy: s.energy ?? null, diagram: s.diagram ?? null,
      captions: [...d.captions.values()].map((c) => [c.x, c.y, c.runs.map((r) => r.text).join('')]).sort(),
      arrows: d.arrows.size, shapes: d.shapes.size,
    });
  };
  /** The frames the app is told about (frame-redrawn.ts), for the message. */
  const listen = () => {
    const told: string[] = [];
    onFrameRedrawn((_d, s) => told.push(`${s.id} ${frameName(s)}`));
    return told;
  };
  it('a TLC spot dragged: the drag goes ahead, the app is told once, and one Undo takes back the whole drag only', () => {
    const d = new Doc();
    d.edit('TLC', () => { putPlate(d, POINTS, newPlate('tlc', d.style.bondLength), { x: 0, y: 0 }); });
    const got = readCdxml(write(d).replace(/>SM</, '>1a<').replace(/>0\.30</, '>0.35<')).doc;
    const id = frameOf(got, 'plate').id;
    expect(got.shapes.get(id)!.editedOutside).toBe(true);
    // an unrelated step just before the drag: it must survive the Undo
    got.edit('Add Atom', () => { got.addAtom(500, 500); });
    const atoms = got.atoms.size, before = picture(got, id), added = got.topStep;
    const told = listen();
    try {
      // the editor's drag (editor.ts dragSpot): one step, opened at the first move, the plate redrawn at each move
      got.begin('Move Spot');
      for (const rf of [0.4, 0.5, 0.6]) {
        const s = got.shapes.get(id)!;
        const lanes = s.plate!.lanes.map((l, i) => (i === 0 ? { ...l, marks: setMarkAt(l.marks, 0, rf) } : l));
        putPlate(got, POINTS, { ...s.plate!, lanes }, { x: s.x1, y: s.y1 }, id);
      }
      got.commit();
    } finally { onFrameRedrawn(null); }
    expect(told).toEqual([`${id} a TLC plate`]);
    expect(got.shapes.get(id)!.editedOutside).toBeUndefined();
    expect(got.shapes.get(id)!.plate!.lanes[0].marks).toBe('0.60');
    expect(captionTexts(got)).not.toContain('1a');
    expect(got.topStep).not.toBe(added);
    expect(got.undo()).toBe(true);
    expect(got.topStep).toBe(added);
    expect(picture(got, id)).toBe(before);
    expect(captionTexts(got)).toContain('1a');
    expect(got.atoms.size).toBe(atoms);
  });
  it('a resize by its frame: redrawn at the new size, and one Undo brings back the drawing and the box', () => {
    const got = readCdxml(write(energy()).replace(/>Reaction coordinate</, '>Reaction progress<')).doc;
    const id = frameOf(got, 'energy').id;
    expect(got.shapes.get(id)!.editedOutside).toBe(true);
    const before = picture(got, id);
    const told = listen();
    try {
      const old = { ...got.shapes.get(id)! };
      got.edit('Resize', () => {
        got.updateShape(id, { x2: old.x2 + 40, y2: old.y2 + 30 });
        refitEnergy(got, new Map<string, Entity | null>([['s' + id, old as Entity]]), POINTS);
      });
    } finally { onFrameRedrawn(null); }
    expect(told).toEqual([`${id} an energy diagram`]);
    expect(captionTexts(got)).toContain('Reaction coordinate');
    expect(captionTexts(got)).not.toContain('Reaction progress');
    expect(got.undo()).toBe(true);
    expect(picture(got, id)).toBe(before);
    expect(captionTexts(got)).toContain('Reaction progress');
  });
  it('a style change through the put function (as the Format pane does) is one step too', () => {
    const got = readCdxml(write(energy()).replace(/>Reaction coordinate</, '>Reaction progress<')).doc;
    const id = frameOf(got, 'energy').id;
    const before = picture(got, id);
    const s = got.shapes.get(id)!;
    got.edit('Energy Values', () => { putEnergy(got, POINTS, { ...s.energy!, values: false }, { x: 0, y: 0 }, id); });
    expect(got.shapes.get(id)!.energy!.values).toBe(false);
    expect(got.shapes.get(id)!.editedOutside).toBeUndefined();
    got.undo();
    expect(picture(got, id)).toBe(before);
  });
  it('a diagram in a drawing of its own (a Document or Presentation figure): redrawn there, undone there, the canvas left alone', () => {
    const canvas = new Doc();
    canvas.edit('Add Atom', () => { canvas.addAtom(0, 0); });
    const canvasTop = canvas.topStep;
    const d = new Doc();
    d.edit('d', () => putDiagram(d, POINTS, newDiagram('org', 'Boss\n\tLeft\n\tRight'), { x: 50, y: 40 }));
    // (a renamed text the outline can't follow: two swapped, which marks the frame)
    const fig = readCdxml(write(d).replace(/>Left</, '>@@<').replace(/>Right</, '>Left<').replace(/>@@</, '>Right<')).doc;
    const id = frameOf(fig, 'diagram').id;
    expect(fig.shapes.get(id)!.editedOutside).toBe(true);
    const before = picture(fig, id);
    const told = listen();
    try {
      const s = fig.shapes.get(id)!;
      fig.edit('Edit Diagram', () => { putDiagram(fig, POINTS, { ...s.diagram!, text: 'Boss\n\tLeft\n\tRight\n\tMiddle' }, { x: s.x1, y: s.y1 }, id); });
    } finally { onFrameRedrawn(null); }
    expect(told).toEqual([`${id} a diagram`]);
    expect(fig.shapes.get(id)!.diagram!.text).toBe('Boss\n\tLeft\n\tRight\n\tMiddle');
    expect(fig.shapes.get(id)!.editedOutside).toBeUndefined();
    expect(fig.undo()).toBe(true);
    expect(picture(fig, id)).toBe(before);
    expect(canvas.topStep).toBe(canvasTop);
    expect(canvas.atoms.size).toBe(1);
  });
  it('an unmarked frame redrawn tells nobody', () => {
    const d = energy();
    const id = frameOf(d, 'energy').id;
    const told = listen();
    try {
      const s = d.shapes.get(id)!;
      d.edit('Energy Values', () => { putEnergy(d, POINTS, { ...s.energy!, values: false }, { x: 0, y: 0 }, id); });
    } finally { onFrameRedrawn(null); }
    expect(told).toEqual([]);
  });
});

describe('smaller points of the third review (F1c-R09)', () => {
  it('takes an energy only as plain digits: 0x10 and 1e3 are not numbers here', () => {
    for (const typed of ['0x10', '1e3']) {
      const got = readCdxml(write(energy()).replace(/>22\.0</, `>${typed}<`));
      const s = frameOf(got.doc, 'energy');
      expect(s.energy!.paths[0].points.map((p) => p.g), typed).toEqual([0, 22, -8]);
      expect(s.editedOutside, typed).toBe(true);
    }
  });
  it('marks a diagram whose two texts were swapped round, rather than drawing them the old way', () => {
    const d = new Doc();
    d.edit('d', () => putDiagram(d, POINTS, newDiagram('org', 'Boss\n\tLeft\n\tRight'), { x: 50, y: 40 }));
    const got = readCdxml(write(d).replace(/>Left</, '>@@<').replace(/>Right</, '>Left<').replace(/>@@</, '>Right<'));
    const s = frameOf(got.doc, 'diagram');
    expect(s.diagram!.text).toBe('Boss\n\tLeft\n\tRight');
    expect(s.editedOutside).toBe(true);
  });
  it('renames the atomic orbital a molecular orbital comes from with its label (HF: F 2p)', () => {
    const d = new Doc();
    const p = newPlate('mo', d.style.bondLength);
    const spec = fromAtoms('H', 'F')!;
    p.mo = { ...spec, labelBack: 'white' };
    d.edit('MO', () => { putPlate(d, POINTS, p, { x: 0, y: 0 }); });
    const xml = write(d);
    expect(xml.match(/>2p</g)).toHaveLength(1);
    const mo = frameOf(readCdxml(xml.replace(/>2p</, '>2pz<')).doc, 'plate').plate!.mo!;
    expect(mo.levels.filter((l) => l.label === '2pz')).toHaveLength(1);
    expect(mo.levels.map((l) => l.from).filter(Boolean)).toEqual(spec.levels.map((l) => l.from).filter(Boolean).map((f) => f!.split(', ').map((x) => (x === '2p' ? '2pz' : x)).join(', ')));
  });
});

