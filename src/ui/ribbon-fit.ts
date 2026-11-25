// Ribbons in a narrow window, as Office does it: when the groups don't fit, galleries (Styles)
// show fewer choices first, then the groups at the right end drop their buttons' words (icons
// only, the words stay in the tooltips), and if that is not enough they fold into one button
// each, with the group's picture and name, that drops the group's buttons down below it. Only as
// many groups fold as need to: any that fit again afterwards open back up.
//
// A ribbon keeps one height whichever of its tabs is open (the height of its tallest tab), and
// can be collapsed to its row of tabs (Ctrl+F1, a double-click on a tab, or the ▴ at the end of
// the tabs): then a click on a tab drops that tab's buttons over the work until they're used.

import { GROUP_ICONS } from './icon-picks';

/** The rows of groups: a tabbed ribbon's panels, or a plain ribbon itself. */
function rows(): HTMLElement[] {
  const out = new Set<HTMLElement>();
  for (const g of document.querySelectorAll<HTMLElement>('.ribbon .rb-group')) if (g.parentElement) out.add(g.parentElement);
  return [...out];
}

const groupsOf = (row: HTMLElement) => [...row.children].filter((c): c is HTMLElement => c instanceof HTMLElement && c.classList.contains('rb-group'));

/** The picture on a folded group whose buttons have none of their own (Editing: Find, Replace). */
const GENERIC_GROUP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><rect x="3.5" y="4.5" width="7" height="6" rx="1"/><rect x="13.5" y="4.5" width="7" height="6" rx="1"/><path d="M4 15h16M4 19h11"/></svg>';

/** A folded group's button, made the first time the group folds. */
function foldButton(g: HTMLElement): HTMLButtonElement {
  let b = g.querySelector<HTMLButtonElement>(':scope > .rb-fold-btn');
  if (b) return b;
  b = document.createElement('button');
  b.type = 'button';
  b.className = 'rb-fold-btn';
  const name = g.querySelector('.rb-label')?.textContent?.trim() || 'More';
  // the group's first picture over its name, like a big button, so a folded group is never a bare word
  const pic = g.querySelector('.rb-icon, button svg');
  // a group picked a picture of its own on the icon redesign pages (icon-picks.ts) shows that one
  const own = GROUP_ICONS[name];
  const icon = `<span class="rb-icon">${own ? `<svg class="ci-ic" viewBox="0 0 24 24" aria-hidden="true">${own}</svg>` : !pic ? GENERIC_GROUP : pic.classList.contains('rb-icon') ? pic.innerHTML : pic.outerHTML}</span>`;
  // (the name shows under the group, as every group's does; the button itself shows it only where
  // groups have no names under them, the Canvas's Simplified ribbon)
  b.innerHTML = `${icon}<span class="rb-fold-name"><span class="rb-fold-text">${name.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)} </span><span aria-hidden="true">▾</span></span>`;
  b.title = `${name}: show this group's buttons`;
  b.setAttribute('aria-label', name);
  b.setAttribute('aria-expanded', 'false');
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = !g.classList.contains('rb-popped');
    closePopped();
    if (!open) return;
    const r = b!.getBoundingClientRect();
    g.style.setProperty('--pop-x', `${Math.max(4, r.left)}px`);
    g.style.setProperty('--pop-y', `${r.bottom + 2}px`);
    g.classList.add('rb-popped');
    b!.setAttribute('aria-expanded', 'true');
    // kept inside the window
    const box = g.querySelector<HTMLElement>(':scope > .rb-row')?.getBoundingClientRect();
    if (box && box.right > innerWidth - 4) g.style.setProperty('--pop-x', `${Math.max(4, innerWidth - 4 - box.width)}px`);
  });
  g.prepend(b);
  return b;
}

function closePopped(): void {
  for (const g of document.querySelectorAll<HTMLElement>('.rb-group.rb-popped')) {
    g.classList.remove('rb-popped');
    g.querySelector(':scope > .rb-fold-btn')?.setAttribute('aria-expanded', 'false');
  }
}

// (strictly: a row one pixel too wide already shows a scroll bar)
const overflows = (row: HTMLElement) => row.scrollWidth > row.clientWidth;

/** A gallery's choices that can be left out when room is short (all but the first three and More). */
const galleryExtras = (row: HTMLElement) =>
  [...row.querySelectorAll<HTMLElement>('.rb-styles')].flatMap((gal) => [...gal.querySelectorAll<HTMLElement>(':scope > .rb-style:not(.rb-styles-more)')].slice(3));

