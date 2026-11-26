// Project Settings kept as SI Assistant keeps them, with Chemweave's own choices beside them:
// heading formats, the page header and footer, and the drawing style.
import { describe, expect, it } from 'vitest';
import { headingFormat, headingNumber, presetOf, storeHeadingFormat, headingExample } from '../src/si/heading-format';
import { headerFooter, pageOf, pageSettings, storePageSettings } from '../src/si/page-setup';
import { defaultPage } from '../src/document/document';
import { siDefaultStyle, siDrawingStyle, storeSiDrawingStyle } from '../src/si/drawing-style';
import { ACS_1996 } from '../src/style';
import type { Json } from '../src/si/project';

describe('heading formats', () => {
  it('follows the journal style unless chosen', () => {
    expect(headingFormat({ journal_style: 'ACS' })).toBeNull();
    expect(headingNumber(headingFormat({ journal_style: 'Wiley' })!, [1, 2])).toBe('1.2. ');
    expect(headingNumber(headingFormat({ journal_style: 'RSC' })!, [1, 2])).toBe('1.2 ');
    expect(headingFormat({ journal_style: 'Wiley' })!.text).toBe(false);
  });

  it('keeps SI Assistant’s own choices as it does, and Chemweave’s in its own key', () => {
    const s: Json = { journal_style: 'ACS' };
    storeHeadingFormat(s, 'outline');
    expect(s).toEqual({ journal_style: 'ACS', heading_numbers: 'outline' });
    expect(headingNumber(headingFormat(s)!, [1, 2])).toBe('B. ');
    storeHeadingFormat(s, 'classic');
    expect(s.heading_numbers).toBe('outline');
    expect(presetOf(s)).toBe('classic');
    expect(headingNumber(headingFormat(s)!, [4])).toBe('IV. ');
    expect(headingNumber(headingFormat(s)!, [1, 1, 3])).toBe('3. ');
    storeHeadingFormat(s, 'custom', { levels: ['A', '1'], chain: true, end: ')', text: false });
    expect(presetOf(s)).toBe('custom');
    expect(s.heading_numbers).toBe('decimal');
    expect(headingNumber(headingFormat(s)!, [2, 3, 4])).toBe('B.3.4) ');
    storeHeadingFormat(s, 'none');
    expect(s.heading_format).toBeUndefined();
    expect(headingFormat(s)).toBeNull();
    storeHeadingFormat(s, 'style');
    expect(s).toEqual({ journal_style: 'ACS' });
    expect(headingExample(headingFormat({ heading_numbers: 'decimal' }))).toBe('1. Synthesis · 1.1. Ketones · 1.1.2. Reduction');
  });
});

describe('page header and footer', () => {
  it('reads SI Assistant’s settings, the footer following the journal style unless stored', () => {
    expect(pageSettings({ journal_style: 'Wiley' }).footer).toEqual(['', '', '{page}']);
    const s: Json = { journal_style: 'ACS' };
    storePageSettings(s, { header: ['{title}', '', '{date}'], footer: ['', '{page}', ''], number_prefix: 'S', number_style: 'i', number_size: 0, number_bold: true, number_on_cover: false });
    expect((s.page as Json).footer).toBeUndefined();
    expect((s.page as Json).header).toEqual({ left: '{title}', center: '', right: '{date}' });
    expect(pageSettings(s).number_style).toBe('i');
  });

  it('writes {page} and {pages} as fields, with the prefix and the number’s look, and no header on the cover', () => {
    const s: Json = { journal_style: 'ACS', page: { header: { left: '{authors}', center: '', right: '' }, footer: { left: '', center: '{page} of {pages}', right: '' }, number_prefix: 'S', number_style: 'I', number_bold: true } };
    const fields: string[] = [];
    const { hf, format } = headerFooter(s, { title: 'T', authors: 'A. Chemist' }, (code) => { fields.push(code); return fields.length; }, 468);
    expect(format).toBe('upperRoman');
    expect(fields).toEqual(['page', 'numpages']);
    const foot = hf.bodies!.footer!.runs;
    expect(foot.map((r) => r.text).join('')).toBe('\tS￼ of S￼\t');
    expect(foot.filter((r) => r.obj !== undefined).every((r) => r.bold)).toBe(true);
    expect(hf.bodies!.header!.runs[0].text).toBe('A. Chemist');
    expect(hf.firstPage).toBe(true);
    expect(hf.numbers).toBe('none');
    // with no cover printed, the first page has them
    expect(headerFooter(s, { title: '', authors: '' }, () => 1, 468, true).hf.firstPage).toBeUndefined();
  });
});

describe('the drawing style', () => {
  it('starts as SI Assistant draws: ACS 1996 with its Structures settings', () => {
    expect(siDrawingStyle({})).toEqual(ACS_1996);
    const st = siDefaultStyle({ structure_drawing: { bond_length_cm: 0.6, line_width_pt: 0.8, font: 'Roboto (built in)', font_size_pt: 9 } });
    expect(st.bondLength).toBeCloseTo(17.01, 2);
    expect(st.lineWidth).toBe(0.8);
    expect(st.labelFont).toBe('Arial');
    expect(st.labelSize).toBe(9);
  });

  it('keeps a style of Chemweave’s, and its sizes for SI Assistant', () => {
    const s: Json = {};
    storeSiDrawingStyle(s, { ...ACS_1996 });
    expect(s.structure_drawing).toBeUndefined();
    storeSiDrawingStyle(s, { ...ACS_1996, name: 'Mine', bondLength: 18, labelFont: 'Helvetica', arrowWidth: 1 });
    expect(siDrawingStyle(s)).toMatchObject({ name: 'Mine', bondLength: 18, labelFont: 'Helvetica', arrowWidth: 1 });
    expect(s.structure_drawing).toEqual({ bond_length_cm: 0.635, line_width_pt: 0.6, font_size_pt: 10, font: 'Helvetica' });
    // a hand-edited value of the wrong kind is left at the default
    (s.drawing_style as Json).bondLength = 'big';
    expect(siDrawingStyle(s).bondLength).toBeCloseTo(18, 1);
  });
});

describe('paper and margins', () => {
  it('default to Letter with 1 inch margins, and nothing is stored for them', () => {
    const s: Json = {};
    const v = pageSettings(s);
    expect(v.paper).toBe('letter');
    expect(v.margins).toEqual({ top: 1, bottom: 1, left: 1, right: 1 });
    storePageSettings(s, { ...v });
    expect((s.page as Json).paper).toBeUndefined();
    expect((s.page as Json).margins).toBeUndefined();
  });

  it('A4 and other margins are kept and make the page (A4 is 210 × 297 mm: 595.3 × 841.9 pt)', () => {
    const s: Json = {};
    storePageSettings(s, { ...pageSettings(s), paper: 'a4', margins: { top: 1, bottom: 1, left: 0.75, right: 0.75 } });
    // storing the header again keeps them
    storePageSettings(s, { ...pageSettings(s), header: ['x', '', ''] });
    const page = pageOf(s, defaultPage());
    expect(page.w).toBeCloseTo(595.3, 1);
    expect(page.h).toBeCloseTo(841.9, 1);
    expect(page.left).toBe(54);
    expect(page.top).toBe(72);
  });

  it('a margin out of range reads as 1 inch', () => {
    expect(pageSettings({ page: { margins: { top: 9, left: 0.1, right: 'x' } } }).margins).toEqual({ top: 1, bottom: 1, left: 1, right: 1 });
  });
});
