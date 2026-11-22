// Objects embedded in an Excel sheet (Insert > Object, or a ChemDraw structure pasted into Excel,
// which arrives as a ChemDraw OLE object), kept as the file had them to save back. They aren't
// shown here; without this they were lost on the first save.
//
// Where Excel keeps one (ECMA-376 part 1):
// - the sheet's <oleObjects> (18.3.1.60), one <oleObject> (18.3.1.59) each, often inside an
//   mc:AlternateContent (part 3, 10.2.1) whose x14 choice adds <objectPr> (Excel 2010's picture
//   and anchor) and whose fallback is the plain Excel 2007 element. Its r:id leads to the object's
//   part (xl/embeddings/oleObject1.bin, or an Office file related as a package, 15.2.11), and
//   objectPr's r:id to the picture Excel shows (usually an EMF);
// - a VML shape (part 4, 19.1.2.19 shape) in the sheet's legacy drawing whose o:spid is
//   _x0000_s{shapeId}, with the picture as v:imagedata o:relid (part 4, 19.1.2.11);
// - in files from Excel 2010 and later, a hidden twin shape in the sheet's DrawingML drawing,
//   inside an mc:AlternateContent requiring a14, naming the VML shape by a14:compatExt spid.
// All three are kept, with their relationship ids and shape ids written afresh on saving (the
// writer numbers shapes after the notes' own boxes, which share the VML drawing).

import { kid, kids, NS, bytesHash, type PackageReader, type Package } from './ooxml';
import { elementXml } from './kept-parts';

const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const REL_NS = NS.r;

/** A part an object leads to (its own part, or the picture shown for it). */
export interface KeptOlePart {
  bytes: Uint8Array;
  /** The extension of the part's name. */
  ext: string;
  /** Its content type, as the file listed it. */
  type: string | null;
  /** The relationship type it was related by. */
  rel: string;
}

/** One embedded object of a sheet, as the file had it. */
export interface KeptSheetOle {
  /** The program it belongs to (ChemDraw.Document.6.0, Word.Document.12…). */
  progId: string;
  /** The <oleObject> or the mc:AlternateContent holding it, with every relationship id written as @@p{n}@@ and the shape id as @@spid@@. */
  xml: string;
  /** The parts @@p{n}@@ stand for. */
  parts: KeptOlePart[];
  /** Its VML shape (and the shape type it uses), with o:relid values as @@v{n}@@ and the shape id as @@spid@@. */
  vml?: { shape: string; shapeType: string; parts: KeptOlePart[] };
  /** The hidden twin in the DrawingML drawing (an mc:AlternateContent), with the shape id as @@spid@@. */
  drawing?: string;
  /**
   * The cells it is placed over (from column, from row, to column, to row, from 0), written in its
   * anchors as @@fc@@, @@fr@@, @@tc@@ and @@tr@@: moved here as rows and columns are inserted or
   * deleted, as Excel moves an object set to move with its cells.
   */
  at?: [number, number, number, number];
}

/** The anchor's cells in each kept text turned into @@fc@@, @@fr@@, @@tc@@, @@tr@@ (null: not all found). */
function placeholders(texts: (string | undefined)[], at: [number, number, number, number]): (string | undefined)[] | null {
  const names = ['fc', 'fr', 'tc', 'tr'];
  let ok = true;
  const out = texts.map((t) => {
    if (t === undefined) return t;
    // DrawingML anchors (xdr:from / xdr:to with col and row, 20.5.2.15)
    let s = t.replace(/(<((?:\w+:)?)(from|to)\b[^>]*>)([\s\S]*?)(<\/\2\3>)/g, (_all, open: string, _p: string, which: string, inner: string, close: string) => {
      const k = which === 'from' ? 0 : 2;
      const got = inner.replace(/(<((?:\w+:)?)col\b[^>]*>)(\d+)(<\/\2col>)/, (m, o: string, _q: string, v: string, c: string) => (Number(v) === at[k] ? `${o}@@${names[k]}@@${c}` : m))
        .replace(/(<((?:\w+:)?)row\b[^>]*>)(\d+)(<\/\2row>)/, (m, o: string, _q: string, v: string, c: string) => (Number(v) === at[k + 1] ? `${o}@@${names[k + 1]}@@${c}` : m));
      return `${open}${got}${close}`;
    });
    // VML's x:Anchor: from column, offset, from row, offset, to column, offset, to row, offset
    s = s.replace(/<x:Anchor>([^<]*)<\/x:Anchor>/, (all, v: string) => {
      const n = v.split(',').map((x) => x.trim());
      if (n.length !== 8 || +n[0] !== at[0] || +n[2] !== at[1] || +n[4] !== at[2] || +n[6] !== at[3]) { ok = false; return all; }
      return `<x:Anchor>@@fc@@, ${n[1]}, @@fr@@, ${n[3]}, @@tc@@, ${n[5]}, @@tr@@, ${n[7]}</x:Anchor>`;
    });
    return s;
  });
  return ok ? out : null;
}

