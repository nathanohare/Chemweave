// @vitest-environment jsdom
//
// Code review batch 14 (the 3-D Model window and its xTB and Gaussian/ORCA tiers): F180, F181,
// F819 to F826. Each test names the finding it covers. The molecule is water (three atoms; the
// geometries and energies are made up, only what the window does with them is checked).
// Gaussian route lines: method/basis, as in the Gaussian 16 manual ("#p B3LYP/6-31G(d) Opt");
// ORCA's simple input line has the method and basis as separate words ("! B3LYP D3BJ def2-SVP"), the
// ORCA 5 manual's own spelling.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Viewer3d, type ConformerTools } from '../src/ui/viewer3d';
import { refineWithXtb, type XtbRunner } from '../src/chem/xtb';
import { methodFor, QM_METHODS } from '../src/chem/qm-input';
import type { Model3d } from '../src/chem/model3d-build';

const water = (n = 3): Model3d => ({
  atoms: [{ z: 8, charge: 0 }, { z: 1, charge: 0 }, { z: 1, charge: 0 }],
  bonds: [{ a: 0, b: 1, order: 1, aromatic: false }, { a: 0, b: 2, order: 1, aromatic: false }],
  conformers: Array.from({ length: n }, (_, i) => ({ xyz: [0, 0, 0, 0.96 + 0.01 * i, 0, 0, -0.24, -0.93, 0], energy: 10 + i })),
});

const drawn: { fonts: string[]; widths: number[] } = { fonts: [], widths: [] };
beforeAll(() => {
  const dlg = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  dlg.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
  dlg.show ??= function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
  dlg.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open'); };
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe() {} disconnect() {} unobserve() {} };
  Element.prototype.scrollIntoView ??= function () {};
  Element.prototype.setPointerCapture ??= function () {};
  // a drawing context that notes the fonts and line widths it is given
  HTMLCanvasElement.prototype.getContext = (() => new Proxy<Record<string, unknown>>({}, {
    get: (t, k: string) => (k in t ? t[k] : () => ({ width: 0, addColorStop() {} })),
    set: (t, k: string, v) => { t[k] = v; if (k === 'font') drawn.fonts.push(String(v)); if (k === 'lineWidth') drawn.widths.push(Number(v)); return true; },
  })) as never;
  HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) { cb(null); } as never;
});
afterEach(() => { for (const d of document.querySelectorAll('dialog, .float-box, .v3d-menu')) d.remove(); vi.restoreAllMocks(); });

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const q = <T extends Element>(s: string) => document.querySelector<T>(s)!;
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('.viewer3d button')].find((b) => b.textContent === label)!;
const submitAsk = () => q<HTMLFormElement>('dialog.ask form').dispatchEvent(new Event('submit', { cancelable: true }));

function viewer(over: Partial<ConformerTools> = {}, model = water()) {
  const flash = vi.fn();
  const v = new Viewer3d(flash);
  const prefs = { xtb: { exe: 'xtb', solvent: '', opt: true, count: 10 }, qm: {} as Record<string, unknown>, save: vi.fn() };
  const tools = { search: vi.fn(), stop: vi.fn(), prefs, saveFiles: vi.fn(async () => {}), ...over } as unknown as ConformerTools;
  v.tools = tools;
  Object.defineProperty((v as unknown as { canvas: HTMLCanvasElement }).canvas, 'clientWidth', { value: 300 });
  Object.defineProperty((v as unknown as { canvas: HTMLCanvasElement }).canvas, 'clientHeight', { value: 200 });
  v.show(model, 'Water', () => {});
  return { v, flash, tools, prefs };
}

