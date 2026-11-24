/**
 * Builds the PowerPoint samplers' files (PresentationML, ECMA-376 Part 1 §19, with DrawingML §20)
 * and finds their items again: the presentation with one slide master and its layouts, the theme,
 * presProps, viewProps and tableStyles, a notes master when a slide has notes, and the slides with
 * whatever parts they add (pictures, sounds, charts, objects, comments).
 *
 * Chemweave writes a deck back from its model: part names, relationship ids, slide ids, shape ids
 * and placeholder indexes are all made anew. So items are found again only by the id in their text
 * or in their shape's name (cNvPr@name), never by part name or shape id.
 */
import { Pkg, REL, CT, NS, XML_HEAD, addProps, esc, kid, at, up, type View } from './kit';
import { themeXml, THEME_COLORS } from './theme';

// ---------------------------------------------------------------------------------------------
// Namespaces PowerPoint uses besides kit's

export const PNS = {
  p15: 'http://schemas.microsoft.com/office/powerpoint/2012/main',
  p159: 'http://schemas.microsoft.com/office/powerpoint/2015/09/main',
  p188: 'http://schemas.microsoft.com/office/powerpoint/2018/8/main',
  a16: 'http://schemas.microsoft.com/office/drawing/2014/main',
  c14: 'http://schemas.microsoft.com/office/drawing/2007/8/2/chart',
  dsp: 'http://schemas.microsoft.com/office/drawing/2008/diagram',
} as const;

/** The root namespaces of every slide, layout and master part, as PowerPoint 2016 writes them. */
export const P_NS = `xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}"`;
/** For the extension elements: declared where they are used, under mc:Ignorable. */
export const EXT_NS = `xmlns:mc="${NS.mc}" xmlns:p14="${NS.p14}" xmlns:a14="${NS.a14}" xmlns:p15="${PNS.p15}" mc:Ignorable="p14 a14 p15"`;

export const CTP = {
  ...CT,
  handoutMaster: 'application/vnd.openxmlformats-officedocument.presentationml.handoutMaster+xml',
  modernComments: 'application/vnd.ms-powerpoint.comments+xml',
  modernAuthors: 'application/vnd.ms-powerpoint.authors+xml',
  tags: 'application/vnd.openxmlformats-officedocument.presentationml.tags+xml',
};
export const RELP = {
  ...REL,
  tags: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/tags',
  handoutMaster: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/handoutMaster',
  modernComments: 'http://schemas.microsoft.com/office/2018/10/relationships/comments',
  modernAuthors: 'http://schemas.microsoft.com/office/2018/10/relationships/authors',
};

// ---------------------------------------------------------------------------------------------
// DrawingML pieces

/** EMU in a point. */
export const E = 12700;
/** A box in points: x, y, width, height. */
export type Box = [number, number, number, number];
const emu = (pt: number) => Math.round(pt * E);
export const off = (b: Box) => `<a:off x="${emu(b[0])}" y="${emu(b[1])}"/><a:ext cx="${emu(b[2])}" cy="${emu(b[3])}"/>`;
/** a:xfrm of a box (points), with attributes such as ` rot="1800000" flipH="1"`. */
export const xfrm = (b: Box, attrs = '') => `<a:xfrm${attrs}>${off(b)}</a:xfrm>`;
/** p:xfrm (a graphic frame's). */
export const pxfrm = (b: Box) => `<p:xfrm>${off(b)}</p:xfrm>`;
export const prst = (name: string, av = '') => `<a:prstGeom prst="${name}"><a:avLst>${av}</a:avLst></a:prstGeom>`;
export const gd = (name: string, fmla: string) => `<a:gd name="${name}" fmla="${fmla}"/>`;
export const rgb = (hex: string, mods = '') => (mods ? `<a:srgbClr val="${hex}">${mods}</a:srgbClr>` : `<a:srgbClr val="${hex}"/>`);
export const scheme = (v: string, mods = '') => (mods ? `<a:schemeClr val="${v}">${mods}</a:schemeClr>` : `<a:schemeClr val="${v}"/>`);
export const solid = (hex: string, mods = '') => `<a:solidFill>${rgb(hex, mods)}</a:solidFill>`;
export const NOFILL = '<a:noFill/>';
/** A line: width in points, its fill, and the rest of its children (dash, join, ends) in the schema's order. */
export const line = (w: number, fill = solid('1F3A4D'), rest = '', attrs = '') => `<a:ln w="${emu(w)}"${attrs}>${fill}${rest}</a:ln>`;

