// @vitest-environment jsdom
//
// A Word comment changed here keeps the formatting of its paragraphs left as they were (G3-17):
// only the paragraphs whose text changed are written plain. The comments part is written by hand
// from the element names of ECMA-376 Part 1, 17.13.4 (w:comment, w:p, w:r, w:rPr), not taken from
// a file Word made.

import { describe, it, expect } from 'vitest';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { readDocx, writeDocx, type DocxDeps } from '../src/io/docx';
import { commentPieces } from '../src/io/docx-write';
import { withNoteRuns, type PinnedComment } from '../src/document/comments';
import { threadCard, type ThreadActions } from '../src/ui/comment-cards';
import { readLegacyComments, readModernComments, writeSlideComments } from '../src/io/pptx-comments';
import { SlideComments } from '../src/ui/slide-comments';
import type { Deck } from '../src/deck/deck';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const W14 = 'xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const deps: DocxDeps = { async picture() { return null; } };
const u8 = (s: string) => new Uint8Array(strToU8(s));
const rels = (list: [string, string, string][]) => `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.map(([id, type, target]) => `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`).join('')}</Relationships>`;
const CT = '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/></Types>';

/** A comment of three paragraphs: "Use CH2Cl2" (bold, subscripts), "then dry it" and "Rf 0.3" (Rf with a subscript f). */
function wordFile(): Uint8Array {
  const body = '<w:p><w:commentRangeStart w:id="0"/><w:r><w:t>Dissolve in DCM</w:t></w:r><w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r></w:p>';
  const p = (id: string, runs: string, first = false) => `<w:p w14:paraId="${id}" w14:textId="77777777"><w:pPr><w:pStyle w:val="CommentText"/></w:pPr>${first ? '<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:annotationRef/></w:r>' : ''}${runs}</w:p>`;
  const comment = '<w:comment w:id="0" w:author="Nate" w:date="2026-10-14T16:00:00Z" w:initials="N">'
    + p('1A2B3C4D', '<w:r><w:t xml:space="preserve">Use </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>CH</w:t></w:r><w:r><w:rPr><w:b/><w:vertAlign w:val="subscript"/></w:rPr><w:t>2</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>Cl</w:t></w:r><w:r><w:rPr><w:b/><w:vertAlign w:val="subscript"/></w:rPr><w:t>2</w:t></w:r>', true)
    + p('2B3C4D5E', '<w:r><w:t>then dry it</w:t></w:r>')
    + p('3C4D5E6F', '<w:r><w:rPr><w:i/></w:rPr><w:t>R</w:t></w:r><w:r><w:rPr><w:i/><w:vertAlign w:val="subscript"/></w:rPr><w:t>f</w:t></w:r><w:r><w:t xml:space="preserve"> 0.3</w:t></w:r>')
    + '</w:comment>';
  return zipSync({
    '[Content_Types].xml': u8(CT),
    '_rels/.rels': u8(rels([['rId1', `${R}officeDocument`, 'word/document.xml']])),
    'word/_rels/document.xml.rels': u8(rels([['rId4', `${R}comments`, 'comments.xml']])),
    'word/document.xml': u8(`<?xml version="1.0"?><w:document ${W}><w:body>${body}<w:sectPr/></w:body></w:document>`),
    'word/comments.xml': u8(`<?xml version="1.0"?><w:comments ${W} ${W14}>${comment}</w:comments>`),
  });
}

async function changed(text: string): Promise<string> {
  const { doc } = await readDocx(wordFile());
  const id = Number(Object.keys(doc.comments ?? {})[0]);
  doc.comments![id] = { ...doc.comments![id], text };
  return strFromU8(unzipSync(await writeDocx(doc, deps))['word/comments.xml']);
}