describe('F180: Stop during xTB Refine keeps the conformers refined so far', () => {
  it('refineWithXtb gives back the finished ones when xtb is ended', async () => {
    let n = 0;
    const run: XtbRunner = async (job) => {
      if (++n === 3) throw new Error('stopped');
      return { xyz: job.xyz, energy: -5.07 - 0.001 * n };
    };
    const r = await refineWithXtb(water(5), { exe: 'xtb', solvent: '', opt: true, count: 5 }, run, undefined, () => n >= 3);
    expect(r.conformers).toHaveLength(2);
    expect(r.method).toBe('GFN2-xTB');
  });

  it('a run ended by something else (the caller did not ask to stop) still fails, so no half-done model is kept as the result', async () => {
    let n = 0;
    const run: XtbRunner = async (job) => {
      if (++n === 3) throw new Error('stopped');
      return { xyz: job.xyz, energy: -5.07 - 0.001 * n };
    };
    await expect(refineWithXtb(water(5), { exe: 'xtb', solvent: '', opt: true, count: 5 }, run)).rejects.toThrow('stopped');
  });

  it('the window says it was stopped, and keeps what was refined', async () => {
    let fail!: (e: Error) => void;
    let jobs = 0;
    const xtb: XtbRunner = (job) => (++jobs === 1 ? Promise.resolve({ xyz: job.xyz, energy: -5.07 }) : new Promise((_, rej) => { fail = rej; }));
    const { flash } = viewer({ xtb, stop: () => fail(new Error('stopped')) });
    button('xTB Refine').click();
    await tick(5);
    submitAsk();
    await tick(10);
    button('Stop').click();
    await tick(10);
    const said = flash.mock.calls.map((c) => String(c[0]));
    expect(said.some((m) => /stopped unexpectedly/.test(m))).toBe(false);
    expect(said.some((m) => /xTB stopped\. Kept the 1 conformer refined so far/.test(m))).toBe(true);
    expect(q('.v3d-list tbody').children).toHaveLength(1);
  });
});

describe('F181: a method spelled for the other program is swapped', () => {
  it('Gaussian does not get ORCA\'s "B3LYP D3BJ def2-SVP"', () => {
    expect(methodFor('gaussian', 'B3LYP D3BJ def2-SVP')).toBe(QM_METHODS.gaussian[0]);
    expect(methodFor('gaussian', 'r2SCAN-3c')).toBe(QM_METHODS.gaussian[0]);
    expect(methodFor('gaussian', 'M062X def2-TZVP')).toBe(QM_METHODS.gaussian[0]);
    // Gaussian's own spellings stand, including a composite method that has no slash
    expect(methodFor('gaussian', 'B3LYP/6-31G(d)')).toBe('B3LYP/6-31G(d)');
    expect(methodFor('gaussian', 'M062X/def2TZVP')).toBe('M062X/def2TZVP');
    expect(methodFor('gaussian', 'G4')).toBe('G4');
    // ORCA keeps what it had, and swaps Gaussian's method/basis
    expect(methodFor('orca', 'B3LYP D3BJ def2-SVP')).toBe('B3LYP D3BJ def2-SVP');
    expect(methodFor('orca', 'B3LYP/6-31G(d)')).toBe(QM_METHODS.orca[0]);
    expect(methodFor('orca', '  ')).toBe(QM_METHODS.orca[0]);
  });

  it('the input written for Gaussian from the dialog\'s untouched ORCA method has a Gaussian route', async () => {
    const saveFiles = vi.fn(async () => {});
    const { v, prefs, flash } = viewer({ saveFiles });
    (v as unknown as { exportQm(): Promise<void> }).exportQm();
    await tick(5);
    const d = q('dialog.ask');
    const program = d.querySelector<HTMLSelectElement>('[data-field=program] select')!;
    program.value = 'gaussian';
    program.dispatchEvent(new Event('change', { bubbles: true }));
    submitAsk();
    await tick(10);
    const files = (saveFiles.mock.calls[0] as unknown as [{ name: string; text: string }[]])[0];
    const route = files[0].text.split('\n').find((l) => l.startsWith('#'))!;
    expect(route).toContain('B3LYP/');
    expect(route).not.toContain('def2-SVP');
    expect(prefs.qm.method).toBe(QM_METHODS.gaussian[0]);
    // the swap is said, not silent
    expect(flash.mock.calls.some((c) => /not spelled for Gaussian/.test(String(c[0])))).toBe(true);
  });
});