/** Kept text with its anchor's cells put in. */
const anchored = (t: string, at: [number, number, number, number] | undefined) =>
  at ? t.replace(/@@(fc|fr|tc|tr)@@/g, (_, k: string) => String(at[['fc', 'fr', 'tc', 'tr'].indexOf(k)])) : t;


const extOf = (path: string) => /\.([^./]+)$/.exec(path)?.[1]?.toLowerCase() ?? 'bin';

/**
 * The prefixes an mc:Choice requires (and mc:Ignorable names) declared on `copy`, so the kept text can
 * stand alone; `from` is the element it was copied from, still in its document, to look them up.
 */
function declareRequired(copy: Element, from: Element): void {
  const prefixes = new Set<string>();
  for (const el of [copy, ...Array.from(copy.getElementsByTagName('*'))]) {
    if (el.namespaceURI === MC && el.localName === 'Choice') for (const p of (el.getAttribute('Requires') ?? '').split(/\s+/)) prefixes.add(p);
    for (const p of (el.getAttributeNS(MC, 'Ignorable') ?? '').split(/\s+/)) prefixes.add(p);
  }
  for (const p of prefixes) {
    const uri = p ? from.lookupNamespaceURI(p) : null;
    if (uri && !copy.hasAttribute(`xmlns:${p}`)) copy.setAttributeNS('http://www.w3.org/2000/xmlns/', `xmlns:${p}`, uri);
  }
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The embedded objects of a worksheet (`ws`, at `path`), with their VML shapes (`vmlPath`) and
 * Excel 2010's twin shapes in the DrawingML drawing (`drawing`).
 */
export function readSheetOle(pkg: PackageReader, path: string, ws: Element, vmlPath: string | null, drawing: Document | null, lost: string[] = []): KeptSheetOle[] {
  const list = kid(ws, 'oleObjects');
  if (!list) return [];
  const rels = pkg.rels(path);
  const vmlText = vmlPath ? pkg.text(vmlPath) : null;
  const vmlRels = vmlPath ? pkg.rels(vmlPath) : null;
  const out: KeptSheetOle[] = [];
  for (const item of kids(list)) {
    const ole = item.localName === 'oleObject' ? item : item.localName === 'AlternateContent' ? Array.from(item.getElementsByTagName('*')).find((x) => x.localName === 'oleObject') : undefined;
    if (!ole) { lost.push(''); continue; }
    const shapeId = ole.getAttribute('shapeId') ?? '';
    const copy = item.cloneNode(true) as Element;
    if (item.localName === 'AlternateContent') declareRequired(copy, item);
    // the parts its relationships lead to (the same id in the choice and the fallback is one part)
    const parts: KeptOlePart[] = [];
    const seen = new Map<string, number>();
    let missing = false;
    for (const el of [copy, ...Array.from(copy.getElementsByTagName('*'))]) {
      for (const a of Array.from(el.attributes)) {
        if (a.localName === 'shapeId' && !a.namespaceURI) { a.value = '@@spid@@'; continue; }
        if (a.namespaceURI !== REL_NS) continue;
        let n = seen.get(a.value);
        if (n === undefined) {
          const r = rels.get(a.value);
          const bytes = r && !r.external ? pkg.bytes(r.target) : null;
          if (!r || !bytes) { missing = true; continue; }
          n = parts.push({ bytes, ext: extOf(r.target), type: pkg.contentType(r.target), rel: r.type }) - 1;
          seen.set(a.value, n);
        }
        a.value = `@@p${n}@@`;
      }
    }
    // (one whose data isn't in the file, a linked object: said on opening, as it can't be kept: review F2-R08)
    if (missing || !parts.length) { lost.push(ole.getAttribute('progId') ?? ''); continue; }
    const kept: KeptSheetOle = { progId: ole.getAttribute('progId') ?? '', xml: elementXml(copy), parts };
    // its VML shape, found by its shape id (the VML drawing is not always well-formed XML, so read as text)
    const spid = `_x0000_s${shapeId}`;
    const shape = shapeId && vmlText
      ? new RegExp(`<v:shape\\b(?=[^>]*(?:o:spid|\\bid)="${escapeRe(spid)}")[^>]*>[\\s\\S]*?</v:shape>`).exec(vmlText)?.[0]
      : undefined;
    if (shape && vmlRels) {
      const vparts: KeptOlePart[] = [];
      const vseen = new Map<string, number>();
      const text = shape.replace(new RegExp(escapeRe(spid), 'g'), '_x0000_s@@spid@@').replace(/(o:relid|r:id)="([^"]*)"/g, (all, attr: string, id: string) => {
        let n = vseen.get(id);
        if (n === undefined) {
          const r = vmlRels.get(id);
          const bytes = r && !r.external ? pkg.bytes(r.target) : null;
          if (!r || !bytes) return all;
          n = vparts.push({ bytes, ext: extOf(r.target), type: pkg.contentType(r.target), rel: r.type }) - 1;
          vseen.set(id, n);
        }
        return `${attr}="@@v${n}@@"`;
      });
      const typeId = /\btype="#([^"]+)"/.exec(shape)?.[1];
      const shapeType = typeId ? new RegExp(`<v:shapetype\\b(?=[^>]*\\bid="${escapeRe(typeId)}")[^>]*(?:/>|>[\\s\\S]*?</v:shapetype>)`).exec(vmlText!)?.[0] ?? '' : '';
      kept.vml = { shape: text, shapeType, parts: vparts };
    }
    // Excel 2010's twin in the drawing: an AlternateContent whose compatExt names the shape
    if (shapeId && drawing) {
      for (const ac of kids(drawing.documentElement, 'AlternateContent')) {
        const compat = Array.from(ac.getElementsByTagName('*')).find((x) => x.localName === 'compatExt' && x.getAttribute('spid') === spid);
        if (!compat) continue;
        // (it must lead to no parts of its own to be kept as text)
        if (Array.from(ac.getElementsByTagName('*')).some((x) => Array.from(x.attributes).some((a) => a.namespaceURI === REL_NS))) break;
        const twin = ac.cloneNode(true) as Element;
        declareRequired(twin, ac);
        for (const x of Array.from(twin.getElementsByTagName('*'))) {
          if (x.localName === 'compatExt') x.setAttribute('spid', '_x0000_s@@spid@@');
          else if (x.localName === 'cNvPr' && x.getAttribute('id') === shapeId) x.setAttribute('id', '@@spid@@');
        }
        kept.drawing = elementXml(twin);
        break;
      }
    }
    // the cells it is over, from its anchor (x14 objectPr, else the twin's, else VML's)
    const a = /<(?:\w+:)?from\b[^>]*>[\s\S]*?<(?:\w+:)?col\b[^>]*>(\d+)<[\s\S]*?<(?:\w+:)?row\b[^>]*>(\d+)<[\s\S]*?<(?:\w+:)?to\b[^>]*>[\s\S]*?<(?:\w+:)?col\b[^>]*>(\d+)<[\s\S]*?<(?:\w+:)?row\b[^>]*>(\d+)</.exec(kept.xml + (kept.drawing ?? ''));
    const v = kept.vml && /<x:Anchor>([^<]*)<\/x:Anchor>/.exec(kept.vml.shape)?.[1].split(',').map((x) => Number(x.trim()));
    const at: [number, number, number, number] | null = a ? [+a[1], +a[2], +a[3], +a[4]] : v && v.length === 8 ? [v[0], v[2], v[4], v[6]] : null;
    if (at) {
      const done = placeholders([kept.xml, kept.vml?.shape, kept.drawing], at);
      if (done) {
        kept.xml = done[0]!;
        if (kept.vml) kept.vml.shape = done[1]!;
        if (kept.drawing) kept.drawing = done[2];
        kept.at = at;
      }
    }
    out.push(kept);
  }
  return out;
}

