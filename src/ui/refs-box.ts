// The References box on a slide (review round 2, finding 17, mockup R1): click a layout's
// References placeholder and this tick list opens on it. Ticked references are the slide's
// reference lines; references cited in the slide's text (Insert ▸ Citation) are ticked by the
// citation and say so. The search also finds references in the library, which join the
// presentation's list when ticked. Insert ▸ Citation opens the same list to pick from.

import { CITE_PRESETS, type CiteFormat } from '../document/cite-styles';
import type { Reference } from '../document/references';
import { slideRefPieces } from '../deck/slide-refs';
import { infoIcon } from './info-tip';

export interface RefsBoxHooks {
  /** The presentation's references, the slide's ticked ones and the ones cited in its text. */
  state(): { list: Reference[]; ticked: string[]; cited: Set<string>; style: string; format: CiteFormat };
  /** The library's references (found by the search). */
  library(): Reference[];
  /** Tick or untick a reference on the slide (a library one joins the presentation's list). */
  tick(ref: Reference, on: boolean): void;
  /** Insert ▸ Citation: put a citation of the reference in the text. */
  cite(ref: Reference): void;
  setStyle(style: string): void;
  addFromLibrary(): void;
  addWithZotero(): void;
  look(): void;
}

const plain = (pieces: { text: string }[]) => pieces.map((p) => p.text).join('').trim();

