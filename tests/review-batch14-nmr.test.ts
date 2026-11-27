// @vitest-environment jsdom
//
// Code review batch 14 (NMR section of the Analysis panel and the Spectrum window): F166, F167,
// F745, F746, F747, F749, F750, F751, F752.
//   F166: Check Data was not run again after the solvent changed.
//   F167: the peak label size setting had no effect (the style sheet's size won over the attribute).
//   F745: each open section was predicted twice per selection change.
//   F746: the strip's pointermove redrew the drawing though the hovered row had not changed.
//   F747: the fast fallback spectrum was recomputed on every hover while the exact one ran.
//   F749: Copy as Picture left out the label leader lines (no .sp-lead rule in the picture's sheet).
//   F750: the title-bar drag kept its listeners after a pointercancel.
//   F751: a quality change in the Spectrum window left the panel's list on the other rows.
//   F752: a failed picture was reported as a refused copy.
// Ethyl acetate peaks for the Spectrum window: Fulmer, G. R. et al., Organometallics 2010, 29,
// 2176-2179, doi:10.1021/om100106e, Table 1 (in CDCl3: CH2 4.12 q, CH3CO 2.05 s, CH3 1.26 t).
// The shift table the panel reads is a one-line stand-in (the layout of the shipped table, no
// entries): what is checked is when the panel does its work, not what it predicts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NamerGraph } from '../src/chem/namer-graph';

const spectrumCalls = vi.hoisted(() => ({ n: 0, fast: 0 }));
vi.mock('../src/chem/nmr/spectrum', async (orig) => {
  const m = await orig<typeof import('../src/chem/nmr/spectrum')>();
  return { ...m, predictSpectrum: (...a: Parameters<typeof m.predictSpectrum>) => { spectrumCalls.n++; if (a[4] === 'fast') spectrumCalls.fast++; return m.predictSpectrum(...a); } };
});
// the exact spectrum is "still being simulated" for the whole test
vi.mock('../src/chem/nmr/spectrum-client', () => ({ spectrumInBackground: () => new Promise(() => {}) }));

import { NmrPanel, type NmrHost } from '../src/ui/nmr-panel';
import { sampleSpectrumData, spectrumSvg, SpectrumWindow, pictureStyle, type SpectrumData } from '../src/ui/nmr-spectrum';
import { DEFAULT_PEAK_LABELS } from '../src/ui/nmr-settings';

class RO { observe() {} disconnect() {} }
// jsdom has neither pointer capture nor scrolling into view
(HTMLElement.prototype as unknown as Record<string, unknown>).setPointerCapture ??= () => {};
(HTMLElement.prototype as unknown as Record<string, unknown>).scrollIntoView ??= () => {};
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = RO;
let frames: FrameRequestCallback[] = [];
globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => frames.push(cb);
const flushFrames = () => { const f = frames; frames = []; for (const cb of f) cb(0); };
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

function ptr(type: string, x: number, o: { y?: number; buttons?: number } = {}): MouseEvent {
  const e = new MouseEvent(type, { clientX: x, clientY: o.y ?? 50, button: 0, buttons: o.buttons ?? 0, bubbles: true, cancelable: true });
  Object.defineProperty(e, 'pointerId', { value: 1 });
  Object.defineProperty(e, 'pointerType', { value: 'mouse' });
  return e;
}

beforeEach(() => { try { localStorage.clear(); } catch { /* none */ } document.body.innerHTML = ''; spectrumCalls.n = 0; spectrumCalls.fast = 0; });
afterEach(() => { vi.restoreAllMocks(); });

// ---- the panel ------------------------------------------------------------------------------

/** A table with no entries, in the shipped layout (header, then the sections' arrays). */
function emptyTable(): ArrayBuffer {
  const head = new TextEncoder().encode(JSON.stringify({ version: 1, scale: { '13C': 50, '1H': 1000 }, params: { '13C': { maxr: 5, depth: 0 }, '1H': { maxr: 4, depth: 0 } }, sections: [] }));
  const pre = new Uint8Array(12 + head.length + ((8 - ((12 + head.length) % 8)) % 8));
  pre.set(new TextEncoder().encode('NMRH'));
  new DataView(pre.buffer).setUint32(4, 1, true);
  new DataView(pre.buffer).setUint32(8, head.length, true);
  pre.set(head, 12);
  return pre.buffer;
}

