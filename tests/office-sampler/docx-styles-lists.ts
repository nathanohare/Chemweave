/**
 * Word sampler: styles and lists (W-STY, W-LST). ECMA-376 Part 1 §17.7 (styles) and §17.9
 * (numbering); Word's Styles pane, Modify Style, and Home ▸ Bullets, Numbering and Multilevel List.
 *
 * Tags from src/io/docx-read.ts: paragraph styles become model styles, unused, linked and table
 * styles are kept as their XML (keptStyles :764, keptCharStyle :797); docDefaults are rewritten
 * (docx-write.ts:1854). Numbering (:840): an abstractNum with an nsid is kept whole while unchanged,
 * except one with a picture bullet or a style link (:858); the model knows the formats 1, a, A, i, I
 * (src/text/paragraphs.ts LIST_SCHEMES).
 */
import { type Item, type Sampler, type View, itemList, at, kid, NS, REL, png } from './kit';
import { wordFile, para, run, pPrOf, val, on, rPrOf } from './word';

const items: Item[] = [];
const sty = itemList('W-STY', items);
const lst = itemList('W-LST', items);
const body: string[] = [];
type T = 'supported' | 'kept' | 'loss';

// ---------------------------------------------------------------------------------------------
// Styles

const styleById = (v: View, idv: string) => v.all(/^word\/styles\.xml$/, 'w:style').find((s) => at(s, 'w:styleId') === idv);
const styleByName = (v: View, name: string) => v.all(/^word\/styles\.xml$/, 'w:style').find((s) => val(s, 'w:name') === name);
/** The style a paragraph uses, by its pStyle (the id may be renumbered, so go through the id to the style's name). */
const usedStyleName = (v: View, id: string) => { const sid = val(pPrOf(v, id), 'w:pStyle'); return sid ? val(styleById(v, sid), 'w:name') : null; };

const STYLES = [
  '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="10"/><w:qFormat/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:contextualSpacing/></w:pPr><w:rPr><w:rFonts w:asciiTheme="majorHAnsi" w:hAnsiTheme="majorHAnsi"/><w:spacing w:val="-10"/><w:kern w:val="28"/><w:sz w:val="56"/></w:rPr></w:style>',
  '<w:style w:type="paragraph" w:customStyle="1" w:styleId="SamplerBase"><w:name w:val="Sampler Base"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="120"/></w:pPr><w:rPr><w:color w:val="1B7F79"/></w:rPr></w:style>',
  '<w:style w:type="paragraph" w:customStyle="1" w:styleId="SamplerMiddle"><w:name w:val="Sampler Middle"/><w:basedOn w:val="SamplerBase"/><w:qFormat/><w:pPr><w:ind w:left="360"/></w:pPr><w:rPr><w:i/></w:rPr></w:style>',
  '<w:style w:type="paragraph" w:customStyle="1" w:styleId="SamplerLeaf"><w:name w:val="Sampler Leaf"/><w:basedOn w:val="SamplerMiddle"/><w:next w:val="SamplerBase"/><w:qFormat/><w:pPr><w:jc w:val="center"/></w:pPr><w:rPr><w:b/></w:rPr></w:style>',
  '<w:style w:type="paragraph" w:customStyle="1" w:styleId="SamplerQuote"><w:name w:val="Sampler Quote"/><w:basedOn w:val="Normal"/><w:link w:val="SamplerQuoteChar"/><w:qFormat/><w:pPr><w:ind w:left="864" w:right="864"/></w:pPr><w:rPr><w:i/><w:color w:val="6A4C93"/></w:rPr></w:style>',
  '<w:style w:type="character" w:customStyle="1" w:styleId="SamplerQuoteChar"><w:name w:val="Sampler Quote Char"/><w:basedOn w:val="DefaultParagraphFont"/><w:link w:val="SamplerQuote"/><w:rPr><w:i/><w:color w:val="6A4C93"/></w:rPr></w:style>',
  '<w:style w:type="paragraph" w:customStyle="1" w:styleId="SamplerBoxed"><w:name w:val="Sampler Boxed"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:pBdr><w:top w:val="single" w:sz="4" w:space="1" w:color="C8553D"/><w:left w:val="single" w:sz="4" w:space="4" w:color="C8553D"/><w:bottom w:val="single" w:sz="4" w:space="1" w:color="C8553D"/><w:right w:val="single" w:sz="4" w:space="4" w:color="C8553D"/></w:pBdr><w:shd w:val="clear" w:color="auto" w:fill="EEF2E6"/></w:pPr></w:style>',
  '<w:style w:type="paragraph" w:customStyle="1" w:styleId="SamplerUnused"><w:name w:val="Sampler Unused"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="right"/></w:pPr><w:rPr><w:caps/></w:rPr></w:style>',
  '<w:style w:type="paragraph" w:customStyle="1" w:styleId="SamplerHidden"><w:name w:val="Sampler Hidden"/><w:basedOn w:val="Normal"/><w:semiHidden/><w:unhideWhenUsed/></w:style>',
  '<w:style w:type="character" w:customStyle="1" w:styleId="SamplerCharBase"><w:name w:val="Sampler Char Base"/><w:basedOn w:val="DefaultParagraphFont"/><w:rPr><w:color w:val="C8553D"/></w:rPr></w:style>',
  '<w:style w:type="character" w:customStyle="1" w:styleId="SamplerCharDerived"><w:name w:val="Sampler Char Derived"/><w:basedOn w:val="SamplerCharBase"/><w:rPr><w:u w:val="dotted"/></w:rPr></w:style>',
  '<w:style w:type="paragraph" w:customStyle="1" w:styleId="SamplerNumbered"><w:name w:val="Sampler Numbered"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:numPr><w:numId w:val="200"/></w:numPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:style>',
].join('');

