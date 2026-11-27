// @vitest-environment jsdom
//
// Review batch 19, the Library in the References window:
//   F162: Tags and Collections on several references removed a collection only some were in.
//   F163: a plain rename moved a nested collection to the top; "Collection" started on the first one.
//   F729: the filter looked each reference up in the whole list (quadratic); `uses` compared each
//         library reference with every reference of every open file.

import { describe, it, expect, vi } from 'vitest';

type AskFn = (title: string, fields: { name: string; value: string }[]) => Promise<Record<string, string> | null>;
const asked: { title: string; fields: { name: string; value: string; label: string }[] }[] = [];
let answer: (fields: { name: string; value: string }[]) => Record<string, string> = (f) => Object.fromEntries(f.map((x) => [x.name, x.value]));
vi.mock('../src/ui/ask', () => ({
  ask: vi.fn<AskFn>(async (title, fields) => { asked.push({ title, fields: fields as never }); return answer(fields); }),
}));

import { emptyLibrary, type LibraryData, type LibReference } from '../src/library/library';
import { Library, type LibraryPlace } from '../src/library/library-store';
import { blankRef, duplicateFinder, findDuplicate, type Reference } from '../src/document/references';
import { libraryHolder, type LibraryRefsHost } from '../src/ui/library-refs';
import type { HolderPanelContext } from '../src/ui/references-dialog';

const ref = (id: string, over: Partial<LibReference> = {}): LibReference => ({ ...blankRef('article', id), title: id, added: 1, modified: 1, ...over });
const place = (): LibraryPlace => ({
  async read() { return null; }, async write() {}, async readFile() { return null; }, async writeFile() {}, async removeFile() {},
  async where() { return 'memory'; }, async filePath() { return null; },
} as unknown as LibraryPlace);
const host = { files: () => [], pickPdf: async () => null, openFile: async () => {}, styleChanged: () => {}, location: async () => {}, flash: () => {}, zotero: { read: async () => null, write: async () => {} }, get: async () => '' } as unknown as LibraryRefsHost;

async function open(data: Partial<LibraryData>, picked: string[]) {
  const lib = new Library(place(), 0);
  await lib.load();
  lib.change((l) => ({ ...l, ...data }));
  const ctx = { picked: () => lib.now.references.filter((r) => picked.includes(r.id)), select: () => {}, refresh: () => {}, flash: () => {} } as HolderPanelContext;
  const holder = libraryHolder(lib, host);
  const panel = holder.panel!(ctx);
  const click = (label: string) => [...panel.el.querySelectorAll('button')].find((b) => b.textContent === label)!.click();
  return { lib, holder, click };
}
const col = (id: string, name: string, parent?: string) => ({ id, name, kind: 'references' as const, modified: 1, ...(parent ? { parent } : {}) });
const done = () => new Promise((r) => setTimeout(r, 0));

describe('F162: Tags and Collections keeps the collections only some of the references are in', () => {
  it('leaves a collection alone when its box was not changed (only a tag was typed)', async () => {
    const { lib, click } = await open({ collections: [col('k1', 'Reviews'), col('k2', 'Methods')], references: [ref('A', { collections: ['k1', 'k2'] }), ref('B', { collections: ['k2'] })] }, ['A', 'B']);
    answer = (f) => ({ ...Object.fromEntries(f.map((x) => [x.name, x.value])), tags: 'newtag' });
    click('Tags and Collections…');
    await done();
    const byId = (id: string) => lib.now.references.find((r) => r.id === id)!;
    expect(byId('A').collections?.sort()).toEqual(['k1', 'k2']); // A is still in Reviews
    expect(byId('B').collections).toEqual(['k2']);
    expect(byId('A').tags).toEqual(['newtag']);
  });
  it('still adds to every one when a box is ticked, and removes from every one when a shared box is cleared', async () => {
    const { lib, click } = await open({ collections: [col('k1', 'Reviews'), col('k2', 'Methods')], references: [ref('A', { collections: ['k1', 'k2'] }), ref('B', { collections: ['k2'] })] }, ['A', 'B']);
    answer = (f) => ({ ...Object.fromEntries(f.map((x) => [x.name, x.value])), 'col:k1': 'true', 'col:k2': 'false' });
    click('Tags and Collections…');
    await done();
    const byId = (id: string) => lib.now.references.find((r) => r.id === id)!;
    expect(byId('A').collections).toEqual(['k1']);
    expect(byId('B').collections).toEqual(['k1']);
  });
});

