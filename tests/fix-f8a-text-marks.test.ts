// @vitest-environment jsdom
//
// F8a item 8: a text's highlight and language through CDXML and CDX. ChemDraw's text style is a
// font, size, face and colour only (CDX SDK: CDXString and Style), and its own highlightColor is
// the disc behind an atom or bond (src/io/cdxml.ts), not a text highlighter, so both ride in the
// hidden settings tag (src/io/cdxml-more.ts) with a print of the text they sit on: text edited in
// ChemDraw drops them, a text deleted there takes its tag with it, and a file opened and saved
// unchanged saves byte for byte the same. Drawings are built here in code.

import { describe, it, expect } from 'vitest';
import { Doc } from '../src/model';
import { readCdxml } from '../src/io/cdxml';
import { writeCdxml } from '../src/io/cdxml-write';
import { cdxmlToCdx, cdxToCdxml } from '../src/io/cdx';
import { MORE_TAG } from '../src/io/cdxml-more';

const parse = (xml: string) => new DOMParser().parseFromString(xml.replace(/<!DOCTYPE[^>]*>/, ''), 'application/xml');
const serial = (x: Document) => new XMLSerializer().serializeToString(x);

function drawing(): Doc {
  const d = new Doc();
  d.bulk(() => {
    d.addCaption({ x: 0, y: 0, runs: [{ text: 'Stir ' }, { text: 'overnight', highlight: '#ffff00', lang: 'de-DE' }, { text: ' at rt' }], justify: 'left' });
    d.addCaption({ x: 0, y: 60, runs: [{ text: 'plain text' }], justify: 'left' });
  });
  return d;
}
const marked = (d: Doc) => [...d.captions.values()][0].runs.map((r) => [r.text, r.highlight ?? null, r.lang ?? null]);
const WANT = [['Stir ', null, null], ['overnight', '#ffff00', 'de-DE'], [' at rt', null, null]];

describe('a text\'s highlight and language in CDXML', () => {
  it('comes back through CDXML and through CDX', () => {
    const xml = writeCdxml(drawing(), { name: 't.cdxml' });
    expect(marked(readCdxml(xml).doc)).toEqual(WANT);
    expect(marked(readCdxml(cdxToCdxml(cdxmlToCdx(xml))).doc)).toEqual(WANT);
  });

  it('writes a tag only on the text that has them', () => {
    const tags = [...parse(writeCdxml(drawing(), { name: 't.cdxml' })).getElementsByTagName('t')]
      .map((t) => [...t.children].some((k) => k.nodeName === 'objecttag' && k.getAttribute('Name') === MORE_TAG));
    expect(tags).toEqual([true, false]);
  });

  it('is dropped when the text is edited in ChemDraw (replayed on the saved file)', () => {
    const x = parse(writeCdxml(drawing(), { name: 't.cdxml' }));
    const s = [...x.getElementsByTagName('s')].find((e) => e.textContent === 'overnight')!;
    s.textContent = 'for 2 h';
    const runs = [...readCdxml(serial(x)).doc.captions.values()][0].runs;
    expect(runs.some((r) => r.highlight || r.lang)).toBe(false);
    expect(runs.map((r) => r.text).join('')).toBe('Stir for 2 h at rt');
  });

  it('goes with its text when ChemDraw deletes the text', () => {
    const x = parse(writeCdxml(drawing(), { name: 't.cdxml' }));
    const t = [...x.getElementsByTagName('t')].find((e) => e.textContent?.includes('overnight'))!;
    t.parentNode!.removeChild(t);
    const back = readCdxml(serial(x)).doc;
    expect([...back.captions.values()].map((c) => c.runs.map((r) => r.text).join(''))).toEqual(['plain text']);
    expect([...back.captions.values()][0].runs.some((r) => r.highlight || r.lang)).toBe(false);
    expect(serial(x)).not.toContain('overnight');
  });

  it('goes with its text when the text is deleted here', () => {
    const r = readCdxml(writeCdxml(drawing(), { name: 't.cdxml' }));
    const d = r.doc;
    d.bulk(() => d.removeCaption([...d.captions.values()][0].id));
    const xml = writeCdxml(d, { name: 't.cdxml' });
    expect(xml).not.toContain('overnight');
    expect(xml).not.toContain(MORE_TAG);
  });

  it('saves an untouched file byte for byte the same', () => {
    const xml = writeCdxml(drawing(), { name: 't.cdxml' });
    const r = readCdxml(xml);
    expect(writeCdxml(r.doc, { name: 't.cdxml' })).toBe(xml);
  });

  it('writes a highlight named or written short as #rrggbb, and keeps Word\'s x-none and en_US (review F8a-R10)', () => {
    const d = new Doc();
    d.bulk(() => { d.addCaption({ x: 0, y: 0, runs: [{ text: 'a', highlight: 'yellow' }, { text: 'b', highlight: '#0f0', lang: 'x-none' }, { text: 'c', lang: 'en_US' }], justify: 'left' }); });
    const back = [...readCdxml(writeCdxml(d, { name: 't.cdxml' })).doc.captions.values()][0].runs;
    expect(back.map((r) => [r.text, r.highlight ?? null, r.lang ?? null])).toEqual([['a', '#ffff00', null], ['b', '#00ff00', 'x-none'], ['c', null, 'en_US']]);
  });

  it('keeps its place after a line break typed as \\r\\n', () => {
    const d = new Doc();
    d.bulk(() => { d.addCaption({ x: 0, y: 0, runs: [{ text: 'line one\r\nline ' }, { text: 'two', highlight: '#ffff00' }], justify: 'left' }); });
    const back = [...readCdxml(writeCdxml(d, { name: 't.cdxml' })).doc.captions.values()][0].runs;
    expect(back.filter((r) => r.highlight).map((r) => r.text)).toEqual(['two']);
  });

  it('writes no tag for a text with neither', () => {
    const d = new Doc();
    d.bulk(() => { d.addCaption({ x: 0, y: 0, runs: [{ text: 'plain' }], justify: 'left' }); });
    expect(writeCdxml(d, { name: 't.cdxml' })).not.toContain(MORE_TAG);
  });
});