/** A run: its text and its a:rPr attributes and children (in the schema's order). */
export const r = (text: string, attrs = '', inner = '') => `<a:r><a:rPr${/lang=/.test(attrs) ? '' : ' lang="en-US"'}${attrs ? ' ' + attrs : ''}${inner ? `>${inner}</a:rPr>` : '/>'}<a:t>${esc(text)}</a:t></a:r>`;
/** A paragraph: its runs (or text: one plain run) and its a:pPr attributes and children. */
export const para = (runs: string, attrs = '', inner = '') => {
  const body = runs.startsWith('<') ? runs : r(runs);
  const pPr = attrs || inner ? `<a:pPr${attrs ? ' ' + attrs : ''}${inner ? `>${inner}</a:pPr>` : '/>'}` : '';
  return `<a:p>${pPr}${body}</a:p>`;
};
/** p:txBody: paragraphs, with a:bodyPr (whole element) and a:lstStyle's contents. */
export const txBody = (paras: string, bodyPr = '<a:bodyPr wrap="square" rtlCol="0"><a:spAutoFit/></a:bodyPr>', lst = '') => `<p:txBody>${bodyPr}${lst ? `<a:lstStyle>${lst}</a:lstStyle>` : '<a:lstStyle/>'}${paras}</p:txBody>`;

export interface SpOpts {
  id: number;
  name: string;
  descr?: string;
  hidden?: boolean;
  /** cNvPr's children: hlinkClick, hlinkHover. */
  links?: string;
  txBox?: boolean;
  /** p:nvPr's contents: p:ph, media. */
  nvPr?: string;
  /** p:cNvSpPr's contents (spLocks). */
  locks?: string;
  box?: Box | null;
  xfrmAttrs?: string;
  /** The geometry (rect when not given). */
  geom?: string;
  /** Fill, line, effects, scene3d and sp3d, in the schema's order. */
  fmt?: string;
  style?: string;
  body?: string;
  attrs?: string;
}

const cNvPr = (o: { id: number; name: string; descr?: string; hidden?: boolean; links?: string }) =>
  `<p:cNvPr id="${o.id}" name="${esc(o.name)}"${o.descr ? ` descr="${esc(o.descr)}"` : ''}${o.hidden ? ' hidden="1"' : ''}${o.links ? `>${o.links}</p:cNvPr>` : '/>'}`;

/** p:sp. */
export function sp(o: SpOpts): string {
  const spPr = o.box === null && !o.geom && !o.fmt ? '<p:spPr/>' : `<p:spPr>${o.box ? xfrm(o.box, o.xfrmAttrs) : ''}${o.geom ?? (o.box === null ? '' : prst('rect'))}${o.fmt ?? ''}</p:spPr>`;
  return `<p:sp${o.attrs ?? ''}><p:nvSpPr>${cNvPr(o)}<p:cNvSpPr${o.txBox ? ' txBox="1"' : ''}${o.locks ? `>${o.locks}</p:cNvSpPr>` : '/>'}<p:nvPr>${o.nvPr ?? ''}</p:nvPr></p:nvSpPr>${spPr}${o.style ?? ''}${o.body ?? ''}</p:sp>`;
}

/** A text box holding paragraphs (its id is in the first paragraph). */
export const textBox = (id: number, name: string, box: Box, paras: string, bodyPr?: string, fmt = NOFILL, lst = '', xfrmAttrs = '') =>
  sp({ id, name, txBox: true, box, xfrmAttrs, fmt, body: txBody(paras, bodyPr, lst) });

/** p:pic. */
export function pic(o: { id: number; name: string; descr?: string; links?: string; rid: string; box: Box; blip?: string; blipExt?: string; srcRect?: string; fillMode?: string; xfrmAttrs?: string; geom?: string; fmt?: string; nvPr?: string; locks?: string; embedAttr?: string }): string {
  const blip = `<a:blip r:${o.embedAttr ?? 'embed'}="${o.rid}"${o.blip || o.blipExt ? `>${o.blip ?? ''}${o.blipExt ? `<a:extLst>${o.blipExt}</a:extLst>` : ''}</a:blip>` : '/>'}`;
  return `<p:pic><p:nvPicPr>${cNvPr(o)}<p:cNvPicPr>${o.locks ?? '<a:picLocks noChangeAspect="1"/>'}</p:cNvPicPr><p:nvPr>${o.nvPr ?? ''}</p:nvPr></p:nvPicPr>`
    + `<p:blipFill>${blip}${o.srcRect ?? ''}${o.fillMode ?? '<a:stretch><a:fillRect/></a:stretch>'}</p:blipFill>`
    + `<p:spPr>${xfrm(o.box, o.xfrmAttrs)}${o.geom ?? prst('rect')}${o.fmt ?? ''}</p:spPr></p:pic>`;
}

/** p:cxnSp: a connector from its box's top left to its bottom right (flips turn it). */
export function cxn(o: { id: number; name: string; box: Box; geom?: string; fmt?: string; st?: [number, number]; end?: [number, number]; xfrmAttrs?: string }): string {
  const c = (tag: string, v?: [number, number]) => (v ? `<a:${tag} id="${v[0]}" idx="${v[1]}"/>` : '');
  return `<p:cxnSp><p:nvCxnSpPr>${cNvPr(o)}<p:cNvCxnSpPr>${c('stCxn', o.st)}${c('endCxn', o.end)}</p:cNvCxnSpPr><p:nvPr/></p:nvCxnSpPr>`
    + `<p:spPr>${xfrm(o.box, o.xfrmAttrs)}${o.geom ?? prst('line')}${o.fmt ?? line(1.5)}</p:spPr></p:cxnSp>`;
}

