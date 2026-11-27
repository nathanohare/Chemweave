// Code review 2026-11-26, batch 02: the Library, PubMed and Zotero, Find Structure in Files.
//   F138: a Zotero item matched by DOI dropped the reference's own collections, PMID and abstract.
//   F634: edits merged in from another computer didn't redraw the open windows.
//   F635: a save that failed was never tried again, and closing the app dropped the changes.
//   F636: an item with no id got a new random id at every read, so saves kept two of it.
//   F637: every number in pasted text was taken for a PubMed id.
//   F638: a PubMed group author ending in capitals was turned into someone's initials.
//   F639: a Zotero group link with the group's name in it was refused.
//   F640: a tag taken off in Zotero stayed here.
//   F641: edits made while Zotero was being read were undone by the sync (applied to the library as it is now).
//   F642: an item listed twice by Zotero's paging gave two references.
//   F643: collections a sync removed came back at the next save.
//   F632: the structure index kept 5,000 files, fewer than one search reads.
//   F633: every indexed file made its own substructure call.

import { describe, it, expect, vi } from 'vitest';
import { cleanCompound, emptyLibrary, mergeLibraries, parseLibrary, libraryText, type LibraryData, type LibReference } from '../src/library/library';
import { Library, type LibraryPlace } from '../src/library/library-store';
import { applyZotero, fromPubmed, parsePmids, zoteroLibrary, type ZoteroLink } from '../src/library/online';
import { blankRef } from '../src/document/references';
import { emptyIndex, INDEX_MAX_FILES, searchFiles, type SearchDeps } from '../src/library/file-index';

const ref = (id: string, over: Partial<LibReference> = {}): LibReference => ({ ...blankRef('article', id), title: id, added: 1, modified: 1, ...over });
const link: ZoteroLink = { library: 'users/1', key: 'k', version: 0 };
const item = (key: string, version: number, data: Record<string, unknown>) => ({ key, version, data: { itemType: 'journalArticle', title: 'T', ...data } });

function memPlace(text: string | null = null) {
  const p = {
    text, fail: false, writes: 0,
    async read() { if (p.fail) throw new Error('not synced yet'); return p.text; },
    async write(t: string) { p.text = t; p.writes++; },
    async readFile() { return null; }, async writeFile() {}, async removeFile() {},
    async where() { return 'memory'; }, async filePath() { return null; },
  };
  return p as typeof p & LibraryPlace;
}

describe('F138: a reference matched by DOI keeps what it had here', () => {
  it('keeps its collections, PMID and abstract', () => {
    const lib: LibraryData = { ...emptyLibrary(), references: [ref('r-1', { doi: '10.1/abc', pmid: '31234567', abstract: 'Mine.', collections: ['col-a'], tags: ['mine'] })] };
    const r = applyZotero(lib, { collections: [], items: [item('Z1', 3, { DOI: '10.1/ABC' })] }, link);
    expect(r.updated).toBe(1);
    expect(r.lib.references).toHaveLength(1);
    expect(r.lib.references[0]).toMatchObject({ id: 'r-1', pmid: '31234567', abstract: 'Mine.', collections: ['col-a'], tags: ['mine'] });
  });
});

describe('F640: a tag taken off in Zotero goes here too', () => {
  it('keeps the tags added here and follows Zotero’s', () => {
    const first = applyZotero(emptyLibrary(), { collections: [], items: [item('Z1', 1, { tags: [{ tag: 'old' }, { tag: 'kept' }] })] }, link).lib;
    const mine = { ...first, references: first.references.map((r) => ({ ...r, tags: [...(r.tags ?? []), 'mine'] })) };
    const second = applyZotero(mine, { collections: [], items: [item('Z1', 2, { tags: [{ tag: 'kept' }] })] }, { ...link, version: 1 }).lib;
    expect(second.references[0].tags).toEqual(['kept', 'mine']);
    // and that survives the file
    expect(parseLibrary(libraryText(second)).references[0].zotero?.tags).toEqual(['kept']);
  });
});

describe('F641: a sync is applied to the library as it is when it finishes', () => {
  it('leaves an edit made meanwhile as it is', () => {
    const before = { ...emptyLibrary(), references: [ref('r-9', { title: 'Renamed while syncing' })] };
    const r = applyZotero(before, { collections: [], items: [item('Z1', 1, {})] }, link);
    expect(r.lib.references.map((x) => x.title)).toEqual(['Renamed while syncing', 'T']);
  });
});

describe('F642: an item listed twice gives one reference', () => {
  it('merges the repeat into the reference made for it', () => {
    const r = applyZotero(emptyLibrary(), { collections: [], items: [item('Z1', 1, { title: 'First' }), item('Z1', 2, { title: 'Second' })] }, link);
    expect(r.lib.references.map((x) => x.title)).toEqual(['Second']);
    expect(r).toMatchObject({ added: 1, updated: 0, version: 2 });
  });
});

describe('F643: a collection Zotero no longer has stays gone', () => {
  it('is marked deleted, so the next save’s merge doesn’t bring it back', () => {
    const had: LibraryData = { ...emptyLibrary(), collections: [{ id: 'z-C1', name: 'Old', kind: 'references', modified: 5 }] };
    const r = applyZotero(had, { collections: [], items: [] }, link, 1000).lib;
    expect(r.collections).toEqual([]);
    expect(mergeLibraries(had, r).collections).toEqual([]);
  });
});