describe('F825 and F826: the number of conformers to refine', () => {
  const runXtb = async (typed: string | null, prefsCount = 10, n = 2) => {
    const xtb = vi.fn<XtbRunner>(async (job) => ({ xyz: job.xyz, energy: -5.07 }));
    const { prefs } = viewer({ xtb });
    prefs.xtb.count = prefsCount;
    (document.querySelector('button[data-tier=xtb]') as HTMLButtonElement).click();
    await tick(5);
    const box = q<HTMLInputElement>('dialog.ask [data-field=count] input');
    if (typed !== null) box.value = typed;
    submitAsk();
    await tick(10);
    return { xtb, prefs, n };
  };

  it('F826: a molecule with three conformers does not lower the saved number', async () => {
    // (viewer() has a model of three conformers, fewer than the 10 saved: the three are refined and 10 stays saved)
    const { prefs, xtb } = await runXtb(null);
    expect(xtb).toHaveBeenCalledTimes(3);
    expect(prefs.xtb.count).toBe(10);
  });

  it('F825: typing 0 refines one, not the saved number', async () => {
    const { prefs, xtb } = await runXtb('0', 2);
    expect(xtb).toHaveBeenCalledTimes(1);
    expect(prefs.xtb.count).toBe(1);
  });

  it('a number typed is the one used and saved', async () => {
    const { prefs, xtb } = await runXtb('2', 10);
    expect(xtb).toHaveBeenCalledTimes(2);
    expect(prefs.xtb.count).toBe(2);
  });
});

describe('F819: closing the window with × stops a running search', () => {
  it('stops it, as Esc does', async () => {
    const search = vi.fn(() => new Promise<Model3d>(() => {}));
    const { tools } = viewer({ search });
    button('Full Search').click();
    await tick(5);
    submitAsk();
    await tick(5);
    expect(search).toHaveBeenCalled();
    q<HTMLButtonElement>('.viewer3d .fb-close').click();
    expect(tools.stop).toHaveBeenCalled();
  });
});

describe('F820: no method can be chosen while the new model is built', () => {
  it('the buttons are off and the last structure\'s results are gone', async () => {
    const search = vi.fn(async () => water(5));
    const { v } = viewer({ search });
    button('Full Search').click();
    await tick(5);
    submitAsk();
    await tick(10);
    expect((v as unknown as { model: Model3d }).model.conformers).toHaveLength(5);
    v.showBusy('Another');
    expect(button('Full Search').disabled).toBe(true);
    button('Full Search').click();
    await tick(5);
    expect((v as unknown as { model: Model3d | null }).model).toBeNull();
    // the new structure arrives: the buttons work again
    v.show(water(2), 'Another', () => {});
    expect(button('Full Search').disabled).toBe(false);
    expect(q('.v3d-list tbody').children).toHaveLength(2);
  });
});

describe('F821: the Spin button shows whether the model is spinning', () => {
  const pressed = () => button('Spin').getAttribute('aria-pressed');
  it('is off after a drag on the model', () => {
    const { v } = viewer();
    button('Spin').click();
    expect(pressed()).toBe('true');
    (v as unknown as { canvas: HTMLElement }).canvas.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    expect(pressed()).toBe('false');
  });
  it('is off after the window is closed with ×, and comes back as it was', () => {
    viewer();
    button('Spin').click();
    expect(pressed()).toBe('true');
    q<HTMLButtonElement>('.viewer3d .fb-close').click();
    expect(pressed()).toBe('false');
  });
});

describe('F823: Copy Picture draws letters and lines in step with the larger picture', () => {
  it('has the element letters three times the size of the window\'s', async () => {
    const { v } = viewer();
    // wire style: element letters always shown
    const style = q<HTMLSelectElement>('.viewer3d select');
    style.value = 'wire';
    style.dispatchEvent(new Event('change'));
    const px = (f: string | undefined) => Number(/(\d+(?:\.\d+)?)px/.exec(f ?? '')?.[1]);
    drawn.fonts.length = 0; drawn.widths.length = 0;
    v.draw();
    const inWindow = px(drawn.fonts.at(-1)), wireWindow = drawn.widths[0];
    drawn.fonts.length = 0; drawn.widths.length = 0;
    button('Copy Picture').click();
    await tick(10);
    expect(px(drawn.fonts.at(-1))).toBeCloseTo(3 * inWindow, 5);
    expect(drawn.widths[0]).toBeCloseTo(3 * wireWindow, 5);
  });
});

describe('F824: a second click on Export leaves no menu behind to swallow Escape', () => {
  it('lets the next Escape through once the menu is used', () => {
    viewer();
    const seen = vi.fn();
    document.addEventListener('keydown', seen);
    button('Export ▾').click();
    button('Export ▾').click();
    expect(document.querySelectorAll('.v3d-menu')).toHaveLength(1);
    // a menu item chosen from the keyboard closes the menu
    document.querySelector<HTMLButtonElement>('.v3d-menu button:not(:disabled)')!.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(seen).toHaveBeenCalled();
    document.removeEventListener('keydown', seen);
  });
});
