// @vitest-environment jsdom
//
// Code review batch 14 (Insert ▸ Energy Diagram window): F155, F696, F699, F700.
//   F155: an energy typed over a file's was replaced when the axis or unit changed, and a first
//         species typed over made the others relative to the second.
//   F696: From Name or SMILES… used the system's prompt(), which the desktop app does not have.
//   F699: layouts of 2-D structures were lost when the table was read again while they were made.
//   F700: Insert did nothing, and said nothing, when no energy was typed.
// The energies are made up (hartree, kept only as differences): what is checked is which numbers
// the window keeps. Units: 1 hartree = 627.5094740631 kcal/mol = 2625.499639479 kJ/mol (CODATA 2018,
// the NIST Reference on Constants, Units, and Uncertainty), so 0.01 Eh = 6.28 kcal/mol or 26.25 kJ/mol
// and 0.02 Eh = 12.55 kcal/mol or 52.51 kJ/mol.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../src/fonts', () => ({ FONT_GROUPS: [] }));
import { askEnergy, type EnergyStructureHooks } from '../src/ui/energy-dialog';
import { ENERGY_DEFAULTS, type EnergyData, type EnergyPoint } from '../src/design/energy';

beforeAll(() => {
  const dlg = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  dlg.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
  dlg.show ??= function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
  dlg.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open'); };
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe() {} disconnect() {} unobserve() {} };
});
afterEach(() => { for (const d of document.querySelectorAll('dialog, .popup-menu')) d.remove(); vi.restoreAllMocks(); });

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const fire = (el: Element, type = 'input') => el.dispatchEvent(new Event(type, { bubbles: true }));
const submit = (d: Element) => d.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
const gs = (d: Element) => [...d.querySelectorAll<HTMLInputElement>('input[data-g]')].map((i) => i.value);

/** Three species read from files: free energies G, enthalpies H (hartree). */
const fromFiles = (): EnergyData => ({
  ...ENERGY_DEFAULTS, quantity: 'ΔG', unit: 'kcal/mol', w: 300, h: 180,
  paths: [{ name: '', color: '#000000', points: [
    { label: 'A', g: 0, eh: -100.0, ehs: { G: -100.0, H: -99.0 } },
    { label: 'B', g: 6.28, eh: -99.99, ehs: { G: -99.99, H: -98.9 } },
    { label: 'C', g: 12.55, eh: -99.98, ehs: { G: -99.98, H: -98.8 } },
  ] as EnergyPoint[] }],
});

describe('F155: an energy typed over a file\'s stays when the axis or unit changes', () => {
  it('keeps a typed energy when the axis changes to ΔG°', () => {
    void askEnergy(fromFiles(), { w: 300, h: 180 });
    const d = document.querySelector('dialog.energy-dialog')!;
    const boxes = [...d.querySelectorAll<HTMLInputElement>('input[data-g]')];
    expect(gs(d)).toEqual(['0', '6.28', '12.55']);
    boxes[1].value = '9.5';
    fire(boxes[1]);
    const q = d.querySelector<HTMLSelectElement>('select[name=quantity]')!;
    q.value = 'ΔG°';
    fire(q, 'change');
    expect(gs(d)).toEqual(['0', '9.5', '12.55']);
  });

  it('keeps a typed energy when the axis changes to ΔH; the others follow the file\'s enthalpies', () => {
    void askEnergy(fromFiles(), { w: 300, h: 180 });
    const d = document.querySelector('dialog.energy-dialog')!;
    const boxes = [...d.querySelectorAll<HTMLInputElement>('input[data-g]')];
    boxes[1].value = '9.5';
    fire(boxes[1]);
    const q = d.querySelector<HTMLSelectElement>('select[name=quantity]')!;
    q.value = 'ΔH';
    fire(q, 'change');
    // (C is 0.2 Eh above A in enthalpy: 125.50 kcal/mol)
    expect(gs(d)).toEqual(['0', '9.5', '125.5']);
  });

  it('keeps the first file as the zero when its energy was typed over, and the unit changes', () => {
    void askEnergy(fromFiles(), { w: 300, h: 180 });
    const d = document.querySelector('dialog.energy-dialog')!;
    const boxes = [...d.querySelectorAll<HTMLInputElement>('input[data-g]')];
    boxes[0].value = '1.0';
    fire(boxes[0]);
    const u = d.querySelector<HTMLSelectElement>('select[name=unit]')!;
    u.value = 'kJ/mol';
    fire(u, 'change');
    expect(gs(d)).toEqual(['1.0', '26.25', '52.51']);
  });

  it('after an axis change refused for a missing enthalpy, the zero is still of the kind the others are', () => {
    const data = fromFiles();
    // (the third file has no frequency job: no enthalpy)
    data.paths[0].points[2] = { label: 'C', g: 12.55, eh: -99.98, ehs: { G: -99.98 } } as EnergyPoint;
    void askEnergy(data, { w: 300, h: 180 });
    const d = document.querySelector('dialog.energy-dialog')!;
    const boxes = [...d.querySelectorAll<HTMLInputElement>('input[data-g]')];
    boxes[0].value = '1.0';
    fire(boxes[0]);
    const q = d.querySelector<HTMLSelectElement>('select[name=quantity]')!;
    q.value = 'ΔH';
    fire(q, 'change');
    expect(d.querySelector('.energy-import-note')!.textContent).toContain('the energies are unchanged');
    const u = d.querySelector<HTMLSelectElement>('select[name=unit]')!;
    u.value = 'kJ/mol';
    fire(u, 'change');
    // (the free energies, 0.01 and 0.02 Eh above A's: its enthalpy is not the zero of free energies)
    expect(gs(d)).toEqual(['1.0', '26.25', '52.51']);
  });
});

