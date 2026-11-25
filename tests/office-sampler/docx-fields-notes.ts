/**
 * Word sampler: fields, footnotes and endnotes, comments, tracked changes, hyperlinks, bookmarks and
 * content controls (W-FLD, W-NTE, W-CMT, W-TRK, W-LNK, W-SDT). ECMA-376 Part 1 §17.16 (fields),
 * §17.11 (notes), §17.13.4 (comments), §17.13.5 (revisions), §17.16.22 (hyperlink), §17.13.6
 * (bookmarks), §17.5.2 (structured document tags); Word's References, Review and Insert tabs.
 *
 * Tags from src/io/docx-read.ts startField (:2240): SEQ, REF/PAGEREF, DATE/TIME, document property
 * fields, PAGE/NUMPAGES, TOC (entries rebuilt), INDEX/XE, legacy form fields become model fields;
 * HYPERLINK fields become links; any other field with plain-text result is kept with its instruction
 * and last result (:2373). Notes (:1206), comments (:1860) with replies and resolved state, ins, del,
 * rPrChange, moves with range starts, and paragraph-mark revisions are read; pPrChange and table
 * revisions are accepted (:471). Bookmarks collapse to their paragraph; other programs' content
 * controls are kept (:1041).
 */
import { type Item, type Sampler, type View, itemList, at, kid, NS, REL, CT, XML_HEAD, esc } from './kit';
import { wordFile, para, run, paraOf, val, on, W_NS } from './word';

const items: Item[] = [];
const fld = itemList('W-FLD', items);
const nte = itemList('W-NTE', items);
const cmt = itemList('W-CMT', items);
const trk = itemList('W-TRK', items);
const lnk = itemList('W-LNK', items);
const sdt = itemList('W-SDT', items);
const body: string[] = [];
type T = 'supported' | 'kept' | 'loss';
const DATE = '2026-01-02T03:04:00Z';

const field = (instr: string, shown: string, rPr = '') => `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ${esc(instr)} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${run(shown, rPr)}<w:r><w:fldChar w:fldCharType="end"/></w:r>`;
/** Every field instruction in a paragraph: complex fields' instrText and simple fields' instr. */
const instrs = (p: Element | undefined) => {
  if (!p) return '';
  const complex = Array.from(p.getElementsByTagNameNS(NS.w, 'instrText')).map((t) => t.textContent ?? '').join('');
  return complex + ' ' + Array.from(p.getElementsByTagNameNS(NS.w, 'fldSimple')).map((f) => at(f, 'w:instr') ?? '').join(' ');
};

// ---------------------------------------------------------------------------------------------
// Fields

const fItem = (feature: string, tag: T, spec: string, xml: (id: string) => string, re: RegExp, basis?: string) => {
  const id = fld(feature, tag, spec, (v) => re.test(instrs(paraOf(v, id))), basis);
  body.push(xml(id));
};
// a table of contents of the headings below: the field spans its entry paragraphs
const tocId = fld('Table of contents (TOC \\o "1-3" \\h \\z \\u)', 'supported', '§17.16.5.68 TOC; References ▸ Table of Contents', (v) => {
  const all = v.all(/^word\/document\.xml$/, 'w:instrText').map((t) => t.textContent ?? '').join('') + v.all(/^word\/document\.xml$/, 'w:fldSimple').map((f) => at(f, 'w:instr')).join('');
  return /TOC\s+\\o\s+"1-3"/.test(all) && v.parts['word/document.xml'].includes(tocId);
}, 'docx-read.ts startField (TOC, entries rebuilt)');
body.push(para(run(`${tocId} Table of contents`), '<w:pStyle w:val="Heading1"/>'),
  `<w:p><w:pPr><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="9350"/></w:tabs></w:pPr><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\o "1-3" \\h \\z \\u </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${run('Fields')}<w:r><w:tab/></w:r>${run('1')}</w:p>`,
  `<w:p><w:pPr><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="9350"/></w:tabs><w:ind w:left="220"/></w:pPr>${run('Notes and comments')}<w:r><w:tab/></w:r>${run('1')}<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>`,
  para(run('Fields'), '<w:pStyle w:val="Heading1"/>'));
