// A library change made while a save is being written (a slow OneDrive or network folder) is kept:
// it stays in the library here and is written by the save that follows, never overwritten by the
// copy the first save wrote.

import { describe, it, expect } from 'vitest';
import { cleanCompound, parseLibrary, type LibCompound, type LibReference } from '../src/library/library';
import { Library, type LibraryPlace } from '../src/library/library-store';
import { blankRef } from '../src/document/references';

const ref = (id: string, title: string, modified = 1): LibReference => ({ ...blankRef('article', id), title, doi: `10.1/${id}`, added: 1, modified });
const cpd = (id: string, smiles: string, modified = 1): LibCompound => cleanCompound({ id, smiles, molfile: '', label: '', modified, added: 1 })!;

/** A place whose next write waits until `release()` is called. */
function slowPlace() {
  let release = () => {};
  let started = () => {};
  const p = {
    text: null as string | null,
    hold: false,
    writing: new Promise<void>((r) => { started = r; }),
    release: () => release(),
    async read() { return p.text; },
    async write(t: string) {
      if (p.hold) {
        p.hold = false;
        started();
        await new Promise<void>((r) => { release = r; });
      }
      p.text = t;
    },
    async readFile() { return null; }, async writeFile() {}, async removeFile() {},
    async where() { return 'memory'; }, async filePath() { return null; },
  };
  return p as typeof p & LibraryPlace;
}

describe('a library change during a save', () => {
  it('is kept here and saved after', async () => {
    const place = slowPlace();
    const a = new Library(place, 0);
    await a.load();
    a.change((l) => ({ ...l, references: [ref('r-1', 'first')] }));
    await a.flush();
    // the next save is slow
    place.hold = true;
    a.change((l) => ({ ...l, references: [ref('r-1', 'notes edited', 2)] }));
    const first = a.saveNow();
    await place.writing;
    // while it is written: a compound added, a reference added
    a.change((l) => ({ ...l, compounds: [cpd('c-1', 'CCO', 3)], references: [...l.references, ref('r-2', 'second', 3)] }));
    place.release();
    await first;
    expect(a.now.compounds.map((c) => c.id)).toEqual(['c-1']);
    expect(a.now.references.map((r) => r.title).sort()).toEqual(['notes edited', 'second']);
    await a.flush();
    const saved = parseLibrary(place.text);
    expect(saved.compounds.map((c) => c.id)).toEqual(['c-1']);
    expect(saved.references.map((r) => r.title).sort()).toEqual(['notes edited', 'second']);
  });

  it('keeps a deletion made during the save', async () => {
    const place = slowPlace();
    const a = new Library(place, 0);
    await a.load();
    a.change((l) => ({ ...l, references: [ref('r-1', 'one'), ref('r-2', 'two')] }));
    await a.flush();
    place.hold = true;
    a.change((l) => ({ ...l, compounds: [cpd('c-1', 'CCO', 2)] }));
    const first = a.saveNow();
    await place.writing;
    a.change((l) => ({ ...l, references: l.references.filter((r) => r.id !== 'r-2'), deleted: { ...l.deleted, 'r-2': Date.now() } }));
    place.release();
    await first;
    await a.flush();
    expect(a.now.references.map((r) => r.id)).toEqual(['r-1']);
    expect(parseLibrary(place.text).references.map((r) => r.id)).toEqual(['r-1']);
  });
});
