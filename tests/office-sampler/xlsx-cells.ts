/**
 * Excel sampler: cell formatting. Fonts (X-FNT), fills (X-FIL), borders (X-BRD), alignment
 * (X-ALN), cell protection (X-PRC), named cell styles (X-STY) and rich text in a cell (X-RTX).
 * One row per item: the id in column A, the formatted cell in column B. ECMA-376 Part 1 §18.8
 * (styles: §18.8.22 font, §18.8.20 fill, §18.8.4 border, §18.8.1 alignment, §18.8.33 protection,
 * §18.8.7 cellStyle), §18.4 (shared strings, rich text runs); Excel's Format Cells dialog
 * (Font, Fill, Border, Alignment, Protection tabs) and Home ▸ Cell Styles.
 *
 * Tags from src/io/xlsx.ts readStyles (:1286) and Styles (:322): fonts' b, i, u (single, double,
 * singleAccounting, doubleAccounting), strike, sz, name, vertAlign are read and written; colors
 * are read as RGB (readColour :1202) and written as rgb, except a font with an outline, shadow,
 * condense, extend, charset, non-Swiss family or a theme color other than text, whose XML is kept
 * (fontHasMore :1264); patterned fills are kept with their colors as rgb (:1331, :465), gradient
 * fills are not; borders' four sides with all 13 styles (BORDER_STYLES :1217), diagonals not;
 * alignment per readStyles :1378 and Styles.alignment :382; named styles kept (:1414).
 */
import { type Item, type Sampler, itemList, kid } from './kit';
import { THEME_COLORS } from './theme';
import { Book, lookAt, cellOf, cellSi, cellText, onX, valX, colorHex, near, isOn, fontOf, tinted, THEME_INDEX, stylesRoot, solidFill, xKids, type XfOpts, type Look } from './xlsx';

const items: Item[] = [];
const book = new Book();
const sh = book.sheet('Cell formats');
sh.set('cols', '<cols><col min="1" max="1" width="52" customWidth="1"/><col min="2" max="2" width="30" customWidth="1"/></cols>');
type Tag = 'supported' | 'kept' | 'loss';

/** A list of items with ids `prefix`-NN, each a cell in format `xf` checked on its look. */
function area(prefix: string) {
  const it = itemList(prefix, items);
  return (feature: string, tag: Tag, spec: string, xf: XfOpts, check: (l: Look) => boolean, basis?: string, value: string | number = 'Sample 123'): string => {
    const id = it(feature, tag, spec, (v) => check(lookAt(v, id)), basis);
    sh.item(id, feature, value, book.styles.xf(xf));
    return id;
  };
}

// ---------------------------------------------------------------------------------------------
// Fonts (X-FNT): Format Cells ▸ Font