fItem('PAGE field in text', 'supported', '§17.16.5.42 PAGE', (id) => para(run(`${id} this is page `) + field('PAGE', '1')), /\bPAGE\b/);
fItem('NUMPAGES field', 'supported', '§17.16.5.41 NUMPAGES', (id) => para(run(`${id} of `) + field('NUMPAGES', '2')), /\bNUMPAGES\b/);
fItem('DATE field with a date format', 'supported', '§17.16.5.13 DATE, §17.16.4.1 date format', (id) => para(run(`${id} today is `) + field('DATE \\@ "d MMMM yyyy"', '2 January 2026')), /DATE\s+\\@\s+"d MMMM yyyy"/);
fItem('TIME field', 'supported', '§17.16.5.66 TIME', (id) => para(run(`${id} now `) + field('TIME \\@ "HH:mm"', '03:04')), /TIME/);
fItem('CREATEDATE field', 'supported', '§17.16.5.10 CREATEDATE', (id) => para(run(`${id} created `) + field('CREATEDATE \\@ "yyyy-MM-dd"', '2026-01-01')), /CREATEDATE/);
fItem('AUTHOR field', 'supported', '§17.16.5.4 AUTHOR; Insert ▸ Quick Parts ▸ Field', (id) => para(run(`${id} by `) + field('AUTHOR', 'Chemweave sampler')), /AUTHOR/);
fItem('TITLE field', 'supported', '§17.16.5.67 TITLE', (id) => para(run(`${id} titled `) + field('TITLE', 'Word sampler: fields')), /TITLE/);
fItem('FILENAME field', 'supported', '§17.16.5.17 FILENAME', (id) => para(run(`${id} in `) + field('FILENAME \\* MERGEFORMAT', 'docx-fields-notes.docx')), /FILENAME/);
fItem('DOCPROPERTY Company field', 'supported', '§17.16.5.16 DOCPROPERTY', (id) => para(run(`${id} for `) + field('DOCPROPERTY Company', 'Sampler Co')), /DOCPROPERTY\s+Company/, 'src/document/fields.ts:192');
fItem('Simple field (fldSimple) PAGE', 'supported', '§17.16.19 fldSimple', (id) => para(run(`${id} simple `) + `<w:fldSimple w:instr=" PAGE "><w:r><w:t>1</w:t></w:r></w:fldSimple>`), /\bPAGE\b/);
fItem('IF field', 'kept', '§17.16.5.28 IF', (id) => para(run(`${id} `) + field('IF 1 = 1 "yes" "no"', 'yes')), /IF\s+1\s*=\s*1/, 'docx-read.ts:2373 (other fields kept with their result)');
fItem('Formula field = 2 * 21', 'kept', '§17.16.3 = (formula)', (id) => para(run(`${id} `) + field('= 2 * 21 \\# "0"', '42')), /=\s*2\s*\*\s*21/, 'docx-read.ts:2373');
fItem('STYLEREF field', 'kept', '§17.16.5.62 STYLEREF', (id) => para(run(`${id} section: `) + field('STYLEREF "Heading 1"', 'Fields')), /STYLEREF/, 'docx-read.ts:2373');
fItem('MERGEFIELD field', 'kept', '§17.16.5.36 MERGEFIELD', (id) => para(run(`${id} dear `) + field('MERGEFIELD FirstName', '«FirstName»')), /MERGEFIELD\s+FirstName/, 'docx-read.ts:2373');
fItem('SYMBOL field', 'kept', '§17.16.5.63 SYMBOL', (id) => para(run(`${id} `) + field('SYMBOL 183 \\f "Symbol" \\s 11', '·')), /SYMBOL\s+183/, 'docx-read.ts:2373');
// captions and cross-references
const fig = fld('Figure caption with SEQ Figure', 'supported', '§17.16.5.56 SEQ; References ▸ Insert Caption', (v) => /SEQ\s+Figure/.test(instrs(paraOf(v, fig))), 'docx-read.ts startField (SEQ)');
body.push(`<w:p><w:pPr><w:pStyle w:val="Caption"/></w:pPr><w:bookmarkStart w:id="10" w:name="_Ref900001"/>${run('Figure ')}${field('SEQ Figure \\* ARABIC', '1')}<w:bookmarkEnd w:id="10"/>${run(`. ${fig} a figure caption`)}</w:p>`);
const tab = fld('Table caption with SEQ Table', 'supported', '§17.16.5.56 SEQ', (v) => /SEQ\s+Table/.test(instrs(paraOf(v, tab))));
body.push(`<w:p><w:pPr><w:pStyle w:val="Caption"/></w:pPr>${run('Table ')}${field('SEQ Table \\* ARABIC', '1')}${run(`. ${tab} a table caption`)}</w:p>`);
const xref = fld('Cross-reference to a caption (REF \\h)', 'supported', '§17.16.5.51 REF; References ▸ Cross-reference', (v) => {
  // a REF … \h whose bookmark (whatever its name now) is on the figure caption's paragraph
  const m = /REF\s+(\S+)\s+\\h/.exec(instrs(paraOf(v, xref)));
  return !!m && Array.from(paraOf(v, fig)?.getElementsByTagNameNS(NS.w, 'bookmarkStart') ?? []).some((b) => at(b, 'w:name') === m[1]);
});
body.push(para(run(`${xref} see `) + field('REF _Ref900001 \\h', 'Figure 1')));
fItem('Page reference (PAGEREF)', 'supported', '§17.16.5.44 PAGEREF', (id) => para(run(`${id} on page `) + field('PAGEREF _Ref900001 \\h', '1')), /PAGEREF\s+_Ref900001/);
fItem('Footnote reference (NOTEREF)', 'kept', '§17.16.5.40 NOTEREF', (id) => para(run(`${id} see note `) + field('NOTEREF _Ref900002 \\h', '1')), /NOTEREF/, 'docx-read.ts:2373');
fItem('Table of figures (TOC \\c "Figure")', 'supported', '§17.16.5.68 TOC \\c; References ▸ Insert Table of Figures', (id) => para(run(`${id} `) + field('TOC \\h \\z \\c "Figure"', 'Figure 1. a figure caption')), /TOC[^"]*\\c\s+"Figure"/);
fItem('Index entry (XE)', 'supported', '§17.16.5.79 XE; References ▸ Mark Entry', (id) => para(run(`${id} benzene `) + field('XE "benzene"', '')), /XE\s+"benzene"/);
fItem('Index (INDEX)', 'supported', '§17.16.5.30 INDEX; References ▸ Insert Index', (id) => para(run(`${id} `) + field('INDEX \\c "2"', 'benzene, 1')), /INDEX/);
fItem('Legacy text form field', 'supported', '§17.16.5.20 FORMTEXT; Developer ▸ Legacy Tools', (id) => para(run(`${id} name: `) + `<w:r><w:fldChar w:fldCharType="begin"><w:ffData><w:name w:val="Text1"/><w:enabled/><w:calcOnExit w:val="0"/><w:textInput/></w:ffData></w:fldChar></w:r><w:r><w:instrText xml:space="preserve"> FORMTEXT </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${run('     ')}<w:r><w:fldChar w:fldCharType="end"/></w:r>`), /FORMTEXT/);
fItem('Legacy check box form field', 'supported', '§17.16.5.19 FORMCHECKBOX', (id) => para(run(`${id} agree: `) + `<w:r><w:fldChar w:fldCharType="begin"><w:ffData><w:name w:val="Check1"/><w:enabled/><w:calcOnExit w:val="0"/><w:checkBox><w:sizeAuto/><w:default w:val="1"/></w:checkBox></w:ffData></w:fldChar></w:r><w:r><w:instrText xml:space="preserve"> FORMCHECKBOX </w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`), /FORMCHECKBOX/);
fItem('Locked field', 'loss', '§17.16.18 fldChar@fldLock', (id) => para(run(`${id} locked `) + `<w:r><w:fldChar w:fldCharType="begin" w:fldLock="1"/></w:r><w:r><w:instrText xml:space="preserve"> DATE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${run('1/1/2026')}<w:r><w:fldChar w:fldCharType="end"/></w:r>`), /DATE/);
items[items.length - 1].check = (v) => v.all(/^word\/document\.xml$/, 'w:fldChar').some((f) => ['1', 'true'].includes(at(f, 'w:fldLock') ?? ''));
items[items.length - 1].basis = 'docx-read.ts startField (fldLock not read)';

// ---------------------------------------------------------------------------------------------
// Footnotes and endnotes

const notes: { kind: 'footnote' | 'endnote'; id: number; xml: string }[] = [];
const nItem = (kind: 'footnote' | 'endnote', feature: string, tag: T, spec: string, noteBody: (id: string) => string, check: (v: View, id: string, note: Element | undefined) => boolean, basis?: string, refAttrs = '') => {
  const nid = notes.filter((n) => n.kind === kind).length + 1;
  const id = nte(feature, tag, spec, (v) => {
    const ref = paraOf(v, id)?.getElementsByTagNameNS(NS.w, `${kind}Reference`)[0];
    const note = v.all(new RegExp(`^word/${kind}s\\.xml$`), `w:${kind}`).find((n) => at(n, 'w:id') === at(ref, 'w:id'));
    return !!ref && check(v, id, note);
  }, basis);
  notes.push({ kind, id: nid, xml: noteBody(id) });
  // the first footnote's mark is bookmarked, for the NOTEREF field above
  const ref = `<w:r><w:rPr><w:rStyle w:val="${kind === 'footnote' ? 'FootnoteReference' : 'EndnoteReference'}"/></w:rPr><w:${kind}Reference w:id="${nid}"${refAttrs}/></w:r>`;
  const marked = kind === 'footnote' && nid === 1 ? `<w:bookmarkStart w:id="11" w:name="_Ref900002"/>${ref}<w:bookmarkEnd w:id="11"/>` : ref;
  body.push(para(run(`${id} ${feature}`) + marked + run(' and more text.')));
};
const noteP = (kind: string, text: string, extra = '') => `<w:p><w:pPr><w:pStyle w:val="${kind === 'footnote' ? 'FootnoteText' : 'EndnoteText'}"/></w:pPr><w:r><w:rPr><w:rStyle w:val="${kind === 'footnote' ? 'FootnoteReference' : 'EndnoteReference'}"/></w:rPr><w:${kind}Ref/></w:r>${run(' ' + text)}${extra}</w:p>`;
const noteHas = (n: Element | undefined, s: string) => (n?.textContent ?? '').includes(s);
nItem('footnote', 'Footnote', 'supported', '§17.11.10 footnoteReference; References ▸ Insert Footnote', (id) => noteP('footnote', `${id} footnote text`), (_v, id, n) => noteHas(n, `${id} footnote text`));
nItem('footnote', 'Footnote with formatting', 'supported', '§17.11.10', (id) => noteP('footnote', `${id} `, run('bold', '<w:b/>') + run(' and ') + run('italic', '<w:i/>')), (_v, _id, n) => Array.from(n?.getElementsByTagNameNS(NS.w, 'r') ?? []).some((r) => on(kid(r, 'w:rPr'), 'w:b')));
nItem('footnote', 'Footnote of two paragraphs', 'supported', '§17.11.10', (id) => noteP('footnote', `${id} first`) + para(run('second paragraph of the note'), '<w:pStyle w:val="FootnoteText"/>'), (_v, _id, n) => (n?.getElementsByTagNameNS(NS.w, 'p').length ?? 0) === 2);
nItem('footnote', 'Footnote with a custom mark (*)', 'loss', '§17.11.10 footnoteReference@customMarkFollows', (id) => `<w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr><w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:t>*</w:t></w:r>${run(` ${id} custom mark note`)}</w:p>`,
  (v, id) => ['1', 'true'].includes(at(paraOf(v, id)?.getElementsByTagNameNS(NS.w, 'footnoteReference')[0], 'w:customMarkFollows') ?? ''), 'docx-read.ts:1206 (marks regenerated)', ' w:customMarkFollows="1"');
nItem('endnote', 'Endnote', 'supported', '§17.11.2 endnoteReference; References ▸ Insert Endnote', (id) => noteP('endnote', `${id} endnote text`), (_v, id, n) => noteHas(n, `${id} endnote text`));
nItem('endnote', 'Endnote with a hyperlink', 'supported', '§17.11.2', (id) => noteP('endnote', `${id} see`, '<w:hyperlink r:id="@ENDLINK@"><w:r><w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr><w:t xml:space="preserve"> example.org</w:t></w:r></w:hyperlink>'), (_v, _id, n) => (n?.getElementsByTagNameNS(NS.w, 'hyperlink').length ?? 0) > 0);
const fnFmt = nte('Footnote numbers a, b, c', 'supported', '§17.11.17 numFmt (footnotePr)', (v) => v.all(/^word\/(document|settings)\.xml$/, 'w:footnotePr').some((p) => val(p, 'w:numFmt') === 'lowerLetter'));
const enFmt = nte('Endnote numbers I, II, III', 'supported', '§17.11.17 numFmt (endnotePr)', (v) => v.all(/^word\/(document|settings)\.xml$/, 'w:endnotePr').some((p) => val(p, 'w:numFmt') === 'upperRoman'));
body.push(para(run(`${fnFmt} and ${enFmt}: set in the section`)));

// ---------------------------------------------------------------------------------------------
// Comments

const comments: { id: number; xml: string; paraId: string; parent?: string; done?: boolean }[] = [];
const commentOf = (v: View, text: string) => v.all(/^word\/comments\.xml$/, 'w:comment').find((c) => (c.textContent ?? '').includes(text));
const cItem = (feature: string, tag: T, spec: string, check: (v: View, id: string) => boolean, o: { reply?: boolean; done?: boolean; basis?: string } = {}) => {
  const id = cmt(feature, tag, spec, (v) => check(v, id), o.basis);
  const n = comments.length;
  const paraId = (0x10000000 + n).toString(16).toUpperCase();
  comments.push({ id: n, paraId, xml: `<w:comment w:id="${n}" w:author="Sampler Reviewer" w:date="${DATE}" w:initials="SR"><w:p w14:paraId="${paraId}" w14:textId="77777777"><w:pPr><w:pStyle w:val="CommentText"/></w:pPr><w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:annotationRef/></w:r>${run(`${id} comment text`)}</w:p></w:comment>`, done: o.done, parent: o.reply ? comments[n - 1].paraId : undefined });
  if (o.reply) {
    // a reply sits on the same range as its parent: add its markers inside the parent's paragraph
    body[body.length - 1] = body[body.length - 1].replace('</w:p>', `<w:r><w:commentReference w:id="${n}"/></w:r></w:p>`).replace(`<w:commentRangeStart w:id="${n - 1}"/>`, `<w:commentRangeStart w:id="${n - 1}"/><w:commentRangeStart w:id="${n}"/>`).replace(`<w:commentRangeEnd w:id="${n - 1}"/>`, `<w:commentRangeEnd w:id="${n - 1}"/><w:commentRangeEnd w:id="${n}"/>`);
  } else {
    body.push(`<w:p>${run(`${id} ${feature}: `)}<w:commentRangeStart w:id="${n}"/>${run('the commented words')}<w:commentRangeEnd w:id="${n}"/><w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="${n}"/></w:r></w:p>`);
  }
  return id;
};
cItem('Comment on a range', 'supported', '§17.13.4.2 comment; Review ▸ New Comment', (v, id) => !!commentOf(v, `${id} comment text`) && (paraOf(v, id)?.getElementsByTagNameNS(NS.w, 'commentRangeStart').length ?? 0) > 0);
cItem('Comment author, initials and date', 'supported', '§17.13.4.2 comment@author/@initials/@date', (v, id) => { const c = commentOf(v, `${id} comment text`); return at(c, 'w:author') === 'Sampler Reviewer' && at(c, 'w:initials') === 'SR' && (at(c, 'w:date') ?? '').startsWith('2026-01-02'); });
cItem('Reply to a comment', 'supported', 'Word 2013 commentsExtended w15:commentEx@paraIdParent; Review ▸ Reply', (v, id) => {
  const c = commentOf(v, `${id} comment text`);
  const pid = c?.getElementsByTagNameNS(NS.w, 'p')[0]?.getAttributeNS(NS.w14, 'paraId');
  return !!pid && v.all(/^word\/commentsExtended\.xml$/, 'w15:commentEx').some((e) => e.getAttributeNS(NS.w15, 'paraId') === pid && !!e.getAttributeNS(NS.w15, 'paraIdParent'));
}, { reply: true });
cItem('Resolved comment', 'supported', 'Word 2013 commentsExtended w15:commentEx@done; Review ▸ Resolve', (v, id) => {
  const c = commentOf(v, `${id} comment text`);
  const pid = c?.getElementsByTagNameNS(NS.w, 'p')[0]?.getAttributeNS(NS.w14, 'paraId');
  return !!pid && v.all(/^word\/commentsExtended\.xml$/, 'w15:commentEx').some((e) => e.getAttributeNS(NS.w15, 'paraId') === pid && e.getAttributeNS(NS.w15, 'done') === '1');
}, { done: true });

// ---------------------------------------------------------------------------------------------
// Tracked changes

const rev = (n: number) => `w:id="${100 + n}" w:author="Sampler Editor" w:date="${DATE}"`;
const tItem = (feature: string, tag: T, spec: string, xml: (id: string) => string, check: (v: View, id: string) => boolean, basis?: string) => {
  const id = trk(feature, tag, spec, (v) => check(v, id), basis);
  body.push(xml(id));
};
const inPara = (v: View, id: string, q: string) => Array.from(paraOf(v, id)?.getElementsByTagNameNS(NS.w, q) ?? []);
tItem('Inserted text', 'supported', '§17.13.5.18 ins; Review ▸ Track Changes', (id) => para(run(`${id} kept and `) + `<w:ins ${rev(1)}>${run('inserted words')}</w:ins>`), (v, id) => inPara(v, id, 'ins').some((e) => at(e, 'w:author') === 'Sampler Editor' && (e.textContent ?? '').includes('inserted words')));
tItem('Deleted text', 'supported', '§17.13.5.14 del', (id) => para(run(`${id} kept and `) + `<w:del ${rev(2)}><w:r><w:delText xml:space="preserve">deleted words</w:delText></w:r></w:del>`), (v, id) => inPara(v, id, 'del').some((e) => (e.getElementsByTagNameNS(NS.w, 'delText')[0]?.textContent ?? '') === 'deleted words'));
tItem('Moved text (from and to)', 'supported', '§17.13.5.22 moveFrom, §17.13.5.26 moveTo', (id) => para(run(`${id} moved from here: `) + `<w:moveFromRangeStart ${rev(3)} w:name="move900"/><w:moveFrom ${rev(4)}>${run('the moved words').replace('<w:t ', '<w:t ')}</w:moveFrom><w:moveFromRangeEnd w:id="103"/>`) + para(run('to here: ') + `<w:moveToRangeStart ${rev(5)} w:name="move900"/><w:moveTo ${rev(6)}>${run('the moved words')}</w:moveTo><w:moveToRangeEnd w:id="105"/>`),
  (v) => v.all(/^word\/document\.xml$/, 'w:moveFrom').length > 0 && v.all(/^word\/document\.xml$/, 'w:moveTo').length > 0);
tItem('Formatting change (bold added)', 'supported', '§17.13.5.31 rPrChange', (id) => para(`<w:r><w:rPr><w:b/><w:rPrChange ${rev(7)}><w:rPr/></w:rPrChange></w:rPr><w:t xml:space="preserve">${id} made bold with tracking</w:t></w:r>`), (v, id) => inPara(v, id, 'rPrChange').length > 0);
tItem('Inserted paragraph mark', 'supported', '§17.13.5.16 ins (paragraph mark)', (id) => para(run(`${id} paragraph mark inserted`), `<w:rPr><w:ins ${rev(8)}/></w:rPr>`) + para(run('next paragraph')), (v, id) => !!kid(kid(kid(paraOf(v, id), 'w:pPr'), 'w:rPr'), 'w:ins'));
tItem('Paragraph formatting change', 'loss', '§17.13.5.29 pPrChange', (id) => para(run(`${id} centered with tracking`), `<w:jc w:val="center"/><w:pPrChange ${rev(9)}><w:pPr/></w:pPrChange>`), (v, id) => !!kid(kid(paraOf(v, id), 'w:pPr'), 'w:pPrChange'), 'docx-read.ts:471 (property changes accepted)');
tItem('Inserted table row', 'loss', '§17.13.5.20 ins (table row)', (id) => `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid><w:gridCol w:w="4680"/><w:gridCol w:w="4680"/></w:tblGrid><w:tr><w:tc>${para(run('a'))}</w:tc><w:tc>${para(run('b'))}</w:tc></w:tr><w:tr><w:trPr><w:ins ${rev(10)}/></w:trPr><w:tc>${para(`<w:ins ${rev(11)}>${run(`${id} inserted row`)}</w:ins>`)}</w:tc><w:tc>${para(`<w:ins ${rev(12)}>${run('c')}</w:ins>`)}</w:tc></w:tr></w:tbl>` + para(''),
  (v, id) => !!kid(kid(paraOf(v, id)?.parentElement?.parentElement, 'w:trPr'), 'w:ins'), 'docx-read.ts:471 (table revisions accepted)');
const trackOn = trk('Track Changes turned on', 'supported', '§17.15.1.90 trackRevisions', (v) => on(v.all(/^word\/settings\.xml$/, 'w:settings')[0], 'w:trackRevisions'));
body.push(para(run(`${trackOn}: set in settings`)));

// ---------------------------------------------------------------------------------------------
// Hyperlinks and bookmarks

const links: { id: string; target: string }[] = [];
const lItem = (feature: string, tag: T, spec: string, xml: (id: string) => string, check: (v: View, id: string, h: Element | undefined) => boolean, basis?: string) => {
  const id = lnk(feature, tag, spec, (v) => check(v, id, paraOf(v, id)?.getElementsByTagNameNS(NS.w, 'hyperlink')[0]), basis);
  body.push(xml(id));
};
const hl = (attrs: string, text: string) => `<w:hyperlink ${attrs}><w:r><w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:hyperlink>`;
lItem('Link to a web page', 'supported', '§17.16.22 hyperlink@r:id; Insert ▸ Link', (id) => para(run(`${id} `) + hl('r:id="{{LINK:https://example.org/sampler}}"', 'example.org')), (v, _id, h) => v.target('word/document.xml', at(h, 'r:id') ?? '') === 'https://example.org/sampler');
lItem('E-mail link', 'supported', '§17.16.22 hyperlink (mailto)', (id) => para(run(`${id} `) + hl('r:id="{{LINK:mailto:sampler@example.org?subject=Hello}}"', 'write to us')), (v, _id, h) => (v.target('word/document.xml', at(h, 'r:id') ?? '') ?? '').startsWith('mailto:sampler@example.org'));
lItem('Link to a place in this document (bookmark)', 'supported', '§17.16.22 hyperlink@anchor', (id) => para(run(`${id} `) + hl('w:anchor="SamplerTarget"', 'jump to the target')), (_v, _id, h) => at(h, 'w:anchor') === 'SamplerTarget');
lItem('Link with a ScreenTip', 'loss', '§17.16.22 hyperlink@tooltip', (id) => para(run(`${id} `) + hl('r:id="{{LINK:https://example.org/tip}}" w:tooltip="Sampler ScreenTip"', 'hover me')), (_v, _id, h) => at(h, 'w:tooltip') === 'Sampler ScreenTip', 'docx-read.ts:1806 (tooltip not kept)');
lItem('Link opening in a new window', 'loss', '§17.16.22 hyperlink@tgtFrame', (id) => para(run(`${id} `) + hl('r:id="{{LINK:https://example.org/new}}" w:tgtFrame="_blank"', 'new window')), (_v, _id, h) => at(h, 'w:tgtFrame') === '_blank', 'docx-read.ts:1806');
lItem('HYPERLINK field', 'supported', '§17.16.5.25 HYPERLINK', (id) => para(run(`${id} `) + field('HYPERLINK "https://example.org/field"', 'field link', '<w:rStyle w:val="Hyperlink"/>')),
  (v, id, h) => (!!h && v.target('word/document.xml', at(h, 'r:id') ?? '') === 'https://example.org/field') || /HYPERLINK\s+"https:\/\/example\.org\/field"/.test(instrs(paraOf(v, id))), 'docx-read.ts startField (becomes a link)');
const bm = lnk('Bookmark', 'supported', '§17.13.6.2 bookmarkStart; Insert ▸ Bookmark', (v) => v.all(/^word\/document\.xml$/, 'w:bookmarkStart').some((b) => at(b, 'w:name') === 'SamplerTarget'));
const bmRange = lnk('Bookmark around two words only', 'loss', '§17.13.6.2 bookmarkStart/bookmarkEnd range', (v) => {
  const p = paraOf(v, bmRange);
  const s = Array.from(p?.getElementsByTagNameNS(NS.w, 'bookmarkStart') ?? []).find((b) => at(b, 'w:name') === 'SamplerRange');
  // the range starts after the id's run, so the paragraph's first run is outside it
  return !!s && s.previousElementSibling?.localName === 'r';
}, 'docx-read.ts (bookmarks collapse to their paragraph)');
body.push(`<w:p><w:bookmarkStart w:id="20" w:name="SamplerTarget"/>${run(`${bm} the target of the link above`)}<w:bookmarkEnd w:id="20"/></w:p>`,
  `<w:p>${run(`${bmRange} before `)}<w:bookmarkStart w:id="21" w:name="SamplerRange"/>${run('two words')}<w:bookmarkEnd w:id="21"/>${run(' after')}</w:p>`);

// ---------------------------------------------------------------------------------------------
// Content controls

const sItem = (feature: string, tag: T, spec: string, sdtPr: string, inner: (id: string) => string, check: (s: Element | undefined) => boolean, block = false, basis = 'docx-read.ts:1041 control (other programs\' controls kept)') => {
  const id = sdt(feature, tag, spec, (v) => {
    const s = v.all(/^word\/document\.xml$/, 'w:sdt').find((e) => (e.textContent ?? '').includes(id));
    return check(kid(s, 'w:sdtPr'));
  }, basis);
  body.push(block ? `<w:sdt><w:sdtPr>${sdtPr}</w:sdtPr><w:sdtContent>${para(inner(id))}</w:sdtContent></w:sdt>`
    : para(run(`${id} ${feature}: `) + `<w:sdt><w:sdtPr>${sdtPr}</w:sdtPr><w:sdtContent>${inner(id)}</w:sdtContent></w:sdt>`));
};
sItem('Plain text content control', 'kept', '§17.5.2.44 text; Developer ▸ Plain Text Content Control', '<w:alias w:val="Sampler text"/><w:tag w:val="sampler-text"/><w:id w:val="501"/><w:text/>', (id) => run(`${id} typed text`), (p) => !!kid(p, 'w:text') && val(p, 'w:tag') === 'sampler-text');
sItem('Rich text content control around a paragraph', 'kept', '§17.5.2.29 richText', '<w:alias w:val="Sampler rich"/><w:tag w:val="sampler-rich"/><w:id w:val="502"/><w:richText/>', (id) => run(`${id} rich text control around a paragraph`), (p) => val(p, 'w:tag') === 'sampler-rich', true);
sItem('Drop-down list content control', 'kept', '§17.5.2.15 dropDownList', '<w:alias w:val="Sampler list"/><w:tag w:val="sampler-list"/><w:id w:val="503"/><w:dropDownList><w:listItem w:displayText="Benzene" w:value="1"/><w:listItem w:displayText="Toluene" w:value="2"/></w:dropDownList>', (id) => run(`${id} Benzene`), (p) => (kid(p, 'w:dropDownList')?.children.length ?? 0) === 2);
sItem('Combo box content control', 'kept', '§17.5.2.5 comboBox', '<w:tag w:val="sampler-combo"/><w:id w:val="504"/><w:comboBox><w:listItem w:displayText="Acetone" w:value="A"/></w:comboBox>', (id) => run(`${id} Acetone`), (p) => !!kid(p, 'w:comboBox'));
sItem('Date picker content control', 'kept', '§17.5.2.7 date', '<w:tag w:val="sampler-date"/><w:id w:val="505"/><w:date w:fullDate="2026-01-02T00:00:00Z"><w:dateFormat w:val="M/d/yyyy"/><w:lid w:val="en-US"/><w:storeMappedDataAs w:val="dateTime"/><w:calendar w:val="gregorian"/></w:date>', (id) => run(`${id} 1/2/2026`), (p) => at(kid(p, 'w:date'), 'w:fullDate')?.startsWith('2026-01-02') ?? false);
sItem('Check box content control', 'kept', 'Word 2010 w14:checkbox; Developer ▸ Check Box Content Control', '<w:tag w:val="sampler-check"/><w:id w:val="506"/><w14:checkbox><w14:checked w14:val="1"/><w14:checkedState w14:val="2612" w14:font="MS Gothic"/><w14:uncheckedState w14:val="2610" w14:font="MS Gothic"/></w14:checkbox>', (id) => run(`☒ ${id}`, '<w:rFonts w:ascii="MS Gothic" w:eastAsia="MS Gothic" w:hAnsi="MS Gothic" w:hint="eastAsia"/>'), (p) => Array.from(p?.children ?? []).some((c) => c.localName === 'checkbox'));
sItem('Content control placeholder text', 'kept', '§17.5.2.38 showingPlcHdr', '<w:tag w:val="sampler-placeholder"/><w:id w:val="507"/><w:showingPlcHdr/><w:text/>', (id) => run(`${id} Click or tap here to enter text.`, '<w:color w:val="808080"/>'), (p) => on(p, 'w:showingPlcHdr'));

// ---------------------------------------------------------------------------------------------

const STYLES = ['FootnoteText', 'EndnoteText', 'CommentText'].map((s) => `<w:style w:type="paragraph" w:styleId="${s}"><w:name w:val="${s.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()}"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="20"/></w:rPr></w:style>`).join('')
  + ['FootnoteReference', 'EndnoteReference'].map((s) => `<w:style w:type="character" w:styleId="${s}"><w:name w:val="${s.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()}"/><w:basedOn w:val="DefaultParagraphFont"/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>`).join('')
  + '<w:style w:type="character" w:styleId="CommentReference"><w:name w:val="annotation reference"/><w:basedOn w:val="DefaultParagraphFont"/><w:rPr><w:sz w:val="16"/></w:rPr></w:style>';

const sepNotes = (kind: string) => `<w:${kind} w:type="separator" w:id="-1"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:separator/></w:r></w:p></w:${kind}><w:${kind} w:type="continuationSeparator" w:id="0"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:continuationSeparator/></w:r></w:p></w:${kind}>`;

export const docxFieldsNotes: Sampler = {
  name: 'docx-fields-notes.docx', area: 'Word fields, footnotes, endnotes, comments, tracked changes, hyperlinks, bookmarks and content controls', items,
  build: () => wordFile({
    title: 'Word sampler: fields, notes and review', styles: STYLES,
    settings: '<w:trackRevisions/><w:defaultTabStop w:val="720"/><w:characterSpacingControl w:val="doNotCompress"/><w:footnotePr><w:numFmt w:val="lowerLetter"/><w:footnote w:id="-1"/><w:footnote w:id="0"/></w:footnotePr><w:endnotePr><w:numFmt w:val="upperRoman"/><w:endnote w:id="-1"/><w:endnote w:id="0"/></w:endnotePr><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>',
    sect: () => '<w:footnotePr><w:numFmt w:val="lowerLetter"/></w:footnotePr><w:endnotePr><w:numFmt w:val="upperRoman"/></w:endnotePr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/><w:cols w:space="720"/>',
    body: (w) => {
      for (const kind of ['footnote', 'endnote'] as const) {
        const list = notes.filter((n) => n.kind === kind).map((n) => `<w:${kind} w:id="${n.id}">${n.xml}</w:${kind}>`).join('');
        let xml = `${XML_HEAD}<w:${kind}s ${W_NS}>${sepNotes(kind)}${list}</w:${kind}s>`;
        if (xml.includes('@ENDLINK@')) xml = xml.replace('@ENDLINK@', w.relFrom(`${kind}s.xml`, REL.hyperlink, 'https://example.org/endnote', true));
        w.part(`${kind}s.xml`, xml, kind === 'footnote' ? CT.footnotes : CT.endnotes, kind === 'footnote' ? REL.footnotes : REL.endnotes);
      }
      w.part('comments.xml', `${XML_HEAD}<w:comments ${W_NS}>${comments.map((c) => c.xml).join('')}</w:comments>`, CT.comments, REL.comments);
      w.part('commentsExtended.xml', `${XML_HEAD}<w15:commentsEx ${W_NS}>${comments.map((c) => `<w15:commentEx w15:paraId="${c.paraId}"${c.parent ? ` w15:paraIdParent="${c.parent}"` : ''} w15:done="${c.done ? 1 : 0}"/>`).join('')}</w15:commentsEx>`,
        'application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtended+xml', 'http://schemas.microsoft.com/office/2011/relationships/commentsExtended');
      return body.join('').replace(/{{LINK:([^}]+)}}/g, (_m, url: string) => w.rel(REL.hyperlink, url.replace(/&amp;/g, '&'), true));
    },
  }),
};
