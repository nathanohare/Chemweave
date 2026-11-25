/**
 * Word sampler: sections, page setup, columns, breaks, headers and footers, and page numbers (W-SEC,
 * W-BRK). ECMA-376 Part 1 §17.6 (sections), §17.10 (headers and footers), §17.3.3.1 (br); Word's
 * Layout ▸ Page Setup, Layout ▸ Breaks, Insert ▸ Header/Footer/Page Number.
 *
 * Tags from src/io/docx-read.ts readHeaderFooter (:3331) and the section reader, and docx-write.ts
 * (:1756, :1769): page size (orientation from width and height), margins (gutter forced to 0), break
 * types, titlePg, evenAndOddHeaders, header and footer kinds, pgNumType fmt (decimal, roman and
 * letters) and start, lnNumType, notes' number formats; 2 to 4 equal columns (unequal widths become
 * equal, the separator and more than 4 are lost, :1118); page borders simplified to one style
 * (:3566); vAlign, docGrid, paperSrc and the gutter lost; textWrapping breaks lose `clear`.
 */
import { type Item, type Sampler, type View, itemList, at, kid, NS, REL, CT, png, XML_HEAD } from './kit';
import { wordFile, para, run, paraOf, val, on, W_NS, type WordCtx } from './word';

const items: Item[] = [];
const sec = itemList('W-SEC', items);
const brk = itemList('W-BRK', items);
type T = 'supported' | 'kept' | 'loss';
const LOREM = 'Text that fills the section so its page setup, columns and breaks can be seen. '.repeat(8);

/** The section properties that end the section holding `id`: the next paragraph's sectPr, else the body's. */
function sectOf(v: View, id: string): Element | undefined {
  let p = paraOf(v, id) ?? null;
  for (; p; p = p.nextElementSibling) {
    if (p.namespaceURI === NS.w && p.localName === 'p') { const s = kid(kid(p, 'w:pPr'), 'w:sectPr'); if (s) return s; }
    if (p.namespaceURI === NS.w && p.localName === 'sectPr') return p;
  }
  return v.all(/^word\/document\.xml$/, 'w:body')[0]?.getElementsByTagNameNS(NS.w, 'sectPr')[0] ? Array.from(v.all(/^word\/document\.xml$/, 'w:body')[0].children).find((c) => c.localName === 'sectPr') : undefined;
}
/** The text of the header or footer a section refers to by kind and type. */
function hfText(v: View, s: Element | undefined, kind: 'header' | 'footer', type: string): string {
  const ref = Array.from(s?.children ?? []).find((c) => c.localName === `${kind}Reference` && at(c, 'w:type') === type);
  const target = ref && v.target('word/document.xml', at(ref, 'r:id') ?? '');
  const part = target && (target.startsWith('/') ? target.slice(1) : `word/${target}`);
  return part ? v.doc(part)?.documentElement.textContent ?? '' : '';
}
/** The field instructions in a header or footer (simple and complex fields). */
function hfFields(v: View, s: Element | undefined, kind: 'header' | 'footer', type: string): string {
  const ref = Array.from(s?.children ?? []).find((c) => c.localName === `${kind}Reference` && at(c, 'w:type') === type);
  const target = ref && v.target('word/document.xml', at(ref, 'r:id') ?? '');
  const d = target ? v.doc(`word/${target}`) : undefined;
  if (!d) return '';
  return [...Array.from(d.getElementsByTagNameNS(NS.w, 'fldSimple')).map((f) => at(f, 'w:instr') ?? ''), ...Array.from(d.getElementsByTagNameNS(NS.w, 'instrText')).map((t) => t.textContent ?? '')].join(' ');
}

const field = (instr: string, shown: string) => `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ${instr} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${run(shown)}<w:r><w:fldChar w:fldCharType="end"/></w:r>`;

// ---------------------------------------------------------------------------------------------
// Items: each check reads the section (or header, footer) of the paragraph holding its id