const fnt = area('X-FNT');
const F = '§18.8.22 font; Format Cells ▸ Font';
fnt('Bold', 'supported', `${F}, §18.8.2 b`, { font: fontOf('<b/>') }, (l) => onX(l.font, 'b'));
fnt('Italic', 'supported', `${F}, §18.8.26 i`, { font: fontOf('<i/>') }, (l) => onX(l.font, 'i'));
fnt('Bold italic', 'supported', F, { font: fontOf('<b/><i/>') }, (l) => onX(l.font, 'b') && onX(l.font, 'i'));
for (const u of ['single', 'double', 'singleAccounting', 'doubleAccounting']) {
  fnt(`Underline ${u}`, 'supported', `${F}, §18.4.13 u, §18.18.85 ST_UnderlineValues`, { font: fontOf(u === 'single' ? '<u/>' : `<u val="${u}"/>`) },
    (l) => !!kid(l.font, 'x:u') && (valX(l.font, 'u') ?? 'single') === u, 'xlsx.ts:1305 (uKind), :455 uXml');
}
fnt('Strikethrough', 'supported', `${F}, §18.4.10 strike`, { font: fontOf('<strike/>') }, (l) => onX(l.font, 'strike'));
fnt('Superscript', 'supported', `${F}, §18.4.14 vertAlign`, { font: fontOf('<vertAlign val="superscript"/>') }, (l) => valX(l.font, 'vertAlign') === 'superscript');
fnt('Subscript', 'supported', `${F}, §18.4.14 vertAlign`, { font: fontOf('<vertAlign val="subscript"/>') }, (l) => valX(l.font, 'vertAlign') === 'subscript');
fnt('Size 8 pt', 'supported', `${F}, §18.4.11 sz`, { font: fontOf('', { sz: 8 }) }, (l) => valX(l.font, 'sz') === '8');
fnt('Size 20 pt', 'supported', `${F}, §18.4.11 sz`, { font: fontOf('', { sz: 20 }) }, (l) => valX(l.font, 'sz') === '20');
fnt('Size 10.5 pt', 'supported', `${F}, §18.4.11 sz`, { font: fontOf('', { sz: 10.5 }) }, (l) => valX(l.font, 'sz') === '10.5');
fnt('Font Times New Roman', 'supported', `${F}, §18.8.29 name`, { font: fontOf('', { name: 'Times New Roman' }) }, (l) => valX(l.font, 'name') === 'Times New Roman');
fnt('Font Courier New', 'supported', `${F}, §18.8.29 name`, { font: fontOf('', { name: 'Courier New' }) }, (l) => valX(l.font, 'name') === 'Courier New');
fnt('Font missing on this computer', 'supported', `${F}, §18.8.29 name`, { font: fontOf('', { name: 'No Such Font Sans' }) }, (l) => valX(l.font, 'name') === 'No Such Font Sans');
fnt('Headings theme font shows (Georgia)', 'supported', `${F}, §18.8.35 scheme major`, { font: '<sz val="11"/><color theme="1"/><name val="Georgia"/><family val="1"/><scheme val="major"/>' },
  (l) => valX(l.font, 'scheme') === 'major' || valX(l.font, 'name') === 'Georgia', 'xlsx.ts:1296 faceOf (major is the theme\'s heading font)');
fnt('Headings theme font link (scheme major)', 'loss', `${F}, §18.8.35 scheme`, { font: '<sz val="11"/><color theme="1"/><name val="Georgia"/><family val="2"/><scheme val="major"/>' },
  (l) => valX(l.font, 'scheme') === 'major', 'xlsx.ts:473 (written as the font\'s name without scheme)');
fnt('Color RGB', 'supported', `${F}, §18.3.1.15 color@rgb`, { font: fontOf('', { color: '<color rgb="FFC8553D"/>' }) }, (l) => colorHex(kid(l.font, 'x:color')) === 'C8553D');
fnt('Color indexed (10, red) shows', 'supported', `${F}, §18.3.1.15 color@indexed, §18.8.27 indexedColors`, { font: fontOf('', { color: '<color indexed="10"/>' }) },
  (l) => colorHex(kid(l.font, 'x:color')) === 'FF0000', 'xlsx.ts:1209 readColour');
fnt('Color indexed attribute kept', 'loss', `${F}, §18.3.1.15 color@indexed`, { font: fontOf('<b/>', { color: '<color indexed="12"/>' }) },
  (l) => kid(l.font, 'x:color')?.getAttribute('indexed') === '12', 'xlsx.ts:474 (written as rgb)');
fnt('Color theme Accent 2', 'kept', `${F}, §18.3.1.15 color@theme`, { font: fontOf('', { color: '<color theme="5"/>' }) },
  (l) => kid(l.font, 'x:color')?.getAttribute('theme') === '5', 'xlsx.ts:1264 fontHasMore (theme color other than text: font kept)');
fnt('Color theme Accent 1, lighter 40%', 'kept', `${F}, §18.3.1.15 color@tint`, { font: fontOf('', { color: '<color theme="4" tint="0.39997558519241921"/>' }) },
  (l) => kid(l.font, 'x:color')?.getAttribute('theme') === '4' && Math.abs(Number(kid(l.font, 'x:color')?.getAttribute('tint')) - 0.4) < 0.001, 'xlsx.ts:1264');
fnt('Color theme with tint shows', 'supported', `${F}, §18.3.1.15 color@tint`, { font: fontOf('<i/>', { color: '<color theme="9" tint="-0.249977111117893"/>' }) },
  (l) => near(colorHex(kid(l.font, 'x:color')), tinted(THEME_INDEX[9], -0.249977111117893)), 'xlsx.ts:1202 readColour');
