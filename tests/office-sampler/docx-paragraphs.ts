/**
 * Word sampler: paragraph formatting (W-PAR). One paragraph per item, formatted with the item's
 * paragraph property. ECMA-376 Part 1 §17.3.1 (paragraph properties); Word's Paragraph dialog
 * (Indents and Spacing, Line and Page Breaks, Asian Typography), Borders and Shading, and Tabs.
 *
 * Tags from src/io/docx-read.ts readPPr (:630) and keptPPr (:1479): the kept properties are
 * KEPT_PPR (:171); jc distribute is shown as justify and kept (:2…); tab leaders middleDot and heavy
 * are mapped to dot and underscore (:104); paragraph shading keeps only its fill; pBdr bar and
 * character-unit indents and line-unit spacing are not read.
 */
import { type Item, type Sampler, itemList, at, kid, NS } from './kit';
import { wordFile, para, run, pPrOf, val, on } from './word';

const items: Item[] = [];
const it = itemList('W-PAR', items);
const body: string[] = [];
type T = 'supported' | 'kept' | 'loss';
const TEXT = ' The quick brown fox jumps over the lazy dog, and the second line wraps so that indents, spacing and alignment show.';
/** One item: a paragraph with `pPr` (in the schema's order) and a sentence long enough to wrap. */
const add = (feature: string, tag: T, spec: string, pPr: string, check: (p: Element | undefined) => boolean, basis?: string) => {
  const id = it(feature, tag, spec, (v) => check(pPrOf(v, id)), basis);
  body.push(para(run(`${id} ${feature}.${TEXT}`), pPr));
};
const has = (p: Element | undefined, path: string, attr: string, want: string) => at(kid(p, path), attr) === want;

// alignment (§17.3.1.13 jc, §17.18.44 ST_Jc)
add('Align left', 'supported', '§17.3.1.13 jc', '<w:jc w:val="left"/>', (p) => !kid(p, 'w:jc') || ['left', 'start'].includes(val(p, 'w:jc') ?? ''));
add('Center', 'supported', '§17.3.1.13 jc', '<w:jc w:val="center"/>', (p) => val(p, 'w:jc') === 'center');
add('Align right', 'supported', '§17.3.1.13 jc', '<w:jc w:val="right"/>', (p) => ['right', 'end'].includes(val(p, 'w:jc') ?? ''));
add('Justify', 'supported', '§17.3.1.13 jc', '<w:jc w:val="both"/>', (p) => val(p, 'w:jc') === 'both');
add('Distributed', 'kept', '§17.3.1.13 jc distribute', '<w:jc w:val="distribute"/>', (p) => val(p, 'w:jc') === 'distribute', 'docx-read.ts readPPr: shown as justify, kept as raw.jc');
add('Thai distributed', 'loss', '§17.3.1.13 jc thaiDistribute', '<w:jc w:val="thaiDistribute"/>', (p) => val(p, 'w:jc') === 'thaiDistribute', 'docx-read.ts readPPr (other jc values not read)');
add('Justify medium kashida', 'loss', '§17.3.1.13 jc mediumKashida', '<w:bidi/><w:jc w:val="mediumKashida"/>', (p) => val(p, 'w:jc') === 'mediumKashida', 'docx-read.ts readPPr');