describe('a Word comment changed here', () => {
  it('reads each paragraph\'s own text with the paragraphs Word wrote', async () => {
    const { doc } = await readDocx(wordFile());
    const c = Object.values(doc.comments ?? {})[0];
    expect(c.text).toBe('Use CH2Cl2\nthen dry it\nRf 0.3');
    expect(c.word?.texts).toEqual(['Use CH2Cl2', 'then dry it', 'Rf 0.3']);
  });

  it('keeps the looks of the paragraphs left as they were; the one changed is plain', async () => {
    const xml = await changed('Use CH2Cl2\nthen dry it over MgSO4\nRf 0.3');
    // the first and last as Word wrote them
    expect(xml).toContain('<w:r><w:rPr><w:b/><w:vertAlign w:val="subscript"/></w:rPr><w:t>2</w:t></w:r>');
    expect(xml).toContain('<w:r><w:rPr><w:i/><w:vertAlign w:val="subscript"/></w:rPr><w:t>f</w:t></w:r>');
    expect(xml).toContain('then dry it over MgSO4');
    // three paragraphs, the comment mark once, in the first
    expect(xml.match(/<w:p /g)).toHaveLength(3);
    expect(xml.match(/<w:annotationRef\/>/g)).toHaveLength(1);
    // and it reads back as typed
    const { doc } = await readDocx(wordFile());
    const id = Number(Object.keys(doc.comments ?? {})[0]);
    doc.comments![id] = { ...doc.comments![id], text: 'Use CH2Cl2\nthen dry it over MgSO4\nRf 0.3' };
    const again = (await readDocx(await writeDocx(doc, deps))).doc;
    expect(Object.values(again.comments ?? {})[0].text).toBe('Use CH2Cl2\nthen dry it over MgSO4\nRf 0.3');
  });

  it('a first paragraph changed: the mark goes on the plain one, and not again on the kept ones', async () => {
    const xml = await changed('Use toluene\nthen dry it\nRf 0.3');
    expect(xml).not.toContain('<w:b/>');
    expect(xml).toContain('<w:vertAlign w:val="subscript"/></w:rPr><w:t>f</w:t>');
    expect(xml.match(/<w:annotationRef\/>/g)).toHaveLength(1);
    expect(xml.indexOf('<w:annotationRef/>')).toBeLessThan(xml.indexOf('Use toluene'));
  });

  it('Word\'s first paragraph removed: the paragraph now first gets the comment mark (F3-R10)', async () => {
    const xml = await changed('then dry it\nRf 0.3');
    expect(xml.match(/<w:p /g)).toHaveLength(2);
    expect(xml.match(/<w:annotationRef\/>/g)).toHaveLength(1);
    expect(xml.indexOf('<w:annotationRef/>')).toBeLessThan(xml.indexOf('then dry it'));
    // after the paragraph's properties, as Word puts it
    expect(xml.indexOf('<w:annotationRef/>')).toBeGreaterThan(xml.indexOf('</w:pPr>'));
    expect(xml).toContain('<w:vertAlign w:val="subscript"/></w:rPr><w:t>f</w:t>');
  });

  it('matches the paragraphs in order, whole lines only', () => {
    const word = { paras: ['<w:p>a</w:p>', '<w:p>b</w:p>', '<w:p>c</w:p>'], texts: ['A', 'B', 'C'], text: 'A\nB\nC' };
    const c = (text: string) => commentPieces({ author: '', date: '', text, word });
    expect(c('A\nB\nC')).toEqual([0, 1, 2]);
    expect(c('A\nnew\nC')).toEqual([0, { line: 'new', at: 2 }, 2]);
    expect(c('A\nC')).toEqual([0, 2]);
    expect(c('AB\nC')).toEqual([{ line: 'AB', at: 0 }, 2]);
    expect(c('C\nA')).toEqual([2, { line: 'A', at: 2 }]);
    expect(c('')).toEqual([{ line: '', at: 0 }]);
    // (a file read before each paragraph's text was kept: plain, as before)
    expect(commentPieces({ author: '', date: '', text: 'A\nB', word: { paras: word.paras, text: 'A\nB\nC' } })).toEqual([{ line: 'A', at: 0 }, { line: 'B', at: 2 }]);
  });
});