/** A group of large buttons only (Insert's Tables, Images): it can step down to small buttons with their words, three to a column. */
const canShrink = (g: HTMLElement) => {
  const row = g.querySelector<HTMLElement>(':scope > .rb-row');
  if (!row) return false;
  const kids = [...row.children].filter((c) => !(c as HTMLElement).hidden);
  const big = (c: Element) => c.matches('button.rb-big:not(.rb-keep-big), .rb-fly:has(> button.rb-big)');
  if (kids.length >= 2 && kids.every(big)) return true;
  // large buttons beside a column of plain small ones (Insert Caption beside Table of Figures and
  // Cross-reference): the large ones join the column as small buttons with their words, rather
  // than staying large and losing them (UI audit U16)
  const plainCol = (c: Element) => c.matches('.rb-col') && [...c.children].every((x) => x.matches('button:not(.rb-big)'));
  // (a split button keeps its arrow under it and is too tall for a row of three)
  if (kids.some((c) => c.matches('.rb-split'))) return false;
  return kids.length >= 2 && kids.some(big) && kids.some(plainCol) && kids.every((c) => big(c) || plainCol(c));
};

/** The Canvas ribbon's tabs that show names when they all fit. */
const ROOMY = '.canvas-ribbon.cr-classic > .rb-panel:not([data-cr-panel="home"])';

/**
 * Fit one row of groups to its width, as Office does: fewer gallery choices; then the Format
 * Favorites gallery folds; then, from the right, large buttons become small ones with their words;
 * then words off (icons only); then groups folded into one button each; the first group (Clipboard)
 * last of all; and last, the folded groups' names (pictures only).
 */
export function fitRow(row: HTMLElement): void {
  if (!row.clientWidth) return;
  const groups = groupsOf(row);
  row.classList.remove('rb-squeeze');
  for (const g of groups) g.classList.remove('rb-small', 'rb-compact', 'rb-folded', 'rb-popped', 'rb-bare');
  // the Canvas's tabs other than Home (Classic look): each button's name beside its picture where
  // the tab has room, pictures only where it has not (UI audit U10)
  // (group by group from the left, so a full tab still names what it can)
  for (const g of groups) g.classList.remove('cr-roomy');
  if (row.matches(ROOMY)) {
    for (const g of groups) {
      g.classList.add('cr-roomy');
      if (overflows(row)) g.classList.remove('cr-roomy');
    }
  }
  const fold = (g: HTMLElement) => { foldButton(g); g.classList.add('rb-folded'); };
  // a group with nothing in it yet (Format Favorites before the first is saved) is only its button
  for (const g of groups) if (g.classList.contains('rb-fold-always')) fold(g);
  const extras = galleryExtras(row);
  for (const x of extras) x.classList.remove('rb-gal-out');
  if (!overflows(row)) return;
  for (let i = extras.length - 1; i >= 0 && overflows(row); i--) extras[i].classList.add('rb-gal-out');
  if (!overflows(row)) return;
  // then the groups that go first (Format Favorites), before any other group gives up anything
  const first = groups.filter((g) => g.classList.contains('rb-fold-first'));
  for (let i = first.length - 1; i >= 0 && overflows(row); i--) fold(first[i]);
  if (!overflows(row)) return;
  for (let i = groups.length - 1; i >= 0 && overflows(row); i--) if (canShrink(groups[i])) groups[i].classList.add('rb-small');
  if (!overflows(row)) return;
  // the first group (Clipboard, usually) keeps its place and its words longest: Cut, Copy and Format
  // Painter keep their names, in every mode, until every other group has given up its words and folded
  for (let i = groups.length - 1; i >= 1 && overflows(row); i--) groups[i].classList.add('rb-compact');
  for (let i = groups.length - 1; i >= 1 && overflows(row); i--) fold(groups[i]);
  if (overflows(row)) groups[0]?.classList.add('rb-compact');
  // folding a wide group (Styles) can make room for a narrow one folded before it: open those back up
  // (the groups that fold first open last; one with nothing in it stays folded)
  const reopen = groups.slice(1).reverse();
  const lastOf = (x: HTMLElement) => (x.classList.contains('rb-fold-first') ? 2 : x.classList.contains('rb-open-last') ? 1 : 0);
  for (const g of [0, 1, 2].flatMap((k) => reopen.filter((x) => lastOf(x) === k))) {
    if (!g.classList.contains('rb-folded') || g.classList.contains('rb-fold-always')) continue;
    // a group that opens last (the Canvas's Look Up) stays folded while any other is: a narrow
    // window never trades Font and Paragraph for it (UI audit U18)
    if (g.classList.contains('rb-open-last') && groups.some((x) => x !== g && x.classList.contains('rb-folded') && !x.classList.contains('rb-fold-always') && !x.classList.contains('rb-fold-first'))) continue;
    g.classList.remove('rb-folded');
    if (overflows(row)) g.classList.add('rb-folded');
  }
  // folding can free more room than it needed: give the words back where they fit, from the left
  for (const g of groups) {
    if (!g.classList.contains('rb-compact') || g.classList.contains('rb-folded')) continue;
    g.classList.remove('rb-compact');
    // (one that doesn't fit stays as it is; the next may still fit)
    if (overflows(row)) g.classList.add('rb-compact');
  }
  // and the large buttons, where they fit
  for (const g of groups) {
    if (!g.classList.contains('rb-small') || g.classList.contains('rb-folded') || g.classList.contains('rb-compact')) continue;
    g.classList.remove('rb-small');
    if (overflows(row)) g.classList.add('rb-small');
  }
  // still too wide (the Simplified ribbon's folded groups keep their names, Font ▾): the names come
  // off too, from the right, so the row never needs a scroll bar
  for (let i = groups.length - 1; i >= 0 && overflows(row); i--) groups[i].classList.add('rb-bare');
  // and what sits at the row's end (the Canvas's Analysis box) gives up width last of all
  if (overflows(row)) row.classList.add('rb-squeeze');
}

