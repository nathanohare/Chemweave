// A box for SI text with its formatting (a procedure, an NMR report, a section's text): bold,
// italic, underline, superscript and subscript, and mentions of compounds that show their
// current ID. What is typed is kept in SI Assistant's text format (src/si/markup.ts).
//
// Ctrl+B, Ctrl+I and Ctrl+U as in Word; Ctrl+= subscript, Ctrl+Shift+= superscript; typing
// "@" offers the project's compounds to mention.

import { popupHost } from './popup-host';
import { cleanPastedHtml, hasFormatting } from './si-paste-html';
import { checkSpelling, formatTyped, spellingMenu } from './si-spell';
import { WORD_ENDS } from '../text/chemtext';
import { MENTION, STRUCT, parseMarkup, writeMarkup, type Paragraph, type Run, type VAlign } from '../si/markup';

export interface SiRichHost {
  /** How a link shows: a mention as its compound's ID ("2b"), citations as numbers. */
  label(ref: string): string;
  /** The compounds that can be mentioned (for "@"): id and how it shows ("2b 1-Phenylethanol"). */
  mentionable?(): { id: string; label: string; text: string }[];
  /** A structure in the text (@struct{s-…}, in a scheme's conditions) as an SVG picture; null shows its label. */
  picture?(ref: string): string | null;
  /** Typing stopped (or the box was left) with this text. */
  changed(text: string): void;
  /**
   * A paste with no text on the clipboard (a drawing or a picture) or a CDXML drawing as text:
   * the host makes it an object of the text (a figure). `place` puts the object's paragraph where
   * the caret was (on an empty line, in its place; else after the caret's line) and gives the
   * box's text with it, for the host to save. Without this, such a paste does nothing.
   */
  pasteObject?(e: ClipboardEvent, place: (p: Paragraph) => string): void;
  /** Whether a paste with text is a drawing all the same (the text only its SMILES); it then goes to pasteObject too. */
  holdsObject?(e: ClipboardEvent): boolean;
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

const TAGS: Record<string, keyof Run | 'sup' | 'sub'> = { B: 'bold', STRONG: 'bold', I: 'italic', EM: 'italic', U: 'underline', SUP: 'sup', SUB: 'sub' };

/** Paragraphs as the editor's HTML. */
function render(box: HTMLElement, ps: Paragraph[], host: SiRichHost, multiline: boolean): void {
  const kids: HTMLElement[] = [];
  for (const p of multiline ? ps : ps.slice(0, 1)) {
    const div = document.createElement('div');
    if (p.heading) div.className = `si-h${p.heading}`;
    // figures, tables and alignment (made in SI Assistant) are kept in the paragraph's own attributes
    for (const k of ['figure', 'table', 'image', 'align'] as const) if (p[k]) div.dataset[k] = p[k];
    if (p.figure || p.table || p.image) div.classList.add('si-object');
    if (p.figure || p.table) div.title = `${isMac ? '⌘' : 'Ctrl'}+click to go to the ${p.figure ? 'figure' : 'table'}`;
    for (const r of p.runs) {
      let n: Node;
      if (r.ref) {
        const s = document.createElement('span');
        s.className = r.ref.startsWith(MENTION) ? 'si-mention' : r.ref.startsWith(STRUCT) ? 'si-inline-struct' : 'si-cite';
        s.contentEditable = 'false';
        s.dataset.ref = r.ref;
        const pic = r.ref.startsWith(STRUCT) ? host.picture?.(r.ref) : null;
        if (pic) s.innerHTML = pic; else s.textContent = host.label(r.ref);
        n = s;
      } else n = document.createTextNode(r.text);
      const wrap = (tag: string): void => { const e = document.createElement(tag); e.append(n); n = e; };
      if (r.valign === 'super') wrap('sup');
      if (r.valign === 'sub') wrap('sub');
      if (r.underline) wrap('u');
      if (r.italic) wrap('i');
      if (r.bold) wrap('b');
      div.append(n);
    }
    if (!div.childNodes.length) div.append(document.createElement('br'));
    kids.push(div);
  }
  box.replaceChildren(...kids);
}

/**
 * A text node's text as stored. The browser writes a non-breaking space for a space at the
 * start or end of a line and next to another space, so those are spaces again; one between two
 * words ("400\u00a0MHz", typed or pasted) is the writer's own and is kept.
 */
function spaces(t: string, first: boolean, last: boolean): string {
  let s = t.replace(/\n/g, ' ');
  if (!s.includes('\u00a0')) return s;
  s = s.replace(/\u00a0(?=[ \u00a0])|(?<=[ \u00a0])\u00a0/g, ' ');
  if (first) s = s.replace(/^\u00a0/, ' ');
  if (last) s = s.replace(/\u00a0$/, ' ');
  return s;
}

/** The editor's HTML as paragraphs (`multiline` false: a line break is a space). */
function read(box: HTMLElement, multiline = true): Paragraph[] {
  const out: Paragraph[] = [];
  // line breaks inside a paragraph (Shift+Enter, or pasted) waiting for the text after them: each starts a new paragraph
  let breaks = 0;
  const begin = (): Paragraph => {
    if (breaks && cur) {
      if (!multiline) { cur.runs.push({ text: ' ' }); breaks = 0; return cur; }
      out.push(cur);
      for (let i = 1; i < breaks; i++) out.push({ runs: [] });
      cur = { runs: [] };
    }
    breaks = 0;
    return (cur ??= para(null));
  };
  const para = (el: HTMLElement | null): Paragraph => {
    const p: Paragraph = { runs: [] };
    if (el) {
      const h = /si-h(\d)/.exec(el.className);
      if (h) p.heading = Number(h[1]);
      for (const k of ['figure', 'table', 'image', 'align'] as const) if (el.dataset[k]) p[k] = el.dataset[k];
    }
    return p;
  };
  let cur: Paragraph | null = null;
  const walk = (node: Node, f: { bold?: boolean; italic?: boolean; underline?: boolean; valign?: VAlign }): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = spaces(node.textContent ?? '', !cur?.runs.length || breaks > 0, !following(node));
      if (t) begin().runs.push({ text: t, ...f });
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    if (node.dataset.ref) { begin().runs.push({ text: '', ...f, ref: node.dataset.ref }); return; }
    // (a break with nothing after it in its paragraph is the browser's own, to keep the line open)
    if (node.tagName === 'BR') { if (following(node)) breaks++; return; }
    const k = TAGS[node.tagName];
    const g = { ...f };
    if (k === 'sup') g.valign = 'super';
    else if (k === 'sub') g.valign = 'sub';
    else if (k) (g as Record<string, unknown>)[k] = true;
    // a browser's own formatting (bold set with a style rather than a tag)
    const st = node.style;
    if (st.fontWeight === 'bold' || Number(st.fontWeight) >= 600) g.bold = true;
    if (st.fontStyle === 'italic') g.italic = true;
    if (/underline/.test(st.textDecoration)) g.underline = true;
    for (const c of node.childNodes) walk(c, g);
  };
  /** Whether anything shows after `node` in its paragraph (text or a link). */
  const following = (node: Node): boolean => {
    for (let n: Node | null = node; n && n !== box; n = n.parentNode) {
      if (n instanceof HTMLElement && (n.tagName === 'DIV' || n.tagName === 'P') && n.parentNode === box) return false;
      for (let s = n.nextSibling; s; s = s.nextSibling) {
        if (s instanceof HTMLElement && (s.tagName === 'DIV' || s.tagName === 'P') && s.parentNode === box) return false;
        if (s.nodeType === Node.TEXT_NODE ? !!s.textContent : s instanceof HTMLElement && (!!s.dataset.ref || !!s.textContent || !!s.querySelector('[data-ref]'))) return true;
      }
    }
    return false;
  };
  for (const n of box.childNodes) {
    if (n instanceof HTMLElement && (n.tagName === 'DIV' || n.tagName === 'P')) {
      if (cur) out.push(cur);
      breaks = 0;
      cur = para(n);
      for (const c of n.childNodes) walk(c, {});
      out.push(cur);
      cur = null;
      breaks = 0;
    } else walk(n, {});
  }
  if (cur) out.push(cur);
  // (simple runs: the same formatting merged when written)
  for (const p of out) for (const r of p.runs) { if (!r.bold) delete r.bold; if (!r.italic) delete r.italic; if (!r.underline) delete r.underline; if (!r.valign || r.valign === 'normal') delete r.valign; }
  return out.length ? out : [{ runs: [] }];
}

