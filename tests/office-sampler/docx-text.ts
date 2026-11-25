/**
 * Word sampler: character formatting (W-CHR). One paragraph per item, its one run formatted with
 * the item's property. ECMA-376 Part 1 §17.3.2 (run properties); Word's Font dialog
 * (Home ▸ Font ▸ Font… and Advanced) and Home ▸ Font group.
 *
 * Tags from src/io/docx-read.ts readRPr (:510) and docx-write.ts runProps (:2079): the kept
 * properties are KEPT_RPR (docx-read.ts:159); a theme color is kept while its RGB is unchanged
 * (:556); szCs, bCs, iCs, eastAsia and cs fonts are rewritten from the Latin ones (write :2024, :2123).
 */
import { type Item, type Sampler, itemList, at, kid, NS } from './kit';
import { wordFile, line, para, run, rPrOf, paraOf, val, on } from './word';

const items: Item[] = [];
const it = itemList('W-CHR', items);
const body: string[] = [];
/** One item: a paragraph whose run has `rPr`, checked by `check` on that run's rPr. */
const add = (feature: string, tag: 'supported' | 'kept' | 'loss', spec: string, rPr: string, check: (rPr: Element | undefined) => boolean, basis?: string) => {
  const id = it(feature, tag, spec, (v) => check(rPrOf(v, id)), basis);
  body.push(line(id, feature, rPr));
};