/** Give a tabbed ribbon the height of its tallest tab, so it keeps one height whichever tab is open. */
function evenHeights(ribbon: HTMLElement): void {
  const panels = [...ribbon.children].filter((c): c is HTMLElement => c instanceof HTMLElement && c.classList.contains('rb-panel'));
  if (panels.length < 2) return;
  ribbon.style.removeProperty('--rb-panel-h');
  let tallest = 0;
  if (ribbon.matches('.ribbon.tabbed, .doc-ribbon')) {
    // the panels stack in a column, so they can all show at once and be measured in one layout
    // (one at a time made a layout each, ~25 ms as the app starts)
    const was = panels.map((p) => p.hidden);
    for (const p of panels) p.hidden = false;
    for (const p of panels) tallest = Math.max(tallest, p.offsetHeight);
    panels.forEach((p, i) => { p.hidden = was[i]; });
  } else {
    for (const p of panels) {
      const was = p.hidden;
      p.hidden = false;
      tallest = Math.max(tallest, p.offsetHeight);
      p.hidden = was;
    }
  }
  if (tallest) ribbon.style.setProperty('--rb-panel-h', `${tallest}px`);
}

let collapsed = false;
let onCollapse: (on: boolean) => void = () => {};

/** Show the ribbons as their tabs only (true), or whole. */
export function setRibbonCollapsed(on: boolean): void {
  collapsed = on;
  document.body.classList.toggle('ribbon-collapsed', on);
  for (const r of document.querySelectorAll('.ribbon.rb-peek')) r.classList.remove('rb-peek');
  for (const b of document.querySelectorAll<HTMLElement>('.rb-collapse')) paintArrow(b);
  document.querySelector('[data-cmd="collapse-ribbon"]')?.setAttribute('aria-checked', String(on));
  if (!on) fitRibbons();
}
export const ribbonCollapsed = () => collapsed;

/** Paint every ribbon's ▴ (after the ribbon collapses or opens). */
export function repaintArrows(): void {
  for (const b of document.querySelectorAll<HTMLElement>('.rb-collapse')) paintArrow(b);
}

/** The ▴ does the same in every mode, Canvas included: it collapses the ribbon to its tabs (G5-36, S17). */
function paintArrow(b: HTMLElement): void {
  b.textContent = collapsed ? '▾' : '▴';
  b.title = collapsed ? 'Pin the ribbon open (Ctrl+F1)' : 'Collapse the ribbon to its tabs, for more room (Ctrl+F1). Click a tab to use its buttons';
  b.setAttribute('aria-label', b.title);
}

function toggleCollapsed(): void {
  setRibbonCollapsed(!collapsed);
  onCollapse(collapsed);
}

/** The ▴ button at the right end of each ribbon's row of tabs. */
function addCollapseButtons(): void {
  for (const tabs of document.querySelectorAll<HTMLElement>('.ribbon .rb-tabs')) {
    if (tabs.querySelector(':scope > .rb-collapse')) continue;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'rb-collapse';
    b.addEventListener('click', (e) => { e.stopPropagation(); toggleCollapsed(); });
    tabs.append(b);
    paintArrow(b);
  }
}

let queued = false;
/** Fit every ribbon showing (after a change of window size, mode or ribbon tab). */
export function fitRibbons(): void {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    const showing = [...document.querySelectorAll<HTMLElement>('.ribbon')].filter((r) => r.offsetParent);
    // each ribbon keeps its height while it is fitted and measured, so nothing else on the page
    // moves in the layouts that takes: with every tab's buttons stacked up to be measured, the
    // docks below were squeezed for a moment, took a scroll bar, and the toolbox at the left came
    // back that much wider (the work jumped sideways each time a tab changed)
    const pinned = showing.map(holdHeight);
    for (const row of rows()) if (row.offsetParent) fitRow(row);
    for (const r of showing) evenHeights(r);
    pinned.forEach((release) => release());
    // (what fitting itself changed is no reason to fit again)
    shown?.takeRecords();
  });
}

