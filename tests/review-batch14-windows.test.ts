// @vitest-environment jsdom
//
// Code review batch 14 (the Compound Library, Ligand Library, Crystal Structure, Import Review,
// Knowledge Base and Newman windows): F152, F153, F731, F154, F158, F719, F159, F160, F723, F724,
// F741, F742. Each test names the finding it covers. The structures are ethanol and its relatives
// written as plain SMILES; no chemistry value is checked here, only what the windows do.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CompoundLibraryWindow, newCompound, type CompoundLibraryHost } from '../src/ui/compound-library';
import { emptyLibrary, type LibraryData } from '../src/library/library';
import type { Library } from '../src/library/library-store';
import { LigandLibraryWindow } from '../src/ui/ligand-library';
import { openReview, type ReviewOptions } from '../src/ui/import-review';
import { looksLikeSmiles } from '../src/kb/tables';
import { KnowledgeBaseWindow, type KnowledgeBaseHost } from '../src/ui/knowledge-base';
import { askNewman, type NewmanChoice, type NewmanConformer, type NewmanHost } from '../src/ui/newman-dialog';

// the drawings themselves are not what is checked here
vi.mock('../src/render/picture', () => ({ recordPicture: () => ({}), pictureSvg: () => '<svg xmlns="http://www.w3.org/2000/svg"/>' }));

beforeAll(() => {
  // jsdom has no canvas, no scrolling into view, no resize observer and no dialog methods
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe() {} disconnect() {} unobserve() {} };
  Element.prototype.scrollIntoView ??= function () {};
  // (a drawing context that does nothing, whatever is asked of it)
  HTMLCanvasElement.prototype.getContext = (() => new Proxy<Record<string, unknown>>({}, { get: (t, k: string) => (k in t ? t[k] : () => ({ width: 0 })), set: (t, k: string, v) => { t[k] = v; return true; } })) as never;
  const dlg = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  dlg.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
  dlg.show ??= function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
  dlg.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open'); };
});
afterEach(() => { for (const d of document.querySelectorAll('dialog')) d.remove(); vi.unstubAllGlobals(); });

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const key = (el: Element, k: string, init: KeyboardEventInit = {}) => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  el.dispatchEvent(e);
  return e;
};

// ---- Compound Library -------------------------------------------------------------------------

const MOL = 'x\n  test\n\n  1  0  0  0  0  0  0  0  0  0999 V2000\n    0.0000    0.0000    0.0000 C   0  0\nM  END\n';
function libraryWith(n: number) {
  let data: LibraryData = emptyLibrary();
  const taken: string[] = [];
  for (let i = 0; i < n; i++) {
    const c = newCompound({ molfile: MOL, smiles: 'C'.repeat(i + 1), formula: 'CH4', mw: 16, label: String(i + 1) }, taken);
    taken.push(c.id);
    data = { ...data, compounds: [...data.compounds, c] };
  }
  const lib = { load: async () => {}, get now() { return data; }, onChange: () => () => {}, change: (f: (l: LibraryData) => LibraryData) => { data = f(data); }, problem: '' };
  return { lib: lib as unknown as Library, ids: data.compounds.map((c) => c.id) };
}
function compoundHost(over: Partial<CompoundLibraryHost> = {}) {
  const host = {
    flash: vi.fn(), selected: vi.fn(async () => 'nothing'), numbered: vi.fn(async () => 'nothing'), fromText: vi.fn(), fromMolfiles: vi.fn(),
    insert: vi.fn(() => ''), insertsInto: () => 'the drawing', picture: vi.fn(() => null), contains: vi.fn(), openFile: vi.fn(), pickSdf: vi.fn(), saveSdf: vi.fn(),
    fileName: () => '', location: vi.fn(async () => {}), ...over,
  };
  return host as typeof host & CompoundLibraryHost;
}