interface Section { first: string; text: string; sect: (w: WordCtx) => string }
const sections: Section[] = [];
const hf: { kind: 'header' | 'footer'; type: string; xml: string }[][] = [];

// Section 1: Letter portrait, headers and footers of every kind, page numbers
const s1 = sec('Letter paper, portrait, one-inch margins', 'supported', '§17.6.13 pgSz, §17.6.11 pgMar; Layout ▸ Size, Margins', (v) => {
  const s = sectOf(v, s1);
  return at(kid(s, 'w:pgSz'), 'w:w') === '12240' && at(kid(s, 'w:pgSz'), 'w:h') === '15840' && at(kid(s, 'w:pgMar'), 'w:left') === '1440';
});
const hDefault = sec('Default header', 'supported', '§17.10.5 headerReference default; Insert ▸ Header', (v) => hfText(v, sectOf(v, s1), 'header', 'default').includes(hDefault));
const hFirst = sec('Different first page header', 'supported', '§17.10.6 titlePg; Header ▸ Different First Page', (v) => on(sectOf(v, s1), 'w:titlePg') && hfText(v, sectOf(v, s1), 'header', 'first').includes(hFirst));
const hEven = sec('Different odd and even pages header', 'supported', '§17.15.1.35 evenAndOddHeaders, §17.10.5 even', (v) => on(v.all(/^word\/settings\.xml$/, 'w:settings')[0], 'w:evenAndOddHeaders') && hfText(v, sectOf(v, s1), 'header', 'even').includes(hEven));
const fPage = sec('Footer with Page X of Y', 'supported', '§17.16.5.42 PAGE, §17.16.5.41 NUMPAGES; Insert ▸ Page Number', (v) => { const f = hfFields(v, sectOf(v, s1), 'footer', 'default'); return /\bPAGE\b/.test(f) && /\bNUMPAGES\b/.test(f) && hfText(v, sectOf(v, s1), 'footer', 'default').includes(fPage); });
const fFirst = sec('First page footer', 'supported', '§17.10.3 footerReference first', (v) => hfText(v, sectOf(v, s1), 'footer', 'first').includes(fFirst));
const fEven = sec('Even page footer', 'supported', '§17.10.3 footerReference even', (v) => hfText(v, sectOf(v, s1), 'footer', 'even').includes(fEven));
const hTab = sec('Header with center and right tab text', 'supported', '§17.3.1.37 tabs in a header', (v) => {
  // the text, and the center and right tab stops of the header paragraph that holds it
  const ref = Array.from(sectOf(v, s1)?.children ?? []).find((c) => c.localName === 'headerReference' && at(c, 'w:type') === 'default');
  const t = ref && v.target('word/document.xml', at(ref, 'r:id') ?? '');
  const p = t ? Array.from(v.doc(`word/${t}`)?.getElementsByTagNameNS(NS.w, 'p') ?? []).find((x) => (x.textContent ?? '').includes('right side')) : undefined;
  const tabs = Array.from(kid(kid(p, 'w:pPr'), 'w:tabs')?.children ?? []).map((x) => at(x, 'w:val'));
  return !!p && tabs.includes('center') && (tabs.includes('right') || tabs.includes('end'));
});
const hPic = sec('Picture in the header', 'kept', '§17.10.4 hdr with a drawing; Header ▸ Pictures', (v) => {
  const ref = Array.from(sectOf(v, s1)?.children ?? []).find((c) => c.localName === 'headerReference' && at(c, 'w:type') === 'default');
  const t = ref && v.target('word/document.xml', at(ref, 'r:id') ?? '');
  return !!t && (v.doc(`word/${t}`)?.getElementsByTagNameNS(NS.wp, 'inline').length ?? 0) > 0;
}, 'docx-read.ts WARN header/footer pictures; kept through a save in the 2026-11-24 run (tag set from that result)');
const pgStart = sec('Page numbers start at 3', 'supported', '§17.6.12 pgNumType@start; Page Number ▸ Format', (v) => at(kid(sectOf(v, s1), 'w:pgNumType'), 'w:start') === '3');
sections.push({ first: s1, text: [s1, hDefault, hFirst, hEven, fPage, fFirst, fEven, hTab, hPic, pgStart].join(', '), sect: () => '@HF@<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/><w:pgNumType w:start="3"/><w:cols w:space="720"/><w:titlePg/>' });
hf.push([
  { kind: 'header', type: 'default', xml: para(run(`${hDefault} default header`) + '<w:r><w:tab/></w:r>' + run(`${hTab} center`) + '<w:r><w:tab/></w:r>' + run('right side'), '<w:tabs><w:tab w:val="center" w:pos="4680"/><w:tab w:val="right" w:pos="9360"/></w:tabs>') + '@PIC@' },
  { kind: 'header', type: 'first', xml: para(run(`${hFirst} first page header`)) },
  { kind: 'header', type: 'even', xml: para(run(`${hEven} even page header`), '<w:jc w:val="right"/>') },
  { kind: 'footer', type: 'default', xml: para(run(`${fPage} Page `) + field('PAGE', '3') + run(' of ') + field('NUMPAGES', '9'), '<w:jc w:val="center"/>') },
  { kind: 'footer', type: 'first', xml: para(run(`${fFirst} first page footer`)) },
  { kind: 'footer', type: 'even', xml: para(run(`${fEven} even page footer `) + field('PAGE \\* roman', 'iv')) },
]);

