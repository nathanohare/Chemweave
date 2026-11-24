// @vitest-environment jsdom
//
// F8a item 9 (F7b R09): a structure's 3-D depths and bond places ride in one settings tag on its
// <fragment> (src/io/cdxml-more.ts fragMore) instead of one per atom and bond, with a print of the
// structure's atoms and bonds: an atom added, deleted or renumbered in ChemDraw drops them rather
// than put one on the wrong atom; renumbered ids keep them all. Files with the older tag on each atom still read. Drawings are
// built here in code.

import { describe, it, expect } from 'vitest';
import { Doc } from '../src/model';
import { readCdxml } from '../src/io/cdxml';
import { writeCdxml } from '../src/io/cdxml-write';
import { cdxmlToCdx, cdxToCdxml } from '../src/io/cdx';
import { MORE_TAG } from '../src/io/cdxml-more';

const parse = (xml: string) => new DOMParser().parseFromString(xml.replace(/<!DOCTYPE[^>]*>/, ''), 'application/xml');
const serial = (x: Document) => new XMLSerializer().serializeToString(x);
const DEPTHS = [-7, 0.25, 7.5, -7, 0.25, 7.5];

function ring(ds: number[] = DEPTHS): Doc {
  const d = new Doc();
  d.bulk(() => {
    const ids = ds.map((z, i) => { const a = d.addAtom(14.4 * Math.cos(i * Math.PI / 3), 14.4 * Math.sin(i * Math.PI / 3)); d.updateAtom(a.id, { depth: z }); return a.id; });
    ids.forEach((id, i) => d.addBond(id, ids[(i + 1) % 6], 1, 'solid', i === 0 ? { z: 4 } : {}));
  });
  return d;
}
const tagHolders = (xml: string) => [...parse(xml).getElementsByTagName('objecttag')].filter((t) => t.getAttribute('Name') === MORE_TAG).map((t) => (t.parentNode as Element).nodeName);
const depths = (d: Doc) => [...d.atoms.values()].map((a) => a.depth ?? null);

