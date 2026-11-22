// @vitest-environment jsdom
//
// Headers and footers typed into on the page, as in Word: double-click the header, type, and
// the text goes into the section's header (plain text stays plain text, so the Page Number
// settings still work), as one step of Undo; left as it was, nothing changes at all.

import { describe, it, expect } from 'vitest';
import { DocFile } from '../src/document/doc-file';
import { newDocument, paraFromStyle, runStyleOf, type DocText } from '../src/document/document';
import { bodyAsZones, zonesAsBody } from '../src/document/hf-bodies';
import { changeSection, newBreak, sectionsOf } from '../src/document/sections';
import { offsetAt } from '../src/text/layout';
import * as rt from '../src/richtext';

/** A document of `n` pages, a page break before each paragraph after the first. */
function pages(n: number, hf: Partial<DocText['hf']> = {}): DocText {
  const d = newDocument();
  const s = d.styles.Normal;
  const runs = [{ ...runStyleOf(s), text: Array.from({ length: n }, (_, i) => `page ${i + 1}`).join('\n') }];
  const paras = Array.from({ length: n }, (_, i) => ({ ...paraFromStyle(s, {}), ...(i > 0 ? { pageBreak: true } : {}) }));
  return { ...d, runs, paras, hf: { ...d.hf, ...hf } };
}

const typeIn = (f: DocFile, text: string) => { for (const ch of text) f.textEd.type(ch); };

describe('typing into a header on the page', () => {
  it('puts what is typed into the plain header, kept plain', () => {
    const f = new DocFile(pages(2, { header: ['Left', '', 'Right'], numbers: 'footer-center', prefix: 'S' }));
    const ed = f.editHf(1, 'header')!;
    expect(ed).not.toBeNull();
    // the caret at the end: after "Right"
    expect(ed.text).toBe('Left\t\tRight');
    typeIn(f, ' text');
    // shown on every page while typing
    const lay = f.layout();
    expect(lay.hfs.filter((h) => h.kind === 'header').map((h) => h.page)).toEqual([0, 1]);
    f.endBox();
    expect(f.t.hf.header).toEqual(['Left', '', 'Right text']);
    expect(f.t.hf.bodies).toBeUndefined();
    expect(f.t.hf.numbers).toBe('footer-center');
    // one step of Undo
    f.ed.undo();
    expect(f.t.hf.header).toEqual(['Left', '', 'Right']);
  });

  it('keeps the page number in the footer, and moves it when it is moved', () => {
    const f = new DocFile(pages(2, { footer: ['', '', ''], numbers: 'footer-center', prefix: 'S' }));
    const ed = f.editHf(0, 'footer')!;
    // tab, "S", PAGE field, tab: the number in the middle
    expect(ed.text).toBe('\tS￼\t');
    // cut the number and its prefix and put them at the right
    ed.select(1, 3);
    const runs = rt.sliceRuns(ed.t.runs, 1, 3);
    ed.replaceSelection([]);
    ed.setCaret(ed.text.length);
    ed.replaceSelection(runs);
    f.endBox();
    expect(f.t.hf.numbers).toBe('footer-right');
    expect(f.t.hf.footer).toEqual(['', '', '']);
    expect(f.t.hf.bodies).toBeUndefined();
  });

  it('leaves the document as it was when nothing is typed', () => {
    const t = pages(2, { header: ['A', '', ''] });
    const f = new DocFile(t);
    f.editHf(0, 'header');
    f.endBox();
    expect(f.t.hf).toEqual(t.hf);
    expect(f.ed.canUndo).toBe(false);
    // typed, then all of it undone in the header: the same
    f.editHf(0, 'header');
    typeIn(f, 'xy');
    f.textEd.undo();
    f.endBox();
    expect(f.t.hf).toEqual(t.hf);
    expect(f.ed.canUndo).toBe(false);
  });

  it('keeps formatted text as Word\'s paragraphs', () => {
    const f = new DocFile(pages(1, { header: ['Title', '', ''] }));
    const ed = f.editHf(0, 'header')!;
    ed.select(0, 5);
    ed.setStyle({ bold: true });
    f.endBox();
    expect(f.t.hf.bodies?.header).toBeDefined();
    expect(f.t.hf.bodies!.header!.runs.some((r) => r.bold && r.text === 'Title')).toBe(true);
  });

  it('types into the first page\'s own header on the first page', () => {
    const f = new DocFile(pages(2, { firstPage: true, first: { header: ['Cover', '', ''], footer: ['', '', ''] }, header: ['Run', '', ''] }));
    expect(f.editHf(0, 'header')!.text).toBe('Cover\t\t');
    typeIn(f, '!');
    f.endBox();
    expect(f.t.hf.first?.header).toEqual(['Cover', '', '!']);
    expect(f.t.hf.header).toEqual(['Run', '', '']);
  });

  it('types into the section a linked section shows', () => {
    let t = pages(3, { header: ['One', '', ''] });
    // a second section from the third paragraph, linked to the first
    const paras = [...t.paras];
    paras[2] = { ...paras[2], pageBreak: undefined, section: newBreak(sectionsOf(t)[0], 'nextPage') };
    t = { ...t, paras };
    const f = new DocFile(t);
    expect(sectionsOf(f.t)[1].linked).toBe(true);
    const page = f.layout().pages.findIndex((p) => p.section === 1);
    f.editHf(page, 'header');
    typeIn(f, ' more');
    f.endBox();
    expect(f.t.hf.header).toEqual(['One', '', ' more']);
    expect(sectionsOf(f.t)[1].linked).toBe(true);
  });

  it('puts the caret where the header is drawn', () => {
    const f = new DocFile(pages(1, { header: ['Left', '', 'Right'] }));
    const ed = f.editHf(0, 'header')!;
    const lay = ed.layout();
    const pg = f.layout().pages[0];
    // a click on the left of the header's line is before "Left"
    const l = lay.lines[0];
    expect(l.y).toBeGreaterThan(pg.top + pg.setup.header);
    expect(l.y).toBeLessThan(pg.top + pg.setup.top);
    expect(offsetAt(lay, pg.setup.left + 1, l.y)).toBe(0);
  });
});

