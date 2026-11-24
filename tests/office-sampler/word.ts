/**
 * Builds the Word samplers' files (WordprocessingML, ECMA-376 Part 1 §17) and finds their items
 * again: the main document with its styles, settings, font table and theme, plus whatever parts a
 * sampler adds (headers, notes, comments, pictures, objects).
 */
import { Pkg, REL, CT, NS, XML_HEAD, addProps, esc, kid, at, up, xmlns, type View } from './kit';
import { themeXml, THEME_FONTS } from './theme';

export const W_NS = xmlns('w', 'r', 'wp', 'a', 'pic', 'm', 'v', 'o', 'w10', 'mc', 'wps', 'wpg', 'w14', 'w15')
  + ' mc:Ignorable="w14 w15 wp14" xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing"';

/** A run of text with its formatting (rPr's contents). */
export const run = (text: string, rPr = '') => `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
/** A paragraph with its properties (pPr's contents, in the schema's order) and contents. */
export const para = (content: string, pPr = '') => `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${content}</w:p>`;
/** A paragraph of one run: the item's id and what it samples, formatted by `rPr`. */
export const line = (id: string, what: string, rPr = '', pPr = '') => para(run(`${id} ${what}`, rPr), pPr);

/** Letter paper, one-inch margins, as Word's default section. */
export const SECT = '<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/><w:cols w:space="720"/>';

const STYLES = (extra: string) => `${XML_HEAD}<w:styles ${W_NS}>`
  + `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:asciiTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi" w:eastAsiaTheme="minorEastAsia" w:cstheme="minorBidi"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US" w:eastAsia="ja-JP" w:bidi="ar-SA"/></w:rPr></w:rPrDefault>`
  + '<w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
  + '<w:latentStyles w:defLockedState="0" w:defUIPriority="99" w:defSemiHidden="0" w:defUnhideWhenUsed="0" w:defQFormat="0" w:count="376"><w:lsdException w:name="Normal" w:uiPriority="0" w:qFormat="1"/><w:lsdException w:name="heading 1" w:uiPriority="9" w:qFormat="1"/></w:latentStyles>'
  + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>'
  + '<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/><w:unhideWhenUsed/></w:style>'
  + '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>'
  + '<w:style w:type="numbering" w:default="1" w:styleId="NoList"><w:name w:val="No List"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/></w:style>'
  + [1, 2, 3].map((n) => `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="${480 - n * 120}" w:after="0"/><w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr><w:rFonts w:asciiTheme="majorHAnsi" w:hAnsiTheme="majorHAnsi"/><w:b/><w:color w:val="1B7F79" w:themeColor="accent1"/><w:sz w:val="${36 - n * 4}"/></w:rPr></w:style>`).join('')
  + '<w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="35"/><w:qFormat/><w:pPr><w:spacing w:after="200" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:i/><w:iCs/><w:color w:val="1F3A4D" w:themeColor="text2"/><w:sz w:val="18"/></w:rPr></w:style>'
  + '<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:basedOn w:val="DefaultParagraphFont"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:rPr><w:color w:val="0B5FA5" w:themeColor="hyperlink"/><w:u w:val="single"/></w:rPr></w:style>'
  + '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:uiPriority w:val="39"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders></w:tblPr></w:style>'
  + extra + '</w:styles>';

const FONTS = `${XML_HEAD}<w:fonts ${xmlns('w', 'r')}>`
  + [THEME_FONTS.minor, THEME_FONTS.major, 'Times New Roman', 'Arial', 'Courier New', 'Symbol', 'Wingdings', 'Segoe UI', 'MS Mincho', 'SimSun', 'Arial Unicode MS']
    .map((f) => `<w:font w:name="${f}"><w:family w:val="auto"/></w:font>`).join('') + '</w:fonts>';

export interface WordCtx {
  pkg: Pkg;
  /** Relate the main document to a target; returns the relationship id. */
  rel(type: string, target: string, external?: boolean): string;
  /** Add a part under word/ and relate the main document to it; returns the relationship id. */
  part(path: string, xml: string | Uint8Array, contentType: string | undefined, relType: string): string;
  /** Add a picture to word/media and relate it; returns the relationship id. */
  media(name: string, bytes: Uint8Array): string;
  /** Relate another part under word/ (such as numbering.xml) to a target; returns the relationship id. */
  relFrom(part: string, type: string, target: string, external?: boolean): string;
}

export interface WordParts {
  title: string;
  /** The body's paragraphs and tables (the last section's properties are added after). */
  body: (w: WordCtx) => string;
  /** The last section's properties (sectPr contents); Letter with one-inch margins otherwise. */
  sect?: (w: WordCtx) => string;
  styles?: string;
  /** numbering.xml's contents; made after the body, so it can relate pictures (picture bullets). */
  numbering?: string | ((w: WordCtx) => string);
  /** settings.xml's contents (in the schema's order). */
  settings?: string;
}

/** A Word file of these parts. */
export function wordFile(p: WordParts): Uint8Array {
  const pkg = new Pkg();
  pkg.rel('', REL.officeDocument, 'word/document.xml');
  addProps(pkg, p.title, 'Chemweave sampler');
  const rel = (type: string, target: string, external = false) => pkg.rel('word/document.xml', type, target, external);
  const ctx: WordCtx = {
    pkg, rel,
    part: (path, xml, ct, relType) => { pkg.add(`word/${path}`, xml, ct); return rel(relType, path); },
    media: (name, bytes) => { pkg.add(`word/media/${name}`, bytes); return rel(REL.image, `media/${name}`); },
    relFrom: (part, type, target, external = false) => pkg.rel(`word/${part}`, type, target, external),
  };
  ctx.part('styles.xml', STYLES(p.styles ?? ''), CT.styles, REL.styles);
  ctx.part('settings.xml', `${XML_HEAD}<w:settings ${W_NS}>${p.settings ?? '<w:defaultTabStop w:val="720"/><w:characterSpacingControl w:val="doNotCompress"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>'}</w:settings>`, CT.settings, REL.settings);
  ctx.part('fontTable.xml', FONTS, CT.fontTable, REL.fontTable);
  ctx.part('theme/theme1.xml', themeXml(), CT.theme, REL.theme);
  const body = p.body(ctx);
  if (p.numbering) {
    const n = typeof p.numbering === 'string' ? p.numbering : p.numbering(ctx);
    ctx.part('numbering.xml', `${XML_HEAD}<w:numbering ${W_NS}>${n}</w:numbering>`, CT.numbering, REL.numbering);
  }
  const sect = p.sect ? p.sect(ctx) : SECT;
  pkg.add('word/document.xml', `${XML_HEAD}<w:document ${W_NS}><w:body>${body}<w:sectPr>${sect}</w:sectPr></w:body></w:document>`, CT.docMain);
  return pkg.build();
}

// ---------------------------------------------------------------------------------------------
// Finding items again

/** Every Word part that holds text: the document, headers, footers, notes and comments. */
export const TEXT_PARTS = /^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/;

/** The text of a run (its w:t, w:delText and w:instrText). */
const runText = (r: Element) => Array.from(r.children).filter((c) => c.namespaceURI === NS.w && (c.localName === 't' || c.localName === 'delText')).map((c) => c.textContent).join('');

/** The run whose text holds `id`: in the main document first, then headers, footers, notes and comments. */
export function runOf(v: View, id: string): Element | undefined {
  return v.all(/^word\/document\.xml$/, 'w:r').find((r) => runText(r).includes(id))
    ?? v.all(TEXT_PARTS, 'w:r').find((r) => runText(r).includes(id));
}
/** The run properties of the run whose text holds `id`. */
export const rPrOf = (v: View, id: string) => kid(runOf(v, id), 'w:rPr');
/** The paragraph holding `id`. */
export const paraOf = (v: View, id: string) => up(runOf(v, id), 'w:p');
/** The paragraph properties of the paragraph holding `id`. */
export const pPrOf = (v: View, id: string) => kid(paraOf(v, id), 'w:pPr');
/** w:val of the element at `path` under `el`. */
export const val = (el: Element | undefined, path: string, attr = 'w:val') => at(kid(el, path), attr);
/** True when the on/off property at `path` is on (present without w:val, or w:val true/1/on). */
export const on = (el: Element | undefined, path: string) => { const k = kid(el, path); if (!k) return false; const x = at(k, 'w:val'); return x === null || x === '' || x === 'true' || x === '1' || x === 'on'; };
