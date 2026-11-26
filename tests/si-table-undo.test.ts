// @vitest-environment jsdom
//
// The SI table's Table Design and Table Layout commands and Undo (si-table.ts): each command is one
// named step, what was typed in a cell just before is a step of its own (not taken back with the
// command), a Border Painter drag is one step, and a change the project refuses is said and leaves
// the table as it was.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { MemoryFolder } from '../src/si/folder';
import { SiProject, type Json, type SiSection } from '../src/si/project';
import { JournalFolder } from '../src/si/journal';
import { SiTableEditor, type SiTableHost } from '../src/ui/si-table';
import { cellFormat } from '../src/si/table-format';
import type { BorderLine } from '../src/model';

const FIXTURE = join(__dirname, 'fixtures', 'si-example');
const TABLE = 't-1ece4eb2';
const PEN: BorderLine = { style: 'single', w: 1, color: '#0000ff' };

async function open(): Promise<{ p: SiProject; j: JournalFolder; s: SiSection }> {
  const f = new MemoryFolder('Example');
  const walk = (dir: string): void => {
    for (const n of readdirSync(dir)) {
      const x = join(dir, n);
      if (statSync(x).isDirectory()) walk(x);
      else if (n !== 'README.md') f.files.set(relative(FIXTURE, x).split('\\').join('/'), new Uint8Array(readFileSync(x)));
    }
  };
  walk(FIXTURE);
  const j = new JournalFolder(f);
  const p = await SiProject.open(j);
  const s = p.sections.find((x) => x.name === 'Reaction Optimization')!;
  return { p, j, s };
}

async function editor(o: { p: SiProject; j: JournalFolder; s: SiSection }, opts: { pen?: BorderLine | null; refuse?: boolean } = {}) {
  const flashes: string[] = [];
  const host = {
    project: o.p, section: o.s,
    flash: (m: string) => { flashes.push(m); },
    label: () => '', mentionable: () => [], selectionChanged: () => {}, remove: async () => {},
    textWidth: () => 468, painter: () => opts.pen ?? null, stopPainting: () => {},
    step: (label: string, f: () => Promise<void>) => (opts.refuse ? Promise.reject(new Error('The project was read again: try again.')) : o.j.step(label, f)),
  } as unknown as SiTableHost;
  const e = new SiTableEditor(host, TABLE, 'Table S1');
  document.body.replaceChildren(e.el);
  await e.load();
  return { e, flashes };
}

const read = async (o: { p: SiProject; s: SiSection }): Promise<Json[][]> => (await o.p.readTable(o.s, TABLE))!.rows as Json[][];
const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('SI table commands and Undo', () => {
  it('takes back a command alone, not what was typed just before it', async () => {
    const o = await open();
    const { e } = await editor(o);
    const before = String((await read(o))[1][0].text);
    // typed in a cell, and Middle clicked before the typing is saved (700 ms)
    const box = e.el.querySelector<HTMLElement>('td[data-r="1"][data-c="0"] .si-rich')!;
    box.textContent = 'typed';
    box.dispatchEvent(new Event('input'));
    await e.command('valign-center');
    expect(cellFormat((await read(o))[1][0])).toEqual({});
    expect(cellFormat((await read(o))[0][0]).valign).toBe('center');
    expect(o.j.history(false)).toBe('Cell Alignment');
    expect(await o.j.undo()).toBe('Cell Alignment');
    const rows = await read(o);
    expect(cellFormat(rows[0][0]).valign).toBeUndefined();
    expect(rows[1][0].text).toBe('typed');
    // the typing is the step before
    await o.j.undo();
    expect((await read(o))[1][0].text).toBe(before);
  });

  it('keeps each command one step', async () => {
    const o = await open();
    const { e } = await editor(o);
    await e.command('select-table');
    await e.shade('#ffee00');
    await e.command('fit-window');
    await e.setColumnWidth(3);
    expect(await o.j.undo()).toBe('Column Width');
    expect(await o.j.undo()).toBe('AutoFit Window');
    expect(await o.j.undo()).toBe('Shading');
    expect(cellFormat((await read(o))[2][3]).fill).toBeUndefined();
  });

  it('keeps a Border Painter drag as one step', async () => {
    const o = await open();
    const { e } = await editor(o, { pen: PEN });
    const cell = (r: number, c: number) => e.el.querySelector<HTMLElement>(`td[data-r="${r}"][data-c="${c}"]`)!;
    cell(2, 0).dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    for (const c of [1, 2]) cell(2, c).dispatchEvent(new MouseEvent('mousemove', { bubbles: true, buttons: 1 }));
    // (nothing is written while dragging)
    expect(o.j.history(false)).toBe(null);
    document.dispatchEvent(new MouseEvent('mouseup'));
    await tick(10);
    await e.settled();
    const rows = await read(o);
    for (const c of [0, 1, 2]) expect(cellFormat(rows[2][c]).borders).toBeTruthy();
    expect(await o.j.undo()).toBe('Border Painter');
    expect(o.j.history(false)).toBe(null);
    for (const c of [0, 1, 2]) expect(cellFormat((await read(o))[2][c]).borders).toBeUndefined();
  });

  it('says so and leaves the table as it was when the project refuses the change', async () => {
    const o = await open();
    const { e, flashes } = await editor(o, { refuse: true });
    await e.shade('#ffee00');
    expect(flashes.some((m) => m.includes('read again'))).toBe(true);
    expect(e.tableData()!.rows[0][0].fill).toBeUndefined();
    expect(cellFormat((await read(o))[0][0]).fill).toBeUndefined();
  });
});
