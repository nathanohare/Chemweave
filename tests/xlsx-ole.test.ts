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
import { zipSync, strToU8 } from 'fflate';
import { Workbook, makeStructure } from '../src/sheet/workbook';
import { chemdrawObject, oleCellTag } from '../src/io/ole-object';
import type { Contents } from '../src/model';

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
    expect(warnings).toEqual(['This workbook has 1 embedded object (1 ChemDraw structure). It isn\'t shown here, and it is kept for Excel when you save, at the cells it was placed over (Edit ▸ Spreadsheet ▸ Data Tools ▸ Remove Embedded Objects removes it).']);
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

  describe('structures saved as ChemDraw objects (Settings ▸ General)', () => {
    const CDX_HEAD = [0x56, 0x6a, 0x43, 0x44, 0x30, 0x31, 0x30, 0x30, 0x04, 0x03, 0x02, 0x01];
    const cdxOf = (n: number) => new Uint8Array([...CDX_HEAD, n, n, n, n]);
    const mol = (label: string): Contents => ({ atoms: [{ id: 1, x: 0, y: 0, z: 6, charge: 0, isotope: 0, label } as never], bonds: [], captions: [], arrows: [], shapes: [] });
    const asObjects: XlsxPictures = { ...pictures, chemdrawObjects: true, chemdraw: () => ({ cdx: cdxOf(1), emf: EMF, w: 30, h: 20 }) };
    async function saved(): Promise<Record<string, Uint8Array>> {
      const wb = new Workbook();
      wb.sheets[0].setCell(1, 1, { structure: makeStructure(mol('CCO')) });
      return unzipSync(await writeXlsx(wb, asObjects));
    }

    it('writes an Excel ChemDraw object over the cell, with its VML shape and picture, instead of a picture', async () => {
      const out = await saved();
      const sheet = strFromU8(out['xl/worksheets/sheet1.xml']);
      expect(sheet).toMatch(/<oleObject [^>]*progId="ChemDraw[^"]*" shapeId="\d+" r:id="rId\d+"><objectPr /);
      const vml = Object.entries(out).find(([n]) => /vmlDrawing\d+\.vml$/.test(n))!;
      expect(strFromU8(vml[1])).toContain('id="Structure_x0020_B2"');
      expect(Object.keys(out).some((n) => /^xl\/embeddings\/oleObject\d+\.bin$/.test(n))).toBe(true);
      const drawing = Object.entries(out).find(([n]) => /drawings\/drawing\d+\.xml$/.test(n));
      expect(drawing ? strFromU8(drawing[1]) : '').not.toContain('name="Structure B2"');
    });

    it('opens as the cell\'s structure again, the object not kept twice', async () => {
      const { book: wb, warnings } = await readXlsx(zipSync(await saved()), { readChemdraw: () => mol('X') });
      const sh = wb.sheets[0];
      expect(sh.ole ?? []).toHaveLength(0);
      expect(sh.cell(1, 1)?.structure?.contents.atoms[0]).toMatchObject({ label: 'CCO' });
      expect(warnings.join(' ')).not.toMatch(/changed in another program|embedded object/i);
      // and saved again, one object
      const again = strFromU8(unzipSync(await writeXlsx(wb, asObjects))['xl/worksheets/sheet1.xml']);
      expect(again.match(/<oleObject /g)?.length).toBe(2);
    });

    it('takes a structure changed in ChemDraw from Excel, or keeps the object when it cannot be read', async () => {
      const out = await saved();
      const bin = Object.keys(out).find((n) => /^xl\/embeddings\/oleObject\d+\.bin$/.test(n))!;
      out[bin] = chemdrawObject(cdxOf(2));
      const read = await readXlsx(zipSync(out), { readChemdraw: () => mol('CCC') });
      expect(read.book.sheets[0].cell(1, 1)?.structure?.contents.atoms[0]).toMatchObject({ label: 'CCC' });
      expect(read.book.sheets[0].ole ?? []).toHaveLength(0);
      expect(read.warnings.join(' ')).toMatch(/changed in another program/);
      const kept = await readXlsx(zipSync(out));
      expect(kept.book.sheets[0].ole).toHaveLength(1);
    });

    // Excel saving the workbook again renames shapes; the object's own data it keeps (review F2-R05)
    const renamed = (out: Record<string, Uint8Array>) => {
      const vml = Object.keys(out).find((n) => /vmlDrawing\d+\.vml$/.test(n))!;
      out[vml] = strToU8(strFromU8(out[vml]).replace(/Structure_x0020_B2/g, 'Object_x0020_1'));
      return out;
    };
    const binOf = (out: Record<string, Uint8Array>) => Object.keys(out).find((n) => /^xl\/embeddings\/oleObject\d+\.bin$/.test(n))!;

    it('knows its own object by the cell named in the object\'s data, after Excel renames its shape', async () => {
      const out = renamed(await saved());
      expect(oleCellTag(out[binOf(out)])).toBe('B2');
      const { book: wb, warnings } = await readXlsx(zipSync(out), { readChemdraw: () => mol('X') });
      expect(wb.sheets[0].ole ?? []).toHaveLength(0);
      expect(warnings.join(' ')).not.toMatch(/embedded object/i);
      expect(wb.sheets[0].cell(1, 1)?.structure?.contents.atoms[0]).toMatchObject({ label: 'CCO' });
    });

    it('knows it by its ChemDraw data when neither the name nor the cell is there', async () => {
      const out = renamed(await saved());
      out[binOf(out)] = chemdrawObject(cdxOf(1));
      const { book: wb, warnings } = await readXlsx(zipSync(out));
      expect(wb.sheets[0].ole ?? []).toHaveLength(0);
      expect(warnings.join(' ')).not.toMatch(/embedded object/i);
    });

    it('keeps one changed in ChemDraw that can\'t be read, says so, and saves no picture under it', async () => {
      const out = renamed(await saved());
      out[binOf(out)] = chemdrawObject(cdxOf(3));
      const { book: wb, warnings } = await readXlsx(zipSync(out));
      expect(wb.sheets[0].ole).toHaveLength(1);
      expect(warnings.join(' ')).toMatch(/changed in ChemDraw from Excel in a way that can't be read here/);
      expect(warnings.join(' ')).not.toMatch(/This workbook has \d+ embedded object/);
      const again = unzipSync(await writeXlsx(wb, asObjects));
      expect(strFromU8(again['xl/worksheets/sheet1.xml']).match(/<oleObject /g)).toHaveLength(2);
      const drawing = Object.entries(again).find(([n]) => /drawings\/drawing\d+\.xml$/.test(n));
      expect(drawing ? strFromU8(drawing[1]) : '').not.toContain('name="Structure B2"');
    });

    it('writes the object\'s picture once, for the sheet and its VML shape (review F2-R10)', async () => {
      const out = await saved();
      expect(Object.keys(out).filter((n) => /^xl\/media\/image_ole\d+\.emf$/.test(n))).toHaveLength(1);
    });
  });

  it('says on opening that an object whose data isn\'t in the file is left out (review F2-R08)', async () => {
    const pkg = new Package();
    pkg.relate('', REL.officeDocument, 'xl/workbook.xml');
    const sid = pkg.relate('xl/workbook.xml', `${R}/worksheet`, 'worksheets/sheet1.xml');
    pkg.add('xl/workbook.xml', `<workbook xmlns="${MAIN}" xmlns:r="${R}"><sheets><sheet name="Data" sheetId="1" r:id="${sid}"/></sheets></workbook>`,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml');
    // Excel 2007's linked object: a link, no relationship to its data
    pkg.add('xl/worksheets/sheet1.xml', `<worksheet xmlns="${MAIN}" xmlns:r="${R}"><sheetData/><oleObjects><oleObject progId="Word.Document.12" link="[1]!'!OLE_LINK1'" oleUpdate="OLEUPDATE_ONCALL" shapeId="1025"/></oleObjects></worksheet>`,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml');
    const { warnings } = await readXlsx(pkg.build());
    expect(warnings.join(' ')).toMatch(/left out if you save over this file: .*1 embedded object whose data isn't in the file/);
  });

  it('removes the kept objects with Remove Embedded Objects, and Undo brings them back (review F2-R11)', async () => {
    const { book: wb } = await readXlsx(book(false));
    const sh = wb.sheets[0];
    expect(sh.ole).toHaveLength(1);
    let n = 0;
    wb.edit('Remove Embedded Objects', () => { n = sh.removeOle(); });
    expect(n).toBe(1);
    expect(sh.ole ?? []).toHaveLength(0);
    expect(strFromU8(unzipSync(await writeXlsx(wb, pictures))['xl/worksheets/sheet1.xml'])).not.toContain('<oleObject');
    wb.undo();
    expect(sh.ole).toHaveLength(1);
  });
});
