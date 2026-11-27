// @vitest-environment jsdom
//
// Objects inside a text box (a PAGE field, an equation, a picture) are the text box's own: they
// were dropped when a .docx was opened and when one was saved, because only the objects in
// tables' cells and footnotes counted as used.

import { describe, it, expect } from 'vitest';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { readDocx, writeDocx, type DocxDeps } from '../src/io/docx';
import { innerObjects, newDocument, objectRun, pruneObjects, usedObjects, type DocObject, type DocText } from '../src/document/document';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const DML = 'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const deps: DocxDeps = { async picture() { return { png: PNG, w: 10, h: 10 }; }, async svgToPng() { return PNG; } };

/** A minimal .docx built here: the body given, US Letter. */
function wordFile(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': new Uint8Array(strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>')),
    '_rels/.rels': new Uint8Array(strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}officeDocument" Target="word/document.xml"/></Relationships>`)),
    'word/_rels/document.xml.rels': new Uint8Array(strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>')),
    'word/document.xml': new Uint8Array(strToU8(`<?xml version="1.0"?><w:document ${W} ${DML}><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body></w:document>`)),
  });
}

/** A floating text box holding "Page " and a PAGE field. */
const boxWithPage = `<w:p><w:r><w:drawing><wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0" relativeHeight="1" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/>` +
  `<wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent cx="1828800" cy="457200"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapSquare wrapText="bothSides"/><wp:docPr id="1" name="Text Box 1"/><wp:cNvGraphicFramePr/>` +
  `<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1828800" cy="457200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></wps:spPr>` +
  `<wps:txbx><w:txbxContent><w:p><w:r><w:t xml:space="preserve">Page </w:t></w:r><w:fldSimple w:instr=" PAGE "><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p></w:txbxContent></wps:txbx><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r><w:r><w:t>Text</w:t></w:r></w:p>`;

const boxOf = (d: DocText) => Object.values(d.objects).find((o): o is Extract<DocObject, { kind: 'textbox' }> => o.kind === 'textbox');
const innerKinds = (d: DocText) => { const b = boxOf(d)!; return b.runs.filter((r) => r.obj !== undefined).map((r) => d.objects[r.obj!]?.kind); };

describe('objects inside a text box', () => {
  it('count as inner objects, so they are kept as used', () => {
    const d = newDocument();
    const t: DocText = {
      ...d,
      runs: [{ text: 'Body ' }, objectRun(1, {})],
      paras: [{}],
      objects: { 1: { kind: 'textbox', runs: [{ text: 'Page ' }, objectRun(2, {})], w: 100, float: { wrap: 'square', x: 0, y: 0 } } as DocObject, 2: { kind: 'field', code: 'page' } },
    } as DocText;
    expect(innerObjects(t.objects[1])).toEqual([2]);
    expect(usedObjects(t).has(2)).toBe(true);
    expect(pruneObjects(t).objects[2]).toEqual({ kind: 'field', code: 'page' });
  });

  it('a PAGE field in a .docx text box is there when opened, and when saved and opened again', async () => {
    const { doc } = await readDocx(wordFile(boxWithPage));
    expect(innerKinds(doc)).toEqual(['field']);
    const x = strFromU8(unzipSync(await writeDocx(doc, deps))['word/document.xml']);
    expect(/<w:txbxContent>.*PAGE.*<\/w:txbxContent>/.test(x)).toBe(true);
    const back = (await readDocx(await writeDocx(doc, deps))).doc;
    expect(innerKinds(back)).toEqual(['field']);
  });
});

describe('objects nested two levels down count as used', () => {
  it('keeps an equation in a table cell in a text box', () => {
    const float = { x: 0, y: 0, wrap: 'square' } as never;
    const objects: Record<number, DocObject> = {
      1: { kind: 'textbox', runs: [objectRun(2)], w: 100, float },
      2: { kind: 'table', table: { rows: [[{ runs: [objectRun(3)] }]] } } as never,
      3: { kind: 'math', tex: 'x' },
    };
    const used = usedObjects({ runs: [objectRun(1)], objects });
    expect([...used].sort()).toEqual([1, 2, 3]);
  });
});
