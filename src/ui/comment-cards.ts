// A comment's card, as in Word's and PowerPoint's comment panes: who wrote it and when, its text,
// the replies under it, a box to reply, and Resolve and Delete. Documents show the cards beside
// the page next to their words; slides list them in a pane beside the slide. Each change goes
// back through `actions`, so it is one step of the file's Undo.

import { cleanNoteRuns, initials, noteRuns, shortDate, type CommentNote, type CommentThread, type NoteRun } from '../document/comments';
import { RichInput } from './rich-input';
import type { RunLook } from '../sheet/rich-text';

export interface ThreadActions {
  /** Change the comment's own text, or a reply's (by its place in the replies), with its words' looks (null: none). */
  edit(text: string, reply?: number, runs?: NoteRun[] | null): void;
  reply(text: string, runs?: NoteRun[] | null): void;
  /** Take away a reply. */
  removeReply(i: number): void;
  resolve(done: boolean): void;
  remove(): void;
  /** The card was clicked: show what it is on. */
  focus(): void;
  /** A new comment was left empty: take it away again. */
  cancelNew?(): void;
}

/** A colour for a name, so each person's comments look alike. */
export function authorColour(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h}, 55%, 42%)`;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

/** A text box for a note: what it holds, and how to put it in the card. */
interface NoteBox { el: HTMLElement; focus(): void }

/** Pieces of text with looks as each character's look in the rich text box, and back. */
export const looksOf = (text: string, runs: NoteRun[] | null): RunLook[] => {
  const out: RunLook[] = [];
  for (const r of runs ?? [{ text }]) {
    const l: RunLook = { ...(r.bold ? { bold: true } : {}), ...(r.italic ? { italic: true } : {}), ...(r.underline ? { underline: true } : {}), ...(r.strike ? { strike: true } : {}), ...(r.sub ? { pos: 'sub' as const } : r.sup ? { pos: 'sup' as const } : {}) };
    for (let i = 0; i < r.text.length; i++) out.push(l);
  }
  return out;
};
export const runsOf = (text: string, looks: RunLook[]): NoteRun[] | null =>
  cleanNoteRuns([...text].map((c, i) => { const l = looks[i] ?? {}; return { text: c, bold: l.bold, italic: l.italic, underline: l.underline, strike: l.strike, sub: l.pos === 'sub', sup: l.pos === 'sup' }; }));

/**
 * A text box for a note: Enter saves (Shift+Enter starts a new line), Escape stops. Escape keeps
 * what was typed into a new note or reply (as Word does) and takes back changes to an old one.
 * With `rich` (a Word or PowerPoint comment), it is the rich text box the cells and Outline View
 * use: Ctrl+B, Ctrl+I, Ctrl+U, Ctrl+= and Ctrl+Shift+= set bold, italic, underline, sub- and
 * superscript, and the looks go with the text.
 */
function noteBox(note: Pick<CommentNote, 'text' | 'runs'>, placeholder: string, save: (text: string, runs: NoteRun[] | null) => void, stop: () => void, rich: boolean, people?: readonly string[]): NoteBox {
  const value = note.text;
  let read: () => { text: string; runs: NoteRun[] | null };
  let box: HTMLElement;
  let focus: () => void;
  if (rich) {
    const ri = new RichInput();
    ri.setText(value, looksOf(value, noteRuns(note)));
    box = ri.el;
    box.className = 'cmt-input cmt-rich';
    box.dataset.placeholder = placeholder;
    box.setAttribute('aria-label', placeholder);
    box.spellcheck = true;
    const marks = () => box.classList.toggle('empty', !ri.value);
    marks();
    box.addEventListener('input', marks);
    read = () => {
      const text = ri.value.replace(/\s+$/, '');
      return { text, runs: runsOf(text, ri.charLooks.slice(0, text.length)) };
    };
    focus = () => { ri.focus(); ri.setSelectionRange(ri.value.length, ri.value.length); };
    box.addEventListener('keydown', (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (!e.shiftKey && /^[biu]$/.test(k)) { e.preventDefault(); ri.toggle(({ b: 'bold', i: 'italic', u: 'underline' } as const)[k as 'b' | 'i' | 'u']); }
      else if (k === '=' || k === '+') { e.preventDefault(); ri.togglePos(e.shiftKey || k === '+' ? 'sup' : 'sub'); }
    });
  } else {
    const ta = el('textarea', 'cmt-input');
    ta.value = value;
    ta.placeholder = placeholder;
    ta.rows = Math.min(8, Math.max(2, value.split('\n').length));
    ta.spellcheck = true;
    ta.addEventListener('input', () => { ta.rows = Math.min(8, Math.max(2, ta.value.split('\n').length)); });
    if (people?.length) mentionPicker(ta, people);
    box = ta;
    read = () => ({ text: ta.value.replace(/\s+$/, ''), runs: null });
    focus = () => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); };
  }
  let done = false;
  const finish = (keep: boolean) => {
    if (done) return;
    done = true;
    if (keep) { const r = read(); save(r.text, r.runs); }
    else stop();
  };
  box.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(!value && !!read().text.trim()); }
  });
  box.addEventListener('blur', (e) => { if ((e.relatedTarget as HTMLElement | null)?.closest?.('.cmt-mentions')) return; finish(true); });
  // (the file keys, Ctrl+S, take what is typed first)
  box.addEventListener('change', () => finish(true));
  // keys typed here are the comment's, not the page's
  for (const ev of ['keyup', 'keypress', 'paste', 'copy', 'cut'] as const) box.addEventListener(ev, (e) => e.stopPropagation());
  return { el: box, focus };
}

/**
 * @mentions: typing "@" and the start of a name lists the people who match (the project's
 * authors and everyone who wrote a note); Up, Down, Enter or Tab or a click puts the name in.
 */
export function mentionPicker(ta: HTMLTextAreaElement, people: readonly string[]): void {
  const list = el('div', 'cmt-mentions');
  list.setAttribute('role', 'listbox');
  list.hidden = true;
  let items: string[] = [];
  let at = 0;
  let from = -1;
  const query = (): { from: number; q: string } | null => {
    const before = ta.value.slice(0, ta.selectionStart);
    const m = /(?:^|[^\w.])@([^@\n]{0,40})$/u.exec(before);
    return m ? { from: before.length - m[1].length - 1, q: m[1] } : null;
  };
  const close = (): void => { list.hidden = true; items = []; from = -1; };
  const show = (): void => {
    const got = query();
    items = got ? people.filter((n) => n.toLowerCase().startsWith(got.q.toLowerCase()) && n.toLowerCase() !== got.q.toLowerCase()).slice(0, 6) : [];
    if (!got || !items.length) { close(); return; }
    from = got.from;
    at = Math.min(at, items.length - 1);
    list.replaceChildren(...items.map((n, i) => {
      const b = el('button', 'cmt-mention-item' + (i === at ? ' on' : ''), n);
      b.type = 'button';
      b.setAttribute('role', 'option');
      b.setAttribute('aria-selected', String(i === at));
      b.addEventListener('mousedown', (e) => { e.preventDefault(); pick(n); });
      return b;
    }));
    if (!list.isConnected) ta.after(list);
    list.hidden = false;
  };
  const pick = (name: string): void => {
    const end = ta.selectionStart;
    ta.value = ta.value.slice(0, from) + '@' + name + ' ' + ta.value.slice(end);
    const caret = from + name.length + 2;
    ta.setSelectionRange(caret, caret);
    close();
    ta.focus();
  };
  ta.addEventListener('input', () => { at = 0; show(); });
  ta.addEventListener('keydown', (e) => {
    if (list.hidden || !items.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopImmediatePropagation(); at = (at + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length; show(); }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); e.stopImmediatePropagation(); pick(items[at]); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); }
  });
  ta.addEventListener('blur', () => setTimeout(close, 0));
}

/** The text with its @mentions of `people` marked. */
function withMentions(p: HTMLElement, text: string, people: readonly string[]): void {
  const names = [...people].sort((a, b) => b.length - a.length);
  let last = 0;
  for (let i = text.indexOf('@'); i >= 0; i = text.indexOf('@', i + 1)) {
    if (i < last || (i > 0 && /[\w.]/.test(text[i - 1]))) continue;
    const rest = text.slice(i + 1).toLowerCase();
    const who = names.find((n) => rest.startsWith(n.toLowerCase()) && !/[\p{L}\p{N}]/u.test(rest[n.length] ?? ''));
    if (!who) continue;
    p.append(text.slice(last, i), el('span', 'cmt-mention', text.slice(i, i + 1 + who.length)));
    last = i + 1 + who.length;
  }
  p.append(text.slice(last));
}

function header(author: string, date: string): HTMLElement {
  const h = el('div', 'cmt-head');
  const badge = el('span', 'cmt-badge', initials(author) || '?');
  badge.style.background = authorColour(author);
  const who = el('span', 'cmt-who', author || 'Author');
  const when = el('span', 'cmt-when', shortDate(date));
  when.title = new Date(date).toLocaleString();
  h.append(badge, who, when);
  return h;
}

/** A note's text, with its words' looks. */
export function body(n: Pick<CommentNote, 'text' | 'runs'>, people?: readonly string[]): HTMLElement {
  const p = el('div', 'cmt-text');
  const runs = noteRuns(n);
  if (!runs) { if (people?.length) withMentions(p, n.text, people); else p.textContent = n.text; return p; }
  for (const r of runs) {
    const s = el(r.sub ? 'sub' : r.sup ? 'sup' : 'span', undefined, r.text);
    if (r.bold) s.style.fontWeight = 'bold';
    if (r.italic) s.style.fontStyle = 'italic';
    const line = [r.underline ? 'underline' : '', r.strike ? 'line-through' : ''].filter(Boolean).join(' ');
    if (line) s.style.textDecoration = line;
    p.append(s);
  }
  return p;
}

/**
 * The card for a comment. `editing` opens its text for typing (a new comment, or after Edit);
 * `active` marks the one whose words are shown.
 */
export function threadCard(c: CommentThread, opts: { active: boolean; editing: boolean; actions: ThreadActions; label?: string; /** Its notes keep their words' looks (Word's and PowerPoint's comments). */ rich?: boolean; /** Who can be @mentioned (offered while typing, and marked in the notes). */ people?: readonly string[]; /** A class of its own (an SI flag's). */ cls?: string }): HTMLElement {
  const a = opts.actions;
  const rich = !!opts.rich;
  const people = opts.people;
  const card = el('div', 'cmt-card' + (opts.active ? ' active' : '') + (c.done ? ' done' : '') + (opts.cls ? ` ${opts.cls}` : ''));
  card.tabIndex = -1;
  card.addEventListener('mousedown', (e) => { if (!(e.target as HTMLElement).closest('textarea, button, .cmt-input')) a.focus(); });

  const first = el('div', 'cmt-note');
  first.append(header(c.author, c.date));
  if (opts.label) first.prepend(el('div', 'cmt-label', opts.label));
  if (opts.editing) {
    const ta = noteBox(c, 'Type your comment', (t, runs) => (t.trim() ? a.edit(t, undefined, runs) : a.cancelNew ? a.cancelNew() : a.remove()), () => (!c.text.trim() ? (a.cancelNew ?? a.remove)() : a.edit(c.text, undefined, noteRuns(c))), rich, people);
    first.append(ta.el);
    queueMicrotask(() => ta.focus());
  } else {
    first.append(body(c, people));
  }
  card.append(first);
  if (c.done) card.append(el('div', 'cmt-resolved', 'Resolved'));

  (c.replies ?? []).forEach((r, i) => {
    const n = el('div', 'cmt-note cmt-reply');
    n.append(header(r.author, r.date), body(r, people));
    const tools = el('div', 'cmt-tools');
    const edit = el('button', 'cmt-link', 'Edit');
    edit.type = 'button';
    edit.addEventListener('click', () => {
      const text = n.querySelector('.cmt-text')!;
      const ta = noteBox(r, 'Reply', (t, runs) => (t.trim() ? a.edit(t, i, runs) : a.removeReply(i)), () => a.edit(r.text, i, noteRuns(r)), rich, people);
      text.replaceWith(ta.el);
      tools.remove();
      ta.focus();
    });
    const del = el('button', 'cmt-link', 'Delete');
    del.type = 'button';
    del.addEventListener('click', () => a.removeReply(i));
    tools.append(edit, del);
    n.append(tools);
    card.append(n);
  });

  if (!opts.editing) {
    const bar = el('div', 'cmt-bar');
    const reply = el('button', 'cmt-btn', 'Reply');
    reply.type = 'button';
    reply.title = 'Answer this comment';
    reply.addEventListener('click', () => {
      bar.hidden = true;
      const ta = noteBox({ text: '' }, 'Reply', (t, runs) => { if (t.trim()) a.reply(t, runs); else bar.hidden = false; }, () => { ta.el.remove(); bar.hidden = false; }, rich, people);
      card.insertBefore(ta.el, bar);
      ta.focus();
    });
    const resolve = el('button', 'cmt-btn', c.done ? 'Reopen' : 'Resolve');
    resolve.type = 'button';
    resolve.title = c.done ? 'Mark the comment as still open' : 'Mark the comment as dealt with (it stays, grayed, until deleted)';
    resolve.addEventListener('click', () => a.resolve(!c.done));
    const edit = el('button', 'cmt-btn', 'Edit');
    edit.type = 'button';
    edit.title = 'Change the comment’s text';
    edit.addEventListener('click', () => {
      const text = first.querySelector('.cmt-text')!;
      const ta = noteBox(c, 'Type your comment', (t, runs) => (t.trim() ? a.edit(t, undefined, runs) : a.edit(c.text, undefined, noteRuns(c))), () => a.edit(c.text, undefined, noteRuns(c)), rich, people);
      text.replaceWith(ta.el);
      bar.hidden = true;
      ta.focus();
    });
    const del = el('button', 'cmt-btn', 'Delete');
    del.type = 'button';
    del.title = 'Delete the comment and its replies';
    del.addEventListener('click', () => a.remove());
    bar.append(reply, resolve, edit, del);
    card.append(bar);
  }
  return card;
}

/**
 * Cards in a column, each as near as it can be to the height of what it is on (`want`, pixels
 * from the column's top), without overlapping: the active card sits at its own height and the
 * others move out of its way, as Word's do. Gives each card's top.
 */
export function stackCards(want: number[], heights: number[], active: number, gap = 8): number[] {
  const n = want.length;
  const top = new Array<number>(n).fill(0);
  if (!n) return top;
  const a = active >= 0 && active < n ? active : 0;
  top[a] = want[a];
  for (let i = a + 1; i < n; i++) top[i] = Math.max(want[i], top[i - 1] + heights[i - 1] + gap);
  for (let i = a - 1; i >= 0; i--) top[i] = Math.min(want[i], top[i + 1] - heights[i] - gap);
  return top;
}