const styled = (feature: string, tag: T, spec: string, pPr: string, rPr: string, check: (v: View, id: string) => boolean, basis?: string) => {
  const id = sty(feature, tag, spec, (v) => check(v, id), basis);
  body.push(para(run(`${id} ${feature}`, rPr), pPr));
};
styled('Heading 1 style', 'supported', '§17.7.4.17 style; Home ▸ Styles ▸ Heading 1', '<w:pStyle w:val="Heading1"/>', '', (v, id) => usedStyleName(v, id) === 'heading 1');
styled('Heading 2 style', 'supported', '§17.7.4.17 style', '<w:pStyle w:val="Heading2"/>', '', (v, id) => usedStyleName(v, id) === 'heading 2');
styled('Heading 3 style', 'supported', '§17.7.4.17 style', '<w:pStyle w:val="Heading3"/>', '', (v, id) => usedStyleName(v, id) === 'heading 3');
styled('Title style', 'supported', '§17.7.4.17 style; Home ▸ Styles ▸ Title', '<w:pStyle w:val="Title"/>', '', (v, id) => usedStyleName(v, id) === 'Title');
styled('Custom paragraph style', 'supported', '§17.7.4.17 style@customStyle; Create a Style', '<w:pStyle w:val="SamplerBase"/>', '', (v, id) => usedStyleName(v, id) === 'Sampler Base' && val(styleByName(v, 'Sampler Base'), 'w:rPr/w:color')?.toUpperCase() === '1B7F79');
styled('Style based on a style based on a style', 'supported', '§17.7.4.3 basedOn (inheritance chain)', '<w:pStyle w:val="SamplerLeaf"/>', '', (v, id) => {
  const leaf = styleByName(v, 'Sampler Leaf');
  const mid = leaf && styleById(v, val(leaf, 'w:basedOn') ?? '');
  return usedStyleName(v, id) === 'Sampler Leaf' && val(mid, 'w:name') === 'Sampler Middle' && val(styleById(v, val(mid, 'w:basedOn') ?? ''), 'w:name') === 'Sampler Base';
});
styled('Style for following paragraph', 'supported', '§17.7.4.10 next', '<w:pStyle w:val="SamplerLeaf"/>', '', (v) => val(styleById(v, val(styleByName(v, 'Sampler Leaf'), 'w:next') ?? ''), 'w:name') === 'Sampler Base');
styled('Linked paragraph and character style', 'kept', '§17.7.4.6 link', '<w:pStyle w:val="SamplerQuote"/>', '', (v) => !!kid(styleByName(v, 'Sampler Quote'), 'w:link') && !!styleByName(v, 'Sampler Quote Char'), 'docx-read.ts:764 keptStyles (linked)');
styled('Style with border and shading', 'supported', '§17.7.4.17 style pPr pBdr shd', '<w:pStyle w:val="SamplerBoxed"/>', '', (v, id) => usedStyleName(v, id) === 'Sampler Boxed' && !!kid(styleByName(v, 'Sampler Boxed'), 'w:pPr/w:pBdr/w:top'));
styled('Direct formatting over a style', 'supported', '§17.7.2 style hierarchy', '<w:pStyle w:val="Heading2"/>', '<w:color w:val="C8553D"/>', (v, id) => usedStyleName(v, id) === 'heading 2' && val(rPrOf(v, id), 'w:color')?.toUpperCase() === 'C8553D');
styled('Character style based on a character style', 'supported', '§17.7.4.3 basedOn (character)', '', '<w:rStyle w:val="SamplerCharDerived"/>', (v, id) => {
  // the style used, and the dotted underline it adds to its base's color (in it or inherited)
  const s = styleById(v, val(rPrOf(v, id), 'w:rStyle') ?? '');
  const base = styleById(v, val(s, 'w:basedOn') ?? '');
  const u = val(s, 'w:rPr/w:u') ?? val(base, 'w:rPr/w:u');
  const color = val(s, 'w:rPr/w:color') ?? val(base, 'w:rPr/w:color');
  return val(s, 'w:name') === 'Sampler Char Derived' && u === 'dotted' && color?.toUpperCase() === 'C8553D';
}, 'docx-read.ts:797 keptCharStyle');
styled('Paragraph style with its own numbering', 'kept', '§17.7.4.17 style pPr numPr', '<w:pStyle w:val="SamplerNumbered"/>', '', (v) => !!kid(styleByName(v, 'Sampler Numbered'), 'w:pPr/w:numPr'), 'docx-read.ts:764 keptStyles');
const unused = sty('Unused custom style kept in the file', 'kept', '§17.7.4.17 style', (v) => !!styleByName(v, 'Sampler Unused'), 'docx-read.ts:764 keptStyles (unused)');
const hidden = sty('Hidden style (semiHidden, unhide when used)', 'kept', '§17.7.4.16 semiHidden', (v) => on(styleByName(v, 'Sampler Hidden'), 'w:semiHidden'), 'docx-read.ts:764 keptStyles (unused)');
body.push(para(run(`${unused} and ${hidden}: these styles are in the file but no paragraph uses them`)));
const latent = sty('Latent style exceptions', 'kept', '§17.7.4.5 latentStyles', (v) => v.all(/^word\/styles\.xml$/, 'w:lsdException').some((e) => at(e, 'w:name') === 'heading 1'), 'docx-read.ts:764 (latentStyles kept)');
const defaults = sty('Document defaults (East Asian language)', 'loss', '§17.7.5.1 docDefaults', (v) => v.all(/^word\/styles\.xml$/, 'w:rPrDefault').some((d) => at(kid(d, 'w:rPr/w:lang'), 'w:eastAsia') === 'ja-JP'), 'docx-write.ts:1854 (docDefaults rewritten)');
const defaultSpacing = sty('Document default paragraph spacing (8 pt after, 1.08 lines)', 'supported', '§17.7.5.3 pPrDefault', (v) => {
  // in effect for Normal paragraphs: Normal's own spacing, else pPrDefault's
  const d = v.all(/^word\/styles\.xml$/, 'w:pPrDefault')[0];
  const n = styleByName(v, 'Normal');
  const sp = kid(n, 'w:pPr/w:spacing') ?? kid(d, 'w:pPr/w:spacing');
  return at(sp, 'w:after') === '160' && at(sp, 'w:line') === '259';
}, 'docx-write.ts:1854 (from Normal)');
body.push(para(run(`${latent}, ${defaults} and ${defaultSpacing}: set in styles.xml`)));

