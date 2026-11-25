// The toolboxes as they come: every one fills whole rows of its grid (no empty cells), and none
// holds a command that only edits or sets up one selected object.
import { describe, expect, it } from 'vitest';
import { BOX_COLS, BOX_DEFAULTS, NOT_IN_TOOLBOXES } from '../src/ui/toolbox-defaults';
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
    // Insert Diagram is on the ribbon's Insert tab
    expect(all).not.toContain('cmd:insert-diagram');
  });

  it('lay the Highlight toolbox out themselves: a grid saved for it earlier is not used', () => {
    expect(isEditable('highlight')).toBe(false);
    const st = parseToolboxes({ grids: { highlight: { cols: 8, rows: 1, cells: ['cmd:highlight'] }, structure: { cols: 2, rows: 1, cells: ['cmd:clean-up', null] } } });
    expect(st.grids?.highlight).toBeUndefined();
    // a toolbox you laid out yourself keeps its grid, gaps and all
    expect(st.grids?.structure?.cells).toEqual(['cmd:clean-up', null]);
  });
});

describe('Toolbox Button Size', () => {
  it('is a whole percent within its limits, 100 when it is no number', () => {
    expect(toolboxScaleOf(100)).toBe(100);
    expect(toolboxScaleOf('85')).toBe(85);
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
