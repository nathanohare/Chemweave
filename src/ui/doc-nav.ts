// View > Navigation Pane (Ctrl+F opens it on a search, as in Word): beside the pages, the
// document's headings to click to go to, fold, and drag into another order (each heading
// bringing what is under it), and the places a search finds, each with the words round it.

import type { DocText } from '../document/document';
import { headingAt, headingsOf, levelsOf, moveHeading, searchDocument, shownHeadings, type NavHeading, type NavHit } from '../document/navigation';
import { subtreeEnd } from '../document/doc-views';
import { popupMenu } from './sheet-view';

/** The most results listed at once (a common word has thousands; Enter still goes through all of them). */
export const MOST_LISTED = 500;

export interface DocNavHost {
  text(): DocText | null;
  /** Which document is shown (anything that tells one from another), so what is kept for one isn't shown for the next. */
  file?(): unknown;
  /** The paragraph the caret is in (the document's text). */
  caretPara(): number;
  /** Put the caret at the start of a paragraph and scroll it to the top. */
  goToPara(p: number): void;
  goToHit(hit: NavHit): void;
  /** Change the document (one undo step), the caret at the start of paragraph `para`. */
  apply(t: DocText, kind: string, para: number): void;
  /** Promote or demote a heading with everything under it. */
  level(para: number, op: 'promote' | 'demote'): void;
  /** Delete a heading with everything under it. */
  deleteBlock(para: number): void;
  /** Show the found text in the pages (null to stop). */
  showFound(q: string | null): void;
  resized(): void;
  focus(): void;
}

export class DocNav {
  readonly el: HTMLElement;
  private list: HTMLElement;
  private search: HTMLInputElement;
  private count: HTMLElement;
  private tabs: HTMLButtonElement[];
  private tab: 'headings' | 'results' = 'headings';
  /** The folded headings, each by its level, its words and which of those it is (not its paragraph number, which an edit above it moves). */
  private folded = new Set<string>();
  private hits: NavHit[] = [];
  /** What the lists were made from: the text, the file, the words searched and the tab, to leave them alone when only the caret moved. */
  private shownT: DocText | null = null;
  private shownFile: unknown;
  private shownTab: 'headings' | 'results' | null = null;
  private searchedT: DocText | null = null;
  private searchedQ = '';
  private heads: NavHeading[] = [];
  private queued = false;
  private dragFrom: number | null = null;