// ---------------------------------------------------------------------------------------------
// Lists

/** One abstractNum (with an nsid, as Word writes them) of the given levels, and its num. */
const abstracts: string[] = [];
const nums: string[] = [];
let nextAbs = 0;
type Lvl = { fmt: string; text: string; font?: string; start?: number; extra?: string; rPr?: string; pic?: number; jc?: string };
// (§17.9.6 lvl's children in the schema's order: start, numFmt, lvlRestart, pStyle, isLgl, suff, lvlText, lvlPicBulletId, legacy, lvlJc, pPr, rPr)
const lvlXml = (i: number, l: Lvl) => `<w:lvl w:ilvl="${i}"><w:start w:val="${l.start ?? 1}"/><w:numFmt w:val="${l.fmt}"/>${l.extra ?? ''}<w:lvlText w:val="${l.text}"/>${l.pic !== undefined ? `<w:lvlPicBulletId w:val="${l.pic}"/>` : ''}<w:lvlJc w:val="${l.jc ?? 'left'}"/>`
  + `<w:pPr><w:ind w:left="${720 * (i + 1)}" w:hanging="360"/></w:pPr>${l.font || l.rPr ? `<w:rPr>${l.font ? `<w:rFonts w:ascii="${l.font}" w:hAnsi="${l.font}" w:hint="default"/>` : ''}${l.rPr ?? ''}</w:rPr>` : ''}</w:lvl>`;