add('Bold', 'supported', '§17.3.2.1 b', '<w:b/>', (r) => on(r, 'w:b'));
add('Italic', 'supported', '§17.3.2.16 i', '<w:i/>', (r) => on(r, 'w:i'));
add('Bold and italic', 'supported', '§17.3.2.1, §17.3.2.16', '<w:b/><w:i/>', (r) => on(r, 'w:b') && on(r, 'w:i'));
// every ST_Underline value (§17.18.99) but none
for (const u of ['single', 'words', 'double', 'thick', 'dotted', 'dottedHeavy', 'dash', 'dashedHeavy', 'dashLong', 'dashLongHeavy', 'dotDash', 'dashDotHeavy', 'dotDotDash', 'dashDotDotHeavy', 'wave', 'wavyHeavy', 'wavyDouble']) {
  add(`Underline ${u}`, 'supported', '§17.3.2.40 u, §17.18.99 ST_Underline', `<w:u w:val="${u}"/>`, (r) => val(r, 'w:u') === u, 'docx-read.ts:542 ukind');
}
add('Underline color', 'supported', '§17.3.2.40 u@color', '<w:u w:val="single" w:color="C8553D"/>', (r) => at(kid(r, 'w:u'), 'w:color')?.toUpperCase() === 'C8553D', 'docx-read.ts:542');
add('Underline theme color', 'loss', '§17.3.2.40 u@themeColor', '<w:u w:val="single" w:color="6A4C93" w:themeColor="accent3"/>', (r) => at(kid(r, 'w:u'), 'w:themeColor') === 'accent3', 'docx-read.ts:542 (theme underline color not kept)');
add('Strikethrough', 'supported', '§17.3.2.37 strike', '<w:strike/>', (r) => on(r, 'w:strike'));
add('Double strikethrough', 'supported', '§17.3.2.9 dstrike', '<w:dstrike/>', (r) => on(r, 'w:dstrike'));
add('Superscript', 'supported', '§17.3.2.42 vertAlign', '<w:vertAlign w:val="superscript"/>', (r) => val(r, 'w:vertAlign') === 'superscript');
add('Subscript', 'supported', '§17.3.2.42 vertAlign', '<w:vertAlign w:val="subscript"/>', (r) => val(r, 'w:vertAlign') === 'subscript');
add('Small caps', 'supported', '§17.3.2.33 smallCaps', '<w:smallCaps/>', (r) => on(r, 'w:smallCaps'));
add('All caps', 'supported', '§17.3.2.5 caps', '<w:caps/>', (r) => on(r, 'w:caps'));
add('Font color RGB', 'supported', '§17.3.2.6 color', '<w:color w:val="C8553D"/>', (r) => val(r, 'w:color')?.toUpperCase() === 'C8553D');
add('Font color theme (Accent 2)', 'kept', '§17.3.2.6 color@themeColor', '<w:color w:val="C8553D" w:themeColor="accent2"/>', (r) => at(kid(r, 'w:color'), 'w:themeColor') === 'accent2', 'docx-read.ts:556, docx-write.ts:2038');
add('Font color theme with shade', 'kept', '§17.3.2.6 color@themeShade', '<w:color w:val="145F5B" w:themeColor="accent1" w:themeShade="BF"/>', (r) => at(kid(r, 'w:color'), 'w:themeShade')?.toUpperCase() === 'BF', 'docx-read.ts:556');
add('Font color automatic', 'supported', '§17.3.2.6 color auto', '<w:color w:val="auto"/>', (r) => !kid(r, 'w:color') || val(r, 'w:color') === 'auto' || val(r, 'w:color') === '000000');
for (const h of ['yellow', 'green', 'cyan', 'magenta', 'darkBlue', 'darkRed', 'lightGray', 'black']) {
  add(`Highlight ${h}`, 'supported', '§17.3.2.15 highlight, §17.18.40 ST_HighlightColor', `<w:highlight w:val="${h}"/>`, (r) => val(r, 'w:highlight') === h);
}
add('Shading clear fill', 'supported', '§17.3.2.32 shd', '<w:shd w:val="clear" w:color="auto" w:fill="F2A541"/>', (r) => at(kid(r, 'w:shd'), 'w:fill')?.toUpperCase() === 'F2A541', 'docx-read.ts:583');
add('Shading pattern (pct25)', 'kept', '§17.3.2.32 shd, §17.18.78 ST_Shd', '<w:shd w:val="pct25" w:color="1B7F79" w:fill="FFFFFF"/>', (r) => val(r, 'w:shd') === 'pct25', 'docx-read.ts:583 raw.shd');
add('Shading theme fill', 'kept', '§17.3.2.32 shd@themeFill', '<w:shd w:val="clear" w:color="auto" w:fill="EEF2E6" w:themeFill="background2"/>', (r) => at(kid(r, 'w:shd'), 'w:themeFill') === 'background2', 'docx-read.ts:583 raw.shd');
add('Character spacing expanded 2 pt', 'supported', '§17.3.2.35 spacing', '<w:spacing w:val="40"/>', (r) => val(r, 'w:spacing') === '40');
add('Character spacing condensed 1 pt', 'supported', '§17.3.2.35 spacing', '<w:spacing w:val="-20"/>', (r) => val(r, 'w:spacing') === '-20');
add('Kerning from 14 pt', 'supported', '§17.3.2.19 kern', '<w:kern w:val="28"/>', (r) => val(r, 'w:kern') === '28');
add('Character scale 150%', 'kept', '§17.3.2.43 w', '<w:w w:val="150"/>', (r) => val(r, 'w:w') === '150', 'KEPT_RPR docx-read.ts:159');
add('Position raised 3 pt', 'supported', '§17.3.2.24 position', '<w:position w:val="6"/>', (r) => val(r, 'w:position') === '6');
add('Position lowered 3 pt', 'supported', '§17.3.2.24 position', '<w:position w:val="-6"/>', (r) => val(r, 'w:position') === '-6');
add('Size 8 pt', 'supported', '§17.3.2.38 sz', '<w:sz w:val="16"/><w:szCs w:val="16"/>', (r) => val(r, 'w:sz') === '16');
add('Size 36 pt', 'supported', '§17.3.2.38 sz', '<w:sz w:val="72"/><w:szCs w:val="72"/>', (r) => val(r, 'w:sz') === '72');
add('Size 10.5 pt (half point)', 'supported', '§17.3.2.38 sz', '<w:sz w:val="21"/><w:szCs w:val="21"/>', (r) => val(r, 'w:sz') === '21');
add('Complex-script size differs', 'loss', '§17.3.2.39 szCs', '<w:sz w:val="22"/><w:szCs w:val="32"/>', (r) => val(r, 'w:szCs') === '32', 'docx-write.ts (szCs written equal to sz)');
add('Complex-script bold only', 'loss', '§17.3.2.2 bCs', '<w:bCs/>', (r) => on(r, 'w:bCs') && !on(r, 'w:b'), 'docx-write.ts (bCs written equal to b)');
add('Font Times New Roman', 'supported', '§17.3.2.26 rFonts@ascii', '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/>', (r) => at(kid(r, 'w:rFonts'), 'w:ascii') === 'Times New Roman');
add('Font Courier New', 'supported', '§17.3.2.26 rFonts', '<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:cs="Courier New"/>', (r) => at(kid(r, 'w:rFonts'), 'w:ascii') === 'Courier New');
add('Font missing on this computer', 'supported', '§17.3.2.26 rFonts (font substitution)', '<w:rFonts w:ascii="No Such Font Sans" w:hAnsi="No Such Font Sans"/>', (r) => at(kid(r, 'w:rFonts'), 'w:ascii') === 'No Such Font Sans');
add('Theme heading font (+Headings)', 'kept', '§17.3.2.26 rFonts@asciiTheme', '<w:rFonts w:asciiTheme="majorHAnsi" w:hAnsiTheme="majorHAnsi"/>', (r) => at(kid(r, 'w:rFonts'), 'w:asciiTheme') === 'majorHAnsi', 'docx-read.ts:533 theme fonts kept while unchanged');
add('East Asian font differs from Latin', 'loss', '§17.3.2.26 rFonts@eastAsia', '<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="MS Mincho"/>', (r) => at(kid(r, 'w:rFonts'), 'w:eastAsia') === 'MS Mincho', 'docx-write.ts:2024');
add('Complex-script font differs from Latin', 'loss', '§17.3.2.26 rFonts@cs', '<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Times New Roman"/>', (r) => at(kid(r, 'w:rFonts'), 'w:cs') === 'Times New Roman', 'docx-write.ts:2024');
add('Outline', 'kept', '§17.3.2.23 outline', '<w:outline/>', (r) => on(r, 'w:outline'), 'KEPT_RPR');
add('Shadow', 'kept', '§17.3.2.31 shadow', '<w:shadow/>', (r) => on(r, 'w:shadow'), 'KEPT_RPR');
add('Emboss', 'kept', '§17.3.2.13 emboss', '<w:emboss/>', (r) => on(r, 'w:emboss'), 'KEPT_RPR');
add('Engrave (imprint)', 'kept', '§17.3.2.18 imprint', '<w:imprint/>', (r) => on(r, 'w:imprint'), 'KEPT_RPR');
add('Hidden text', 'supported', '§17.3.2.41 vanish', '<w:vanish/>', (r) => on(r, 'w:vanish'));
add('Do not check spelling', 'supported', '§17.3.2.21 noProof', '<w:noProof/>', (r) => on(r, 'w:noProof'));
add('Language French', 'supported', '§17.3.2.20 lang', '<w:lang w:val="fr-FR"/>', (r) => val(r, 'w:lang') === 'fr-FR');
add('Language East Asian (Japanese)', 'loss', '§17.3.2.20 lang@eastAsia', '<w:lang w:val="en-US" w:eastAsia="ja-JP"/>', (r) => at(kid(r, 'w:lang'), 'w:eastAsia') === 'ja-JP', 'docx-write.ts:2123');
add('Text effect (marching red ants)', 'kept', '§17.3.2.12 effect', '<w:effect w:val="antsRed"/>', (r) => val(r, 'w:effect') === 'antsRed', 'KEPT_RPR');
add('Emphasis mark dot', 'kept', '§17.3.2.12 em', '<w:em w:val="dot"/>', (r) => val(r, 'w:em') === 'dot', 'KEPT_RPR');
add('Character border', 'kept', '§17.3.2.4 bdr', '<w:bdr w:val="single" w:sz="4" w:space="0" w:color="1B7F79"/>', (r) => val(r, 'w:bdr') === 'single', 'KEPT_RPR');
add('Fit text to 1 inch', 'kept', '§17.3.2.14 fitText', '<w:fitText w:val="1440" w:id="1001"/>', (r) => val(r, 'w:fitText') === '1440', 'KEPT_RPR');
add('Snap to grid off', 'kept', '§17.3.2.34 snapToGrid', '<w:snapToGrid w:val="0"/>', (r) => val(r, 'w:snapToGrid') === '0', 'KEPT_RPR');
add('Web hidden', 'kept', '§17.3.2.44 webHidden', '<w:webHidden/>', (r) => on(r, 'w:webHidden'), 'KEPT_RPR');
add('Glow (Word 2010 text effect)', 'kept', 'Word 2010 w14:glow; Home ▸ Text Effects ▸ Glow', '<w14:glow w14:rad="63500"><w14:srgbClr w14:val="F2A541"><w14:alpha w14:val="60000"/></w14:srgbClr></w14:glow>', (r) => !!r && Array.from(r.children).some((c) => c.localName === 'glow'), 'docx-base.ts:83');
add('Text outline (Word 2010)', 'kept', 'Word 2010 w14:textOutline; Home ▸ Text Effects ▸ Outline', '<w14:textOutline w14:w="9525" w14:cap="flat" w14:cmpd="sng" w14:algn="ctr"><w14:solidFill><w14:srgbClr w14:val="C8553D"/></w14:solidFill><w14:prstDash w14:val="solid"/><w14:round/></w14:textOutline>', (r) => !!r && Array.from(r.children).some((c) => c.localName === 'textOutline'), 'docx-base.ts:83');
add('Ligatures all (Word 2010)', 'kept', 'Word 2010 w14:ligatures; Font ▸ Advanced ▸ Ligatures', '<w14:ligatures w14:val="all"/>', (r) => !!r && Array.from(r.children).some((c) => c.localName === 'ligatures'), 'docx-base.ts:83');
add('Character style (custom, unlinked)', 'supported', '§17.3.2.29 rStyle, §17.7.4.17 style', '<w:rStyle w:val="SamplerEmphasis"/>', (r) => val(r, 'w:rStyle') === 'SamplerEmphasis', 'docx-read.ts:797 keptCharStyle');
add('Hyperlink character style', 'supported', '§17.3.2.29 rStyle', '<w:rStyle w:val="Hyperlink"/>', (r) => val(r, 'w:rStyle') === 'Hyperlink');
add('Right-to-left run', 'kept', '§17.3.2.30 rtl', '<w:rtl/>', (r) => on(r, 'w:rtl'), 'KEPT_RPR');

