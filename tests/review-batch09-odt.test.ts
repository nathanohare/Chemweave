// @vitest-environment jsdom
//
// Code review 2026-11-26, batch 09: OpenDocument text (F121, F122, F123, F580, F581, F582).
// Elements as the OpenDocument 1.3 standard (OASIS, part 3) defines them: <table:covered-table-cell>
// for the places a merged cell covers (9.1.5), nested <text:list> inside a <text:list-item> for a
// deeper list level (5.3), <text:line-break> (6.1.5), and table column widths on a table-column
// style's <style:table-column-properties style:column-width> (17.16).

import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8, strToU8 } from 'fflate';
import { newDocument, type DocText } from '../src/document/document';
import { readOdt, writeOdt, zipFiles } from '../src/io/odt';
import * as rt from '../src/richtext';
import { listMarkers } from '../src/text/paragraphs';
import type { ParaStyle, TextRun } from '../src/model';

const NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"';

function odt(auto: string, body: string): Uint8Array {
  const content = `<?xml version="1.0" encoding="UTF-8"?><office:document-content ${NS}><office:automatic-styles>${auto}</office:automatic-styles><office:body><office:text>${body}</office:text></office:body></office:document-content>`;
  return zipFiles([['mimetype', strToU8('application/vnd.oasis.opendocument.text'), false], ['content.xml', strToU8(content), true]]);
}

const doc = (runs: TextRun[], paras: ParaStyle[], objects: DocText['objects'] = {}): DocText => ({ ...newDocument(), runs, paras, objects });
const contentOf = async (t: DocText) => strFromU8(unzipSync(await writeOdt(t))['content.xml']);

describe('ODT tables (F121, F122, F581)', () => {
  it('reads column widths from the column styles, however their attributes are written', () => {
    // single quotes around the values (XML 1.0, 3.1 AttValue allows either; the old text pattern wanted double)
    const auto = "<style:style style:family='table-column' style:name='Tc.A'><style:table-column-properties style:column-width='2in'/></style:style>";
    const body = '<table:table><table:table-column table:style-name="Tc.A"/><table:table-row><table:table-cell><text:p>x</text:p></table:table-cell></table:table-row></table:table>';
    const tb = Object.values(readOdt(odt(auto, body)).doc.objects).find((o) => o.kind === 'table');
    // 2 in = 144 pt (72 pt to the inch)
    expect(tb?.kind === 'table' && tb.table.cols).toEqual([144]);
  });

  it('writes the places under a merged cell as covered cells', async () => {
    const t = doc([{ obj: 1, text: '￼' }], [{}], {
      1: { kind: 'table', table: { cols: [50, 50, 50], head: 0, lines: 'grid', rows: [
        [{ runs: [{ text: 'AB' }], span: 2 }, { runs: [{ text: '' }] }, { runs: [{ text: 'C' }] }],
        [{ runs: [{ text: 'D' }], rowSpan: 2 }, { runs: [{ text: 'E' }] }, { runs: [{ text: 'F' }] }],
        [{ runs: [{ text: '' }] }, { runs: [{ text: 'G' }] }, { runs: [{ text: 'H' }] }],
      ] } },
    });
    const content = await contentOf(t);
    const rows = content.split('<table:table-row>').slice(1).map((r) => r.slice(0, r.indexOf('</table:table-row>')));
    const cells = (r: string) => [...r.matchAll(/<table:(covered-table-cell|table-cell)\b/g)].map((m) => m[1]);
    expect(cells(rows[0])).toEqual(['table-cell', 'covered-table-cell', 'table-cell']);
    expect(cells(rows[1])).toEqual(['table-cell', 'table-cell', 'table-cell']);
    expect(cells(rows[2])).toEqual(['covered-table-cell', 'table-cell', 'table-cell']);
    const back = Object.values(readOdt(await writeOdt(t)).doc.objects).find((o) => o.kind === 'table');
    expect(back?.kind === 'table' && back.table.rows.map((r) => r.map((c) => rt.plainText(c.runs)))).toEqual([['AB', '', 'C'], ['D', 'E', 'F'], ['', 'G', 'H']]);
  });

  it('keeps an empty first paragraph in a cell, so the next one keeps its own style', () => {
    const auto = '<style:style style:name="P1" style:family="paragraph"><style:paragraph-properties fo:text-align="center"/></style:style>';
    const body = '<table:table><table:table-column/><table:table-row><table:table-cell><text:p/><text:p text:style-name="P1">mid</text:p></table:table-cell></table:table-row></table:table>';
    const tb = Object.values(readOdt(odt(auto, body)).doc.objects).find((o) => o.kind === 'table');
    if (tb?.kind !== 'table') throw new Error('no table');
    const cell = tb.table.rows[0][0];
    expect(rt.plainText(cell.runs)).toBe('\nmid');
    expect(cell.paras?.[1].align).toBe('center');
    expect(cell.paras?.[0].align).toBeUndefined();
  });
});