fnt('Outline (Mac)', 'kept', `${F}, §18.8.24 outline`, { font: fontOf('<outline/>') }, (l) => onX(l.font, 'outline'), 'xlsx.ts:1264 fontHasMore');
fnt('Shadow (Mac)', 'kept', `${F}, §18.8.36 shadow`, { font: fontOf('<shadow/>') }, (l) => onX(l.font, 'shadow'), 'xlsx.ts:1264 fontHasMore');
fnt('Condense', 'kept', `${F}, §18.8.12 condense`, { font: fontOf('<condense/>') }, (l) => onX(l.font, 'condense'), 'xlsx.ts:1264 fontHasMore');
fnt('Extend', 'kept', `${F}, §18.8.17 extend`, { font: fontOf('<extend/>') }, (l) => onX(l.font, 'extend'), 'xlsx.ts:1264 fontHasMore');
fnt('Character set (128, Shift JIS)', 'kept', `${F}, §18.4.1 charset`, { font: '<sz val="11"/><color theme="1"/><name val="MS Gothic"/><family val="3"/><charset val="128"/>' },
  (l) => valX(l.font, 'charset') === '128', 'xlsx.ts:1264 fontHasMore');
fnt('Font family Roman (1)', 'kept', `${F}, §18.8.18 family`, { font: fontOf('', { name: 'Times New Roman' }).replace('<family val="2"/>', '<family val="1"/>') },
  (l) => valX(l.font, 'family') === '1', 'xlsx.ts:1264 fontHasMore (family other than 2)');
fnt('Bold, italic, underlined, struck, 14 pt, colored together', 'supported', F, { font: fontOf('<b/><i/><strike/><u/>', { sz: 14, color: '<color rgb="FF6A4C93"/>' }) },
  (l) => onX(l.font, 'b') && onX(l.font, 'i') && onX(l.font, 'strike') && !!kid(l.font, 'x:u') && valX(l.font, 'sz') === '14' && colorHex(kid(l.font, 'x:color')) === '6A4C93');

// ---------------------------------------------------------------------------------------------
// Fills (X-FIL): Format Cells ▸ Fill

const fil = area('X-FIL');
const FL = '§18.8.20 fill, §18.8.32 patternFill; Format Cells ▸ Fill';
const pf = (l: Look) => kid(l.fill, 'x:patternFill');
fil('Solid fill RGB', 'supported', FL, { fill: solidFill('F2A541') }, (l) => pf(l)?.getAttribute('patternType') === 'solid' && colorHex(kid(pf(l), 'x:fgColor')) === 'F2A541');
fil('Solid fill theme color shows', 'supported', `${FL}, §18.3.1.15 color@theme`, { fill: '<patternFill patternType="solid"><fgColor theme="4"/><bgColor indexed="64"/></patternFill>' },
  (l) => pf(l)?.getAttribute('patternType') === 'solid' && colorHex(kid(pf(l), 'x:fgColor')) === THEME_COLORS.accent1, 'xlsx.ts:1325 (read as RGB)');
fil('Solid fill theme color link', 'loss', `${FL}, §18.3.1.15 color@theme`, { fill: '<patternFill patternType="solid"><fgColor theme="7"/><bgColor indexed="64"/></patternFill>' },
  (l) => kid(pf(l), 'x:fgColor')?.getAttribute('theme') === '7', 'xlsx.ts:479 (written as rgb)');
fil('Solid fill theme with tint shows', 'supported', `${FL}, §18.3.1.15 color@tint`, { fill: '<patternFill patternType="solid"><fgColor theme="5" tint="0.79998168889431442"/><bgColor indexed="64"/></patternFill>' },
  (l) => near(colorHex(kid(pf(l), 'x:fgColor')), tinted(THEME_INDEX[5], 0.79998168889431442)));
fil('Solid fill indexed color shows', 'supported', `${FL}, §18.8.27 indexedColors`, { fill: '<patternFill patternType="solid"><fgColor indexed="13"/><bgColor indexed="64"/></patternFill>' },
  (l) => colorHex(kid(pf(l), 'x:fgColor')) === 'FFFF00');