/** A rich text box over SI text. `multiline` false keeps it to one paragraph (an NMR report). */
export class SiRichBox {
  readonly el: HTMLDivElement;
  private last: string | null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private menu: HTMLDivElement | null = null;

  constructor(text: string, private host: SiRichHost, private multiline = true, placeholder = '') {
    const el = (this.el = document.createElement('div'));
    el.className = 'si-rich' + (multiline ? ' si-multi' : '');
    el.contentEditable = 'true';
    el.spellcheck = true;
    if (placeholder) el.dataset.placeholder = placeholder;
    el.setAttribute('role', 'textbox');
    if (multiline) el.setAttribute('aria-multiline', 'true');
    render(el, parseMarkup(text), host, multiline);
    // (as the box reads it back, so a file is only saved again when something is typed: leaving
    // a box untouched never rewrites a file another program wrote its own way)
    this.last = this.text;
    this.empty();
    // (once the box is on the page)
    setTimeout(() => checkSpelling(el), 0);
    el.addEventListener('input', (e) => {
      // (a word just finished: its chemistry formatted, H2SO4 → H₂SO₄)
      const ie = e as InputEvent;
      if ((ie.inputType === 'insertText' && ie.data && WORD_ENDS.includes(ie.data))) formatTyped(el);
      this.empty(); this.later(); this.offerMentions(); this.spellLater();
    });
    el.addEventListener('blur', () => { this.commit(); checkSpelling(el); setTimeout(() => this.closeMenu(), 150); });
    el.addEventListener('contextmenu', (e) => { spellingMenu(el, e); });
    el.addEventListener('keydown', (e) => this.key(e));
    el.addEventListener('paste', (e) => {
      // pasted text keeps its bold, italics, sub- and superscripts (from Word or MestReNova), nothing else
      e.preventDefault();
      const plain = e.clipboardData?.getData('text/plain') ?? '';
      const html = e.clipboardData?.getData('text/html') ?? '';
      // a drawing or picture: a figure where the caret is (when the box's text can hold one)
      if (multiline && this.host.pasteObject && ((!plain.trim() && !html.trim()) || /^\s*(<\?xml[^>]*>\s*)?(<!DOCTYPE[^>]*>\s*)?<CDXML[\s>]/i.test(plain) || this.host.holdsObject?.(e) === true)) {
        const sel = getSelection();
        const at = sel && sel.rangeCount && el.contains(sel.getRangeAt(0).startContainer) ? sel.getRangeAt(0).cloneRange() : null;
        this.host.pasteObject(e, (p) => this.place(at, p));
        return;
      }
      const clean = html ? cleanPastedHtml(html, multiline) : '';
      if (clean && hasFormatting(clean)) { document.execCommand('insertHTML', false, clean); return; }
      document.execCommand('insertText', false, multiline ? plain : plain.replace(/\s*\n\s*/g, ' '));
    });
  }

