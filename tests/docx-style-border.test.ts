// @vitest-environment jsdom
//
// A paragraph style's lines and shading (w:pBdr and w:shd in the style) stay in the style when the
// file is saved; its paragraphs don't repeat them, and one that has them taken away says so.

import { describe, it, expect } from 'vitest';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { readDocx, writeDocx, type DocxDeps } from '../src/io/docx';
import { modifyStyle, newParaStyle, paraFromStyle, setParaStyle, type DocText } from '../src/document/document';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const deps: DocxDeps = { async picture() { return { png: PNG, w: 10, h: 10 }; }, async svgToPng() { return PNG; } };

const BOX = `<w:pBdr><w:top w:val="single" w:sz="4" w:space="1" w:color="C8553D"/><w:bottom w:val="single" w:sz="4" w:space="1" w:color="C8553D"/></w:pBdr><w:shd w:val="clear" w:color="auto" w:fill="EEF2E6"/>`;
const STYLES = `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>` +
  `<w:style w:type="paragraph" w:customStyle="1" w:styleId="Boxed"><w:name w:val="Boxed"/><w:basedOn w:val="Normal"/><w:pPr>${BOX}</w:pPr></w:style>`;

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': new Uint8Array(strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>')),
    '_rels/.rels': new Uint8Array(strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}officeDocument" Target="word/document.xml"/></Relationships>`)),
    'word/_rels/document.xml.rels': new Uint8Array(strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdS" Type="${R}styles" Target="styles.xml"/></Relationships>`)),
    'word/styles.xml': new Uint8Array(strToU8(`<?xml version="1.0"?><w:styles ${W}>${STYLES}</w:styles>`)),
    'word/document.xml': new Uint8Array(strToU8(`<?xml version="1.0"?><w:document ${W}><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body></w:document>`)),
  });
}

/** Each paragraph's w:pPr in the saved body, in order. */
const pPrs = (x: string) => [...x.slice(x.indexOf('<w:body>')).matchAll(/<w:p>(?:<w:pPr>((?:(?!<\/w:pPr>).)*)<\/w:pPr>)?/g)].map((m) => m[1] ?? '');