for (const p of ['mediumGray', 'darkGray', 'lightGray', 'darkHorizontal', 'darkVertical', 'darkDown', 'darkUp', 'darkGrid', 'darkTrellis',
  'lightHorizontal', 'lightVertical', 'lightDown', 'lightUp', 'lightGrid', 'lightTrellis', 'gray125', 'gray0625']) {
  fil(`Pattern ${p} with colors`, 'kept', `${FL}, §18.18.55 ST_PatternType`, { fill: `<patternFill patternType="${p}"><fgColor rgb="FF1B7F79"/><bgColor rgb="FFEEF2E6"/></patternFill>` },
    (l) => pf(l)?.getAttribute('patternType') === p && colorHex(kid(pf(l), 'x:fgColor')) === '1B7F79' && colorHex(kid(pf(l), 'x:bgColor')) === 'EEF2E6', 'xlsx.ts:1331 patterns, :465');
}
fil('Pattern darkGrid, background color only', 'kept', `${FL}, §18.8.32`, { fill: '<patternFill patternType="darkGrid"><bgColor rgb="FFC8553D"/></patternFill>' },
  (l) => pf(l)?.getAttribute('patternType') === 'darkGrid' && colorHex(kid(pf(l), 'x:bgColor')) === 'C8553D', 'xlsx.ts:1331');
fil('Gradient fill linear 90°', 'loss', '§18.8.24 gradientFill; Format Cells ▸ Fill ▸ Fill Effects', { fill: '<gradientFill degree="90"><stop position="0"><color rgb="FFFFFFFF"/></stop><stop position="1"><color rgb="FF1B7F79"/></stop></gradientFill>' },
  (l) => kid(l.fill, 'x:gradientFill')?.getAttribute('degree') === '90', 'xlsx.ts:1322 (only patternFill is read)');
fil('Gradient fill path from center', 'loss', '§18.8.24 gradientFill@type path', { fill: '<gradientFill type="path" left="0.5" right="0.5" top="0.5" bottom="0.5"><stop position="0"><color rgb="FFFFFFFF"/></stop><stop position="1"><color rgb="FFC8553D"/></stop></gradientFill>' },
  (l) => kid(l.fill, 'x:gradientFill')?.getAttribute('type') === 'path', 'xlsx.ts:1322');

// ---------------------------------------------------------------------------------------------
// Borders (X-BRD): Format Cells ▸ Border

const brd = area('X-BRD');
const B = '§18.8.4 border, §18.8.6 CT_BorderPr; Format Cells ▸ Border';
const sides = ['left', 'right', 'top', 'bottom'];
const side = (l: Look, s: string) => kid(l.border, `x:${s}`);
for (const st of ['thin', 'medium', 'thick', 'double', 'hair', 'dotted', 'dashed', 'mediumDashed', 'dashDot', 'mediumDashDot', 'dashDotDot', 'mediumDashDotDot', 'slantDashDot']) {
  brd(`Outline border ${st}`, 'supported', `${B}, §18.18.3 ST_BorderStyle`, { border: `${sides.map((s) => `<${s} style="${st}"><color indexed="64"/></${s}>`).join('')}<diagonal/>` },
    (l) => sides.every((s) => side(l, s)?.getAttribute('style') === st), 'xlsx.ts:1217 BORDER_STYLES, :1343 borderNames');
}
brd('Bottom border only (double)', 'supported', B, { border: '<left/><right/><top/><bottom style="double"><color auto="1"/></bottom><diagonal/>' },
  (l) => side(l, 'bottom')?.getAttribute('style') === 'double' && !side(l, 'top')?.getAttribute('style') && !side(l, 'left')?.getAttribute('style'));
brd('Each side a different style', 'supported', B, { border: '<left style="thin"><color auto="1"/></left><right style="medium"><color auto="1"/></right><top style="dashed"><color auto="1"/></top><bottom style="thick"><color auto="1"/></bottom><diagonal/>' },
  (l) => side(l, 'left')?.getAttribute('style') === 'thin' && side(l, 'right')?.getAttribute('style') === 'medium' && side(l, 'top')?.getAttribute('style') === 'dashed' && side(l, 'bottom')?.getAttribute('style') === 'thick');