/** p:grpSp with its children laid out in a child space equal to its box (unless `chBox` is given). */
export function grp(o: { id: number; name: string; box: Box; chBox?: Box; kids: string; xfrmAttrs?: string; fmt?: string; descr?: string }): string {
  const ch = o.chBox ?? o.box;
  return `<p:grpSp><p:nvGrpSpPr>${cNvPr(o)}<p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm${o.xfrmAttrs ?? ''}>${off(o.box)}<a:chOff x="${emu(ch[0])}" y="${emu(ch[1])}"/><a:chExt cx="${emu(ch[2])}" cy="${emu(ch[3])}"/></a:xfrm>${o.fmt ?? ''}</p:grpSpPr>${o.kids}</p:grpSp>`;
}

/** p:graphicFrame holding graphicData of `uri`. */
export function frame(o: { id: number; name: string; descr?: string; box: Box; uri: string; data: string; locks?: string; nvPr?: string }): string {
  return `<p:graphicFrame><p:nvGraphicFramePr>${cNvPr(o)}<p:cNvGraphicFramePr>${o.locks ?? ''}</p:cNvGraphicFramePr><p:nvPr>${o.nvPr ?? ''}</p:nvPr></p:nvGraphicFramePr>`
    + `${pxfrm(o.box)}<a:graphic><a:graphicData uri="${o.uri}">${o.data}</a:graphicData></a:graphic></p:graphicFrame>`;
}

// ---------------------------------------------------------------------------------------------
// The deck

/** What a slide's builder can do: number its shapes, relate parts, and lay items out on a grid. */
export interface SlideCtx {
  pkg: Pkg;
  /** This slide's part name (ppt/slides/slideN.xml). */
  path: string;
  /** The next shape id; with a name, remembered so `spid(name)` finds it. */
  id(name?: string): number;
  spid(name: string): number;
  rel(type: string, target: string, external?: boolean): string;
  /** Add a part under ppt/ (path relative to ppt/) and relate this slide to it. */
  part(path: string, data: string | Uint8Array, contentType: string | undefined, relType: string): string;
  /** Add a file to ppt/media and relate it. */
  media(name: string, bytes: Uint8Array, relType?: string): string;
  /** The next cell of a cols × rows grid over the slide (call `grid` first to set it). */
  cell(): Box;
  grid(cols: number, rows: number, top?: number): void;
}

export interface SlideDef {
  /** The shapes on it (after the spTree's own group properties). */
  body(s: SlideCtx): string;
  /** The layout it uses (index into the deck's layouts; Blank when not given). */
  layout?: number;
  /** p:sld attributes, such as ` show="0"` or ` showMasterSp="0"`. */
  attrs?: string;
  /** cSld's name. */
  name?: string;
  bg?: string | ((s: SlideCtx) => string);
  /** What comes after cSld: clrMapOvr (masterClrMapping when not given). */
  clrMapOvr?: string;
  transition?: string | ((s: SlideCtx) => string);
  timing?(s: SlideCtx): string;
  /** p:sld's extLst contents. */
  ext?(s: SlideCtx): string;
  /** The speaker notes' paragraphs (a:p…). */
  notes?: string;
  /** Legacy comments (p:cm elements) on this slide. */
  comments?: string;
}

export interface LayoutDef {
  name: string;
  /** ST_SlideLayoutType; none for a custom layout. */
  type?: string;
  /** The layout's shapes (placeholders and art). */
  shapes: string;
  /** p:sldLayout attributes besides type. */
  attrs?: string;
  clrMapOvr?: string;
  bg?: string;
}

export interface DeckDef {
  title: string;
  /** p:notesSz in EMU (portrait Letter-ish 7.5 × 10 in when not given). */
  notesSz?: { cx: number; cy: number };
  /** Slide size in EMU, and its type (p:sldSz). */
  size?: { cx: number; cy: number; type?: string };
  slides: SlideDef[];
  layouts?: LayoutDef[];
  /** The master's art (non-placeholder shapes), after its placeholders. */
  masterArt?: string;
  masterBg?: string;
  /** The master's p:hf. */
  masterHf?: string;
  txStyles?: string;
  /** p:presentation attributes. */
  presAttrs?: string;
  /** p:custShowLst and the like, given the slides' relationship ids from presentation.xml. */
  custShows?(rids: string[]): string;
  /** presentation.xml's extLst contents, given the slides' ids (p:sldId@id). */
  presExt?(ids: number[]): string;
  defaultTextStyle?: string;
  /** The presentation's own tags (p:tag elements), in a tags part named by its custDataLst. */
  presTags?: string;
  /** p:presentationPr's contents. */
  presProps?: string;
  /** p:viewPr's contents. */
  viewProps?: string;
  /** a:tblStyleLst's contents. */
  tableStyles?: string;
  /** Extra package setup (custom XML, tags): called with the package. */
  extra?(pkg: Pkg): void;
}

export const SLIDE_W = 960, SLIDE_H = 540;

const GRP_PR = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
export const CLR_MAP = 'bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"';
const MASTER_MAP = '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>';

