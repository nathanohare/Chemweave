// The side panel's sections (Style, Animation, Comments, Layers, Warnings, Format, Cell, Analysis)
// as tabs in the panel's one header row: one section shows at a time. A tab can be dragged down
// into the panel to stack it under the tabs (always showing, with its own heading, which folds it),
// and tabs and stacked sections can be dragged into another order. Each mode keeps its own layout.
//
// The sections themselves belong to the rest of the app, which shows and hides them as before:
// this only decides which of the shown ones are on screen, and turns their headings into tabs.

import { showContextMenu, type MenuItem } from './context-menu';
import { enter } from './motion';

/** How one mode's sections are laid out, where changed from how they come (all tabs, in SECTION_ORDER). */
export interface SideLayout {
  /** Section ids in order (tabs left to right, stacked sections top to bottom). */
  order?: string[];
  /** Sections stacked under the tabs rather than shown as tabs. */
  stacked?: string[];
  /** Stacked sections folded up to their heading. */
  folded?: string[];
  /** The tab showing. */
  active?: string;
}

/** The order sections come in, until dragged. */
export const SECTION_ORDER: readonly string[] = [
  'style-section', 'doc-section', 'cell-section', 'layers-section', 'anim-section', 'cmt-section',
  'warnings-section', 'analysis-section', 'speed-section', 'errors-section',
];

/** Every id in a layout's order, then the rest as they come. */
function fullOrder(layout: SideLayout, also: readonly string[] = []): string[] {
  const out: string[] = [];
  for (const id of [...(layout.order ?? []), ...SECTION_ORDER, ...also]) if (!out.includes(id)) out.push(id);
  return out;
}

/** Which of the sections showing are tabs, which are stacked, and which tab is open. */
export function arrange(layout: SideLayout, visible: readonly string[]): { tabs: string[]; stacked: string[]; active: string | null } {
  const order = fullOrder(layout, visible).filter((id) => visible.includes(id));
  const stacked = order.filter((id) => layout.stacked?.includes(id));
  const tabs = order.filter((id) => !stacked.includes(id));
  const active = layout.active && tabs.includes(layout.active) ? layout.active : tabs[0] ?? null;
  return { tabs, stacked, active };
}

/**
 * A section moved among the tabs or the stacked sections, before another section of that kind
 * (or to the end of them with `before` null).
 */
export function withMoved(layout: SideLayout, id: string, zone: 'tabs' | 'stack', before: string | null): SideLayout {
  const order = fullOrder(layout, [id, ...(before ? [before] : [])]).filter((x) => x !== id);
  const at = before && before !== id ? order.indexOf(before) : -1;
  order.splice(at < 0 ? order.length : at, 0, id);
  const stacked = (layout.stacked ?? []).filter((x) => x !== id);
  if (zone === 'stack') stacked.push(id);
  const next: SideLayout = { ...layout, order, stacked };
  // a section made a tab is the one that shows; one stacked stops being the open tab
  if (zone === 'tabs') next.active = id;
  else if (next.active === id) delete next.active;
  return next;
}

/** A stacked section folded to its heading, or opened. */
export function withFolded(layout: SideLayout, id: string, folded: boolean): SideLayout {
  const rest = (layout.folded ?? []).filter((x) => x !== id);
  return { ...layout, folded: folded ? [...rest, id] : rest };
}

/** Layouts read from the settings file, keeping only what makes sense. */
export function parseSideLayouts(raw: unknown): Record<string, SideLayout> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const ids = (v: unknown): string[] | undefined => {
    if (!Array.isArray(v)) return undefined;
    const out = v.filter((x): x is string => typeof x === 'string' && /^[a-z][a-z0-9-]*$/.test(x));
    return [...new Set(out)].slice(0, 40);
  };
  const out: Record<string, SideLayout> = {};
  for (const [mode, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^[a-z]+$/.test(mode) || !v || typeof v !== 'object') continue;
    const r = v as Record<string, unknown>;
    const l: SideLayout = {};
    const order = ids(r.order); if (order?.length) l.order = order;
    const stacked = ids(r.stacked); if (stacked?.length) l.stacked = stacked;
    const folded = ids(r.folded); if (folded?.length) l.folded = folded;
    if (typeof r.active === 'string' && /^[a-z][a-z0-9-]*$/.test(r.active)) l.active = r.active;
    out[mode] = l;
  }
  return Object.keys(out).length ? out : undefined;
}

