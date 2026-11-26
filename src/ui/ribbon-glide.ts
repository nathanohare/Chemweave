// The selected ribbon tab's shape glides to the tab clicked (Chemweave Motion Choices, 2026-11-26).
//
// Every ribbon (Canvas, Document, Spreadsheet, Slides, Design, SI) marks its selected tab with
// aria-selected in its .rb-tablist, so one watcher serves them all: when the selection moves within
// a list, a copy of the selected tab's shape (.rb-glide) is laid where the old tab was and moved to
// the new one by transform, while the new tab's own background waits under it. Nothing waits on it:
// the new tab's contents are there at once, and clicking again mid-glide simply starts a new one.

import { EASE_OUT, motionMs } from './motion';

/** Each ribbon tab list's selected tab, as last seen. */
const last = new WeakMap<Element, HTMLElement>();

function glide(row: Element, from: HTMLElement, to: HTMLElement): void {
  const d = motionMs('std');
  if (!d || document.body.classList.contains('ribbon-collapsed')) return;
  const a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
  if (!a.width || !b.width || !to.isConnected) return;
  for (const g of row.querySelectorAll(':scope > .rb-glide')) g.remove();
  for (const t of row.querySelectorAll('.rb-gliding')) t.classList.remove('rb-gliding');
  const g = document.createElement('div');
  g.className = 'rb-glide';
  g.setAttribute('aria-hidden', 'true');
  Object.assign(g.style, { left: `${b.left}px`, top: `${b.top}px`, width: `${b.width}px`, height: `${b.height}px` });
  row.prepend(g);
  to.classList.add('rb-gliding');
  const done = () => { g.remove(); to.classList.remove('rb-gliding'); };
  try {
    const anim = g.animate([
      { transform: `translateX(${a.left - b.left}px) scaleX(${a.width / b.width})`, transformOrigin: '0 0' },
      { transform: 'none', transformOrigin: '0 0' },
    ], { duration: d, easing: EASE_OUT });
    anim.onfinish = anim.oncancel = done;
  } catch { done(); }
}

/** The ribbon tab list a tab belongs to (null for the open-file tabs, which switch at once, S97). */
function listOf(tab: Element): Element | null {
  const list = tab.closest('.rb-tablist');
  return list && list.closest('.rb-tabs') ? list : null;
}

/** Start watching every ribbon's tabs (once, at start-up). */
export function watchRibbonTabs(root: Node = document.body): void {
  if (typeof MutationObserver === 'undefined') return;
  const mo = new MutationObserver((records) => {
    // the tab each list had selected before these changes (also for a list built after start-up)
    const before = new Map<Element, HTMLElement>();
    for (const r of records) {
      const tab = r.target as HTMLElement;
      const list = r.oldValue === 'true' && tab.getAttribute('role') === 'tab' ? listOf(tab) : null;
      if (list && !before.has(list)) before.set(list, tab);
    }
    for (const r of records) {
      const tab = r.target as HTMLElement;
      if (tab.getAttribute('aria-selected') !== 'true' || r.oldValue === 'true' || tab.getAttribute('role') !== 'tab') continue;
      const list = listOf(tab);
      if (!list) continue;
      const from = before.get(list) ?? last.get(list);
      last.set(list, tab);
      if (from && from !== tab && from.isConnected && list.contains(from)) glide(list.closest('.rb-tabs')!, from, tab);
    }
  });
  mo.observe(root, { subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['aria-selected'] });
  for (const t of document.querySelectorAll<HTMLElement>('.rb-tablist [role="tab"][aria-selected="true"]')) {
    const list = listOf(t);
    if (list) last.set(list, t);
  }
}