/** A placeholder shape: `ph` is p:ph's attributes; with a box it has its own position. */
export const ph = (id: number, name: string, phAttrs: string, box: Box | null, body?: string, fmt?: string) =>
  sp({ id, name, nvPr: `<p:ph ${phAttrs}/>`, locks: '<a:spLocks noGrp="1"/>', box, geom: box ? prst('rect') : undefined, fmt, body });

const emptyBody = (text: string) => txBody(para(r(text)), '<a:bodyPr/>');

/** The master's placeholders: title, body, date, footer and slide number. */
const MASTER_PH = ph(2, 'Title Placeholder 1', 'type="title"', [66, 29, 828, 105], txBody(para(r('Click to edit Master title style')), '<a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0" anchor="ctr"><a:normAutofit/></a:bodyPr>'))
  + ph(3, 'Text Placeholder 2', 'type="body" idx="1"', [66, 144, 828, 344], txBody(
    para(r('Click to edit Master text styles'), 'lvl="0"') + para(r('Second level'), 'lvl="1"') + para(r('Third level'), 'lvl="2"') + para(r('Fourth level'), 'lvl="3"') + para(r('Fifth level'), 'lvl="4"'),
    '<a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0"><a:normAutofit/></a:bodyPr>'))
  + ph(4, 'Date Placeholder 3', 'type="dt" sz="half" idx="2"', [66, 500, 216, 29], txBody('<a:p><a:fld id="{B1C3A6E2-5B5F-4C2E-9E7B-2C2C7A4B1D01}" type="datetimeFigureOut"><a:rPr lang="en-US"/><a:t>1/1/2026</a:t></a:fld><a:endParaRPr lang="en-US"/></a:p>', '<a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0" anchor="ctr"/>'))
  + ph(5, 'Footer Placeholder 4', 'type="ftr" sz="quarter" idx="3"', [318, 500, 324, 29], txBody('<a:p><a:endParaRPr lang="en-US"/></a:p>', '<a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0" anchor="ctr"/>'))
  + ph(6, 'Slide Number Placeholder 5', 'type="sldNum" sz="quarter" idx="4"', [678, 500, 216, 29], txBody('<a:p><a:pPr algn="r"/><a:fld id="{9C2C5E43-4A55-4E46-8A8B-6D2F35D7C001}" type="slidenum"><a:rPr lang="en-US"/><a:t>‹#›</a:t></a:fld><a:endParaRPr lang="en-US"/></a:p>', '<a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0" anchor="ctr"/>'));

const lvl = (n: number, mar: number, sz: number, bu: string) => `<a:lvl${n}pPr marL="${mar}" indent="-228600" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:lnSpc><a:spcPct val="90000"/></a:lnSpc><a:spcBef><a:spcPts val="1000"/></a:spcBef>${bu}<a:defRPr sz="${sz}" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl${n}pPr>`;
const BU = '<a:buFont typeface="Arial" panose="020B0604020202020204" pitchFamily="34" charset="0"/><a:buChar char="•"/>';
export const TX_STYLES = '<p:txStyles><p:titleStyle><a:lvl1pPr algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:lnSpc><a:spcPct val="90000"/></a:lnSpc><a:spcBef><a:spcPct val="0"/></a:spcBef><a:buNone/><a:defRPr sz="4400" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mj-lt"/><a:ea typeface="+mj-ea"/><a:cs typeface="+mj-cs"/></a:defRPr></a:lvl1pPr></p:titleStyle>'
  + `<p:bodyStyle>${lvl(1, 228600, 2800, BU)}${lvl(2, 685800, 2400, BU)}${lvl(3, 1143000, 2000, BU)}${lvl(4, 1600200, 1800, BU)}${lvl(5, 2057400, 1800, BU)}</p:bodyStyle>`
  + '<p:otherStyle><a:defPPr><a:defRPr lang="en-US"/></a:defPPr><a:lvl1pPr marL="0" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1800" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl1pPr></p:otherStyle></p:txStyles>';

export const DEFAULT_TEXT_STYLE = '<p:defaultTextStyle><a:defPPr><a:defRPr lang="en-US"/></a:defPPr><a:lvl1pPr marL="0" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1800" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl1pPr></p:defaultTextStyle>';

/** The layouts every sampler deck has: Title Slide, Title and Content, Title Only, Blank (the default). */
export const STD_LAYOUTS: LayoutDef[] = [
  { name: 'Title Slide', type: 'title', attrs: ' preserve="1"', shapes: ph(2, 'Title 1', 'type="ctrTitle"', [120, 88, 720, 188], emptyBody('Click to edit Master title style')) + ph(3, 'Subtitle 2', 'type="subTitle" idx="1"', [120, 284, 720, 130], emptyBody('Click to edit Master subtitle style')) },
  { name: 'Title and Content', type: 'obj', attrs: ' preserve="1"', shapes: ph(2, 'Title 1', 'type="title"', null, emptyBody('Click to edit Master title style')) + ph(3, 'Content Placeholder 2', 'idx="1"', null, emptyBody('Click to edit Master text styles')) },
  { name: 'Title Only', type: 'titleOnly', attrs: ' preserve="1"', shapes: ph(2, 'Title 1', 'type="title"', null, emptyBody('Click to edit Master title style')) },
  { name: 'Blank', type: 'blank', attrs: ' preserve="1"', shapes: '' },
];
export const BLANK = 3;

