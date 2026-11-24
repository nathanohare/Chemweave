// @vitest-environment jsdom
//
// The CDXML sampler (tests/cdxml-sampler.ts): a file built here in code that holds every object
// of the CDX/CDXML specification and every value its property pages list. Checks that it does,
// that this program opens it, draws it and saves it again (as CDXML and as CDX), and prints
// which of its element and attribute names a save drops, for a person to look at. (A drop is
// printed, not failed: some objects, such as 3D query constraints, are kept only as they were.)
//
// SAMPLER_OUT=<file.cdxml> writes the sampler out, to open in ChemDraw.

import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { samplerCdxml, SPEC_OBJECTS, SPEC_VALUES, ELEMENTS } from './cdxml-sampler';
import { readCdxml } from '../src/io/cdxml';
import { writeCdxml } from '../src/io/cdxml-write';
import { cdxmlToCdx, cdxToCdxml } from '../src/io/cdx';

const xml = samplerCdxml();
if (process.env.SAMPLER_OUT) writeFileSync(process.env.SAMPLER_OUT, xml);

const parse = (s: string) => new DOMParser().parseFromString(s, 'application/xml');
const all = (d: Document) => Array.from(d.getElementsByTagName('*'));
/** Each element name, and each element's attribute names, as "element@attribute". */
const names = (d: Document) => {
  const out = new Set<string>();
  for (const e of all(d)) { out.add(e.nodeName); for (const a of Array.from(e.attributes)) out.add(`${e.nodeName}@${a.name}`); }
  return out;
};
/** Each element and attribute name of `a` that `b` lacks. */
const lost = (a: Set<string>, b: Set<string>) => [...a].filter((k) => !b.has(k)).sort();

describe('CDXML sampler', () => {
  const doc = parse(xml);

  it('is well-formed XML', () => {
    expect(doc.getElementsByTagName('parsererror').length).toBe(0);
    expect(doc.documentElement.nodeName).toBe('CDXML');
  });

  it('holds every object of the specification', () => {
    const have = new Set(all(doc).map((e) => e.nodeName));
    expect(SPEC_OBJECTS.filter((o) => !have.has(o))).toEqual([]);
  });

  it('holds every listed value of every enumerated property', () => {
    const seen = new Map<string, Set<string>>();
    for (const e of all(doc)) for (const a of Array.from(e.attributes)) {
      if (!SPEC_VALUES[a.name]) continue;
      const s = seen.get(a.name) ?? new Set<string>();
      // (several values may be listed together, such as LineType="Dashed Bold" or Order="1 2")
      for (const v of a.value.split(/\s+/)) s.add(v);
      seen.set(a.name, s);
    }
    const missing = Object.entries(SPEC_VALUES).flatMap(([k, vals]) => vals.filter((v) => !seen.get(k)?.has(v)).map((v) => `${k}=${v}`));
    expect(missing).toEqual([]);
  });

  it('holds every element, 1 to 118', () => {
    const els = new Set(all(doc).filter((e) => e.nodeName === 'n').map((e) => e.getAttribute('Element') ?? '6'));
    expect(ELEMENTS.map((_, i) => String(i + 1)).filter((z) => !els.has(z))).toEqual([]);
  });

  it('opens, saves and opens again with the same atoms, bonds, captions, arrows and shapes', () => {
    const first = readCdxml(xml);
    expect(first.stats.atoms).toBeGreaterThan(700);
    expect(first.stats.bonds).toBeGreaterThan(400);
    const out = writeCdxml(first.doc, { name: 'cdxml-sampler.cdxml' });
    const again = readCdxml(out);
    expect(again.stats.atoms).toBe(first.stats.atoms);
    expect(again.stats.bonds).toBe(first.stats.bonds);
    expect(again.stats.captions).toBe(first.stats.captions);
    expect(again.stats.arrows).toBe(first.stats.arrows);
    expect(again.stats.shapes).toBe(first.stats.shapes);
    const drop = lost(names(doc), names(parse(out)));
    const skipped = first.stats.skipped;
    console.log(`CDXML sampler: ${first.stats.atoms} atoms, ${first.stats.bonds} bonds, ${first.stats.captions} captions, ${first.stats.arrows} arrows, ${first.stats.shapes} shapes`);
    console.log(`  not shown on opening: ${JSON.stringify(skipped)}`);
    console.log(`  element and attribute names a CDXML save drops (${drop.length}): ${drop.join(', ')}`);
    // whether a second save of what was saved is the same (printed, not failed: a table is written
    // again with new ids and filled shapes move in the stacking order, being fixed on its own;
    // tests/corpus.test.ts fails on it for real files)
    const second = writeCdxml(again.doc, { name: 'cdxml-sampler.cdxml' });
    console.log(`  a second save is ${second === writeCdxml(readCdxml(second).doc, { name: 'cdxml-sampler.cdxml' }) ? 'the same' : 'NOT the same'} as the first`);
  });

  it('goes to CDX and back', () => {
    const back = cdxToCdxml(cdxmlToCdx(xml));
    const d = parse(back);
    expect(d.getElementsByTagName('parsererror').length).toBe(0);
    const a = readCdxml(xml).stats, b = readCdxml(back).stats;
    expect([b.atoms, b.bonds, b.captions, b.arrows]).toEqual([a.atoms, a.bonds, a.captions, a.arrows]);
    const drop = lost(names(doc), names(d));
    console.log(`  element and attribute names CDX drops (${drop.length}): ${drop.join(', ')}`);
  });
});