describe('plain headers as paragraphs and back', () => {
  it('goes there and back unchanged', () => {
    const t = pages(1, { header: ['A', 'B', 'C'], numbers: 'header-right', prefix: 'p. ' });
    const objects = { ...t.objects };
    let next = 1;
    const body = zonesAsBody(t, t.hf, 'header', 468, () => { const id = next++; objects[id] = { kind: 'field', code: 'page' }; return id; });
    expect(rt.plainText(body.runs)).toBe('A\tB\tC p. ￼');
    expect(bodyAsZones(body, { ...t, objects }, t.hf, 'header', 468)).toEqual(t.hf);
  });

  it('stays paragraphs with a second line, or a second page number', () => {
    const t = pages(1, { header: ['A', '', ''], numbers: 'footer-center' });
    const look = { font: 'Times New Roman', size: 10 };
    const base = zonesAsBody(t, t.hf, 'header', 468, () => 0);
    expect(bodyAsZones({ ...base, runs: [{ ...look, text: 'A\nB' }] }, t, t.hf, 'header', 468)).toBeNull();
    // a page number in the header while the footer has one
    const objects = { 7: { kind: 'field' as const, code: 'page' as const } };
    expect(bodyAsZones({ ...base, runs: [{ ...look, text: 'A' }, { ...look, obj: 7, text: '￼' }] }, { ...t, objects }, t.hf, 'header', 468)).toBeNull();
    // (changeSection keeps a plain header plain)
    expect(changeSection(t, 0, { hf: t.hf }).hf.bodies).toBeUndefined();
  });
});
