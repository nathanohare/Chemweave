// The Smart Scheme gallery: what the Smart Scheme button opens. The five layouts first (a blank
// scheme, or the selected structures laid out that way), then the ready-made catalytic cycles as
// small pictures, each placed as a live Smart Scheme to change into your own. It drops down
// under the button that opened it (or sits at the top of the drawing when that button isn't showing).

import { SMART_LAYOUTS, type SmartLayout } from '../chem/smart-scheme';
import { CYCLE_PRESETS, type CyclePreset } from '../chem/cycles';
import { SMART_LAYOUT_ICONS } from './smart-pane';
import { addInfo } from './info-tip';

export type GalleryPick = { layout: SmartLayout } | { cycle: CyclePreset } | { convert: true };

export interface GalleryOptions {
  /** The button it drops down from (null: at the top of the drawing). */
  anchor: HTMLElement | null;
  /** Where the drawing is on the screen (for when there is no button). */
  work: { left: number; top: number; right: number };
  /** A ready-made cycle as an SVG picture in the drawing's style (null when it can't be drawn). */
  preview(p: CyclePreset): string | null;
  /** How many structures are selected: two or more become the scheme's species. */
  selected: number;
  /** A scheme drawn by hand is selected, to make into a Smart Scheme. */
  canConvert: boolean;
  /** Changes when the drawing's style does (the pictures are kept per style). */
  styleKey: string;
}

let close: (() => void) | null = null;

/** Close the gallery if it is open. */
export function closeSmartGallery(): void { close?.(); }

/** The pictures drawn so far, by style and cycle. */
const drawn = new Map<string, string>();

const section = (text: string): HTMLDivElement => {
  const h = document.createElement('div');
  h.className = 'sg-head';
  const name = document.createElement('span');
  name.textContent = text;
  h.append(name);
  return h;
};

