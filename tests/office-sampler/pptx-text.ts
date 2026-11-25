/**
 * PowerPoint sampler: text (P-TXT text box options, P-CHR character formatting, P-PAR paragraph
 * formatting, P-BUL bullets and numbering). Each item is a text box whose first run holds its id.
 * ECMA-376 Part 1 §21.1.2 (DrawingML text: bodyPr §21.1.2.1.1, pPr §21.1.2.2.7, rPr §21.1.2.3.9);
 * PowerPoint's Format Shape ▸ Text Options ▸ Text Box, Home ▸ Font, Home ▸ Paragraph and
 * Bullets/Numbering menus.
 *
 * Tags from src/io/pptx-read.ts text() (:2654): runs keep what readRunKept keeps
 * (pptx-keep.ts:62), paragraphs what readParaKept keeps (:166), and a text box that isn't a
 * placeholder its whole a:bodyPr and a:xfrm (keptFrame, pptx-keep.ts:222) while its fit,
 * direction and turn are as read; numCol/spcCol are read (:2886).
 */
import { type Item, type Sampler, itemList, at, kid, NS, png } from './kit';
import { deckFile, textBox, para, r, txBody, sp, solid, NOFILL, line, rPrOf, pPrOf, bodyPrOf, paraOf, runOf, shapeOf, boxOf, spPrOf, type SlideCtx, type SlideDef } from './pptx';

const items: Item[] = [];
type Tag = 'supported' | 'kept' | 'loss';
/** One slide's worth of items: each adds a text box made by `make` (given its id). */
type Maker = (s: SlideCtx) => string;
const slides: Maker[][] = [];
let cur: Maker[] = [];
const newSlide = () => { cur = []; slides.push(cur); };

// ---------------------------------------------------------------- text box options (bodyPr)