const NOTES_MASTER = `${XML_HEAD}<p:notesMaster ${P_NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${GRP_PR}`
  + ph(2, 'Header Placeholder 1', 'type="hdr" sz="quarter"', [0, 0, 297, 50], emptyBody(''))
  + ph(3, 'Date Placeholder 2', 'type="dt" idx="1"', [388, 0, 297, 50], emptyBody(''))
  + sp({ id: 4, name: 'Slide Image Placeholder 3', nvPr: '<p:ph type="sldImg" idx="2"/>', locks: '<a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/>', box: [72, 72, 540, 304], fmt: `${NOFILL}${line(1, solid('000000'))}` })
  + ph(5, 'Notes Placeholder 4', 'type="body" sz="quarter" idx="3"', [68, 412, 549, 432], emptyBody('Click to edit Master text styles'))
  + ph(6, 'Footer Placeholder 5', 'type="ftr" sz="quarter" idx="4"', [0, 870, 297, 50], emptyBody(''))
  + ph(7, 'Slide Number Placeholder 6', 'type="sldNum" sz="quarter" idx="5"', [388, 870, 297, 50], emptyBody(''))
  + `</p:spTree></p:cSld><p:clrMap ${CLR_MAP}/><p:notesStyle><a:lvl1pPr marL="0" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1200" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl1pPr></p:notesStyle></p:notesMaster>`;