brd('Border color RGB', 'supported', `${B}, §18.3.1.15 color`, { border: `${sides.map((s) => `<${s} style="medium"><color rgb="FFC8553D"/></${s}>`).join('')}<diagonal/>` },
  (l) => sides.every((s) => colorHex(kid(side(l, s), 'x:color')) === 'C8553D'));
brd('Border color theme shows', 'supported', `${B}, §18.3.1.15 color@theme`, { border: `${sides.map((s) => `<${s} style="thin"><color theme="4"/></${s}>`).join('')}<diagonal/>` },
  (l) => sides.every((s) => colorHex(kid(side(l, s), 'x:color')) === THEME_COLORS.accent1), 'xlsx.ts:1340 (read as RGB)');
brd('Diagonal up', 'loss', `${B}, §18.8.4 diagonalUp`, { border: '<left/><right/><top/><bottom/><diagonal style="thin"><color auto="1"/></diagonal>', borderAttrs: ' diagonalUp="1"' },
  (l) => isOn(l.border?.getAttribute('diagonalUp')) && side(l, 'diagonal')?.getAttribute('style') === 'thin', 'xlsx.ts:1336 (diagonals not read)');
brd('Diagonal down', 'loss', `${B}, §18.8.4 diagonalDown`, { border: '<left/><right/><top/><bottom/><diagonal style="medium"><color rgb="FF1B7F79"/></diagonal>', borderAttrs: ' diagonalDown="1"' },
  (l) => isOn(l.border?.getAttribute('diagonalDown')) && side(l, 'diagonal')?.getAttribute('style') === 'medium', 'xlsx.ts:1336');
brd('Both diagonals with a box', 'loss', `${B}, §18.8.4`, { border: `${sides.map((s) => `<${s} style="thin"><color auto="1"/></${s}>`).join('')}<diagonal style="thin"><color auto="1"/></diagonal>`, borderAttrs: ' diagonalUp="1" diagonalDown="1"' },
  (l) => isOn(l.border?.getAttribute('diagonalUp')) && isOn(l.border?.getAttribute('diagonalDown')), 'xlsx.ts:1336');

// ---------------------------------------------------------------------------------------------
// Alignment (X-ALN): Format Cells ▸ Alignment