const txt = itemList('P-TXT', items);
newSlide();
/** A text box with this a:bodyPr (whole element), checked on the saved bodyPr. */
const box = (feature: string, tag: Tag, spec: string, bodyPr: string, check: (bp: Element | undefined) => boolean, basis = 'pptx-keep.ts:222 keptFrame (bodyPr kept whole)', words = 'The quick brown fox jumps over the lazy dog.', fmt = solid('EEF2E6')) => {
  const id = txt(feature, tag, spec, (v) => check(bodyPrOf(v, id)), basis);
  cur.push((s) => textBox(s.id(), `${id} text box`, s.cell(), para(r(`${id} ${feature}. ${words}`, 'sz="1200"')), bodyPr, fmt));
};
const bpa = (bp: Element | undefined, a: string) => at(bp ?? null, a);
box('Wrap text in shape off', 'kept', '§21.1.2.1.1 bodyPr@wrap; Format Shape ▸ Text Box ▸ Wrap text in shape', '<a:bodyPr wrap="none" rtlCol="0"><a:spAutoFit/></a:bodyPr>', (bp) => bpa(bp, 'wrap') === 'none', 'pptx-read.ts:2873 wrap none; keptFrame', 'Short.');
box('Vertical alignment Top', 'kept', '§21.1.2.1.1 bodyPr@anchor, §20.1.10.59 ST_TextAnchoringType', '<a:bodyPr wrap="square" anchor="t"><a:noAutofit/></a:bodyPr>', (bp) => (bpa(bp, 'anchor') ?? 't') === 't');
box('Vertical alignment Middle', 'kept', '§21.1.2.1.1 bodyPr@anchor', '<a:bodyPr wrap="square" anchor="ctr"><a:noAutofit/></a:bodyPr>', (bp) => bpa(bp, 'anchor') === 'ctr');
box('Vertical alignment Bottom', 'kept', '§21.1.2.1.1 bodyPr@anchor', '<a:bodyPr wrap="square" anchor="b"><a:noAutofit/></a:bodyPr>', (bp) => bpa(bp, 'anchor') === 'b');
box('Vertical alignment Top Centered', 'kept', '§21.1.2.1.1 bodyPr@anchorCtr', '<a:bodyPr wrap="square" anchor="t" anchorCtr="1"><a:noAutofit/></a:bodyPr>', (bp) => bpa(bp, 'anchorCtr') === '1');
box('Vertical alignment Justified', 'kept', '§20.1.10.59 ST_TextAnchoringType just', '<a:bodyPr wrap="square" anchor="just"><a:noAutofit/></a:bodyPr>', (bp) => bpa(bp, 'anchor') === 'just');
box('Vertical alignment Distributed', 'kept', '§20.1.10.59 ST_TextAnchoringType dist', '<a:bodyPr wrap="square" anchor="dist"><a:noAutofit/></a:bodyPr>', (bp) => bpa(bp, 'anchor') === 'dist');
box('Internal margins 0.5 in left, 0.1 in top, 0.25 in right, 0.2 in bottom', 'kept', '§21.1.2.1.1 bodyPr@lIns/tIns/rIns/bIns; Format Shape ▸ Text Box ▸ Left/Right/Top/Bottom margin', '<a:bodyPr wrap="square" lIns="457200" tIns="91440" rIns="228600" bIns="182880"><a:noAutofit/></a:bodyPr>', (bp) => bpa(bp, 'lIns') === '457200' && bpa(bp, 'tIns') === '91440' && bpa(bp, 'rIns') === '228600' && bpa(bp, 'bIns') === '182880');
box('Margins zero', 'kept', '§21.1.2.1.1 bodyPr insets', '<a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0"><a:spAutoFit/></a:bodyPr>', (bp) => bpa(bp, 'lIns') === '0' && bpa(bp, 'bIns') === '0');
box('Do not Autofit', 'kept', '§21.1.2.1.2 noAutofit; Format Shape ▸ Text Box ▸ Do not Autofit', '<a:bodyPr wrap="square"><a:noAutofit/></a:bodyPr>', (bp) => !!kid(bp, 'a:noAutofit'), 'pptx-read.ts:2894 fit fixed');
box('Shrink text on overflow', 'kept', '§21.1.2.1.3 normAutofit; Format Shape ▸ Text Box ▸ Shrink text on overflow', '<a:bodyPr wrap="square"><a:normAutofit fontScale="62500" lnSpcReduction="20000"/></a:bodyPr>', (bp) => !!kid(bp, 'a:normAutofit'), 'pptx-read.ts:2893 fit shrink', 'Shrunk text. '.repeat(12));
box('Shrink text on overflow: font scale 62.5% and line spacing reduction 20%', 'kept', '§21.1.2.1.3 normAutofit@fontScale/@lnSpcReduction', '<a:bodyPr wrap="square"><a:normAutofit fontScale="62500" lnSpcReduction="20000"/></a:bodyPr>', (bp) => at(kid(bp, 'a:normAutofit') ?? null, 'fontScale') === '62500' && at(kid(bp, 'a:normAutofit') ?? null, 'lnSpcReduction') === '20000', 'keptFrame', 'Shrunk text. '.repeat(12));
box('Resize shape to fit text', 'kept', '§21.1.2.1.4 spAutoFit; Format Shape ▸ Text Box ▸ Resize shape to fit text', '<a:bodyPr wrap="square"><a:spAutoFit/></a:bodyPr>', (bp) => !!kid(bp, 'a:spAutoFit'));
box('Columns: 2 with 0.2 in spacing', 'supported', '§21.1.2.1.1 bodyPr@numCol/@spcCol; Format Shape ▸ Text Box ▸ Columns', '<a:bodyPr wrap="square" numCol="2" spcCol="182880"><a:noAutofit/></a:bodyPr>', (bp) => bpa(bp, 'numCol') === '2' && bpa(bp, 'spcCol') === '182880', 'pptx-read.ts:2886 cols, colGap', 'One two three four five six seven eight nine ten eleven twelve.');
box('Columns: 3', 'supported', '§21.1.2.1.1 bodyPr@numCol', '<a:bodyPr wrap="square" numCol="3" spcCol="91440"><a:noAutofit/></a:bodyPr>', (bp) => bpa(bp, 'numCol') === '3', 'pptx-read.ts:2886', 'One two three four five six seven eight nine ten eleven twelve.');
box('Columns right to left', 'kept', '§21.1.2.1.1 bodyPr@rtlCol', '<a:bodyPr wrap="square" numCol="2" rtlCol="1"><a:noAutofit/></a:bodyPr>', (bp) => bpa(bp, 'rtlCol') === '1', 'keptFrame', 'One two three four five six seven eight nine ten.');
newSlide();
box('Text direction Rotate all text 90°', 'supported', '§21.1.2.1.1 bodyPr@vert, §20.1.10.83 ST_TextVerticalType vert; Home ▸ Text Direction', '<a:bodyPr vert="vert" wrap="square"><a:noAutofit/></a:bodyPr>', (bp) => bpa(bp, 'vert') === 'vert', 'pptx-read.ts vert -> dir', 'Turned.');
box('Text direction Rotate all text 270°', 'supported', '§20.1.10.83 ST_TextVerticalType vert270', '<a:bodyPr vert="vert270" wrap="square"><a:noAutofit/></a:bodyPr>', (bp) => bpa(bp, 'vert') === 'vert270', 'pptx-read.ts vert270 kept', 'Turned.');
box('Text direction Stacked', 'kept', '§20.1.10.83 ST_TextVerticalType wordArtVert', '<a:bodyPr vert="wordArtVert" wrap="square"><a:noAutofit/></a:bodyPr>', (bp) => bpa(bp, 'vert') === 'wordArtVert', 'pptx-read.ts or pptx-write.ts, not traced to a line: other vert values -> horizontal', 'Stack');
box('Text direction East Asian vertical', 'kept', '§20.1.10.83 ST_TextVerticalType eaVert', '<a:bodyPr vert="eaVert" wrap="square"><a:noAutofit/></a:bodyPr>', (bp) => bpa(bp, 'vert') === 'eaVert', 'pptx-read.ts or pptx-write.ts, not traced to a line: eaVert -> vert', '縦書き');
box('Text direction Mongolian vertical', 'kept', '§20.1.10.83 ST_TextVerticalType mongolianVert', '<a:bodyPr vert="mongolianVert" wrap="square"><a:noAutofit/></a:bodyPr>', (bp) => bpa(bp, 'vert') === 'mongolianVert', 'pptx-read.ts or pptx-write.ts, not traced to a line: other vert values -> horizontal', 'Text');
box('Text direction Stacked right to left', 'kept', '§20.1.10.83 ST_TextVerticalType wordArtVertRtl', '<a:bodyPr vert="wordArtVertRtl" wrap="square"><a:noAutofit/></a:bodyPr>', (bp) => bpa(bp, 'vert') === 'wordArtVertRtl', 'pptx-read.ts or pptx-write.ts, not traced to a line', 'Text');
box('Text rotation inside the shape (bodyPr rot 30°)', 'kept', '§21.1.2.1.1 bodyPr@rot', '<a:bodyPr rot="1800000" wrap="square"><a:noAutofit/></a:bodyPr>', (bp) => bpa(bp, 'rot') === '1800000');
box('Do not rotate text with shape (upright)', 'kept', '§21.1.2.1.1 bodyPr@upright', '<a:bodyPr wrap="square" upright="1"><a:noAutofit/></a:bodyPr>', (bp) => bpa(bp, 'upright') === '1');
box('Vertical overflow clip', 'kept', '§21.1.2.1.1 bodyPr@vertOverflow, §20.1.10.84', '<a:bodyPr vertOverflow="clip" wrap="square"><a:noAutofit/></a:bodyPr>', (bp) => bpa(bp, 'vertOverflow') === 'clip', 'keptFrame', 'Clipped text. '.repeat(10));
box('Vertical overflow ellipsis', 'kept', '§20.1.10.84 ST_TextVertOverflowType ellipsis', '<a:bodyPr vertOverflow="ellipsis" wrap="square"><a:noAutofit/></a:bodyPr>', (bp) => bpa(bp, 'vertOverflow') === 'ellipsis', 'keptFrame', 'Ellipsis text. '.repeat(10));
box('Horizontal overflow clip', 'kept', '§21.1.2.1.1 bodyPr@horzOverflow', '<a:bodyPr horzOverflow="clip" wrap="none"><a:noAutofit/></a:bodyPr>', (bp) => bpa(bp, 'horzOverflow') === 'clip', 'keptFrame', 'A long line that does not wrap and runs past the box edge.');
box('Space before first and after last paragraph', 'kept', '§21.1.2.1.1 bodyPr@spcFirstLastPara', '<a:bodyPr wrap="square" spcFirstLastPara="1"><a:noAutofit/></a:bodyPr>', (bp) => bpa(bp, 'spcFirstLastPara') === '1');
box('Text transform (WordArt) Arch Up', 'kept', '§20.1.9.19 prstTxWarp textArchUp; Format ▸ Text Effects ▸ Transform', '<a:bodyPr wrap="square"><a:prstTxWarp prst="textArchUp"><a:avLst/></a:prstTxWarp><a:noAutofit/></a:bodyPr>', (bp) => at(kid(bp, 'a:prstTxWarp') ?? null, 'prst') === 'textArchUp', 'keptFrame', 'Arched.');
box('Text transform Wave 1 with adjust value', 'kept', '§20.1.9.19 prstTxWarp textWave1', '<a:bodyPr wrap="square"><a:prstTxWarp prst="textWave1"><a:avLst><a:gd name="adj1" fmla="val 20000"/><a:gd name="adj2" fmla="val 0"/></a:avLst></a:prstTxWarp><a:noAutofit/></a:bodyPr>', (bp) => at(kid(bp, 'a:prstTxWarp') ?? null, 'prst') === 'textWave1', 'keptFrame', 'Wavy.');
box('3-D text (bodyPr scene3d and sp3d)', 'kept', '§21.1.2.1.1 bodyPr scene3d, §20.1.5.12 sp3d', '<a:bodyPr wrap="square"><a:noAutofit/><a:scene3d><a:camera prst="perspectiveRelaxed"/><a:lightRig rig="threePt" dir="t"/></a:scene3d><a:sp3d extrusionH="57150"><a:bevelT w="38100" h="38100"/></a:sp3d></a:bodyPr>', (bp) => !!kid(bp, 'a:scene3d') && !!kid(bp, 'a:sp3d'), 'keptFrame', '3-D.');
box('Anti-aliasing forced and compatible line spacing', 'kept', '§21.1.2.1.1 bodyPr@forceAA/@compatLnSpc', '<a:bodyPr wrap="square" forceAA="1" compatLnSpc="1"><a:noAutofit/></a:bodyPr>', (bp) => bpa(bp, 'forceAA') === '1' && bpa(bp, 'compatLnSpc') === '1');
// text in a shape (not a text box): a rounded rectangle with text anchored to the bottom
{
  const id = txt('Text in a shape anchored bottom', 'supported', '§20.1.2.2.37 sp txBody, §21.1.2.1.1 bodyPr@anchor; Format Shape ▸ Text Box ▸ Vertical alignment', (v) => at(bodyPrOf(v, id) ?? null, 'anchor') === 'b', 'pptx-write.ts:1564 geo() anchor from textValign');
  const id2 = txt('Text in a shape with its own internal margins', 'loss', '§21.1.2.1.1 bodyPr@lIns', (v) => at(bodyPrOf(v, id) ?? null, 'lIns') === '182880', 'pptx-write.ts:1565 geo() writes fixed 3.6 pt insets');
  cur.push((s) => sp({ id: s.id(), name: `${id} ${id2} shape`, box: s.cell(), geom: '<a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom>', fmt: solid('8AB17D') + line(1, solid('1F3A4D')), body: txBody(para(r(`${id} ${id2} text in a shape`, 'sz="1200"'), 'algn="ctr"'), '<a:bodyPr wrap="square" lIns="182880" anchor="b"><a:noAutofit/></a:bodyPr>') }));
}
// a text box with several paragraphs (a text box's own box and paragraphs together)
{
  const id = txt('Text box with three paragraphs', 'supported', '§21.1.2.2.6 p', (v) => { const p = paraOf(v, id); const tb = p?.parentElement; return !!tb && tb.getElementsByTagNameNS(NS.a, 'p').length >= 3; });
  const id2 = txt('Line break inside a paragraph (Shift+Enter)', 'loss', '§21.1.2.2.1 br', (v) => { const p = paraOf(v, id); const tb = p?.parentElement; return !!tb && tb.getElementsByTagNameNS(NS.a, 'br').length >= 1; }, 'pptx-read.ts:2775 (a:br read as a new paragraph)');
  cur.push((s) => textBox(s.id(), `${id} text box`, s.cell(), para(r(`${id} ${id2} first paragraph`, 'sz="1200"')) + `<a:p>${r('second, line one', 'sz="1200"')}<a:br><a:rPr lang="en-US" sz="1200"/></a:br>${r('line two', 'sz="1200"')}</a:p>` + para(r('third', 'sz="1200"'))));
}
{
  const id = txt('Text box keeps its position and size', 'supported', '§20.1.7.6 xfrm; Format Shape ▸ Size & Position', (v) => { const b = boxOf(shapeOf(v, id)); return !!b && Math.abs(b[0] - 300) < 0.5 && Math.abs(b[1] - 470) < 0.5 && Math.abs(b[2] - 200) < 0.5 && Math.abs(b[3] - 50) < 0.5; }, 'keptFrame xf');
  cur.push((s) => textBox(s.id(), `${id} text box`, [300, 470, 200, 50], para(r(`${id} fixed box`, 'sz="1200"')), '<a:bodyPr wrap="square"><a:noAutofit/></a:bodyPr>'));
  const id2 = txt('Text box with text rotated 90° keeps its position and size', 'supported', '§20.1.7.6 xfrm, §21.1.2.1.1 bodyPr@vert', (v) => { const b = boxOf(shapeOf(v, id2)); return !!b && Math.abs(b[0] - 520) < 0.5 && Math.abs(b[1] - 400) < 0.5 && Math.abs(b[2] - 60) < 0.5 && Math.abs(b[3] - 130) < 0.5; }, 'keptFrame xf; pptx-read.ts:1900 quarter turn');
  cur.push((s) => textBox(s.id(), `${id2} text box`, [520, 400, 60, 130], para(r(`${id2} turned`, 'sz="1000"')), '<a:bodyPr vert="vert" wrap="square"><a:noAutofit/></a:bodyPr>'));
  const id3 = txt('Text box turned 30° (shape rotation) keeps its position and size', 'supported', '§20.1.7.6 xfrm@rot; Format Shape ▸ Size ▸ Rotation', (v) => { const e = shapeOf(v, id3); const b = boxOf(e); return !!b && Math.abs(b[0] - 620) < 0.5 && Math.abs(b[1] - 440) < 0.5 && at(kid(spPrOf(e), 'a:xfrm') ?? null, 'rot') === '1800000'; }, 'keptFrame xf');
  cur.push((s) => textBox(s.id(), `${id3} text box`, [620, 440, 180, 40], para(r(`${id3} turned box`, 'sz="1000"')), '<a:bodyPr wrap="square"><a:noAutofit/></a:bodyPr>', NOFILL, '', ' rot="1800000"'));
}
{
  const id = txt('Empty paragraph end properties (endParaRPr size)', 'loss', '§21.1.2.2.3 endParaRPr', (v) => { const p = paraOf(v, id); return at(kid(p, 'a:endParaRPr') ?? null, 'sz') === '2000'; }, 'not modelled');
  cur.push((s) => textBox(s.id(), `${id} text box`, s.cell(), `<a:p>${r(`${id} end paragraph properties`, 'sz="1200"')}<a:endParaRPr lang="en-US" sz="2000"/></a:p>`));
}