/** What an object is, for the message on opening ("ChemDraw structure", "Word document"). */
export function oleKind(progId: string): string {
  if (/^ChemDraw/i.test(progId)) return 'ChemDraw structure';
  if (/^Word\./i.test(progId)) return 'Word document';
  if (/^Excel\./i.test(progId)) return 'Excel worksheet';
  if (/^PowerPoint\./i.test(progId)) return 'PowerPoint presentation';
  if (/^Package$/i.test(progId)) return 'file';
  if (/^AcroExch\./i.test(progId)) return 'PDF file';
  return 'object';
}

/** The note on opening a workbook with embedded objects (they are kept but not shown). */
export function oleNote(objects: KeptSheetOle[]): string | null {
  if (!objects.length) return null;
  const kinds = new Map<string, number>();
  for (const o of objects) kinds.set(oleKind(o.progId), (kinds.get(oleKind(o.progId)) ?? 0) + 1);
  const n = objects.length;
  const what = [...kinds].map(([k, c]) => `${c} ${k}${c > 1 ? 's' : ''}`).join(', ');
  return `This workbook has ${n} embedded object${n > 1 ? 's' : ''} (${what}). ${n > 1 ? 'They aren\'t' : 'It isn\'t'} shown here, ` +
    `and ${n > 1 ? 'they are' : 'it is'} kept for Excel when you save, at the cells ${n > 1 ? 'they were' : 'it was'} placed over.`;
}