/** Watches for buttons and groups coming and going inside the ribbons. */
let shown: MutationObserver | null = null;

/** A change that makes a row wider or narrower without changing the window: a group or button shown or hidden. */
const reshaped = (recs: MutationRecord[]) => recs.some((m) => {
  const t = m.target as HTMLElement;
  // (a tab's panel shown or hidden is a change of tab, fitted on its own; setting `hidden` to what it
  // already was, as the canvas slide's Keyframes group is on every slide, changes nothing)
  return t.closest?.('.rb-group') !== null && m.oldValue !== t.getAttribute('hidden');
});

/** Keep a ribbon at the height it has now, its buttons free to be taller or shorter inside it, until the function returned is called. */
function holdHeight(ribbon: HTMLElement): () => void {
  const h = ribbon.offsetHeight;
  ribbon.style.height = `${h}px`;
  ribbon.classList.add('rb-measuring');
  return () => {
    ribbon.style.removeProperty('height');
    ribbon.classList.remove('rb-measuring');
  };
}

/** Keep the ribbons fitted: on resizing, on picking a ribbon tab, and when a ribbon or panel comes into view. */
export function watchRibbons(collapseChanged: (on: boolean) => void = () => {}): void {
  onCollapse = collapseChanged;
  addCollapseButtons();
  setRibbonCollapsed(collapsed);
  const widths = new WeakMap<Element, number>();
  const ro = new ResizeObserver((entries) => {
    // only a change of width matters: folding groups changes the height, which must not start it again
    if (entries.some((e) => widths.get(e.target) !== Math.round(e.contentRect.width))) fitRibbons();
    for (const e of entries) widths.set(e.target, Math.round(e.contentRect.width));
  });
  for (const r of document.querySelectorAll('.ribbon')) ro.observe(r);
  for (const row of rows()) ro.observe(row);
  // a group that shows only some of the time (Keyframes, on a canvas slide) widens the row without
  // changing the window's width: fit again, or the groups at the right end run off the edge
  shown = new MutationObserver((recs) => { if (reshaped(recs)) fitRibbons(); });
  for (const r of document.querySelectorAll('.ribbon')) shown.observe(r, { subtree: true, attributes: true, attributeFilter: ['hidden'], attributeOldValue: true });
  document.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest?.('.rb-tabs')) fitRibbons();
    // collapsed: a tab drops its buttons down; using one (or clicking elsewhere) puts them away
    if (collapsed) {
      const tab = t.closest?.<HTMLElement>('.rb-tabs [role="tab"]');
      const ribbon = t.closest?.<HTMLElement>('.ribbon');
      if (tab && ribbon) {
        for (const r of document.querySelectorAll('.ribbon.rb-peek')) if (r !== ribbon) r.classList.remove('rb-peek');
        ribbon.classList.add('rb-peek');
        fitRibbons();
      } else if (!ribbon || t.closest('.rb-panel button:not(.rb-fold-btn, .rb-fly-btn)')) {
        // (a flyout's button opens its list over the work and keeps the tab down; a command in the list puts both away)
        for (const r of document.querySelectorAll('.ribbon.rb-peek')) r.classList.remove('rb-peek');
      }
    }
    // a click on a dropped-down group's button closes it, as a click anywhere else does; one that
    // opens a menu (Position ▾) keeps it down, so pointing at the next (Rotate ▾) opens that one
    if (!t.closest?.('.rb-fold-btn') && !t.closest?.('.rb-popped input, .rb-popped select, .rb-popped button[aria-haspopup]')) closePopped();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closePopped();
      for (const r of document.querySelectorAll('.ribbon.rb-peek')) r.classList.remove('rb-peek');
    }
    // Ctrl+F1 collapses the ribbon or pins it open again, as in Office
    if (e.key === 'F1' && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) { e.preventDefault(); toggleCollapsed(); }
  });
  document.addEventListener('dblclick', (e) => { if ((e.target as HTMLElement).closest?.('.rb-tabs [role="tab"]')) toggleCollapsed(); });
  window.addEventListener('resize', () => closePopped());
  // a row still wider than the window (with no scroll bar) turns with the mouse wheel
  document.addEventListener('wheel', (e) => {
    const row = (e.target as HTMLElement).closest?.<HTMLElement>('.rb-panel');
    if (!row || !overflows(row) || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    row.scrollLeft += e.deltaY;
    e.preventDefault();
  }, { passive: false });
  fitRibbons();
}