// ---------------------------------------------------------------- character formatting (rPr)

const chr = itemList('P-CHR', items);
newSlide();
let perSlide = 0;
/** A text box whose one run has these rPr attributes and children. */
const run = (feature: string, tag: Tag, spec: string, attrs: string, inner: string, check: (rPr: Element | undefined) => boolean, basis?: string) => {
  if (perSlide++ === 24) { newSlide(); perSlide = 1; }
  const id = chr(feature, tag, spec, (v) => check(rPrOf(v, id)), basis);
  cur.push((s) => textBox(s.id(), `${id} text box`, s.cell(), para(r(`${id} ${feature}`, /sz=/.test(attrs) ? attrs : `sz="1400"${attrs ? ' ' + attrs : ''}`, inner))));
};
const ra = (e: Element | undefined, a: string) => at(e ?? null, a);
run('Bold', 'supported', '§21.1.2.3.9 rPr@b; Home ▸ Font ▸ Bold', 'b="1"', '', (e) => ra(e, 'b') === '1');
run('Italic', 'supported', '§21.1.2.3.9 rPr@i', 'i="1"', '', (e) => ra(e, 'i') === '1');
for (const u of ['sng', 'dbl', 'heavy', 'dotted', 'dottedHeavy', 'dash', 'dashHeavy', 'dashLong', 'dashLongHeavy', 'dotDash', 'dotDashHeavy', 'dotDotDash', 'dotDotDashHeavy', 'wavy', 'wavyHeavy', 'wavyDbl', 'words']) {
  run(`Underline ${u}`, 'supported', '§21.1.2.3.9 rPr@u, §20.1.10.82 ST_TextUnderlineType; Font ▸ Underline style', `u="${u}"`, '', (e) => ra(e, 'u') === u, 'pptx-keep.ts:116 PPT_U');
}
run('Underline color (uFill)', 'kept', '§21.1.2.3.33 uFill; Font ▸ Underline color', 'u="sng"', '<a:uFill><a:solidFill><a:srgbClr val="C8553D"/></a:solidFill></a:uFill>', (e) => !!kid(e, 'a:uFill'), 'pptx-keep.ts:80 ul');
run('Underline line follows text (uLnTx)', 'kept', '§21.1.2.3.32 uLnTx', 'u="sng"', '<a:uLnTx/>', (e) => !!kid(e, 'a:uLnTx'), 'pptx-keep.ts:80');
run('Strikethrough single', 'supported', '§21.1.2.3.9 rPr@strike sngStrike', 'strike="sngStrike"', '', (e) => ra(e, 'strike') === 'sngStrike');
run('Strikethrough double', 'supported', '§20.1.10.80 ST_TextStrikeType dblStrike', 'strike="dblStrike"', '', (e) => ra(e, 'strike') === 'dblStrike');
run('Superscript (offset 30%)', 'supported', '§21.1.2.3.9 rPr@baseline; Font ▸ Superscript', 'baseline="30000"', '', (e) => ra(e, 'baseline') === '30000');
run('Subscript (offset -25%)', 'supported', '§21.1.2.3.9 rPr@baseline; Font ▸ Subscript', 'baseline="-25000"', '', (e) => ra(e, 'baseline') === '-25000');
run('Superscript offset 50%', 'kept', '§21.1.2.3.9 rPr@baseline; Font ▸ Offset', 'baseline="50000"', '', (e) => ra(e, 'baseline') === '50000', 'pptx-keep.ts:72 bl');
run('Small caps', 'supported', '§21.1.2.3.9 rPr@cap small', 'cap="small"', '', (e) => ra(e, 'cap') === 'small');
run('All caps', 'supported', '§21.1.2.3.9 rPr@cap all', 'cap="all"', '', (e) => ra(e, 'cap') === 'all');
run('Character spacing expanded 3 pt', 'supported', '§21.1.2.3.9 rPr@spc; Font ▸ Character Spacing', 'spc="300"', '', (e) => ra(e, 'spc') === '300');
run('Character spacing condensed 1.5 pt', 'supported', '§21.1.2.3.9 rPr@spc', 'spc="-150"', '', (e) => ra(e, 'spc') === '-150');
run('Kerning for fonts 12 pt and above', 'kept', '§21.1.2.3.9 rPr@kern; Font ▸ Character Spacing ▸ Kerning', 'kern="1200"', '', (e) => ra(e, 'kern') === '1200', 'pptx-keep.ts:70 kern');
run('Size 8 pt', 'supported', '§21.1.2.3.9 rPr@sz', 'sz="800"', '', (e) => ra(e, 'sz') === '800');
run('Size 10.5 pt', 'supported', '§21.1.2.3.9 rPr@sz', 'sz="1050"', '', (e) => ra(e, 'sz') === '1050');
run('Font Times New Roman', 'supported', '§21.1.2.3.7 latin', '', '<a:latin typeface="Times New Roman"/>', (e) => ra(kid(e, 'a:latin'), 'typeface') === 'Times New Roman');
run('Font Courier New with panose', 'kept', '§21.1.2.3.7 latin@panose/@pitchFamily/@charset', '', '<a:latin typeface="Courier New" panose="02070309020205020404" pitchFamily="49" charset="0"/>', (e) => ra(kid(e, 'a:latin'), 'panose') === '02070309020205020404', 'pptx-keep.ts:82 lat');
run('Font missing on this computer', 'supported', '§21.1.2.3.7 latin (font substitution)', '', '<a:latin typeface="No Such Font Sans"/>', (e) => ra(kid(e, 'a:latin'), 'typeface') === 'No Such Font Sans');
run('Theme font Headings (+mj-lt)', 'kept', '§21.1.2.3.7 latin +mj-lt, §20.1.4.1.24', '', '<a:latin typeface="+mj-lt"/>', (e) => ra(kid(e, 'a:latin'), 'typeface') === '+mj-lt', 'pptx-keep.ts:82');
run('East Asian font', 'kept', '§21.1.2.3.3 ea', '', '<a:ea typeface="MS Mincho"/>', (e) => ra(kid(e, 'a:ea'), 'typeface') === 'MS Mincho', 'pptx-keep.ts:83');
run('Complex script font', 'kept', '§21.1.2.3.1 cs', '', '<a:cs typeface="Times New Roman"/>', (e) => ra(kid(e, 'a:cs'), 'typeface') === 'Times New Roman', 'pptx-keep.ts:85');
run('Symbol font', 'kept', '§21.1.2.3.10 sym', '', '<a:sym typeface="Wingdings"/>', (e) => ra(kid(e, 'a:sym'), 'typeface') === 'Wingdings', 'pptx-keep.ts:84');
run('Font color RGB', 'supported', '§21.1.2.3.9 rPr solidFill srgbClr; Font Color ▸ More Colors', '', solid('C8553D'), (e) => ra(kid(e, 'a:solidFill/a:srgbClr'), 'val')?.toUpperCase() === 'C8553D');
run('Font color theme Accent 3', 'kept', '§20.1.2.3.29 schemeClr; Font Color ▸ Theme Colors', '', '<a:solidFill><a:schemeClr val="accent3"/></a:solidFill>', (e) => ra(kid(e, 'a:solidFill/a:schemeClr'), 'val') === 'accent3', 'pptx-read.ts:2815 color() resolves to RGB');
run('Font color theme Accent 3 shown as its RGB', 'supported', '§20.1.2.3.29 schemeClr (resolved)', '', '<a:solidFill><a:schemeClr val="accent3"/></a:solidFill>', (e) => ra(kid(e, 'a:solidFill/a:schemeClr'), 'val') === 'accent3' || ra(kid(e, 'a:solidFill/a:srgbClr'), 'val')?.toUpperCase() === '6A4C93');
run('Font color theme with Lighter 40% (lumMod/lumOff)', 'kept', '§20.1.2.3.20 lumMod, §20.1.2.3.21 lumOff', '', '<a:solidFill><a:schemeClr val="accent1"><a:lumMod val="60000"/><a:lumOff val="40000"/></a:schemeClr></a:solidFill>', (e) => !!kid(e, 'a:solidFill/a:schemeClr/a:lumMod'), 'resolved to RGB');
run('Font color with transparency 40%', 'supported', '§20.1.2.3.1 alpha; Format Text Effects ▸ Text Fill ▸ Transparency', '', solid('1B7F79', '<a:alpha val="60000"/>'), (e) => ra(kid(e, 'a:solidFill/a:srgbClr/a:alpha'), 'val') === '60000', 'pptx-read.ts:2820 transparency');
run('Font color system color (windowText)', 'loss', '§20.1.2.3.33 sysClr', '', '<a:solidFill><a:sysClr val="windowText" lastClr="000000"/></a:solidFill>', (e) => !!kid(e, 'a:solidFill/a:sysClr'), 'resolved to RGB');
run('Font color preset color (prstClr)', 'loss', '§20.1.2.3.22 prstClr', '', '<a:solidFill><a:prstClr val="teal"/></a:solidFill>', (e) => !!kid(e, 'a:solidFill/a:prstClr'), 'resolved to RGB');
run('Text fill none', 'supported', '§20.1.8.44 noFill; Text Fill ▸ No Fill', '', NOFILL + '', (e) => !!kid(e, 'a:noFill'), 'pptx-read.ts:2819');
run('Text outline 1 pt', 'supported', '§20.1.2.2.24 ln in rPr; Text Outline', '', line(1, solid('C8553D')), (e) => ra(kid(e, 'a:ln/a:solidFill/a:srgbClr'), 'val')?.toUpperCase() === 'C8553D' && ra(kid(e, 'a:ln'), 'w') === '12700', 'pptx-read.ts:2823');
run('Text gradient fill', 'kept', '§20.1.8.33 gradFill in rPr; Text Fill ▸ Gradient fill', '', '<a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="1B7F79"/></a:gs><a:gs pos="100000"><a:srgbClr val="C8553D"/></a:gs></a:gsLst><a:lin ang="0" scaled="1"/></a:gradFill>', (e) => !!kid(e, 'a:gradFill'), 'pptx-keep.ts:77 fill');
run('Text pattern fill', 'kept', '§20.1.8.47 pattFill in rPr', '', '<a:pattFill prst="ltDnDiag"><a:fgClr><a:srgbClr val="1F3A4D"/></a:fgClr><a:bgClr><a:srgbClr val="F2A541"/></a:bgClr></a:pattFill>', (e) => ra(kid(e, 'a:pattFill'), 'prst') === 'ltDnDiag', 'pptx-keep.ts:77');
run('Text shadow (outer)', 'supported', '§20.1.8.49 outerShdw in rPr; Text Effects ▸ Shadow', '', '<a:effectLst><a:outerShdw blurRad="38100" dist="38100" dir="2700000" algn="tl"><a:srgbClr val="000000"><a:alpha val="43137"/></a:srgbClr></a:outerShdw></a:effectLst>', (e) => !!kid(e, 'a:effectLst/a:outerShdw'), 'pptx-read.ts:2828 shadow; pptx-keep.ts:79 fx');
run('Text glow', 'kept', '§20.1.8.32 glow in rPr; Text Effects ▸ Glow', '', '<a:effectLst><a:glow rad="63500"><a:srgbClr val="F2A541"><a:alpha val="60000"/></a:srgbClr></a:glow></a:effectLst>', (e) => !!kid(e, 'a:effectLst/a:glow'), 'pptx-keep.ts:79 fx');
run('Text reflection', 'kept', '§20.1.8.50 reflection in rPr', '', '<a:effectLst><a:reflection blurRad="6350" stA="50000" endA="300" endPos="55000" dir="5400000" sy="-100000" algn="bl" rotWithShape="0"/></a:effectLst>', (e) => !!kid(e, 'a:effectLst/a:reflection'), 'pptx-keep.ts:79 fx');
run('Highlight yellow', 'supported', '§21.1.2.3.4 highlight; Home ▸ Text Highlight Color', '', '<a:highlight><a:srgbClr val="FFFF00"/></a:highlight>', (e) => ra(kid(e, 'a:highlight/a:srgbClr'), 'val')?.toUpperCase() === 'FFFF00', 'pptx-read.ts:2801');
run('Language French', 'supported', '§21.1.2.3.9 rPr@lang; Review ▸ Language', 'lang="fr-FR"', '', (e) => ra(e, 'lang') === 'fr-FR');
run('Alternative language', 'kept', '§21.1.2.3.9 rPr@altLang', 'altLang="ja-JP"', '', (e) => ra(e, 'altLang') === 'ja-JP', 'pptx-keep.ts:64 a');
run('Do not check spelling', 'kept', '§21.1.2.3.9 rPr@noProof', 'noProof="1"', '', (e) => ra(e, 'noProof') === '1', 'pptx-keep.ts:64 a');
run('Equalize character height', 'kept', '§21.1.2.3.9 rPr@normalizeH; Font ▸ Equalize Character Height', 'normalizeH="1"', '', (e) => ra(e, 'normalizeH') === '1', 'pptx-keep.ts:64 a');
run('Bookmark link target (bmk)', 'kept', '§21.1.2.3.9 rPr@bmk', 'bmk="SamplerMark"', '', (e) => ra(e, 'bmk') === 'SamplerMark', 'pptx-keep.ts:64 a');
run('Right-to-left run', 'kept', '§21.1.2.3.12 rtl', '', '<a:rtl val="1"/>', (e) => !!kid(e, 'a:rtl'), 'pptx-keep.ts:86 end');
run('Spelling error mark (err)', 'loss', '§21.1.2.3.9 rPr@err', 'err="1"', '', (e) => ra(e, 'err') === '1', 'RUN_ATTRS pptx-keep.ts:56 (dropped)');
// a few scripts
{
  const id = chr('Greek, math and Chinese text', 'supported', '§21.1.2.3.11 t (Unicode)', (v) => !!runOf(v, id) && (runOf(v, id)!.textContent ?? '').includes('αβγ ∑∫√ 化学'));
  cur.push((s) => textBox(s.id(), `${id} text box`, s.cell(), para(r(`${id} αβγ ∑∫√ 化学`, 'sz="1400"'))));
}
{
  const id = chr('Arabic text in a right-to-left paragraph', 'kept', '§21.1.2.2.7 pPr@rtl', (v) => at(pPrOf(v, id) ?? null, 'rtl') === '1', 'pptx-keep.ts:166 a');
  cur.push((s) => textBox(s.id(), `${id} text box`, s.cell(), para(r(`${id} كيمياء`, 'sz="1400"', '<a:cs typeface="Arial"/><a:rtl val="1"/>'), 'algn="r" rtl="1"')));
}
{
  const id = chr('Emoji outside the Basic Multilingual Plane', 'supported', '§21.1.2.3.11 t', (v) => (runOf(v, id)?.textContent ?? '').includes('🧪⚗️'));
  cur.push((s) => textBox(s.id(), `${id} text box`, s.cell(), para(r(`${id} 🧪⚗️`, 'sz="1400"'))));
}
{
  const id = chr('Two runs in one paragraph, bold then red', 'supported', '§21.1.2.3.8 r', (v) => {
    const p = paraOf(v, id);
    const rs = p ? Array.from(p.getElementsByTagNameNS(NS.a, 'r')) : [];
    const red = rs.find((x) => (x.textContent ?? '').includes('red part'));
    return !!red && at(kid(red, 'a:rPr/a:solidFill/a:srgbClr') ?? null, 'val')?.toUpperCase() === 'C8553D' && rs.some((x) => (x.textContent ?? '').includes(id) && at(kid(x, 'a:rPr') ?? null, 'b') === '1');
  });
  cur.push((s) => textBox(s.id(), `${id} text box`, s.cell(), para(r(`${id} bold part, `, 'sz="1400" b="1"') + r('red part', 'sz="1400"', solid('C8553D')))));
}
{
  const id = chr('Slide number field', 'supported', '§21.1.2.2.4 fld slidenum; Insert ▸ Slide Number', (v) => { const p = paraOf(v, id); return !!p && Array.from(p.getElementsByTagNameNS(NS.a, 'fld')).some((f) => at(f, 'type') === 'slidenum'); }, 'pptx-read.ts:2791 field');
  cur.push((s) => textBox(s.id(), `${id} text box`, s.cell(), `<a:p>${r(`${id} slide `, 'sz="1400"')}<a:fld id="{3D4F1E2A-0B6C-4C7D-9E8F-A1B2C3D4E5F6}" type="slidenum"><a:rPr lang="en-US" sz="1400"/><a:t>3</a:t></a:fld></a:p>`));
}
{
  const id = chr('Date field updating automatically', 'supported', '§21.1.2.2.4 fld datetime1; Insert ▸ Date & Time', (v) => { const p = paraOf(v, id); return !!p && Array.from(p.getElementsByTagNameNS(NS.a, 'fld')).some((f) => /^datetime\d*$/.test(at(f, 'type') ?? '')); }, 'pptx-read.ts:2791');
  cur.push((s) => textBox(s.id(), `${id} text box`, s.cell(), `<a:p>${r(`${id} date `, 'sz="1400"')}<a:fld id="{3D4F1E2A-0B6C-4C7D-9E8F-A1B2C3D4E5F7}" type="datetime1"><a:rPr lang="en-US" sz="1400"/><a:t>1/1/2026</a:t></a:fld></a:p>`));
}
{
  const id = chr('Equation (a14:m Office Math)', 'loss', 'Insert ▸ Equation; a14:m with m:oMathPara', (v) => { const p = paraOf(v, id); return !!p && p.parentElement!.getElementsByTagNameNS(NS.m, 'oMath').length > 0; }, 'pptx-read.ts:2738 inlineMath (picture and text)');
  cur.push((s) => textBox(s.id(), `${id} text box`, s.cell(),
    para(r(`${id} equation follows`, 'sz="1400"')) + `<mc:AlternateContent xmlns:mc="${NS.mc}" xmlns:a14="${NS.a14}"><mc:Choice Requires="a14"><a:p><a14:m><m:oMathPara xmlns:m="${NS.m}"><m:oMathParaPr><m:jc m:val="centerGroup"/></m:oMathParaPr><m:oMath><m:sSup><m:e><m:r><m:t>E</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup></m:oMath></m:oMathPara></a14:m></a:p></mc:Choice><mc:Fallback><a:p>${r('E²', 'sz="1400"')}</a:p></mc:Fallback></mc:AlternateContent>`));
}

