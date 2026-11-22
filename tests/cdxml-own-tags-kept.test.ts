// @vitest-environment jsdom
//
// What only this program reads, kept in its own CDXML tags through save and reopen (and through
// CDX, ChemDraw's binary form of the same file): a reaction step's hand-chosen roles (audit
// G1-15), a picture's frame look, name and other settings (G1-10), and an equation picture
// drawn again from its tag only while ChemDraw still holds the picture written for it (G1-14).
// Drawings are built here in code; the PNGs are a bare signature, header and end chunk written
// by hand to the PNG specification (W3C, 2003), enough for their size to be read.

import { describe, it, expect } from 'vitest';
import { Doc } from '../src/model';
import { readCdxml } from '../src/io/cdxml';
import { writeCdxml } from '../src/io/cdxml-write';
import { cdxmlToCdx, cdxToCdxml } from '../src/io/cdx';

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