describe('one settings tag per structure', () => {
  it('writes one tag on the fragment, none on its atoms and bonds', () => {
    expect(tagHolders(writeCdxml(ring(), { name: 't.cdxml' }))).toEqual(['fragment']);
  });

  it('brings the depths and the bond place back through CDXML and CDX', () => {
    const xml = writeCdxml(ring(), { name: 't.cdxml' });
    for (const back of [readCdxml(xml).doc, readCdxml(cdxToCdxml(cdxmlToCdx(xml))).doc]) {
      expect(depths(back)).toEqual(DEPTHS);
      expect([...back.bonds.values()].map((b) => b.z ?? null)).toEqual([4, null, null, null, null, null]);
    }
  });

  it('drops only the deleted atom\'s depth when ChemDraw deleted an atom (replayed on the saved file; review F8a-R06)', () => {
    const x = parse(writeCdxml(ring(), { name: 't.cdxml' }));
    const n = x.getElementsByTagName('n')[2];
    for (const b of [...x.getElementsByTagName('b')]) if ([b.getAttribute('B'), b.getAttribute('E')].includes(n.getAttribute('id'))) b.parentNode!.removeChild(b);
    n.parentNode!.removeChild(n);
    // (its neighbours have one bond fewer now, so their own prints changed too: theirs go as well)
    expect(depths(readCdxml(serial(x)).doc)).toEqual([DEPTHS[0], null, null, DEPTHS[4], DEPTHS[5]]);
  });

  it('keeps every depth when ChemDraw renumbered the atoms and bonds', () => {
    const x = parse(writeCdxml(ring(), { name: 't.cdxml' }));
    const all = [...x.getElementsByTagName('n'), ...x.getElementsByTagName('b')];
    const old = new Map(all.map((e) => [e.getAttribute('id')!, String(Number(e.getAttribute('id')) + 1000)]));
    for (const e of all) e.setAttribute('id', old.get(e.getAttribute('id')!)!);
    for (const b of x.getElementsByTagName('b')) for (const k of ['B', 'E']) b.setAttribute(k, old.get(b.getAttribute(k)!) ?? b.getAttribute(k)!);
    const back = readCdxml(serial(x)).doc;
    expect(depths(back)).toEqual(DEPTHS);
    expect([...back.bonds.values()].map((b) => b.z ?? null)).toEqual([4, null, null, null, null, null]);
  });

  it('never puts a depth on another atom when ChemDraw both deleted an atom and renumbered the rest (review F8a2-R01)', () => {
    const ds = [-7, 0.25, 7.5, -6, 1.25, 8.5];
    const x = parse(writeCdxml(ring(ds), { name: 't.cdxml' }));
    const gone = x.getElementsByTagName('n')[3];
    for (const b of [...x.getElementsByTagName('b')]) if ([b.getAttribute('B'), b.getAttribute('E')].includes(gone.getAttribute('id'))) b.parentNode!.removeChild(b);
    gone.parentNode!.removeChild(gone);
    // every id renumbered in order from the same first id, as a program saving afresh would (so a
    // later atom takes an earlier one's old id)
    const all = [...x.getElementsByTagName('n'), ...x.getElementsByTagName('b')];
    const first = Math.min(...all.map((e) => Number(e.getAttribute('id'))));
    const ids = new Map(all.map((e, i) => [e.getAttribute('id')!, String(first + i)]));
    for (const e of all) e.setAttribute('id', ids.get(e.getAttribute('id')!)!);
    for (const b of x.getElementsByTagName('b')) for (const k of ['B', 'E']) b.setAttribute(k, ids.get(b.getAttribute(k)!)!);
    const got = depths(readCdxml(serial(x)).doc);
    const kept = [-7, 0.25, 7.5, 1.25, 8.5];
    got.forEach((z, i) => { if (z !== null) expect(z, `atom ${i}`).toBe(kept[i]); });
  });

  it('drops only the changed atom\'s depth when ChemDraw changed its element', () => {
    const x = parse(writeCdxml(ring(), { name: 't.cdxml' }));
    x.getElementsByTagName('n')[3].setAttribute('Element', '8');
    expect(depths(readCdxml(serial(x)).doc)).toEqual([...DEPTHS.slice(0, 3), null, ...DEPTHS.slice(4)]);
  });

  it('keeps the depths when ChemDraw added an atom to the structure', () => {
    const x = parse(writeCdxml(ring(), { name: 't.cdxml' }));
    const f = x.getElementsByTagName('fragment')[0];
    const n = x.createElement('n');
    n.setAttribute('id', '9999'); n.setAttribute('p', '100 100');
    f.insertBefore(n, f.firstElementChild);
    expect(depths(readCdxml(serial(x)).doc).filter((z) => z !== null)).toEqual(DEPTHS);
  });

  it('still reads the older tag on each atom', () => {
    const x = parse(writeCdxml(ring(), { name: 't.cdxml' }));
    const f = x.getElementsByTagName('fragment')[0];
    const tag = [...f.children].find((k) => k.nodeName === 'objecttag' && k.getAttribute('Name') === MORE_TAG)!;
    f.removeChild(tag);
    [...x.getElementsByTagName('n')].forEach((n, i) => {
      const t = x.createElement('objecttag');
      for (const [k, v] of Object.entries({ TagType: 'String', Name: MORE_TAG, Value: JSON.stringify({ depth: DEPTHS[i] }), Visible: 'no' })) t.setAttribute(k, v);
      n.appendChild(t);
    });
    expect(depths(readCdxml(serial(x)).doc)).toEqual(DEPTHS);
  });

  it('saves an untouched file byte for byte the same', () => {
    const xml = writeCdxml(ring(), { name: 't.cdxml' });
    expect(writeCdxml(readCdxml(xml).doc, { name: 't.cdxml' })).toBe(xml);
  });

  it('writes no tag for a flat structure', () => {
    const d = new Doc();
    d.bulk(() => { const a = d.addAtom(0, 0), b = d.addAtom(14.4, 0); d.addBond(a.id, b.id); });
    expect(writeCdxml(d, { name: 't.cdxml' })).not.toContain(MORE_TAG);
  });
});
