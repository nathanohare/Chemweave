// The checks in an SI project's text boxes, as Chem SI Assistant has them (SPEC §13k.1):
//
// - Spelling, with chemistry: Chemweave's own speller (the word lists SI Assistant uses, and
//   chemistry words, abbreviations and systematic names, see text/spelling.ts) rather than the
//   browser's, which underlines MeOH, equiv and CDCl3. Misspelled words get a wavy red line.
//   Right-click: corrections, Add to the project's dictionary (dictionary.txt in the project
//   folder, shared with co-authors and SI Assistant), Add to My Dictionary (this computer, all
//   projects: the same list as Document mode's, Edit ▸ Typing and Spelling) and Ignore.
// - Chemistry formatting (src/text/chemtext.ts): a formula without subscripts (PdCl2), a number
//   glued to its unit (1.2mmol), a hyphen in a number range, "1H NMR" without its superscript,
//   an unformatted deuterated solvent. A wavy blue line; right-click: Fix, Fix All in This Text,
//   Leave as Written in This Project (the word goes in dictionary.txt: never underlined,
//   subscripted or formatted when compiling) and Ignore.
// - Formatting as you type (when Edit ▸ Typing and Spelling formats chemistry): a formula's
//   digits go down as its word is finished (H2SO4 → H₂SO₄); Ctrl+Z takes it back.
//
// The lines are CSS highlights, so the text itself is not changed; only a correction or a Fix
// changes it (through the browser's editing, so Ctrl+Z undoes it). Home ▸ Spelling goes to the
// next problem on the page. Where the browser can't draw highlights (older Linux and Mac web
// views) its own spelling check is left on.

import { loadSpeller, type Speller } from '../text/spelling';
import { typingPrefs, setTypingPrefs } from '../text/typing';
import { findIssues, typingFormats, ISSUE_MESSAGES, type CharLook, type FixEdit, type Issue } from '../text/chemtext';
import { popupMenu } from './popup-menu';

/** The open project's dictionary (dictionary.txt), for the checks; null with none open. */
export interface SiDictionary {
  words: readonly string[];
  /** Add a word (false when the project is read-only or the word could not be saved). */
  add(word: string): Promise<boolean>;
  readOnly: boolean;
}

/** Words ignored in SI text while Chemweave is open (lower case). */
const ignored = new Set<string>();
let speller: Speller | null = null;
let asked = false;
let project: SiDictionary | null = null;
let projectWords = new Set<string>();
let personalSeen = '';
const misspelled = new Map<HTMLElement, Range[]>();
const formatting = new Map<HTMLElement, { r: Range; issue: Issue; block: Node }[]>();
const SPELL = 'si-misspelled', FORMAT = 'si-format';

const supported = (): boolean => typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined';

/** The project open in the SI tab: its words are spelled right and printed as written. */
export function setSiDictionary(d: SiDictionary | null): void {
  project = d;
  projectWords = new Set((d?.words ?? []).map((w) => w.toLowerCase()));
  personalSeen = '';
  recheckAll();
}

/** Words the formatting check leaves alone: the project's dictionary and those ignored. */
const leave = (): ReadonlySet<string> => new Set([...projectWords, ...ignored]);

type At = [Text | null, number];

/** The text of a box's paragraph (its text nodes, outside links), with where each character is. */
function textOf(block: Node): { text: string; at: At[] } {
  let text = '';
  const at: At[] = [];
  const walk = (n: Node): void => {
    if (n.nodeType === Node.TEXT_NODE) {
      const t = n as Text;
      for (let i = 0; i < t.data.length; i++) at.push([t, i]);
      text += t.data;
      return;
    }
    if (n instanceof HTMLElement && (n.dataset.ref || n.tagName === 'BR')) { text += ' '; at.push([null, 0]); return; }
    for (const c of n.childNodes) walk(c);
  };
  walk(block);
  return { text, at };
}