const aln = area('X-ALN');
const A = '§18.8.1 alignment; Format Cells ▸ Alignment';
const al = (l: Look, a: string) => l.alignment?.getAttribute(a) ?? null;
const LONG = 'A longer text that needs more room than the column gives it';
aln('Horizontal general (explicit)', 'supported', `${A}, §18.18.40 ST_HorizontalAlignment`, { align: 'horizontal="general"' }, (l) => (al(l, 'horizontal') ?? 'general') === 'general');
for (const [h, tag] of [['left', 'supported'], ['center', 'supported'], ['right', 'supported'], ['fill', 'kept'], ['justify', 'kept'], ['centerContinuous', 'kept'], ['distributed', 'kept']] as [string, Tag][]) {
  aln(`Horizontal ${h}`, tag, `${A}, §18.18.40 ST_HorizontalAlignment`, { align: `horizontal="${h}"${h === 'justify' || h === 'distributed' ? ' wrapText="1"' : ''}` },
    (l) => al(l, 'horizontal') === h, tag === 'kept' ? 'xlsx.ts:1218 SHOWN_H, :1393 ex.horizontal' : 'xlsx.ts:1379', h === 'fill' ? '*-' : h === 'justify' || h === 'distributed' ? LONG : 'Sample 123');
}
for (const [vv, tag] of [['top', 'supported'], ['center', 'supported'], ['justify', 'kept'], ['distributed', 'kept']] as [string, Tag][]) {
  aln(`Vertical ${vv}`, tag, `${A}, §18.18.88 ST_VerticalAlignment`, { align: `vertical="${vv}"` }, (l) => al(l, 'vertical') === vv, tag === 'kept' ? 'xlsx.ts:1394 ex.vertical' : 'xlsx.ts:1383');
}
aln('Vertical bottom (explicit)', 'supported', `${A}, §18.18.88`, { align: 'vertical="bottom"' }, (l) => (al(l, 'vertical') ?? 'bottom') === 'bottom');
aln('Wrap text', 'supported', `${A}@wrapText`, { align: 'wrapText="1"' }, (l) => isOn(al(l, 'wrapText')), undefined, LONG);
aln('Shrink to fit', 'kept', `${A}@shrinkToFit`, { align: 'shrinkToFit="1"' }, (l) => isOn(al(l, 'shrinkToFit')), 'xlsx.ts:1395', LONG);
aln('Indent 2, left', 'supported', `${A}@indent`, { align: 'horizontal="left" indent="2"' }, (l) => al(l, 'horizontal') === 'left' && al(l, 'indent') === '2');
aln('Indent 3, right', 'supported', `${A}@indent`, { align: 'horizontal="right" indent="3"' }, (l) => al(l, 'horizontal') === 'right' && al(l, 'indent') === '3');
for (const [r, what] of [[45, '45° up'], [90, '90° (rotate text up)'], [135, '45° down'], [180, '90° down (rotate text down)'], [255, 'vertical text (stacked)']] as [number, string][]) {
  aln(`Text rotation ${r}: ${what}`, 'supported', `${A}@textRotation`, { align: `textRotation="${r}"` }, (l) => al(l, 'textRotation') === String(r), 'xlsx-view.ts:25 textRotation');
}
aln('Reading order left-to-right', 'kept', `${A}@readingOrder`, { align: 'readingOrder="1"' }, (l) => al(l, 'readingOrder') === '1', 'xlsx.ts:1396');
aln('Reading order right-to-left', 'kept', `${A}@readingOrder`, { align: 'horizontal="right" readingOrder="2"' }, (l) => al(l, 'readingOrder') === '2', 'xlsx.ts:1396', 'كيمياء chemistry');
aln('Justify distributed (justifyLastLine)', 'loss', `${A}@justifyLastLine`, { align: 'horizontal="distributed" justifyLastLine="1" wrapText="1"' }, (l) => isOn(al(l, 'justifyLastLine')), 'xlsx.ts:382 (not written)', LONG);
aln('Center with wrap and middle together', 'supported', A, { align: 'horizontal="center" vertical="center" wrapText="1"' },
  (l) => al(l, 'horizontal') === 'center' && al(l, 'vertical') === 'center' && isOn(al(l, 'wrapText')), undefined, LONG);

// ---------------------------------------------------------------------------------------------
// Cell protection (X-PRC): Format Cells ▸ Protection

const prc = area('X-PRC');
prc('Unlocked cell', 'supported', '§18.8.33 protection@locked; Format Cells ▸ Protection ▸ Locked', { protection: 'locked="0"' },
  (l) => l.protection?.getAttribute('locked') === '0' || l.protection?.getAttribute('locked') === 'false', 'xlsx.ts:1388, xlsx-view.ts:400');
prc('Formula hidden', 'supported', '§18.8.33 protection@hidden; Format Cells ▸ Protection ▸ Hidden', { protection: 'hidden="1"' },
  (l) => isOn(l.protection?.getAttribute('hidden')), 'xlsx.ts:1389');
prc('Unlocked and hidden', 'supported', '§18.8.33', { protection: 'locked="0" hidden="1"' },
  (l) => l.protection?.getAttribute('locked') === '0' && isOn(l.protection?.getAttribute('hidden')));

// ---------------------------------------------------------------------------------------------
// Named cell styles (X-STY): Home ▸ Cell Styles

const sty = itemList('X-STY', items);
const S = '§18.8.7 cellStyle, §18.8.9 cellStyleXfs; Home ▸ Cell Styles';
const styleItem = (feature: string, tag: Tag, name: string, builtinId: number | undefined, xf: XfOpts, attrs: string, check: (l: Look) => boolean, basis: string) => {
  const xfId = book.styles.named(name, xf, `${builtinId !== undefined ? `builtinId="${builtinId}"` : ''}${attrs ? ' ' + attrs : ''}`.trim());
  const id = sty(feature, tag, S, (v) => check(lookAt(v, id)), basis);
  sh.item(id, feature, 'Styled', book.styles.xf({ ...xf, xfId }));
};
styleItem('Built-in style Good', 'supported', 'Good', 26, { font: fontOf('', { color: '<color rgb="FF006100"/>' }), fill: solidFill('C6EFCE') }, '',
  (l) => l.styleName === 'Good' && l.cellStyle?.getAttribute('builtinId') === '26', 'xlsx.ts:1356 named, :500 namedStyleKey');
