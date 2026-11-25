// @vitest-environment jsdom
//
// The paragraph mark's own formatting (w:pPr/w:rPr: how Word shows the ¶, and what text typed at
// the paragraph's end looks like) is kept when the file is saved, and not written where it is the
// paragraph's own.

import { describe, it, expect } from 'vitest';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { readDocx, writeDocx, type DocxDeps } from '../src/io/docx';
import { newDocument, type DocText } from '../src/document/document';
import type { TextRun } from '../src/model';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const deps: DocxDeps = { async picture() { return { png: PNG, w: 10, h: 10 }; }, async svgToPng() { return PNG; } };

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': new Uint8Array(strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>')),
    '_rels/.rels': new Uint8Array(strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}officeDocument" Target="word/document.xml"/></Relationships>`)),
    'word/document.xml': new Uint8Array(strToU8(`<?xml version="1.0"?><w:document ${W}><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body></w:document>`)),
  });
}

/** Each paragraph's mark formatting (its w:pPr/w:rPr's content), in order. */
const marks = (x: string) => [...x.matchAll(/<w:p>(?:<w:pPr>((?:(?!<\/w:pPr>).)*)<\/w:pPr>)?/g)].map((m) => /<w:rPr>(.*?)<\/w:rPr>/.exec(m[1] ?? '')?.[1] ?? '');

describe('the paragraph mark', () => {
  it("keeps its own formatting, and none is written where it has none", async () => {
    const body = '<w:p><w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:pPr><w:r><w:t>bold mark</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>plain mark</w:t></w:r></w:p>' +
      '<w:p><w:pPr><w:rPr><w:i/></w:rPr></w:pPr><w:r><w:rPr><w:i/></w:rPr><w:t>italic, mark too</w:t></w:r></w:p>' +
      // (the last paragraph's mark has no line break to keep its look on: see the change's known limits)
      '<w:p><w:r><w:t>last</w:t></w:r></w:p>';
    const saved = await writeDocx((await readDocx(docx(body))).doc, deps);
    const x = strFromU8(unzipSync(saved)['word/document.xml']);
    const [bold, plain, italic] = marks(x.slice(x.indexOf('<w:body>')));
    expect(bold).toContain('<w:b/>');
    expect(bold).toContain('<w:sz w:val="28"/>');
    // (a mark with none of its own: the paragraph style's look as read, here Word's 10 pt with no
    // styles part, against the 11 pt Normal written; no kerning of its own)
    expect(plain).toBe('<w:sz w:val="20"/><w:szCs w:val="20"/>');
    expect(italic).toContain('<w:i/>');
    // the same on a second save
    const again = strFromU8(unzipSync(await writeDocx((await readDocx(saved)).doc, deps))['word/document.xml']);
    expect(again).toBe(x);
  });

  it("of an empty paragraph keeps its look; a file with Word's defaults gains none", async () => {
    const styles = `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>`;
    const files = unzipSync(docx('<w:p><w:r><w:t>one</w:t></w:r></w:p><w:p><w:pPr><w:rPr><w:b/></w:rPr></w:pPr></w:p><w:p><w:r><w:t>two</w:t></w:r></w:p><w:p><w:r><w:t>last</w:t></w:r></w:p>'));
    files['word/styles.xml'] = new Uint8Array(strToU8(`<?xml version="1.0"?><w:styles ${W}>${styles}</w:styles>`));
    files['word/_rels/document.xml.rels'] = new Uint8Array(strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdS" Type="${R}styles" Target="styles.xml"/></Relationships>`));
    const x = strFromU8(unzipSync(await writeDocx((await readDocx(zipSync(files))).doc, deps))['word/document.xml']);
    const [one, empty, two] = marks(x.slice(x.indexOf('<w:body>')));
    expect(one).toBe('');
    expect(empty).toContain('<w:b/>');
    expect(two).toBe('');
  });

  it('is the same on a second save: a bold list item, a character style over a whole paragraph', async () => {
    const d = newDocument();
    const runs: TextRun[] = [{ ...d.runs[0], bold: true, color: '#ff0000', text: 'item\n' }, { ...d.runs[0], italic: true, cstyle: 'Emphasis', text: 'styled\n' }, { ...d.runs[0], text: 'end' }];
    const t: DocText = { ...d, runs, paras: [{ ...d.paras[0], list: 'number' }, d.paras[0], d.paras[0]] };
    const once = await writeDocx(t, deps);
    const first = strFromU8(unzipSync(once)['word/document.xml']);
    // (a list item's mark: none of its look, which Word would give its number)
    expect(marks(first.slice(first.indexOf('<w:body>')))[0]).not.toContain('<w:color');
    const back = (await readDocx(once)).doc as DocText;
    expect(back.paras[0].numLook).toBeUndefined();
    const twice = strFromU8(unzipSync(await writeDocx(back, deps))['word/document.xml']);
    expect(twice).toBe(first);
  });
});
