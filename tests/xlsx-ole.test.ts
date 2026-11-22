// @vitest-environment jsdom
//
// Objects embedded in an Excel sheet (a ChemDraw structure pasted into Excel lands as a ChemDraw
// OLE object) are kept on saving, with a note on opening, instead of disappearing (audit G2-01).
// The workbook is built here the way Excel 2010 and later write one (ECMA-376 part 1 18.3.1.59
// oleObject inside an mc:AlternateContent with an x14 objectPr choice, the VML shape it names by
// shapeId, and the hidden a14 twin in the drawing); the object's bytes are a stand-in.

import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { writeXlsx, readXlsx, type XlsxPictures } from '../src/io/xlsx';
import { Package, REL } from '../src/io/ooxml';

const pictures: XlsxPictures = { box: () => ({ w: 60, h: 40 }), picture: async () => null };
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const X14 = 'http://schemas.microsoft.com/office/spreadsheetml/2009/9/main';
const XDR = 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing';
const A14 = 'http://schemas.microsoft.com/office/drawing/2010/main';
const BIN = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 1, 2, 3, 4, 5]);
const EMF = new Uint8Array([1, 0, 0, 0, 9, 9, 9]);

function book(withNote: boolean): Uint8Array {
  const pkg = new Package();
  pkg.relate('', REL.officeDocument, 'xl/workbook.xml');
  const sid = pkg.relate('xl/workbook.xml', `${R}/worksheet`, 'worksheets/sheet1.xml');
  pkg.add('xl/workbook.xml', `<workbook xmlns="${MAIN}" xmlns:r="${R}"><sheets><sheet name="Data" sheetId="1" r:id="${sid}"/></sheets></workbook>`,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml');
  const S = 'xl/worksheets/sheet1.xml';
  const oleRid = pkg.relate(S, `${R}/oleObject`, '../embeddings/oleObject1.bin');
  const imgRid = pkg.relate(S, `${R}/image`, '../media/image1.emf');
  const vmlRid = pkg.relate(S, `${R}/vmlDrawing`, '../drawings/vmlDrawing1.vml');
  const drRid = pkg.relate(S, `${R}/drawing`, '../drawings/drawing1.xml');
  const comRid = withNote ? pkg.relate(S, `${R}/comments`, '../comments1.xml') : '';
  pkg.add('xl/embeddings/oleObject1.bin', BIN, 'application/vnd.openxmlformats-officedocument.oleObject');
  pkg.add('xl/media/image1.emf', EMF, 'image/x-emf');
  void comRid;
  if (withNote) pkg.add('xl/comments1.xml', `<comments xmlns="${MAIN}"><authors><author>Nate</author></authors><commentList><comment ref="A1" authorId="0"><text><r><t>dry</t></r></text></comment></commentList></comments>`,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml');
  const anchor = '<anchor moveWithCells="1"><from><xdr:col>2</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>0</xdr:rowOff></from>' +
    '<to><xdr:col>4</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>6</xdr:row><xdr:rowOff>0</xdr:rowOff></to></anchor>';
  pkg.add(S, `<worksheet xmlns="${MAIN}" xmlns:r="${R}" xmlns:mc="${MC}" xmlns:x14="${X14}" xmlns:xdr="${XDR}" mc:Ignorable="x14">` +
    '<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Product</t></is></c></row></sheetData>' +
    `<drawing r:id="${drRid}"/><legacyDrawing r:id="${vmlRid}"/>` +
    '<oleObjects><mc:AlternateContent><mc:Choice Requires="x14">' +
    `<oleObject progId="ChemDraw.Document.6.0" shapeId="1025" r:id="${oleRid}"><objectPr defaultSize="0" autoPict="0" r:id="${imgRid}">${anchor}</objectPr></oleObject>` +
    `</mc:Choice><mc:Fallback><oleObject progId="ChemDraw.Document.6.0" shapeId="1025" r:id="${oleRid}"/></mc:Fallback></mc:AlternateContent></oleObjects></worksheet>`,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml');
  const vimg = pkg.relate('xl/drawings/vmlDrawing1.vml', `${R}/image`, '../media/image1.emf');
  pkg.defaultType('vml', 'application/vnd.openxmlformats-officedocument.vmlDrawing');
  pkg.add('xl/drawings/vmlDrawing1.vml', '<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">' +
    '<o:shapelayout v:ext="edit"><o:idmap v:ext="edit" data="1"/></o:shapelayout>' +
    '<v:shapetype id="_x0000_t75" coordsize="21600,21600" o:spt="75" path="m@4@5l@4@11@9@11@9@5xe" filled="f" stroked="f"><v:path o:extrusionok="f"/></v:shapetype>' +
    `<v:shape id="Object_x0020_1" o:spid="_x0000_s1025" type="#_x0000_t75" style="position:absolute;width:120pt;height:75pt"><v:imagedata o:relid="${vimg}" o:title=""/>` +
    '<x:ClientData ObjectType="Pict"><x:SizeWithCells/><x:Anchor>2, 0, 1, 0, 4, 0, 6, 0</x:Anchor><x:CF>Pict</x:CF><x:AutoPict/></x:ClientData></v:shape></xml>');
  pkg.add('xl/drawings/drawing1.xml', `<xdr:wsDr xmlns:xdr="${XDR}" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
    `<mc:AlternateContent xmlns:mc="${MC}"><mc:Choice xmlns:a14="${A14}" Requires="a14"><xdr:twoCellAnchor moveWithCells="1">` +
    '<xdr:from><xdr:col>2</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>' +
    '<xdr:to><xdr:col>4</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>6</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>' +
    '<xdr:sp macro="" textlink=""><xdr:nvSpPr><xdr:cNvPr id="1025" name="Object 1" hidden="1"><a:extLst><a:ext uri="{63B3BB69-23CF-44E3-9099-C40C66FF867C}">' +
    '<a14:compatExt spid="_x0000_s1025"/></a:ext></a:extLst></xdr:cNvPr><xdr:cNvSpPr/></xdr:nvSpPr><xdr:spPr/></xdr:sp><xdr:clientData/></xdr:twoCellAnchor>' +
    '</mc:Choice><mc:Fallback/></mc:AlternateContent></xdr:wsDr>', 'application/vnd.openxmlformats-officedocument.drawing+xml');
  return pkg.build();
}

const parse = (t: string) => new DOMParser().parseFromString(t, 'application/xml');

describe('objects embedded in an Excel sheet (G2-01)', () => {
  it('says so on opening, and does not call the twin shape a lost picture', async () => {
    const { warnings } = await readXlsx(book(false));
    expect(warnings).toEqual(['This workbook has 1 embedded object (1 ChemDraw structure). It isn\'t shown here, and it is kept for Excel when you save, at the cells it was placed over.']);
  });

  for (const withNote of [false, true]) {
    it(`keeps the object, its picture, VML shape and twin on saving${withNote ? ' (beside a note in the same VML drawing)' : ''}`, async () => {
      const { book: wb } = await readXlsx(book(withNote));
      const out = unzipSync(await writeXlsx(wb, pictures));
      const names = Object.keys(out);
      const bin = names.find((n) => /^xl\/embeddings\/oleObject\d+\.bin$/.test(n))!;
      const emf = names.filter((n) => /^xl\/media\/.*\.emf$/.test(n));
      expect(out[bin]).toEqual(BIN);
      expect(emf.length).toBeGreaterThan(0);
      for (const e of emf) expect(out[e]).toEqual(EMF);
      const sheet = strFromU8(out['xl/worksheets/sheet1.xml']);
      const doc = parse(sheet);
      expect(doc.getElementsByTagName('parsererror').length).toBe(0);
      const objs = Array.from(doc.getElementsByTagNameNS(MAIN, 'oleObject'));
      expect(objs.length).toBe(2);
      // the shape id follows the notes' boxes in the same VML block, and names the VML shape and twin
      const spid = objs[0].getAttribute('shapeId')!;
      expect(spid).toBe(withNote ? '1026' : '1025');
      expect(objs[1].getAttribute('shapeId')).toBe(spid);
      // each relationship id leads to the kept parts
      const rels = strFromU8(out['xl/worksheets/_rels/sheet1.xml.rels']);
      const rid = objs[0].getAttributeNS(R, 'id')!;
      expect(rels).toMatch(new RegExp(`Id="${rid}" Type="${R}/oleObject" Target="../${bin.slice(3)}"`));
      const pr = doc.getElementsByTagNameNS(MAIN, 'objectPr')[0];
      expect(rels).toMatch(new RegExp(`Id="${pr.getAttributeNS(R, 'id')}" Type="${R}/image" Target="../media/`));
      // ECMA-376 18.3.1.99: oleObjects after legacyDrawing
      expect(sheet.indexOf('<legacyDrawing')).toBeLessThan(sheet.indexOf('<oleObjects>'));
      // the x14 choice's prefix is declared where it is used
      expect(doc.getElementsByTagNameNS(MC, 'Choice')[0].lookupNamespaceURI('x14')).toBe(X14);
      // the VML shape, with its picture, in the sheet's VML drawing
      const vmlName = /Target="..\/drawings\/(vmlDrawing\d+\.vml)"/.exec(rels)![1];
      const vml = strFromU8(out[`xl/drawings/${vmlName}`]);
      expect(vml).toContain(`o:spid="_x0000_s${spid}"`);
      expect(vml).toContain('id="_x0000_t75"');
      if (withNote) expect(vml).toContain('ObjectType="Note"');
      const vrel = /o:relid="([^"]+)"/.exec(vml)![1];
      expect(strFromU8(out[`xl/drawings/_rels/${vmlName}.rels`])).toMatch(new RegExp(`Id="${vrel}" Type="${R}/image" Target="../media/`));
      // the twin in the drawing names the same shape
      const drawing = strFromU8(out['xl/drawings/drawing1.xml']);
      expect(parse(drawing).getElementsByTagName('parsererror').length).toBe(0);
      expect(drawing).toContain(`spid="_x0000_s${spid}"`);
      expect(strFromU8(out['[Content_Types].xml'])).toContain('application/vnd.openxmlformats-officedocument.oleObject');
    });
  }

  it('keeps it through a second save', async () => {
    const once = await writeXlsx((await readXlsx(book(true))).book, pictures);
    const again = await readXlsx(once);
    expect(again.warnings[0]).toMatch(/1 embedded object/);
    const out = unzipSync(await writeXlsx(again.book, pictures));
    expect(Object.keys(out).filter((n) => n.startsWith('xl/embeddings/')).length).toBe(1);
  });

  it('moves the object with its cells when rows and columns are inserted or deleted, as Excel does', async () => {
    const { book: wb } = await readXlsx(book(false));
    const sh = wb.sheets[0];
    expect(sh.ole![0].at).toEqual([2, 1, 4, 6]);
    wb.edit('insert', () => sh.insertRows(0, 2));
    wb.edit('delete', () => sh.deleteCols(0, 1));
    expect(sh.ole![0].at).toEqual([1, 3, 3, 8]);
    const out = unzipSync(await writeXlsx(wb, pictures));
    const sheet = strFromU8(out['xl/worksheets/sheet1.xml']);
    const pr = parse(sheet).getElementsByTagNameNS(MAIN, 'objectPr')[0];
    const num = (side: string, n: string) => pr.getElementsByTagNameNS(MAIN, side)[0].getElementsByTagNameNS(XDR, n)[0].textContent;
    expect([num('from', 'col'), num('from', 'row'), num('to', 'col'), num('to', 'row')]).toEqual(['1', '3', '3', '8']);
    const vml = Object.entries(out).find(([n]) => /vmlDrawing\d+\.vml$/.test(n))!;
    expect(strFromU8(vml[1])).toContain('<x:Anchor>1, 0, 3, 0, 3, 0, 8, 0</x:Anchor>');
    expect(strFromU8(out['xl/drawings/drawing1.xml'])).toMatch(/<xdr:from><xdr:col>1<\/xdr:col><xdr:colOff>0<\/xdr:colOff><xdr:row>3<\/xdr:row>/);
    // and back again with Undo
    wb.undo(); wb.undo();
    expect(sh.ole![0].at).toEqual([2, 1, 4, 6]);
  });
});