  /** The text as stored. */
  get text(): string { return writeMarkup(read(this.el, this.multiline)); }

  /** Show other text (the page was changed elsewhere). */
  set(text: string): void {
    if (text === this.last) return;
    render(this.el, parseMarkup(text), this.host, this.multiline);
    this.last = this.text;
    this.empty();
    setTimeout(() => checkSpelling(this.el), 0);
  }

  private spellTimer: ReturnType<typeof setTimeout> | null = null;
  private spellLater(): void {
    if (this.spellTimer) clearTimeout(this.spellTimer);
    this.spellTimer = setTimeout(() => checkSpelling(this.el), 350);
  }

  /** Mentions show their compounds' IDs as they are now. */
  relabel(): void {
    for (const s of this.el.querySelectorAll<HTMLElement>('[data-ref]')) if (!s.dataset.ref!.startsWith(STRUCT)) s.textContent = this.host.label(s.dataset.ref!);
  }

  /** Put a link (a structure, a mention) where the caret is in the box, else at its end, and save. */
  insertRef(ref: string): void {
    const tmp = document.createElement('div');
    render(tmp, [{ runs: [{ text: '', ref }] }], this.host, false);
    const node = tmp.firstElementChild?.firstChild;
    if (!node) return;
    const sel = getSelection();
    const r = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
    if (r && this.el.contains(r.startContainer)) {
      r.deleteContents();
      r.insertNode(node);
      r.setStartAfter(node);
      r.collapse(true);
    } else {
      const last = this.el.lastElementChild instanceof HTMLDivElement ? this.el.lastElementChild : this.el;
      if (last.lastChild instanceof HTMLBRElement) last.lastChild.remove();
      last.append(node);
    }
    this.empty();
    this.commit();
  }