function list(levels: Lvl[], opts: { numId?: number; override?: string; absExtra?: string } = {}): number {
  const a = nextAbs++;
  abstracts.push(`<w:abstractNum w:abstractNumId="${a}"><w:nsid w:val="${(0x1a2b0000 + a).toString(16).toUpperCase()}"/><w:multiLevelType w:val="${levels.length > 1 ? 'multilevel' : 'singleLevel'}"/>${opts.absExtra ?? ''}${levels.map((l, i) => lvlXml(i, l)).join('')}</w:abstractNum>`);
  const numId = opts.numId ?? a + 1;
  nums.push(`<w:num w:numId="${numId}"><w:abstractNumId w:val="${a}"/>${opts.override ?? ''}</w:num>`);
  return numId;
}

/** The w:lvl that the paragraph holding `id` is numbered with, in the saved numbering part. */
function levelOf(v: View, id: string): Element | undefined {
  const np = kid(pPrOf(v, id), 'w:numPr');
  const numId = val(np, 'w:numId');
  const ilvl = Number(val(np, 'w:ilvl') ?? '0');
  const num = v.all(/^word\/numbering\.xml$/, 'w:num').find((n) => at(n, 'w:numId') === numId);
  const absId = val(num, 'w:abstractNumId');
  const abs = v.all(/^word\/numbering\.xml$/, 'w:abstractNum').find((a) => at(a, 'w:abstractNumId') === absId);
  return Array.from(abs?.getElementsByTagNameNS(NS.w, 'lvl') ?? []).find((l) => at(l, 'w:ilvl') === String(ilvl));
}
const numPara = (text: string, numId: number, ilvl = 0) => para(run(text), `<w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr>`);
/** One list item: two numbered paragraphs (so numbering shows counting), checked on the first's level. */
const listItem = (feature: string, tag: T, spec: string, l: Lvl, check: (lvl: Element | undefined) => boolean, basis?: string) => {
  const n = list([l]);
  const id = lst(feature, tag, spec, (v) => check(levelOf(v, id)), basis);
  body.push(numPara(`${id} ${feature}`, n), numPara('second item', n));
};
const fmtIs = (f: string, text?: string) => (l: Element | undefined) => val(l, 'w:numFmt') === f && (text === undefined || val(l, 'w:lvlText') === text);