describe('F152: keys on a focused button of the Compound Library press the button', () => {
  it('Enter on Add Selected does not insert; Enter elsewhere still does', async () => {
    const { lib, ids } = libraryWith(3);
    const host = compoundHost();
    const w = new CompoundLibraryWindow(lib, host);
    await w.open([ids[0]]);
    const d = document.querySelector('dialog.compound-library')!;
    const addSelected = [...d.querySelectorAll('button')].find((b) => b.textContent === 'Add Selected')!;
    key(addSelected, 'Enter');
    expect(host.insert).not.toHaveBeenCalled();
    // (a key pressed with the focus on the window itself is still Insert)
    key(d, 'Enter');
    expect(host.insert).toHaveBeenCalledTimes(1);
  });

  it('Enter does not insert when the Insert button is disabled (several compounds selected)', async () => {
    const { lib, ids } = libraryWith(3);
    const host = compoundHost();
    const w = new CompoundLibraryWindow(lib, host);
    await w.open([ids[0], ids[1]]);
    const d = document.querySelector('dialog.compound-library')!;
    expect([...d.querySelectorAll('button')].find((b) => b.textContent === 'Insert')!.disabled).toBe(true);
    key(d, 'Enter');
    expect(host.insert).not.toHaveBeenCalled();
  });

  it('Delete and the arrow keys on a focused button do not delete or move the selection', async () => {
    const { lib, ids } = libraryWith(3);
    const w = new CompoundLibraryWindow(lib, compoundHost());
    await w.open([ids[0]]);
    const d = document.querySelector('dialog.compound-library')!;
    const loc = [...d.querySelectorAll('button')].find((b) => b.textContent === 'Location…')!;
    key(loc, 'ArrowDown');
    expect(d.querySelectorAll('tr.picked')).toHaveLength(1);
    expect((d.querySelector('tr.picked') as HTMLElement).dataset.id).toBe(ids[0]);
    key(loc, 'Delete');
    expect(document.querySelector('dialog.ask')).toBeNull();
    // on the window itself the arrow key moves the selection
    key(d, 'ArrowDown');
    expect((d.querySelector('tr.picked') as HTMLElement).dataset.id).toBe(ids[1]);
  });
});

describe('F153: the Compound Library does not draw every picture or rebuild every row', () => {
  it('draws pictures as rows come into view, and a click only changes which row is marked', async () => {
    const seen: { cb: (e: unknown[]) => void; els: Element[] }[] = [];
    class IO {
      els: Element[] = [];
      constructor(public cb: (e: unknown[]) => void) { seen.push(this); }
      observe(el: Element) { this.els.push(el); }
      unobserve() {}
      disconnect() { this.els = []; }
    }
    vi.stubGlobal('IntersectionObserver', IO);
    const { lib, ids } = libraryWith(40);
    const host = compoundHost();
    const w = new CompoundLibraryWindow(lib, host);
    await w.open();
    const d = document.querySelector('dialog.compound-library')!;
    // nothing was drawn for the 40 compounds when the window opened
    expect(host.picture).not.toHaveBeenCalled();
    const io = seen[seen.length - 1];
    expect(io.els).toHaveLength(40);
    io.cb(io.els.slice(0, 5).map((target) => ({ isIntersecting: true, target })));
    expect(host.picture).toHaveBeenCalledTimes(5);
    // a click marks the row without making the rows again
    const rows = [...d.querySelectorAll('tbody tr')];
    rows[2].dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    expect([...d.querySelectorAll('tbody tr')]).toEqual(rows);
    expect(rows[2].classList.contains('picked')).toBe(true);
    rows[3].dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    expect(rows[2].classList.contains('picked')).toBe(false);
    expect(rows[3].classList.contains('picked')).toBe(true);
    expect(ids).toHaveLength(40);
  });
});

// ---- Ligand Library ---------------------------------------------------------------------------

describe('F731: Enter on the PubChem link of the Ligand Library is the link\'s', () => {
  it('does not use the template or close the window', () => {
    const used: string[] = [];
    const w = new LigandLibraryWindow({ useTemplate: (id) => used.push(id), openUrl: () => {}, copyText: () => {} });
    w.open('PPh3');
    const d = document.querySelector('dialog.ligand-library')!;
    const link = d.querySelector<HTMLAnchorElement>('.lig-details a')!;
    expect(link).toBeTruthy();
    const e = key(link, 'Enter');
    expect(used).toEqual([]);
    expect(e.defaultPrevented).toBe(false);
    expect(w.isOpen).toBe(true);
    // Enter in the search box still uses the ligand
    key(d.querySelector('input[type=search]')!, 'Enter');
    expect(used).toHaveLength(1);
    w.close();
  });
});

// ---- Import Review ----------------------------------------------------------------------------