// indents (§17.3.1.12 ind)
add('Left indent 0.5 in', 'supported', '§17.3.1.12 ind@left', '<w:ind w:left="720"/>', (p) => has(p, 'w:ind', 'w:left', '720') || has(p, 'w:ind', 'w:start', '720'));
add('Right indent 0.5 in', 'supported', '§17.3.1.12 ind@right', '<w:ind w:right="720"/>', (p) => has(p, 'w:ind', 'w:right', '720') || has(p, 'w:ind', 'w:end', '720'));
add('First line indent 0.25 in', 'supported', '§17.3.1.12 ind@firstLine', '<w:ind w:firstLine="360"/>', (p) => has(p, 'w:ind', 'w:firstLine', '360'));
add('Hanging indent 0.5 in', 'supported', '§17.3.1.12 ind@hanging', '<w:ind w:left="720" w:hanging="720"/>', (p) => has(p, 'w:ind', 'w:hanging', '720'));
add('Negative left indent', 'supported', '§17.3.1.12 ind@left', '<w:ind w:left="-360"/>', (p) => has(p, 'w:ind', 'w:left', '-360') || has(p, 'w:ind', 'w:start', '-360'));
add('Start and end indents', 'supported', '§17.3.1.12 ind@start/end', '<w:ind w:start="1080" w:end="1080"/>', (p) => (has(p, 'w:ind', 'w:start', '1080') || has(p, 'w:ind', 'w:left', '1080')) && (has(p, 'w:ind', 'w:end', '1080') || has(p, 'w:ind', 'w:right', '1080')));
add('Left indent in characters', 'loss', '§17.3.1.12 ind@leftChars', '<w:ind w:leftChars="200" w:left="420"/>', (p) => has(p, 'w:ind', 'w:leftChars', '200'), 'docx-read.ts readPPr (character units not read)');
add('Mirror indents', 'kept', '§17.3.1.18 mirrorIndents', '<w:ind w:left="1440"/><w:mirrorIndents/>', (p) => on(p, 'w:mirrorIndents'), 'KEPT_PPR');

// spacing (§17.3.1.33 spacing)
add('Space before 12 pt', 'supported', '§17.3.1.33 spacing@before', '<w:spacing w:before="240"/>', (p) => has(p, 'w:spacing', 'w:before', '240'));
add('Space after 18 pt', 'supported', '§17.3.1.33 spacing@after', '<w:spacing w:after="360"/>', (p) => has(p, 'w:spacing', 'w:after', '360'));
add('Line spacing 1.5 lines', 'supported', '§17.3.1.33 spacing@line auto', '<w:spacing w:line="360" w:lineRule="auto"/>', (p) => has(p, 'w:spacing', 'w:line', '360') && (at(kid(p, 'w:spacing'), 'w:lineRule') ?? 'auto') === 'auto');
add('Line spacing double', 'supported', '§17.3.1.33 spacing@line auto', '<w:spacing w:line="480" w:lineRule="auto"/>', (p) => has(p, 'w:spacing', 'w:line', '480'));
add('Line spacing exactly 15 pt', 'supported', '§17.3.1.33 spacing@lineRule exact', '<w:spacing w:line="300" w:lineRule="exact"/>', (p) => has(p, 'w:spacing', 'w:line', '300') && has(p, 'w:spacing', 'w:lineRule', 'exact'));
add('Line spacing at least 20 pt', 'supported', '§17.3.1.33 spacing@lineRule atLeast', '<w:spacing w:line="400" w:lineRule="atLeast"/>', (p) => has(p, 'w:spacing', 'w:line', '400') && has(p, 'w:spacing', 'w:lineRule', 'atLeast'));
add('Line spacing multiple 3', 'supported', '§17.3.1.33 spacing@line auto', '<w:spacing w:line="720" w:lineRule="auto"/>', (p) => has(p, 'w:spacing', 'w:line', '720'));
add('Auto space before and after', 'kept', '§17.3.1.33 spacing@beforeAutospacing', '<w:spacing w:before="100" w:beforeAutospacing="1" w:after="100" w:afterAutospacing="1"/>', (p) => has(p, 'w:spacing', 'w:beforeAutospacing', '1'), 'docx-read.ts readPPr (autospacing kept as a flag)');
add('Space before in lines', 'loss', '§17.3.1.33 spacing@beforeLines', '<w:spacing w:beforeLines="100" w:before="240"/>', (p) => has(p, 'w:spacing', 'w:beforeLines', '100'), 'docx-read.ts readPPr (line units not read)');
add("Don't add space between paragraphs of the same style", 'supported', '§17.3.1.9 contextualSpacing', '<w:spacing w:after="240"/><w:contextualSpacing/>', (p) => on(p, 'w:contextualSpacing'));

