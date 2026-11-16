// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { COL_MAX, COL_MIN, moveColumn, orderColumns, parseKbLayouts } from '../src/kb/tables';
import { parseSettings } from '../src/settings';

describe('Knowledge Base column layout', () => {
  it('keeps the saved order, drops columns gone, and slots new ones after their default neighbor', () => {
    expect(orderColumns(['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
    expect(orderColumns(['a', 'b', 'c'], ['c', 'a', 'b'])).toEqual(['c', 'a', 'b']);
    expect(orderColumns(['a', 'b'], ['b', 'gone', 'a'])).toEqual(['b', 'a']);
    // d is new: it follows c, wherever c went
    expect(orderColumns(['a', 'b', 'c', 'd'], ['c', 'a', 'b'])).toEqual(['c', 'd', 'a', 'b']);
    // a new first column goes first
    expect(orderColumns(['z', 'a', 'b'], ['b', 'a'])).toEqual(['z', 'b', 'a']);
    expect(orderColumns(['a', 'b'], ['a', 'a', 'b'])).toEqual(['a', 'b']);
  });

  it('moves a column to an edge between columns', () => {
    const k = ['a', 'b', 'c', 'd'];
    expect(moveColumn(k, 'a', 2)).toEqual(['b', 'a', 'c', 'd']);
    expect(moveColumn(k, 'a', 4)).toEqual(['b', 'c', 'd', 'a']);
    expect(moveColumn(k, 'd', 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(moveColumn(k, 'c', 1)).toEqual(['a', 'c', 'b', 'd']);
    expect(moveColumn(k, 'b', 1)).toEqual(k);
    expect(moveColumn(k, 'x', 0)).toEqual(k);
  });

  it('reads saved layouts back, keeping only sensible values', () => {
    expect(parseKbLayouts(null)).toEqual({});
    expect(parseKbLayouts({ pka: { order: ['name', 3, 'pka'], widths: { name: 5, pka: 120.4, x: 'wide', y: 5000 } }, bad: 7, empty: {} }))
      .toEqual({ pka: { order: ['name', 'pka'], widths: { name: COL_MIN, pka: 120, y: COL_MAX } } });
    const s = parseSettings(JSON.stringify({ kbColumns: { solvents: { order: ['bp', 'name'] } } }));
    expect(s.kbColumns).toEqual({ solvents: { order: ['bp', 'name'] } });
    expect(parseSettings(null).kbColumns).toEqual({});
  });
});

// ---- the window: right-click a heading, columns kept per table
import { afterEach } from 'vitest';
import type { KbLayout } from '../src/kb/tables';
import { BUILT_IN_TABLES } from '../src/kb/data';
import { KnowledgeBaseWindow, type KnowledgeBaseHost } from '../src/ui/knowledge-base';

describe('Knowledge Base headings', { timeout: 30000 }, () => {
  afterEach(() => { document.body.replaceChildren(); });

  async function open(saved: Record<string, KbLayout>): Promise<void> {
    if (!HTMLDialogElement.prototype.show) HTMLDialogElement.prototype.show = function () { this.open = true; };
    if (!HTMLDialogElement.prototype.close) HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new Event('close')); };
    const host: KnowledgeBaseHost = {
      flash: () => {}, readImported: async () => null, writeImported: async () => {}, pickTable: async () => null, copyText: async () => {}, openUrl: () => {},
      canonical: async () => null,
      layout: { get: (id) => saved[id], set: (id, l) => { if (l) saved[id] = l; else delete saved[id]; } },
    };
    await new KnowledgeBaseWindow(host).open();
  }
  const heads = () => [...document.querySelectorAll<HTMLElement>('.kb-window thead th')].map((th) => th.dataset.col);
  const menu = (th: HTMLElement, label: string) => {
    th.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
    [...document.querySelectorAll<HTMLButtonElement>('.context-menu button')].find((b) => b.textContent?.startsWith(label))!.click();
  };

  it('moves a column from the right-click menu and keeps the order for the table', async () => {
    const saved: Record<string, KbLayout> = {};
    await open(saved);
    const before = heads();
    menu(document.querySelector<HTMLElement>('.kb-window thead th')!, 'Move Column Right');
    const after = heads();
    expect(after.slice(0, 2)).toEqual([before[1], before[0]]);
    const id = Object.keys(saved)[0];
    expect(saved[id].order?.slice(0, 2)).toEqual([before[1], before[0]]);
    // rows follow their headings
    const row = document.querySelector<HTMLElement>('.kb-window tbody tr:not(.kb-group)')!;
    expect([...row.children].map((td) => (td as HTMLElement).dataset.col)).toEqual(after);
    menu(document.querySelector<HTMLElement>('.kb-window thead th')!, 'Reset Column Widths and Order');
    expect(heads()).toEqual(before);
    expect(saved).toEqual({});
  });

  it('draws a column at the width kept for it, and Fit Column to Contents lets it go', async () => {
    const saved: Record<string, KbLayout> = {};
    await open(saved);
    const key = heads()[0]!;
    document.body.replaceChildren();
    const id = BUILT_IN_TABLES[0].id;
    saved[id] = { widths: { [key]: 222 } };
    await open(saved);
    const th = document.querySelector<HTMLElement>(`.kb-window thead th[data-col="${key}"]`)!;
    expect(th.classList.contains('kb-sized')).toBe(true);
    expect(th.style.width).toBe('222px');
    expect(document.querySelector<HTMLElement>(`.kb-window tbody td[data-col="${key}"]`)!.style.width).toBe('222px');
    menu(th, 'Fit Column to Contents');
    expect(saved[id]).toBeUndefined();
    expect(document.querySelector<HTMLElement>(`.kb-window thead th[data-col="${key}"]`)!.style.width).toBe('');
  });
});