/** A review of `n` pictures: the first is a real structure (5 atoms), the others fragments of 1 atom. */
function review(n: number, over: Partial<ReviewOptions> = {}) {
  const atoms = (k: number) => ({ size: k, entries: () => [], keys: () => [], values: () => [], forEach: () => {}, has: () => false, get: () => undefined, [Symbol.iterator]: () => [][Symbol.iterator]() });
  const placed: unknown[][] = [];
  const o = {
    title: 'Import', note: '', found: Array.from({ length: n }, (_, i) => ({ where: `Page ${i + 1}`, pixels: { width: 1, height: 1, data: new Uint8ClampedArray(4) } })),
    read: async () => ({ kind: 'graph', graph: { confidence: 0.9 } }) as never,
    check: async (r: { n?: number }) => ({ doc: { atoms: atoms((r as { n?: number }).n ?? 1) }, smiles: 'C', problems: [] }) as never,
    typed: (s: string) => ({ kind: 'typed', smiles: s, n: 5 }) as never,
    tickDoubtful: false, hideJunk: true,
    place: (c: unknown[]) => placed.push(c), ...over,
  } as ReviewOptions;
  return { o, placed };
}

describe('F158: Select All leaves the hidden pictures alone', () => {
  it('does not tick, count or place pictures that are not shown', async () => {
    // (the canvas the pictures are drawn on is not in jsdom)
    vi.stubGlobal('ImageData', class { constructor(public data: Uint8ClampedArray, public width: number, public height: number) {} });
    // the first picture reads as 5 atoms, the next two as a single atom (junk, hidden)
    let k = 0;
    const { o, placed } = review(3, { read: async () => ({ kind: 'typed', n: k++ === 0 ? 5 : 1 }) as never });
    openReview(o);
    await tick(20);
    const d = document.querySelector('dialog.import-review')!;
    const rows = [...d.querySelectorAll<HTMLElement>('.import-row')];
    expect(rows.map((r) => r.hidden)).toEqual([false, true, true]);
    const all = [...d.querySelectorAll('button')].find((b) => b.textContent === 'Select All')!;
    all.click();
    expect(rows.map((r) => r.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked)).toEqual([true, false, false]);
    const place = [...d.querySelectorAll('button')].find((b) => /^Place/.test(b.textContent ?? ''))!;
    expect(place.textContent).toBe('Place 1 Structure');
    place.click();
    expect(placed).toHaveLength(1);
    expect(placed[0]).toHaveLength(1);
  });
});

describe('F719: a typed SMILES is not overwritten by a late reading', () => {
  it('keeps the correction when the older reading finishes after it', async () => {
    vi.stubGlobal('ImageData', class { constructor(public data: Uint8ClampedArray, public width: number, public height: number) {} });
    let finish!: () => void;
    const slow = new Promise<void>((r) => { finish = r; });
    const { o } = review(1, { hideJunk: false, read: async () => { await slow; return { kind: 'typed', n: 2 } as never; },
      check: async (r) => ({ doc: { atoms: { size: 2 } }, smiles: (r as unknown as { smiles?: string }).smiles ?? 'AI answer', problems: [] }) as never,
      typed: (s) => ({ kind: 'typed', smiles: s }) as never });
    openReview(o);
    await tick(5);
    const d = document.querySelector('dialog.import-review')!;
    const box = d.querySelector<HTMLInputElement>('.import-smiles')!;
    box.value = 'CCO';
    key(box, 'Enter');
    await tick(5);
    expect(box.value).toBe('CCO');
    finish();
    await tick(20);
    // the reading that was already running does not put its answer over the typed one
    expect(box.value).toBe('CCO');
  });
});

// ---- Knowledge Base ---------------------------------------------------------------------------

function kbHost(over: Partial<KnowledgeBaseHost> = {}) {
  const calls: string[] = [];
  const host: KnowledgeBaseHost = {
    flash: () => {}, canonical: async (s) => { calls.push(s); return s; }, readImported: async () => null, writeImported: async () => {},
    pickTable: async () => null, copyText: async () => {}, openUrl: () => {}, ...over,
  };
  return { host, calls };
}
const closeWindow = (w: KnowledgeBaseWindow) => { const d = document.querySelector('dialog.kb-window')!; d.dispatchEvent(new Event('close')); void w; };

