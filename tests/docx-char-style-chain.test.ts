// @vitest-environment jsdom
//
// A character style based on another (w:basedOn) stays based on it when the file is saved, and keeps
// its underline's kind (dotted, wave...); what it turns off of the one it is based on stays off, and
// nothing comes from that one that the text didn't have.

import { describe, it, expect } from 'vitest';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { readDocx, writeDocx, type DocxDeps } from '../src/io/docx';
import { applyCharStyle, modifyCharStyle, type DocText } from '../src/document/document';
import * as rt from '../src/richtext';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const deps: DocxDeps = { async picture() { return { png: PNG, w: 10, h: 10 }; }, async svgToPng() { return PNG; } };

const STYLES = `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>` +
  `<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/></w:style>` +
  // the base sets things a style here doesn't keep (highlight, raised, wide spacing) and caps; it isn't used itself
  `<w:style w:type="character" w:customStyle="1" w:styleId="CharBase"><w:name w:val="Char Base"/><w:basedOn w:val="DefaultParagraphFont"/><w:rPr><w:caps/><w:color w:val="C8553D"/><w:spacing w:val="40"/><w:highlight w:val="yellow"/><w:vertAlign w:val="superscript"/></w:rPr></w:style>` +
  // the derived one: dotted underline, caps off
  `<w:style w:type="character" w:customStyle="1" w:styleId="CharDerived"><w:name w:val="Char Derived"/><w:basedOn w:val="CharBase"/><w:rPr><w:caps w:val="0"/><w:spacing w:val="0"/><w:highlight w:val="none"/><w:vertAlign w:val="baseline"/><w:u w:val="dotted"/></w:rPr></w:style>`;

function docx(): Uint8Array {
  const body = `<w:p><w:r><w:t xml:space="preserve">plain </w:t></w:r><w:r><w:rPr><w:rStyle w:val="CharDerived"/></w:rPr><w:t>derived</w:t></w:r></w:p><w:p/>`;
  return zipSync({
    '[Content_Types].xml': new Uint8Array(strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>')),
    '_rels/.rels': new Uint8Array(strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}officeDocument" Target="word/document.xml"/></Relationships>`)),
    'word/_rels/document.xml.rels': new Uint8Array(strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdS" Type="${R}styles" Target="styles.xml"/></Relationships>`)),
    'word/styles.xml': new Uint8Array(strToU8(`<?xml version="1.0"?><w:styles ${W}>${STYLES}</w:styles>`)),
    'word/document.xml': new Uint8Array(strToU8(`<?xml version="1.0"?><w:document ${W}><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body></w:document>`)),
  });
}

const styleOf = (x: string, id: string) => new RegExp(`<w:style [^>]*w:styleId="${id}">.*?</w:style>`).exec(x)?.[0] ?? '';
const derivedRun = (t: DocText) => { const r = t.runs.find((x) => x.text.includes('derived'))!; return { ...r, text: 'derived' }; };

describe("a character style's chain", () => {
  it('is kept, with its dotted underline; its text reads back the same; the same on a second save', async () => {
    const t = (await readDocx(docx())).doc as DocText;
    expect(t.charStyles?.CharDerived).toMatchObject({ underline: true, ukind: 'dotted', color: '#c8553d', basedOn: 'CharBase' });
    expect(t.charStyles?.CharDerived?.allCaps).toBeFalsy();
    const once = await writeDocx(t, deps);
    const x = strFromU8(unzipSync(once)['word/styles.xml']);
    const derived = styleOf(x, 'CharDerived');
    expect(derived).toContain('<w:basedOn w:val="CharBase"/>');
    expect(derived).toContain('<w:u w:val="dotted"/>');
    expect(derived).toContain('<w:caps w:val="0"/>');
    expect(styleOf(x, 'CharBase')).toContain('<w:basedOn w:val="DefaultParagraphFont"/>');
    const back = (await readDocx(once)).doc as DocText;
    expect(derivedRun(back)).toEqual(derivedRun(t));
    expect(derivedRun(back)).not.toMatchObject({ allCaps: true });
    expect(derivedRun(back).highlight).toBeUndefined();
    expect(derivedRun(back).sup).toBeFalsy();
    expect(strFromU8(unzipSync(await writeDocx(back, deps))['word/styles.xml'])).toBe(x);
  });

  it("leaves a coloured paragraph's colour on text in a chain that sets none, and a parent changed here doesn't change it", async () => {
    // Heading 1 in blue; CB bold, CD italic based on CB: neither sets a colour
    const styles = `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>` +
      `<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:rPr><w:color w:val="2F5496"/></w:rPr></w:style>` +
      `<w:style w:type="character" w:customStyle="1" w:styleId="CB"><w:name w:val="CB"/><w:rPr><w:b/></w:rPr></w:style>` +
      `<w:style w:type="character" w:customStyle="1" w:styleId="CD"><w:name w:val="CD"/><w:basedOn w:val="CB"/><w:rPr><w:i/><w:u w:val="dotted"/></w:rPr></w:style>`;
    const files = unzipSync(docx());
    files['word/styles.xml'] = new Uint8Array(strToU8(`<?xml version="1.0"?><w:styles ${W}>${styles}</w:styles>`));
    files['word/document.xml'] = new Uint8Array(strToU8(`<?xml version="1.0"?><w:document ${W}><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:rPr><w:rStyle w:val="CD"/></w:rPr><w:t>styled</w:t></w:r></w:p><w:p/><w:sectPr/></w:body></w:document>`));
    const t = (await readDocx(zipSync(files))).doc as DocText;
    const run = (d: DocText) => d.runs.find((r) => r.text.includes('styled'))!;
    expect(run(t)).toMatchObject({ color: '#2f5496', bold: true, italic: true });
    const once = await writeDocx(t, deps);
    expect(strFromU8(unzipSync(once)['word/styles.xml'])).toContain('<w:basedOn w:val="CB"/>');
    expect(run((await readDocx(once)).doc as DocText)).toMatchObject({ color: '#2f5496', bold: true, italic: true, ukind: 'dotted' });
    // the parent made bigger, in Arial (Modify Style): the text in the child, as it shows here, stays as it was
    const changed = modifyCharStyle(t, { ...t.charStyles!.CB, size: 20, font: 'Arial' });
    const before = run(changed);
    const after = run((await readDocx(await writeDocx(changed, deps))).doc as DocText);
    expect([after.size, after.font, after.bold]).toEqual([before.size, before.font, before.bold]);
  });

  it('gives its underline kind to text put in it here', async () => {
    const t = (await readDocx(docx())).doc as DocText;
    const out = applyCharStyle(t, 0, 5, 'CharDerived');
    expect(out.runs[0]).toMatchObject({ cstyle: 'CharDerived', underline: true, ukind: 'dotted' });
    expect(rt.plainText(out.runs).startsWith('plain')).toBe(true);
  });

  it('is on Default Paragraph Font where it would be based on itself', async () => {
    const t = (await readDocx(docx())).doc as DocText;
    const loop: DocText = { ...t, charStyles: { ...t.charStyles!, CharBase: { ...t.charStyles!.CharBase, basedOn: 'CharDerived' } } };
    const x = strFromU8(unzipSync(await writeDocx(loop, deps))['word/styles.xml']);
    expect([styleOf(x, 'CharBase'), styleOf(x, 'CharDerived')].every((s) => s.includes('<w:basedOn w:val="DefaultParagraphFont"/>'))).toBe(true);
  });
});