const atom = (el: string, h: number) => ({ el, q: 0, iso: 0, legacy: null, cip: null, tag: null, arom: false, xh: 0, h, rad: 0, deg: 0 });
const bond = (u: number, v: number) => ({ u, v, o: 1, ez: null, ring: false });
// ethanol: C0 (CH3), C1 (CH2), O2 (OH)
const ethanol: NamerGraph = { atoms: [atom('C', 3), atom('C', 2), atom('O', 1)], bonds: [bond(0, 1), bond(1, 2)] };
const molblock = ['', '', '', '  3  2  0  0  0  0  0  0  0  0999 V2000',
  '    0.0000    0.0000    0.0000 C   0  0', '    1.0000    0.0000    0.0000 C   0  0', '    2.0000    0.0000    0.0000 O   0  0',
  '  1  2  1  0', '  2  3  1  0', 'M  END'].join('\n');

function panelSetup(opts: { open?: boolean } = {}) {
  localStorage.setItem('ci-nmr-auto', '1');
  localStorage.setItem('ci-nmr-open', opts.open === false ? '0' : '1');
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => emptyTable() })));
  const host: NmrHost = {
    url: 'nmr.bin',
    graph: vi.fn(async () => ({ graph: ethanol })),
    redraw: vi.fn(), copy: vi.fn(async () => {}), flash: vi.fn(),
  };
  const nmr = new NmrPanel(host);
  const root = document.createElement('div');
  root.id = 'analysis-section';
  root.innerHTML = '<div class="frag"><div class="an-buttons"></div></div>';
  document.body.append(root);
  nmr.attach(root, [{ molblock, map: [0, 1, 2] }]);
  const details = root.querySelector<HTMLDetailsElement>('details.nmr')!;
  return { nmr, host, root, details };
}
const settle = async () => { for (let k = 0; k < 6; k++) await tick(0); };

describe('F745: an open section is predicted once per selection change', () => {
  it('asks for the structure\'s graph once, not once for the open section and again for its toggle event', async () => {
    const { host, details } = panelSetup();
    expect(details.open).toBe(true);
    await settle();
    expect(host.graph).toHaveBeenCalledTimes(1);
  });

  it('still fills a section the person opens afterwards', async () => {
    const { host, details } = panelSetup({ open: false });
    await settle();
    expect(host.graph).not.toHaveBeenCalled();
    details.open = true;
    await settle();
    expect(host.graph).toHaveBeenCalledTimes(1);
  });
});

describe('F746: the strip does not redraw the drawing while the same row stays under the pointer', () => {
  it('redraws for a new row only', async () => {
    const { host, details } = panelSetup();
    await settle();
    const strip = details.querySelector<HTMLElement>('.nmr-strip')!;
    expect(strip).not.toBeNull();
    strip.dispatchEvent(ptr('pointermove', 10));
    const after = (host.redraw as ReturnType<typeof vi.fn>).mock.calls.length;
    for (let k = 0; k < 5; k++) strip.dispatchEvent(ptr('pointermove', 10 + k));
    expect((host.redraw as ReturnType<typeof vi.fn>).mock.calls.length).toBe(after);
  });
});

describe('F746 (render): drawing the list again lets the same peak be hovered again', () => {
  it('redraws for the same row once the section was made again', async () => {
    const { host, details, root } = panelSetup();
    await settle();
    const redraws = () => (host.redraw as ReturnType<typeof vi.fn>).mock.calls.length;
    details.querySelector<HTMLElement>('.nmr-strip')!.dispatchEvent(ptr('pointermove', 10));
    const a = redraws();
    // the solvent changes: the section is made again (its marks are gone)
    const sel = root.querySelector<HTMLSelectElement>('.nmr-solvent')!;
    sel.value = 'DMSO-d6';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    const b = redraws();
    details.querySelector<HTMLElement>('.nmr-strip')!.dispatchEvent(ptr('pointermove', 11));
    expect(redraws()).toBeGreaterThan(b);
    expect(b).toBeGreaterThanOrEqual(a);
  });
});

