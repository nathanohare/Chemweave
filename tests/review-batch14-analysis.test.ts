// @vitest-environment jsdom
//
// Code review batch 14 (Analysis panel and its settings, Lab Calculator): F147, F662, F659, F725.
//   F147: Settings ▸ Analysis put the page's old boxes over a change just made (Add or Edit Lab
//         Calculation's "Show in" choices, Reset).
//   F662: a lab calculation with 1 or 6 significant figures (the saved range is 1 to 6) kept its
//         number only while the Significant figures box offered it.
//   F659: a solubility near 100 mg/mL (or 100 to 999 µg/mL) was written as "1.0e+2".
//   F725: typing the limiting reagent's amount left Equivalents empty.
// The numbers are plain arithmetic (99.7 mg/mL is 10^logS × mol. wt. with logS = log10(0.997), mol. wt. 100;
// 3 mmol over 2 mmol is 1.5 equiv, as the 300 mg of a compound of mol. wt. 100 g/mol is 3 mmol).

import { afterEach, describe, expect, it } from 'vitest';
import { analysisSettingsPage, askLabCalc } from '../src/ui/analysis-settings';
import { solubility } from '../src/ui/analysis-panel';
import { showLabCalculator } from '../src/ui/lab-calc-dialog';
import { DEFAULT_ANALYSIS, parseAnalysisPrefs, type AnalysisPrefs } from '../src/chem/analysis-prefs';
import { newCalc } from '../src/chem/bench';

HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open'); };

const tick = () => new Promise((r) => setTimeout(r, 0));
const fire = (el: Element, type = 'input') => el.dispatchEvent(new Event(type, { bubbles: true }));

afterEach(() => { for (const d of document.querySelectorAll('dialog')) d.remove(); });

function page(start: AnalysisPrefs = structuredClone(DEFAULT_ANALYSIS)) {
  let applied: AnalysisPrefs | null = null;
  const done = analysisSettingsPage({
    prefs: () => start, apply: (p) => { applied = p; }, sample: () => null,
    bench: () => ({}), adduct: () => '[M+H]+', name: () => null,
  });
  const d = document.querySelector<HTMLDialogElement>('dialog.analysis-settings')!;
  const save = () => { d.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true })); return done.then(() => applied!); };
  return { d, save };
}

describe('F147: Settings ▸ Analysis keeps the change just made', () => {
  it('Add Lab Calculation with "Ribbon box" ticked puts it in the ribbon', async () => {
    const { d, save } = page();
    d.querySelector<HTMLButtonElement>('button[data-a="add-calc"]')!.click();
    await tick();
    const ask = document.querySelector('dialog.ask:not(.analysis-settings)')!;
    const ribbon = ask.querySelector<HTMLInputElement>('[data-field="ribbon"] input')!;
    ribbon.checked = true;
    ask.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await tick();
    // the page shows the new calculation in a Ribbon box line, and saves it there
    expect([...d.querySelectorAll<HTMLSelectElement>('select[data-k^="line"]')].map((s) => s.value).filter((v) => v.startsWith('calc:'))).toHaveLength(1);
    const out = await save();
    expect(out.ribbon.lines.filter((v) => v.startsWith('calc:'))).toHaveLength(1);
  });

  it('Edit… can turn off "Analysis panel" for a calculation', async () => {
    const start = parseAnalysisPrefs({ calcs: [{ id: '7', amount: 1, unit: 'mmol' }], rows: DEFAULT_ANALYSIS.rows });
    expect(start.rows.find((r) => r.key === 'calc:7')?.on).toBe(true);
    const { d, save } = page(start);
    d.querySelector<HTMLButtonElement>('button[data-a="edit-calc"]')!.click();
    await tick();
    const ask = document.querySelector('dialog.ask:not(.analysis-settings)')!;
    ask.querySelector<HTMLInputElement>('[data-field="panel"] input')!.checked = false;
    ask.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await tick();
    expect(d.querySelector<HTMLInputElement>('input[data-on="calc:7"]')!.checked).toBe(false);
    expect((await save()).rows.find((r) => r.key === 'calc:7')?.on).toBe(false);
  });

  it('Reset brings back which rows are shown, not only their order', async () => {
    const { d, save } = page();
    const boxes = [...d.querySelectorAll<HTMLInputElement>('input[data-on]')];
    const was = boxes.map((b) => b.checked);
    expect(was.some((c) => c)).toBe(true);
    for (const b of boxes) { b.checked = !b.checked; fire(b, 'change'); }
    d.querySelector<HTMLButtonElement>('button[data-a="reset-rows"]')!.click();
    expect([...d.querySelectorAll<HTMLInputElement>('input[data-on]')].map((b) => b.checked)).toEqual(was);
    expect((await save()).rows.map((r) => r.on)).toEqual(was);
  });
});

describe('F662: a calculation with 1 or 6 significant figures keeps them when edited', () => {
  it.each([1, 6])('sig %i', async (sig) => {
    const c = { ...newCalc('1'), sig };
    const got = askLabCalc(c, null, () => ({}), parseAnalysisPrefs({ calcs: [c] }));
    await tick();
    const ask = document.querySelector('dialog.ask')!;
    ask.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    expect((await got)!.calc.sig).toBe(sig);
  });
});

describe('F659: solubility is never written with an exponent', () => {
  it('writes 99.7 mg/mL as 100 mg/mL, and 150 µg/mL out in full', () => {
    expect(solubility(Math.log10(0.997), 100)).toBe('100 mg/mL');
    expect(solubility(Math.log10(0.00015), 1000)).toBe('150 µg/mL'); // 0.15 mg/mL
    // the ordinary ones are as before
    expect(solubility(Math.log10(0.0000123), 1000)).toBe('12 µg/mL');
    expect(solubility(Math.log10(0.05), 100)).toBe('5.0 mg/mL');
    expect(solubility(Math.log10(1.5), 100)).toBe('150 mg/mL');
  });
});

describe('F725: the limiting reagent\'s amount gives the equivalents', () => {
  it('300 mg of mol. wt. 100 is 3 mmol: 2 mmol limiting makes 1.5 equiv', async () => {
    void showLabCalculator({ mw: 100 });
    const d = document.querySelector('dialog.calc-dialog')!;
    const input = (label: string) => [...d.querySelectorAll<HTMLElement>('label.calc-row')].find((r) => r.querySelector('span')!.textContent === label)!.querySelector('input')!;
    const mass = input('Mass');
    mass.value = '300';
    fire(mass);
    expect(input('Amount').value).toBe('3');
    expect(input('Equivalents').value).toBe('');
    input('Limiting reagent').value = '2';
    fire(input('Limiting reagent'));
    expect(input('Equivalents').value).toBe('1.5');
  });
});
