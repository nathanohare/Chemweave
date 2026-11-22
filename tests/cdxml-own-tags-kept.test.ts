// @vitest-environment jsdom
//
// What only this program reads, kept in its own CDXML tags through save and reopen (and through
// CDX, ChemDraw's binary form of the same file): a reaction step's hand-chosen roles (audit
// G1-15), a picture's frame look, name and other settings (G1-10), and an equation picture
// drawn again from its tag only while ChemDraw still holds the picture written for it (G1-14),
// a design shape's text changed in ChemDraw (G1-12), a TLC lane label changed there (G1-13),
// and an org chart's elbow connectors stuck to their boxes (G1-09).
// Drawings are built here in code; the PNGs are a bare signature, header and end chunk written
// by hand to the PNG specification (W3C, 2003), enough for their size to be read.

import { describe, it, expect } from 'vitest';
import { Doc } from '../src/model';
import { readCdxml } from '../src/io/cdxml';
import { writeCdxml } from '../src/io/cdxml-write';
import { cdxmlToCdx, cdxToCdxml } from '../src/io/cdx';
import { putPlate, newPlate } from '../src/design/plates';
import { POINTS } from '../src/editor/arrange';
import { newDiagram, putDiagram } from '../src/design/diagrams';

const viaCdxml = (d: Doc) => readCdxml(writeCdxml(d, { name: 't.cdxml' })).doc;
const viaCdx = (d: Doc) => readCdxml(cdxToCdxml(cdxmlToCdx(writeCdxml(d, { name: 't.cdxml' })))).doc;

/** A → B with a caption above the arrow, roles set by hand. */
function step(manual: boolean): Doc {
  const d = new Doc();
  d.bulk(() => {
    const a1 = d.addAtom(0, 0), a2 = d.addAtom(14, 0);
    d.addBond(a1.id, a2.id);
    const b1 = d.addAtom(100, 0), b2 = d.addAtom(114, 0, 8);
    d.addBond(b1.id, b2.id);
    const c = d.addCaption({ x: 45, y: -10, runs: [{ text: 'heat' }], justify: 'left' });
    d.addArrow({
      tail: { x: 30, y: 0 }, head: { x: 80, y: 0 }, headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'solid', noGo: false, equilibrium: false, sweep: 0, headLength: 6, headWidth: 1.5,
      step: { reactants: [`a${a1.id}`], products: [`a${b1.id}`], above: [`c${c.id}`], below: [], ...(manual ? { manual: true } : {}) },
    });
  });
  return d;
}

describe('a reaction step\'s roles chosen by hand (G1-15)', () => {
  for (const [name, trip] of [['CDXML', viaCdxml], ['CDX', viaCdx]] as const) {
    it(`stay chosen by hand through ${name}`, () => {
      const back = trip(step(true));
      const r = [...back.arrows.values()].find((x) => x.step);
      expect(r?.step?.manual).toBe(true);
      expect(r?.step?.above).toHaveLength(1);
    });
  }
  it('are not marked when they were worked out', () => {
    const r = [...viaCdxml(step(false)).arrows.values()].find((x) => x.step);
    expect(r?.step?.manual).toBeUndefined();
  });
  it('ride on the arrow in the file, where ChemDraw keeps tags', () => {
    const xml = writeCdxml(step(true), { name: 't.cdxml' });
    const doc = new DOMParser().parseFromString(xml.replace(/<!DOCTYPE[^>]*>/, ''), 'application/xml');
    const tag = [...doc.getElementsByTagName('objecttag')].find((t) => t.getAttribute('Name') === 'Chem Illustrator step');
    expect(tag?.parentElement?.nodeName).toBe('arrow');
  });
});

/** A PNG of this many pixels (header only: its pixels are never drawn here). */
function png(w: number, h: number): string {
  const b = new Uint8Array(8 + 25 + 12);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const v = new DataView(b.buffer);
  v.setUint32(8, 13); b.set([0x49, 0x48, 0x44, 0x52], 12); v.setUint32(16, w); v.setUint32(20, h); b.set([8, 6, 0, 0, 0], 24);
  v.setUint32(33, 0); b.set([0x49, 0x45, 0x4e, 0x44], 37);
  return 'data:image/png;base64,' + btoa(String.fromCharCode(...b));
}

function picture(extra: Record<string, unknown>): Doc {
  const d = new Doc();
  d.bulk(() => { d.addShape({ kind: 'picture', x1: 0, y1: 0, x2: 40, y2: 30, src: png(40, 30), px: { w: 40, h: 30 }, ...extra }); });
  return d;
}

