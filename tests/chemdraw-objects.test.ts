// @vitest-environment jsdom
//
// ChemDraw's TLC plates and spectra (src/io/chemdraw-objects.ts): shown as pictures drawn the way
// ChemDraw draws them, and saved back to CDXML as the ChemDraw objects themselves, so ChemDraw can
// still edit them.
//
// The files are built here. Where a check says how ChemDraw draws something, that was measured in
// ChemDraw 25.0.2 (2026-11-24) from a test file holding every setting of these objects, opened in
// ChemDraw and saved again: lanes share the middle 0.9 of the plate (3 lanes at 0.2, 0.5, 0.8 of
// its width), spot sizes are in 1/65536 point, the Rf label's baseline starts at (lane + W/2 −
// 0.87, spot − H/2 − 0.3); Infrared runs its X axis high to low and has a Y axis, NMR has none, an
// NMR spectrum in PPM is labelled PPM and runs high to low, and mass units are drawn as sticks.

import { describe, it, expect } from 'vitest';
import { readCdxml } from '../src/io/cdxml';
import { writeCdxml } from '../src/io/cdxml-write';
import { cdxmlToCdx, cdxToCdxml } from '../src/io/cdx';
import { cdObjectPicture } from '../src/io/chemdraw-objects';
import { fromDataUrl } from '../src/render/images';
import type { Shape } from '../src/model';

const data = Array.from({ length: 64 }, (_, k) => (Math.exp(-(((k - 20) / 3) ** 2)) + 0.5 * Math.exp(-(((k - 44) / 2) ** 2))).toFixed(3)).join(' ');
const plate = (id: number, x: number, y: number, lanes: string) =>
  `<tlcplate id="${id}" TopLeft="${x} ${y}" TopRight="${x + 90} ${y}" BottomRight="${x + 90} ${y + 130}" BottomLeft="${x} ${y + 130}" BoundingBox="${x} ${y} ${x + 90} ${y + 130}" OriginFraction="0.1" SolventFrontFraction="0.1" ShowOrigin="yes" ShowSolventFront="yes" ShowBorders="yes" Z="5">${lanes}</tlcplate>`;
const spot = (id: number, a: string) => `<tlclane id="${id}"><tlcspot id="${id + 1}" Rf="0.5" ${a}/></tlclane>`;
const spec = (id: number, x: number, y: number, a: string) => `<spectrum id="${id}" BoundingBox="${x} ${y} ${x + 95} ${y + 55}" XLow="0" XSpacing="0.5" Z="6" ${a}>${data}</spectrum>`;
const file = (body: string) => `<?xml version="1.0" encoding="UTF-8" ?><CDXML BondLength="14.4" LineWidth="0.6" BoldWidth="2"><colortable><color r="1" g="1" b="1"/><color r="0" g="0" b="0"/><color r="1" g="0" b="0"/></colortable><fonttable><font id="3" charset="iso-8859-1" name="Arial"/></fonttable><page id="1" BoundingBox="0 0 800 600">${body}</page></CDXML>`;

const XML = file(
  plate(10, 40, 60, spot(11, 'ShowRf="yes" Width="393216" Height="393216"') + spot(13, 'Width="393216" Height="393216" CurveType="2"') + spot(15, 'Width="393216" Height="393216" CurveType="4" Tail="524288"'))
  + spec(20, 300, 60, 'Class="Infrared" XAxisLabel="cm-1"') + spec(21, 300, 160, 'Class="NMR" XType="PartsPerMillion"') + spec(22, 300, 260, 'XType="MassUnits"')
  + '<t id="30" p="40 300"><s font="3" size="10">a caption</s></t>',
);

