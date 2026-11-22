// View > Outline View: in place of the slide pictures beside the slide, every slide's title and
// body text as one outline to type in. Enter in a title goes on to its body; Tab and Shift+Tab
// move a body line in and out a level, and Shift+Tab on a line already all the way out makes it
// the title of a new slide (the lines after it go with it). Ctrl+Enter adds a slide after.
// Click a slide's number to edit that slide. Bold, italic, underline and sub- and superscripts
// show as on the slide, and Ctrl+B, Ctrl+I and Ctrl+U set them, as in PowerPoint's outline.

import type { Deck } from '../deck/deck';
import { applyOutline, outlineLooks, outlineText, parseOutline, slideOutline, type OutlineLook } from '../deck/outline';
import { RichInput } from './rich-input';
import type { RunLook, ToggleLook } from '../sheet/rich-text';

/** A character's look in the outline's box, and back. */
const boxLook = (l: OutlineLook | undefined): RunLook => ({
  ...(l?.bold ? { bold: true } : {}), ...(l?.italic ? { italic: true } : {}), ...(l?.underline ? { underline: true } : {}),
  ...(l?.strike ? { strike: true } : {}), ...(l?.sub ? { pos: 'sub' as const } : l?.sup ? { pos: 'sup' as const } : {}),
});
const lookOf = (l: RunLook | undefined): OutlineLook => ({
  ...(l?.bold ? { bold: true } : {}), ...(l?.italic ? { italic: true } : {}), ...(l?.underline ? { underline: true } : {}),
  ...(l?.strike ? { strike: true } : {}), ...(l?.pos === 'sub' ? { sub: true } : l?.pos === 'sup' ? { sup: true } : {}),
});

/** What a box held, for its Undo. */
interface BoxState { text: string; looks: RunLook[]; at: number }

/** A box of the outline: a slide's title or its body lines, with each character's look. */
class OutlineBox extends RichInput {
  disabled = false;
  constructor(cls: string, label: string, placeholder: string, off: boolean, title: boolean) {
    super();
    this.className = cls;
    this.setAttribute('aria-label', label);
    this.el.dataset.placeholder = placeholder;
    this.disabled = off;
    if (off) { this.el.contentEditable = 'false'; this.el.setAttribute('aria-disabled', 'true'); }
    if (title) this.el.setAttribute('aria-multiline', 'false');
    this.el.addEventListener('input', () => { this.marks(); this.record(); });
    // Ctrl+Z and Ctrl+Y take back and bring again what was typed or set in the box, as a
    // textarea's own Undo did (the browser's own would undo its markup, not the text)
    this.el.addEventListener('keydown', (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      const redo = k === 'y' || (k === 'z' && e.shiftKey);
      if ((k === 'z' || redo) && this.step(redo)) { e.preventDefault(); e.stopPropagation(); }
    });
    this.el.addEventListener('beforeinput', (e) => {
      if ((e.inputType === 'historyUndo' || e.inputType === 'historyRedo') && this.step(e.inputType === 'historyRedo')) e.preventDefault();
    });
  }

  /** Show text with its looks. */
  show(text: string, looks: (OutlineLook | undefined)[]): void {
    this.setText(text, Array.from({ length: text.length }, (_, i) => boxLook(looks[i])));
    this.marks();
    this.past = [];
    this.future = [];
    this.last = this.snap();
  }

  // ---------------------------------------------------------------- the box's own Undo
  private past: BoxState[] = [];
  private future: BoxState[] = [];
  private last: BoxState = { text: '', looks: [], at: 0 };
  private lastAt = 0;
  private snap(): BoxState { return { text: this.value, looks: this.charLooks.map((l) => ({ ...l })), at: this.selectionEnd }; }

  /** After a change: what was before it is a step to take back (typing in quick succession is one step). */
  private record(alone = false): void {
    const now = this.snap();
    if (now.text === this.last.text && JSON.stringify(now.looks) === JSON.stringify(this.last.looks)) return;
    const t = Date.now();
    if (alone || !this.past.length || t - this.lastAt > 800) this.past.push(this.last);
    if (this.past.length > 200) this.past.shift();
    // (a look set is a step of its own: what is typed after it is another)
    this.lastAt = alone ? 0 : t;
    this.future = [];
    this.last = now;
  }

