// @vitest-environment jsdom
//
// Code review 2026-11-26, batch 09: RTF reading and writing (F128, F129, F130, F593, F594, F595,
// F596, F597, F598, F599). Control words as Microsoft's Rich Text Format specification 1.9.1
// describes them: \line (a line break inside the paragraph), \sect / \sbknone (section breaks),
// \ftnalt (an endnote), \ansicpgN and \fcharsetN (code pages), \clmgf / \clmrg and \clvmgf /
// \clvmrg (merged cells), \listtext (a list item's number as shown).

import { describe, it, expect } from 'vitest';
import { newDocument, type DocText } from '../src/document/document';
import { readRtf, writeRtf } from '../src/io/rtf';
import * as rt from '../src/richtext';
import type { ParaStyle, TableData, TextRun } from '../src/model';

const bytes = (s: string) => new TextEncoder().encode(s);
const text = (u: Uint8Array) => new TextDecoder('latin1').decode(u);
// a 1 × 1 PNG, built in the test (PNG signature, IHDR, IDAT, IEND)
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG = Uint8Array.from(atob(PNG_B64), (c) => c.charCodeAt(0));
// GIF89a header bytes (the GIF89a specification's signature and version)
const GIF = 'data:image/gif;base64,' + btoa('GIF89a\x01\x00\x01\x00\x00\x00\x00;');

function doc(runs: TextRun[], paras: ParaStyle[], objects: DocText['objects'] = {}): DocText {
  return { ...newDocument(), runs, paras, objects };
}

describe('RTF line breaks and sections (F128, F595)', () => {
  it('keeps the paragraph style before a \\line and marks the next line soft', () => {
    const src = String.raw`{\rtf1\ansi{\stylesheet{\s0 Normal;}{\s1 heading 1;}}\pard\qc\s1 Title\line Subtitle\par}`;
    const { doc: d } = readRtf(bytes(src));
    expect(rt.plainText(d.runs)).toBe('Title\nSubtitle');
    expect(d.paras[0]).toMatchObject({ style: 'Heading1', align: 'center' });
    expect(d.paras[0].soft).toBeUndefined();
    expect(d.paras[1]).toMatchObject({ style: 'Heading1', align: 'center', soft: true });
  });

  it('keeps a cell\'s paragraphs in step with its \\line breaks', () => {
    const src = String.raw`{\rtf1\ansi\trowd\cellx2000\pard\intbl\qc a\line b\par\pard\intbl\qr c\cell\row}`;
    const { doc: d } = readRtf(bytes(src));
    const tb = Object.values(d.objects).find((o) => o.kind === 'table');
    if (tb?.kind !== 'table') throw new Error('no table');
    const cell = tb.table.rows[0][0];
    expect(rt.plainText(cell.runs)).toBe('a\nb\nc');
    expect(cell.paras?.map((p) => p.align)).toEqual(['center', 'center', 'right']);
    expect(cell.paras?.[1].soft).toBe(true);
  });

  it('ends the paragraph at \\sect and starts a new page there', () => {
    const src = String.raw`{\rtf1\ansi\pard End of part one\sect\sectd\pard Part two\par}`;
    const { doc: d } = readRtf(bytes(src));
    expect(rt.plainText(d.runs)).toBe('End of part one\nPart two');
    expect(d.paras[1].pageBreak).toBe(true);
  });

  it('starts no new page for a continuous section (\\sbknone)', () => {
    const src = String.raw`{\rtf1\ansi\pard One\sect\sectd\sbknone\pard Two\par}`;
    const { doc: d } = readRtf(bytes(src));
    expect(rt.plainText(d.runs)).toBe('One\nTwo');
    expect(d.paras[1]?.pageBreak).toBeUndefined();
  });
});

describe('RTF endnotes and code pages (F594, F593)', () => {
  it('opens an endnote (\\ftnalt) as an endnote', async () => {
    const t = doc([{ text: 'See' }, { obj: 1, text: '￼' }], [{}], { 1: { kind: 'note', end: true, runs: [{ text: 'At the end.' }] } });
    const { doc: d } = readRtf(await writeRtf(t));
    const note = Object.values(d.objects).find((o) => o.kind === 'note');
    expect(note).toMatchObject({ kind: 'note', end: true });
  });

  it('reads \\\'hh in the file\'s code page (\\ansicpg1251)', () => {
    // Привет in Windows-1251 (the Unicode Consortium's CP1251 mapping table: П CF, р F0, и E8, в E2, е E5, т F2)
    const src = String.raw`{\rtf1\ansi\ansicpg1251\deff0{\fonttbl{\f0 Arial;}}\pard \'cf\'f0\'e8\'e2\'e5\'f2\par}`;
    expect(rt.plainText(readRtf(bytes(src)).doc.runs)).toBe('Привет');
  });

  it('reads \\\'hh in a font\'s character set (\\fcharset204, Cyrillic)', () => {
    const src = String.raw`{\rtf1\ansi\ansicpg1252\deff0{\fonttbl{\f0 Times;}{\f1\fcharset204 Arial;}}\pard caf\'e9 {\f1 \'cf\'f0\'e8}\par}`;
    expect(rt.plainText(readRtf(bytes(src)).doc.runs)).toBe('café При');
  });

  it('still reads cp1252 bytes from 0x80 to 0x9f as Windows-1252 (0x93 is a left double quote)', () => {
    // Windows-1252: 0x93 “, 0x94 ”, 0x80 €
    const src = String.raw`{\rtf1\ansi\pard \'93\'80\'94\par}`;
    expect(rt.plainText(readRtf(bytes(src)).doc.runs)).toBe('“€”');
  });
});