// line and page breaks
add('Keep with next', 'supported', '§17.3.1.15 keepNext', '<w:keepNext/>', (p) => on(p, 'w:keepNext'));
add('Keep lines together', 'supported', '§17.3.1.14 keepLines', '<w:keepLines/>', (p) => on(p, 'w:keepLines'));
add('Widow/Orphan control off', 'supported', '§17.3.1.44 widowControl', '<w:widowControl w:val="0"/>', (p) => val(p, 'w:widowControl') === '0' || val(p, 'w:widowControl') === 'false');
add('Page break before', 'supported', '§17.3.1.23 pageBreakBefore', '<w:pageBreakBefore/>', (p) => on(p, 'w:pageBreakBefore'));
add('Suppress line numbers', 'supported', '§17.3.1.34 suppressLineNumbers', '<w:suppressLineNumbers/>', (p) => on(p, 'w:suppressLineNumbers'));
add("Don't hyphenate", 'supported', '§17.3.1.33 suppressAutoHyphens', '<w:suppressAutoHyphens/>', (p) => on(p, 'w:suppressAutoHyphens'));

// borders and shading (§17.3.1.24 pBdr, §17.3.1.31 shd)
const bdr = (side: string, v = 'single', sz = 8, color = '1B7F79') => `<w:${side} w:val="${v}" w:sz="${sz}" w:space="4" w:color="${color}"/>`;
add('Box border', 'supported', '§17.3.1.24 pBdr', `<w:pBdr>${['top', 'left', 'bottom', 'right'].map((s) => bdr(s)).join('')}</w:pBdr>`, (p) => ['top', 'left', 'bottom', 'right'].every((s) => at(kid(p, `w:pBdr/w:${s}`), 'w:val') === 'single'));
add('Bottom border only, double', 'supported', '§17.3.1.24 pBdr bottom', `<w:pBdr>${bdr('bottom', 'double', 6, 'C8553D')}</w:pBdr>`, (p) => at(kid(p, 'w:pBdr/w:bottom'), 'w:val') === 'double');
add('Border space 4 pt kept', 'supported', '§17.3.1.24 pBdr@space', `<w:pBdr>${bdr('top')}</w:pBdr>`, (p) => at(kid(p, 'w:pBdr/w:top'), 'w:space') === '4');
add('Border color', 'supported', '§17.3.1.24 pBdr@color', `<w:pBdr>${bdr('left', 'single', 24, '6A4C93')}</w:pBdr>`, (p) => at(kid(p, 'w:pBdr/w:left'), 'w:color')?.toUpperCase() === '6A4C93');
add('Border width 3 pt', 'supported', '§17.3.1.24 pBdr@sz', `<w:pBdr>${bdr('right', 'single', 24)}</w:pBdr>`, (p) => at(kid(p, 'w:pBdr/w:right'), 'w:sz') === '24');
for (const b of ['dotted', 'dashed', 'thick', 'dotDash', 'triple', 'thinThickSmallGap', 'wave', 'doubleWave', 'threeDEmboss', 'outset']) {
  add(`Border style ${b}`, 'supported', `§17.3.1.24 pBdr, §17.18.2 ST_Border ${b}`, `<w:pBdr>${bdr('top', b, 12)}</w:pBdr>`, (p) => at(kid(p, 'w:pBdr/w:top'), 'w:val') === b);
}
add('Border between paragraphs', 'supported', '§17.3.1.5 between', `<w:pBdr>${bdr('between')}</w:pBdr>`, (p) => !!kid(p, 'w:pBdr/w:between'));
add('Bar border', 'loss', '§17.3.1.4 bar', `<w:pBdr>${bdr('bar')}</w:pBdr>`, (p) => !!kid(p, 'w:pBdr/w:bar'), 'docx-read.ts readPPr (bar not read)');
add('Shading fill', 'supported', '§17.3.1.31 shd', '<w:shd w:val="clear" w:color="auto" w:fill="EEF2E6"/>', (p) => at(kid(p, 'w:shd'), 'w:fill')?.toUpperCase() === 'EEF2E6');
add('Shading pattern 20%', 'loss', '§17.3.1.31 shd pct20', '<w:shd w:val="pct20" w:color="1B7F79" w:fill="FFFFFF"/>', (p) => val(p, 'w:shd') === 'pct20', 'docx-read.ts readPPr (only the fill is read)');
add('Shading theme fill', 'loss', '§17.3.1.31 shd@themeFill', '<w:shd w:val="clear" w:color="auto" w:fill="F2A541" w:themeFill="accent4"/>', (p) => at(kid(p, 'w:shd'), 'w:themeFill') === 'accent4', 'docx-read.ts readPPr');