  /** Undo (or Redo) in the box: false when there is nothing to take back (or bring again). */
  private step(redo: boolean): boolean {
    const from = redo ? this.future : this.past, to = redo ? this.past : this.future;
    const s = from.pop();
    if (!s) return false;
    to.push(this.snap());
    this.setText(s.text, s.looks);
    this.setSelectionRange(s.at, s.at);
    this.last = this.snap();
    this.lastAt = 0;
    this.marks();
    // (the outline takes the text as after any change)
    this.el.dispatchEvent(new Event('input'));
    return true;
  }

  /** Each character's look. */
  lookList(): OutlineLook[] { return this.charLooks.map(lookOf); }

  /** Bold, Italic, Underline from the keys, as one step of the box's Undo. */
  toggleLook(key: ToggleLook): void { this.toggle(key); this.marks(); this.record(true); }

  private marks(): void { this.el.classList.toggle('empty', !this.value); }
}

export interface OutlineHooks {
  deck(): Deck | null;
  go(i: number): void;
  /** Done typing in the outline: back to the slide. */
  focusSlide(): void;
}

export class OutlineView {
  readonly el: HTMLDivElement;
  shown = false;
  private typing = 0;

  constructor(parent: HTMLElement, private hooks: OutlineHooks) {
    this.el = document.createElement('div');
    this.el.id = 'slide-outline';
    this.el.hidden = true;
    this.el.setAttribute('role', 'region');
    this.el.setAttribute('aria-label', 'Outline');
    parent.append(this.el);
  }

  show(on: boolean): void {
    if (!on) this.flush();
    this.shown = on;
    this.el.hidden = !on;
    if (on) this.rebuild(); else this.el.replaceChildren();
  }

  /** Keep what is being typed. */
  flush(): void {
    const el = document.activeElement;
    if (el instanceof HTMLElement && this.el.contains(el)) el.dispatchEvent(new Event('change'));
  }