const parse = (s: string) => new DOMParser().parseFromString(s, 'application/xml');
const els = (s: string, name: string) => Array.from(parse(s).getElementsByTagName(name));
const svgOf = (s: Shape) => new TextDecoder().decode(fromDataUrl(s.src!).bytes);
const pictures = (xml: string) => [...readCdxml(xml).doc.shapes.values()].filter((s) => s.cdObject);
const ser = (e: Element) => new XMLSerializer().serializeToString(e);

describe('ChemDraw TLC plates and spectra', () => {
  it('are shown as pictures, not skipped', () => {
    const r = readCdxml(XML);
    expect(r.stats.skipped.tlcplate ?? 0).toBe(0);
    expect(r.stats.skipped.spectrum ?? 0).toBe(0);
    const pics = pictures(XML);
    expect(pics.map((s) => s.cdObject!.kind)).toEqual(['tlcplate', 'spectrum', 'spectrum', 'spectrum']);
    for (const s of pics) {
      expect(s.kind).toBe('picture');
      expect(s.src).toMatch(/^data:image\/svg\+xml/);
      expect(parse(svgOf(s)).getElementsByTagName('parsererror').length).toBe(0);
    }
  });

  it('draw a plate with ChemDraw’s lane places, spot shapes and Rf label', () => {
    const el = parse(XML).getElementsByTagName('tlcplate')[0];
    const pic = cdObjectPicture(el, { color: () => undefined, lineWidth: 0.6 })!;
    const svg = parse(pic.svg);
    const paths = Array.from(svg.getElementsByTagName('path'));
    // three lanes at 0.2, 0.5 and 0.8 of the plate's width (40 to 130); Rf 0.5 halfway between origin (177) and front (73)
    expect(paths.map((p) => p.getAttribute('transform'))).toEqual(['translate(58 125)', 'translate(85 125)', 'translate(112 125)']);
    expect(paths[1].getAttribute('stroke-dasharray')).toBeTruthy(); // CurveType 2: dashed
    expect(paths[2].getAttribute('stroke-width')).toBe('1.2'); // CurveType 4: bold, twice the line
    expect(paths[2].getAttribute('d')).toContain('A 3 11 '); // tail of 8 pt: lower half 3 + 8 deep
    // the Rf label where ChemDraw puts it: (58 + 3 − 0.87, 125 − 3 − 0.3)
    const t = svg.getElementsByTagName('text')[0];
    expect([t.getAttribute('x'), t.getAttribute('y')]).toEqual(['60.13', '121.7']);
    expect(t.textContent).toBe('Rf = 0.50');
    // border, origin, front and a tick at each lane
    expect(svg.getElementsByTagName('polygon').length).toBe(1);
    expect(svg.getElementsByTagName('line').length).toBe(2 + 3);
  });

  it('draw spectra as ChemDraw does for their type', () => {
    const [, ir, nmr, ms] = pictures(XML).map(svgOf).map(parse);
    const texts = (d: Document) => Array.from(d.getElementsByTagName('text')).map((t) => t.textContent);
    // Infrared: X axis high to low (20 left of 0), a Y axis, its own label
    const irX = Array.from(ir.getElementsByTagName('text')).filter((t) => t.textContent === '0' || t.textContent === '20').map((t) => [t.textContent, Number(t.getAttribute('x'))] as const);
    expect(irX.find(([s]) => s === '20')![1]).toBeLessThan(irX.find(([s]) => s === '0')![1]);
    expect(texts(ir)).toEqual(expect.arrayContaining(['0.0', '0.5', '1.0', 'cm-1', 'Unknown']));
    // NMR in PPM: no Y axis, labelled PPM
    expect(texts(nmr)).toContain('PPM');
    expect(texts(nmr)).not.toContain('0.5');
    // mass units: sticks, not a line
    expect(ms.getElementsByTagName('polyline').length).toBe(0);
    expect(ms.getElementsByTagName('line').length).toBeGreaterThan(64);
  });

  it('go back into the file unchanged when saved', () => {
    const r = readCdxml(XML);
    const out = writeCdxml(r.doc, { name: 'x.cdxml' });
    for (const name of ['tlcplate', 'spectrum']) expect(els(out, name).map(ser)).toEqual(els(XML, name).map(ser));
    expect(out).not.toContain('embeddedobject');
    // and again as pictures, the same
    expect(pictures(out).map((s) => [s.x1, s.y1, s.x2, s.y2])).toEqual(pictures(XML).map((s) => [s.x1, s.y1, s.x2, s.y2]));
  });

  it('move and stretch with their pictures', () => {
    const r = readCdxml(XML);
    const [pl, ir] = [...r.doc.shapes.values()].filter((s) => s.cdObject);
    r.doc.edit('Move', () => {
      r.doc.updateShape(pl.id, { x1: pl.x1 + 10, y1: pl.y1 + 20, x2: pl.x2 + 10, y2: pl.y2 + 20 });
      r.doc.updateShape(ir.id, { x1: ir.x1, y1: ir.y1, x2: ir.x1 + (ir.x2 - ir.x1) * 2, y2: ir.y2 });
    });
    const out = writeCdxml(r.doc, { name: 'x.cdxml' });
    const p = els(out, 'tlcplate')[0];
    expect(p.getAttribute('TopLeft')).toBe('50.00 80.00');
    expect(p.getAttribute('BottomRight')).toBe('140.00 210.00');
    expect(p.getAttribute('id')).toBe('10');
    const s = els(out, 'spectrum')[0];
    const bb = s.getAttribute('BoundingBox')!.split(' ').map(Number);
    // stretched twice as wide from the picture's left (which takes in the Y axis's label)
    expect(bb[0]).toBeCloseTo(ir.x1 + (300 - ir.x1) * 2, 1);
    expect(bb[2] - bb[0]).toBeCloseTo(95 * 2, 1);
    expect(s.textContent).toBe(data); // the data itself is never touched
  });

  it('are written again as ChemDraw objects when copied, with ids of their own', () => {
    const r = readCdxml(XML);
    const pl = [...r.doc.shapes.values()].find((s) => s.cdObject?.kind === 'tlcplate')!;
    const { id: _id, ...rest } = pl;
    r.doc.edit('Paste', () => r.doc.addShape({ ...rest, x1: pl.x1 + 200, x2: pl.x2 + 200 }));
    const out = writeCdxml(r.doc, { name: 'x.cdxml' });
    const plates = els(out, 'tlcplate');
    expect(plates.length).toBe(2);
    expect(plates[1].getAttribute('TopLeft')).toBe('240.00 60.00');
    const ids = Array.from(parse(out).getElementsByTagName('*')).map((e) => e.getAttribute('id')).filter((x) => x);
    expect(new Set(ids).size).toBe(ids.length);
    expect(pictures(out).filter((s) => s.cdObject!.kind === 'tlcplate').length).toBe(2);
  });

  it('leave the file when deleted', () => {
    const r = readCdxml(XML);
    r.doc.edit('Delete', () => { for (const s of [...r.doc.shapes.values()]) if (s.cdObject?.kind === 'spectrum') r.doc.removeShape(s.id); });
    const out = writeCdxml(r.doc, { name: 'x.cdxml' });
    expect(els(out, 'spectrum').length).toBe(0);
    expect(els(out, 'tlcplate').length).toBe(1);
  });

  it('turn with their pictures (a plate), and keep their group and place in the order', () => {
    const r = readCdxml(XML);
    const pl = [...r.doc.shapes.values()].find((s) => s.cdObject?.kind === 'tlcplate')!;
    const cap = [...r.doc.captions.values()][0];
    r.doc.edit('Turn and group', () => {
      r.doc.updateShape(pl.id, { rot: 90, grp: 7, z: 99 });
      r.doc.updateCaption(cap.id, { grp: 7 });
    });
    const out = writeCdxml(r.doc, { name: 'x.cdxml' });
    const p = els(out, 'tlcplate')[0];
    // turned a quarter clockwise about its picture's middle: the top left corner is now at the top right
    const mid = { x: (pl.x1 + pl.x2) / 2, y: (pl.y1 + pl.y2) / 2 };
    const [x, y] = p.getAttribute('TopLeft')!.split(' ').map(Number);
    expect(x).toBeCloseTo(mid.x - (60 - mid.y), 1);
    expect(y).toBeCloseTo(mid.y + (40 - mid.x), 1);
    expect(p.parentElement!.nodeName).toBe('group');
    const again = readCdxml(out).doc;
    const pl2 = [...again.shapes.values()].find((s) => s.cdObject?.kind === 'tlcplate')!;
    expect(pl2.grp).toBeDefined();
    expect(pl2.grp).toBe([...again.captions.values()][0].grp);
    expect(pl2.y2 - pl2.y1).toBeLessThan(pl2.x2 - pl2.x1); // lying on its side
  });

  it('never hang, fail or make up points on odd spectra', () => {
    const sp = (id: number, y: number, a: string, d: string) => `<spectrum id="${id}" BoundingBox="10 ${y} 105 ${y + 55}" ${a}>${d}</spectrum>`;
    const odd = file(sp(40, 10, 'XLow="1e17" XSpacing="1"', '1 2 3 4') + sp(41, 100, 'XLow="0" XSpacing="1"', '') + sp(42, 200, 'XLow="0" XSpacing="1"', Array.from({ length: 131072 }, (_, k) => String(k % 7)).join(' ')));
    const t = Date.now();
    const pics = pictures(odd);
    expect(Date.now() - t).toBeLessThan(10000);
    expect(pics.length).toBe(3);
    // an empty spectrum is a frame with no line and no numbers
    const empty = parse(svgOf(pics[1]));
    expect(empty.getElementsByTagName('polyline').length).toBe(0);
    expect(Array.from(empty.getElementsByTagName('text')).map((x) => x.textContent)).toEqual(['Unknown']);
  });

  it('are left out, never fatal, when a copy has lost its ChemDraw object', () => {
    const r = readCdxml(XML);
    const pl = [...r.doc.shapes.values()].find((s) => s.cdObject?.kind === 'tlcplate')!;
    const { id: _id, ...rest } = pl;
    r.doc.edit('Paste', () => {
      r.doc.addShape({ ...rest, cdObject: { kind: 'tlcplate', xml: 'not xml' } as never });
      r.doc.addShape({ ...rest, cdObject: { kind: 'tlcplate', xml: pl.cdObject!.xml } as never });
    });
    const out = writeCdxml(r.doc, { name: 'x.cdxml' });
    expect(els(out, 'tlcplate').length).toBe(1);
  });

  it('go to CDX and back as ChemDraw objects', () => {
    const saved = writeCdxml(readCdxml(XML).doc, { name: 'x.cdxml' });
    const back = cdxToCdxml(cdxmlToCdx(saved));
    expect(els(back, 'tlcplate').length).toBe(1);
    expect(els(back, 'spectrum').length).toBe(3);
    expect(pictures(back).length).toBe(4);
    // attribute for attribute, with each spectrum's data (a plate copied to ChemDraw is not blank, a spectrum not empty)
    const num = (v: string) => (v.trim() && Number.isFinite(Number(v)) ? String(Number(v)) : v);
    const of = (x: string) => ['tlcplate', 'tlclane', 'tlcspot', 'spectrum'].flatMap((n) => els(x, n)).map((e) =>
      `${e.nodeName} ${Array.from(e.attributes).map((a) => `${a.name}=${num(a.value)}`).sort().join(' ')} ${e.nodeName === 'spectrum' ? (e.textContent ?? '').trim().split(/\s+/).map(num).join(' ') : ''}`);
    expect(of(back)).toEqual(of(saved));
  });
});