/** The standard VML shape type of a picture frame (part 4, 19.1.2.20), for a shape whose own wasn't found. */
const PICTURE_FRAME = '<v:shapetype id="_x0000_t75" coordsize="21600,21600" o:spt="75" o:preferrelative="t" path="m@4@5l@4@11@9@11@9@5xe" filled="f" stroked="f">' +
  '<v:stroke joinstyle="miter"/><v:formulas><v:f eqn="if lineDrawn pixelLineWidth 0"/><v:f eqn="sum @0 1 0"/><v:f eqn="sum 0 0 @1"/><v:f eqn="prod @2 1 2"/>' +
  '<v:f eqn="prod @3 21600 pixelWidth"/><v:f eqn="prod @3 21600 pixelHeight"/><v:f eqn="sum @0 0 1"/><v:f eqn="prod @6 1 2"/><v:f eqn="prod @7 21600 pixelWidth"/>' +
  '<v:f eqn="sum @8 21600 0"/><v:f eqn="prod @7 21600 pixelHeight"/><v:f eqn="sum @10 21600 0"/></v:formulas>' +
  '<v:path o:extrusionok="f" gradientshapeok="t" o:connecttype="rect"/><o:lock v:ext="edit" aspectratio="t"/></v:shapetype>';

export interface OleWriteState {
  /** Numbers used for the parts written so far (oleObject1.bin, image3.emf…). */
  embedNo: number;
  mediaNo: number;
  /** The pictures written so far, by type and print: written once and related from each part that shows them. */
  media?: Map<string, string>;
}

/**
 * Write a sheet's kept objects: their parts, related from the sheet (`sheetPath`) and its VML
 * drawing (`vmlPath`), with shape ids from `firstShapeId` on. Returns the <oleObjects> element, the
 * VML shapes (and the shape types they use) to add to the VML drawing, and the twins to add to the
 * DrawingML drawing's anchors.
 */
export function writeSheetOle(pkg: Package, objects: KeptSheetOle[], sheetPath: string, vmlPath: string, firstShapeId: number, state: OleWriteState):
  { oleObjects: string; vmlShapes: string; vmlTypes: string; anchors: string[] } {
  const items: string[] = [], shapes: string[] = [], anchors: string[] = [];
  const types = new Map<string, string>();
  const partOf = (from: string, p: KeptOlePart): string => {
    const media = /^(emf|wmf|png|jpe?g|gif|bmp|tiff?)$/.test(p.ext) || /\/image$/.test(p.rel);
    // (a picture once, however many parts relate to it: the sheet's object and its VML shape share one, as in Excel's files)
    const key = media ? `${p.ext}|${bytesHash(p.bytes)}` : '';
    let name = media ? state.media?.get(key) : undefined;
    if (!name) {
      name = media ? `xl/media/image_ole${++state.mediaNo}.${p.ext}` : `xl/embeddings/oleObject${++state.embedNo}.${p.ext}`;
      pkg.add(name, p.bytes, p.type ?? undefined);
      if (media) (state.media ??= new Map()).set(key, name);
    }
    return pkg.relate(from, p.rel, `../${name.slice(3)}`);
  };
  objects.forEach((o, i) => {
    const spid = String(firstShapeId + i);
    const ids = o.parts.map((p) => partOf(sheetPath, p));
    items.push(anchored(o.xml, o.at).replace(/@@p(\d+)@@/g, (_, n: string) => ids[Number(n)]).replace(/@@spid@@/g, spid));
    if (o.vml) {
      const vids = o.vml.parts.map((p) => partOf(vmlPath, p));
      shapes.push(anchored(o.vml.shape, o.at).replace(/@@v(\d+)@@/g, (_, n: string) => vids[Number(n)]).replace(/@@spid@@/g, spid));
      const typeId = /\btype="#([^"]+)"/.exec(o.vml.shape)?.[1];
      if (typeId && !types.has(typeId)) types.set(typeId, o.vml.shapeType || (typeId === '_x0000_t75' ? PICTURE_FRAME : ''));
    }
    if (o.drawing) anchors.push(anchored(o.drawing, o.at).replace(/@@spid@@/g, spid));
  });
  return { oleObjects: items.length ? `<oleObjects>${items.join('')}</oleObjects>` : '', vmlShapes: shapes.join(''), vmlTypes: [...types.values()].join(''), anchors };
}