/** A PowerPoint file of this deck. */
export function deckFile(d: DeckDef): Uint8Array {
  const pkg = new Pkg();
  const P = 'ppt/presentation.xml';
  pkg.rel('', REL.officeDocument, P);
  addProps(pkg, d.title, 'Chemweave sampler');
  const layouts = d.layouts ?? STD_LAYOUTS;
  // master, theme, layouts
  const M = 'ppt/slideMasters/slideMaster1.xml';
  const mRid = pkg.rel(P, REL.slideMaster, 'slideMasters/slideMaster1.xml');
  const layoutIds: string[] = [];
  layouts.forEach((l, k) => {
    const path = `ppt/slideLayouts/slideLayout${k + 1}.xml`;
    pkg.rel(path, REL.slideMaster, '../slideMasters/slideMaster1.xml');
    layoutIds.push(`<p:sldLayoutId id="${2147483649 + k}" r:id="${pkg.rel(M, REL.slideLayout, `../slideLayouts/slideLayout${k + 1}.xml`)}"/>`);
    pkg.add(path, `${XML_HEAD}<p:sldLayout ${P_NS}${l.type ? ` type="${l.type}"` : ''}${l.attrs ?? ''}><p:cSld name="${esc(l.name)}">${l.bg ?? ''}<p:spTree>${GRP_PR}${l.shapes}</p:spTree></p:cSld>${l.clrMapOvr ?? MASTER_MAP}</p:sldLayout>`, CT.slideLayout);
  });
  pkg.rel(M, REL.theme, '../theme/theme1.xml');
  pkg.add('ppt/theme/theme1.xml', themeXml(), CT.theme);
  pkg.add(M, `${XML_HEAD}<p:sldMaster ${P_NS}><p:cSld>${d.masterBg ?? '<p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>'}<p:spTree>${GRP_PR}${MASTER_PH}${d.masterArt ?? ''}</p:spTree></p:cSld>`
    + `<p:clrMap ${CLR_MAP}/><p:sldLayoutIdLst>${layoutIds.join('')}</p:sldLayoutIdLst>${d.masterHf ?? ''}${d.txStyles ?? TX_STYLES}</p:sldMaster>`, CT.slideMaster);

  // notes master, when a slide has notes
  let notesMasterLst = '';
  if (d.slides.some((s) => s.notes)) {
    const NM = 'ppt/notesMasters/notesMaster1.xml';
    notesMasterLst = `<p:notesMasterIdLst><p:notesMasterId r:id="${pkg.rel(P, REL.notesMaster, 'notesMasters/notesMaster1.xml')}"/></p:notesMasterIdLst>`;
    pkg.rel(NM, REL.theme, '../theme/theme2.xml');
    pkg.add('ppt/theme/theme2.xml', themeXml('Sampler Notes'), CT.theme);
    pkg.add(NM, NOTES_MASTER, CT.notesMaster);
  }
  // legacy comment authors, when a slide has comments
  if (d.slides.some((s) => s.comments)) {
    pkg.rel(P, REL.commentAuthors, 'commentAuthors.xml');
    pkg.add('ppt/commentAuthors.xml', `${XML_HEAD}<p:cmAuthorLst ${P_NS}><p:cmAuthor id="1" name="Sampler Author" initials="SA" lastIdx="9" clrIdx="0"/><p:cmAuthor id="2" name="Second Reviewer" initials="SR" lastIdx="9" clrIdx="1"/></p:cmAuthorLst>`, CT.commentAuthors);
  }

  // slides
  const size = d.size ?? { cx: 12192000, cy: 6858000 };
  const W = size.cx / E, H = size.cy / E;
  const sldRids: string[] = [];
  const sldIds: number[] = [];
  let commentN = 0;
  d.slides.forEach((def, k) => {
    const path = `ppt/slides/slide${k + 1}.xml`;
    const rid = pkg.rel(P, REL.slide, `slides/slide${k + 1}.xml`);
    sldRids.push(rid);
    sldIds.push(256 + k);
    pkg.rel(path, REL.slideLayout, `../slideLayouts/slideLayout${(def.layout ?? BLANK) + 1}.xml`);
    let next = 2;
    const names = new Map<string, number>();
    let g = { cols: 4, rows: 6, top: 20, n: 0 };
    const s: SlideCtx = {
      pkg, path,
      id: (name) => { const n = next++; if (name) names.set(name, n); return n; },
      spid: (name) => { const n = names.get(name); if (n === undefined) throw new Error(`no shape ${name}`); return n; },
      rel: (type, target, external = false) => pkg.rel(path, type, target, external),
      part: (p, data, ct, relType) => { pkg.add(`ppt/${p}`, data, ct); return pkg.rel(path, relType, `../${p}`); },
      media: (name, bytes, relType = REL.image) => { pkg.add(`ppt/media/${name}`, bytes); return pkg.rel(path, relType, `../media/${name}`); },
      grid: (cols, rows, top = 20) => { g = { cols, rows, top, n: 0 }; },
      cell: () => {
        const w = (W - 40) / g.cols, h = (H - g.top - 10) / g.rows;
        const c = g.n % g.cols, rw = Math.floor(g.n / g.cols) % g.rows;
        g.n++;
        return [20 + c * w + 4, g.top + rw * h + 3, w - 8, h - 6];
      },
    };
    const body = def.body(s);
    const bg = typeof def.bg === 'function' ? def.bg(s) : def.bg ?? '';
    const transition = typeof def.transition === 'function' ? def.transition(s) : def.transition ?? '';
    const timing = def.timing ? def.timing(s) : '';
    const ext = def.ext ? def.ext(s) : '';
    if (def.notes) {
      const N = `ppt/notesSlides/notesSlide${k + 1}.xml`;
      pkg.rel(N, REL.notesMaster, '../notesMasters/notesMaster1.xml');
      pkg.rel(N, REL.slide, `../slides/slide${k + 1}.xml`);
      s.rel(REL.notesSlide, `../notesSlides/notesSlide${k + 1}.xml`);
      pkg.add(N, `${XML_HEAD}<p:notes ${P_NS}><p:cSld><p:spTree>${GRP_PR}`
        + sp({ id: 2, name: 'Slide Image Placeholder 1', nvPr: '<p:ph type="sldImg"/>', locks: '<a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/>', box: null })
        + ph(3, 'Notes Placeholder 2', 'type="body" idx="1"', null, txBody(def.notes, '<a:bodyPr/>'))
        + `</p:spTree></p:cSld>${MASTER_MAP}</p:notes>`, CT.notesSlide);
    }
    if (def.comments) {
      commentN++;
      s.rel(REL.comments, `../comments/comment${commentN}.xml`);
      pkg.add(`ppt/comments/comment${commentN}.xml`, `${XML_HEAD}<p:cmLst ${P_NS}>${def.comments}</p:cmLst>`, CT.pptComments);
    }
    pkg.add(path, `${XML_HEAD}<p:sld ${P_NS}${def.attrs ?? ''}><p:cSld${def.name ? ` name="${esc(def.name)}"` : ''}>${bg}<p:spTree>${GRP_PR}${body}</p:spTree></p:cSld>`
      + `${def.clrMapOvr ?? MASTER_MAP}${transition}${timing}${ext ? `<p:extLst>${ext}</p:extLst>` : ''}</p:sld>`, CT.slide);
  });

  // presentation, its properties, view and table styles
  pkg.rel(P, REL.presProps, 'presProps.xml');
  pkg.add('ppt/presProps.xml', `${XML_HEAD}<p:presentationPr ${P_NS}>${d.presProps ?? ''}</p:presentationPr>`, CT.presProps);
  pkg.rel(P, REL.viewProps, 'viewProps.xml');
  pkg.add('ppt/viewProps.xml', `${XML_HEAD}<p:viewPr ${P_NS}>${d.viewProps ?? '<p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="94660"/></p:normalViewPr><p:gridSpacing cx="76200" cy="76200"/>'}</p:viewPr>`, CT.viewProps);
  pkg.rel(P, REL.theme, 'theme/theme1.xml');
  pkg.rel(P, REL.tableStyles, 'tableStyles.xml');
  pkg.add('ppt/tableStyles.xml', `${XML_HEAD}<a:tblStyleLst xmlns:a="${NS.a}" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}">${d.tableStyles ?? ''}</a:tblStyleLst>`, CT.tableStyles);
  const presExt = d.presExt ? d.presExt(sldIds) : '';
  let custData = '';
  if (d.presTags) {
    pkg.add('ppt/tags/tag1.xml', `${XML_HEAD}<p:tagLst ${P_NS}>${d.presTags}</p:tagLst>`, CTP.tags);
    custData = `<p:custDataLst><p:tags r:id="${pkg.rel(P, RELP.tags, 'tags/tag1.xml')}"/></p:custDataLst>`;
  }
  pkg.add(P, `${XML_HEAD}<p:presentation ${P_NS}${d.presAttrs ?? ' saveSubsetFonts="1"'}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="${mRid}"/></p:sldMasterIdLst>${notesMasterLst}`
    + `<p:sldIdLst>${sldIds.map((id, k) => `<p:sldId id="${id}" r:id="${sldRids[k]}"/>`).join('')}</p:sldIdLst>`
    + `<p:sldSz cx="${size.cx}" cy="${size.cy}"${size.type ? ` type="${size.type}"` : ''}/><p:notesSz cx="${d.notesSz?.cx ?? 6858000}" cy="${d.notesSz?.cy ?? 9144000}"/>`
    + `${d.custShows ? d.custShows(sldRids) : ''}${custData}${d.defaultTextStyle ?? DEFAULT_TEXT_STYLE}${presExt ? `<p:extLst>${presExt}</p:extLst>` : ''}</p:presentation>`, CT.presentation);
  d.extra?.(pkg);
  return pkg.build();
}

