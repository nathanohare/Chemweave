// @vitest-environment jsdom
//
// A frame's drawing (an energy diagram, an MO diagram, a SmartArt-style diagram, a TLC plate)
// whose texts were changed in ChemDraw (audit G1-13, review F1b-R07, R08, R14): each change is
// taken into the frame's settings where it can be (an energy typed over as a number, a diagram's
// outline line, an MO label with its sub- and superscripts); where it can't, the settings and
// ChemDraw's drawing are both kept, the frame is marked, and the note names the drawing with its
// article. Redrawing from the settings (the Edit command, after asking) clears the mark.
// The values are the program's own presets: the one-step energy profile (SM 0, TS 22, P −8
// kcal/mol) and the Li₂ MO diagram, whose 2s orbitals combine into σ2s and σ*2s (Atkins &
// de Paula, Physical Chemistry, 9th ed., §10.4, Fig. 10.30).

import { describe, it, expect } from 'vitest';
import { Doc, type Shape } from '../src/model';
import { readCdxml, frameName, markEditedOutside } from '../src/io/cdxml';
import { writeCdxml } from '../src/io/cdxml-write';
import { putPlate, newPlate } from '../src/design/plates';
import { putEnergy, refitEnergy, ENERGY_DEFAULTS, ENERGY_PRESETS, type EnergyData } from '../src/design/energy';
import { onRedrawHeld, heldRedraws, redrawHeld, dropHeld, withRedraw } from '../src/design/frame-guard';
import type { Entity } from '../src/model';
import { newDiagram, putDiagram } from '../src/design/diagrams';
import { MO_PRESETS } from '../src/design/mo';
import { POINTS } from '../src/editor/arrange';

const write = (d: Doc) => writeCdxml(d, { name: 't.cdxml' });
const frameOf = (d: Doc, k: 'energy' | 'plate' | 'diagram'): Shape => [...d.shapes.values()].find((s) => s[k])!;

function energy(): Doc {
  const d = new Doc();
  const data = { ...ENERGY_DEFAULTS, ...structuredClone(ENERGY_PRESETS[0].data), w: 200, h: 150 } as EnergyData;
  d.edit('E', () => { putEnergy(d, POINTS, data, { x: 0, y: 0 }); });
  return d;
}

function li2(): Doc {
  const d = new Doc();
  const p = newPlate('mo', d.style.bondLength);
  p.mo = { ...structuredClone(MO_PRESETS.find((m) => m.id === 'li2')!.spec), labelBack: 'white' };
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
    const spec = structuredClone(MO_PRESETS.find((m) => m.id === 'li2')!.spec);
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
    // (redrawn as the Edit command does once the user agrees)
    again.edit('Edit TLC Plate', () => { withRedraw(s.id, () => putPlate(again, POINTS, s.plate!, { x: s.x1, y: s.y1 }, s.id)); });
    expect(again.shapes.get(s.id)?.editedOutside).toBeUndefined();
  });
});

describe('every redraw of a marked frame waits for the user (review F1c-R04)', () => {
  const marked = () => {
    for (const k of heldRedraws()) dropHeld(k);
    const got = readCdxml(write(energy()).replace(/>Reaction coordinate</, '>Reaction progress<'));
    const s = frameOf(got.doc, 'energy');
    expect(s.editedOutside).toBe(true);
    return { d: got.doc, id: s.id };
  };
  const captionTexts = (d: Doc) => [...d.captions.values()].map((c) => c.runs.map((r) => r.text).join(''));
  it('a resize by its frame leaves ChemDraw\'s drawing and the mark, keeps the redraw, and says so once', async () => {
    const { d, id } = marked();
    const told: number[][] = [];
    onRedrawHeld((ids) => told.push(ids));
    try {
      const old = { ...d.shapes.get(id)! };
      d.edit('Resize', () => {
        d.updateShape(id, { x2: old.x2 + 40, y2: old.y2 + 30 });
        refitEnergy(d, new Map<string, Entity | null>([['s' + id, old as Entity]]), POINTS);
      });
      expect(captionTexts(d)).toContain('Reaction progress');
      expect(d.shapes.get(id)!.editedOutside).toBe(true);
      expect(heldRedraws()).toEqual([id]);
      await Promise.resolve();
      expect(told).toEqual([[id]]);
      // the user agrees: drawn again from the settings, at the new size, and no longer marked
      d.edit('Redraw', () => { expect(redrawHeld(id)).toBe(true); });
      expect(captionTexts(d)).toContain('Reaction coordinate');
      expect(captionTexts(d)).not.toContain('Reaction progress');
      expect(d.shapes.get(id)!.editedOutside).toBeUndefined();
      expect(heldRedraws()).toEqual([]);
    } finally { onRedrawHeld(null); }
  });
  it('left as it is when the user says no; an agreed Edit redraws at once', () => {
    const { d, id } = marked();
    const s = d.shapes.get(id)!;
    d.edit('Look', () => { putEnergy(d, POINTS, { ...s.energy!, values: false }, { x: 0, y: 0 }, id); });
    dropHeld(id);
    expect(heldRedraws()).toEqual([]);
    expect(captionTexts(d)).toContain('Reaction progress');
    expect(d.shapes.get(id)!.energy!.values).toBe(true);
    d.edit('Edit', () => { withRedraw(id, () => putEnergy(d, POINTS, { ...s.energy!, values: false }, { x: 0, y: 0 }, id)); });
    expect(d.shapes.get(id)!.energy!.values).toBe(false);
    expect(d.shapes.get(id)!.editedOutside).toBeUndefined();
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
    const spec = structuredClone(MO_PRESETS.find((m) => m.id === 'hf')!.spec);
    p.mo = { ...spec, labelBack: 'white' };
    d.edit('MO', () => { putPlate(d, POINTS, p, { x: 0, y: 0 }); });
    const xml = write(d);
    expect(xml.match(/>2p</g)).toHaveLength(1);
    const mo = frameOf(readCdxml(xml.replace(/>2p</, '>2pz<')).doc, 'plate').plate!.mo!;
    expect(mo.levels.filter((l) => l.label === '2pz')).toHaveLength(1);
    expect(mo.levels.map((l) => l.from).filter(Boolean)).toEqual(spec.levels.map((l) => l.from).filter(Boolean).map((f) => f!.split(', ').map((x) => (x === '2p' ? '2pz' : x)).join(', ')));
  });
});