describe('ODT lists (F123)', () => {
  it('saves a deeper list level as a list inside the item above, and reads it back', async () => {
    const t = doc([{ text: 'one\nsub\ntwo' }], [{ list: 'bullet' }, { list: 'bullet', level: 1 }, { list: 'bullet' }]);
    const content = await contentOf(t);
    const body = content.slice(content.indexOf('<office:text>'));
    expect(body).toMatch(/<text:list-item><text:p[^>]*>one<\/text:p><text:list[^>]*><text:list-item><text:p[^>]*>sub<\/text:p><\/text:list-item><\/text:list><\/text:list-item><text:list-item><text:p[^>]*>two/);
    const back = readOdt(await writeOdt(t)).doc;
    expect(back.paras.map((p) => [p.list, p.level ?? 0])).toEqual([['bullet', 0], ['bullet', 1], ['bullet', 0]]);
  });
});

describe('ODT line breaks (F582)', () => {
  it('keeps a list item\'s next line (text:line-break) in the item, with no bullet of its own', () => {
    const body = '<text:list><text:list-item><text:p>One<text:line-break/>more</text:p></text:list-item><text:list-item><text:p>Two</text:p></text:list-item></text:list>';
    const { doc: d } = readOdt(odt('', body));
    expect(rt.plainText(d.runs)).toBe('One\nmore\nTwo');
    expect(d.paras[1]).toMatchObject({ list: 'bullet', soft: true, cont: true });
    expect(listMarkers(d.paras).map((m) => m !== null)).toEqual([true, false, true]);
  });

  it('saves a line that goes on in a list item inside that item, and reads it back so', async () => {
    const t = doc([{ text: 'one\nmore\ntwo' }], [{ list: 'number' }, { list: 'number', cont: true }, { list: 'number' }]);
    const content = await contentOf(t);
    const body = content.slice(content.indexOf('<office:text>'));
    // two items: the second paragraph in the first item (OpenDocument 1.3 part 3, 5.3.3)
    expect(body.match(/<text:list-item>/g)).toHaveLength(2);
    expect(body).toMatch(/<text:list-item><text:p[^>]*>one<\/text:p><text:p[^>]*>more<\/text:p><\/text:list-item>/);
    const back = readOdt(await writeOdt(t)).doc;
    expect(back.paras.map((p) => [p.list, !!p.cont])).toEqual([['number', false], ['number', true], ['number', false]]);
    expect(listMarkers(back.paras)).toEqual(['1.', null, '2.']);
  });

  it('opens a text:line-break as the paragraph\'s next line', () => {
    const auto = '<style:style style:name="P1" style:family="paragraph"><style:paragraph-properties fo:text-align="center"/></style:style>';
    const { doc: d } = readOdt(odt(auto, '<text:p text:style-name="P1">Line one<text:line-break/>Line two</text:p>'));
    expect(rt.plainText(d.runs)).toBe('Line one\nLine two');
    expect(d.paras[0]).toMatchObject({ align: 'center' });
    expect(d.paras[0].soft).toBeUndefined();
    expect(d.paras[1]).toMatchObject({ align: 'center', soft: true });
  });

  it('keeps a line break inside a table cell', () => {
    const body = '<table:table><table:table-column/><table:table-row><table:table-cell><text:p>a<text:line-break/>b</text:p></table:table-cell></table:table-row></table:table>';
    const tb = Object.values(readOdt(odt('', body)).doc.objects).find((o) => o.kind === 'table');
    if (tb?.kind !== 'table') throw new Error('no table');
    expect(rt.plainText(tb.table.rows[0][0].runs)).toBe('a\nb');
    expect(tb.table.rows[0][0].paras?.[1].soft).toBe(true);
  });
});