// ---------------------------------------------------------------------------------------------
// Finding items again

export const SLIDES = /^ppt\/slides\/slide\d+\.xml$/;
export const LAYOUTS = /^ppt\/slideLayouts\/slideLayout\d+\.xml$/;
export const MASTERS = /^ppt\/slideMasters\/slideMaster\d+\.xml$/;
export const NOTES = /^ppt\/notesSlides\/notesSlide\d+\.xml$/;

const SHAPES = ['sp', 'pic', 'cxnSp', 'graphicFrame', 'grpSp'];

/** A shape's own cNvPr (not one of its children's). */
export function cNvPrOf(el: Element | undefined): Element | undefined {
  const nv = el ? Array.from(el.children).find((c) => c.localName.startsWith('nv')) : undefined;
  return nv ? kid(nv, 'p:cNvPr') : undefined;
}
export const nameOf = (el: Element | undefined) => at(cNvPrOf(el), 'name') ?? '';

/** The text of a p:sp's own text body. */
const ownText = (el: Element) => kid(el, 'p:txBody')?.textContent ?? '';

/** The shape (sp, pic, cxnSp, graphicFrame or grpSp) in `parts` whose own text or name holds `id`. */
export function shapeOf(v: View, id: string, parts: RegExp = SLIDES): Element | undefined {
  const sps = v.all(parts, 'p:sp');
  const byText = sps.find((e) => ownText(e).includes(id));
  if (byText) return byText;
  for (const k of SHAPES) {
    const hit = v.all(parts, `p:${k}`).find((e) => nameOf(e).includes(id));
    if (hit) return hit;
  }
  return undefined;
}
/** The shape whose own name (not text) holds `id`. */
export function namedShape(v: View, id: string, parts: RegExp = SLIDES, kinds = SHAPES): Element | undefined {
  for (const k of kinds) {
    const hit = v.all(parts, `p:${k}`).find((e) => nameOf(e).includes(id));
    if (hit) return hit;
  }
  return undefined;
}
export const spPrOf = (el: Element | undefined) => kid(el, 'p:spPr') ?? kid(el, 'p:grpSpPr');
/** The a:r in `parts` whose text holds `id`. */
export function runOf(v: View, id: string, parts: RegExp = SLIDES): Element | undefined {
  return v.all(parts, 'a:r').find((e) => (kid(e, 'a:t')?.textContent ?? '').includes(id));
}
export const rPrOf = (v: View, id: string, parts: RegExp = SLIDES) => kid(runOf(v, id, parts), 'a:rPr');
/** The a:p in `parts` whose text holds `id`. */
export function paraOf(v: View, id: string, parts: RegExp = SLIDES): Element | undefined {
  return v.all(parts, 'a:p').find((e) => (e.textContent ?? '').includes(id));
}
export const pPrOf = (v: View, id: string, parts: RegExp = SLIDES) => kid(paraOf(v, id, parts), 'a:pPr');
/** The a:bodyPr of the text body holding `id`. */
export const bodyPrOf = (v: View, id: string, parts: RegExp = SLIDES) => {
  const p = paraOf(v, id, parts);
  const tb = p?.parentElement;
  return tb ? kid(tb, 'a:bodyPr') : undefined;
};
/** The part (of `parts`) whose XML holds `id`. */
export function partOf(v: View, id: string, parts: RegExp = SLIDES): string | undefined {
  return v.partsLike(parts).find((p) => v.parts[p].includes(id));
}
/** The root element of the slide holding `id`. */
export const slideRoot = (v: View, id: string) => { const p = partOf(v, id); return p ? v.doc(p)!.documentElement : undefined; };
/** The target part (full name) of `part`'s first relationship of `type` / with id `rid`. */
export function relTarget(v: View, part: string, rid: string): string | undefined {
  const t = v.target(part, rid);
  if (!t) return undefined;
  if (/^[a-z]+:/i.test(t)) return t;
  const dir = part.slice(0, part.lastIndexOf('/'));
  const segs = (t.startsWith('/') ? t.slice(1) : `${dir}/${t}`).split('/');
  const out: string[] = [];
  for (const s of segs) { if (s === '..') out.pop(); else if (s !== '.') out.push(s); }
  return out.join('/');
}
/** The relationships of `part` of this type, as [id, target, targetMode]. */
export function relsOf(v: View, part: string, type?: string): { id: string; type: string; target: string; external: boolean }[] {
  const dir = part.includes('/') ? part.slice(0, part.lastIndexOf('/') + 1) : '';
  const d = v.doc(`${dir}_rels/${part.slice(dir.length)}.rels`);
  if (!d) return [];
  return Array.from(d.getElementsByTagNameNS(NS.rels, 'Relationship'))
    .map((e) => ({ id: e.getAttribute('Id') ?? '', type: e.getAttribute('Type') ?? '', target: e.getAttribute('Target') ?? '', external: e.getAttribute('TargetMode') === 'External' }))
    .filter((x) => !type || x.type === type);
}
/** The slide part an element is in. */
export function partOfEl(v: View, el: Element): string | undefined {
  const d = el.ownerDocument;
  return Object.keys(v.parts).find((p) => v.doc(p) === d);
}
/** The first descendant in namespace `ns` named `local`. */
export const findNs = (el: Element | undefined | null, ns: string, local: string) => (el ? el.getElementsByTagNameNS(ns, local)[0] : undefined);
/** Every descendant in namespace `ns` named `local`. */
export const allNs = (el: Element | undefined | null, ns: string, local: string) => (el ? Array.from(el.getElementsByTagNameNS(ns, local)) : []);
/** EMU to points, rounded to 0.1 pt. */
export const pt = (v: string | null | undefined) => Math.round((Number(v ?? NaN) / E) * 10) / 10;
/** The xfrm box of a shape, in points. */
export function boxOf(el: Element | undefined): Box | undefined {
  const x = kid(spPrOf(el), 'a:xfrm') ?? kid(el, 'p:xfrm');
  const o = kid(x, 'a:off'), e = kid(x, 'a:ext');
  if (!o || !e) return undefined;
  return [pt(at(o, 'x')), pt(at(o, 'y')), pt(at(e, 'cx')), pt(at(e, 'cy'))];
}
/** The color value (srgbClr/schemeClr val) under `el` (a fill, a line…). */
export const clrOf = (el: Element | undefined) => {
  const c = el ? Array.from(el.getElementsByTagNameNS(NS.a, '*')).find((x) => /Clr$/.test(x.localName)) : undefined;
  return c ? (at(c, 'val') ?? '').toUpperCase() : '';
};
export { up, kid, at };