/** How a character looks now (subscript, superscript, italic), for the formatting check. */
function lookOf(at: At[], block: Node): (i: number) => CharLook {
  return (i) => {
    const look: CharLook = { pos: 'base', italic: false };
    let n: Node | null = at[i]?.[0] ?? null;
    let pos: CharLook['pos'] | null = null;
    while (n && n !== block) {
      if (n instanceof HTMLElement) {
        if (!pos && n.tagName === 'SUB') pos = 'sub';
        else if (!pos && n.tagName === 'SUP') pos = 'sup';
        else if (n.tagName === 'I' || n.tagName === 'EM' || n.style.fontStyle === 'italic') look.italic = true;
      }
      n = n.parentNode;
    }
    look.pos = pos ?? 'base';
    return look;
  };
}

const blocksOf = (box: HTMLElement): Node[] => ([...box.childNodes].some((n) => n instanceof HTMLElement && n.tagName === 'DIV') ? [...box.childNodes] : [box]);

function rangeOf(at: At[], start: number, end: number): Range | null {
  const a = at[start], b = at[end - 1];
  if (!a?.[0] || !b?.[0]) return null;
  const r = document.createRange();
  r.setStart(a[0], a[1]);
  r.setEnd(b[0], b[1] + 1);
  return r;
}

function paint(): void {
  if (!supported()) return;
  for (const [name, map] of [[SPELL, misspelled], [FORMAT, formatting]] as const) {
    const all: Range[] = [];
    for (const [box, list] of map as Map<HTMLElement, (Range | { r: Range })[]>) {
      if (!box.isConnected) { map.delete(box); continue; }
      for (const x of list) all.push(x instanceof Range ? x : x.r);
    }
    CSS.highlights.set(name, new Highlight(...all));
  }
}

/** Check a box's text again (spelling once the speller has loaded, the first time). */
export function checkSpelling(box: HTMLElement): void {
  if (!supported()) { box.spellcheck = typingPrefs.spelling; return; }
  box.spellcheck = false;
  // (the word being typed is not underlined until the caret leaves it)
  const sel = getSelection();
  const caret = sel && sel.rangeCount && sel.isCollapsed && box.contains(sel.anchorNode) ? sel.getRangeAt(0) : null;
  const atCaret = (r: Range): boolean => !!caret && caret.startContainer === r.endContainer && caret.startOffset === r.endOffset;
  const words = leave();
  const issues: { r: Range; issue: Issue; block: Node }[] = [];
  for (const block of blocksOf(box)) {
    const { text, at } = textOf(block);
    for (const issue of findIssues(text, lookOf(at, block), words)) {
      const r = rangeOf(at, issue.start, issue.end);
      if (r && !atCaret(r)) issues.push({ r, issue, block });
    }
  }
  formatting.set(box, issues);
  if (!typingPrefs.spelling) { misspelled.delete(box); paint(); return; }
  if (!speller) {
    paint();
    if (!asked) {
      asked = true;
      void loadSpeller().then((got) => {
        speller = got;
        if (!got) { for (const b of document.querySelectorAll<HTMLElement>('.si-rich')) b.spellcheck = true; return; }
        recheckAll();
      });
    }
    return;
  }
  const personal = [...typingPrefs.dictionary, ...projectWords];
  const key = personal.join('\n');
  if (personalSeen !== key) {
    speller.setPersonal(personal);
    for (const w of ignored) speller.ignore(w);
    personalSeen = key;
  }
  const ranges: Range[] = [];
  for (const block of blocksOf(box)) {
    const { text, at } = textOf(block);
    for (const [s, e] of speller.misspelled(text)) {
      const r = rangeOf(at, s, e);
      if (r && !atCaret(r)) ranges.push(r);
    }
  }
  misspelled.set(box, ranges);
  paint();
}

const hit = (r: Range, x: number, y: number): boolean => [...r.getClientRects()].some((rect) => x >= rect.left - 1 && x <= rect.right + 1 && y >= rect.top - 1 && y <= rect.bottom + 1);

