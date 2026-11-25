/**
 * Excel sampler: notes, threaded comments (X-CMT) and hyperlinks (X-LNK). One row per item: the id
 * in column A, the cell with the note, comment or link in column B.
 * ECMA-376 Part 1 §18.7 (comments: §18.7.3 comment, §18.7.1 author), Part 4 / VML (the notes'
 * shapes), §18.3.1.47 hyperlink; MS-XLSX 2.3.x threaded comments and persons (Excel 365);
 * Excel's Review ▸ New Note / New Comment and Insert ▸ Link.
 *
 * Tags from src/io/xlsx-notes.ts readNotes (:192) and notesParts (:86): notes keep their author,
 * runs and shown flag, their VML box is made again; threaded comments with replies, done and
 * people are read and written (ids made again). Links: src/io/xlsx.ts :2074 (read; a range's link
 * goes on each cell) and :1043 (written: tooltip and display not written for external links).
 */
import { type Item, type Sampler, type View, itemList, kid, esc } from './kit';
import { Book, rowOf, relsOf, xKids, wbPath, covers, XCT, XREL, X_MAIN, siText } from './xlsx';

const items: Item[] = [];
const book = new Book();
const sh = book.sheet('Notes and links');
sh.set('cols', '<cols><col min="1" max="1" width="50" customWidth="1"/><col min="2" max="2" width="20" customWidth="1"/></cols>');
type Tag = 'supported' | 'kept' | 'loss';
const TC = 'http://schemas.microsoft.com/office/spreadsheetml/2018/threadedcomments';
const VML_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing';
const LINK_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink';

// ---------------------------------------------------------------------------------------------
// Notes and comments (X-CMT)

const cmt = itemList('X-CMT', items);
const authors = ['Sampler Author'];
const comments: string[] = [];
const shapes: string[] = [];
const threads: string[] = [];
const persons = [{ id: '{5A1E0C1B-0000-4000-8000-000000000001}', name: 'Ada Sampler' }, { id: '{5A1E0C1B-0000-4000-8000-000000000002}', name: 'Ben Sampler' }];

/** The sheet's comments part, threaded comments part and VML, saved. */
const sheetPart = (v: View, id: string, type: string) => { const f = rowOf(v, id); return f ? relsOf(v, f.sheet.path).find((r) => r.type === type)?.target : undefined; };
/** The legacy comment on B of the item's row. */
function commentOf(v: View, id: string): { c?: Element; author?: string } {
  const f = rowOf(v, id);
  const p = sheetPart(v, id, XREL.comments);
  const root = p ? v.doc(p)?.documentElement : undefined;
  const c = xKids(kid(root, 'x:commentList'), 'comment').find((x) => x.getAttribute('ref') === `B${(f?.r ?? -2) + 1}`);
  const list = xKids(kid(root, 'x:authors'), 'author').map((a) => a.textContent ?? '');
  return { c, author: c ? list[Number(c.getAttribute('authorId') ?? 0)] : undefined };
}
/** The threaded comments on B of the item's row (the first, then its replies). */
function threadOf(v: View, id: string): Element[] {
  const f = rowOf(v, id);
  const p = sheetPart(v, id, XREL.threaded);
  const root = p ? v.doc(p)?.documentElement : undefined;
  return root ? Array.from(root.getElementsByTagNameNS(TC, 'threadedComment')).filter((t) => t.getAttribute('ref') === `B${(f?.r ?? -2) + 1}`) : [];
}
/** The VML shape of the note on B of the item's row. */
function noteShape(v: View, id: string): string | undefined {
  const f = rowOf(v, id);
  const p = sheetPart(v, id, VML_REL);
  const text = p ? v.parts[p] : undefined;
  if (!f || !text) return undefined;
  return [...text.matchAll(/<v:shape\b[\s\S]*?<\/v:shape>/g)].map((m) => m[0]).find((s) => new RegExp(`<x:Row>\\s*${f.r}\\s*</x:Row>`).test(s) && /<x:Column>\s*1\s*<\/x:Column>/.test(s));
}
const personName = (v: View, pid: string | null) => {
  const p = relsOf(v, wbPath(v)).find((r) => r.type === XREL.persons)?.target;
  const root = p ? v.doc(p)?.documentElement : undefined;
  return root ? Array.from(root.getElementsByTagNameNS(TC, 'person')).find((x) => x.getAttribute('id') === pid)?.getAttribute('displayName') : undefined;
};