// Section 2: next page, landscape, Roman page numbers, inherits section 1's headers
const s2 = sec('Section break (next page), landscape', 'supported', '§17.6.22 type nextPage, §17.6.13 pgSz@orient; Layout ▸ Orientation', (v) => {
  const s = sectOf(v, s2);
  return (val(s, 'w:type') ?? 'nextPage') === 'nextPage' && Number(at(kid(s, 'w:pgSz'), 'w:w')) > Number(at(kid(s, 'w:pgSz'), 'w:h'));
});
const orient = sec('Orientation attribute landscape', 'supported', '§17.6.13 pgSz@orient', (v) => at(kid(sectOf(v, s2), 'w:pgSz'), 'w:orient') === 'landscape', 'docx-write.ts:1756 (orient from width > height)');
const roman = sec('Page numbers i, ii, iii', 'supported', '§17.6.12 pgNumType@fmt lowerRoman', (v) => at(kid(sectOf(v, s2), 'w:pgNumType'), 'w:fmt') === 'lowerRoman');
const linked = sec('Header linked to previous section', 'supported', '§17.10.5 (no headerReference: the previous section\'s)', (v) => !Array.from(sectOf(v, s2)?.children ?? []).some((c) => c.localName === 'headerReference' && at(c, 'w:type') === 'default') || hfText(v, sectOf(v, s2), 'header', 'default').includes(hDefault));
const narrow = sec('Narrow margins 0.5 in', 'supported', '§17.6.11 pgMar; Margins ▸ Narrow', (v) => at(kid(sectOf(v, s2), 'w:pgMar'), 'w:top') === '720');
const noTitle = sec('No different first page in a later section', 'supported', '§17.10.6 titlePg (per section, not inherited)', (v) => !on(sectOf(v, s2), 'w:titlePg'));
sections.push({ first: s2, text: [s2, orient, roman, linked, narrow, noTitle].join(', '), sect: () => '<w:type w:val="nextPage"/><w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360" w:gutter="0"/><w:pgNumType w:fmt="lowerRoman" w:start="1"/><w:cols w:space="720"/>' });
hf.push([]);