describe('a picture\'s settings (G1-10)', () => {
  const settings = { look: { line: 2, lineColor: '#c00000', round: 0.1, shadow: 'soft' }, transparency: 0.25, name: 'Crystal structure', hidden: true, locked: true, link: 'https://example.org/' };
  for (const [name, trip] of [['CDXML', viaCdxml], ['CDX', viaCdx]] as const) {
    it(`come back through ${name}`, () => {
      const s = [...trip(picture(settings)).shapes.values()].find((x) => x.kind === 'picture')!;
      for (const [k, v] of Object.entries(settings)) expect(s[k as keyof typeof s]).toEqual(v);
    });
  }
});

describe('an equation picture changed in ChemDraw (G1-14)', () => {
  const math = { tex: 'E = mc^2', size: 12 };
  const reopen = (xml: string) => [...readCdxml(xml).doc.shapes.values()].find((x) => x.kind === 'picture')!;
  it('is still the equation while the picture is the one written', () => {
    expect(reopen(writeCdxml(picture({ math }), { name: 't.cdxml' })).math).toEqual(math);
  });
  it('is the picture ChemDraw holds once that picture was replaced', () => {
    const xml = writeCdxml(picture({ math }), { name: 't.cdxml' });
    const other = [...atob(png(64, 64).split(',')[1])].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('').toUpperCase();
    const edited = xml.replace(/PNG="[0-9A-F]+"/, `PNG="${other}"`);
    expect(edited).not.toBe(xml);
    const s = reopen(edited);
    expect(s.math).toBeUndefined();
    expect(s.px).toEqual({ w: 64, h: 64 });
  });
  it('is still the equation when ChemDraw wrote the same picture again in other bytes (same pixel size)', () => {
    const xml = writeCdxml(picture({ math }), { name: 't.cdxml' });
    // the same 40 × 30 picture with another byte in its (unread) checksum
    const same = [...atob(png(40, 30).split(',')[1])].map((c, i) => (i === 29 ? 0x7f : c.charCodeAt(0)).toString(16).padStart(2, '0')).join('').toUpperCase();
    expect(reopen(xml.replace(/PNG="[0-9A-F]+"/, `PNG="${same}"`)).math).toEqual(math);
  });
});

describe('the text in a design shape changed in ChemDraw (G1-12)', () => {
  const shape = () => {
    const d = new Doc();
    d.bulk(() => { d.addShape({ kind: 'geo', geo: 'fcDecision', x1: 0, y1: 0, x2: 100, y2: 60, text: { runs: [{ text: 'Original' }] } } as never); });
    return d;
  };
  const text = (d: Doc) => [...d.shapes.values()].find((x) => x.kind === 'geo')?.text?.runs.map((r) => r.text).join('');
  it('stays as it was when ChemDraw left it alone', () => {
    expect(text(viaCdxml(shape()))).toBe('Original');
  });
  it('is ChemDraw\'s text once it was changed there', () => {
    const xml = writeCdxml(shape(), { name: 't.cdxml' });
    const edited = xml.replace(/>Original</, '>EditedInChemDraw<');
    expect(edited).not.toBe(xml);
    const d = readCdxml(edited).doc;
    expect(text(d)).toBe('EditedInChemDraw');
    // read into the shape, not as a caption of its own
    expect(d.captions.size).toBe(0);
  });
});

