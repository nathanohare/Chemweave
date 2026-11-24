// The tooltip on a compound's ID in SI text (a mention, @{c-…}): when the mouse rests on it, the
// compound's structure, with its ID and name above, in the look of the group tooltips (.label-tip).
// A compound without a structure says so ("No structure", or "Loading structure…" while it is
// read). Mentions of tables, figures and schemes have none.

import { MENTION } from '../si/markup';

/** How long the mouse rests on an ID before the tooltip shows (ms), as for the group tooltips. */
const DELAY = 450;
/** The largest the structure is shown (px): a big one is made smaller to fit. */
const MAX_W = 300, MAX_H = 220;

export interface MentionInfo {
  /** The ID as it shows ("2b"). */
  label: string;
  /** The compound's name ('' when it has none). */
  name: string;
  /** Its structure as SVG markup (sized in points, with a viewBox), or null when it has none. */
  svg: string | null;
  /** Shown, muted, where there is no structure ("No structure", "Loading structure…"). */
  note?: string;
}

export class MentionTip {
  readonly el: HTMLDivElement;
  private timer = 0;
  private over: HTMLElement | null = null;

  /**
   * @param root where the mentions are (the SI page): the mouse is watched there.
   * @param info what to show for a compound (by its id); null shows nothing.
   */
  constructor(root: HTMLElement, private info: (id: string) => MentionInfo | null) {
    this.el = document.createElement('div');
    this.el.className = 'label-tip si-mention-tip';
    this.el.hidden = true;
    this.el.setAttribute('role', 'tooltip');
    document.body.append(this.el);
    root.addEventListener('mouseover', (e) => {
      // (not while text is being selected with the mouse)
      if (e.buttons) { this.hide(); return; }
      const chip = (e.target as Element | null)?.closest?.<HTMLElement>('.si-mention[data-ref]') ?? null;
      if (chip === this.over) return;
      this.hide();
      if (!chip || !chip.dataset.ref!.startsWith(MENTION)) return;
      this.over = chip;
      this.timer = window.setTimeout(() => this.show(chip), DELAY);
    });
    root.addEventListener('mouseout', (e) => {
      if (!this.over) return;
      if (!this.over.isConnected) { this.hide(); return; }
      const to = e.relatedTarget as Node | null;
      if (to && this.over.contains(to)) return;
      this.hide();
    });
    // typing, clicking or scrolling puts it away (it would sit over what moved)
    for (const ev of ['mousedown', 'keydown', 'wheel'] as const) root.addEventListener(ev, () => this.hide(), { capture: true, passive: true });
    root.addEventListener('scroll', () => this.hide(), { capture: true, passive: true });
  }

  hide(): void {
    window.clearTimeout(this.timer);
    this.over = null;
    this.el.hidden = true;
  }

  private show(chip: HTMLElement): void {
    if (this.over !== chip || !chip.isConnected) return;
    const got = this.info(chip.dataset.ref!.slice(MENTION.length));
    if (!got) return;
    this.el.replaceChildren();
    const head = document.createElement('div');
    head.className = 'label-tip-head';
    const b = document.createElement('b');
    b.textContent = got.label;
    head.append(b);
    if (got.name) head.append(document.createTextNode(` ${got.name}`));
    this.el.append(head);
    if (got.svg) {
      const pic = document.createElement('div');
      pic.className = 'si-mention-tip-pic';
      pic.innerHTML = got.svg;
      const svg = pic.querySelector('svg');
      if (svg) {
        // points to pixels, made smaller to fit when the structure is big
        const pt = (a: string): number => { const v = parseFloat(svg.getAttribute(a) ?? ''); return v > 0 ? (v * 4) / 3 : 0; };
        const w = pt('width'), h = pt('height');
        if (w && h) {
          const k = Math.min(1, MAX_W / w, MAX_H / h);
          svg.setAttribute('width', `${Math.round(w * k)}`);
          svg.setAttribute('height', `${Math.round(h * k)}`);
        }
        this.el.append(pic);
      }
    } else if (got.note) {
      const n = document.createElement('div');
      n.className = 'label-tip-formula';
      n.textContent = got.note;
      this.el.append(n);
    }
    this.el.hidden = false;
    // below the ID, kept inside the window (above it when there is no room below)
    const c = chip.getBoundingClientRect(), r = this.el.getBoundingClientRect();
    let x = c.left, y = c.bottom + 6;
    if (x + r.width > window.innerWidth - 4) x = Math.max(4, window.innerWidth - 4 - r.width);
    if (y + r.height > window.innerHeight - 4) y = Math.max(4, c.top - r.height - 6);
    this.el.style.left = `${x}px`;
    this.el.style.top = `${y}px`;
  }
}