const NR = (b = false) => `<rPr>${b ? '<b/>' : ''}<sz val="9"/><color indexed="81"/><rFont val="Tahoma"/><family val="2"/></rPr>`;
/** A note on B of a new row: `runs` its text element's contents. */
function note(feature: string, tag: Tag, spec: string, runs: string, check: (v: View, id: string) => boolean, o: { author?: string; visible?: boolean; basis?: string; box?: string } = {}): string {
  const id = cmt(feature, tag, spec, (v) => check(v, id), o.basis ?? 'xlsx-notes.ts:192 readNotes, :86 notesParts');
  const r = sh.item(id, feature, 'noted');
  const author = o.author ?? authors[0];
  if (!authors.includes(author)) authors.push(author);
  comments.push(`<comment ref="B${r + 1}" authorId="${authors.indexOf(author)}"><text>${runs}</text></comment>`);
  shapes.push(`<v:shape id="_x0000_s${1025 + shapes.length}" type="#_x0000_t202" style="position:absolute;margin-left:300pt;margin-top:${r * 15}pt;${o.box ?? 'width:108pt;height:59.25pt'};z-index:${shapes.length + 1};visibility:${o.visible ? 'visible' : 'hidden'}" fillcolor="#ffffe1" o:insetmode="auto">`
    + '<v:fill color2="#ffffe1"/><v:shadow on="t" color="black" obscured="t"/><v:path o:connecttype="none"/><v:textbox style="mso-direction-alt:auto"><div style="text-align:left"></div></v:textbox>'
    + `<x:ClientData ObjectType="Note"><x:MoveWithCells/><x:SizeWithCells/><x:Anchor>2, 15, ${r}, 10, 4, 15, ${r + 4}, 4</x:Anchor><x:AutoFill>False</x:AutoFill><x:Row>${r}</x:Row><x:Column>1</x:Column>${o.visible ? '<x:Visible/>' : ''}</x:ClientData></v:shape>`);
  return id;
}
const C = '§18.7.3 comment; Review ▸ New Note';
const textOf = (c: Element | undefined) => (c ? siText(kid(c, 'x:text')!) : '');
note('Note with the author\'s name first', 'supported', C, `<r>${NR(true)}<t>Sampler Author:</t></r><r>${NR()}<t>X-CMT plain note text</t></r>`,
  (v, id) => { const n = commentOf(v, id); return n.author === 'Sampler Author' && textOf(n.c).includes('X-CMT plain note text'); });
note('Note without an author line', 'supported', C, `<r>${NR()}<t>X-CMT note with no author line</t></r>`,
  (v, id) => textOf(commentOf(v, id).c) === 'X-CMT note with no author line');
note('Note by a second author', 'supported', `${C}, §18.7.1 author`, `<r>${NR(true)}<t>Second Person:</t></r><r>${NR()}<t>X-CMT by another</t></r>`,
  (v, id) => commentOf(v, id).author === 'Second Person', { author: 'Second Person' });
note('Note with bold, italic and subscript runs', 'supported', `${C}, §18.4.7 rPr in a note`, `<r>${NR()}<t>H</t></r><r><rPr><vertAlign val="subscript"/><sz val="9"/><color indexed="81"/><rFont val="Tahoma"/><family val="2"/></rPr><t>2</t></r><r><rPr><b/><i/><sz val="9"/><color indexed="81"/><rFont val="Tahoma"/><family val="2"/></rPr><t>O bold</t></r>`,
  (v, id) => { const rs = xKids(kid(commentOf(v, id).c, 'x:text'), 'r'); return rs.some((r) => kid(kid(r, 'x:rPr'), 'x:vertAlign')?.getAttribute('val') === 'subscript') && rs.some((r) => !!kid(kid(r, 'x:rPr'), 'x:b') && !!kid(kid(r, 'x:rPr'), 'x:i')); });