// ---------------------------------------------------------------- paragraph formatting (pPr)

const par = itemList('P-PAR', items);
newSlide();
/** A text box whose first paragraph has this pPr (and the other paragraphs plain). */
const pp = (feature: string, tag: Tag, spec: string, attrs: string, inner: string, check: (pPr: Element | undefined) => boolean, basis?: string, more = 'second paragraph, a longer one that wraps onto another line in the box') => {
  const id = par(feature, tag, spec, (v) => check(pPrOf(v, id)), basis);
  cur.push((s) => textBox(s.id(), `${id} text box`, s.cell(), para(r(`${id} ${feature}, words to wrap round.`, 'sz="1200"'), attrs, inner) + para(r(more, 'sz="1200"'), attrs, inner)));
};
const pa = (e: Element | undefined, a: string) => at(e ?? null, a);
pp('Align Left', 'supported', '§21.1.2.2.7 pPr@algn, §20.1.10.58 ST_TextAlignType l', 'algn="l"', '', (e) => (pa(e, 'algn') ?? 'l') === 'l');
pp('Center', 'supported', '§21.1.2.2.7 pPr@algn ctr', 'algn="ctr"', '', (e) => pa(e, 'algn') === 'ctr');
pp('Align Right', 'supported', '§21.1.2.2.7 pPr@algn r', 'algn="r"', '', (e) => pa(e, 'algn') === 'r');
pp('Justify', 'supported', '§21.1.2.2.7 pPr@algn just', 'algn="just"', '', (e) => pa(e, 'algn') === 'just');
pp('Distributed', 'kept', '§20.1.10.58 ST_TextAlignType dist', 'algn="dist"', '', (e) => pa(e, 'algn') === 'dist', 'pptx-keep.ts:168 dist');
pp('Justify Low (Thai)', 'loss', '§20.1.10.58 ST_TextAlignType justLow', 'algn="justLow"', '', (e) => pa(e, 'algn') === 'justLow', 'pptx-read.ts:2701 (read as left)');
pp('Line spacing 1.5 lines', 'supported', '§21.1.2.2.5 lnSpc spcPct; Paragraph ▸ Line Spacing', '', '<a:lnSpc><a:spcPct val="150000"/></a:lnSpc>', (e) => pa(kid(e, 'a:lnSpc/a:spcPct'), 'val') === '150000', 'pptx-read.ts:2731');
pp('Line spacing Exactly 30 pt', 'supported', '§21.1.2.2.5 lnSpc spcPts', '', '<a:lnSpc><a:spcPts val="3000"/></a:lnSpc>', (e) => pa(kid(e, 'a:lnSpc/a:spcPts'), 'val') === '3000', 'pptx-read.ts:2731');
pp('Spacing Before 12 pt', 'supported', '§21.1.2.2.11 spcBef spcPts', '', '<a:spcBef><a:spcPts val="1200"/></a:spcBef>', (e) => pa(kid(e, 'a:spcBef/a:spcPts'), 'val') === '1200', 'pptx-read.ts:2767');
pp('Spacing After 6 pt', 'supported', '§21.1.2.2.10 spcAft spcPts', '', '<a:spcAft><a:spcPts val="600"/></a:spcAft>', (e) => pa(kid(e, 'a:spcAft/a:spcPts'), 'val') === '600', 'pptx-read.ts:2767');
pp('Spacing Before in lines (spcPct 50%)', 'loss', '§21.1.2.2.11 spcBef spcPct', '', '<a:spcBef><a:spcPct val="50000"/></a:spcBef>', (e) => !!kid(e, 'a:spcBef/a:spcPct'), 'pptx-read.ts:2765 (to points)');
pp('Indentation Before text 0.5 in, Hanging 0.25 in', 'kept', '§21.1.2.2.7 pPr@marL/@indent; Paragraph ▸ Indentation', 'marL="457200" indent="-228600"', '', (e) => pa(e, 'marL') === '457200' && pa(e, 'indent') === '-228600', 'pptx-keep.ts:172 marL/indent');
pp('Indentation First line 0.5 in', 'kept', '§21.1.2.2.7 pPr@indent', 'marL="0" indent="457200"', '', (e) => pa(e, 'indent') === '457200', 'pptx-keep.ts:172');
pp('Right indent (marR)', 'kept', '§21.1.2.2.7 pPr@marR', 'marR="457200"', '', (e) => pa(e, 'marR') === '457200', 'pptx-keep.ts:166 a');
pp('Default tab size 0.75 in', 'kept', '§21.1.2.2.7 pPr@defTabSz', 'defTabSz="685800"', '', (e) => pa(e, 'defTabSz') === '685800', 'pptx-keep.ts:166 a');
pp('Font alignment Top', 'kept', '§21.1.2.2.7 pPr@fontAlgn; Paragraph ▸ Asian Typography ▸ Text alignment', 'fontAlgn="t"', '', (e) => pa(e, 'fontAlgn') === 't', 'pptx-keep.ts:166 a');
pp('Allow Latin text to wrap mid-word off; hanging punctuation off', 'kept', '§21.1.2.2.7 pPr@latinLnBrk/@hangingPunct/@eaLnBrk', 'eaLnBrk="0" latinLnBrk="1" hangingPunct="0"', '', (e) => pa(e, 'latinLnBrk') === '1' && pa(e, 'hangingPunct') === '0' && pa(e, 'eaLnBrk') === '0', 'pptx-keep.ts:166 a');
{
  const tabs = '<a:tabLst><a:tab pos="914400" algn="l"/><a:tab pos="1828800" algn="ctr"/><a:tab pos="2743200" algn="r"/><a:tab pos="3429000" algn="dec"/></a:tabLst>';
  for (const [k, al] of [['Left', 'l'], ['Center', 'ctr'], ['Right', 'r'], ['Decimal', 'dec']] as const) {
    const id = par(`Tab stop ${k}`, 'supported', '§21.1.2.2.13 tabLst, §21.1.2.2.12 tab; Paragraph ▸ Tabs', (v) => Array.from(kid(pPrOf(v, id), 'a:tabLst')?.children ?? []).some((t) => at(t, 'algn') === al), 'pptx-read.ts:2737 tabs');
    cur.push((s) => textBox(s.id(), `${id} text box`, s.cell(), `<a:p><a:pPr>${tabs}</a:pPr>${r(`${id}\tone\ttwo\tthree\t4.25`, 'sz="1000"')}</a:p>`));
  }
}