listItem('Bullet •', 'supported', '§17.9.17 numFmt bullet; Home ▸ Bullets', { fmt: 'bullet', text: '', font: 'Symbol' }, fmtIs('bullet'));
listItem('Bullet o (Courier New)', 'supported', '§17.9.17 numFmt bullet', { fmt: 'bullet', text: 'o', font: 'Courier New' }, fmtIs('bullet', 'o'));
listItem('Bullet § (Wingdings square)', 'supported', '§17.9.17 numFmt bullet', { fmt: 'bullet', text: '', font: 'Wingdings' }, fmtIs('bullet'));
listItem('Bullet check mark (Wingdings)', 'supported', '§17.9.17 numFmt bullet', { fmt: 'bullet', text: '', font: 'Wingdings' }, (l) => val(l, 'w:numFmt') === 'bullet' && /|✓|✔/.test(val(l, 'w:lvlText') ?? ''));
listItem('Bullet colored and bold', 'supported', '§17.9.24 lvl rPr', { fmt: 'bullet', text: '■', rPr: '<w:b/><w:color w:val="C8553D"/>' }, (l) => val(l, 'w:numFmt') === 'bullet' && val(l, 'w:rPr/w:color')?.toUpperCase() === 'C8553D');
listItem('Numbered 1.', 'supported', '§17.9.17 numFmt decimal; Home ▸ Numbering', { fmt: 'decimal', text: '%1.' }, fmtIs('decimal', '%1.'));
listItem('Numbered a)', 'supported', '§17.9.17 numFmt lowerLetter', { fmt: 'lowerLetter', text: '%1)' }, fmtIs('lowerLetter', '%1)'));
listItem('Numbered A.', 'supported', '§17.9.17 numFmt upperLetter', { fmt: 'upperLetter', text: '%1.' }, fmtIs('upperLetter', '%1.'));
listItem('Numbered i.', 'supported', '§17.9.17 numFmt lowerRoman', { fmt: 'lowerRoman', text: '%1.' }, fmtIs('lowerRoman', '%1.'));
listItem('Numbered I.', 'supported', '§17.9.17 numFmt upperRoman', { fmt: 'upperRoman', text: '%1.' }, fmtIs('upperRoman', '%1.'));
listItem('Numbered (1)', 'supported', '§17.9.29 lvlText', { fmt: 'decimal', text: '(%1)' }, fmtIs('decimal', '(%1)'));
listItem('Numbered Step 1:', 'supported', '§17.9.29 lvlText', { fmt: 'decimal', text: 'Step %1:' }, fmtIs('decimal', 'Step %1:'));
listItem('Numbered 01, 02', 'kept', '§17.18.59 ST_NumberFormat decimalZero', { fmt: 'decimalZero', text: '%1.' }, fmtIs('decimalZero'), 'docx-read.ts:840 (abstractNum with nsid kept while unchanged)');
listItem('Numbered 1st, 2nd', 'kept', '§17.18.59 ordinal', { fmt: 'ordinal', text: '%1' }, fmtIs('ordinal'), 'docx-read.ts:840');
listItem('Numbered One, Two', 'kept', '§17.18.59 cardinalText', { fmt: 'cardinalText', text: '%1' }, fmtIs('cardinalText'), 'docx-read.ts:840');
listItem('Numbered First, Second', 'kept', '§17.18.59 ordinalText', { fmt: 'ordinalText', text: '%1' }, fmtIs('ordinalText'), 'docx-read.ts:840');
listItem('Numbered 一, 二 (Chinese counting)', 'kept', '§17.18.59 chineseCounting', { fmt: 'chineseCounting', text: '%1、' }, fmtIs('chineseCounting'), 'docx-read.ts:840');
listItem('Numbered with a dash 1-1 (no tab after)', 'kept', '§17.9.28 suff nothing', { fmt: 'decimal', text: '%1-', extra: '<w:suff w:val="nothing"/>' }, (l) => val(l, 'w:suff') === 'nothing', 'docx-read.ts:840');
listItem('Number aligned right', 'kept', '§17.9.8 lvlJc right', { fmt: 'decimal', text: '%1.', jc: 'right' }, (l) => val(l, 'w:lvlJc') === 'right', 'docx-read.ts:840');
listItem('Numbering starts at 5', 'supported', '§17.9.25 start', { fmt: 'decimal', text: '%1.', start: 5 }, (l) => val(l, 'w:start') === '5');