describe('F159: a Knowledge Base opened again starts with no structure search', () => {
  it('shows every table\'s rows after a SMILES search was left behind', async () => {
    const { host } = kbHost({ contains: async () => [] });
    const w = new KnowledgeBaseWindow(host);
    await w.open('c1ccccc1');
    await tick(200);
    closeWindow(w);
    await w.open();
    const d = document.querySelector('dialog.kb-window')!;
    expect(d.querySelector<HTMLInputElement>('input[type=search]')!.value).toBe('');
    // no table says it has nothing that "matches or contains" the old search, and the rows are all
    // there, not the "This compound" and "Containing it" groups of a search the box no longer holds
    expect(d.querySelector('.kb-empty')?.textContent ?? '').not.toContain('matches or contains');
    const shown = [...d.querySelectorAll('tbody tr')].map((r) => r.textContent ?? '');
    expect(shown.some((t) => t.startsWith('This compound') || t.startsWith('Containing it') || t.startsWith('Looking for'))).toBe(false);
    expect(shown.length).toBeGreaterThan(5);
    // and each table in the list counts all its rows
    const counts = [...d.querySelectorAll('.kb-tab')].map((b) => Number(b.querySelector('.muted')!.textContent));
    const rows = w.allTables.map((t) => t.rows.length);
    expect(counts).toEqual(rows);
    closeWindow(w);
  }, 60000);
});

describe('F160: typing a SMILES works out each row\'s structure once', () => {
  it('shares one pass over the rows between the searches of quick keystrokes', async () => {
    const { host, calls } = kbHost({ contains: async () => [] });
    const w = new KnowledgeBaseWindow(host);
    await w.open();
    const d = document.querySelector('dialog.kb-window')!;
    const box = d.querySelector<HTMLInputElement>('input[type=search]')!;
    const typed = ['C1CC1C(=O)OCC1CC1', 'C1CC1C(=O)OCC1CCC1', 'C1CC1C(=O)OCC1CCCC1'];
    for (const t of typed) { box.value = t; box.dispatchEvent(new Event('input')); }
    await tick(1500);
    const forRows = new Map<string, number>();
    for (const s of calls) if (!typed.includes(s)) forRows.set(s, (forRows.get(s) ?? 0) + 1);
    expect(forRows.size).toBeGreaterThan(0);
    expect(Math.max(...forRows.values())).toBe(1);
    closeWindow(w);
  }, 60000);
});

describe('F723: "Looking for compounds containing it" is added once', () => {
  it('does not stack another row each time the table is scrolled', async () => {
    let release!: (v: number[]) => void;
    const { host } = kbHost({ contains: () => new Promise<number[]>((r) => { release = r; }) });
    const w = new KnowledgeBaseWindow(host);
    await w.open();
    const d = document.querySelector('dialog.kb-window')!;
    // the table of NMR solvents and the like all carry SMILES: ask for a structure found in the first table that has some
    const box = d.querySelector<HTMLInputElement>('input[type=search]')!;
    // (a structure one of the tables holds as written, so that the table has a row for it)
    const smiles = w.allTables.flatMap((t) => t.rows.map((r) => r.smiles)).find((x): x is string => typeof x === 'string' && x.length > 5 && looksLikeSmiles(x))!;
    box.value = smiles;
    box.dispatchEvent(new Event('input'));
    await tick(1500);
    const wrap = d.querySelector<HTMLElement>('.kb-table-wrap')!;
    for (let i = 0; i < 4; i++) wrap.dispatchEvent(new Event('scroll'));
    const lookingRows = [...d.querySelectorAll('tbody tr')].filter((r) => (r.textContent ?? '').includes('Looking for compounds containing it'));
    expect(lookingRows.length).toBe(1);
    release([]);
    closeWindow(w);
  }, 60000);
});

