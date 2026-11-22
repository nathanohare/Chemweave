// @vitest-environment jsdom
// Insert ▸ Gel… (retrospective audit G5-08): one row per band, a size box and a Description menu,
// as TLC spots have, and a Marker box on each lane, instead of a typed list per lane.
import { afterEach, describe, expect, it } from 'vitest';
import { askPlate } from '../src/ui/plate-dialog';
import type { PlateData } from '../src/design/plates';

HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true; };
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.open = false; };

const q = <T extends Element>(s: string) => document.querySelector<T>(`dialog.plate-dialog ${s}`)!;
const all = <T extends Element>(s: string) => [...document.querySelectorAll<T>(`dialog.plate-dialog ${s}`)];
const submit = () => q<HTMLFormElement>('form').dispatchEvent(new Event('submit', { cancelable: true }));

describe('Gel window', () => {
  afterEach(() => { for (const d of document.querySelectorAll('dialog')) d.remove(); document.querySelector('.plate-menu')?.remove(); });
  it('lists each band on a row of its own, and writes them back as the lane\'s list', async () => {
    const editing = { kind: 'gel', lanes: [{ label: 'M', marks: '10, 3 faint', ladder: true }, { label: '1', marks: '1.2 strong blue' }], look: 'etbr', w: 120, h: 100, rf: false, lines: false, labels: true, note: '', unit: 'kb', sizes: true } as PlateData;
    const got = askPlate('gel', editing, 14.4);
    expect(all('textarea')).toHaveLength(0);
    expect(all('th').map((t) => (t.firstChild?.textContent ?? '').trim())).toEqual(['Lane', 'Size', 'Description', '']);
    expect(all('th')[1].querySelector('.info-icon, [data-tip]')).toBeTruthy(); // the help is behind its "i"
    const sizes = all<HTMLInputElement>('input[data-k=rf]');
    expect(sizes.map((i) => i.value)).toEqual(['10', '3', '1.2']);
    expect(sizes[1].getAttribute('aria-label')).toBe('Lane 1 band 2 size');
    expect(all<HTMLButtonElement>('.plate-desc').map((b) => b.textContent!.replace('▾', '').trim())).toEqual(['Normal', 'Faint', 'Strong, blue']);
    const markers = all<HTMLInputElement>('input[aria-label$="is a size marker"]');
    expect(markers.map((m) => m.checked)).toEqual([true, false]);
    // add a band to lane 2 and type its size; make lane 2 a marker; drop lane 1's faint band
    all<HTMLButtonElement>('.plate-add')[1].click();
    const fresh = all<HTMLInputElement>('input[aria-label^="Lane 2 band"]').at(-1)!;
    fresh.value = '0.8';
    fresh.dispatchEvent(new Event('input', { bubbles: true }));
    markers[1].checked = true;
    markers[1].dispatchEvent(new Event('change', { bubbles: true }));
    all<HTMLButtonElement>('button[title="Delete band"]')[1].click();
    submit();
    const out = await got;
    expect(out!.lanes).toEqual([{ label: 'M', marks: '10', ladder: true }, { label: '1', marks: '1.2 strong blue, 0.8', ladder: true }]);
  });
  it('a Description menu has no Spot/Streak row for a band', async () => {
    const got = askPlate('gel', null, 14.4);
    q<HTMLButtonElement>('.plate-desc').click();
    const heads = [...document.querySelectorAll('.plate-menu .plate-menu-head')].map((h) => h.textContent);
    expect(heads).toEqual(['Intensity', 'Size', 'Color']);
    expect(document.querySelector('.plate-menu')!.getAttribute('aria-label')).toBe('Band description');
    q<HTMLButtonElement>('[data-act=cancel]').click();
    expect(await got).toBeNull();
  });
  it('+ Lane adds an empty lane with its + Band', async () => {
    const got = askPlate('gel', null, 14.4);
    const before = all('.plate-add').length;
    q<HTMLButtonElement>('[data-act=lane]').click();
    expect(all('.plate-add').length).toBe(before + 1);
    expect(all('.plate-add').at(-1)!.textContent).toBe('+ Band');
    q<HTMLButtonElement>('[data-act=cancel]').click();
    await got;
  });
});