describe('comment cards edit the words\' looks (G3-17)', () => {
  const actions = (): ThreadActions & { calls: unknown[][] } => {
    const calls: unknown[][] = [];
    return { calls, edit: (...a: unknown[]) => { calls.push(a); }, reply: () => undefined, removeReply: () => undefined, resolve: () => undefined, remove: () => undefined, focus: () => undefined } as ThreadActions & { calls: unknown[][] };
  };

  it('a Word comment\'s card shows its looks, and Ctrl+B in it saves them with the text', async () => {
    const { doc } = await readDocx(wordFile());
    const c = Object.values(doc.comments ?? {})[0];
    expect(c.runs?.find((r) => r.text === 'CH')).toEqual({ text: 'CH', bold: true });
    const a = actions();
    const card = threadCard(c, { active: true, editing: true, actions: a, rich: true });
    document.body.append(card);
    const box = card.querySelector<HTMLElement>('.cmt-rich')!;
    expect(box).not.toBeNull();
    expect([...box.querySelectorAll('span')].find((x) => x.textContent === 'f')!.style.verticalAlign).toBe('sub');
    // "then" (the start of the second line) selected, Ctrl+B, Enter
    box.tabIndex = 0;
    box.focus();
    const spans = [...box.querySelectorAll('span')];
    const line2 = spans.find((x) => x.textContent!.includes('then'))!.firstChild as Text;
    const at = line2.data.indexOf('then');
    getSelection()!.setBaseAndExtent(line2, at, line2, at + 4);
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true }));
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const [text, reply, runs] = a.calls[0] as [string, undefined, { text: string; bold?: boolean; sub?: boolean }[]];
    expect(text).toBe(c.text);
    expect(reply).toBeUndefined();
    expect(runs.find((r) => r.text === 'then')).toEqual({ text: 'then', bold: true });
    expect(runs.filter((r) => r.sub).map((r) => r.text)).toEqual(['2', '2', 'f']);
    card.remove();

    // saved: the changed paragraph is written afresh with its looks, the others as Word wrote them
    const id = Number(Object.keys(doc.comments ?? {})[0]);
    doc.comments![id] = withNoteRuns(c, text, runs);
    const xml = strFromU8(unzipSync(await writeDocx(doc, deps))['word/comments.xml']);
    expect(xml).toContain('<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">then</w:t></w:r>');
    expect(xml).toContain('<w:r><w:rPr><w:i/><w:vertAlign w:val="subscript"/></w:rPr><w:t>f</w:t></w:r>');
    expect(xml.match(/<w:annotationRef\/>/g)).toHaveLength(1);
    const back = Object.values((await readDocx(await writeDocx(doc, deps))).doc.comments ?? {})[0];
    expect(back.runs?.find((r) => r.text === 'then')).toEqual({ text: 'then', bold: true });
  });

  it('a changed line keeps its looks when written afresh (subscript typed in the card)', async () => {
    const { doc } = await readDocx(wordFile());
    const id = Number(Object.keys(doc.comments ?? {})[0]);
    const c = doc.comments![id];
    doc.comments![id] = withNoteRuns(c, 'Use CH2Cl2\nthen dry it over MgSO4\nRf 0.3', [
      { text: 'Use ' }, { text: 'CH', bold: true }, { text: '2', bold: true, sub: true }, { text: 'Cl', bold: true }, { text: '2', bold: true, sub: true },
      { text: '\nthen dry it over MgSO' }, { text: '4', sub: true }, { text: '\n' }, { text: 'R', italic: true }, { text: 'f', italic: true, sub: true }, { text: ' 0.3' },
    ]);
    const xml = strFromU8(unzipSync(await writeDocx(doc, deps))['word/comments.xml']);
    expect(xml).toContain('<w:r><w:rPr><w:vertAlign w:val="subscript"/></w:rPr><w:t xml:space="preserve">4</w:t></w:r>');
    expect(xml.match(/<w:p /g)).toHaveLength(3);
  });

  it('a slide comment\'s looks are kept through a PowerPoint file (in an extension; PowerPoint shows the words)', () => {
    const c: PinnedComment = withNoteRuns({ id: 0, x: 10, y: 20, author: 'Nate', date: '2026-10-14T16:00:00.000Z', text: '' }, 'Use 3a', [{ text: 'Use ' }, { text: '3a', bold: true }]);
    const out = writeSlideComments([[c]]);
    expect(out.slides[0]).toContain('<p:text>Use 3a</p:text>');
    const authors = new Map([['0', 'Nate']]);
    const back = readLegacyComments(new DOMParser().parseFromString(out.slides[0]!, 'application/xml'), authors);
    expect(back[0].text).toBe('Use 3a');
    expect(back[0].runs).toEqual([{ text: 'Use ' }, { text: '3a', bold: true }]);
    // text changed in PowerPoint: the looks no longer say it, and go
    const edited = out.slides[0]!.replace('<p:text>Use 3a</p:text>', '<p:text>Use 3b</p:text>');
    expect(readLegacyComments(new DOMParser().parseFromString(edited, 'application/xml'), authors)[0].runs).toBeUndefined();
  });

  it('reads a PowerPoint 365 comment\'s looks (a:rPr b, i, baseline)', () => {
    // written by hand from the element names of PowerPoint's modern comments part (p188:cm, p188:txBody, a:p, a:r, a:rPr)
    const x = '<p188:cmLst xmlns:p188="http://schemas.microsoft.com/office/powerpoint/2018/8/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
      + '<p188:cm id="{1}" authorId="{A}" created="2026-10-14T16:00:00.000"><p188:txBody><a:bodyPr/><a:p><a:r><a:rPr lang="en-US"/><a:t>Yield of </a:t></a:r><a:r><a:rPr lang="en-US" b="1"/><a:t>3a</a:t></a:r><a:r><a:rPr lang="en-US" i="1"/><a:t> R</a:t></a:r><a:r><a:rPr lang="en-US" i="1" baseline="-25000"/><a:t>f</a:t></a:r></a:p></p188:txBody></p188:cm></p188:cmLst>';
    const got = readModernComments(new DOMParser().parseFromString(x, 'application/xml'), new Map([['{A}', 'Nate']]));
    expect(got[0].text).toBe('Yield of 3a Rf');
    expect(got[0].runs).toEqual([{ text: 'Yield of ' }, { text: '3a', bold: true }, { text: ' R', italic: true }, { text: 'f', italic: true, sub: true }]);
  });
});

