// @vitest-environment jsdom
//
// Review batch 20, the Smart Scheme species list:
//  F796 + Add uses the row last typed in only on the scheme it was typed in (and only while that row exists);
//  F797 dragging the title stops when the system cancels the drag.
import { describe, it, expect, vi, beforeAll } from 'vitest';

const menu = vi.hoisted(() => ({ items: [] as [string, () => void][] }));
vi.mock('../src/ui/popup-menu', () => ({ popupMenu: (_x: number, _y: number, items: [string, () => void][]) => { menu.items = items; } }));

import { Doc } from '../src/model';
import { plainMeasure } from '../src/chem/reaction';
import { arrangeSmart, makeSmart } from '../src/chem/smart-scheme';
import { SmartPane, type SmartPaneHooks } from '../src/ui/smart-pane';
import type { Selection } from '../src/editor/arrange';

beforeAll(() => {
  // (jsdom has no isContentEditable, and a box that is only contenteditable can't have the focus)
  if (document.createElement('div').isContentEditable === undefined) {
    Object.defineProperty(HTMLElement.prototype, 'isContentEditable', { configurable: true, get(this: HTMLElement) { return this.contentEditable === 'true'; } });
  }
  const focus = HTMLElement.prototype.focus;
  HTMLElement.prototype.focus = function (this: HTMLElement, o?: FocusOptions) { if (this.isContentEditable && !this.hasAttribute('tabindex')) this.setAttribute('tabindex', '-1'); focus.call(this, o); };
  (Element.prototype as unknown as { setPointerCapture: () => void }).setPointerCapture ??= () => undefined;
});

const sel = (): Selection => ({ atoms: new Set(), bonds: new Set(), captions: new Set(), arrows: new Set(), shapes: new Set() });

/** Two Smart Schemes in a line, one under the other: `names` each. */
function setup(first: string[], second: string[]) {
  document.body.replaceChildren();
  const doc = new Doc();
  const m = plainMeasure(doc);
  const ids: number[] = [];
  doc.edit('make', () => {
    [first, second].forEach((names, row) => {
      const s = sel();
      const caps = names.map((t, i) => doc.addCaption({ x: 100 + i * 150, y: 100 + row * 300, runs: [{ text: t }], justify: 'center' }));
      for (const c of caps) s.captions.add(c.id);
      for (let i = 0; i + 1 < caps.length; i++) s.arrows.add(doc.addArrow({
        headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'solid', noGo: false, equilibrium: false, sweep: 0, headLength: 6, headWidth: 1.5,
        tail: { x: 135 + i * 150, y: 100 + row * 300 }, head: { x: 215 + i * 150, y: 100 + row * 300 }, step: { reactants: ['c' + caps[i].id], products: ['c' + caps[i + 1].id], above: [], below: [], manual: true },
      }).id);
      const id = makeSmart(doc, m, s)!;
      arrangeSmart(doc, m, id, { layout: 'line' });
      ids.push(id);
    });
  });
  let shown = ids[0];
  const added: [number, number][] = [];
  const docked: unknown[] = [];
  const noop = () => undefined;
  const hooks = {
    doc: () => doc, measure: () => m, selected: () => shown,
    screenRect: (r: unknown) => r, area: () => ({ x1: 0, y1: 0, x2: 1000, y2: 800 }), work: () => new DOMRect(0, 0, 1000, 800),
    add: (f: number, after: number) => { added.push([f, after]); },
    dock: (d: unknown) => { docked.push(d); },
    slotRuns: noop, remove: noop, move: noop, picked: () => undefined, hot: noop,
    stepRuns: noop, toStructure: noop, toText: noop, stepToStructure: noop, stepToText: noop, selectHolder: noop, arrange: noop, format: noop, ungroup: noop,
    addLoop: noop, removeLoop: noop, addBranch: noop, removeBranch: noop, reverseStep: noop, loopMiddle: noop, stepNames: noop, cleanUpCycle: noop,
  } as unknown as SmartPaneHooks;
  const pane = new SmartPane(hooks);
  pane.refresh();
  return { pane, ids, show: (i: number) => { shown = ids[i]; pane.refresh(); }, added, docked };
}

describe('F796: + Add', () => {
  it('puts a species at the end of the scheme shown, not after a row typed in on another scheme', () => {
    const t = setup(['A', 'B', 'C', 'D', 'E', 'F'], ['X', 'Y', 'Z']);
    document.querySelector<HTMLElement>('.sp-rich[data-key="s5"]')!.focus();
    t.show(1);
    document.querySelector<HTMLButtonElement>('.sp-add-menu')!.click();
    menu.items.find(([label]) => label === 'Species')![1]();
    expect(t.added).toEqual([[t.ids[1], 2]]);
  });

  it('still adds after the row being typed in, on the scheme it was typed in', () => {
    const t = setup(['A', 'B', 'C', 'D'], ['X', 'Y', 'Z']);
    document.querySelector<HTMLElement>('.sp-rich[data-key="s1"]')!.focus();
    document.querySelector<HTMLButtonElement>('.sp-add-menu')!.click();
    menu.items.find(([label]) => label === 'Species')![1]();
    expect(t.added).toEqual([[t.ids[0], 1]]);
  });
});

describe('F797: dragging the title', () => {
  const mouse = (type: string, x: number, y: number) => new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1 });

  it('stops following the pointer when the drag is cancelled, and docks nowhere', () => {
    const t = setup(['A', 'B'], ['X', 'Y']);
    const head = document.querySelector<HTMLElement>('.smart-pane .sp-head')!;
    const pane = document.querySelector<HTMLElement>('.smart-pane')!;
    head.dispatchEvent(mouse('pointerdown', 100, 100));
    head.dispatchEvent(mouse('pointermove', 160, 140));
    const left = pane.style.left;
    expect(left).not.toBe('');
    head.dispatchEvent(new Event('pointercancel', { bubbles: true }));
    head.dispatchEvent(mouse('pointermove', 400, 300));
    expect(pane.style.left).toBe(left);
    expect(t.docked).toHaveLength(0);
  });
});