note('Note always shown', 'supported', `${C}; VML x:Visible; Review ▸ Show/Hide Note`, `<r>${NR()}<t>X-CMT shown note</t></r>`,
  (v, id) => /<x:Visible\s*\/>|visibility:\s*visible/.test(noteShape(v, id) ?? ''), { visible: true, basis: 'xlsx-notes.ts:177 shownNotes' });
note('Note box size (200 × 100 pt)', 'loss', `${C}; VML shape style width/height; resize the note`, `<r>${NR()}<t>X-CMT large note</t></r>`,
  (v, id) => /width:200pt;height:100pt/.test(noteShape(v, id) ?? ''), { box: 'width:200pt;height:100pt', basis: 'xlsx-notes.ts:133 (box made again at 108 × 59.25 pt)' });
note('Note with a line break', 'supported', C, `<r>${NR()}<t>X-CMT first line&#10;second line</t></r>`,
  (v, id) => /X-CMT first line\r?\nsecond line/.test(textOf(commentOf(v, id).c)));

/** A threaded comment (and replies) on B of a new row, with its legacy copy as Excel writes it. */
function thread(feature: string, tag: Tag, spec: string, list: { person: number; text: string; done?: boolean }[], check: (t: Element[], v: View, id: string) => boolean): string {
  const id = cmt(feature, tag, spec, (v) => check(threadOf(v, id), v, id), 'xlsx-notes.ts:200 readNotes (threaded), :100 notesParts');
  const r = sh.item(id, feature, 'commented');
  const top = `{7B0C0000-0000-4000-8000-${String(threads.length + 1).padStart(12, '0')}}`;
  list.forEach((t, k) => {
    const tid = k === 0 ? top : `{7B0C0000-0000-4000-8000-${String(threads.length + 1).padStart(12, '0')}}`;
    threads.push(`<threadedComment ref="B${r + 1}" dT="2026-01-0${k + 1}T10:00:00.00" personId="${persons[t.person].id}" id="${tid}"${k ? ` parentId="${top}"` : ''}${t.done ? ' done="1"' : ''}><text>${esc(t.text)}</text></threadedComment>`);
  });
  const legacyAuthor = `tc=${top}`;
  authors.push(legacyAuthor);
  comments.push(`<comment ref="B${r + 1}" authorId="${authors.length - 1}" shapeId="0"><text><t>[Threaded comment]\n\nYour version of Excel allows you to read this threaded comment; however, any edits to it will get removed if the file is opened in a newer version of Excel. Learn more: https://go.microsoft.com/fwlink/?linkid=870924\n\nComment:\n    ${esc(list[0].text)}</t></text></comment>`);
  shapes.push(`<v:shape id="_x0000_s${1025 + shapes.length}" type="#_x0000_t202" style="position:absolute;margin-left:300pt;margin-top:${r * 15}pt;width:108pt;height:59.25pt;z-index:${shapes.length + 1};visibility:hidden" fillcolor="#ffffe1" o:insetmode="auto">`
    + '<v:fill color2="#ffffe1"/><v:shadow on="t" color="black" obscured="t"/><v:path o:connecttype="none"/><v:textbox style="mso-direction-alt:auto"><div style="text-align:left"></div></v:textbox>'
    + `<x:ClientData ObjectType="Note"><x:MoveWithCells/><x:SizeWithCells/><x:Anchor>2, 15, ${r}, 10, 4, 15, ${r + 4}, 4</x:Anchor><x:AutoFill>False</x:AutoFill><x:Row>${r}</x:Row><x:Column>1</x:Column></x:ClientData></v:shape>`);
  return id;
}
const T = 'MS-XLSX threadedComment (Excel 365); Review ▸ New Comment';
thread('Threaded comment', 'supported', T, [{ person: 0, text: 'X-CMT a threaded comment' }],
  (t, v) => t.length === 1 && t[0].getElementsByTagNameNS(TC, 'text')[0]?.textContent === 'X-CMT a threaded comment' && personName(v, t[0].getAttribute('personId')) === 'Ada Sampler');