styleItem('Built-in style Heading 1', 'supported', 'Heading 1', 16, { font: fontOf('<b/>', { sz: 15, color: '<color theme="3"/>' }), border: '<left/><right/><top/><bottom style="thick"><color theme="4"/></bottom><diagonal/>' }, '',
  (l) => l.styleName === 'Heading 1' && l.cellStyle?.getAttribute('builtinId') === '16', 'xlsx.ts:1356');
styleItem('Built-in style Percent', 'supported', 'Percent', 5, { numFmtId: 9 }, '',
  (l) => l.styleName === 'Percent' && l.numFmtId === 9, 'xlsx.ts:1356');
styleItem('Custom style of the file\'s own', 'kept', 'Sampler Highlight', undefined, { font: fontOf('<b/>', { color: '<color rgb="FF6A4C93"/>' }), fill: solidFill('EEF2E6') }, '',
  (l) => l.styleName === 'Sampler Highlight' && onX(l.font, 'b'), 'xlsx.ts:1414 kept.named');
styleItem('Custom style, hidden', 'kept', 'Sampler Hidden', undefined, { font: fontOf('<i/>') }, 'hidden="1"',
  (l) => l.styleName === 'Sampler Hidden' && isOn(l.cellStyle?.getAttribute('hidden')), 'xlsx.ts:1418 attrs hidden');
styleItem('Built-in style changed (customBuiltin)', 'kept', 'Neutral', 28, { font: fontOf('', { color: '<color rgb="FF9C5700"/>' }), fill: solidFill('FFD966') }, 'customBuiltin="1"',
  (l) => l.styleName === 'Neutral' && isOn(l.cellStyle?.getAttribute('customBuiltin')), 'xlsx.ts:1418 attrs customBuiltin');
const unused = sty('Style no cell uses kept in the gallery', 'kept', S, (v) => xKids(kid(stylesRoot(v), 'x:cellStyles'), 'cellStyle').some((c) => c.getAttribute('name') === 'Sampler Unused'), 'xlsx.ts:330 (the Cell Styles gallery keeps those no cell uses)');
book.styles.named('Sampler Unused', { font: fontOf('<u/>') });
sh.item(unused, 'Style no cell uses kept in the gallery (Sampler Unused)');
const qp = sty('Quote prefix (text typed with an apostrophe)', 'loss', '§18.8.45 xf@quotePrefix', (v) => isOn(lookAt(v, qp).xf?.getAttribute('quotePrefix')), 'xlsx.ts:356 (quotePrefix not written)');
book.styles.xfs.push('<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" quotePrefix="1"/>');
sh.item(qp, 'Quote prefix (text typed with an apostrophe)', '00123', book.styles.xfs.length - 1);


// ---------------------------------------------------------------------------------------------
// Rich text in a cell (X-RTX): runs of a shared string (§18.4.4 r, §18.4.7 rPr)