describe('F637: PubMed ids in pasted text', () => {
  it('takes only the marked id from a citation, and bare ids from a list', () => {
    expect(parsePmids('Smith J. J Org Chem 2019, 84, 1234. PMID: 31234567')).toEqual(['31234567']);
    expect(parsePmids('https://pubmed.ncbi.nlm.nih.gov/31234567/ and PMID 30000001')).toEqual(['31234567', '30000001']);
    expect(parsePmids('31234567, 30000001\n29999999')).toEqual(['31234567', '30000001', '29999999']);
    expect(parsePmids('J Org Chem 2019, 84, 1234')).toEqual([]);
  });
});

describe('F638: a group author stays as written', () => {
  it('doesn’t turn a collective name into initials', () => {
    const r = fromPubmed('1', { title: 'x', authors: [{ name: 'ATLAS Collaboration CERN', authtype: 'CollectiveName' }, { name: 'Fu GC', authtype: 'Author' }] });
    expect(r.authors).toEqual(['ATLAS Collaboration CERN', 'Fu, G. C.']);
  });
});

describe('F639: a Zotero group link with its name', () => {
  it('reads the group’s number', () => {
    expect(zoteroLibrary('https://www.zotero.org/groups/98765/my-group/items')).toBe('groups/98765');
    expect(zoteroLibrary('groups/98765/my-group')).toBe('groups/98765');
    expect(zoteroLibrary('groups/x/98765')).toBeNull();
  });
});

describe('F636: an item with no id keeps one id', () => {
  it('reads the same id each time, so a save doesn’t make two', () => {
    const text = JSON.stringify({ version: 1, references: [{ title: 'No id' }], compounds: [{ smiles: 'CCO', molfile: '', label: '3' }], collections: [], deleted: {} });
    const a = parseLibrary(text), b = parseLibrary(text);
    expect(a.compounds[0].id).toBe(b.compounds[0].id);
    expect(a.references[0].id).toBe(b.references[0].id);
    expect(mergeLibraries(a, b).compounds).toHaveLength(1);
    expect(mergeLibraries(a, b).references).toHaveLength(1);
    // two different compounds still get different ids
    expect(cleanCompound({ smiles: 'CCO' })!.id).not.toBe(cleanCompound({ smiles: 'CCN' })!.id);
  });
});

describe('F634: changes from another computer show here', () => {
  it('tells the windows when an item was changed elsewhere, though the counts are the same', async () => {
    const place = memPlace();
    const lib = new Library(place, 0);
    await lib.load();
    lib.change((l) => ({ ...l, references: [ref('r-1', { title: 'Mine', modified: 1 })] }));
    await lib.flush();
    // another computer renames it
    place.text = libraryText({ ...parseLibrary(place.text), references: [ref('r-1', { title: 'Theirs', modified: 50 })] });
    const told = vi.fn();
    lib.onChange(told);
    await lib.saveNow();
    expect(lib.now.references[0].title).toBe('Theirs');
    expect(told).toHaveBeenCalled();
  });
});

describe('F635: a save that failed is tried again', () => {
  it('saves the waiting change on closing, once the file can be read', async () => {
    const place = memPlace();
    const lib = new Library(place, 0, 60_000);
    await lib.load();
    place.fail = true;
    lib.change((l) => ({ ...l, references: [ref('r-1')] }));
    await lib.flush();
    expect(lib.problem).toMatch(/could not be saved/);
    expect(place.text).toBeNull();
    place.fail = false;
    await lib.flush();
    expect(parseLibrary(place.text).references.map((r) => r.id)).toEqual(['r-1']);
    expect(lib.problem).toBe('');
  });
});

describe('F632 and F633: Find Structure in Files', () => {
  it('keeps as many files as one search reads', () => {
    expect(INDEX_MAX_FILES).toBeGreaterThanOrEqual(20000);
  });

  it('checks the indexed files’ structures in one call', async () => {
    const ix = emptyIndex();
    const files = [1, 2, 3].map((n) => ({ path: `/f/${n}.cdxml`, size: 1, modified: 1 }));
    for (const f of files) ix.files[f.path] = { size: 1, modified: 1, read: 1, structures: [{ spot: { kind: 'drawing' } as never, atoms: [], smiles: f.path.includes('2') ? 'CCO' : 'CCC' }] };
    const contains = vi.fn(async (_q: string, smiles: string[]) => smiles.map((s) => s === 'CCO'));
    const deps: SearchDeps = { read: async () => { throw new Error('not read'); }, found: async () => [], smiles: async () => [], contains };
    const r = await searchFiles(files, 'CO', 'contains', ix, deps);
    expect(contains).toHaveBeenCalledTimes(1);
    expect(r.hits.map((h) => h.path)).toEqual(['/f/2.cdxml']);
    expect(r.read).toBe(0);
    // used now: kept ahead of files not searched lately
    expect(ix.files['/f/1.cdxml'].read).toBeGreaterThan(1);
  });
});