thread('Threaded comment with two replies', 'supported', T, [{ person: 0, text: 'X-CMT question' }, { person: 1, text: 'X-CMT first reply' }, { person: 0, text: 'X-CMT second reply' }],
  (t) => t.length === 3 && t.filter((x) => x.getAttribute('parentId') === t.find((y) => !y.getAttribute('parentId'))?.getAttribute('id')).length === 2);
thread('Resolved thread (done)', 'supported', `${T}; Resolve thread`, [{ person: 1, text: 'X-CMT resolved', done: true }],
  (t) => t.some((x) => x.getAttribute('done') === '1' || x.getAttribute('done') === 'true'));
thread('Comment author (person)', 'supported', `${T}; MS-XLSX person`, [{ person: 1, text: 'X-CMT by Ben' }],
  (t, v) => personName(v, t[0]?.getAttribute('personId') ?? null) === 'Ben Sampler');
thread('Comment date and time (dT)', 'supported', T, [{ person: 0, text: 'X-CMT dated' }],
  (t) => (t[0]?.getAttribute('dT') ?? '').startsWith('2026-01-01T10:00:00'));

// ---------------------------------------------------------------------------------------------
// Hyperlinks (X-LNK): Insert ▸ Link

const lnk = itemList('X-LNK', items);
const links: string[] = [];
/** The hyperlink covering B of the item's row, and its relationship's target. */
function linkOf(v: View, id: string): { h?: Element; target?: string } {
  const f = rowOf(v, id);
  if (!f) return {};
  const h = xKids(kid(f.sheet.root, 'x:hyperlinks'), 'hyperlink').find((x) => covers(x.getAttribute('ref'), `B${f.r + 1}`));
  const rid = h?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
  return { h, target: rid ? relsOf(v, f.sheet.path).find((r) => r.id === rid)?.target : undefined };
}
const L = '§18.3.1.47 hyperlink; Insert ▸ Link';
function link(feature: string, tag: Tag, spec: string, o: { url?: string; location?: string; attrs?: string; to?: string }, check: (l: { h?: Element; target?: string }) => boolean, basis = 'xlsx.ts:2074 (read), :1043 (written)'): string {
  const id = lnk(feature, tag, spec, (v) => check(linkOf(v, id)), basis);
  const r = sh.item(id, feature, 'link text');
  const rid = o.url ? sh.rel(LINK_REL, o.url, true) : '';
  links.push(`<hyperlink ref="B${r + 1}${o.to ? `:${o.to}${r + 1}` : ''}"${rid ? ` r:id="${rid}"` : ''}${o.location ? ` location="${esc(o.location)}"` : ''}${o.attrs ? ' ' + o.attrs : ''}/>`);
  if (o.to) for (const c of ['C', 'D'].slice(0, o.to === 'D' ? 2 : 1)) sh.text(`${c}${r + 1}`, 'link text');
  return id;
}
link('Web address', 'supported', L, { url: 'https://example.com/sampler' }, (l) => l.target === 'https://example.com/sampler');
link('Web address with a fragment', 'supported', L, { url: 'https://example.com/page', location: 'section-2' }, (l) => (l.target === 'https://example.com/page' && l.h?.getAttribute('location') === 'section-2') || l.target === 'https://example.com/page#section-2');
link('E-mail address (mailto)', 'supported', `${L} ▸ E-mail Address`, { url: 'mailto:sampler@example.com?subject=X-LNK' }, (l) => l.target === 'mailto:sampler@example.com?subject=X-LNK');
link('File on disk', 'supported', `${L} ▸ Existing File`, { url: 'file:///C:/Samples/notes.txt' }, (l) => /notes\.txt$/.test(l.target ?? ''));
link('Place in this workbook (another sheet)', 'supported', `${L} ▸ Place in This Document`, { location: "'Notes and links'!A1", attrs: 'display="go to A1"' }, (l) => (l.h?.getAttribute('location') ?? '').replace(/'/g, '') === 'Notes and links!A1');
link('Place in this workbook (a defined name)', 'supported', `${L} ▸ Place in This Document ▸ Defined Names`, { location: 'SamplerTarget' }, (l) => l.h?.getAttribute('location') === 'SamplerTarget');
book.name('SamplerTarget', "'Notes and links'!$B$1");
link('ScreenTip (tooltip)', 'loss', `${L}@tooltip; Insert Link ▸ ScreenTip`, { url: 'https://example.com/tip', attrs: 'tooltip="X-LNK screen tip"' }, (l) => l.h?.getAttribute('tooltip') === 'X-LNK screen tip', 'xlsx.ts:1047 (tooltip not written)');
link('Display text of an external link', 'loss', `${L}@display`, { url: 'https://example.com/display', attrs: 'display="Shown text"' }, (l) => l.h?.getAttribute('display') === 'Shown text', 'xlsx.ts:1047');
link('One link over a range (B:D)', 'loss', `${L}@ref (a range)`, { url: 'https://example.com/range', to: 'D' }, (l) => /^B\d+:D\d+$/.test(l.h?.getAttribute('ref') ?? ''), 'xlsx.ts:2079 (a link on each cell)');
link('One link over a range still links each cell', 'supported', `${L}@ref (a range)`, { url: 'https://example.com/range2', to: 'D' }, (l) => l.target === 'https://example.com/range2');
link('Web address with spaces and unicode', 'supported', L, { url: 'https://example.com/a%20b/%C3%A9t%C3%A9' }, (l) => /a%20b\/(%C3%A9|é)t(%C3%A9|é)$/.test(l.target ?? ''));
const hl = lnk('HYPERLINK function', 'supported', '§18.17.7 HYPERLINK; Formulas ▸ Lookup & Reference ▸ HYPERLINK', (v) => {
  const f = rowOf(v, hl);
  const c = xKids(f?.row, 'c').find((x) => x.getAttribute('r') === `B${(f?.r ?? 0) + 1}`);
  return (kid(c, 'x:f')?.textContent ?? '') === 'HYPERLINK("https://example.com/fn","X-LNK function link")';
});
sh.item(hl, 'HYPERLINK function', { t: 'str', f: '<f>HYPERLINK("https://example.com/fn","X-LNK function link")</f>', v: 'X-LNK function link' });

let bytes: Uint8Array | undefined;
export const xlsxNotes: Sampler = {
  name: 'xlsx-notes.xlsx', area: 'Excel notes, threaded comments and hyperlinks', items,
  build: () => {
    if (bytes) return bytes;
    sh.set('hyperlinks', `<hyperlinks>${links.join('')}</hyperlinks>`);
    book.part('xl/comments1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><comments xmlns="${X_MAIN}"><authors>${authors.map((a) => `<author>${esc(a)}</author>`).join('')}</authors><commentList>${comments.join('')}</commentList></comments>`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml');
    sh.rel(XREL.comments, '../comments1.xml');
    book.part('xl/drawings/vmlDrawing1.vml', '<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">'
      + '<o:shapelayout v:ext="edit"><o:idmap v:ext="edit" data="1"/></o:shapelayout><v:shapetype id="_x0000_t202" coordsize="21600,21600" o:spt="202" path="m,l,21600r21600,l21600,xe"><v:stroke joinstyle="miter"/><v:path gradientshapeok="t" o:connecttype="rect"/></v:shapetype>'
      + `${shapes.join('')}</xml>`);
    sh.set('legacyDrawing', `<legacyDrawing r:id="${sh.rel(VML_REL, '../drawings/vmlDrawing1.vml')}"/>`);
    book.part('xl/threadedComments/threadedComment1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><ThreadedComments xmlns="${TC}" xmlns:x="${X_MAIN}">${threads.join('')}</ThreadedComments>`, XCT.threaded);
    sh.rel(XREL.threaded, '../threadedComments/threadedComment1.xml');
    book.wbPart('persons/person.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><personList xmlns="${TC}" xmlns:x="${X_MAIN}">${persons.map((p) => `<person displayName="${p.name}" id="${p.id}" userId="${p.name.replace(' ', '.').toLowerCase()}@example.com" providerId="None"/>`).join('')}</personList>`, XCT.persons, XREL.persons);
    return (bytes = book.build('Excel sampler: notes, comments, links'));
  },
};
