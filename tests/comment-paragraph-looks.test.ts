// @vitest-environment jsdom
//
// A Word comment changed here keeps the formatting of its paragraphs left as they were (G3-17):
// only the paragraphs whose text changed are written plain. The comments part is written by hand
// from the element names of ECMA-376 Part 1, 17.13.4 (w:comment, w:p, w:r, w:rPr), not taken from
// a file Word made.

import { describe, it, expect } from 'vitest';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { readDocx, writeDocx, type DocxDeps } from '../src/io/docx';
import { commentPieces } from '../src/io/docx-write';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const W14 = 'xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const deps: DocxDeps = { async picture() { return null; } };
const u8 = (s: string) => new Uint8Array(strToU8(s));
const rels = (list: [string, string, string][]) => `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.map(([id, type, target]) => `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`).join('')}</Relationships>`;
const CT = '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/></Types>';

/** A comment of three paragraphs: "Use CH2Cl2" (bold, subscripts), "then dry it" and "Rf 0.3" (Rf with a subscript f). */
function wordFile(): Uint8Array {
  const body = '<w:p><w:commentRangeStart w:id="0"/><w:r><w:t>Dissolve in DCM</w:t></w:r><w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r></w:p>';
  const p = (id: string, runs: string, first = false) => `<w:p w14:paraId="${id}" w14:textId="77777777"><w:pPr><w:pStyle w:val="CommentText"/></w:pPr>${first ? '<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:annotationRef/></w:r>' : ''}${runs}</w:p>`;
  const comment = '<w:comment w:id="0" w:author="Nate" w:date="2026-10-14T16:00:00Z" w:initials="N">'
    + p('1A2B3C4D', '<w:r><w:t xml:space="preserve">Use </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>CH</w:t></w:r><w:r><w:rPr><w:b/><w:vertAlign w:val="subscript"/></w:rPr><w:t>2</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>Cl</w:t></w:r><w:r><w:rPr><w:b/><w:vertAlign w:val="subscript"/></w:rPr><w:t>2</w:t></w:r>', true)
    + p('2B3C4D5E', '<w:r><w:t>then dry it</w:t></w:r>')
    + p('3C4D5E6F', '<w:r><w:rPr><w:i/></w:rPr><w:t>R</w:t></w:r><w:r><w:rPr><w:i/><w:vertAlign w:val="subscript"/></w:rPr><w:t>f</w:t></w:r><w:r><w:t xml:space="preserve"> 0.3</w:t></w:r>')
    + '</w:comment>';
  return zipSync({
    '[Content_Types].xml': u8(CT),
    '_rels/.rels': u8(rels([['rId1', `${R}officeDocument`, 'word/document.xml']])),
    'word/_rels/document.xml.rels': u8(rels([['rId4', `${R}comments`, 'comments.xml']])),
    'word/document.xml': u8(`<?xml version="1.0"?><w:document ${W}><w:body>${body}<w:sectPr/></w:body></w:document>`),
    'word/comments.xml': u8(`<?xml version="1.0"?><w:comments ${W} ${W14}>${comment}</w:comments>`),
  });
}

async function changed(text: string): Promise<string> {
  const { doc } = await readDocx(wordFile());
  const id = Number(Object.keys(doc.comments ?? {})[0]);
  doc.comments![id] = { ...doc.comments![id], text };
  return strFromU8(unzipSync(await writeDocx(doc, deps))['word/comments.xml']);
}

describe('a Word comment changed here', () => {
  it('reads each paragraph\'s own text with the paragraphs Word wrote', async () => {
    const { doc } = await readDocx(wordFile());
    const c = Object.values(doc.comments ?? {})[0];
    expect(c.text).toBe('Use CH2Cl2\nthen dry it\nRf 0.3');
    expect(c.word?.texts).toEqual(['Use CH2Cl2', 'then dry it', 'Rf 0.3']);
  });

  it('keeps the looks of the paragraphs left as they were; the one changed is plain', async () => {
    const xml = await changed('Use CH2Cl2\nthen dry it over MgSO4\nRf 0.3');
    // the first and last as Word wrote them
    expect(xml).toContain('<w:r><w:rPr><w:b/><w:vertAlign w:val="subscript"/></w:rPr><w:t>2</w:t></w:r>');
    expect(xml).toContain('<w:r><w:rPr><w:i/><w:vertAlign w:val="subscript"/></w:rPr><w:t>f</w:t></w:r>');
    expect(xml).toContain('then dry it over MgSO4');
    // three paragraphs, the comment mark once, in the first
    expect(xml.match(/<w:p /g)).toHaveLength(3);
    expect(xml.match(/<w:annotationRef\/>/g)).toHaveLength(1);
    // and it reads back as typed
    const { doc } = await readDocx(wordFile());
    const id = Number(Object.keys(doc.comments ?? {})[0]);
    doc.comments![id] = { ...doc.comments![id], text: 'Use CH2Cl2\nthen dry it over MgSO4\nRf 0.3' };
    const again = (await readDocx(await writeDocx(doc, deps))).doc;
    expect(Object.values(again.comments ?? {})[0].text).toBe('Use CH2Cl2\nthen dry it over MgSO4\nRf 0.3');
  });

  it('a first paragraph changed: the mark goes on the plain one, and not again on the kept ones', async () => {
    const xml = await changed('Use toluene\nthen dry it\nRf 0.3');
    expect(xml).not.toContain('<w:b/>');
    expect(xml).toContain('<w:vertAlign w:val="subscript"/></w:rPr><w:t>f</w:t>');
    expect(xml.match(/<w:annotationRef\/>/g)).toHaveLength(1);
    expect(xml.indexOf('<w:annotationRef/>')).toBeLessThan(xml.indexOf('Use toluene'));
  });

  it('matches the paragraphs in order, whole lines only', () => {
    const word = { paras: ['<w:p>a</w:p>', '<w:p>b</w:p>', '<w:p>c</w:p>'], texts: ['A', 'B', 'C'], text: 'A\nB\nC' };
    const c = (text: string) => commentPieces({ author: '', date: '', text, word });
    expect(c('A\nB\nC')).toEqual([0, 1, 2]);
    expect(c('A\nnew\nC')).toEqual([0, { line: 'new' }, 2]);
    expect(c('A\nC')).toEqual([0, 2]);
    expect(c('AB\nC')).toEqual([{ line: 'AB' }, 2]);
    expect(c('C\nA')).toEqual([2, { line: 'A' }]);
    expect(c('')).toEqual([{ line: '' }]);
    // (a file read before each paragraph's text was kept: plain, as before)
    expect(commentPieces({ author: '', date: '', text: 'A\nB', word: { paras: word.paras, text: 'A\nB\nC' } })).toEqual([{ line: 'A' }, { line: 'B' }]);
  });
});
