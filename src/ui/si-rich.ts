// A box for SI text with its formatting (a procedure, an NMR report, a section's text): bold,
// italic, underline, superscript and subscript, and mentions of compounds that show their
// current ID. What is typed is kept in SI Assistant's text format (src/si/markup.ts).
//
// Ctrl+B, Ctrl+I and Ctrl+U as in Word; Ctrl+= subscript, Ctrl+Shift+= superscript; typing
// "@" offers the project's compounds to mention.

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
}

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

/** The editor's HTML as paragraphs. */
function read(box: HTMLElement): Paragraph[] {
  const out: Paragraph[] = [];
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
      const t = (node.textContent ?? '').replace(/ /g, ' ').replace(/\n/g, ' ');
      if (t) (cur ??= para(null)).runs.push({ text: t, ...f });
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    if (node.dataset.ref) { (cur ??= para(null)).runs.push({ text: '', ...f, ref: node.dataset.ref }); return; }
    if (node.tagName === 'BR') return;
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
  for (const n of box.childNodes) {
    if (n instanceof HTMLElement && (n.tagName === 'DIV' || n.tagName === 'P')) {
      if (cur) out.push(cur);
      cur = para(n);
      for (const c of n.childNodes) walk(c, {});
      out.push(cur);
      cur = null;
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
  private last: string;
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
    this.last = text;
    render(el, parseMarkup(text), host, multiline);
    this.empty();
    el.addEventListener('input', () => { this.empty(); this.later(); this.offerMentions(); });
    el.addEventListener('blur', () => { this.commit(); setTimeout(() => this.closeMenu(), 150); });
    el.addEventListener('keydown', (e) => this.key(e));
    el.addEventListener('paste', (e) => {
      // pasted text comes in plain (its formatting from other programs is not SI formatting)
      e.preventDefault();
      const t = e.clipboardData?.getData('text/plain') ?? '';
      document.execCommand('insertText', false, multiline ? t : t.replace(/\s*\n\s*/g, ' '));
    });
  }

  /** The text as stored. */
  get text(): string { return writeMarkup(read(this.el)); }

  /** Show other text (the page was changed elsewhere). */
  set(text: string): void {
    if (text === this.last) return;
    this.last = text;
    render(this.el, parseMarkup(text), this.host, this.multiline);
    this.empty();
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

  private empty(): void { this.el.classList.toggle('si-empty', !this.el.textContent?.trim() && !this.el.querySelector('[data-ref]')); }

  private later(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.commit(), 700);
  }

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
    document.body.append(menu);
  }

  private closeMenu(): void {
    this.menu?.remove();
    this.menu = null;
  }
}
