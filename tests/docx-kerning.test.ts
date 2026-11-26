// @vitest-environment jsdom
//
// Word's kerning size (w:kern: letters kerned at this size and larger) is kept on the text when the
// file is saved here, while the text is still kerned, or not, as that size says.

import { describe, it, expect } from 'vitest';
import { kernOf } from './xml-text';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { readDocx, writeDocx, type DocxDeps } from '../src/io/docx';
import type { DocText } from '../src/document/document';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const deps: DocxDeps = { async picture() { return { png: PNG, w: 10, h: 10 }; }, async svgToPng() { return PNG; } };

/** 11 pt text kerned from 14 pt (so not kerned), 16 pt text kerned from 14 pt (kerned), and 11 pt text kerned from Word's usual 1 pt. */
function docx(): Uint8Array {
  const run = (rPr: string, t: string) => `<w:r><w:rPr>${rPr}</w:rPr><w:t>${t}</w:t></w:r>`;
  const body = `<w:p>${run('<w:kern w:val="28"/><w:sz w:val="22"/>', 'small')}${run('<w:kern w:val="28"/><w:sz w:val="32"/>', 'large')}${run('<w:kern w:val="2"/><w:sz w:val="22"/>', 'usual')}</w:p>`;
  return zipSync({
    '[Content_Types].xml': new Uint8Array(strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>')),
    '_rels/.rels': new Uint8Array(strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}officeDocument" Target="word/document.xml"/></Relationships>`)),
    'word/document.xml': new Uint8Array(strToU8(`<?xml version="1.0"?><w:document ${W}><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body></w:document>`)),
  });
}


describe("Word's kerning size", () => {
  it('is kept on the text, kerned or not', async () => {
    const t = (await readDocx(docx())).doc as DocText;
    const run = (s: string) => t.runs.find((r) => r.text === s)!;
    expect(run('small')).toMatchObject({ kernAt: 14, noKern: true });
    expect(run('large').kernAt).toBe(14);
    expect(run('large').noKern).toBeUndefined();
    expect(run('usual').kernAt).toBeUndefined();
    const doc = strFromU8(unzipSync(await writeDocx(t, deps))['word/document.xml']);
    expect(kernOf(doc, 'small')).toBe('28');
    expect(kernOf(doc, 'large')).toBe('28');
    // (the usual size: from the document's defaults, as written here)
    expect(kernOf(doc, 'usual')).toBeUndefined();
  });

  it('gives way to kerning set here, and to a new size', async () => {
    const t = (await readDocx(docx())).doc as DocText;
    const runs = t.runs.map((r) => r.text === 'small' ? { ...r, noKern: undefined } : r.text === 'large' ? { ...r, size: 12 } : r);
    const doc = strFromU8(unzipSync(await writeDocx({ ...t, runs }, deps))['word/document.xml']);
    // kerning turned on here: Word's usual size (from the defaults), so the text is kerned
    expect(kernOf(doc, 'small')).toBeUndefined();
    // made smaller than its kerning size while still kerned here: Word's usual size too
    expect(kernOf(doc, 'large')).toBeUndefined();
    // kerning taken off here, or made bigger with it kept off: none
    const off = t.runs.map((r) => r.text === 'large' ? { ...r, noKern: true } : r.text === 'small' ? { ...r, size: 16 } : r);
    const doc2 = strFromU8(unzipSync(await writeDocx({ ...t, runs: off }, deps))['word/document.xml']);
    expect(kernOf(doc2, 'large')).toBe('0');
    expect(kernOf(doc2, 'small')).toBe('0');
    // (and a size past Word's own is not written)
    const huge = t.runs.map((r) => r.text === 'small' ? { ...r, kernAt: 1e300 } : r);
    expect(kernOf(strFromU8(unzipSync(await writeDocx({ ...t, runs: huge }, deps))['word/document.xml']), 'small')).toBe('0');
  });

  it("is kept from a paragraph style's kerning (Word's Heading 1), the same on a second save", async () => {
    const styles = `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>` +
      `<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:rPr><w:kern w:val="32"/><w:sz w:val="32"/></w:rPr></w:style>`;
    const files = unzipSync(docx());
    files['word/styles.xml'] = new Uint8Array(strToU8(`<?xml version="1.0"?><w:styles ${W}>${styles}</w:styles>`));
    files['word/_rels/document.xml.rels'] = new Uint8Array(strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdS" Type="${R}styles" Target="styles.xml"/></Relationships>`));
    files['word/document.xml'] = new Uint8Array(strToU8(`<?xml version="1.0"?><w:document ${W}><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Head</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body></w:document>`));
    const once = await writeDocx((await readDocx(zipSync(files))).doc, deps);
    const first = strFromU8(unzipSync(once)['word/document.xml']);
    expect(kernOf(first, 'Head')).toBe('32');
    const twice = strFromU8(unzipSync(await writeDocx((await readDocx(once)).doc, deps))['word/document.xml']);
    expect(twice).toBe(first);
  });
});