describe('F163: renaming a nested collection keeps it where it is', () => {
  it('keeps the parent when the Parent choice is left as it opened', async () => {
    const { lib, click } = await open({ collections: [col('c', 'Catalysis'), col('p', 'Pd', 'c')] }, []);
    // the window opens on "Collection" = the one shown; here the person picks Pd and types a name
    answer = (f) => ({ ...Object.fromEntries(f.map((x) => [x.name, x.value])), pick: 'p', name: 'Palladium' });
    click('Collections…');
    await done();
    const pd = lib.now.collections.find((c) => c.id === 'p')!;
    expect(pd.name).toBe('Palladium');
    expect(pd.parent).toBe('c');
  });
  it('moves it to the top, or inside another, only when that is picked', async () => {
    const { lib, click } = await open({ collections: [col('c', 'Catalysis'), col('p', 'Pd', 'c'), col('o', 'Other')] }, []);
    answer = (f) => ({ ...Object.fromEntries(f.map((x) => [x.name, x.value])), pick: 'p', parent: '' });
    click('Collections…');
    await done();
    expect(lib.now.collections.find((c) => c.id === 'p')!.parent).toBeUndefined();
    answer = (f) => ({ ...Object.fromEntries(f.map((x) => [x.name, x.value])), pick: 'p', parent: 'o' });
    click('Collections…');
    await done();
    expect(lib.now.collections.find((c) => c.id === 'p')!.parent).toBe('o');
  });
  it('starts on (a new one), so typing a name makes a collection instead of renaming the first', async () => {
    const { lib, click } = await open({ collections: [col('c', 'Catalysis')] }, []);
    asked.length = 0;
    answer = (f) => ({ ...Object.fromEntries(f.map((x) => [x.name, x.value])), name: 'Brand New' });
    click('Collections…');
    await done();
    expect(asked[0].fields.find((f) => f.name === 'pick')!.value).toBe('');
    expect(lib.now.collections.map((c) => c.name).sort()).toEqual(['Brand New', 'Catalysis']);
  });
});

describe('F729: the library filter and use counts do not search the whole list for each reference', () => {
  it('looks references up once per version of the library, not once per reference', async () => {
    const refs = Array.from({ length: 300 }, (_, i) => ref(`r${i}`, { collections: i % 2 ? ['k1'] : [] }));
    const { lib, holder } = await open({ collections: [col('k1', 'Reviews')], references: refs }, []);
    let finds = 0;
    const list = lib.now.references as LibReference[];
    const find = list.find.bind(list);
    list.find = ((...a: Parameters<typeof find>) => { finds++; return find(...a); }) as typeof list.find;
    const shown = list.filter((r) => holder.shows!(r)).length;
    expect(finds).toBe(0);
    expect(shown).toBe(300); // (no collection picked: every reference shows)
  });
  it('counts in how many open files each reference is, as before', async () => {
    const a = ref('a', { doi: '10.1/x' }), b = ref('b', { title: 'No DOI here', year: '2020' }), c = ref('c', { doi: '10.1/never' });
    const file = (refs: Reference[]) => ({ refs: () => refs }) as unknown as import('../src/ui/references-dialog').RefHolder;
    const lib = new Library(place(), 0);
    await lib.load();
    lib.change((l) => ({ ...l, references: [a, b, c] }));
    const h = libraryHolder(lib, { ...host, files: () => [file([{ ...a, id: 'z1', doi: 'https://doi.org/10.1/X' }]), file([{ ...b, id: 'z2', title: ' no doi here ' }]), file([])] });
    expect([...h.uses!().entries()]).toEqual([['a', 1], ['b', 1]]);
  });
});

describe('duplicateFinder agrees with findDuplicate', () => {
  it('on the DOI, the title and year, and the cases in between', () => {
    const mk = (over: Partial<Reference>): Reference => ({ ...blankRef('article', 'x'), ...over });
    const list = [mk({ doi: '10.1/A', title: 'One' }), mk({ title: 'Two ', year: '2020' }), mk({ title: '', year: '2021' })];
    const probes = [
      mk({ doi: 'doi:10.1/a' }), mk({ doi: '10.9/zz', title: 'One' }), mk({ title: 'two', year: '2020' }), mk({ title: 'two', year: '2019' }),
      mk({ title: '', year: '2021' }), mk({ title: 'One' }), mk({ doi: '', title: 'Zed', year: '2020' }),
    ];
    const f = duplicateFinder(list);
    for (const p of probes) expect(f(p), JSON.stringify(p)).toBe(!!findDuplicate(list, p));
  });
});