/** Where a structure saved as an object sits: its corner cells and the offsets into them, in pixels. */
export interface OleAnchor { col: number; colOff: number; row: number; rowOff: number }

/**
 * A structure in a cell saved as a ChemDraw object (Settings ▸ General ▸ Save structures in Excel
 * files as), written as Excel 2010 writes an embedded object (18.3.1.59 oleObject in an
 * mc:AlternateContent with its x14 objectPr anchor, and the VML shape it names for Excel 2007).
 * `ref` names the cell it was saved over (its VML shape is "Structure A2", as a picture would be).
 */
export function structureOle(ref: string, prog: string, bin: Uint8Array, preview: { bytes: Uint8Array; ext: string; type: string }, from: OleAnchor, to: OleAnchor, size: { w: number; h: number }): KeptSheetOle {
  const p = (a: OleAnchor, fc: string, fr: string) => `<xdr:col>@@${fc}@@</xdr:col><xdr:colOff>${Math.round(a.colOff * 9525)}</xdr:colOff><xdr:row>@@${fr}@@</xdr:row><xdr:rowOff>${Math.round(a.rowOff * 9525)}</xdr:rowOff>`;
  const progId = prog.replace(/[&"<]/g, '');
  const xml = `<mc:AlternateContent xmlns:mc="${MC}"><mc:Choice xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main" Requires="x14">` +
    `<oleObject xmlns:r="${REL_NS}" progId="${progId}" shapeId="@@spid@@" r:id="@@p0@@"><objectPr defaultSize="0" autoPict="0" r:id="@@p1@@">` +
    `<anchor xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" moveWithCells="1"><from>${p(from, 'fc', 'fr')}</from><to>${p(to, 'tc', 'tr')}</to></anchor>` +
    `</objectPr></oleObject></mc:Choice><mc:Fallback><oleObject xmlns:r="${REL_NS}" progId="${progId}" shapeId="@@spid@@" r:id="@@p0@@"/></mc:Fallback></mc:AlternateContent>`;
  const shape = `<v:shape id="Structure_x0020_${ref}" o:spid="_x0000_s@@spid@@" type="#_x0000_t75" style="position:absolute;margin-left:0;margin-top:0;width:${+size.w.toFixed(2)}pt;height:${+size.h.toFixed(2)}pt;z-index:1" filled="f" stroked="f">` +
    `<v:imagedata o:relid="@@v0@@" o:title=""/><x:ClientData ObjectType="Pict"><x:SizeWithCells/>` +
    `<x:Anchor>@@fc@@, ${Math.round(from.colOff)}, @@fr@@, ${Math.round(from.rowOff)}, @@tc@@, ${Math.round(to.colOff)}, @@tr@@, ${Math.round(to.rowOff)}</x:Anchor><x:CF>Pict</x:CF><x:AutoPict/></x:ClientData></v:shape>`;
  const image = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';
  const pic: KeptOlePart = { bytes: preview.bytes, ext: preview.ext, type: preview.type, rel: image };
  return {
    progId, xml, at: [from.col, from.row, to.col, to.row],
    parts: [{ bytes: bin, ext: 'bin', type: 'application/vnd.openxmlformats-officedocument.oleObject', rel: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject' }, pic],
    vml: { shape, shapeType: '', parts: [pic] },
  };
}

/** The cell a structure saved here as an object was saved over ("A2" from its VML shape "Structure A2"); null for anyone else's object. */
export function structureOleRef(o: KeptSheetOle): string | null {
  return /\bid="Structure_x0020_([A-Z]{1,3}\d{1,7})"/.exec(o.vml?.shape ?? '')?.[1] ?? null;
}

/** A VML drawing of its own for a sheet's objects (one without notes), its shape ids in block `sheetNo` (o:idmap). */
export function oleVml(sheetNo: number, types: string, shapes: string): string {
  return '<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">' +
    `<o:shapelayout v:ext="edit"><o:idmap v:ext="edit" data="${sheetNo}"/></o:shapelayout>${types}${shapes}</xml>`;
}