// Section 3: continuous, two columns
const s3 = sec('Section break (continuous), two columns', 'supported', '§17.6.22 type continuous, §17.6.4 cols; Layout ▸ Columns ▸ Two', (v) => { const s = sectOf(v, s3); return val(s, 'w:type') === 'continuous' && at(kid(s, 'w:cols'), 'w:num') === '2'; });
const colSpace = sec('Column spacing 0.25 in', 'supported', '§17.6.4 cols@space', (v) => at(kid(sectOf(v, s3), 'w:cols'), 'w:space') === '360');
sections.push({ first: s3, text: [s3, colSpace].join(', '), sect: () => '<w:type w:val="continuous"/><w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360" w:gutter="0"/><w:cols w:num="2" w:space="360"/>' });
hf.push([]);

// Section 4: three unequal columns with a line between
const s4 = sec('Three columns', 'supported', '§17.6.4 cols@num', (v) => { const c = kid(sectOf(v, s4), 'w:cols'); return at(c, 'w:num') === '3' || c?.getElementsByTagNameNS(NS.w, 'col').length === 3; });
const unequal = sec('Unequal column widths', 'loss', '§17.6.3 col; Columns ▸ More Columns ▸ Equal column width off', (v) => at(kid(sectOf(v, s4), 'w:cols'), 'w:equalWidth') === '0' && Array.from(kid(sectOf(v, s4), 'w:cols')?.children ?? []).map((c) => at(c, 'w:w')).join() === '2160,4320,3240', 'docx-read.ts:1118 (made equal)');
const sep = sec('Line between columns', 'loss', '§17.6.4 cols@sep', (v) => ['1', 'true', 'on'].includes(at(kid(sectOf(v, s4), 'w:cols'), 'w:sep') ?? ''), 'docx-read.ts:1118');
sections.push({ first: s4, text: [s4, unequal, sep].join(', '), sect: () => '<w:type w:val="continuous"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/><w:cols w:num="3" w:sep="1" w:space="360" w:equalWidth="0"><w:col w:w="2160" w:space="360"/><w:col w:w="4320" w:space="360"/><w:col w:w="3240"/></w:cols>' });
hf.push([]);

// Section 5: even page, page borders, vertical center, line numbers
const s5 = sec('Section break (even page)', 'supported', '§17.6.22 type evenPage', (v) => val(sectOf(v, s5), 'w:type') === 'evenPage');
const pgBorder = sec('Page border box, double, 3 pt', 'supported', '§17.6.10 pgBorders; Design ▸ Page Borders', (v) => at(kid(kid(sectOf(v, s5), 'w:pgBorders'), 'w:top'), 'w:val') === 'double');
const pgBorderMixed = sec('Page border with different sides', 'loss', '§17.6.10 pgBorders (each side its own)', (v) => at(kid(kid(sectOf(v, s5), 'w:pgBorders'), 'w:left'), 'w:val') === 'dotted', 'docx-read.ts pageBorderOf (one style from the first side)');
const pgBorderArt = sec('Page border offset from page edge', 'loss', '§17.6.10 pgBorders@offsetFrom', (v) => at(kid(sectOf(v, s5), 'w:pgBorders'), 'w:offsetFrom') === 'page', 'docx-read.ts pageBorderOf');
const vCenter = sec('Vertical alignment center', 'loss', '§17.6.23 vAlign; Page Setup ▸ Layout ▸ Vertical alignment', (v) => val(sectOf(v, s5), 'w:vAlign') === 'center', 'section reader (vAlign not read)');
const lineNums = sec('Line numbers, continuous, every 5', 'supported', '§17.6.8 lnNumType; Layout ▸ Line Numbers', (v) => { const l = kid(sectOf(v, s5), 'w:lnNumType'); return at(l, 'w:countBy') === '5' && at(l, 'w:restart') === 'continuous'; });
sections.push({ first: s5, text: [s5, pgBorder, pgBorderMixed, pgBorderArt, vCenter, lineNums].join(', '), sect: () => '<w:type w:val="evenPage"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>'
  + '<w:pgBorders w:offsetFrom="page"><w:top w:val="double" w:sz="24" w:space="24" w:color="1B7F79"/><w:left w:val="dotted" w:sz="12" w:space="24" w:color="C8553D"/><w:bottom w:val="double" w:sz="24" w:space="24" w:color="1B7F79"/><w:right w:val="double" w:sz="24" w:space="24" w:color="1B7F79"/></w:pgBorders>'
  + '<w:lnNumType w:countBy="5" w:distance="360" w:restart="continuous"/><w:cols w:space="720"/><w:vAlign w:val="center"/>' });