// ---------------------------------------------------------------- bullets and numbering

const bul = itemList('P-BUL', items);
newSlide();
/** A text box of three list items with this pPr; checked on the first paragraph's pPr. */
const li = (feature: string, tag: Tag, spec: string, inner: string, check: (pPr: Element | undefined) => boolean, basis?: string, attrs = 'marL="342900" indent="-342900"') => {
  const id = bul(feature, tag, spec, (v) => check(pPrOf(v, id)), basis);
  cur.push((s) => textBox(s.id(), `${id} text box`, s.cell(), [`${id} ${feature}`, 'second item', 'third item'].map((t) => para(r(t, 'sz="1200"'), attrs, inner)).join('')));
};
li('Bullet • (Arial)', 'supported', '§21.1.2.4.3 buChar, §21.1.2.4.6 buFont; Home ▸ Bullets', '<a:buFont typeface="Arial"/><a:buChar char="•"/>', (e) => at(kid(e, 'a:buChar') ?? null, 'char') === '•', 'pptx-read.ts:2716');
li('Bullet Wingdings check mark', 'supported', '§21.1.2.4.3 buChar (Wingdings ü)', '<a:buFont typeface="Wingdings" pitchFamily="2" charset="2"/><a:buChar char="ü"/>', (e) => !!kid(e, 'a:buChar'), 'pptx-read.ts:3144 bulletChar');
li('Bullet Wingdings check mark keeps its font and character', 'kept', '§21.1.2.4.6 buFont', '<a:buFont typeface="Wingdings" pitchFamily="2" charset="2"/><a:buChar char="ü"/>', (e) => at(kid(e, 'a:buFont') ?? null, 'typeface') === 'Wingdings' && at(kid(e, 'a:buChar') ?? null, 'char') === 'ü', 'pptx-read.ts or pptx-write.ts, not traced to a line: buFont rewritten');
li('Bullet in Courier New (buFont)', 'loss', '§21.1.2.4.6 buFont', '<a:buFont typeface="Courier New"/><a:buChar char="o"/>', (e) => at(kid(e, 'a:buFont') ?? null, 'typeface') === 'Courier New', 'pptx-read.ts or pptx-write.ts, not traced to a line: buFont rewritten');
li('Bullet dash –', 'supported', '§21.1.2.4.3 buChar', '<a:buFont typeface="Arial"/><a:buChar char="–"/>', (e) => at(kid(e, 'a:buChar') ?? null, 'char') === '–');
li('Bullet color red', 'kept', '§21.1.2.4.4 buClr; Bullets and Numbering ▸ Color', '<a:buClr><a:srgbClr val="C8553D"/></a:buClr><a:buFont typeface="Arial"/><a:buChar char="•"/>', (e) => at(kid(e, 'a:buClr/a:srgbClr') ?? null, 'val')?.toUpperCase() === 'C8553D', 'pptx-keep.ts:170 bu');
li('Bullet color follows text', 'kept', '§21.1.2.4.5 buClrTx', '<a:buClrTx/><a:buFont typeface="Arial"/><a:buChar char="•"/>', (e) => !!kid(e, 'a:buClrTx'), 'pptx-keep.ts:170');
// (Bullet size in percent, a:buSzPct, is left out: PowerPoint writes val="150000", which the
// 2016 Transitional schema's ST_TextBulletSizePercent pattern ("150%") rejects.)
li('Bullet size 20 pt', 'kept', '§21.1.2.4.10 buSzPts', '<a:buSzPts val="2000"/><a:buFont typeface="Arial"/><a:buChar char="•"/>', (e) => at(kid(e, 'a:buSzPts') ?? null, 'val') === '2000', 'pptx-keep.ts:170');
li('Bullet size follows text', 'kept', '§21.1.2.4.11 buSzTx', '<a:buSzTx/><a:buFont typeface="Arial"/><a:buChar char="•"/>', (e) => !!kid(e, 'a:buSzTx'), 'pptx-keep.ts:170');
li('Bullet font follows text', 'loss', '§21.1.2.4.7 buFontTx', '<a:buFontTx/><a:buChar char="•"/>', (e) => !!kid(e, 'a:buFontTx'), 'buFont rewritten');
li('No bullet', 'supported', '§21.1.2.4.8 buNone', '<a:buNone/>', (e) => !kid(e, 'a:buChar') && !kid(e, 'a:buAutoNum'), 'pptx-read.ts:2712', 'marL="0" indent="0"');
for (const t of ['arabicPeriod', 'arabicParenR', 'arabicParenBoth', 'arabicPlain', 'romanUcPeriod', 'romanLcPeriod', 'alphaUcPeriod', 'alphaLcParenR', 'alphaLcParenBoth']) {
  li(`Numbering ${t}`, 'supported', '§21.1.2.4.1 buAutoNum, §20.1.10.61 ST_TextAutonumberScheme; Home ▸ Numbering', `<a:buFont typeface="+mj-lt"/><a:buAutoNum type="${t}"/>`, (e) => at(kid(e, 'a:buAutoNum') ?? null, 'type') === t, 'paragraphs.ts:247 autoNumLabel');
}
for (const t of ['circleNumDbPlain', 'ea1JpnChsDbPeriod', 'hebrew2Minus', 'thaiAlphaPeriod']) {
  li(`Numbering ${t}`, 'loss', '§20.1.10.61 ST_TextAutonumberScheme', `<a:buFont typeface="+mj-lt"/><a:buAutoNum type="${t}"/>`, (e) => at(kid(e, 'a:buAutoNum') ?? null, 'type') === t, 'paragraphs.ts:247 autoNumLabel (unknown type: first-level default)');
}
li('Numbering starting at 5', 'supported', '§21.1.2.4.1 buAutoNum@startAt; Bullets and Numbering ▸ Start at', '<a:buFont typeface="+mj-lt"/><a:buAutoNum type="arabicPeriod" startAt="5"/>', (e) => at(kid(e, 'a:buAutoNum') ?? null, 'startAt') === '5', 'pptx-read.ts:2725');
{
  const id = bul('Picture bullet', 'loss', '§21.1.2.4.2 buBlip; Bullets and Numbering ▸ Picture', (v) => !!kid(pPrOf(v, id), 'a:buBlip'), 'pptx-read.ts or pptx-write.ts, not traced to a line: buBlip becomes a plain bullet');
  cur.push((s) => {
    const rid = s.media('bullet.png', PNG_BULLET);
    return textBox(s.id(), `${id} text box`, s.cell(), [`${id} picture bullet`, 'second item'].map((t) => para(r(t, 'sz="1200"'), 'marL="342900" indent="-342900"', `<a:buBlip><a:blip r:embed="${rid}"/></a:buBlip>`)).join(''));
  });
}
{
  const id = bul('Bullet levels 1 to 5 by Increase List Level', 'supported', '§21.1.2.2.7 pPr@lvl; Home ▸ Increase List Level', (v) => {
    const p = paraOf(v, id); const tb = p?.parentElement;
    const lv = tb ? Array.from(tb.getElementsByTagNameNS(NS.a, 'p')).map((x) => at(kid(x, 'a:pPr') ?? null, 'lvl') ?? '0') : [];
    return ['1', '2', '3', '4'].every((n) => lv.includes(n));
  }, 'pptx-read.ts:2714 level');
  cur.push((s) => textBox(s.id(), `${id} text box`, s.cell(), [0, 1, 2, 3, 4].map((n) => para(r(n ? `level ${n + 1}` : `${id} level 1`, 'sz="1100"'), `marL="${228600 * (n + 1)}" lvl="${n}" indent="-228600"`, '<a:buFont typeface="Arial"/><a:buChar char="•"/>')).join('')));
}
{
  const id = bul('Multilevel numbering 1. a. i.', 'supported', '§21.1.2.4.1 buAutoNum by level', (v) => {
    const p = paraOf(v, id); const tb = p?.parentElement;
    const types = tb ? Array.from(tb.getElementsByTagNameNS(NS.a, 'buAutoNum')).map((x) => at(x, 'type')) : [];
    return types.includes('arabicPeriod') && types.includes('alphaLcPeriod') && types.includes('romanLcPeriod');
  });
  cur.push((s) => textBox(s.id(), `${id} text box`, s.cell(), [['arabicPeriod', 0], ['alphaLcPeriod', 1], ['romanLcPeriod', 2], ['arabicPeriod', 0]].map(([t, n], k) => para(r(k ? `item ${k + 1}` : `${id} multilevel`, 'sz="1100"'), `marL="${342900 * (Number(n) + 1)}" lvl="${n}" indent="-342900"`, `<a:buFont typeface="+mj-lt"/><a:buAutoNum type="${t}"/>`)).join('')));
}

// tiny bullet picture: a 16 px square
const PNG_BULLET = png(16, 16, [200, 85, 61]);

const SLIDE_DEFS: SlideDef[] = slides.map((makers) => ({ body: (s: SlideCtx) => { s.grid(4, Math.ceil(makers.length / 4) || 1); return makers.map((m) => m(s)).join(''); } }));

export const pptxText: Sampler = {
  name: 'pptx-text.pptx', area: 'PowerPoint text boxes, character and paragraph formatting, bullets and numbering', items,
  build: () => deckFile({ title: 'PowerPoint sampler: text', slides: SLIDE_DEFS }),
};