// tabs (§17.3.1.37 tabs, §17.18.84 ST_TabJc, §17.18.85 ST_TabTlc)
const tabItem = (feature: string, tag: T, spec: string, stop: string, want: (t: Element[]) => boolean, basis?: string) => {
  const id = it(feature, tag, spec, (v) => want(Array.from(kid(pPrOf(v, id), 'w:tabs')?.children ?? [])), basis);
  body.push(para(run(`${id} ${feature}`) + '<w:r><w:tab/></w:r>' + run('after the tab'), `<w:tabs>${stop}</w:tabs>`));
};
const tabIs = (t: Element[], v: string, pos: string, leader?: string) => t.some((e) => at(e, 'w:val') === v && at(e, 'w:pos') === pos && (leader === undefined || (at(e, 'w:leader') ?? 'none') === leader));
tabItem('Left tab stop 3 in', 'supported', '§17.3.1.37 tabs left', '<w:tab w:val="left" w:pos="4320"/>', (t) => tabIs(t, 'left', '4320') || tabIs(t, 'start', '4320'));
tabItem('Center tab stop', 'supported', '§17.3.1.37 tabs center', '<w:tab w:val="center" w:pos="4680"/>', (t) => tabIs(t, 'center', '4680'));
tabItem('Right tab stop', 'supported', '§17.3.1.37 tabs right', '<w:tab w:val="right" w:pos="9360"/>', (t) => tabIs(t, 'right', '9360') || tabIs(t, 'end', '9360'));
tabItem('Decimal tab stop', 'supported', '§17.3.1.37 tabs decimal', '<w:tab w:val="decimal" w:pos="6480"/>', (t) => tabIs(t, 'decimal', '6480'));
tabItem('Bar tab', 'kept', '§17.3.1.37 tabs bar', '<w:tab w:val="bar" w:pos="2880"/>', (t) => tabIs(t, 'bar', '2880'), 'docx-read.ts readPPr (bar tabs kept)');
tabItem('Tab leader dots', 'supported', '§17.18.85 ST_TabTlc dot', '<w:tab w:val="right" w:leader="dot" w:pos="9360"/>', (t) => t.some((e) => at(e, 'w:leader') === 'dot'));
tabItem('Tab leader hyphens', 'supported', '§17.18.85 ST_TabTlc hyphen', '<w:tab w:val="right" w:leader="hyphen" w:pos="9360"/>', (t) => t.some((e) => at(e, 'w:leader') === 'hyphen'));
tabItem('Tab leader underline', 'supported', '§17.18.85 ST_TabTlc underscore', '<w:tab w:val="right" w:leader="underscore" w:pos="9360"/>', (t) => t.some((e) => at(e, 'w:leader') === 'underscore'));
tabItem('Tab leader middle dot', 'loss', '§17.18.85 ST_TabTlc middleDot', '<w:tab w:val="right" w:leader="middleDot" w:pos="9360"/>', (t) => t.some((e) => at(e, 'w:leader') === 'middleDot'), 'docx-read.ts:104 (mapped to dot)');
tabItem('Tab leader heavy', 'loss', '§17.18.85 ST_TabTlc heavy', '<w:tab w:val="right" w:leader="heavy" w:pos="9360"/>', (t) => t.some((e) => at(e, 'w:leader') === 'heavy'), 'docx-read.ts:104 (mapped to underscore)');
tabItem('Cleared tab stop', 'supported', '§17.3.1.37 tabs clear', '<w:tab w:val="clear" w:pos="720"/><w:tab w:val="left" w:pos="1440"/>', (t) => tabIs(t, 'left', '1440') || tabIs(t, 'start', '1440'));

