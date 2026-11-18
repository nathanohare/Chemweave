// @vitest-environment jsdom
//
// Typing a scheme in the Smart Scheme pane without the mouse (2026-11-18): Enter goes on to the
// next species and adds one at the end of a line or a branch, Alt+Up and Alt+Down move a species
// along its route, Backspace in an emptied row takes the species out, and the row of the species
// picked on the page is marked.

import { describe, expect, it } from 'vitest';
import { Doc } from '../src/model';
import { plainMeasure } from '../src/chem/reaction';
import { addBranch, arrangeSmart, insertSlot, makeSmart, moveSlot, readSmart, removeSlot, setSlotRuns, slotName, type TextPart } from '../src/chem/smart-scheme';
import { SmartPane, type SmartPaneHooks } from '../src/ui/smart-pane';
import type { Selection } from '../src/editor/arrange';

const sel = (): Selection => ({ atoms: new Set(), bonds: new Set(), captions: new Set(), arrows: new Set(), shapes: new Set() });

function setup(names: string[]) {
  // (jsdom has no isContentEditable)
  if (document.createElement('div').isContentEditable === undefined) {
    Object.defineProperty(HTMLElement.prototype, 'isContentEditable', { configurable: true, get(this: HTMLElement) { return this.contentEditable === 'true'; } });
  }
  document.body.replaceChildren();
  const doc = new Doc();
  const m = plainMeasure(doc);
  const s = sel();
  let id = 0;
  doc.edit('make', () => {
    const caps = names.map((t, i) => doc.addCaption({ x: 100 + i * 150, y: 100, runs: [{ text: t }], justify: 'center' }));
    for (const c of caps) s.captions.add(c.id);
    for (let i = 0; i + 1 < caps.length; i++) s.arrows.add(doc.addArrow({
      headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'solid', noGo: false, equilibrium: false, sweep: 0, headLength: 6, headWidth: 1.5,
      tail: { x: 135 + i * 150, y: 100 }, head: { x: 215 + i * 150, y: 100 }, step: { reactants: ['c' + caps[i].id], products: ['c' + caps[i + 1].id], above: [], below: [], manual: true },
    }).id);
    id = makeSmart(doc, m, s)!;
    arrangeSmart(doc, m, id, { layout: 'line' });
  });
  const noop = () => {};
  let pane!: SmartPane;
  let picked: { slot?: number; step?: number } | undefined;
  const hot: (number | null)[] = [];
  const hooks = {
    doc: () => doc, measure: () => m, selected: () => id,
    screenRect: (r: { x1: number; y1: number; x2: number; y2: number }) => r, area: () => ({ x1: 0, y1: 0, x2: 1000, y2: 800 }),
    work: () => new DOMRect(0, 0, 1000, 800),
    slotRuns: (f: number, k: number, parts: TextPart[]) => { doc.edit('Type Species', () => setSlotRuns(doc, m, f, k, parts)); pane.refresh(); },
    // (as the editor does: the new species' row takes the caret)
    add: (f: number, after: number, link?: number) => { let cap: number | null = null; doc.edit('Add Species', () => { cap = insertSlot(doc, m, f, after, 'new species', link); }); if (cap !== null) pane.focusCaption(f, cap); },
    remove: (f: number, k: number) => { doc.edit('Remove Species', () => removeSlot(doc, m, f, k)); pane.refresh(); },
    move: (f: number, from: number, to: number) => { doc.edit('Move Species', () => moveSlot(doc, m, f, from, to)); pane.refresh(); },
    picked: () => picked,
    hot: (_f: number, slot: number | null) => { hot.push(slot); },
    stepRuns: noop, toStructure: noop, toText: noop, stepToStructure: noop, stepToText: noop, selectHolder: noop, dock: noop, arrange: noop, format: noop, ungroup: noop,
    addLoop: noop, removeLoop: noop, addBranch: noop, removeBranch: noop, reverseStep: noop, loopMiddle: noop, stepNames: noop, cleanUpCycle: noop,
  } as unknown as SmartPaneHooks;
  pane = new SmartPane(hooks);
  pane.refresh();
  const names2 = () => readSmart(doc, m, id)!.slots.map((sl) => slotName(doc, sl));
  const field = (key: string) => document.querySelector<HTMLElement>(`.smart-pane .sp-rich[data-key="${key}"]`)!;
  const type = (key: string, text: string) => { const f = (pane as unknown as { fields: Map<string, { insert(t: string): void; select(a: number, b?: number): void; text(): string }> }).fields.get(key)!; f.select(0, f.text().length); f.insert(text); };
  const press = (key: string, init: KeyboardEventInit = {}) => (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
  const at = () => (document.activeElement as HTMLElement | null)?.dataset.key;
  return { doc, m, id, pane, names: names2, field, type, press, at, hot, pick: (p: typeof picked) => { picked = p; pane.refresh(); } };
}

describe('typing a scheme in the Smart Scheme pane', () => {
  it('goes on to the next species on Enter, and adds one after the last', () => {
    const t = setup(['A', 'B', 'C']);
    t.field('s0').focus();
    t.type('s0', 'PhBr');
    t.press('Enter');
    expect(t.names()[0]).toBe('PhBr');
    expect(t.at()).toBe('s1');
    t.press('Enter');
    expect(t.at()).toBe('s2');
    // the last species: a new one after it, its row with the caret
    t.press('Enter');
    expect(t.names()).toEqual(['PhBr', 'B', 'C', 'new species']);
    expect(t.at()).toBe('s3');
    // the caret never leaves the pane (keys typed next are text, not the drawing's shortcuts)
    expect(document.querySelector('.smart-pane')!.contains(document.activeElement)).toBe(true);
  });

  it('goes from a step\'s conditions on to the next species', () => {
    const t = setup(['A', 'B', 'C']);
    t.field('p0above').focus();
    t.press('Enter');
    expect(t.at()).toBe('s1');
  });

  it('moves a species along its route with Alt+Up and Alt+Down, keeping the caret with it', () => {
    const t = setup(['A', 'B', 'C']);
    t.field('s2').focus();
    t.press('ArrowUp', { altKey: true });
    expect(t.names()).toEqual(['A', 'C', 'B']);
    expect(t.at()).toBe('s1');
    t.press('ArrowUp', { altKey: true });
    expect(t.names()).toEqual(['C', 'A', 'B']);
    expect(t.at()).toBe('s0');
    // (nowhere further to go)
    t.press('ArrowUp', { altKey: true });
    expect(t.names()).toEqual(['C', 'A', 'B']);
    t.press('ArrowDown', { altKey: true });
    expect(t.names()).toEqual(['A', 'C', 'B']);
    expect(t.at()).toBe('s1');
  });

  it('takes a species out on Backspace in its emptied row, with the caret in the row before', () => {
    const t = setup(['A', 'B', 'C']);
    t.field('s1').focus();
    t.type('s1', '');
    t.press('Backspace');
    expect(t.names()).toEqual(['A', 'C']);
    expect(t.at()).toBe('s0');
    // one of the last two stays (a scheme keeps two species)
    t.type('s0', '');
    t.press('Backspace');
    expect(t.names()).toEqual(['A', 'C']);
  });

  it('adds to the end of a branch on Enter there, and goes on down the list from a species with a step leading on', () => {
    const t = setup(['A', 'B', 'C']);
    t.doc.edit('branch', () => { addBranch(t.doc, t.m, t.id, 1, 'out', 'D'); });
    t.pane.refresh();
    expect([...document.querySelectorAll('.smart-pane .sp-loop-name')].map((x) => x.textContent)).toEqual(['Main Route', 'Branch']);
    expect(document.querySelector('.smart-pane .sp-loop-how')!.textContent).toBe('from 2');
    const d = t.names().indexOf('D');
    t.field(`s${d}`).focus();
    t.press('Enter');
    expect(t.names()).toContain('new species');
    const read = readSmart(t.doc, t.m, t.id)!;
    expect(read.tree!.runs[0].slots.map((k) => t.names()[k])).toEqual(['A', 'B', 'C']);
    expect(read.tree!.runs[1].slots.map((k) => t.names()[k])).toEqual(['D', 'new species']);
  });

  it('marks the row of the species picked on the page, and tells the page which row the caret is in', () => {
    const t = setup(['A', 'B', 'C']);
    t.pick({ slot: 1 });
    expect([...document.querySelectorAll<HTMLElement>('.smart-pane .sp-picked')].map((x) => x.dataset.k)).toEqual(['1']);
    t.pick({ step: 0 });
    expect([...document.querySelectorAll<HTMLElement>('.smart-pane .sp-picked')].map((x) => x.dataset.step)).toEqual(['0']);
    t.pick(undefined);
    expect(document.querySelectorAll('.smart-pane .sp-picked')).toHaveLength(0);
    t.field('s2').focus();
    expect(t.hot[t.hot.length - 1]).toBe(2);
  });
});
