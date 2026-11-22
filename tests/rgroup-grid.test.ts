// @vitest-environment jsdom
// Chemistry ▸ R-Group Table (retrospective audit G5-10): the compounds in a grid, one row each and
// one column per R group, with an optional number, instead of typed lines; Excel cells paste in.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { rGroupGrid } from '../src/ui/rgroup-grid';
import { rowNumbers } from '../src/chem/rgroup';

const box = (g: HTMLElement, label: string) => g.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
const set = (i: HTMLInputElement, v: string) => { i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); };
const paste = (i: HTMLInputElement, text: string) => {
  const e = new Event('paste', { bubbles: true, cancelable: true }) as Event & { clipboardData: { getData: (t: string) => string } };
  e.clipboardData = { getData: () => text };
  i.dispatchEvent(e);
  return e.defaultPrevented;
};

describe('R-group grid', () => {
  it('has a column per R group and starts with two empty rows numbered as they will be', () => {
    let prefix = '2';
    const g = rGroupGrid(['R1', 'R2'], [], (i) => rowNumbers(i + 1, prefix)[i]);
    document.body.append(g.el);
    expect([...g.el.querySelectorAll('th')].map((t) => t.textContent)).toEqual(['No.', 'R1', 'R2', '']);
    expect(g.el.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(box(g.el, 'Compound 2 number').placeholder).toBe('2b');
    prefix = '';
    g.refresh();
    expect(box(g.el, 'Compound 2 number').placeholder).toBe('2');
    expect(g.read()).toEqual([]);
  });
  it('reads the filled rows, with their own numbers, and skips empty ones', () => {
    const g = rGroupGrid(['R1', 'R2'], [{ values: ['Me', 'H'] }, { number: '7', values: ['Ph', ''] }], (i) => String(i + 1));
    set(box(g.el, 'Compound 1 R2'), ' OMe ');
    g.el.querySelector<HTMLButtonElement>('.plate-add')!.click();
    expect(g.el.querySelectorAll('tbody tr')).toHaveLength(3);
    expect(g.read()).toEqual([{ values: ['Me', 'OMe'] }, { number: '7', values: ['Ph', ''] }]);
    // delete the first: the rest move up and are named again
    g.el.querySelector<HTMLButtonElement>('button[title="Delete compound"]')!.click();
    expect(box(g.el, 'Compound 1 number').value).toBe('7');
  });
  it('pastes a block of Excel cells across and down, adding rows, and drops a header row of the labels', () => {
    const g = rGroupGrid(['R1', 'R2'], [], (i) => String(i + 1));
    expect(paste(box(g.el, 'Compound 1 R1'), 'R1\tR2\nMe\tH\nPh\tCl\nOMe\tCF3\n')).toBe(true);
    expect(g.read()).toEqual([{ values: ['Me', 'H'] }, { values: ['Ph', 'Cl'] }, { values: ['OMe', 'CF3'] }]);
    // one word pastes as usual
    expect(paste(box(g.el, 'Compound 1 R1'), 'Et')).toBe(false);
  });
  it('is the R-Group Table window\'s, in Title Case, and the typed-lines reader is gone', () => {
    const main = readFileSync(join(__dirname, '..', 'src/main.ts'), 'utf8');
    expect(main).toContain("const got = await ask('R-Group Table', [");
    expect(main).toContain("body: grid.el");
    expect(main).not.toContain('One compound per line');
    expect(readFileSync(join(__dirname, '..', 'src/chem/rgroup.ts'), 'utf8')).not.toContain('export function parseRows');
  });
});
