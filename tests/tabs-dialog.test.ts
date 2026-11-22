// @vitest-environment jsdom
// Document ▸ Paragraph ▸ Tabs… (retrospective audit G5-09): Word's Tabs window, with a position box,
// the stops in a list, Alignment and Leader radio buttons, and Set, Clear and Clear All; "Center",
// never "centre". 1 in = 72 pt; 1 cm = 72 / 2.54 pt.
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { editTabStops } from '../src/ui/tabs-dialog';

HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true; };
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.open = false; this.dispatchEvent(new Event('close')); };

const q = <T extends Element>(s: string) => document.querySelector<T>(`dialog.tabs-dialog ${s}`)!;
const button = (t: string) => [...document.querySelectorAll<HTMLButtonElement>('dialog.tabs-dialog button')].find((b) => b.textContent === t)!;
const type = (v: string) => { const i = q<HTMLInputElement>('.tabs-pos input'); i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); };
const pick = (name: string, v: string) => { const r = q<HTMLInputElement>(`input[name=${name}][value="${v}"]`); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); };
const ok = () => q<HTMLFormElement>('form').dispatchEvent(new Event('submit', { cancelable: true }));

describe('Tabs window', () => {
  afterEach(() => { for (const d of document.querySelectorAll('dialog')) d.remove(); });
  it('has Word\'s parts and writes Center', () => {
    void editTabStops([{ pos: 72, kind: 'center' }]);
    expect(q('h2').firstChild!.textContent).toBe('Tabs');
    expect(q('h2 .info-icon, h2 [data-tip]')).toBeTruthy();
    expect([...document.querySelectorAll('dialog.tabs-dialog legend')].map((l) => l.textContent)).toEqual(['Alignment', 'Leader']);
    expect([...document.querySelectorAll('dialog.tabs-dialog input[name=kind]')].map((r) => r.parentElement!.textContent!.trim())).toEqual(['Left', 'Center', 'Right', 'Decimal']);
    expect(['Set', 'Clear', 'Clear All', 'Cancel', 'OK'].every((t) => button(t))).toBe(true);
    expect(q<HTMLSelectElement>('.tabs-list').options[0].text).toBe('1 in');
    expect(q<HTMLInputElement>('input[name=kind][value=center]').checked).toBe(true);
    expect(document.querySelector('dialog.tabs-dialog textarea')).toBeNull();
    expect(readFileSync(join(__dirname, '..', 'src/ui/doc-mode.ts'), 'utf8')).not.toContain("'centre'");
  });
  it('sets, changes, clears and sorts stops; OK sets what is typed', async () => {
    const got = editTabStops([{ pos: 216, kind: 'right', leader: 'dot' }]);
    type('1');
    pick('kind', 'decimal');
    pick('leader', '');
    button('Set').click();
    type('3 in'); // the same place as the right stop: changes it, not a second one
    pick('kind', 'left');
    button('Set').click();
    expect([...q<HTMLSelectElement>('.tabs-list').options].map((o) => o.text)).toEqual(['1 in', '3 in']);
    type('2.54 cm');
    pick('kind', 'center');
    pick('leader', 'hyphen');
    button('Set').click();
    expect(q<HTMLSelectElement>('.tabs-list').value).toBe('0'); // 2.54 cm is 1 in: it changed that stop
    // clear the selected one; the next (3 in, left) is selected and shown; type one more and press OK
    button('Clear').click();
    expect(q<HTMLInputElement>('input[name=kind][value=left]').checked).toBe(true);
    type('0.5');
    ok();
    expect(await got).toEqual([{ pos: 36, kind: 'left' }, { pos: 216, kind: 'left' }]);
  });
  it('a position of 0 or less, or not a length, is not set and says why (OK stays open)', async () => {
    const got = editTabStops([]);
    type('-1');
    button('Set').click();
    expect(q('.tabs-status').textContent).toContain('above 0');
    expect(q<HTMLSelectElement>('.tabs-list').options).toHaveLength(0);
    type('abc');
    ok();
    expect(q<HTMLDialogElement>('').open).toBe(true);
    button('Clear All').click();
    type('');
    ok();
    expect(await got).toEqual([]);
  });
  it('Cancel gives nothing', async () => {
    const got = editTabStops([{ pos: 72, kind: 'left' }]);
    button('Cancel').click();
    expect(await got).toBeNull();
  });
});
