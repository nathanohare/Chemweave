// @vitest-environment jsdom
//
// Review batch 20, dashboards:
//  F690 Duplicate gives a chart tile's copy its own chart id (the id is the key its data is saved under in .xlsx);
//  F692 the Columns box keeps the tiles inside the grid it really makes (at most 24 columns);
//  F694 the last column of a table tile can't be unchecked (an empty list means every column);
//  F695 a table tile reads its sort column's values once for a sort, not at every comparison.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const menu = vi.hoisted(() => ({ items: [] as unknown[] }));
vi.mock('../src/ui/sheet-view', () => ({ popupMenu: (_x: number, _y: number, items: unknown[]) => { menu.items = items; } }));
const texts = vi.hoisted(() => ({ calls: 0 }));
vi.mock('../src/sheet/dashboard', async (orig) => {
  const m = await orig<typeof import('../src/sheet/dashboard')>();
  return { ...m, slicerText: (v: never) => { texts.calls++; return m.slicerText(v); } };
});

import { Workbook } from '../src/sheet/workbook';
import { newTable } from '../src/sheet/table-styles';
import { newDashboard, type ChartTile, type Tile, type TableTile, type Dashboard } from '../src/sheet/dashboard';
import { chartOfColumns, resolveSource } from '../src/sheet/dashboard';
import { DashboardUi } from '../src/ui/dashboard-ui';
import { DashboardView, type DashHost } from '../src/ui/dashboard-view';

/** A table T1 of `rows` rows (Name, Score) on the first sheet, and a dashboard on the second. */
function workbook(rows: number, name: (r: number) => string = (r) => `Row ${r}`): Workbook {
  const wb = new Workbook(['Data', 'Dash']);
  const s = wb.sheets[0];
  wb.edit('fill', () => {
    s.setInput(0, 0, 'Name');
    s.setInput(0, 1, 'Score');
    for (let r = 1; r <= rows; r++) { s.setInput(r, 0, name(r)); s.setInput(r, 1, String(r % 7)); }
    s.setTables([{ ...newTable({ r1: 0, c1: 0, r2: rows, c2: 1 }, []), name: 'T1' }]);
  });
  return wb;
}

/** What the dashboard panel and menu need of the sheet view: the dashboard sheet, and changes to it (as one undoable step). */
function ui(wb: Workbook, dash: Dashboard, picked: Tile | null) {
  const sheet = wb.sheets[1];
  sheet.dashboard = dash;
  const change = (d: Dashboard) => wb.edit('change', () => sheet.setDashboard(d));
  const view = {
    sheet, wb, place: () => undefined, focus: () => undefined,
    dash: {
      get pickedTile() { return picked; },
      pick: (id: number) => { picked = sheet.dashboard!.tiles.find((t) => t.id === id) ?? null; },
      update: (id: number, patch: Partial<Tile>) => { const d = sheet.dashboard!; change({ ...d, tiles: d.tiles.map((t) => (t.id === id ? ({ ...t, ...patch } as Tile) : t)) }); picked = sheet.dashboard!.tiles.find((t) => t.id === id) ?? null; },
      remove: () => undefined,
    },
  };
  const charts = { menuItems: () => [], panel: () => [], target: null };
  return { dui: new DashboardUi({ view, charts, flash: () => undefined } as never), sheet };
}

describe('F690: Duplicate of a chart tile', () => {
  it('gives the copy a chart id of its own', () => {
    const wb = workbook(6);
    const chart = chartOfColumns(resolveSource(wb, { table: 'T1' })!, 'column', 'Name', ['Score'], 105);
    const tile: ChartTile = { id: 11, kind: 'chart', x: 0, y: 0, w: 6, h: 5, chart };
    const { dui, sheet } = ui(wb, { ...newDashboard(), tiles: [tile] }, tile);
    dui.contextMenu(0, 0);
    const duplicate = (menu.items as ([string, () => void] | null)[]).find((m) => m && m[0] === 'Duplicate')!;
    duplicate[1]();
    const charts = sheet.dashboard!.tiles.filter((t): t is ChartTile => t.kind === 'chart');
    expect(charts).toHaveLength(2);
    expect(new Set(charts.map((t) => t.chart.id)).size).toBe(2);
    expect(new Set(charts.map((t) => t.id)).size).toBe(2);
  });
});