const rtx = itemList('X-RTX', items);
const RT = '§18.4.4 r, §18.4.7 rPr (CT_RPrElt); select part of a cell\'s text ▸ Format Cells ▸ Font';
const run = (text: string, rPr = '') => `<r>${rPr ? `<rPr>${rPr}${rPr.includes('<sz') ? '' : '<sz val="11"/>'}${rPr.includes('<color') ? '' : '<color theme="1"/>'}${rPr.includes('<rFont') ? '' : '<rFont val="Calibri"/>'}<family val="2"/>${rPr.includes('<rFont') ? '' : '<scheme val="minor"/>'}</rPr>` : ''}<t>${text}</t></r>`;
/** A rich text item: the label's id, then a run formatted with `rPr` holding `marked`, checked on that run's rPr. */
const rich = (feature: string, tag: Tag, rPr: string, check: (rPr: Element | undefined) => boolean, basis = 'xlsx.ts:1488 stringItem, :549 Strings runs') => {
  const id = rtx(feature, tag, RT, (v) => {
    const si = cellSi(v, cellOf(v, id));
    const r = xKids(si, 'r').find((x) => kid(x, 'x:t')?.textContent === 'marked');
    return check(kid(r, 'x:rPr'));
  }, basis);
  sh.item(id, feature, { t: 's', v: book.sst.rich(run('plain ') + run('marked', rPr) + run(' plain')) });
};
rich('Run bold', 'supported', '<b/>', (r) => onX(r, 'b'));
rich('Run italic', 'supported', '<i/>', (r) => onX(r, 'i'));
rich('Run underline double', 'supported', '<u val="double"/>', (r) => valX(r, 'u') === 'double');
rich('Run strikethrough', 'supported', '<strike/>', (r) => onX(r, 'strike'));
rich('Run subscript', 'supported', '<vertAlign val="subscript"/>', (r) => valX(r, 'vertAlign') === 'subscript');
rich('Run superscript', 'supported', '<vertAlign val="superscript"/>', (r) => valX(r, 'vertAlign') === 'superscript');
rich('Run color RGB', 'supported', '<color rgb="FFC8553D"/>', (r) => colorHex(kid(r, 'x:color')) === 'C8553D');
rich('Run size 16 pt', 'supported', '<sz val="16"/>', (r) => valX(r, 'sz') === '16');
rich('Run font Courier New', 'supported', '<rFont val="Courier New"/>', (r) => valX(r, 'rFont') === 'Courier New');
rich('Run color theme (Accent 3)', 'kept', '<color theme="6"/>', (r) => kid(r, 'x:color')?.getAttribute('theme') === '6', 'xlsx.ts:566 runXml (rPr as the file had it while it still shows so)');
rich('Run outline (kept rPr)', 'kept', '<outline/>', (r) => onX(r, 'outline'), 'xlsx.ts:1230 RPR_PARTS, :566');
const phon = rtx('Phonetic guide (furigana, rPh)', 'loss', '§18.4.6 rPh, §18.4.3 phoneticPr; Home ▸ Show Phonetic Field', (v) => xKids(cellSi(v, cellOf(v, phon)), 'rPh').length > 0, 'xlsx.ts:1488 (rPh not read)');
sh.item(phon, 'Phonetic guide (furigana, rPh)', { t: 's', v: book.sst.rich('<t>化学</t><rPh sb="0" eb="2"><t>カガク</t></rPh><phoneticPr fontId="0" type="noConversion"/>') });
const inl = rtx('Inline string (t="inlineStr") text', 'supported', '§18.3.1.53 is; §18.18.11 ST_CellType inlineStr', (v) => cellText(v, cellOf(v, inl)) === 'inline text', 'xlsx.ts:1762');
sh.item(inl, 'Inline string (t="inlineStr") text', { t: 'inlineStr', is: '<t>inline text</t>' });
const inl2 = rtx('Inline string kept inline', 'loss', '§18.3.1.53 is', (v) => cellOf(v, inl2)?.getAttribute('t') === 'inlineStr', 'xlsx.ts:840 (written as a shared string)');
sh.item(inl2, 'Inline string kept inline', { t: 'inlineStr', is: '<t>inline two</t>' });
const esc1 = rtx('Escaped control character (carriage return)', 'supported', '§22.9.2.19 ST_Xstring escapes', (v) => cellText(v, cellOf(v, esc1)).replace(/_x000D_/g, '\r') === 'line one\r\nline two', 'xlsx.ts:1471 excelUnescape/excelEscape');
sh.item(esc1, 'Escaped control character (carriage return)', { t: 's', v: book.sst.rich('<t>line one_x000D_\nline two</t>') }, book.styles.xf({ align: 'wrapText="1"' }));

let bytes: Uint8Array | undefined;
export const xlsxCells: Sampler = {
  name: 'xlsx-cells.xlsx', area: 'Excel cell formatting: fonts, fills, borders, alignment, protection, cell styles, rich text', items,
  build: () => (bytes ??= book.build('Excel sampler: cell formatting')),
};