/**
 * Make the changes of a Fix (or of formatting as typed) in a paragraph, through the browser's
 * editing, so the box saves them and one Ctrl+Z undoes them all.
 */
let applying = false;
function applyEdits(box: HTMLElement, block: Node, edits: readonly FixEdit[]): void {
  if (!edits.length) return;
  applying = true;
  try { if (!editAtOnce(box, block, edits)) editAll(box, block, edits); } finally { applying = false; }
}

interface Look { pos: 'base' | 'sub' | 'sup'; italic: boolean; bold: boolean; underline: boolean }

/** How a character of the paragraph looks now (as the box reads it back). */
function fullLookOf(t: Text, block: Node): Look {
  const look: Look = { pos: 'base', italic: false, bold: false, underline: false };
  let pos: Look['pos'] | null = null;
  for (let n: Node | null = t.parentNode; n && n !== block; n = n.parentNode) {
    if (!(n instanceof HTMLElement)) continue;
    if (!pos && n.tagName === 'SUB') pos = 'sub';
    else if (!pos && n.tagName === 'SUP') pos = 'sup';
    if (n.tagName === 'I' || n.tagName === 'EM' || n.style.fontStyle === 'italic') look.italic = true;
    if (n.tagName === 'B' || n.tagName === 'STRONG' || n.style.fontWeight === 'bold' || Number(n.style.fontWeight) >= 600) look.bold = true;
    if (n.tagName === 'U' || /underline/.test(n.style.textDecoration)) look.underline = true;
  }
  look.pos = pos ?? 'base';
  return look;
}

const escapeHtml = (t: string): string => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * The changes made at once: the stretch of the paragraph they cover written again with them (as
 * the box writes formatting: b, i, u, then sub or sup) and put in with one insertHTML, so they
 * are one undo step. False (nothing done) when the stretch holds a mention or a line break.
 */
function editAtOnce(box: HTMLElement, block: Node, edits: readonly FixEdit[]): boolean {
  const { text, at } = textOf(block);
  const lo = Math.min(...edits.map((e) => e.start)), hi = Math.max(...edits.map((e) => e.end));
  if (lo < 0 || hi > text.length || hi <= lo) return false;
  const chars: { ch: string; look: Look }[] = [];
  for (let i = lo; i < hi; i++) {
    const t = at[i][0];
    if (!t) return false;
    chars.push({ ch: text[i], look: fullLookOf(t, block) });
  }
  // the formatting first (where the characters are now), then the new text, from the end back,
  // each piece looking like the first character it replaces (as the document editor does it)
  for (const e of edits) {
    for (let i = e.start; i < e.end; i++) {
      const l = chars[i - lo].look = { ...chars[i - lo].look };
      if (e.pos) l.pos = e.pos;
      if (e.italic !== undefined) l.italic = e.italic;
      if (e.bold !== undefined) l.bold = e.bold;
    }
  }
  for (const e of [...edits].filter((x) => x.text !== undefined).sort((a, b) => b.start - a.start)) {
    const look = (chars[e.start - lo] ?? chars[e.start - lo - 1] ?? chars[0]).look;
    chars.splice(e.start - lo, e.end - e.start, ...[...e.text!].map((ch) => ({ ch, look })));
  }
  let html = '';
  for (let i = 0; i < chars.length;) {
    const l = chars[i].look;
    let j = i;
    let t = '';
    const same = (m: Look): boolean => m.pos === l.pos && m.italic === l.italic && m.bold === l.bold && m.underline === l.underline;
    while (j < chars.length && same(chars[j].look)) t += chars[j++].ch;
    let h = escapeHtml(t);
    if (l.pos !== 'base') h = `<${l.pos}>${h}</${l.pos}>`;
    if (l.underline) h = `<u>${h}</u>`;
    if (l.italic) h = `<i>${h}</i>`;
    if (l.bold) h = `<b>${h}</b>`;
    html += h;
    i = j;
  }
  const r = rangeOf(at, lo, hi);
  const sel = getSelection();
  if (!r || !sel) return false;
  if (document.activeElement !== box) box.focus();
  sel.removeAllRanges();
  sel.addRange(r);
  return document.execCommand('insertHTML', false, html);
}

