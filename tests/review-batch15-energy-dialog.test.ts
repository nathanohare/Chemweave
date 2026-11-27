// @vitest-environment jsdom
//
// Review batch 15 (F697, F698): in the Energy Diagram window, Remove Geometry takes away only the
// geometry read from a file (not a structure drawn for the species), and the × of a species is
// disabled, with the reason, when only two species are left.
import { describe, it, expect, beforeAll, vi } from 'vitest';

vi.mock('../src/fonts', () => ({ FONT_GROUPS: [] }));
import { askEnergy } from '../src/ui/energy-dialog';
import type { EnergyData } from '../src/design/energy';

beforeAll(() => {
  const dlg = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  dlg.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
  dlg.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open'); };
  window.requestAnimationFrame = () => 0;
});

const tick = () => new Promise((r) => setTimeout(r, 0));
const drawn = { atoms: [{ id: 1 }], bonds: [] } as never;
const geom = [{ el: 'O', x: 0, y: 0, z: 0 }, { el: 'H', x: 0.76, y: 0.59, z: 0 }];
const data = (n: number): EnergyData => ({
  quantity: 'ΔG', unit: 'kcal/mol', style: 'levels', values: true, digits: 1, axis: true, barrier: false, w: 300, h: 180,
  paths: [{ name: '', color: '#000000', points: [
    { label: 'SM', g: 0, geom, drawn },
    { label: 'P', g: -5 },
    ...(n > 2 ? [{ label: 'Q', g: -8 }] : []),
  ] }],
});
const structure = {
  edit: async () => null, paste: async () => ({ error: 'none' }), fromText: async () => ({ error: 'none' }), thumb: () => {},
};

describe('Remove Geometry (F697)', () => {
  it('keeps the drawn structure, and Remove Structure is its own item', async () => {
    const got = askEnergy(data(3), { w: 300, h: 180 }, undefined, undefined, structure as never);
    await tick();
    const d = [...document.querySelectorAll<HTMLDialogElement>('dialog.energy-dialog')].pop()!;
    d.querySelector<HTMLButtonElement>('[aria-label="Structure for SM"]')!.click();
    const items = () => [...document.querySelectorAll<HTMLElement>('.popup-menu [role=menuitem]')];
    expect(items().map((i) => i.textContent)).toEqual(expect.arrayContaining(['Remove Geometry', 'Remove Structure']));
    items().find((i) => i.textContent === 'Remove Geometry')!.click();
    d.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    const out = (await got)!;
    const p = out.paths[0].points[0];
    expect(p.geom).toBeUndefined();
    expect(p.drawn).toBeDefined();
  });
});

describe('the × of a species (F698)', () => {
  it('is disabled, with the reason, when two species are left', async () => {
    const got = askEnergy(data(2), { w: 300, h: 180 });
    await tick();
    const d = [...document.querySelectorAll<HTMLDialogElement>('dialog.energy-dialog')].pop()!;
    const xs = [...d.querySelectorAll<HTMLButtonElement>('.energy-table tbody button')].filter((b) => b.textContent === '×');
    expect(xs).toHaveLength(2);
    for (const x of xs) {
      expect(x.disabled).toBe(true);
      expect(x.title).toBe('A diagram needs at least two species');
    }
    d.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await got;
  });
  it('works with three', async () => {
    const got = askEnergy(data(3), { w: 300, h: 180 });
    await tick();
    const d = [...document.querySelectorAll<HTMLDialogElement>('dialog.energy-dialog')].pop()!;
    const xs = [...d.querySelectorAll<HTMLButtonElement>('.energy-table tbody button')].filter((b) => b.textContent === '×');
    expect(xs).toHaveLength(3);
    expect(xs.every((x) => !x.disabled && x.title === 'Remove this species')).toBe(true);
    d.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await got;
  });
});