// Asian typography and other kept properties
add("Don't allow Latin text to wrap mid-word (word wrap off)", 'kept', '§17.3.1.45 wordWrap', '<w:wordWrap w:val="0"/>', (p) => val(p, 'w:wordWrap') === '0', 'KEPT_PPR');
add('First and last character rules off (kinsoku)', 'kept', '§17.3.1.16 kinsoku', '<w:kinsoku w:val="0"/>', (p) => val(p, 'w:kinsoku') === '0', 'KEPT_PPR');
add('Allow punctuation to extend past border off', 'kept', '§17.3.1.21 overflowPunct', '<w:overflowPunct w:val="0"/>', (p) => val(p, 'w:overflowPunct') === '0', 'KEPT_PPR');
add('Allow punctuation at start of line to compress', 'kept', '§17.3.1.43 topLinePunct', '<w:topLinePunct/>', (p) => on(p, 'w:topLinePunct'), 'KEPT_PPR');
add('Automatic space between Asian and Latin text off', 'kept', '§17.3.1.2 autoSpaceDE', '<w:autoSpaceDE w:val="0"/><w:autoSpaceDN w:val="0"/>', (p) => val(p, 'w:autoSpaceDE') === '0' && val(p, 'w:autoSpaceDN') === '0', 'KEPT_PPR');
add('Right-to-left paragraph', 'kept', '§17.3.1.6 bidi', '<w:bidi/>', (p) => on(p, 'w:bidi'), 'KEPT_PPR');
add("Don't adjust right indent to grid", 'kept', '§17.3.1.1 adjustRightInd', '<w:adjustRightInd w:val="0"/>', (p) => val(p, 'w:adjustRightInd') === '0', 'KEPT_PPR');
add('Snap to grid off', 'kept', '§17.3.1.32 snapToGrid', '<w:snapToGrid w:val="0"/>', (p) => val(p, 'w:snapToGrid') === '0', 'KEPT_PPR');
add('Font alignment center', 'kept', '§17.3.1.39 textAlignment', '<w:textAlignment w:val="center"/>', (p) => val(p, 'w:textAlignment') === 'center', 'KEPT_PPR');
add('Outline level 2', 'supported', '§17.3.1.20 outlineLvl', '<w:outlineLvl w:val="1"/>', (p) => val(p, 'w:outlineLvl') === '1', 'docx-read.ts:669 (read and kept)');

// frames
const cap = it('Drop cap (dropped, 3 lines)', 'kept', '§17.3.1.11 framePr@dropCap; Insert ▸ Drop Cap', (v) => at(kid(pPrOf(v, cap), 'w:framePr'), 'w:dropCap') === 'drop', 'KEPT_PPR framePr (drop caps)');
body.push(para(run(cap, '<w:sz w:val="60"/>'), '<w:keepNext/><w:framePr w:dropCap="drop" w:lines="3" w:wrap="around" w:vAnchor="text" w:hAnchor="text"/><w:spacing w:after="0" w:line="827" w:lineRule="exact"/><w:textAlignment w:val="baseline"/>'));
body.push(para(run(`follows the drop cap.${TEXT}${TEXT}`)));
const frame = it('Text frame positioned on the page', 'supported', '§17.3.1.11 framePr; Insert Frame', (v) => { const f = kid(pPrOf(v, frame), 'w:framePr'); return !!f && at(f, 'w:dropCap') !== 'drop'; }, 'docx-read.ts readPPr (non-drop frames to ParaStyle.frame)');
body.push(para(run(`${frame} Text frame positioned on the page.`), '<w:framePr w:w="2880" w:hSpace="180" w:wrap="around" w:vAnchor="page" w:hAnchor="page" w:x="7200" w:y="2880"/><w:pBdr><w:top w:val="single" w:sz="4" w:space="1" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="4" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="1" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="4" w:color="auto"/></w:pBdr>'));

// paragraph mark formatting
const mark = it('Paragraph mark formatting (bold mark)', 'supported', '§17.3.1.29 rPr (paragraph mark)', (v) => !!kid(pPrOf(v, mark), 'w:rPr'));
body.push(para(run(`${mark} the paragraph mark is bold`), '<w:rPr><w:b/></w:rPr>'));

// an empty paragraph and a paragraph of only spaces
const empty = it('Empty paragraphs between text', 'supported', '§17.3.1.22 p', (v) => {
  const p = v.holding(/^word\/document\.xml$/, 'w:p', empty);
  const next = p?.nextElementSibling;
  return !!next && next.namespaceURI === NS.w && next.localName === 'p' && (next.textContent ?? '') === '';
});
body.push(para(run(`${empty} is followed by an empty paragraph`)), '<w:p/>', para(run('after the empty paragraph')));

export const docxParagraphs: Sampler = {
  name: 'docx-paragraphs.docx', area: 'Word paragraph formatting, borders, shading and tabs', items,
  build: () => wordFile({ title: 'Word sampler: paragraph formatting', body: () => body.join('') }),
};
