// UI audit 2026-11-16, U2 and U4: fly-outs of your own in Customize Toolboxes, the side panel
// floating at the top right to start with, and Ctrl to float a toolbox at an edge.
import { describe, expect, it } from 'vitest';
import { defaultToolboxes, dropTarget, sideFolded, withSideFolded, isOwnFlyout, parseToolboxes, withFlyoutTitle, withGrid, withNewFlyout, withoutFlyout } from '../src/ui/toolboxes';

describe('the side panel floats at the top right to start with', () => {
  it('comes floating in the corner', () => {
    const d = defaultToolboxes().places.details;
    expect(d).toMatchObject({ shown: true, dock: 'float', corner: true });
  });
  it('floats at the top right in new settings; saved settings keep it docked (S87)', () => {
    expect(parseToolboxes(undefined).places.details).toMatchObject({ dock: 'float', corner: true });
    const old = parseToolboxes({ places: { details: { shown: true, dock: 'right', x: 900, y: 90 } } });
    expect(old.places.details.dock).toBe('right');
    expect(old.places.details.corner).toBeUndefined();
    const again = parseToolboxes({ sideFloats: true, places: { details: { shown: true, dock: 'right', x: 900, y: 90 } } });
    expect(again.places.details.dock).toBe('right');
    expect(again.places.details.corner).toBeUndefined();
  });
  it('keeps a place it was dragged to, and a dock other than the right', () => {
    const moved = parseToolboxes({ sideFloats: true, places: { details: { shown: true, dock: 'float', x: 40, y: 50 } } });
    expect(moved.places.details).toMatchObject({ dock: 'float', x: 40, y: 50 });
    expect(moved.places.details.corner).toBeUndefined();
    expect(parseToolboxes({ places: { details: { shown: true, dock: 'left', x: 0, y: 0 } } }).places.details.dock).toBe('left');
  });
});

describe('the side panel open or closed per mode (S87)', () => {
  it('starts open in Canvas and Design, closed in Document, Spreadsheet and Presentation', () => {
    const d = defaultToolboxes();
    expect(['drawing', 'design', 'document', 'sheet', 'slides'].map((m) => sideFolded(d, m))).toEqual([false, false, true, true, true]);
  });
  it('remembers each mode\'s choice, and a saved choice outranks the default', () => {
    const st = withSideFolded(withSideFolded(defaultToolboxes(), 'document', false), 'drawing', true);
    expect(sideFolded(st, 'document')).toBe(false);
    expect(sideFolded(st, 'drawing')).toBe(true);
    expect(sideFolded(st, 'design')).toBe(false);
    expect(sideFolded(parseToolboxes({ sideByMode: { sheet: false } }), 'sheet')).toBe(false);
  });
});

describe('Ctrl floats a toolbox at an edge', () => {
  const work = { left: 100, top: 100, right: 900, bottom: 700 };
  it('docks near an edge, floats with Ctrl', () => {
    expect(dropTarget(880, 110, work)).toBe('right');
    expect(dropTarget(500, 110, work)).toBe('top');
    expect(dropTarget(880, 110, work, undefined, true)).toBe('float');
    expect(dropTarget(500, 400, work)).toBe('float');
  });
});

describe('fly-outs of your own', () => {
  it('makes one from a button, named Fly-out N', () => {
    const a = withNewFlyout(defaultToolboxes(), ['eraser'], undefined, 'fly-a');
    expect(isOwnFlyout(a.id)).toBe(true);
    expect(a.state.ownFlyouts).toEqual([{ id: 'fly-a', title: 'Fly-out 1' }]);
    expect(a.state.flyouts?.['fly-a']).toEqual(['eraser']);
    const b = withNewFlyout(a.state, ['cmd:clean-up'], undefined, 'fly-b');
    expect(b.state.ownFlyouts?.[1].title).toBe('Fly-out 2');
  });
  it('renames and deletes one, taking it out of every toolbox', () => {
    let s = withNewFlyout(defaultToolboxes(), ['eraser'], undefined, 'fly-a').state;
    s = withGrid(s, 'main', { cols: 2, rows: 1, cells: ['pal:fly-a', 'tool:text'] });
    s = { ...s, custom: ['pal:fly-a', 'cmd:clean-up'] };
    s = withFlyoutTitle(s, 'fly-a', '  Erasers ');
    expect(s.ownFlyouts?.[0].title).toBe('Erasers');
    const gone = withoutFlyout(s, 'fly-a');
    expect(gone.ownFlyouts).toBeUndefined();
    expect(gone.flyouts?.['fly-a']).toBeUndefined();
    expect(gone.grids?.main.cells).toEqual([null, 'tool:text']);
    expect(gone.custom).toEqual(['cmd:clean-up']);
  });
  it('is read back from the settings, with commands in it', () => {
    const s = parseToolboxes({ sideFloats: true, ownFlyouts: [{ id: 'fly-a', title: 'Mine' }, { id: 'bad id', title: 'x' }, { id: 'fly-a', title: 'twice' }], flyouts: { 'fly-a': ['eraser', 'cmd:clean-up'] } });
    expect(s.ownFlyouts).toEqual([{ id: 'fly-a', title: 'Mine' }]);
    expect(s.flyouts?.['fly-a']).toEqual(['eraser', 'cmd:clean-up']);
  });
});