/** The changes one by one (each its own undo step): where they can't be made at once. */
function editAll(box: HTMLElement, block: Node, edits: readonly FixEdit[]): void {
  if (document.activeElement !== box) box.focus();
  const sel = getSelection();
  if (!sel) return;
  for (const e of [...edits].sort((a, b) => b.start - a.start)) {
    // (each change leaves the characters before it where they were)
    const r = rangeOf(textOf(block).at, e.start, e.end);
    if (!r) continue;
    sel.removeAllRanges();
    sel.addRange(r);
    if (e.text !== undefined) document.execCommand('insertText', false, e.text);
    if (e.pos === 'sub') document.execCommand('subscript');
    else if (e.pos === 'sup') document.execCommand('superscript');
    if (e.italic) document.execCommand('italic');
  }
}

/** Fix one formatting problem: the caret goes after it. */
function fix(box: HTMLElement, block: Node, issue: Issue): void {
  const grow = issue.edits.reduce((n, e) => n + (e.text !== undefined ? e.text.length - (e.end - e.start) : 0), 0);
  applyEdits(box, block, issue.edits);
  caretAt(block, issue.end + grow);
}

/** The caret after character `index - 1` of a paragraph. */
function caretAt(block: Node, index: number): void {
  const { at } = textOf(block);
  const sel = getSelection();
  if (!sel) return;
  const r = document.createRange();
  const before = at[index - 1];
  if (before?.[0]) r.setStart(before[0], before[1] + 1);
  else if (at[index]?.[0]) r.setStart(at[index][0]!, at[index][1]);
  else return;
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
}

/** Every formatting problem in a box fixed (Fix All in This Text). */
function fixAll(box: HTMLElement): number {
  let n = 0;
  for (const block of blocksOf(box)) {
    const { text, at } = textOf(block);
    const issues = findIssues(text, lookOf(at, block), leave());
    n += issues.length;
    applyEdits(box, block, issues.flatMap((i) => i.edits));
  }
  checkSpelling(box);
  return n;
}

/** Replace a word in the box as if typed (so the box saves it). */
function replace(box: HTMLElement, r: Range, text: string): void {
  box.focus();
  const sel = getSelection()!;
  sel.removeAllRanges();
  sel.addRange(r);
  document.execCommand('insertText', false, text);
}

async function addToProject(word: string): Promise<void> {
  if (!project || project.readOnly) return;
  if (await project.add(word)) {
    projectWords.add(word.toLowerCase());
    personalSeen = '';
  }
  recheckAll();
}

type Item = [string, () => void, boolean?] | null;

/** The right-click menu on an underlined word: corrections or a Fix, and the dictionaries. True when it was shown. */
export function spellingMenu(box: HTMLElement, e: MouseEvent, at?: { x: number; y: number }): boolean {
  const x = e.clientX, y = e.clientY;
  const f = (formatting.get(box) ?? []).find((i) => hit(i.r, x, y));
  const items: Item[] = [];
  if (f) {
    const word = f.r.toString();
    const all = (formatting.get(box) ?? []).length;
    items.push([`${ISSUE_MESSAGES[f.issue.kind]}`, () => {}, false]);
    items.push([`Fix: ${f.issue.fixed}`, () => fix(box, f.block, f.issue)]);
    if (all > 1) items.push([`Fix All ${all} Formatting Problems in This Text`, () => void fixAll(box)]);
    items.push(null);
    if (f.issue.kind === 'formula' || f.issue.kind === 'solvent') items.push([`Leave “${word}” as Written in This Project`, () => void addToProject(word), !!project && !project.readOnly]);
    items.push([`Ignore “${word}” Until Chemweave Closes`, () => { ignored.add(word.toLowerCase()); recheckAll(); }]);
  } else {
    if (!speller) return false;
    const r = (misspelled.get(box) ?? []).find((m) => hit(m, x, y));
    if (!r) return false;
    const word = r.toString();
    const sugg = speller.suggestions(word);
    for (const w of sugg) items.push([w, () => replace(box, r, w)]);
    if (!sugg.length) items.push(['No Suggestions', () => {}, false]);
    items.push(null);
    items.push([`Add “${word}” to This Project’s Dictionary`, () => void addToProject(word), !!project && !project.readOnly]);
    items.push([`Add “${word}” to My Dictionary (All Projects)`, () => { setTypingPrefs({ dictionary: [...typingPrefs.dictionary, word] }); personalSeen = ''; recheckAll(); }]);
    items.push([`Ignore “${word}” Until Chemweave Closes`, () => { ignored.add(word.toLowerCase()); speller?.ignore(word); recheckAll(); }]);
  }
  e.preventDefault();
  popupMenu(at?.x ?? x, at?.y ?? y, items);
  return true;
}