describe('F747: the first-order spectrum shown while the exact one runs is made once', () => {
  it('does not simulate again on each hover', async () => {
    const { details } = panelSetup();
    await settle();
    const strip = details.querySelector<HTMLElement>('.nmr-strip')!;
    strip.dispatchEvent(ptr('pointermove', 10));
    const before = spectrumCalls.fast;
    expect(before).toBeGreaterThan(0); // the fallback was drawn
    for (let k = 0; k < 6; k++) strip.dispatchEvent(ptr('pointermove', 20 + k));
    expect(spectrumCalls.fast).toBe(before);
  });
});

describe('F166: Check Data is run again when the solvent changes', () => {
  it('drops the note that asks for the solvent just chosen', async () => {
    const { details, root } = panelSetup();
    await settle();
    details.querySelector<HTMLButtonElement>('.nmr-check')!.click();
    const ta = details.querySelector<HTMLTextAreaElement>('.ck-box textarea')!;
    ta.value = '1H NMR (400 MHz, DMSO-d6) δ 7.30 (d, 2H)';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    details.querySelector<HTMLButtonElement>('.ck-run')!.click();
    await settle();
    expect(details.querySelector('.nmr-body')!.textContent).toContain('Select DMSO-d₆ above');
    const sel = root.querySelector<HTMLSelectElement>('.nmr-solvent')!;
    sel.value = 'DMSO-d6';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(details.querySelector('.nmr-body')!.textContent).not.toContain('Select DMSO-d₆ above');
    // the findings are still there (the list was checked again, not dropped)
    expect(details.querySelector('.ck-tools')).not.toBeNull();
  });
});

describe('F166 (view): the check run again for a new solvent does not change what the list shows', () => {
  const run = async (details: HTMLElement, text: string) => {
    details.querySelector<HTMLButtonElement>('.nmr-check')!.click();
    const ta = details.querySelector<HTMLTextAreaElement>('.ck-box textarea')!;
    ta.value = text;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    details.querySelector<HTMLButtonElement>('.ck-run')!.click();
    await settle();
  };

  it('stays on 13C when the 1H list is checked again', async () => {
    const { details, root } = panelSetup();
    await settle();
    await run(details, '1H NMR (400 MHz, DMSO-d6) δ 7.30 (d, 2H)');
    details.querySelector<HTMLButtonElement>('.nmr-nuc button[data-nuc="13C"]')!.click();
    expect(localStorage.getItem('ci-nmr-nuc')).toBe('13C');
    const sel = root.querySelector<HTMLSelectElement>('.nmr-solvent')!;
    sel.value = 'DMSO-d6';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(localStorage.getItem('ci-nmr-nuc')).toBe('13C');
  });

  it('is not run again when the panel is made again for the same solvent', async () => {
    const { nmr, details, root } = panelSetup();
    await settle();
    await run(details, '1H NMR (400 MHz, CDCl3) δ 7.30 (d, 2H)');
    const state = () => (nmr as unknown as { checkState(i: number, m: boolean): { results: Map<string, unknown> } }).checkState(0, false).results;
    const before = state().get('1H');
    expect(before).toBeDefined();
    nmr.attach(root, [{ molblock, map: [0, 1, 2] }]);
    await settle();
    expect(state().get('1H')).toBe(before);
  });
});

describe('F751: a quality change in the Spectrum window is followed by the panel\'s list', () => {
  it('draws each section again', async () => {
    const { nmr, details } = panelSetup();
    await settle();
    nmr.ribbon('window');
    flushFrames();
    const before = details.querySelector('.nmr-strip');
    expect(before).not.toBeNull();
    const q = document.querySelector<HTMLSelectElement>('.nmr-spec-quality')!;
    q.value = 'fast';
    q.dispatchEvent(new Event('change', { bubbles: true }));
    flushFrames();
    expect(details.querySelector('.nmr-strip')).not.toBe(before);
  });
});