  /** The outline again from the slides (not while typing in it). */
  rebuild(): void {
    const d = this.hooks.deck();
    if (!this.shown || !d) return;
    if (this.el.contains(document.activeElement)) { this.mark(d.index); return; }
    const scroll = this.el.scrollTop;
    this.el.replaceChildren();
    d.slides.forEach((s, i) => {
      const o = slideOutline(d.docOf(i));
      const row = document.createElement('div');
      row.className = 'ol-slide';
      row.dataset.i = String(i);
      const num = document.createElement('button');
      num.type = 'button';
      num.className = 'ol-num';
      num.textContent = `${i + 1}`;
      num.title = `Edit slide ${i + 1}${s.hidden ? ' (hidden in the show)' : ''}`;
      num.addEventListener('click', () => this.hooks.go(i));
      const col = document.createElement('div');
      col.className = 'ol-col';
      const looks = outlineLooks(d.docOf(i));
      const title = new OutlineBox('ol-title', `Slide ${i + 1} title`, o.title === null ? '(this layout has no title)' : 'Title', o.title === null, true);
      title.show(o.title ?? '', looks.title ?? []);
      const body = new OutlineBox('ol-body', `Slide ${i + 1} text`, o.body === null ? '(no text placeholder)' : 'Text', o.body === null, false);
      // (each line's tabs, for its level, have no look of their own)
      body.show(outlineText(o.body ?? []), (o.body ?? []).flatMap((l, k) => [...Array<undefined>(l.level).fill(undefined), ...(looks.body?.[k] ?? []), undefined]));
      body.spellcheck = true;
      const commit = () => { clearTimeout(this.typing); this.commit(i, title, body); };
      // what is typed goes onto the slide after a moment's pause (and when the box is left)
      const soon = () => { clearTimeout(this.typing); this.typing = window.setTimeout(commit, 400); };
      for (const el of [title, body]) {
        el.addEventListener('input', soon);
        el.addEventListener('change', commit);
        el.addEventListener('blur', commit);
        // Ctrl+B, Ctrl+I, Ctrl+U on the selected words (or on what is typed next)
        el.addEventListener('keydown', (e) => {
          const k = e.key.toLowerCase();
          if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || !/^[biu]$/.test(k) || el.disabled) return;
          e.preventDefault();
          e.stopPropagation();
          el.toggleLook(({ b: 'bold', i: 'italic', u: 'underline' } as const)[k as 'b' | 'i' | 'u']);
          commit();
        });
      }
      title.addEventListener('focus', () => this.hooks.deck()?.index !== i && this.hooks.go(i));
      body.addEventListener('focus', () => this.hooks.deck()?.index !== i && this.hooks.go(i));
      title.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commit(); this.addAfter(i); }
        else if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) { e.preventDefault(); body.focus(); body.setSelectionRange(0, 0); }
        else if (e.key === 'Escape') { commit(); this.hooks.focusSlide(); }
      });
      body.addEventListener('keydown', (e) => this.bodyKey(e, i, title, body));
      col.append(title.el, body.el);
      row.append(num, col);
      this.el.append(row);
    });
    this.mark(d.index);
    this.el.scrollTop = scroll;
  }

  /** Show which slide is being edited. */
  mark(i: number): void {
    for (const r of this.el.querySelectorAll<HTMLElement>('.ol-slide')) r.classList.toggle('ol-current', r.dataset.i === String(i));
  }

  private commit(i: number, title: OutlineBox, body: OutlineBox): void {
    const d = this.hooks.deck();
    if (!d || !d.slides[i]) return;
    const o = slideOutline(d.docOf(i));
    // (a title is one line: a line break pasted in is a space)
    const t = o.title === null ? null : title.value.replace(/\n/g, ' ');
    const b = o.body === null ? null : parseOutline(body.value);
    const looks = { title: title.lookList(), body: bodyLooks(body.value, body.lookList()) };
    const now = outlineLooks(d.docOf(i));
    if (t === o.title && outlineText(b ?? []) === outlineText(o.body ?? []) && JSON.stringify(looks.title) === JSON.stringify(now.title ?? []) && JSON.stringify(looks.body) === JSON.stringify(now.body ?? [])) return;
    d.editSlides('Edit outline', [i], (doc) => { applyOutline(doc, t, b, looks); });
  }

  private addAfter(i: number): void {
    const d = this.hooks.deck();
    if (!d) return;
    d.insertSlide(i + 1, 'title-content', () => {}, 'New slide');
    this.rebuild();
    this.el.querySelectorAll<HTMLElement>('.ol-title')[i + 1]?.focus();
  }

  private bodyKey(e: KeyboardEvent, i: number, title: OutlineBox, body: OutlineBox): void {
    if (e.key === 'Escape') { body.el.dispatchEvent(new Event('change')); this.hooks.focusSlide(); return; }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); body.el.dispatchEvent(new Event('change')); this.addAfter(i); return; }
    if (e.key !== 'Tab') return;
    e.preventDefault();
    const v = body.value;
    const start = v.lastIndexOf('\n', body.selectionStart - 1) + 1;
    const endAt = v.indexOf('\n', body.selectionEnd);
    const end = endAt < 0 ? v.length : endAt;
    const lines = v.slice(start, end).split('\n');
    if (e.shiftKey && lines.every((l) => !l.startsWith('\t')) && lines.length === 1) {
      // all the way out already: this line and those after it become a new slide
      const after = v.slice(end + 1);
      const before = v.slice(0, Math.max(0, start - 1));
      // (the words keep their looks on the new slide)
      const all = body.lookList();
      const moved = { title: all.slice(start, end), body: bodyLooks(after, all.slice(end + 1)) };
      body.value = start > 0 ? before : '';
      this.commit(i, title, body);
      const d = this.hooks.deck();
      if (!d) return;
      const rest = parseOutline(after);
      d.insertSlide(i + 1, 'title-content', (doc) => { applyOutline(doc, lines[0], rest, moved); }, 'New slide');
      this.rebuild();
      this.el.querySelectorAll<HTMLElement>('.ol-title')[i + 1]?.focus();
      return;
    }
    const caret = body.selectionStart, collapsed = caret === body.selectionEnd;
    const moved = lines.map((l) => (e.shiftKey ? l.replace(/^\t/, '') : `\t${l}`)).join('\n');
    body.value = v.slice(0, start) + moved + v.slice(end);
    // the caret moves with its line's text; several lines stay picked
    if (collapsed && lines.length === 1) { const p = Math.max(start, caret + moved.length - (end - start)); body.setSelectionRange(p, p); }
    else body.setSelectionRange(start, start + moved.length);
    body.el.dispatchEvent(new Event('input'));
    this.commit(i, title, body);
  }
}

/** Each body line's characters' looks, its level's tabs (or four spaces) at its start left out (as parseOutline reads it). */
function bodyLooks(text: string, looks: OutlineLook[]): OutlineLook[][] {
  if (!text) return [];
  let at = 0;
  return text.split('\n').map((line) => {
    const lead = /^((?:\t| {4})*)/.exec(line)![1].length;
    const l = looks.slice(at + lead, at + line.length);
    at += line.length + 1;
    return l;
  });
}