/** The slides in show order: each slide's part and its p:sldId@id. */
export function slideOrder(v: View): { part: string; sldId: string }[] {
  const P = 'ppt/presentation.xml';
  const root = v.doc(P)?.documentElement;
  const lst = kid(root, 'p:sldIdLst');
  return Array.from(lst?.children ?? []).map((s) => ({ part: relTarget(v, P, at(s, 'r:id') ?? '') ?? '', sldId: at(s, 'id') ?? '' }));
}
/** The place (0-based) in show order of the slide holding `id`, or -1. */
export const slideIndex = (v: View, id: string) => { const p = partOf(v, id); return slideOrder(v).findIndex((s) => s.part === p); };
/** The layout part of a slide part. */
export const layoutPartOf = (v: View, slide: string | undefined) => (slide ? relsOf(v, slide, REL.slideLayout).map((x) => relTarget(v, slide, x.id))[0] : undefined);
/** The root of the layout of the slide holding `id`. */
export const layoutOf = (v: View, id: string) => { const l = layoutPartOf(v, partOf(v, id)); return l ? v.doc(l)?.documentElement : undefined; };
/** The p:ph of a shape. */
export const phOf = (el: Element | undefined) => { const nv = el ? Array.from(el.children).find((c) => c.localName.startsWith('nv')) : undefined; return kid(kid(nv, 'p:nvPr'), 'p:ph'); };

/** True when the color element under `el` (srgbClr, or a theme color the sampler theme gives this value) is `hex`. */
export function colorIs(el: Element | undefined, hex: string): boolean {
  const c = el ? Array.from(el.children).find((x) => /Clr$/.test(x.localName)) : undefined;
  if (!c) return false;
  const v = (at(c, 'val') ?? '').toUpperCase();
  if (c.localName === 'srgbClr') return v === hex.toUpperCase();
  if (c.localName === 'schemeClr') return (THEME_COLORS as Record<string, string>)[v.toLowerCase().replace('bg1', 'lt1').replace('tx1', 'dk1').replace('bg2', 'lt2').replace('tx2', 'dk2')]?.toUpperCase() === hex.toUpperCase();
  return false;
}