describe("a paragraph style's lines and shading", () => {
  it('stay in the style; its paragraphs repeat them only where they differ', async () => {
    const body = `<w:p><w:pPr><w:pStyle w:val="Boxed"/></w:pPr><w:r><w:t>boxed</w:t></w:r></w:p>` +
      `<w:p><w:pPr><w:pStyle w:val="Boxed"/><w:pBdr><w:top w:val="nil"/><w:bottom w:val="nil"/></w:pBdr><w:shd w:val="clear" w:color="auto" w:fill="auto"/></w:pPr><w:r><w:t>unboxed</w:t></w:r></w:p>` +
      `<w:p><w:pPr><w:pStyle w:val="Boxed"/><w:shd w:val="clear" w:color="auto" w:fill="FFFF00"/></w:pPr><w:r><w:t>yellow</w:t></w:r></w:p><w:p/>`;
    const t = (await readDocx(docx(body))).doc as DocText;
    const boxed = Object.values(t.styles).find((s) => s.name === 'Boxed')!;
    expect(boxed.border?.top).toMatchObject({ style: 'single', color: '#c8553d' });
    expect(boxed.shade).toBe('#eef2e6');
    // (each paragraph as it shows)
    expect(t.paras[0].border?.top).toBeTruthy();
    expect(t.paras[1].border).toBeUndefined();
    expect(t.paras[2].shade).toBe('#ffff00');
    const once = await writeDocx(t, deps);
    const files = unzipSync(once);
    const style = /<w:style [^>]*w:styleId="Boxed">.*?<\/w:style>/.exec(strFromU8(files['word/styles.xml']))?.[0] ?? '';
    expect(style).toMatch(/<w:pBdr><w:top w:val="single"[^>]*w:color="C8553D"\/><w:bottom /);
    expect(style).toContain('w:fill="EEF2E6"');
    const x = strFromU8(files['word/document.xml']);
    const [p0, p1, p2] = pPrs(x);
    expect(p0).not.toContain('<w:pBdr>');
    expect(p0).not.toContain('<w:shd');
    expect(p1).toContain('<w:pBdr><w:top w:val="nil"/><w:bottom w:val="nil"/></w:pBdr>');
    expect(p1).toContain('w:fill="auto"');
    expect(p2).not.toContain('<w:pBdr>');
    expect(p2).toContain('w:fill="FFFF00"');
    // read back the same, and the same on a second save
    const back = (await readDocx(once)).doc as DocText;
    expect(back.paras.slice(0, 3).map((p) => [!!p.border, p.shade])).toEqual([[true, '#eef2e6'], [false, undefined], [true, '#ffff00']]);
    expect(strFromU8(unzipSync(await writeDocx(back, deps))['word/document.xml'])).toBe(x);
  });

  it("are taken away in Word too by a style that hasn't Normal's; the same on a second save", async () => {
    const styles = `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr>${BOX}</w:pPr></w:style>` +
      `<w:style w:type="paragraph" w:customStyle="1" w:styleId="Plain"><w:name w:val="Plain"/><w:basedOn w:val="Normal"/><w:pPr><w:pBdr><w:top w:val="nil"/><w:bottom w:val="nil"/></w:pBdr><w:shd w:val="clear" w:color="auto" w:fill="auto"/></w:pPr></w:style>`;
    const files = unzipSync(docx(`<w:p><w:pPr><w:pStyle w:val="Plain"/></w:pPr><w:r><w:t>plain</w:t></w:r></w:p><w:p><w:r><w:t>boxed</w:t></w:r></w:p>`));
    files['word/styles.xml'] = new Uint8Array(strToU8(`<?xml version="1.0"?><w:styles ${W}>${styles}</w:styles>`));
    const t = (await readDocx(zipSync(files))).doc as DocText;
    expect(t.paras[0].border).toBeUndefined();
    const once = await writeDocx(t, deps);
    const back = (await readDocx(once)).doc as DocText;
    expect(back.paras[0].border).toBeUndefined();
    expect(back.paras[0].shade).toBeUndefined();
    expect(back.paras[1].border?.top).toBeTruthy();
    const again = unzipSync(await writeDocx(back, deps));
    for (const part of ['word/document.xml', 'word/styles.xml']) expect(strFromU8(again[part])).toBe(strFromU8(unzipSync(once)[part]));
    // (in their place in each style's w:pPr: before the spacing, ECMA-376 Part 1 §17.3.1.26 CT_PPrBase)
    const sx = strFromU8(unzipSync(once)['word/styles.xml']);
    for (const m of sx.matchAll(/<w:pPr>(.*?)<\/w:pPr>/g)) {
      const i = Math.max(m[1].indexOf('<w:pBdr>'), m[1].indexOf('<w:shd '));
      const j = m[1].search(/<w:(spacing|ind|jc|outlineLvl)\b/);
      if (i >= 0 && j >= 0) expect(i).toBeLessThan(j);
    }
  });

  it("give way to another style's when a paragraph changes style; New Style takes the paragraph's", async () => {
    const t = (await readDocx(docx('<w:p><w:pPr><w:pStyle w:val="Boxed"/></w:pPr><w:r><w:t>boxed</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="Boxed"/><w:pBdr><w:top w:val="nil"/><w:bottom w:val="nil"/></w:pBdr><w:shd w:val="clear" w:color="auto" w:fill="auto"/></w:pPr><w:r><w:t>unboxed</w:t></w:r></w:p>'))).doc as DocText;
    const plain = setParaStyle(t, 0, 0, 'Normal');
    expect(plain.paras[0].border).toBeUndefined();
    expect(plain.paras[0].shade).toBeUndefined();
    // the style changed (Modify Style): the paragraph unboxed by hand stays so, the other takes the change
    const boxed = Object.values(t.styles).find((s) => s.name === 'Boxed')!;
    const modified = modifyStyle(t, { ...boxed, size: boxed.size + 2, shade: '#ddeeff' });
    expect(modified.paras[1].border).toBeUndefined();
    expect(modified.paras[1].shade).toBeUndefined();
    expect(modified.paras[0].shade).toBe('#ddeeff');
    expect(modified.paras[0].border?.top).toBeTruthy();
    const made = newParaStyle(t, 'Bare', 1, {});
    expect(made.t.styles[made.id].border).toBeUndefined();
    expect(made.t.styles[made.id].shade).toBeUndefined();
    expect(made.t.paras[1].border).toBeUndefined();
  });

  it("are written on a paragraph with the style's lines at its own distance from the text", async () => {
    const own = `<w:pBdr><w:top w:val="single" w:sz="4" w:space="12" w:color="C8553D"/><w:bottom w:val="single" w:sz="4" w:space="12" w:color="C8553D"/></w:pBdr>`;
    const t = (await readDocx(docx(`<w:p><w:pPr><w:pStyle w:val="Boxed"/>${own}</w:pPr><w:r><w:t>far</w:t></w:r></w:p><w:p/>`))).doc as DocText;
    const x = strFromU8(unzipSync(await writeDocx(t, deps))['word/document.xml']);
    expect(pPrs(x)[0]).toContain('w:space="12"');
  });

  it('are given to a paragraph put in the style here', async () => {
    const t = (await readDocx(docx('<w:p><w:r><w:t>plain</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="Boxed"/></w:pPr><w:r><w:t>boxed</w:t></w:r></w:p>'))).doc as DocText;
    const boxed = Object.values(t.styles).find((s) => s.name === 'Boxed')!;
    const ps = paraFromStyle(boxed, t.paras[0]);
    expect(ps.border?.bottom).toMatchObject({ style: 'single' });
    expect(ps.shade).toBe('#eef2e6');
  });
});
