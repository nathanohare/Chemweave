// The spelling check in an SI project's text boxes, with chemistry: Chemweave's own speller (the
// word lists SI Assistant uses, and chemistry words, abbreviations and systematic names, see
// text/spelling.ts) rather than the browser's, which underlines MeOH, equiv and CDCl3. Misspelled
// words get a wavy red line (a CSS highlight, so the text itself is not changed); right-clicking
// one offers corrections, Add to Dictionary (the same list as Document mode's, Edit ▸ Typing and
// Spelling) and Ignore. Home ▸ Spelling goes to the next misspelled word on the page. Where the
// browser can't draw highlights (older Linux and Mac web views) its own check is left on.

import { loadSpeller, type Speller } from '../text/spelling';
import { typingPrefs, setTypingPrefs } from '../text/typing';
import { popupMenu } from './popup-menu';

/** Words ignored in SI text while Chemweave is open (lower case). */
const ignored = new Set<string>();
let speller: Speller | null = null;
let asked = false;
let dictSeen: string[] | null = null;
const found = new Map<HTMLElement, Range[]>();
const NAME = 'si-misspelled';

const supported = (): boolean => typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined';

/** The text of a box's paragraph (its text nodes, outside links), with where each character is. */
function textOf(block: Node): { text: string; at: [Text, number][] } {
  let text = '';
  const at: [Text, number][] = [];
  const walk = (n: Node): void => {
    if (n.nodeType === Node.TEXT_NODE) {
      const t = n as Text;
      for (let i = 0; i < t.data.length; i++) at.push([t, i]);
      text += t.data;
      return;
    }
    if (n instanceof HTMLElement && n.dataset.ref) { text += ' '; at.push([null as unknown as Text, 0]); return; }
    if (n instanceof HTMLElement && (n.tagName === 'BR')) { text += ' '; at.push([null as unknown as Text, 0]); return; }
    for (const c of n.childNodes) walk(c);
  };
  walk(block);
  return { text, at };
}

function paint(): void {
  if (!supported()) return;
  const all: Range[] = [];
  for (const [box, ranges] of found) { if (box.isConnected) all.push(...ranges); else found.delete(box); }
  CSS.highlights.set(NAME, new Highlight(...all));
}

/** Check a box's text again (when the speller has loaded, the first time). */
export function checkSpelling(box: HTMLElement): void {
  if (!supported()) { box.spellcheck = typingPrefs.spelling; return; }
  box.spellcheck = false;
  if (!typingPrefs.spelling) { if (found.delete(box)) paint(); return; }
  if (!speller) {
    if (!asked) {
      asked = true;
      void loadSpeller().then((got) => {
        speller = got;
        if (!got) { for (const b of document.querySelectorAll<HTMLElement>('.si-rich')) b.spellcheck = true; return; }
        for (const b of document.querySelectorAll<HTMLElement>('.si-rich')) checkSpelling(b);
      });
    }
    return;
  }
  if (dictSeen !== typingPrefs.dictionary) {
    speller.setPersonal(typingPrefs.dictionary);
    for (const w of ignored) speller.ignore(w);
    dictSeen = typingPrefs.dictionary;
  }
  // (the word being typed is not underlined until the caret leaves it)
  const sel = getSelection();
  const caret = sel && sel.rangeCount && sel.isCollapsed && box.contains(sel.anchorNode) ? sel.getRangeAt(0) : null;
  const ranges: Range[] = [];
  const blocks = [...box.childNodes].some((n) => n instanceof HTMLElement && n.tagName === 'DIV') ? [...box.childNodes] : [box];
  for (const block of blocks) {
    const { text, at } = textOf(block);
    for (const [s, e] of speller.misspelled(text)) {
      const a = at[s], b = at[e - 1];
      if (!a?.[0] || !b?.[0]) continue;
      const r = document.createRange();
      r.setStart(a[0], a[1]);
      r.setEnd(b[0], b[1] + 1);
      if (caret && caret.startContainer === b[0] && caret.startOffset === b[1] + 1) continue;
      ranges.push(r);
    }
  }
  found.set(box, ranges);
  paint();
}

/** The misspelled word at a point of a box, or null. */
function wordAt(box: HTMLElement, x: number, y: number): Range | null {
  const ranges = found.get(box) ?? [];
  for (const r of ranges) for (const rect of r.getClientRects()) if (x >= rect.left - 1 && x <= rect.right + 1 && y >= rect.top - 1 && y <= rect.bottom + 1) return r;
  return null;
}

/** Replace a word in the box as if typed (so the box saves it). */
function replace(box: HTMLElement, r: Range, text: string): void {
  box.focus();
  const sel = getSelection()!;
  sel.removeAllRanges();
  sel.addRange(r);
  document.execCommand('insertText', false, text);
}

/** The right-click menu on a misspelled word: corrections, Add to Dictionary, Ignore. True when it was shown. */
export function spellingMenu(box: HTMLElement, e: MouseEvent, at?: { x: number; y: number }): boolean {
  if (!speller) return false;
  const r = wordAt(box, e.clientX, e.clientY);
  if (!r) return false;
  e.preventDefault();
  const word = r.toString();
  const sugg = speller.suggestions(word);
  const items: ([string, () => void, boolean?] | null)[] = sugg.map((w): [string, () => void] => [w, () => replace(box, r, w)]);
  if (!sugg.length) items.push(['No Suggestions', () => {}, false]);
  items.push(null);
  items.push(['Add to Dictionary', () => { setTypingPrefs({ dictionary: [...typingPrefs.dictionary, word] }); recheckAll(); }]);
  items.push(['Ignore', () => { ignored.add(word.toLowerCase()); speller?.ignore(word); recheckAll(); }]);
  popupMenu(at?.x ?? e.clientX, at?.y ?? e.clientY, items);
  return true;
}

function recheckAll(): void { for (const b of document.querySelectorAll<HTMLElement>('.si-rich')) checkSpelling(b); }

/**
 * Go to the next misspelled word on the page after the caret (Home ▸ Spelling): it is selected,
 * with its menu open. False when there is none (or the word lists aren't read yet).
 */
export function nextMisspelled(page: HTMLElement): boolean {
  recheckAll();
  const boxes = [...page.querySelectorAll<HTMLElement>('.si-rich')];
  const all = boxes.flatMap((b) => (found.get(b) ?? []).map((r) => ({ b, r })));
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
  const at = { x: rect.left, y: rect.bottom + 2 };
  spellingMenu(b, fake, at);
  return true;
}
