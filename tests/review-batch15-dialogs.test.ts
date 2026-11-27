// @vitest-environment jsdom
//
// Review batch 15 (F674, F708, F709, F718): windows keep their explanation behind an "i" by the
// title (UI rule 3), not on a line of its own, and say Rotate, Style and Title Case buttons.
import { describe, it, expect, vi } from 'vitest';

(HTMLDialogElement.prototype as unknown as { showModal: () => void }).showModal = function (this: HTMLDialogElement) { this.open = true; };
(HTMLDialogElement.prototype as unknown as { show: () => void }).show = function (this: HTMLDialogElement) { this.open = true; };
(HTMLDialogElement.prototype as unknown as { close: () => void }).close = function (this: HTMLDialogElement) { this.open = false; this.dispatchEvent(new Event('close')); };
window.requestAnimationFrame = () => 0;
const noop = () => undefined;
const ctx: unknown = new Proxy({}, {
  get: (_t, k) => (k === 'measureText' ? (t: string) => ({ width: t.length * 5, actualBoundingBoxAscent: 7, actualBoundingBoxDescent: 2 })
    : k === 'getTransform' ? () => new DOMMatrix()
    : k === 'createLinearGradient' || k === 'createPattern' || k === 'createRadialGradient' ? () => ({ addColorStop: noop })
    : noop),
  set: () => true,
});
(HTMLCanvasElement.prototype as unknown as { getContext: () => unknown }).getContext = () => ctx;

import { showBalance } from '../src/ui/balance-dialog';
import { askGeomView } from '../src/ui/geom-view-dialog';
import { recoverDialog, versionDialog } from '../src/ui/keep-ui';

const tips = (root: ParentNode) => [...root.querySelectorAll<HTMLElement>('.info-icon')].map((i) => i.dataset.tip);
const lines = (root: ParentNode) => [...root.querySelectorAll<HTMLElement>('p.muted')].filter((p) => !p.hidden).map((p) => p.textContent);

describe('Check Balance (F674)', () => {
  it('keeps its help behind an "i" on the title and the note line for the status only', () => {
    document.body.replaceChildren();
    void showBalance({ starting: [{ formula: 'C2H6O' }], reagents: [], products: [{ formula: 'C2H6O' }], unread: [] });
    const d = document.querySelector<HTMLElement>('.balance-dialog')!;
    expect(tips(d.querySelector('h2')!).join(' ')).toContain('Each species is counted once');
    expect(lines(d)).toEqual([]);
    expect(d.textContent).not.toContain('Each species is counted once; draw');
  });
  it('still names what was not counted', () => {
    document.body.replaceChildren();
    void showBalance({ starting: [{ formula: 'C2H6O' }], reagents: [], products: [{ formula: 'C2H6O' }], unread: ['Ph3P'] });
    expect(lines(document.querySelector('.balance-dialog')!)).toEqual(['Not counted (not read as a compound): Ph3P.']);
  });
});

describe('Geometry View (F708, F709)', () => {
  const water = [{ el: 'O', x: 0, y: 0, z: 0 }, { el: 'H', x: 0.76, y: 0.59, z: 0 }, { el: 'H', x: -0.76, y: 0.59, z: 0 }];
  const bonds = [{ a: 0, b: 1 }, { a: 0, b: 2 }] as never;
  it('uses Title Case buttons, Rotate and Style, and an "i" in place of the help line', () => {
    document.body.replaceChildren();
    void askGeomView('water', water, bonds, {}, 'ball');
    const d = document.querySelector<HTMLElement>('.geom-view-dialog')!;
    const buttons = [...d.querySelectorAll('button')].map((b) => b.textContent);
    expect(buttons).toContain('Fade All but the Reacting Atoms');
    expect(buttons).toContain('Show All');
    const labels = [...d.querySelectorAll('.gv-label')].map((l) => l.textContent);
    expect(labels).toContain('Rotate');
    expect(labels).not.toContain('Turn');
    expect(d.querySelector('.gv-looks')!.getAttribute('aria-label')).toBe('Style');
    expect(d.textContent).toContain('Use this style and these hydrogens for every species');
    expect(d.textContent).not.toMatch(/\blook\b/);
    // the explanation of the picture is in the title's tip; the line of its own is hidden
    expect(d.querySelector<HTMLElement>('.gv-note')!.hidden).toBe(true);
    expect(tips(d.querySelector('h2')!).join(' ')).toMatch(/Drag to rotate it/);
  });
});

describe('Recover Unsaved Work and Version History (F718)', () => {
  it('Recover Unsaved Work has its explanation behind an "i"', () => {
    document.body.replaceChildren();
    void recoverDialog([], true);
    const d = document.querySelector<HTMLElement>('.keep-recover')!;
    expect(tips(d.querySelector('h2')!).join(' ')).toContain('Chemweave closed before these were saved');
    expect(tips(d).join(' ')).toContain('“Not Now” keeps them');
    expect(lines(d)).toEqual([]);
  });
  it('Version History has where the file is, and how many versions are kept, behind an "i"', () => {
    document.body.replaceChildren();
    versionDialog('a.cdxml', '/work/a.cdxml', [], 'Up to 20 versions are kept.', { open: vi.fn(), restore: vi.fn(), remove: vi.fn() });
    const d = document.querySelector<HTMLElement>('.keep-versions')!;
    const tip = tips(d.querySelector('h2')!).join(' ');
    expect(tip).toContain('/work/a.cdxml');
    expect(tip).toContain('Up to 20 versions are kept.');
    expect(lines(d)).not.toContain('/work/a.cdxml');
    expect(lines(d)).not.toContain('Up to 20 versions are kept.');
  });
});