// multilevel
const outline = list([0, 1, 2].map((i) => ({ fmt: 'decimal', text: Array.from({ length: i + 1 }, (_, k) => `%${k + 1}`).join('.') + '.' })));
const ml: string[] = [];
const mlItem = (ilvl: number) => {
  const id = lst(`Multilevel 1. 1.1. 1.1.1. (level ${ilvl + 1})`, 'supported', '§17.9.12 multiLevelType; Home ▸ Multilevel List', (v) => {
    const np = kid(pPrOf(v, id), 'w:numPr');
    return val(np, 'w:ilvl') === String(ilvl) && (val(levelOf(v, id), 'w:lvlText') ?? '').split('%').length - 1 === ilvl + 1;
  });
  ml.push(numPara(`${id} level ${ilvl + 1}`, outline, ilvl));
};
mlItem(0); mlItem(1); mlItem(2); mlItem(1);
body.push(...ml);
const mixed = list([{ fmt: 'upperRoman', text: '%1.' }, { fmt: 'upperLetter', text: '%2.' }, { fmt: 'decimal', text: '%3)' }]);
const mixId = lst('Multilevel I. A. 1) (own scheme)', 'supported', '§17.9.12; ownSchemeId src/text/paragraphs.ts:177', (v) => val(levelOf(v, mixId), 'w:numFmt') === 'upperLetter');
body.push(numPara('top level', mixed, 0), numPara(`${mixId} second level`, mixed, 1), numPara('third level', mixed, 2));
const legal = list([0, 1].map((i) => ({ fmt: i ? 'decimal' : 'upperRoman', text: i ? '%1.%2' : '%1.', extra: i ? '<w:isLgl/>' : '' })));
const lgl = lst('Legal style numbering (Roman shown as Arabic)', 'kept', '§17.9.4 isLgl', (v) => !!kid(levelOf(v, lgl), 'w:isLgl'), 'docx-read.ts:840');
body.push(numPara('legal top', legal, 0), numPara(`${lgl} legal second level`, legal, 1));

// restart and continue
const base = list([{ fmt: 'decimal', text: '%1.' }]);
const restartNum = 900;
nums.push(`<w:num w:numId="${restartNum}"><w:abstractNumId w:val="${nextAbs - 1}"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>`);
const cont = lst('Continue numbering after a plain paragraph', 'supported', '§17.9.15 num (same numId)', (v) => val(kid(pPrOf(v, cont), 'w:numPr'), 'w:numId') !== null);
const rst = lst('Restart numbering at 1', 'supported', '§17.9.27 startOverride; right-click ▸ Restart at 1', (v) => {
  const a = val(kid(pPrOf(v, cont), 'w:numPr'), 'w:numId'), b = val(kid(pPrOf(v, rst), 'w:numPr'), 'w:numId');
  return !!a && !!b && a !== b;
});
body.push(numPara('one', base), numPara('two', base), para(run('a plain paragraph between')), numPara(`${cont} three, continuing`, base), numPara(`${rst} one again, restarted`, restartNum));

