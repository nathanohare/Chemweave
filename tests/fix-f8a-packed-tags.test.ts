// @vitest-environment jsdom
//
// F8a item 9 (F7b R09): a structure's 3-D depths and bond places ride in one settings tag on its
// <fragment> (src/io/cdxml-more.ts fragMore) instead of one per atom and bond, with a print of the
// structure's atoms and bonds: an atom added, deleted or renumbered in ChemDraw drops them rather
// than put one on the wrong atom. Files with the older tag on each atom still read. Drawings are
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

function ring(): Doc {
  const d = new Doc();
  d.bulk(() => {
    const ids = DEPTHS.map((z, i) => { const a = d.addAtom(14.4 * Math.cos(i * Math.PI / 3), 14.4 * Math.sin(i * Math.PI / 3)); d.updateAtom(a.id, { depth: z }); return a.id; });
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

  it('drops them all when ChemDraw deleted an atom (replayed on the saved file)', () => {
    const x = parse(writeCdxml(ring(), { name: 't.cdxml' }));
    const n = x.getElementsByTagName('n')[2];
    n.parentNode!.removeChild(n);
    expect(depths(readCdxml(serial(x)).doc).every((z) => z === null)).toBe(true);
  });

  it('drops them when ChemDraw renumbered the atoms', () => {
    const x = parse(writeCdxml(ring(), { name: 't.cdxml' }));
    for (const n of x.getElementsByTagName('n')) n.setAttribute('id', String(Number(n.getAttribute('id')) + 1000));
    expect(depths(readCdxml(serial(x)).doc).every((z) => z === null)).toBe(true);
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