describe('a TLC lane label changed in ChemDraw (G1-13)', () => {
  const plate = () => {
    const d = new Doc();
    d.edit('TLC', () => { putPlate(d, POINTS, newPlate('tlc', d.style.bondLength), { x: 0, y: 0 }); });
    return d;
  };
  const lanes = (d: Doc) => [...d.shapes.values()].find((s) => s.plate)?.plate?.lanes.map((l) => l.label);
  it('is taken into the plate, so Edit TLC Plate draws it as ChemDraw shows it', () => {
    const xml = writeCdxml(plate(), { name: 't.cdxml' });
    const edited = xml.replace(/>rxn</, '>product<');
    expect(edited).not.toBe(xml);
    expect(lanes(readCdxml(edited).doc)).toEqual(['SM', 'co', 'product']);
  });
  it('leaves the plate alone when nothing changed', () => {
    expect(lanes(viaCdxml(plate()))).toEqual(['SM', 'co', 'rxn']);
  });
  it('takes several changed labels at once, each into its own lane', () => {
    const edited = writeCdxml(plate(), { name: 't.cdxml' }).replace(/>SM</, '>1a<').replace(/>rxn</, '>2b<');
    const got = readCdxml(edited);
    expect(lanes(got.doc)).toEqual(['1a', 'co', '2b']);
    expect(got.stats.notes ?? []).toEqual([]);
  });
  it('keeps both ChemDraw\'s drawing and the plate, marked, with a note, when the changes can\'t be matched to the lanes', () => {
    // a lane label, and one of the two Rf values 0.30: the plate writes its Rf values from each
    // lane's marks ("0.55, 0.30"), so which spot's 0.30 it was can't be told
    const xml = writeCdxml(plate(), { name: 't.cdxml' });
    const edited = xml.replace(/>SM</, '>1a<').replace(/>0\.30</, '>0.35<');
    const got = readCdxml(edited);
    // the plate's settings are kept as they were, marked as changed in another program (review F1b-R07)
    const s = [...got.doc.shapes.values()].find((x) => x.plate);
    expect(s?.plate?.lanes.map((l) => l.label)).toEqual(['SM', 'co', 'rxn']);
    expect(s?.editedOutside).toBe(true);
    // ChemDraw's texts are all still there, as it shows them
    const texts = [...got.doc.captions.values()].map((c) => c.runs.map((r) => r.text).join(''));
    expect(texts).toEqual(expect.arrayContaining(['1a', 'co', 'rxn', '0.35', '0.30']));
    expect(got.stats.notes).toEqual(['The texts of a TLC plate were changed in another program in a way its settings can\'t follow. It is shown as that program left it. Editing it redraws it from its settings, and you will be asked first.']);
    // and nothing is said when it is read as written
    expect(readCdxml(xml).stats.notes ?? []).toEqual([]);
  });
});

describe('connectors (G1-09)', () => {
  const org = () => {
    const d = new Doc();
    d.edit('d', () => putDiagram(d, POINTS, newDiagram('org', 'Boss\n\tLeft\n\tRight'), { x: 50, y: 40 }));
    return d;
  };
  for (const [name, trip] of [['CDXML', viaCdxml], ['CDX', viaCdx]] as const) {
    it(`stay elbow connectors stuck to their boxes through ${name}`, () => {
      const before = org();
      const lines = [...before.arrows.values()];
      expect(lines.length).toBe(2);
      expect(lines.every((r) => r.elbow && r.from && r.to)).toBe(true);
      const back = trip(before);
      const got = [...back.arrows.values()];
      expect(got.length).toBe(2);
      for (const r of got) {
        expect(r.elbow).toBe(true);
        expect(r.bez).toBeUndefined();
        expect(back.shapes.has(r.from!.shape) && back.shapes.has(r.to!.shape)).toBe(true);
      }
      // stuck to the same connection points of the same boxes (by their text)
      const words = (d: Doc, id: number) => d.shapes.get(id)?.text?.runs.map((x) => x.text).join('');
      const ends = (d: Doc) => [...d.arrows.values()].map((r) => `${words(d, r.from!.shape)}:${r.from!.port}>${words(d, r.to!.shape)}:${r.to!.port}`).sort();
      expect(ends(back)).toEqual(ends(before));
    });
  }
  it('go to ChemDraw as curves along their bends', () => {
    const xml = writeCdxml(org(), { name: 't.cdxml' });
    const doc = new DOMParser().parseFromString(xml.replace(/<!DOCTYPE[^>]*>/, ''), 'application/xml');
    const curves = [...doc.getElementsByTagName('curve')].filter((c) => [...c.children].some((k) => k.getAttribute('Name') === 'Chem Illustrator connector'));
    expect(curves).toHaveLength(2);
    // more than a straight line's four points: the corners are there
    for (const c of curves) expect(c.getAttribute('CurvePoints')!.trim().split(/\s+/).length / 2).toBeGreaterThan(6);
  });
  it('moved in ChemDraw, stay as ChemDraw has them', () => {
    const xml = writeCdxml(org(), { name: 't.cdxml' });
    // move every connector's points 10 pt to the right
    const moved = xml.replace(/(<curve[^>]*CurvePoints=")([^"]+)"/g, (_, a, p) => a + p.trim().split(/\s+/).map((v: string, i: number) => (i % 2 ? v : String(Number(v) + 10))).join(' ') + '"');
    const back = readCdxml(moved).doc;
    for (const r of back.arrows.values()) { expect(r.elbow).toBeUndefined(); expect(r.from).toBeUndefined(); }
  });
});