// picture bullets and style-linked lists
const pic = lst('Picture bullet', 'loss', '§17.9.21 numPicBullet; Bullets ▸ Define New Bullet ▸ Picture', (v) => !!kid(levelOf(v, pic), 'w:lvlPicBulletId'), 'docx-read.ts:858 (abstractNum with a picture bullet not kept)');
const picNum = list([{ fmt: 'bullet', text: '', font: 'Symbol', pic: 0 }]);
body.push(numPara(`${pic} picture bullet`, picNum));
const linkedAbs = nextAbs;
abstracts.push(`<w:abstractNum w:abstractNumId="${linkedAbs}"><w:nsid w:val="2C3D4E5F"/><w:multiLevelType w:val="multilevel"/><w:styleLink w:val="SamplerListStyle"/>${[0, 1].map((i) => lvlXml(i, { fmt: i ? 'lowerLetter' : 'decimal', text: `%${i + 1})` })).join('')}</w:abstractNum>`);
abstracts.push(`<w:abstractNum w:abstractNumId="${linkedAbs + 1}"><w:nsid w:val="3D4E5F60"/><w:multiLevelType w:val="multilevel"/><w:numStyleLink w:val="SamplerListStyle"/></w:abstractNum>`);
nextAbs += 2;
nums.push(`<w:num w:numId="300"><w:abstractNumId w:val="${linkedAbs}"/></w:num>`, `<w:num w:numId="301"><w:abstractNumId w:val="${linkedAbs + 1}"/></w:num>`);
const listStyle = lst('List style (numbering style link)', 'loss', '§17.9.27 numStyleLink, §17.9.30 styleLink; Multilevel List ▸ Define New List Style', (v) => v.all(/^word\/numbering\.xml$/, 'w:numStyleLink').length > 0 && !!styleByName(v, 'Sampler List Style'), 'docx-read.ts:858 (style-linked abstractNum resolved, not kept)');
body.push(numPara(`${listStyle} uses the list style`, 301));
// the paragraph style with numbering above uses numId 200
nums.push(`<w:num w:numId="200"><w:abstractNumId w:val="${base - 1}"/></w:num>`);
const numberedStyle = lst('Numbering from a paragraph style', 'supported', '§17.7.4.17 style numPr', (v) => usedStyleName(v, numberedStyle) === 'Sampler Numbered');
body.push(para(run(`${numberedStyle} numbered by its style`), '<w:pStyle w:val="SamplerNumbered"/>'));

const LIST_STYLE = '<w:style w:type="numbering" w:customStyle="1" w:styleId="SamplerListStyle"><w:name w:val="Sampler List Style"/><w:pPr><w:numPr><w:numId w:val="300"/></w:numPr></w:pPr></w:style>';
const PIC_BULLET = '<w:numPicBullet w:numPicBulletId="0"><w:pict><v:shape id="_x0000_i1025" type="#_x0000_t75" style="width:9pt;height:9pt" o:bullet="t"><v:imagedata r:id="rIdPicBullet" o:title=""/></v:shape></w:pict></w:numPicBullet>';

export const docxStylesLists: Sampler = {
  name: 'docx-styles-lists.docx', area: 'Word styles, style inheritance, bullets, numbering and multilevel lists', items,
  build: () => wordFile({
    title: 'Word sampler: styles and lists', styles: STYLES + LIST_STYLE,
    body: () => body.join(''),
    numbering: (w) => {
      w.pkg.add('word/media/bullet.png', png(12, 12, [27, 127, 121]));
      const rid = w.relFrom('numbering.xml', REL.image, 'media/bullet.png');
      return PIC_BULLET.replace('rIdPicBullet', rid) + abstracts.join('') + nums.join('');
    },
  }),
};