hf.push([]);

// Section 6 (the last): odd page, A4, gutter, document grid, number format with dashes
const s6 = sec('Section break (odd page), A4 paper', 'supported', '§17.6.22 type oddPage, §17.6.13 pgSz', (v) => { const s = sectOf(v, s6); return val(s, 'w:type') === 'oddPage' && at(kid(s, 'w:pgSz'), 'w:w') === '11906' && at(kid(s, 'w:pgSz'), 'w:h') === '16838'; });
const gutter = sec('Gutter 0.5 in', 'loss', '§17.6.11 pgMar@gutter', (v) => at(kid(sectOf(v, s6), 'w:pgMar'), 'w:gutter') === '720', 'docx-write.ts:1769 (gutter written as 0)');
const grid = sec('Document grid lines and characters', 'loss', '§17.6.5 docGrid; Page Setup ▸ Document Grid', (v) => at(kid(sectOf(v, s6), 'w:docGrid'), 'w:type') === 'linesAndChars', 'docx-write.ts (docGrid rewritten as linePitch 360)');
const dash = sec('Page numbers - 1 -', 'loss', '§17.6.12 pgNumType@fmt numberInDash', (v) => at(kid(sectOf(v, s6), 'w:pgNumType'), 'w:fmt') === 'numberInDash', 'section reader (only decimal, roman and letters)');
const chapter = sec('Page numbers with chapter number', 'loss', '§17.6.12 pgNumType@chapStyle', (v) => at(kid(sectOf(v, s6), 'w:pgNumType'), 'w:chapStyle') === '1', 'section reader');
const paper = sec('Paper source first page tray', 'loss', '§17.6.9 paperSrc', (v) => at(kid(sectOf(v, s6), 'w:paperSrc'), 'w:first') === '1', 'section reader (paperSrc not read)');
const rtlSect = sec('Section right to left', 'loss', '§17.6.1 bidi (section)', (v) => on(sectOf(v, s6), 'w:bidi'), 'section reader');
sections.push({ first: s6, text: [s6, gutter, grid, dash, chapter, paper, rtlSect].join(', '), sect: () => '<w:type w:val="oddPage"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417" w:header="708" w:footer="708" w:gutter="720"/><w:paperSrc w:first="1" w:other="1"/>'
  + '<w:pgNumType w:fmt="numberInDash" w:chapStyle="1" w:chapSep="hyphen"/><w:cols w:space="708"/><w:bidi/><w:docGrid w:type="linesAndChars" w:linePitch="360" w:charSpace="4096"/>' });
hf.push([]);

// ---------------------------------------------------------------------------------------------
// Breaks inside the text (in section 1)