// ---- the window ----------------------------------------------------------------------------

function windowSetup(over: Partial<ConstructorParameters<typeof SpectrumWindow>[0]> = {}) {
  const data: SpectrumData = sampleSpectrumData(400, false);
  const host = {
    data: () => data, hover: vi.fn(), copyPicture: vi.fn(async () => {}), putOnCanvas: vi.fn(), flash: vi.fn(), closed: vi.fn(),
    ...over,
  };
  const win = new SpectrumWindow(host);
  win.open(null);
  flushFrames();
  return { win, host };
}

describe('F751 (window): the quality select tells the panel', () => {
  it('calls the host\'s qualityChanged', () => {
    const qualityChanged = vi.fn();
    const { win } = windowSetup({ qualityChanged });
    const q = win.el.querySelector<HTMLSelectElement>('.nmr-spec-quality')!;
    q.value = 'fast';
    q.dispatchEvent(new Event('change', { bubbles: true }));
    expect(qualityChanged).toHaveBeenCalledTimes(1);
  });
});

describe('F750: the title-bar drag ends on pointercancel', () => {
  it('stops following the pointer after a cancel', () => {
    const { win } = windowSetup();
    const hd = win.el.querySelector<HTMLElement>('.nmr-spec-hd')!;
    hd.dispatchEvent(ptr('pointerdown', 100, { y: 20, buttons: 1 }));
    hd.dispatchEvent(ptr('pointermove', 150, { y: 40, buttons: 1 }));
    const left = win.el.style.left;
    hd.dispatchEvent(ptr('pointercancel', 150, { y: 40 }));
    hd.dispatchEvent(ptr('pointermove', 300, { y: 90 }));
    expect(win.el.style.left).toBe(left);
  });
});

describe('F752: a failed picture is not reported as a refused copy', () => {
  it('says the picture could not be made', async () => {
    const copyPicture = vi.fn(async () => {});
    const { win, host } = windowSetup({ copyPicture });
    // no canvas in jsdom: the picture fails to render
    win.el.querySelector<HTMLButtonElement>('.nmr-spec-copy')!.click();
    await tick(20);
    expect(copyPicture).not.toHaveBeenCalled();
    expect(host.flash).toHaveBeenCalledWith('Couldn\'t create the picture.');
  });

  it('still says a refused copy was refused', async () => {
    const { win, host } = windowSetup({ copyPicture: vi.fn(async () => { throw new Error('no'); }) });
    // a picture that works: stand in for the canvas route
    vi.spyOn(win as unknown as { picture(): Promise<Uint8Array> }, 'picture').mockResolvedValue(new Uint8Array([1]));
    win.el.querySelector<HTMLButtonElement>('.nmr-spec-copy')!.click();
    await tick(20);
    expect(host.flash).toHaveBeenCalledWith('Copying was refused by the system.');
  });
});

describe('F167: the peak label size is the one drawn', () => {
  it('writes the size as a style on each label, which the sheet\'s class rule does not override', () => {
    const d = sampleSpectrumData(400, false);
    const svg = spectrumSvg(d, { w: 400, h: 200, hi: 5, lo: 0, labels: true, hotRow: null, peakLabels: { ...DEFAULT_PEAK_LABELS, shift: true, size: 18 } });
    const labs = [...svg.matchAll(/<text[^>]*class="sp-lab"[^>]*>/g)].map((m) => m[0]);
    expect(labs.length).toBeGreaterThan(0);
    for (const t of labs) expect(t).toContain('style="font-size:18px"');
  });
});

describe('F749: the picture carries the leader lines\' style', () => {
  it('has a rule that gives sp-lead a stroke', () => {
    const sheet = pictureStyle('<svg viewBox="0 0 10 10"></svg>');
    expect(sheet).toMatch(/\.sp-lead\{[^}]*stroke:#[0-9a-f]{6}/i);
  });
});