/** "13 atoms, 13 bonds" as a title: "13 Atoms, 13 Bonds". */
export function titleCase(text: string): string {
  return text.replace(/(^|[\s(,/])([a-z])(?=[a-z]{2})/g, (_, lead: string, c: string) => lead + c.toUpperCase());
}

export interface SideHooks {
  /** The mode showing (each keeps its own layout). */
  mode(): string;
  get(mode: string): SideLayout;
  set(mode: string, layout: SideLayout): void;
}

/** What sits in a heading beside its title without needing a row of its own under the tabs. */
const HEADING_EXTRAS = '.ss-title, .style-of, .cell-name, .an-close, .count, .info-icon';
/** The part of a heading that says what the section is about (the selection, the cell). */
const SUBTITLE = '.style-of, .cell-name';
const DRAG_START = 5;

export class SideSections {
  /** The tabs, for the panel's header row. */
  readonly tabs: HTMLDivElement;
  /** The » button that lists the tabs with no room. */
  readonly more: HTMLButtonElement;
  private observer: MutationObserver | null = null;
  private resizes: ResizeObserver | null = null;
  private seen = new Set<string>();
  private seenMode = '';
  private queued = false;
  /** Set while a drag ends, so the click that follows doesn't also switch tabs or fold. */
  private dragged = false;
  private hiddenTabs: string[] = [];
  private tabsKey = '';
  private fitKey = '';

  constructor(private content: HTMLElement, private hooks: SideHooks) {
    this.tabs = document.createElement('div');
    this.tabs.className = 'ss-tabs';
    this.tabs.setAttribute('role', 'tablist');
    this.tabs.setAttribute('aria-label', 'Side panel sections');
    this.more = document.createElement('button');
    this.more.type = 'button';
    this.more.className = 'ss-more';
    this.more.textContent = '»';
    this.more.title = 'More sections';
    this.more.setAttribute('aria-label', 'More sections');
    this.more.setAttribute('aria-haspopup', 'menu');
    this.more.hidden = true;
    this.more.addEventListener('click', () => this.moreMenu());

    this.tabs.addEventListener('click', (e) => {
      if (this.dragged) return;
      const x = (e.target as Element).closest<HTMLElement>('.ss-tab-x');
      if (x) { this.close(x.dataset.sec!); return; }
      const tab = (e.target as Element).closest<HTMLElement>('.ss-tab');
      if (tab) this.activate(tab.dataset.sec!);
    });
    this.tabs.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
      const all = [...this.tabs.querySelectorAll<HTMLElement>('.ss-tab:not([hidden])')];
      const at = all.indexOf(document.activeElement as HTMLElement);
      if (at < 0) return;
      e.preventDefault();
      const to = e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : (at + (e.key === 'ArrowRight' ? 1 : -1) + all.length) % all.length;
      this.activate(all[to].dataset.sec!);
      this.tabs.querySelector<HTMLElement>(`.ss-tab[data-sec="${all[to].dataset.sec}"]`)?.focus();
    });
    this.tabs.addEventListener('pointerdown', (e) => {
      const tab = (e.target as Element).closest<HTMLElement>('.ss-tab');
      if (tab && e.button === 0) this.watchDrag(tab.dataset.sec!, e);
    });
    this.tabs.addEventListener('contextmenu', (e) => {
      const tab = (e.target as Element).closest<HTMLElement>('.ss-tab');
      if (!tab) return;
      e.preventDefault(); e.stopPropagation();
      this.menu(tab.dataset.sec!, e.clientX, e.clientY);
    });

    // a stacked section's heading folds it (click, Enter or Space) and drags it
    content.addEventListener('click', (e) => {
      const title = this.stackedTitle(e.target);
      if (!title || this.dragged) return;
      this.fold(title.closest('section')!.id);
    });
    content.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const title = (e.target as Element).closest?.<HTMLElement>('.ss-title');
      if (!title || !title.closest('section.ss-stacked')) return;
      e.preventDefault();
      this.fold(title.closest('section')!.id);
    });
    content.addEventListener('pointerdown', (e) => {
      const title = this.stackedTitle(e.target);
      if (title && e.button === 0) this.watchDrag(title.closest('section')!.id, e);
    });
    content.addEventListener('contextmenu', (e) => {
      const title = this.stackedTitle(e.target);
      if (!title) return;
      e.preventDefault(); e.stopPropagation();
      this.menu(title.closest('section')!.id, e.clientX, e.clientY);
    });

    if (typeof MutationObserver !== 'undefined') {
      this.observer = new MutationObserver(() => this.queue());
      this.watch();
      // a mode change shows other sections (by the page's class, not by the sections' own)
      new MutationObserver(() => this.queue()).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    }
    if (typeof ResizeObserver !== 'undefined') {
      this.resizes = new ResizeObserver(() => this.fit());
      this.resizes.observe(this.tabs);
    }
    this.refresh();
  }

  /** Put the tabs in the panel's header row, after its title, with the panel's × at the end. */
  mount(head: HTMLElement, close: HTMLElement): void {
    const title = head.querySelector('.tb-title');
    if (this.tabs.parentElement !== head) (title ?? head.firstElementChild)?.after(this.tabs, this.more);
    if (close.parentElement !== head || head.lastElementChild !== close) head.append(close);
    this.refresh();
  }

  /** Bring a section into view: open its tab, or unfold it where it is stacked. */
  show(id: string): void {
    const mode = this.hooks.mode();
    const layout = this.hooks.get(mode);
    if (layout.stacked?.includes(id)) { if (layout.folded?.includes(id)) this.hooks.set(mode, withFolded(layout, id, false)); }
    else if (layout.active !== id) this.hooks.set(mode, { ...layout, active: id });
    this.refresh();
  }

  private watch(): void {
    this.observer?.observe(this.content, { attributes: true, attributeFilter: ['hidden', 'class'], childList: true, characterData: true, subtree: true });
  }

  private queue(): void {
    if (this.queued) return;
    this.queued = true;
    queueMicrotask(() => { this.queued = false; this.refresh(); });
  }

  private sections(): HTMLElement[] {
    return [...this.content.querySelectorAll<HTMLElement>(':scope > section')];
  }

  /** A stacked section's title, when the event was on its heading and not on a control there. */
  private stackedTitle(target: EventTarget | null): HTMLElement | null {
    const el = target as Element | null;
    const h2 = el?.closest?.<HTMLElement>('section.ss-stacked > h2');
    if (!h2 || !this.content.contains(h2) || el!.closest('button, input, select, label, a')) return null;
    return h2.querySelector<HTMLElement>('.ss-title');
  }

  /** A heading's title as its own element (headings are written as plain text, and rewritten at times). */
  private titleOf(sec: HTMLElement): HTMLElement | null {
    const h2 = sec.querySelector<HTMLElement>(':scope > h2');
    if (!h2) return null;
    let t = h2.querySelector<HTMLElement>(':scope > .ss-title');
    if (t) return t;
    const first = h2.firstChild;
    if (first?.nodeType === Node.TEXT_NODE && first.textContent?.trim()) {
      t = document.createElement('span');
      t.textContent = first.textContent.trim();
      first.replaceWith(t, document.createTextNode(' '));
    } else if (first instanceof HTMLElement && first.tagName === 'SPAN' && !first.className) t = first;
    else return null;
    t.classList.add('ss-title');
    return t;
  }

  /** Lay the sections out again: the tabs, the open one, the stacked ones. Safe to call at any time. */
  refresh(): void {
    this.observer?.disconnect();
    try { this.layOut(); } finally {
      this.observer?.takeRecords();
      this.watch();
    }
    this.fit();
  }

  private layOut(): void {
    const mode = this.hooks.mode();
    let layout = this.hooks.get(mode);
    const secs = this.sections();
    for (const s of secs) s.classList.remove('ss-off');
    const shown = secs.filter((s) => !s.hidden && getComputedStyle(s).display !== 'none');
    const visible = shown.map((s) => s.id);
    // a section that has just appeared (the Animation pane opened, Comments shown) is the one wanted
    if (mode === this.seenMode) {
      const fresh = visible.filter((id) => !this.seen.has(id) && !layout.stacked?.includes(id));
      if (fresh.length && layout.active !== fresh[fresh.length - 1]) {
        layout = { ...layout, active: fresh[fresh.length - 1] };
        this.hooks.set(mode, layout);
      }
    }
    this.seenMode = mode;
    this.seen = new Set(visible);

    const { tabs, stacked, active } = arrange(layout, visible);
    const byId = new Map(secs.map((s) => [s.id, s]));
    for (const s of secs) {
      const title = this.titleOf(s);
      const isStacked = stacked.includes(s.id);
      const isTab = tabs.includes(s.id);
      const folded = isStacked && !!layout.folded?.includes(s.id);
      s.classList.toggle('ss-off', isTab && s.id !== active);
      s.classList.toggle('ss-tabbed', isTab);
      s.classList.toggle('ss-stacked', isStacked);
      const opening = s.classList.contains('ss-folded') && !folded;
      s.classList.toggle('ss-folded', folded);
      // a section unfolded: its contents fade in
      if (opening) for (const c of s.children) if (c.tagName !== 'H2') enter(c, 'fade');
      const h2 = s.querySelector<HTMLElement>(':scope > h2');
      // a tab's heading keeps a row only for controls of its own (Show on Drawing, Customize)
      h2?.classList.toggle('ss-plain', isTab && ![...h2.children].some((c) => !c.matches(HEADING_EXTRAS)));
      if (title) {
        if (isStacked) {
          title.setAttribute('role', 'button');
          title.tabIndex = 0;
          title.setAttribute('aria-expanded', String(!folded));
          title.title = `${folded ? 'Expand' : 'Collapse'} (drag to reorder, or up to the tabs)`;
        } else {
          title.removeAttribute('role'); title.removeAttribute('tabindex'); title.removeAttribute('aria-expanded'); title.removeAttribute('title');
        }
      }
    }
    // the open tab first, then the stacked sections in their order (moved only when out of place)
    const want = [...(active ? [active] : []), ...stacked].map((id) => byId.get(id)!);
    const have = this.sections().filter((s) => want.includes(s));
    if (want.some((s, i) => have[i] !== s)) for (const s of want) this.content.append(s);

    this.fillTabs(tabs, active, byId);
    // nothing to show under the header: the panel is its header row alone
    const body = !!want.length && want.some((s) => !(s.classList.contains('empty') && s.classList.contains('ss-tabbed')));
    this.content.closest('.toolbox')?.classList.toggle('ss-bare', !body);
  }

  private fillTabs(tabs: string[], active: string | null, byId: Map<string, HTMLElement>): void {
    const facts = tabs.map((id) => {
      const sec = byId.get(id)!;
      const closer = id === active ? sec.querySelector<HTMLElement>(':scope > h2 > .an-close') : null;
      return {
        id,
        name: this.titleOf(sec)?.textContent?.trim() || id,
        of: id === active ? titleCase((sec.querySelector(`:scope > h2 > :is(${SUBTITLE})`)?.textContent ?? '').replace(/^\s*[–-]\s*/, '').trim()) : '',
        count: sec.querySelector(':scope > h2 > .count')?.textContent?.trim() ?? '',
        close: closer ? closer.title || 'Close' : '',
        // the heading's "i" has no row of its own under the tabs: its text is the tab's tip
        tip: sec.querySelector<HTMLElement>(':scope > h2 > .info-icon')?.dataset.tip ?? '',
      };
    });
    // built again only when something changed: rebuilding takes the keyboard focus off a tab
    const key = JSON.stringify([active, facts]);
    if (key === this.tabsKey) return;
    this.tabsKey = key;
    const focused = this.tabs.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.sec : undefined;
    const parts: HTMLElement[] = [];
    for (const { id, name, of, count, close, tip } of facts) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ss-tab';
      b.dataset.sec = id;
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(id === active));
      b.setAttribute('aria-controls', id);
      b.tabIndex = id === active ? 0 : -1;
      b.title = `${name}${of ? `: ${of}` : ''}${tip ? `\n${tip}` : ''}`;
      const n = document.createElement('span');
      n.className = 'ss-name';
      n.textContent = name;
      b.append(n);
      if (of) {
        const o = document.createElement('span');
        o.className = 'ss-of';
        o.textContent = `: ${of}`;
        b.append(o);
      }
      if (count) {
        const c = document.createElement('span');
        c.className = 'count';
        c.textContent = count;
        b.append(c);
      }
      parts.push(b);
      // a pane with its own × (Animation, Comments) keeps it on its open tab
      if (close) {
        const x = document.createElement('button');
        x.type = 'button';
        x.className = 'ss-tab-x';
        x.dataset.sec = id;
        x.textContent = '×';
        x.title = close;
        x.setAttribute('aria-label', close);
        parts.push(x);
      }
    }
    this.tabs.classList.toggle('single', tabs.length === 1);
    this.tabs.replaceChildren(...parts);
    if (focused) this.tabs.querySelector<HTMLElement>(`.ss-tab[data-sec="${focused}"]`)?.focus();
  }

  /**
   * Keep the tabs to one row: the open tab's selection text is cut first (an ellipsis), then tabs
   * with no room go behind the » button, last ones first.
   */
  private fit(): void {
    const width = this.tabs.clientWidth;
    const key = `${width}|${this.tabsKey}`;
    if (key === this.fitKey) return;
    const all = [...this.tabs.querySelectorAll<HTMLElement>('.ss-tab')];
    for (const t of all) t.hidden = false;
    this.tabs.classList.remove('ss-tight');
    this.hiddenTabs = [];
    const over = () => this.tabs.scrollWidth > this.tabs.clientWidth + 1;
    this.more.hidden = true;
    if (width > 0 && over()) {
      this.tabs.classList.add('ss-tight');
      if (over()) {
        // (the » button takes room of its own, so it is placed before the tabs are counted)
        this.more.hidden = false;
        for (let i = all.length - 1; i >= 0 && over(); i--) {
          if (all[i].getAttribute('aria-selected') === 'true') continue;
          all[i].hidden = true;
          this.hiddenTabs.unshift(all[i].dataset.sec!);
        }
        this.more.hidden = !this.hiddenTabs.length;
      }
    }
    this.fitKey = `${this.tabs.clientWidth}|${this.tabsKey}`;
  }

  private nameOf(id: string): string {
    const sec = this.content.querySelector<HTMLElement>(`:scope > #${CSS.escape(id)}`);
    return (sec && this.titleOf(sec)?.textContent?.trim()) || id;
  }

  private moreMenu(): void {
    const r = this.more.getBoundingClientRect();
    showContextMenu(r.left, r.bottom + 2, this.hiddenTabs.map((id) => ({ label: this.nameOf(id), run: () => this.activate(id) })), { run: () => undefined });
  }

  private change(f: (l: SideLayout) => SideLayout): void {
    const mode = this.hooks.mode();
    this.hooks.set(mode, f(this.hooks.get(mode)));
    this.refresh();
  }

  private activate(id: string): void {
    this.change((l) => ({ ...l, active: id }));
  }

  private fold(id: string): void {
    this.change((l) => withFolded(l, id, !l.folded?.includes(id)));
  }

  /** Close a pane by its own × (the Animation and Comments panes have one). */
  private close(id: string): void {
    this.content.querySelector<HTMLElement>(`:scope > #${CSS.escape(id)} > h2 > .an-close`)?.click();
  }

  /** Right-click a tab or a stacked heading: the same moves as dragging, for the keyboard too. */
  private menu(id: string, x: number, y: number): void {
    const mode = this.hooks.mode();
    const layout = this.hooks.get(mode);
    const { tabs, stacked } = arrange(layout, this.sections().filter((s) => s.classList.contains('ss-tabbed') || s.classList.contains('ss-stacked')).map((s) => s.id));
    const isStacked = stacked.includes(id);
    const group = isStacked ? stacked : tabs;
    const at = group.indexOf(id);
    const zone = isStacked ? 'stack' : 'tabs';
    const closable = !!this.content.querySelector(`:scope > #${CSS.escape(id)} > h2 > .an-close`);
    const items: MenuItem[] = [
      isStacked
        ? { label: 'Show as Tab', run: () => this.change((l) => withMoved(l, id, 'tabs', null)) }
        : { label: 'Stack Below', run: () => this.change((l) => withMoved(l, id, 'stack', null)) },
      ...(isStacked ? [{ label: layout.folded?.includes(id) ? 'Expand' : 'Collapse', run: () => this.fold(id) }] : []),
      null,
      { label: isStacked ? 'Move Up' : 'Move Left', disabled: at <= 0, run: () => this.change((l) => withMoved(l, id, zone, group[at - 1])) },
      { label: isStacked ? 'Move Down' : 'Move Right', disabled: at < 0 || at >= group.length - 1, run: () => this.change((l) => withMoved(l, id, zone, group[at + 2] ?? null)) },
      ...(closable ? [null, { label: 'Close', run: () => this.close(id) }] : []),
    ];
    showContextMenu(x, y, items, { run: () => undefined });
  }

  /** Where a dragged section would land at (x, y), and the line to show there. */
  private target(id: string, x: number, y: number): { zone: 'tabs' | 'stack'; before: string | null; line: { left: number; top: number; width: number; height: number } } | null {
    const box = this.content.closest<HTMLElement>('.toolbox') ?? this.content;
    const frame = box.getBoundingClientRect();
    if (x < frame.left - 24 || x > frame.right + 24 || y < frame.top - 16 || y > frame.bottom + 60) return null;
    const row = (this.tabs.parentElement ?? this.tabs).getBoundingClientRect();
    if (y <= row.bottom + 3) {
      const tabs = [...this.tabs.querySelectorAll<HTMLElement>('.ss-tab:not([hidden])')].filter((t) => t.dataset.sec !== id);
      const next = tabs.find((t) => { const r = t.getBoundingClientRect(); return x < r.left + r.width / 2; });
      const last = tabs[tabs.length - 1]?.getBoundingClientRect();
      const left = next ? next.getBoundingClientRect().left - 1 : last ? last.right + 1 : this.tabs.getBoundingClientRect().left;
      return { zone: 'tabs', before: next?.dataset.sec ?? null, line: { left, top: row.top + 2, width: 2, height: row.height - 4 } };
    }
    const stacked = this.sections().filter((s) => s.classList.contains('ss-stacked') && s.id !== id);
    const next = stacked.find((s) => { const r = s.getBoundingClientRect(); return y < r.top + r.height / 2; });
    const last = stacked[stacked.length - 1]?.getBoundingClientRect();
    const inner = this.content.getBoundingClientRect();
    const top = next ? next.getBoundingClientRect().top - 1 : last ? last.bottom + 2 : Math.max(row.bottom + 4, frame.bottom - 4);
    return { zone: 'stack', before: next?.id ?? null, line: { left: (inner.width ? inner : frame).left, top, width: (inner.width ? inner : frame).width, height: 2 } };
  }

  /** Follow the pointer from a tab or a stacked heading: past a few pixels it is a drag. */
  private watchDrag(id: string, down: PointerEvent): void {
    const from = { x: down.clientX, y: down.clientY };
    let ghost: HTMLElement | null = null;
    let line: HTMLElement | null = null;
    let to: ReturnType<SideSections['target']> = null;
    const move = (e: PointerEvent) => {
      if (!ghost) {
        if (Math.hypot(e.clientX - from.x, e.clientY - from.y) < DRAG_START) return;
        ghost = document.createElement('div');
        ghost.className = 'ss-ghost';
        ghost.textContent = this.nameOf(id);
        line = document.createElement('div');
        line.className = 'ss-drop';
        document.body.append(ghost, line);
        document.body.classList.add('ss-dragging');
      }
      e.preventDefault();
      ghost.style.left = `${e.clientX + 8}px`;
      ghost.style.top = `${e.clientY + 6}px`;
      to = this.target(id, e.clientX, e.clientY);
      line!.hidden = !to;
      if (to) Object.assign(line!.style, { left: `${to.line.left}px`, top: `${to.line.top}px`, width: `${to.line.width}px`, height: `${to.line.height}px` });
    };
    const end = (drop: boolean) => {
      removeEventListener('pointermove', move, true);
      removeEventListener('pointerup', up, true);
      removeEventListener('pointercancel', cancel, true);
      removeEventListener('keydown', key, true);
      if (!ghost) return;
      ghost.remove(); line?.remove();
      document.body.classList.remove('ss-dragging');
      // the click that ends the drag is not a click on the tab
      this.dragged = true;
      setTimeout(() => { this.dragged = false; }, 0);
      const t = to;
      if (drop && t) this.change((l) => withMoved(l, id, t.zone, t.before));
    };
    const up = () => end(true);
    const cancel = () => end(false);
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); end(false); } };
    addEventListener('pointermove', move, true);
    addEventListener('pointerup', up, true);
    addEventListener('pointercancel', cancel, true);
    addEventListener('keydown', key, true);
  }
}