  /** Put a paragraph (a figure's) at `at`'s line: in place of an empty line, else after it (at the end with no caret); gives the text with it, taken as saved. */
  private place(at: Range | null, p: Paragraph): string {
    const tmp = document.createElement('div');
    render(tmp, [p], this.host, true);
    const div = tmp.firstElementChild;
    if (!div) return this.text;
    let line: Node | null = at && this.el.contains(at.startContainer) ? at.startContainer : null;
    while (line && line.parentNode !== this.el) line = line.parentNode;
    const blank = line instanceof HTMLElement && (line.tagName === 'DIV' || line.tagName === 'P') && !line.textContent?.trim() && !line.querySelector('[data-ref]') && !line.classList.contains('si-object');
    if (blank) (line as HTMLElement).replaceWith(div);
    else if (line) (line as ChildNode).after(div);
    else this.el.append(div);
    this.empty();
    // (the host saves it: leaving the box doesn't save it again)
    this.last = this.text;
    return this.last;
  }

  private empty(): void { this.el.classList.toggle('si-empty', !this.el.textContent?.trim() && !this.el.querySelector('[data-ref]')); }

  private later(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.commit(), 700);
  }

  /** What was typed could not be saved: it is saved again when the box is next left (or the page goes). */
  unsaved(): void { this.last = null; }

  /** Save what was typed, if it changed. */
  commit(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const t = this.text;
    if (t === this.last) return;
    this.last = t;
    this.host.changed(t);
  }

  private key(e: KeyboardEvent): void {
    if (this.menu && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === 'Escape')) {
      e.preventDefault();
      const items = [...this.menu.querySelectorAll<HTMLButtonElement>('button')];
      const at = items.findIndex((b) => b.classList.contains('hot'));
      if (e.key === 'Escape') { this.closeMenu(); return; }
      if (e.key === 'Enter') { items[Math.max(0, at)]?.click(); return; }
      const next = (at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items.forEach((b, i) => b.classList.toggle('hot', i === next));
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Enter' && !this.multiline) { e.preventDefault(); this.commit(); return; }
    if (!mod) return;
    const k = e.key.toLowerCase();
    const cmd = k === 'b' ? 'bold' : k === 'i' ? 'italic' : k === 'u' ? 'underline' : (k === '=' || k === '+') ? (e.shiftKey ? 'superscript' : 'subscript') : '';
    if (!cmd) return;
    e.preventDefault();
    e.stopPropagation();
    document.execCommand(cmd);
    this.later();
  }

  /** After "@": the compounds to mention, filtered by what follows it. */
  private offerMentions(): void {
    const list = this.host.mentionable?.();
    if (!list) return;
    const sel = getSelection();
    const node = sel?.anchorNode;
    if (!sel || !node || node.nodeType !== Node.TEXT_NODE) { this.closeMenu(); return; }
    const before = (node.textContent ?? '').slice(0, sel.anchorOffset);
    const m = /@([^\s@]*)$/.exec(before);
    if (!m) { this.closeMenu(); return; }
    const q = m[1].toLowerCase();
    const hits = list.filter((c) => !q || c.label.toLowerCase().startsWith(q) || c.text.toLowerCase().includes(q)).slice(0, 8);
    if (!hits.length) { this.closeMenu(); return; }
    this.closeMenu();
    const menu = (this.menu = document.createElement('div'));
    menu.className = 'si-mention-menu';
    hits.forEach((c, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = i === 0 ? 'hot' : '';
      b.innerHTML = `<b></b> <span></span>`;
      b.querySelector('b')!.textContent = c.label;
      b.querySelector('span')!.textContent = c.text;
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => {
        const range = document.createRange();
        range.setStart(node, sel.anchorOffset - m[0].length);
        range.setEnd(node, sel.anchorOffset);
        range.deleteContents();
        const chip = document.createElement('span');
        chip.className = 'si-mention';
        chip.contentEditable = 'false';
        chip.dataset.ref = MENTION + c.id;
        chip.textContent = c.label;
        range.insertNode(chip);
        const after = document.createTextNode(' ');
        chip.after(after);
        sel.collapse(after, 1);
        this.closeMenu();
        this.commit();
      });
      menu.append(b);
    });
    const r = sel.getRangeAt(0).getBoundingClientRect();
    menu.style.left = `${r.left}px`;
    menu.style.top = `${r.bottom + 4}px`;
    popupHost().append(menu);
  }

  private closeMenu(): void {
    this.menu?.remove();
    this.menu = null;
  }
}