// symbols and scripts in the same file: a symbol character, and text in several scripts
const sym = it('Symbol character (Wingdings)', 'loss', '§17.3.3.30 sym; Insert ▸ Symbol', (v) => v.all(/^word\/document\.xml$/, 'w:sym').some((s) => at(s, 'w:char') === 'F04A'), 'docx-read.ts:2105 (written as a PUA character, not w:sym)');
body.push(para(run(`${sym} smile: `) + '<w:r><w:sym w:font="Wingdings" w:char="F04A"/></w:r>'));
const greek = it('Greek and math letters', 'supported', '§17.3.3.31 t (Unicode text)', (v) => v.parts['word/document.xml'].includes('αβγ ∑∫√'));
body.push(para(run(`${greek} αβγ ∑∫√`)));
const cjk = it('Chinese and Japanese text', 'supported', '§17.3.3.31 t', (v) => (paraOf(v, cjk)?.textContent ?? '').includes('化学 化學 かがく'));
body.push(para(run(`${cjk} 化学 化學 かがく`, '<w:rFonts w:eastAsia="SimSun" w:hint="eastAsia"/><w:lang w:eastAsia="zh-CN"/>')));
const ar = it('Arabic text right to left', 'kept', '§17.3.2.30 rtl, §17.3.1.6 bidi', (v) => v.parts['word/document.xml'].includes('كيمياء'), 'KEPT_PPR bidi, KEPT_RPR rtl');
body.push(para(run(`${ar} `) + run('كيمياء', '<w:rtl/><w:lang w:bidi="ar-SA"/>'), '<w:bidi/>'));
const he = it('Hebrew text right to left', 'kept', '§17.3.2.30 rtl', (v) => v.parts['word/document.xml'].includes('כימיה'));
body.push(para(run(`${he} `) + run('כימיה', '<w:rtl/><w:lang w:bidi="he-IL"/>'), '<w:bidi/>'));
const emoji = it('Emoji outside the Basic Multilingual Plane', 'supported', '§17.3.3.31 t (UTF-16 surrogate pairs)', (v) => (paraOf(v, emoji)?.textContent ?? '').includes('🧪⚗️'));
body.push(para(run(`${emoji} 🧪⚗️`)));
const tab: string = it('Tab character and no-break space', 'supported', '§17.3.3.32 tab', (v) => {
  const p = v.holding(/^word\/document\.xml$/, 'w:p', tab);
  return !!p && p.getElementsByTagNameNS(NS.w, 'tab').length > 0 && (p.textContent ?? '').includes('b c');
});
body.push(para(run(`${tab} a`) + '<w:r><w:tab/></w:r>' + run('b c')));
const soft = it('Optional hyphen and no-break hyphen', 'supported', '§17.3.3.29 softHyphen, §17.3.3.18 noBreakHyphen', (v) => v.all(/^word\/document\.xml$/, 'w:softHyphen').length + v.all(/^word\/document\.xml$/, 'w:noBreakHyphen').length >= 2 || /­/.test(v.parts['word/document.xml']));
body.push(para(run(`${soft} chemi`) + '<w:r><w:softHyphen/></w:r>' + run('stry 2') + '<w:r><w:noBreakHyphen/></w:r>' + run('methyl')));

const STYLES = '<w:style w:type="character" w:customStyle="1" w:styleId="SamplerEmphasis"><w:name w:val="Sampler Emphasis"/><w:basedOn w:val="DefaultParagraphFont"/><w:rPr><w:b/><w:color w:val="6A4C93"/></w:rPr></w:style>';

export const docxText: Sampler = {
  name: 'docx-text.docx', area: 'Word character formatting, symbols and scripts', items,
  build: () => wordFile({ title: 'Word sampler: character formatting', styles: STYLES, body: () => body.join('') }),
};
