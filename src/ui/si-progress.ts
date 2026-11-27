// The small window shown while an SI project is compiled (Compile, Compile to PDF): what is
// being done, how far along it is and Cancel (Nate's SI report 2026-11-23, item 11: a large
// SI takes a while, and without it the program looks frozen). Editing meanwhile could mix old
// and new data into the result, so the window is modal.

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

/** Cancel was pressed: what was being done stops. */
export class CompileCancelled extends Error {
  constructor() { super('Cancelled'); }
}

export interface CompileProgress {
  /** Step `n` (from 1) of the steps given: its name shows, and the bar starts again. */
  step(n: number): void;
  /**
   * How far along the step is (`total` 0: no count, the bar moves on its own), and what is being
   * done. The window is painted at most every 0.1 s; throws CompileCancelled once Cancel is pressed.
   */
  at(done: number, total: number, text?: string): Promise<void>;
  /** Hidden while another window shows (the Save As window), and shown again after. */
  hide(): void;
  show(): void;
  /** Whether Cancel stops what is being done now (not while the pages are laid out: that can't be stopped part way). */
  canCancel(on: boolean): void;
  readonly cancelled: boolean;
  close(): void;
}

/**
 * Wait for the window to be painted (the work goes on after). A window that is hidden (minimized,
 * or another tab) paints nothing and its frames never come, so a short timer ends the wait as well.
 */
const painted = (): Promise<void> => new Promise((r) => {
  // (a hidden window is not waited for at all: its timers are slowed to about a second)
  if (document.hidden) { r(); return; }
  const t = setTimeout(r, 50);
  requestAnimationFrame(() => setTimeout(() => { clearTimeout(t); r(); }, 0));
});

export function compileProgress(title: string, steps: string[]): CompileProgress {
  const d = el('dialog', 'ask si-progress');
  // (work in progress: a click outside the window doesn't mean Cancel)
  d.dataset.outsideClick = 'keep';
  d.setAttribute('aria-label', title);
  const text = el('p', 'si-progress-text', steps[0] ?? '');
  text.setAttribute('role', 'status');
  const bar = el('div', 'si-progress-bar');
  const fill = el('span');
  bar.append(fill);
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', '100');
  const sub = el('div', 'si-progress-sub');
  const stepText = el('span', '', '');
  const pct = el('span', '', '');
  sub.append(stepText, pct);
  const buttons = el('p', 'ask-buttons');
  const cancel = el('button', '', 'Cancel');
  cancel.type = 'button';
  buttons.append(cancel);
  d.append(el('h2', '', title), text, bar, sub, buttons);
  let cancelled = false, allowed = true, open = false, step = 1, last = 0;
  const stop = (): void => { if (!allowed || cancelled) return; cancelled = true; cancel.disabled = true; text.textContent = 'Stopping…'; };
  cancel.addEventListener('click', stop);
  d.addEventListener('cancel', (e) => { e.preventDefault(); stop(); });     // (Esc: the same as Cancel)
  const show = (): void => { if (open) return; open = true; document.body.append(d); try { d.showModal(); } catch { /* (no modal windows here) */ } };
  const hide = (): void => { if (!open) return; open = false; try { d.close(); } catch { /* */ } d.remove(); };
  const paintStep = (): void => { stepText.textContent = steps.length > 1 ? `Step ${step} of ${steps.length}` : ''; };
  const set = (done: number, total: number, t?: string): void => {
    if (!cancelled && t !== undefined) text.textContent = t;
    const known = total > 0;
    bar.classList.toggle('busy', !known);
    const p = known ? Math.max(0, Math.min(100, Math.floor((100 * done) / total))) : 0;
    // (drawn by scale, not width, so moving it never lays the window out again: S93)
    fill.style.setProperty('--done', known ? String(p / 100) : '0');
    pct.textContent = known ? `${p}%` : '';
    if (known) bar.setAttribute('aria-valuenow', String(p)); else bar.removeAttribute('aria-valuenow');
  };
  paintStep();
  set(0, 0);
  show();
  return {
    step(n) { step = n; paintStep(); set(0, 0, steps[n - 1] ?? ''); last = 0; },
    async at(done, total, t) {
      if (cancelled) throw new CompileCancelled();
      set(done, total, t);
      // (painted now and then: waiting for every compound would make a large SI slower)
      const now = performance.now();
      if (now - last > 100) { last = now; await painted(); }
      if (cancelled) throw new CompileCancelled();
    },
    hide, show,
    canCancel(on) { allowed = on; cancel.disabled = !on || cancelled; },
    get cancelled() { return cancelled; },
    close: hide,
  };
}