describe('F696: From Name or SMILES… asks in a window of the program\'s own', () => {
  it('opens the ask window, and does not call prompt()', async () => {
    const prompt = vi.fn(() => null);
    vi.stubGlobal('prompt', prompt);
    const structure: EnergyStructureHooks = {
      edit: async () => null, paste: async () => ({ error: 'none' }), thumb: () => {},
      fromText: vi.fn(async () => ({ error: 'No structure for that.' })),
    };
    const data = fromFiles();
    data.paths[0].points[0].drawn = { atoms: [{ id: 1, x: 0, y: 0, el: 'C' }], bonds: [] } as never;
    void askEnergy(data, { w: 300, h: 180 }, undefined, undefined, structure);
    const d = document.querySelector('dialog.energy-dialog')!;
    d.querySelector<HTMLButtonElement>('button.energy-structure')!.click();
    const item = [...document.querySelectorAll<HTMLButtonElement>('.popup-menu button')].find((b) => b.textContent === 'From Name or SMILES…')!;
    item.click();
    await tick(5);
    expect(prompt).not.toHaveBeenCalled();
    const ask = document.querySelector('dialog.ask:not(.energy-dialog)')!;
    expect(ask).toBeTruthy();
    // it says which species it is for
    expect(ask.textContent).toContain('Name, SMILES or CAS number for ');
    ask.querySelector<HTMLInputElement>('input')!.value = 'CCO';
    ask.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await tick(5);
    expect(structure.fromText).toHaveBeenCalledWith('CCO');
    vi.unstubAllGlobals();
  });
});

describe('F700: Insert says why it did nothing', () => {
  it('shows a note when no species has an energy', async () => {
    const got = vi.fn();
    void askEnergy(fromFiles(), { w: 300, h: 180 }).then(got);
    const d = document.querySelector('dialog.energy-dialog')!;
    for (const b of d.querySelectorAll<HTMLInputElement>('input[data-g]')) b.value = '';
    const note = d.querySelector<HTMLElement>('.energy-import-note')!;
    expect(note.hidden).toBe(true);
    submit(d);
    await tick(5);
    expect(got).not.toHaveBeenCalled();
    expect(note.hidden).toBe(false);
    expect(note.textContent).toMatch(/energy/i);
  });
});

describe('F699: a 2-D layout made while the table is read again is kept', () => {
  it('is on the diagram, and made once for each geometry', async () => {
    // water as the TIP3P model has it: O–H 0.9572 Å, H–O–H 104.52° (Jorgensen et al., J. Chem. Phys. 1983, 79, 926)
    const water = () => [{ el: 'O', x: 0, y: 0, z: 0 }, { el: 'H', x: 0.9572, y: 0, z: 0 }, { el: 'H', x: -0.2399, y: 0.9266, z: 0 }];
    const data = fromFiles();
    data.structures = '2d';
    data.paths[0].points[0].geom = water();
    data.paths[0].points[1].geom = water();
    const waiting: (() => void)[] = [];
    const layout = vi.fn((molblock: string) => new Promise<[number, number][]>((resolve) => {
      const n = Number(molblock.split('\n')[3].slice(0, 3));
      waiting.push(() => resolve(Array.from({ length: n }, (_, i) => [i, 0] as [number, number])));
    }));
    const got = askEnergy(data, { w: 300, h: 180 }, undefined, layout);
    const d = document.querySelector('dialog.energy-dialog')!;
    submit(d);
    await tick(5);
    expect(layout).toHaveBeenCalledTimes(1);
    // the table is read again while the first layout is being made (a species added)
    d.querySelector<HTMLButtonElement>('[data-act=row]')!.click();
    waiting[0]();
    await tick(5);
    waiting[1]?.();
    await tick(5);
    const out = (await got)!;
    expect(out.paths[0].points[0].flat).toBeTruthy();
    expect(out.paths[0].points[1].flat).toBeTruthy();
    expect(layout.mock.calls.length).toBeLessThanOrEqual(2);
  });
});
