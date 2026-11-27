// @vitest-environment jsdom
//
// Review batch 19, Find Structure in Files:
//   F706: Enter or Search pressed again while a typed name was being read started a second search at
//         the same time, and every structure was found twice.
//   F705: each progress tick made every row of the list again, so a search with many finds slowed
//         down as the list grew.

import { describe, expect, it, vi } from 'vitest';
import { FindInFilesWindow, type FindInFilesHost } from '../src/ui/find-in-files';

(HTMLDialogElement.prototype as unknown as { showModal: () => void }).showModal = function (this: HTMLDialogElement) { this.open = true; };
(HTMLDialogElement.prototype as unknown as { close: () => void }).close = function (this: HTMLDialogElement) { this.open = false; };

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const files = (n: number) => Array.from({ length: n }, (_, i) => ({ path: `/f/file${i}.cdxml`, size: 10, modified: 1000 + i }));

function make(n = 2, over: Partial<FindInFilesHost> = {}) {
  const calls = { list: 0 };
  const host: FindInFilesHost = {
    flash: () => {},
    pickFolder: async () => '/f',
    listFolder: async () => { calls.list++; return { files: files(n), complete: true }; },
    selected: async () => 'nothing selected',
    toSmiles: async (t) => t,
    deps: {
      read: async (p) => new TextEncoder().encode(p),
      found: async () => [{ spot: { kind: 'drawing' as const }, atoms: [1], molblock: 'CCO' }],
      smiles: async (m) => m,
      contains: async (_q, s) => s.map(() => true),
    },
    index: { read: async () => ({ version: 1, files: {} }) as never, write: async () => {} },
    open: async () => {},
    lastFolder: { get: () => '/f', set: () => {} },
    ...over,
  };
  document.body.replaceChildren();
  const w = new FindInFilesWindow(host);
  return { w, host, calls };
}
async function opened(w: FindInFilesWindow, typed: string) {
  await w.open();
  const q = document.querySelector<HTMLInputElement>('input[aria-label=Structure]')!;
  q.value = typed;
  q.dispatchEvent(new Event('input', { bubbles: true }));
  return { rows: () => [...document.querySelectorAll<HTMLTableRowElement>('.find-table tbody tr')], button: document.querySelector<HTMLButtonElement>('.refs-buttons button.primary')! };
}

describe('F706: one search at a time, even while a name is being read', () => {
  it('ignores a second Search pressed during the name lookup', async () => {
    let finish!: (s: string) => void;
    const lookup = new Promise<string>((r) => { finish = r; });
    const { w, calls } = make(2, { toSmiles: () => lookup });
    const { button, rows } = await opened(w, 'ethanol');
    void w.search();
    expect(button.textContent).toBe('Stop'); // it says so at once
    void w.search(); // Enter again
    button.click(); // this is Stop now, not a second search
    finish('CCO');
    await tick(10);
    expect(calls.list).toBe(0); // stopped before listing: Stop was pressed
    expect(rows().filter((r) => r.dataset.n !== undefined)).toHaveLength(0);
    expect(button.textContent).toBe('Search');
  });
  it('lists and searches once when Search is pressed twice', async () => {
    let finish!: (s: string) => void;
    const lookup = new Promise<string>((r) => { finish = r; });
    const { w, calls } = make(2, { toSmiles: () => lookup });
    const { rows } = await opened(w, 'ethanol');
    void w.search();
    void w.search();
    finish('CCO');
    await tick(20);
    expect(calls.list).toBe(1);
    // two files, one structure each: two rows, not four
    expect(rows().filter((r) => r.dataset.n !== undefined)).toHaveLength(2);
  });
});

describe('F705: the list adds rows while searching, it does not make them all again', () => {
  it('keeps the rows already shown', async () => {
    // each progress call is 200 ms after the last, so each one paints
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => (now += 200));
    const seen: HTMLTableRowElement[][] = [];
    const { w } = make(4);
    const { rows } = await opened(w, 'ethanol');
    const deps = (w as unknown as { host: FindInFilesHost }).host.deps;
    const found = deps.found;
    deps.found = async (b, p) => { seen.push(rows().filter((r) => r.dataset.n !== undefined)); return found(b, p); };
    await w.search();
    vi.restoreAllMocks();
    // before the 4th file is read, the rows of the first three finds are on show; they are the very same elements as before the 3rd
    const before3 = seen[2], before4 = seen[3];
    expect(before3.length).toBeGreaterThan(0);
    expect(before4.length).toBeGreaterThan(before3.length);
    for (const tr of before3) expect(before4).toContain(tr);
  });
});