describe('RTF pictures (F129, F596, F597)', () => {
  it('saves a GIF picture as PNG through the conversion it is given', async () => {
    const t = doc([{ obj: 1, text: '￼' }], [{}], { 1: { kind: 'picture', src: GIF, w: 36, h: 36 } });
    const seen: string[] = [];
    const out = text(await writeRtf(t, { pictureToPng: async (_b, mime) => { seen.push(mime); return PNG; } }));
    expect(seen).toEqual(['image/gif']);
    expect(out).toContain('\\pngblip');
    const pic = Object.values(readRtf(bytes(out)).doc.objects).find((o) => o.kind === 'picture');
    expect(pic?.kind === 'picture' && pic.src).toBe(`data:image/png;base64,${PNG_B64}`);
  });

  it('saves an SVG picture as PNG', async () => {
    const svg = 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');
    const t = doc([{ obj: 1, text: '￼' }], [{}], { 1: { kind: 'picture', src: svg, w: 72, h: 72 } });
    const out = text(await writeRtf(t, { svgToPng: async () => PNG }));
    expect(out).toContain('\\pngblip');
  });

  it('keeps every byte of a picture through save and open', async () => {
    // all 256 byte values after a PNG signature
    const all = new Uint8Array(8 + 256 * 3);
    all.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    for (let i = 0; i < 256 * 3; i++) all[8 + i] = i & 0xff;
    let bin = '';
    for (const b of all) bin += String.fromCharCode(b);
    const src = `data:image/png;base64,${btoa(bin)}`;
    const t = doc([{ obj: 1, text: '￼' }], [{}], { 1: { kind: 'picture', src, w: 10, h: 10 } });
    const pic = Object.values(readRtf(await writeRtf(t)).doc.objects).find((o) => o.kind === 'picture');
    expect(pic?.kind === 'picture' && pic.src).toBe(src);
  });
});

describe('RTF tables (F130, F598)', () => {
  const table = (): TableData => ({
    cols: [60, 60, 60], head: 1, lines: 'grid',
    title: [{ text: 'Table 1. Screening' }],
    notes: [{ text: 'a Isolated yield.', size: 10 }],
    rows: [
      [{ runs: [{ text: 'Merged' }], span: 2 }, { runs: [{ text: '' }] }, { runs: [{ text: 'C' }] }],
      [{ runs: [{ text: 'Down' }], rowSpan: 2 }, { runs: [{ text: 'x' }] }, { runs: [{ text: 'y' }] }],
      [{ runs: [{ text: '' }] }, { runs: [{ text: 'z' }] }, { runs: [{ text: 'w' }] }],
    ],
  });

  it('writes the title above the table and its footnotes below it', async () => {
    const t = doc([{ obj: 1, text: '￼' }], [{}], { 1: { kind: 'table', table: table() } });
    const out = text(await writeRtf(t));
    expect(out.indexOf('Table 1. Screening')).toBeGreaterThan(-1);
    expect(out.indexOf('Table 1. Screening')).toBeLessThan(out.indexOf('\\trowd'));
    expect(out.indexOf('Isolated yield.')).toBeGreaterThan(out.lastIndexOf('\\row'));
    // the footnotes at 0.8 of their size: 10 pt × 0.8 = 8 pt = \fs16 (half points)
    expect(out).toMatch(/\\fs16 a Isolated yield\./);
    const plain = rt.plainText(readRtf(bytes(out)).doc.runs);
    expect(plain).toContain('Table 1. Screening');
    expect(plain).toContain('a Isolated yield.');
  });

  it('marks merged cells across and down', async () => {
    const t = doc([{ obj: 1, text: '￼' }], [{}], { 1: { kind: 'table', table: table() } });
    const rows = text(await writeRtf(t)).split('\\trowd').slice(1).map((r) => r.slice(0, r.indexOf('\n')).split('\\cellx').slice(0, 3));
    expect(rows[0][0]).toContain('\\clmgf');
    expect(rows[0][1]).toContain('\\clmrg');
    expect(rows[0][2]).not.toMatch(/\\clv?m(gf|rg)/);
    expect(rows[1][0]).toContain('\\clvmgf');
    expect(rows[2][0]).toContain('\\clvmrg');
    expect(rows[2][1]).not.toMatch(/\\clv?m(gf|rg)/);
  });
});

describe('RTF list numbers (F599)', () => {
  const listText = (out: string) => [...out.matchAll(/\{\\listtext ([^}]*?)\\tab\}/g)].map((m) => m[1]);

  it('numbers each level on its own and goes on after a sub-item', async () => {
    const paras: ParaStyle[] = [{ list: 'number' }, { list: 'number', level: 1 }, { list: 'number' }];
    const out = text(await writeRtf(doc([{ text: 'one\nsub\ntwo' }], paras)));
    const got = listText(out);
    expect(got[0]).toBe('1.');
    expect(got[1]).not.toBe('2.');
    expect(got[2]).toBe('2.');
  });

  it('starts a list at its Start At number', async () => {
    const out = text(await writeRtf(doc([{ text: 'five\nsix' }], [{ list: 'number', startAt: 5 }, { list: 'number' }])));
    expect(listText(out)).toEqual(['5.', '6.']);
  });

  it('gives a continuation line (cont) no number of its own', async () => {
    const out = text(await writeRtf(doc([{ text: 'one\nmore\ntwo' }], [{ list: 'number' }, { list: 'number', cont: true }, { list: 'number' }])));
    expect(listText(out)).toEqual(['1.', '2.']);
  });
});