describe('F724: removing an imported table drops its filters and sort', () => {
  it('clears them for the table that is shown next', async () => {
    const imported = { id: 'user-1', title: 'Mine', about: '', columns: [{ key: 'name', label: 'Name' }], rows: [{ name: 'a' }], personal: true };
    const { host } = kbHost({ readImported: async () => JSON.stringify([imported]) });
    const w = new KnowledgeBaseWindow(host);
    await w.open();
    const win = w as unknown as { picked: Record<string, string>; sort: unknown; current: unknown; tables: { personal?: boolean }[]; removeImported(): Promise<void> };
    win.current = win.tables.find((t) => t.personal)!;
    win.picked = { kind: 'solvent' };
    win.sort = { key: 'name', down: true };
    const done = win.removeImported();
    await tick(5);
    // the confirmation window of the program's own
    document.querySelector<HTMLFormElement>('dialog.ask form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await done;
    expect(win.picked).toEqual({});
    expect(win.sort).toBeNull();
    closeWindow(w);
  }, 60000);
});

// ---- Newman -----------------------------------------------------------------------------------

const conf = (e: number): NewmanConformer => ({ view: { dihedral: e }, energy: e } as unknown as NewmanConformer);

describe('F741: an older conformer search cannot take the place of the newest', () => {
  it('ignores the answer of a search that was replaced twice', async () => {
    // (search 1 is slow; 2 finishes; 3 starts, then 1 answers while 3 is still running)
    const waits: ((v: NewmanConformer[]) => void)[] = [];
    const host = {
      list: vi.fn(() => new Promise<NewmanConformer[]>((r) => { waits.push(r); })),
      drawn: vi.fn(), stop: vi.fn(), xtb: true,
    } as unknown as NewmanHost;
    const start = { kind: 'newman', source: 'conformers', method: 'xtb', reversed: false, index: 0, turn: 0, ideal: false, wedges: false, rs: false, mark: false, linked: false, text: { auto: true } } as unknown as NewmanChoice;
    void askNewman(start, host, false);
    await tick(5);
    const d = document.querySelector('dialog.newman-dialog')!;
    const method = d.querySelector<HTMLSelectElement>('select[name=method]')!;
    method.value = 'mmff'; method.dispatchEvent(new Event('change'));
    await tick(5);
    waits[1]([conf(2)]);
    await tick(5);
    const swap = d.querySelector<HTMLButtonElement>('[data-act=swap]')!;
    swap.click();
    await tick(5);
    expect(waits).toHaveLength(3);
    // the first search (xTB, not reversed) comes back last-but-one: it must not be shown
    waits[0]([conf(100), conf(101), conf(102)]);
    await tick(5);
    expect(d.querySelectorAll('.newman-list tbody tr, tbody tr')).toHaveLength(1);
    waits[2]([conf(7)]);
    await tick(5);
    expect(d.querySelectorAll('tbody tr')).toHaveLength(1);
  });
});

describe('F742: a pointer press that is cancelled does not leave a drag behind', () => {
  it('a later move after pointercancel does not close the window', async () => {
    const host = {
      list: vi.fn(async () => [conf(1)]), drawn: vi.fn(), stop: vi.fn(),
    } as unknown as NewmanHost;
    const start = { kind: 'newman', source: 'conformers', method: 'mmff', reversed: false, index: 0, turn: 0, ideal: false, wedges: false, rs: false, mark: false, linked: false, text: { auto: true } } as unknown as NewmanChoice;
    let result: unknown = 'pending';
    void askNewman(start, host, false).then((r) => { result = r; });
    await tick(10);
    const d = document.querySelector('dialog.newman-dialog')!;
    const view = d.querySelector<HTMLElement>('[data-kind]')!;
    const ptr = (type: string, x: number) => { const e = new MouseEvent(type, { clientX: x, clientY: 0, button: 0, bubbles: true, cancelable: true }); return e; };
    view.dispatchEvent(ptr('pointerdown', 0));
    window.dispatchEvent(ptr('pointercancel', 0));
    window.dispatchEvent(ptr('pointermove', 50));
    await tick(5);
    expect(result).toBe('pending');
    expect(document.querySelector('dialog.newman-dialog')).not.toBeNull();
  });
});

// ---- Crystal Structure ------------------------------------------------------------------------

import { askCrystal } from '../src/ui/crystal-dialog';

describe('F154: Enter in the atom Find box finishes the search, not the window', () => {
  it('does not submit the form', async () => {
    void askCrystal(null, 14.4, { pickFile: async () => null, copy: async () => {} });
    const d = document.querySelector('dialog.crystal-dialog')!;
    const find = d.querySelector<HTMLInputElement>('.crystal-find')!;
    find.value = 'C1';
    const e = key(find, 'Enter');
    // (the browser submits a form on Enter in one of its boxes unless the key is stopped)
    expect(e.defaultPrevented).toBe(true);
    // other keys are left alone
    expect(key(find, 'a').defaultPrevented).toBe(false);
  });
});