const brkBody: string[] = [];
const brItem = (feature: string, tag: T, spec: string, br: string, check: (v: View, id: string) => boolean, basis?: string) => {
  const id = brk(feature, tag, spec, (v) => check(v, id), basis);
  brkBody.push(para(run(`${id} ${feature}: before`) + br + run('after')));
};
const brIn = (v: View, id: string) => Array.from(paraOf(v, id)?.getElementsByTagNameNS(NS.w, 'br') ?? []);
brItem('Page break', 'supported', '§17.3.3.1 br type page; Insert ▸ Page Break', '<w:r><w:br w:type="page"/></w:r>', (v, id) => brIn(v, id).some((b) => at(b, 'w:type') === 'page'));
brItem('Column break', 'supported', '§17.3.3.1 br type column; Layout ▸ Breaks ▸ Column', '<w:r><w:br w:type="column"/></w:r>', (v) => v.all(/^word\/document\.xml$/, 'w:br').some((b) => at(b, 'w:type') === 'column'));
brItem('Line break (Shift+Enter)', 'supported', '§17.3.3.1 br textWrapping', '<w:r><w:br/></w:r>', (v, id) => brIn(v, id).some((b) => (at(b, 'w:type') ?? 'textWrapping') === 'textWrapping'));
brItem('Text wrapping break clearing both sides', 'loss', '§17.3.3.1 br@clear all; Layout ▸ Breaks ▸ Text Wrapping', '<w:r><w:br w:type="textWrapping" w:clear="all"/></w:r>', (v, id) => brIn(v, id).some((b) => at(b, 'w:clear') === 'all'), 'docx-read.ts (clear not read)');
brItem('Carriage return (cr)', 'supported', '§17.3.3.4 cr', '<w:r><w:cr/></w:r>', (v, id) => brIn(v, id).length > 0 || (paraOf(v, id)?.getElementsByTagNameNS(NS.w, 'cr').length ?? 0) > 0);
brItem('Absolute position tab', 'loss', '§17.3.3.23 ptab', '<w:r><w:ptab w:relativeTo="margin" w:alignment="right" w:leader="dot"/></w:r>', (v, id) => (paraOf(v, id)?.getElementsByTagNameNS(NS.w, 'ptab').length ?? 0) > 0, 'docx-read.ts (ptab becomes a tab)');

// ---------------------------------------------------------------------------------------------

export const docxSections: Sampler = {
  name: 'docx-sections.docx', area: 'Word sections, page setup, columns, breaks, headers, footers and page numbers', items,
  build: () => wordFile({
    title: 'Word sampler: sections',
    settings: '<w:defaultTabStop w:val="720"/><w:evenAndOddHeaders/><w:characterSpacingControl w:val="doNotCompress"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>',
    body: (w) => {
      // headers and footers of each section
      let n = 0;
      const refs = hf.map((list) => list.map((h) => {
        n++;
        let xml = h.xml;
        if (xml.includes('@PIC@')) {
          w.pkg.add('word/media/header.png', png(48, 24, [27, 127, 121]));
          const rid = w.relFrom(`${h.kind}${n}.xml`, REL.image, 'media/header.png');
          xml = xml.replace('@PIC@', para(`<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="457200" cy="228600"/><wp:docPr id="${900 + n}" name="Header picture ${hPic}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="header.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="457200" cy="228600"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>` + run(` ${hPic} header picture`)));
        }
        const root = h.kind === 'header' ? 'w:hdr' : 'w:ftr';
        const rid = w.part(`${h.kind}${n}.xml`, `${XML_HEAD}<${root} ${W_NS}>${xml}</${root}>`, h.kind === 'header' ? CT.header : CT.footer, h.kind === 'header' ? REL.header : REL.footer);
        return `<w:${h.kind}Reference w:type="${h.type}" r:id="${rid}"/>`;
      }));
      // headerReference elements come first, all headers before footers is not required (§17.6.17: a choice)
      const out: string[] = [];
      sections.forEach((s, i) => {
        const sect = s.sect(w).replace('@HF@', refs[i].join(''));
        const paras = [para(run(`${s.text}. `) + run(LOREM))];
        if (i === 0) paras.push(...brkBody, para(run(LOREM)));
        else paras.push(para(run(LOREM)));
        if (i < sections.length - 1) {
          const last = paras.pop()!;
          paras.push(last.replace(/^<w:p>(<w:pPr>(.*?)<\/w:pPr>)?/, (_m, _a, inner) => `<w:p><w:pPr>${inner ?? ''}<w:sectPr>${sect}</w:sectPr></w:pPr>`));
          out.push(...paras);
        } else {
          out.push(...paras);
          lastSect = sect;
        }
      });
      return out.join('');
    },
    sect: () => lastSect,
  }),
};
let lastSect = '';
