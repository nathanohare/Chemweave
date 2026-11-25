// The toolboxes as they come: every one fills whole rows of its grid (no empty cells), and none
// holds a command that only edits or sets up one selected object.
import { describe, expect, it } from 'vitest';
import { BOX_COLS, BOX_DEFAULTS, NOT_IN_TOOLBOXES, fullCols } from '../src/ui/toolbox-defaults';
import { listToGrid } from '../src/ui/toolbox-grid';
import { boxGrid, defaultToolboxes, isEditable, parseToolboxes } from '../src/ui/toolboxes';
import { toolboxScaleOf, parseSettings, TOOLBOX_SCALE_MIN, TOOLBOX_SCALE_MAX } from '../src/settings';

describe('the toolboxes as they come', () => {
  it('fill every cell of their grids', () => {
    for (const [id, items] of Object.entries(BOX_DEFAULTS)) {
      const g = boxGrid(defaultToolboxes(), id, items);
      expect(g.cols, id).toBe(BOX_COLS[id]);
      expect(g.cells.filter((k) => !k), id).toEqual([]);
      expect(g.lines ?? [], id).toEqual([]);
      expect(new Set(items).size, id).toBe(items.length);
    }
    // My Toolbox too
    const mine = defaultToolboxes().custom;
    expect(listToGrid(mine, BOX_COLS.custom).cells.every(Boolean)).toBe(true);
  });

  it('hold no command that only edits or sets up one selected object', () => {
    const all = Object.values(BOX_DEFAULTS).flat();
    for (const cmd of NOT_IN_TOOLBOXES) expect(all, cmd).not.toContain(`cmd:${cmd}`);
    // nor any other command named as editing or setting up something
    for (const k of all) expect(k).not.toMatch(/^cmd:(edit-|unlink-|.*-(settings|options)$)/);
    // Insert Diagram is on the ribbon's Insert tab
    expect(all).not.toContain('cmd:insert-diagram');
  });

  it('lay the Highlight toolbox out themselves: a grid saved for it earlier is not used', () => {
    expect(isEditable('highlight')).toBe(false);
    const st = parseToolboxes({ grids: { highlight: { cols: 8, rows: 1, cells: ['cmd:highlight'] }, structure: { cols: 2, rows: 1, cells: ['cmd:clean-up', null] } } });
    expect(st.grids?.highlight).toBeUndefined();
    // nor a list of buttons saved for it before grids
    expect(parseToolboxes({ items: { highlight: ['cmd:highlight', 'sep', 'w:looks'], structure: ['cmd:clean-up'] } }).items?.highlight).toBeUndefined();
    // a toolbox you laid out yourself keeps its grid, gaps and all
    expect(st.grids?.structure?.cells).toEqual(['cmd:clean-up', null]);
  });
});

describe('a toolbox whose buttons changed', () => {
  it('takes the nearest width that fills whole rows', () => {
    // as it comes when that divides the count
    expect(fullCols(14, 7)).toBe(7);
    expect(fullCols(16, 4)).toBe(4);
    expect(fullCols(5, 7)).toBe(7);
    // one family of templates more or fewer: 15 = 5 x 3, 12 = 6 x 2, 16 = 8 x 2
    expect(fullCols(15, 7)).toBe(5);
    expect(fullCols(12, 7)).toBe(6);
    expect(fullCols(16, 7)).toBe(8);
    // 13 buttons fill no width from 3 to 8: the width it comes with
    expect(fullCols(13, 7)).toBe(7);
  });

  it('is laid out at that width', () => {
    const fifteen = Array.from({ length: 15 }, (_, i) => `pal:tpl-${i}`);
    const g = boxGrid(defaultToolboxes(), 'templates', fifteen);
    expect(g.cols).toBe(5);
    expect(g.cells.every(Boolean)).toBe(true);
  });
});

describe('a toolbox you filled yourself before toolboxes had grids', () => {
  it('keeps the width it had: one row for each group', () => {
    const st = { ...defaultToolboxes(), custom: ['cmd:a', 'cmd:b', 'cmd:c', 'cmd:d', 'cmd:e', 'cmd:f'] };
    const g = boxGrid(st, 'custom', st.custom);
    expect([g.cols, g.rows]).toEqual([6, 1]);
    const s2 = { ...defaultToolboxes(), items: { structure: ['cmd:a', 'cmd:b', 'sep', 'cmd:c', 'cmd:d', 'cmd:e'] } };
    const g2 = boxGrid(s2, 'structure', BOX_DEFAULTS.structure);
    expect([g2.cols, g2.rows]).toEqual([3, 2]);
  });
});

describe('Toolbox Button Size', () => {
  it('is a whole percent within its limits, 100 when it is no number', () => {
    expect(toolboxScaleOf(100)).toBe(100);
    expect(toolboxScaleOf('85')).toBe(85);
    // (below about 75% a button is too small to hit)
    expect(TOOLBOX_SCALE_MIN).toBeGreaterThanOrEqual(75);
    expect(toolboxScaleOf(132.6)).toBe(133);
    expect(toolboxScaleOf(5)).toBe(TOOLBOX_SCALE_MIN);
    expect(toolboxScaleOf(9999)).toBe(TOOLBOX_SCALE_MAX);
    for (const bad of ['', 'big', null, undefined, NaN, Infinity, {}]) expect(toolboxScaleOf(bad)).toBe(100);
  });

  it('is read from the saved settings', () => {
    expect(parseSettings('{}').toolboxScale).toBe(100);
    expect(parseSettings(JSON.stringify({ toolboxScale: 150, webLook: 1 })).toolboxScale).toBe(150);
    expect(parseSettings(JSON.stringify({ toolboxScale: 'x', webLook: 1 })).toolboxScale).toBe(100);
    expect(parseSettings(JSON.stringify({ toolboxScale: 100000, webLook: 1 })).toolboxScale).toBe(TOOLBOX_SCALE_MAX);
  });
});