  constructor(pane: HTMLElement, private host: DocNavHost) {
    this.el = document.createElement('aside');
    this.el.id = 'doc-nav';
    this.el.hidden = true;
    this.el.setAttribute('aria-label', 'Navigation');
    this.el.innerHTML = `
      <div class="nav-head"><span>Navigation</span><button type="button" class="nav-close" title="Close the Navigation pane">✕</button></div>
      <div class="nav-search"><input type="search" placeholder="Search document" aria-label="Search document" spellcheck="false" /><span class="nav-count"></span></div>
      <div class="nav-tabs" role="tablist">
        <button type="button" role="tab" data-tab="headings" aria-selected="true">Headings</button>
        <button type="button" role="tab" data-tab="results" aria-selected="false">Results</button>
      </div>
      <div class="nav-list" role="tree"></div>`;
    pane.prepend(this.el);
    this.list = this.el.querySelector('.nav-list')!;
    this.search = this.el.querySelector('input')!;
    this.count = this.el.querySelector('.nav-count')!;
    this.tabs = [...this.el.querySelectorAll<HTMLButtonElement>('[data-tab]')];
    this.el.querySelector('.nav-close')!.addEventListener('click', () => this.toggle(false));
    for (const b of this.tabs) b.addEventListener('click', () => this.showTab(b.dataset.tab as 'headings' | 'results'));
    this.search.addEventListener('input', () => { this.runSearch(); if (this.search.value.trim()) this.showTab('results'); });
    this.search.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); this.step(e.shiftKey ? -1 : 1); }
      if (e.key === 'Escape') { e.preventDefault(); this.search.value = ''; this.runSearch(); this.host.focus(); }
    });
  }

  get open(): boolean { return !this.el.hidden; }

  toggle(on = !this.open, searching = false): void {
    this.el.hidden = !on;
    this.el.parentElement?.classList.toggle('nav-open', on);
    if (!on) this.host.showFound(null);
    this.host.resized();
    if (on) {
      this.refresh();
      if (searching) { this.search.focus(); this.search.select(); }
    } else this.host.focus();
  }

  private showTab(tab: 'headings' | 'results'): void {
    this.tab = tab;
    for (const b of this.tabs) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    this.render();
  }

  /** The document or the caret changed: show it again (once, on the next frame). */
  refresh(): void {
    if (!this.open || this.queued) return;
    this.queued = true;
    requestAnimationFrame(() => {
      this.queued = false;
      const t = this.host.text();
      const file = this.host.file?.();
      // another document: what was kept for the last one (folds, the result being visited) goes
      if (file !== this.shownFile) { this.folded.clear(); this.at = -1; this.searchedT = null; this.shownT = null; }
      const q = this.search.value;
      // the words are looked for again only when the text changed (not for the caret moving)
      if (q.trim() && (t !== this.searchedT || q !== this.searchedQ)) { this.runSearch(false); return; }
      if (t === this.shownT && file === this.shownFile && this.tab === this.shownTab) { this.markHere(); return; }
      this.render();
    });
  }

  /** Only the caret moved: the heading it is under is marked, and nothing is built again. */
  private markHere(): void {
    if (this.tab !== 'headings') return;
    const here = headingAt(this.heads, this.host.caretPara());
    for (const row of this.list.querySelectorAll<HTMLElement>('.nav-item')) row.classList.toggle('nav-here', row.dataset.para === String(here));
  }

  /** A heading's key for folding: its level, its words and which of those it is (the second "Methods" is not the first). */
  private foldKeys(heads: NavHeading[]): string[] {
    const seen = new Map<string, number>();
    return heads.map((h) => {
      const base = `${h.level}|${h.text}`;
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      return `${base}|${n}`;
    });
  }

  private runSearch(show = true): void {
    const t = this.host.text();
    const q = this.search.value;
    this.hits = t && q.trim() ? searchDocument(t, q) : [];
    // new words start from the first result; the same words in changed text keep the place, within the results there are now
    if (q !== this.searchedQ) this.at = -1;
    else this.at = Math.min(this.at, this.hits.length - 1);
    this.searchedT = t;
    this.searchedQ = q;
    this.count.textContent = q.trim() ? `${this.hits.length} result${this.hits.length === 1 ? '' : 's'}` : '';
    if (show) this.host.showFound(q.trim() ? q : null);
    this.render();
  }

  private at = -1;

  /** Enter in the search box: the next (or previous) result. */
  private step(dir: 1 | -1): void {
    if (!this.hits.length) return;
    // (none visited yet: Enter goes to the first, Shift+Enter to the last)
    this.at = this.at < 0 ? (dir > 0 ? 0 : this.hits.length - 1) : (this.at + dir + this.hits.length) % this.hits.length;
    this.host.goToHit(this.hits[this.at]);
    // the keys stay in the search box (going to the hit focuses the page, where the next Enter
    // would replace the selected hit with a paragraph break)
    this.search.focus();
    this.render();
  }

  private render(): void {
    const t = this.host.text();
    this.list.replaceChildren();
    this.shownT = t;
    this.shownFile = this.host.file?.();
    this.shownTab = this.tab;
    if (!t) return;
    if (this.tab === 'results') { this.renderResults(); return; }
    const heads = headingsOf(t);
    this.heads = heads;
    const keys = this.foldKeys(heads);
    const index = new Map(heads.map((h, k) => [h, k]));
    const foldedParas = new Set(heads.filter((_, k) => this.folded.has(keys[k])).map((h) => h.para));
    if (!heads.length) {
      const p = document.createElement('p');
      p.className = 'nav-empty';
      p.textContent = 'No headings yet. Give paragraphs a Heading style (Home ▸ Heading 1, 2 or 3) and they show here, to go to and to drag into another order.';
      this.list.append(p);
      return;
    }
    const here = headingAt(heads, this.host.caretPara());
    const shown = shownHeadings(heads, foldedParas);
    const minLevel = Math.min(...heads.map((h) => h.level));
    shown.forEach((h) => {
      const i = index.get(h)!;
      const key = keys[i];
      const kids = i + 1 < heads.length && heads[i + 1].level > h.level;
      const row = document.createElement('div');
      row.className = 'nav-item';
      row.setAttribute('role', 'treeitem');
      row.draggable = true;
      row.dataset.para = String(h.para);
      row.style.paddingLeft = `${4 + (h.level - minLevel) * 14}px`;
      if (h.para === here) row.classList.add('nav-here');
      const fold = document.createElement('button');
      fold.type = 'button';
      fold.className = 'nav-fold';
      fold.textContent = kids ? (this.folded.has(key) ? '▸' : '▾') : '';
      fold.tabIndex = -1;
      fold.disabled = !kids;
      fold.title = kids ? (this.folded.has(key) ? 'Show the headings under this one' : 'Hide the headings under this one') : '';
      fold.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.folded.has(key)) this.folded.delete(key); else this.folded.add(key);
        this.render();
      });
      const label = document.createElement('span');
      label.className = 'nav-label';
      label.textContent = h.text || '(empty heading)';
      label.title = h.text;
      row.append(fold, label);
      if (kids) row.setAttribute('aria-expanded', String(!this.folded.has(key)));
      row.addEventListener('click', () => this.host.goToPara(h.para));
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        popupMenu(e.clientX, e.clientY, [
          ['Promote', () => this.host.level(h.para, 'promote'), h.level > 1],
          ['Demote', () => this.host.level(h.para, 'demote'), h.level < 9],
          null,
          ['Expand All', () => { this.folded.clear(); this.render(); }],
          ['Collapse All', () => { for (const k of keys) this.folded.add(k); this.render(); }],
          null,
          ['Delete Heading and Content', () => this.host.deleteBlock(h.para)],
        ]);
      });
      // drag a heading (and everything under it) above another, or to the end
      row.addEventListener('dragstart', (e) => {
        this.dragFrom = h.para;
        e.dataTransfer?.setData('text/plain', h.text);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
        row.classList.add('nav-dragging');
      });
      row.addEventListener('dragend', () => { this.dragFrom = null; row.classList.remove('nav-dragging'); this.clearDrop(); });
      row.addEventListener('dragover', (e) => {
        if (this.dragFrom === null) return;
        e.preventDefault();
        const r = row.getBoundingClientRect();
        this.clearDrop();
        row.classList.add(e.clientY > r.top + r.height / 2 ? 'nav-drop-after' : 'nav-drop-before');
      });
      row.addEventListener('drop', (e) => {
        e.preventDefault();
        const from = this.dragFrom;
        this.dragFrom = null;
        const after = row.classList.contains('nav-drop-after');
        this.clearDrop();
        if (from === null) return;
        // after a heading: after everything under it (or under the folded heading)
        let to = h.para;
        if (after) {
          const levels = levelsOf(t);
          // (an open heading: first under it, before the heading after it)
          to = this.folded.has(key) || !kids ? subtreeEnd(levels, h.para) : heads[i + 1].para;
        }
        const moved = moveHeading(t, from, to);
        if (moved) this.host.apply(moved.t, 'Move heading', moved.para);
      });
      this.list.append(row);
    });
    // dropping below the last heading: to the end of the document
    const end = document.createElement('div');
    end.className = 'nav-end';
    end.addEventListener('dragover', (e) => { if (this.dragFrom !== null) { e.preventDefault(); end.classList.add('nav-drop-before'); } });
    end.addEventListener('dragleave', () => end.classList.remove('nav-drop-before'));
    end.addEventListener('drop', (e) => {
      e.preventDefault();
      const from = this.dragFrom;
      this.dragFrom = null;
      end.classList.remove('nav-drop-before');
      if (from === null) return;
      const moved = moveHeading(t, from, levelsOf(t).length);
      if (moved) this.host.apply(moved.t, 'Move heading', moved.para);
    });
    this.list.append(end);
  }

  private clearDrop(): void {
    for (const x of this.list.querySelectorAll('.nav-drop-before, .nav-drop-after')) x.classList.remove('nav-drop-before', 'nav-drop-after');
  }

  private renderResults(): void {
    if (!this.search.value.trim()) {
      const p = document.createElement('p');
      p.className = 'nav-empty';
      p.textContent = 'Type in the box above to find words in the text and in the tables. Enter goes to each in turn.';
      this.list.append(p);
      return;
    }
    if (!this.hits.length) {
      const p = document.createElement('p');
      p.className = 'nav-empty';
      p.textContent = 'Nothing found.';
      this.list.append(p);
      return;
    }
    this.hits.slice(0, MOST_LISTED).forEach((hit, i) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'nav-hit';
      if (i === this.at) row.classList.add('nav-here');
      const b = document.createElement('mark');
      b.textContent = hit.match;
      row.append(document.createTextNode(hit.before), b, document.createTextNode(hit.after));
      if (hit.cell) row.title = 'In a table';
      row.addEventListener('click', () => { this.at = i; this.host.goToHit(hit); this.render(); });
      this.list.append(row);
    });
    if (this.hits.length > MOST_LISTED) {
      const more = document.createElement('p');
      more.className = 'nav-empty';
      more.textContent = `The first ${MOST_LISTED} of ${this.hits.length} results are listed. Enter in the box above goes to each of them in turn.`;
      this.list.append(more);
    }
  }
}