/** Open the gallery; resolves with what was picked, or null when it was closed. */
export function showSmartGallery(o: GalleryOptions): Promise<GalleryPick | null> {
  close?.();
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'smart-gallery';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Smart Scheme');
    let over = false;
    const done = (v: GalleryPick | null) => {
      if (over) return;
      over = true;
      document.removeEventListener('pointerdown', outside, true);
      removeEventListener('resize', shut);
      el.remove();
      if (close === shut) close = null;
      resolve(v);
    };
    const shut = () => done(null);
    const outside = (e: PointerEvent) => { if (!el.contains(e.target as Node)) done(null); };

    // the layouts
    const some = o.selected >= 2;
    const lay = section('Layout');
    addInfo(lay.firstElementChild, some
      ? `The ${o.selected} selected structures become the species, joined by arrows in reading order.`
      : 'A blank scheme to type or draw into. With two or more structures selected, they become its species.');
    const tiles = document.createElement('div');
    tiles.className = 'sg-layouts';
    for (const l of SMART_LAYOUTS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sg-tile';
      b.title = l.tip;
      b.innerHTML = `<svg viewBox="0 0 27 24" width="36" height="32" aria-hidden="true"><g fill="currentColor" stroke="currentColor" stroke-width="1.2">${SMART_LAYOUT_ICONS[l.id]}</g></svg>`;
      const name = document.createElement('span');
      name.textContent = l.name;
      b.append(name);
      b.addEventListener('click', () => done({ layout: l.id }));
      tiles.append(b);
    }

    // the ready-made cycles
    const ready = section('Ready-Made Cycles');
    addInfo(ready.firstElementChild, some
      ? `Placed as a Smart Scheme for you to change. The ${o.selected} selected structures stand for its first species.`
      : 'Placed as a Smart Scheme for you to change: retype or draw any species, and add or remove species, loops and off-cycle species from its list.');
    const cards = document.createElement('div');
    cards.className = 'sg-cycles';
    const waiting: { p: CyclePreset; host: HTMLElement }[] = [];
    for (const p of CYCLE_PRESETS) {
      if (p.group === 'blank') continue;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sg-card';
      b.title = p.blurb;
      const pic = document.createElement('span');
      pic.className = 'sg-thumb';
      const name = document.createElement('span');
      name.className = 'sg-name';
      name.textContent = p.name;
      b.append(pic, name);
      b.addEventListener('click', () => done({ cycle: p }));
      cards.append(b);
      waiting.push({ p, host: pic });
    }
    el.append(lay, tiles, ready, cards);

    const foot = document.createElement('div');
    foot.className = 'sg-foot';
    const conv = document.createElement('button');
    conv.type = 'button';
    conv.textContent = 'Convert Selection to Smart Scheme';
    conv.title = 'Make the selected scheme (structures and the arrows between them) a Smart Scheme, as it is laid out';
    conv.disabled = !o.canConvert;
    conv.addEventListener('click', () => done({ convert: true }));
    foot.append(conv);
    el.append(foot);

    document.body.append(el);
    const w = el.offsetWidth, h = el.offsetHeight;
    const a = o.anchor?.getBoundingClientRect();
    const left = a ? a.left - 6 : (o.work.left + o.work.right - w) / 2;
    const top = a ? a.bottom + 3 : o.work.top + 8;
    el.style.left = `${Math.round(Math.max(8, Math.min(innerWidth - w - 8, left)))}px`;
    el.style.top = `${Math.round(Math.max(8, Math.min(innerHeight - Math.min(h, innerHeight - 16) - 8, top)))}px`;
    el.style.maxHeight = `${Math.round(innerHeight - Math.max(8, top) - 8)}px`;

    // the pictures, one at a time so the gallery is there at once
    const show = (host: HTMLElement, url: string) => {
      const img = new Image();
      img.alt = '';
      img.draggable = false;
      img.src = url;
      host.replaceChildren(img);
    };
    const next = () => {
      if (over) return;
      const it = waiting.shift();
      if (!it) return;
      const key = `${o.styleKey}|${it.p.id}`;
      let url = drawn.get(key);
      if (url === undefined) {
        let svg: string | null = null;
        try { svg = o.preview(it.p); } catch { svg = null; }
        url = svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : '';
        drawn.set(key, url);
      }
      if (url) show(it.host, url);
      setTimeout(next, 0);
    };
    // (those drawn before show straight away)
    for (let i = waiting.length - 1; i >= 0; i--) {
      const url = drawn.get(`${o.styleKey}|${waiting[i].p.id}`);
      if (url === undefined) continue;
      if (url) show(waiting[i].host, url);
      waiting.splice(i, 1);
    }
    setTimeout(next, 0);

    // arrow keys move between the tiles and cards (up and down to the nearest one in the next row)
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); o.anchor?.focus(); return; }
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
      const all = [...el.querySelectorAll<HTMLButtonElement>('button.sg-tile, button.sg-card, .sg-foot button:not(:disabled)')];
      const at = all.indexOf(document.activeElement as HTMLButtonElement);
      if (at < 0) return;
      e.preventDefault();
      let to = at;
      if (e.key === 'ArrowLeft') to = Math.max(0, at - 1);
      else if (e.key === 'ArrowRight') to = Math.min(all.length - 1, at + 1);
      else if (e.key === 'Home') to = 0;
      else if (e.key === 'End') to = all.length - 1;
      else {
        const r = all[at].getBoundingClientRect(), x = r.left + r.width / 2, down = e.key === 'ArrowDown';
        let best = Infinity;
        all.forEach((b, i) => {
          const q = b.getBoundingClientRect();
          const dy = down ? q.top - r.bottom : r.top - q.bottom;
          if (dy < -1) return;
          const d = dy * 4 + Math.abs(q.left + q.width / 2 - x);
          if (i !== at && d < best) { best = d; to = i; }
        });
      }
      all[to].focus();
    });
    setTimeout(() => { if (!over) { document.addEventListener('pointerdown', outside, true); addEventListener('resize', shut); } }, 0);
    close = shut;
    el.querySelector<HTMLButtonElement>('button.sg-tile')?.focus();
  });
}
