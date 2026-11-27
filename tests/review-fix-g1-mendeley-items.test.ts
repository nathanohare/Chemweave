// @vitest-environment jsdom
//
// Mendeley Desktop numbers each citation's items afresh (ITEM-1, ITEM-2… in every citation) and
// names the item by its uris. Two citations of two papers were read as one reference, because the
// first item of every citation had the same id.

import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { readDocx } from '../src/io/docx';
import { placeRef, refFromCsl } from '../src/document/live-cites';
import type { Reference } from '../src/document/references';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function wordFile(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>'),
    '_rels/.rels': strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}officeDocument" Target="word/document.xml"/></Relationships>`),
    'word/document.xml': strToU8(`<?xml version="1.0"?><w:document ${W}><w:body>${body}<w:sectPr/></w:body></w:document>`),
  });
}
const field = (instr: string, result: string) =>
  `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve">${esc(instr)}</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>${result}</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`;
const text = (t: string) => `<w:r><w:t xml:space="preserve">${t}</w:t></w:r>`;

// Bibliographic details of two real papers:
// Fulmer, G. R. et al. Organometallics 2010, 29, 2176-2179, doi:10.1021/om100106e.
const FULMER = { type: 'article-journal', title: 'NMR Chemical Shifts of Trace Impurities', 'container-title': 'Organometallics', author: [{ family: 'Fulmer', given: 'Gregory R.' }], issued: { 'date-parts': [[2010]] }, volume: '29', page: '2176-2179', DOI: '10.1021/om100106e' };
// Gottlieb, H. E.; Kotlyar, V.; Nudelman, A. J. Org. Chem. 1997, 62, 7512-7515, doi:10.1021/jo971176v.
const GOTTLIEB = { type: 'article-journal', title: 'NMR Chemical Shifts of Common Laboratory Solvents as Trace Impurities', 'container-title': 'The Journal of Organic Chemistry', author: [{ family: 'Gottlieb', given: 'Hugo E.' }], issued: { 'date-parts': [[1997]] }, volume: '62', page: '7512-7515', DOI: '10.1021/jo971176v' };

/** A Mendeley Desktop citation field of one paper, its item numbered ITEM-1 as Mendeley Desktop does in every citation. */
const mendeley = (uuid: string, data: Record<string, unknown>, cid: string) =>
  ` ADDIN CSL_CITATION ${JSON.stringify({ citationID: cid, properties: { noteIndex: 0 }, citationItems: [{ id: 'ITEM-1', uris: [`http://www.mendeley.com/documents/?uuid=${uuid}`], itemData: { ...data, id: 'ITEM-1' } }], mendeley: { formattedCitation: '1' }, schema: 'x' })} `;

describe('Mendeley Desktop citations', () => {
  it('two citations of two papers (both ITEM-1) are two references', async () => {
    const body = `<w:p>${text('One')}${field(mendeley('aaaa', FULMER, 'MENDELEY_CITATION_1'), '1')}${text(' two')}${field(mendeley('bbbb', GOTTLIEB, 'MENDELEY_CITATION_2'), '2')}</w:p>`;
    const { doc } = await readDocx(wordFile(body));
    expect(doc.references?.map((r) => r.doi).sort()).toEqual(['10.1021/jo971176v', '10.1021/om100106e']);
    const cites = Object.values(doc.objects).filter((o) => o.kind === 'cite') as { refs: string[] }[];
    expect(cites.length).toBe(2);
    expect(cites[0].refs).not.toEqual(cites[1].refs);
  });

  it('the same paper cited twice (by its uris) is one reference', () => {
    const refs: Reference[] = [];
    const item = (uuid: string, data: Record<string, unknown>) => { const r = refFromCsl({ ...data, id: 'ITEM-1' }); r.live = { app: 'mendeley', id: 'ITEM-1', uris: [`http://www.mendeley.com/documents/?uuid=${uuid}`] }; return r; };
    const a = placeRef(refs, item('aaaa', FULMER));
    const b = placeRef(refs, item('bbbb', GOTTLIEB));
    const c = placeRef(refs, item('aaaa', FULMER));
    expect(a).not.toBe(b);
    expect(c).toBe(a);
    expect(refs.length).toBe(2);
  });

  it('Mendeley Desktop items without uris are told apart by their DOI, not their ITEM-n id', () => {
    const refs: Reference[] = [];
    const item = (data: Record<string, unknown>) => { const r = refFromCsl({ ...data, id: 'ITEM-1' }); r.live = { app: 'mendeley', id: 'ITEM-1' }; return r; };
    expect(placeRef(refs, item(FULMER))).not.toBe(placeRef(refs, item(GOTTLIEB)));
    expect(refs.length).toBe(2);
  });
});
