// @vitest-environment jsdom
//
// The Energy Diagram window takes names as rich text (G3-02), as the MO Diagram window does: a
// compound's bold number (3a), an italic word, a subscript, set with the bar or Ctrl+B, Ctrl+I and
// Ctrl+U. The names are drawn with their looks, and opened again in the window with them.
// (Energies are made up: only the names matter here.)

import { describe, it, expect, beforeAll, vi } from 'vitest';

// (the font list's font files can't be loaded by the test runner here: the window's font list is left empty)
vi.mock('../src/fonts', () => ({ FONT_GROUPS: [] }));
import { askEnergy } from '../src/ui/energy-dialog';
import { labelFromParts, labelParts, putEnergy, type EnergyData } from '../src/design/energy';
import { Doc } from '../src/model';
import { plainMeasure } from '../src/chem/reaction';

beforeAll(() => {
  const dlg = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  dlg.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
  dlg.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open'); };
});

const tick = () => new Promise((r) => setTimeout(r, 0));
const data = (): EnergyData => ({
  quantity: 'ΔG', unit: 'kcal/mol', style: 'levels', values: true, digits: 1, axis: true, barrier: false, w: 300, h: 180,
  paths: [{ name: '', color: '#000000', points: [
    { label: '3a', rich: [{ text: '3a', bold: true }], g: 0 },
    { label: 'TS1‡', g: 20 },
    { label: 'CH3OH', g: -5 },
  ] }],
});

describe('names in the Energy Diagram window', () => {
  it('a name as pieces keeps its text as the drawing reads it, and its looks', () => {
    expect(labelFromParts([{ text: 'CH' }, { text: '3', sub: true }, { text: 'OH' }])).toEqual({ label: 'CH3OH' });
    expect(labelFromParts([{ text: '3a', bold: true }])).toEqual({ label: '3a', rich: [{ text: '3a', bold: true }] });
    expect(labelFromParts([{ text: 'TS' }, { text: '‡', sup: true }]).label).toBe('TS^{‡}');
    // looks kept only while the words are the same
    expect(labelParts('3b', [{ text: '3a', bold: true }])).toEqual([{ text: '3b' }]);
    expect(labelParts('3a', [{ text: '3a', bold: true }])).toEqual([{ text: '3a', bold: true }]);
  });

  it('draws a name with its looks (bold 3a, the 3 of CH3OH lowered)', () => {
    const doc = new Doc();
    let id = 0;
    doc.edit('Energy', () => { id = putEnergy(doc, plainMeasure(doc), data(), { x: 100, y: 100 }); });
    const caps = doc.shapes.get(id)!.frame!.captions.map((c) => doc.captions.get(c)!);
    const a = caps.find((c) => c.runs.map((r) => r.text).join('') === '3a')!;
    expect(a.runs.every((r) => r.bold)).toBe(true);
    const m = caps.find((c) => c.runs.map((r) => r.text).join('') === 'CH3OH')!;
    expect(m.runs.find((r) => r.text === '3')?.sub).toBe(true);
  });

  it('shows names with their looks, and the bar makes a selected name bold', async () => {
    const got = askEnergy(data(), { w: 300, h: 180 });
    await tick();
    const d = document.querySelector<HTMLDialogElement>('dialog.energy-dialog')!;
    const names = [...d.querySelectorAll<HTMLElement>('.energy-table tbody [data-l]')];
    expect(names).toHaveLength(3);
    expect(names[0].getAttribute('role')).toBe('textbox');
    expect(names[0].querySelector('b, strong, [style*="bold"]')).not.toBeNull();
    // TS1‡ selected, Bold
    names[1].focus();
    const t = names[1].firstChild!.nodeType === Node.TEXT_NODE ? names[1].firstChild! : document.createTreeWalker(names[1], NodeFilter.SHOW_TEXT).nextNode()!;
    const all = document.createRange();
    all.selectNodeContents(names[1]);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(all);
    expect(t).toBeTruthy();
    d.querySelector<HTMLButtonElement>('.energy-bar [data-look=bold]')!.click();
    d.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    const out = (await got)!;
    const pts = out.paths[0].points;
    expect(pts[0]).toMatchObject({ label: '3a', rich: [{ text: '3a', bold: true }] });
    expect(pts[1].label).toBe('TS1‡');
    expect(pts[1].rich?.every((p) => p.bold)).toBe(true);
    expect(pts[2]).toMatchObject({ label: 'CH3OH' });
    expect(pts[2].rich).toBeUndefined();
  });
});
