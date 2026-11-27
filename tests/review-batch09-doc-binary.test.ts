// @vitest-environment jsdom
//
// Code review 2026-11-26, batch 09: old Word documents (.doc) (F110, F555, F556, F558). Files made
// here by the published layout ([MS-DOC], tests/doc-binary-maker.ts). From [MS-DOC]: a field is
// 0x13 (begin), its code, 0x14 (separator), what it shows, 0x15 (end) (2.8.25 PlcFld); a toggle
// sprm's operand 0x80 means the style's value and 0x81 the opposite of it (2.9.320 ToggleOperand);
// sprmPIlfo's operand is a signed 16-bit ilfo, and 0 or below is no list (2.6.2, sprmPIlfo).

import { describe, it, expect } from 'vitest';
import { readDoc } from '../src/io/doc-binary';
import * as rt from '../src/richtext';
import { makeDoc, sprm, type TestStyle } from './doc-binary-maker';

describe('.doc footnotes (F110)', () => {
  it('shows what a field in a footnote shows, without its code, and keeps its link', () => {
    const body = 'See\x02.\r';
    const at = body.indexOf('\x02');
    const { doc } = readDoc(makeDoc([{ text: body }], [{ at, text: 'From \x13 HYPERLINK "https://example.org/si" \x14the SI\x15 \x13 ADDIN ZOTERO_ITEM {"a":1} \x14[1]\x15.' }]));
    const note = Object.values(doc.objects).find((o) => o.kind === 'note');
    if (note?.kind !== 'note') throw new Error('no note');
    expect(rt.plainText(note.runs)).toBe('From the SI [1].');
    expect(note.runs.find((r) => r.text === 'the SI')?.link).toBe('https://example.org/si');
    expect(note.runs.some((r) => /[\x00-\x08\x0e-\x1f]/.test(r.text))).toBe(false);
  });
});

describe('.doc toggles (F555)', () => {
  // 0 Normal; 1 heading 1, bold
  const styles: TestStyle[] = [{ sti: 0 }, { sti: 1, base: 0, chpx: sprm(0x0835, 1) }];

  it('reads 0x81 as the opposite of the style (not bold in a bold heading)', () => {
    const { doc } = readDoc(makeDoc([{ text: 'Bold plain\r', istd: 1, runs: [[5, 10, sprm(0x0835, 0x81)]] }], [], styles));
    expect(doc.runs.find((r) => r.text.startsWith('Bold'))?.bold).toBe(true);
    expect(doc.runs.find((r) => r.text.includes('plain'))?.bold).toBeUndefined();
  });

  it('reads 0x81 as on where the style is not bold, and 0x80 as the style\'s own value', () => {
    const { doc } = readDoc(makeDoc([
      { text: 'Head same\r', istd: 1, runs: [[5, 9, sprm(0x0835, 0x80)]] },
      { text: 'Body flip\r', istd: 0, runs: [[5, 9, sprm(0x0835, 0x81)]] },
    ], [], styles));
    expect(doc.runs.find((r) => r.text.includes('same'))?.bold).toBe(true);
    expect(doc.runs.find((r) => r.text.includes('flip'))?.bold).toBe(true);
    expect(doc.runs.find((r) => r.text.startsWith('Body'))?.bold).toBeUndefined();
  });
});

describe('.doc lists (F556)', () => {
  it('reads a negative ilfo (numbering taken off) as no list, keeping the indent', () => {
    // ilfo 0xF801 (-2047), and a left indent of 720 twips (sprmPDxaLeft 0x840F)
    const { doc } = readDoc(makeDoc([{ text: 'Plain\r', pap: [...sprm(0x460b, 0x01, 0xf8), ...sprm(0x840f, 0xd0, 0x02)] }]));
    expect(doc.paras[0].list).toBeUndefined();
    expect(doc.paras[0].indent).toBe(36);
  });
});

describe('.doc damaged piece tables (F558)', () => {
  it('reads only as far as the stream goes when the FIB gives far more text', () => {
    const { doc } = readDoc(makeDoc([{ text: 'Short\r' }], [], undefined, { ccpText: 0xfffffff0, pieceEnd: 0xfffffff0 }));
    // (the rest of the stream after the text is read as text, as far as the stream goes, and no further)
    const text = rt.plainText(doc.runs);
    expect(text.startsWith('Short\n')).toBe(true);
    expect(text.length).toBeLessThan(4096);
  });

  it('says the file is damaged when its text lies past the end of the stream', () => {
    expect(() => readDoc(makeDoc([{ text: 'Lost\r' }], [], undefined, { pieceAt: 0x7fffff }))).toThrow(/damaged/);
  });
});