function recheckAll(): void { for (const b of document.querySelectorAll<HTMLElement>('.si-rich')) checkSpelling(b); }

/**
 * A word was just finished in a box (the key typed is before the caret): its chemistry is
 * formatted (H2SO4 → H₂SO₄, 1H NMR → ¹H NMR, DMSO-d6 → DMSO-d₆), when formatting as you type is on.
 */
export function formatTyped(box: HTMLElement): void {
  if (!typingPrefs.chemistry || applying) return;
  const sel = getSelection();
  if (!sel || !sel.rangeCount || !sel.isCollapsed || !box.contains(sel.anchorNode)) return;
  const caret = sel.getRangeAt(0);
  const block = blocksOf(box).find((b) => b === box || b.contains(caret.startContainer));
  if (!block) return;
  const { text, at } = textOf(block);
  // (the caret's place in the paragraph's text)
  let index = -1;
  for (let i = 0; i < at.length; i++) if (at[i][0] === caret.startContainer && at[i][1] + 1 === caret.startOffset) { index = i + 1; break; }
  if (index < 1) return;
  const edits = typingFormats(text, index - 1, lookOf(at, block), leave());
  if (!edits.length) return;
  applyEdits(box, block, edits);
  caretAt(block, index);
}

/**
 * Go to the next problem on the page after the caret (Home ▸ Spelling): a misspelled word or
 * a formatting problem, selected, with its menu open. False when there is none.
 */
export function nextMisspelled(page: HTMLElement): boolean {
  recheckAll();
  const boxes = [...page.querySelectorAll<HTMLElement>('.si-rich')];
  const all = boxes.flatMap((b) => [...(misspelled.get(b) ?? []), ...(formatting.get(b) ?? []).map((f) => f.r)].map((r) => ({ b, r })))
    .sort((p, q) => (p.b === q.b ? p.r.compareBoundaryPoints(Range.START_TO_START, q.r) : boxes.indexOf(p.b) - boxes.indexOf(q.b)));
  if (!all.length) return false;
  const sel = getSelection();
  const here = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
  const after = here ? all.find(({ r }) => r.compareBoundaryPoints(Range.START_TO_END, here) >= 0 && !(r.startContainer === here.startContainer && r.startOffset === here.startOffset)) : undefined;
  const { b, r } = after ?? all[0];
  b.focus();
  sel?.removeAllRanges();
  sel?.addRange(r.cloneRange());
  (r.startContainer.parentElement ?? b).scrollIntoView({ block: 'center' });
  const rect = r.getBoundingClientRect();
  const fake = new MouseEvent('contextmenu', { clientX: rect.left + 1, clientY: rect.top + rect.height / 2, cancelable: true });
  // (the menu opens under the word, so the word stays in sight)
  spellingMenu(b, fake, { x: rect.left, y: rect.bottom + 2 });
  return true;
}