describe('F692: the Columns box', () => {
  it('keeps tiles inside the 24 columns it makes when more are typed', () => {
    const wb = workbook(3);
    const tile: TableTile = { id: 5, kind: 'table', x: 20, y: 0, w: 6, h: 4, source: { table: 'T1' } };
    const { dui, sheet } = ui(wb, { ...newDashboard(), cols: 24, tiles: [tile] }, null);
    const [section] = [document.createElement('div')];
    section.append(...dui.panel());
    const columns = [...section.querySelectorAll('.cp-row')].find((r) => r.firstElementChild?.textContent === 'Columns')!.querySelector('input')!;
    columns.value = '30';
    columns.dispatchEvent(new Event('change'));
    const d = sheet.dashboard!;
    expect(d.cols).toBe(24);
    expect(d.tiles[0].x + d.tiles[0].w).toBeLessThanOrEqual(24);
  });
});

describe('F694: the columns of a table tile', () => {
  const boxes = (dui: DashboardUi) => {
    const section = document.createElement('div');
    section.append(...dui.panel());
    return [...section.querySelectorAll<HTMLInputElement>('.cp-row input[type=checkbox]')].slice(0, 2);
  };

  it('keeps the last column checked, and the tile showing it', () => {
    const wb = workbook(3);
    const tile: TableTile = { id: 5, kind: 'table', x: 0, y: 0, w: 6, h: 4, source: { table: 'T1' } };
    const { dui, sheet } = ui(wb, { ...newDashboard(), tiles: [tile] }, tile);
    const columnsOf = () => (sheet.dashboard!.tiles[0] as TableTile).columns;
    let [name, score] = boxes(dui);
    name.checked = false;
    name.dispatchEvent(new Event('change'));
    expect(columnsOf()).toEqual(['Score']);
    [name, score] = boxes(dui);
    expect([name.checked, score.checked]).toEqual([false, true]);
    // the last one stays: an empty list would mean every column
    score.checked = false;
    score.dispatchEvent(new Event('change'));
    expect(columnsOf()).toEqual(['Score']);
    expect(score.checked).toBe(true);
  });
});

describe('F695: a table tile sorted by a text column', () => {
  let frames: FrameRequestCallback[] = [];
  beforeEach(() => {
    frames = [];
    texts.calls = 0;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.push(cb); return frames.length; });
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => null) as never);
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  const shown = (wb: Workbook, descending: boolean) => {
    const tile: TableTile = { id: 5, kind: 'table', x: 0, y: 0, w: 12, h: 12, source: { table: 'T1' }, sortBy: 'Name', descending, maxRows: 5 };
    wb.sheets[1].dashboard = { ...newDashboard(), tiles: [tile] };
    const h = { wb, zoom: 1, structureBox: () => ({ w: 1, h: 1 }), structureBitmap: () => null, setDashboard: () => {}, picked: () => {}, open: () => {}, contextMenu: () => {}, flash: () => {}, key: () => false } as DashHost;
    const view = new DashboardView(document.body, h);
    view.show(wb.sheets[1]);
    while (frames.length) { const f = frames; frames = []; for (const cb of f) cb(0); }
    return [...view.el.querySelectorAll('.dash-table tbody tr')].map((tr) => tr.firstElementChild!.textContent);
  };

  it('reads each row\'s text once for the whole sort', () => {
    const n = 1500;
    const wb = workbook(n);
    // (the number of reads is counted from the app's own module; the order is checked below)
    shown(wb, false);
    expect(texts.calls).toBeLessThanOrEqual(n);
  });

  it('still sorts numbers inside the text in order (item 2 before item 10), and either way round', () => {
    const wb = workbook(12, (r) => `item ${r}`);
    expect(shown(wb, false)).toEqual(['item 1', 'item 2', 'item 3', 'item 4', 'item 5']);
    expect(shown(wb, true)).toEqual(['item 12', 'item 11', 'item 10', 'item 9', 'item 8']);
  });
});