export class RefsBox {
  private el: HTMLDivElement | null = null;
  private mode: 'tick' | 'cite' = 'tick';
  private query = '';
  private closeOnOutside = (e: PointerEvent) => { if (this.el && !this.el.contains(e.target as Node)) this.close(); };
  private closeOnKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); this.close(); } };

  constructor(private hooks: RefsBoxHooks) {}

  get isOpen(): boolean { return !!this.el; }

  /**
   * Open over (or under) the box at `at` (client pixels): `tick` is the slide's tick list, `cite`
   * picks the reference for a citation in the text.
   */
  open(at: { left: number; top: number; bottom: number; width: number }, mode: 'tick' | 'cite' = 'tick'): void {
    this.close();
    this.mode = mode;
    this.query = '';
    const el = document.createElement('div');
    el.className = 'refs-box';
    // picking here leaves the text being typed open (Insert ▸ Citation types into it)
    el.dataset.keepsTyping = '';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', mode === 'cite' ? 'Insert Citation' : 'References on This Slide');
    document.body.append(el);
    this.el = el;
    this.build();
    // above the box when there is room, else below it; inside the window
    const r = el.getBoundingClientRect();
    const left = Math.max(8, Math.min(at.left, innerWidth - r.width - 8));
    const top = at.top - r.height - 6 >= 8 ? at.top - r.height - 6 : Math.min(at.bottom + 6, innerHeight - r.height - 8);
    el.style.left = `${left}px`;
    el.style.top = `${Math.max(8, top)}px`;
    el.querySelector<HTMLInputElement>('.rb-find')?.focus();
    setTimeout(() => {
      document.addEventListener('pointerdown', this.closeOnOutside, true);
      document.addEventListener('keydown', this.closeOnKey, true);
    });
  }

  close(): void {
    this.el?.remove();
    this.el = null;
    document.removeEventListener('pointerdown', this.closeOnOutside, true);
    document.removeEventListener('keydown', this.closeOnKey, true);
  }

  /** The list again (after the slide or the references changed). */
  refresh(): void {
    if (this.el) this.fill();
  }

  private build(): void {
    const el = this.el!;
    el.replaceChildren();
    const head = document.createElement('div');
    head.className = 'rfb-head';
    const h = document.createElement('span');
    h.className = 'rfb-title';
    h.textContent = this.mode === 'cite' ? 'Insert Citation' : 'References on This Slide';
    h.append(infoIcon(this.mode === 'cite'
      ? 'Select the reference to cite: its number goes in the text at the cursor, in the citation style, and the reference is checked on the slide.'
      : 'Checked references are listed in this box, in the citation style. Citations in the slide\'s text (Insert ▸ Citation) check their references automatically.'));
    const style = document.createElement('select');
    style.className = 'rfb-style';
    style.setAttribute('aria-label', 'Citation style');
    for (const [id, p] of Object.entries(CITE_PRESETS)) style.append(new Option(p.name, id));
    style.value = this.hooks.state().style;
    style.addEventListener('change', () => { this.hooks.setStyle(style.value); this.fill(); });
    head.append(h, style);
    const find = document.createElement('input');
    find.type = 'search';
    find.className = 'rb-find';
    find.placeholder = 'Find in the presentation\'s references or your library';
    find.setAttribute('aria-label', 'Find a reference');
    find.addEventListener('input', () => { this.query = find.value.trim().toLowerCase(); this.fill(); });
    const list = document.createElement('div');
    list.className = 'rfb-list';
    list.setAttribute('role', this.mode === 'cite' ? 'listbox' : 'group');
    const foot = document.createElement('div');
    foot.className = 'rfb-foot';
    const button = (label: string, fn: () => void) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.addEventListener('click', () => { this.close(); fn(); });
      return b;
    };
    foot.append(button('Add from Library…', () => this.hooks.addFromLibrary()), button('Add with Zotero…', () => this.hooks.addWithZotero()));
    if (this.mode === 'tick') {
      const look = button('Look…', () => this.hooks.look());
      look.classList.add('rfb-look');
      foot.append(look);
    }
    el.append(head, find, list, foot);
    this.fill();
  }

  private fill(): void {
    const list = this.el?.querySelector<HTMLElement>('.rfb-list');
    if (!list) return;
    const st = this.hooks.state();
    const q = this.query;
    const match = (r: Reference) => !q || [r.authors.join(' '), r.title, r.journal, r.year, r.doi].join(' ').toLowerCase().includes(q);
    const ours = st.list.filter(match);
    const known = new Set(st.list.map((r) => r.id));
    const dois = new Set(st.list.map((r) => r.doi.toLowerCase()).filter(Boolean));
    const lib = q ? this.hooks.library().filter((r) => !known.has(r.id) && !(r.doi && dois.has(r.doi.toLowerCase())) && match(r)).slice(0, 20) : [];
    list.replaceChildren();
    const row = (r: Reference, fromLibrary: boolean) => {
      const item = document.createElement('label');
      item.className = 'rfb-row';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = !fromLibrary && st.ticked.includes(r.id);
      const text = document.createElement('span');
      text.className = 'rfb-text';
      const main = document.createElement('span');
      main.className = 'rfb-main';
      main.textContent = plain(slideRefPieces(r, 'author', st.format)) || r.title || '(no details)';
      const sub = document.createElement('span');
      sub.className = 'rfb-sub';
      sub.textContent = r.title && !main.textContent.includes(r.title) ? r.title : '';
      text.append(main, sub);
      item.append(box, text);
      if (st.cited.has(r.id)) {
        const tag = document.createElement('span');
        tag.className = 'rfb-cited';
        tag.textContent = 'cited in text';
        item.append(tag);
      } else if (fromLibrary) {
        const tag = document.createElement('span');
        tag.className = 'rfb-lib';
        tag.textContent = 'library';
        item.append(tag);
      }
      if (this.mode === 'cite') {
        box.hidden = true;
        item.tabIndex = 0;
        item.setAttribute('role', 'option');
        const pick = (e: Event) => { e.preventDefault(); this.close(); this.hooks.cite(r); };
        item.addEventListener('click', pick);
        item.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') pick(e); });
      } else {
        box.addEventListener('change', () => { this.hooks.tick(r, box.checked); this.fill(); });
      }
      return item;
    };
    for (const r of ours) list.append(row(r, false));
    if (lib.length) {
      const h = document.createElement('div');
      h.className = 'rfb-group';
      h.textContent = 'In your library';
      list.append(h, ...lib.map((r) => row(r, true)));
    }
    if (!list.children.length) {
      const none = document.createElement('div');
      none.className = 'rfb-none';
      none.textContent = q ? 'No reference matches.' : 'This presentation has no references yet: add them from your library or with Zotero below, or find them by typing above.';
      list.append(none);
    }
  }
}