describe('a comment edited and left as it was makes no step (F3-R02)', () => {
  it('the same note back when neither its words nor their looks changed', () => {
    const plain = { author: 'Nate', date: '', text: 'hello' };
    expect(withNoteRuns(plain, 'hello', null)).toBe(plain);
    expect(withNoteRuns(plain, 'hello', [{ text: 'hello' }])).toBe(plain);
    const bold = withNoteRuns(plain, 'hello', [{ text: 'hello', bold: true }]);
    expect(bold).not.toBe(plain);
    expect(withNoteRuns(bold, 'hello', [{ text: 'hello', bold: true }])).toBe(bold);
    // bold taken off: its looks known (none)
    expect(withNoteRuns(bold, 'hello', null).runs).toEqual([]);
    // new words, none set: no looks added
    expect(withNoteRuns(plain, 'hi', null)).toEqual({ author: 'Nate', date: '', text: 'hi' });
  });

  it('Edit then Escape on a slide comment (and a reply) from a plain PowerPoint file changes nothing', () => {
    const c: PinnedComment = { id: 1, x: 0, y: 0, author: 'Nate', date: '', text: 'hello', replies: [{ author: 'Ana', date: '', text: 'ok' }] };
    const steps: string[] = [];
    const deck = { current: { id: 7, comments: [c] }, size: { w: 960, h: 540 }, setComments: (_: PinnedComment[], label: string) => { steps.push(label); } } as unknown as Deck;
    const host = document.createElement('div');
    const sc = new SlideComments(document.createElement('section'), host, { deck: () => deck, anchor: () => null, view: () => ({ ox: 0, oy: 0, scale: 1 }) as never, askName: async () => true, flash: () => undefined, focus: () => undefined, reveal: () => undefined });
    const a = (sc as unknown as { actions(id: number): ThreadActions }).actions(1);
    a.edit('hello', undefined, null);
    a.edit('ok', 0, null);
    expect(steps).toEqual([]);
    a.edit('hello there', undefined, null);
    expect(steps).toEqual(['Edit comment']);
  });
});
