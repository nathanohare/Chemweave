// A SheetMode on a bare page for the batch 12 tests: the grid draws nothing (no canvas in jsdom),
// every host call is recorded, and a workbook of the given sheets is showing.
import { vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Workbook } from '../src/sheet/workbook';
import { SheetChem } from '../src/sheet/sheet-chem';
import { SheetMode, type SheetModeHost } from '../src/ui/sheet-mode';
import type { Tab } from '../src/workspace';

let frames: FrameRequestCallback[] = [];

/** Run the animation frames the page asked for. */
export function settleFrames(max = 50): void {
  let n = 0;
  while (frames.length && n++ < max) { const f = frames; frames = []; for (const cb of f) cb(0); }
}

/** Stub the browser parts jsdom lacks (call in beforeEach; vi.unstubAllGlobals() in afterEach). */
export function stubBrowser(): void {
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.push(cb); return frames.length; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const ctx = new Proxy({}, { get: (_t, k) => (k === 'measureText' ? (t: string) => ({ width: 6 * String(t).length, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }) : k === 'canvas' ? document.createElement('canvas') : () => undefined), set: () => true });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx as never);
}

export interface Rig {
  mode: SheetMode;
  wb: Workbook;
  flashes: string[];
  /** Private members of the mode, for calling the commands the ribbon and menus reach. */
  priv: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export function rig(sheets: string[] = ['Sheet1'], host: Partial<SheetModeHost> = {}): Rig {
  // the app's own page (innerHTML never runs its scripts; take them out so none is left in it)
  const html = readFileSync(join(__dirname, '../index.html'), 'utf8');
  document.body.innerHTML = html.slice(html.indexOf('<body'), html.lastIndexOf('</body>')).replace(/^<body[^>]*>/, '');
  for (const el of document.body.querySelectorAll('script')) el.remove();
  const flashes: string[] = [];
  const base: Partial<SheetModeHost> = {
    flash: (m) => { flashes.push(m); },
    key: () => false,
    changed: () => {},
    isOpen: () => true,
    toStructure: async () => ({ error: 'none' }),
    writeCells: async () => {},
    readCells: async () => ({}),
    askName: async () => true,
  };
  const wb = new Workbook(sheets);
  const mode = new SheetMode({ ...base, ...host } as SheetModeHost, new SheetChem({ ready: true, props: async (m: string[]) => m.map(() => ({ error: 'none' })), substructure: async () => ({ results: [] }) } as never, (() => ({ molblock: 'm' })) as never));
  mode.show({ book: wb } as unknown as Tab);
  settleFrames();
  return { mode, wb, flashes, priv: mode };
}
