// The Word snapshot of an SI project: the whole SI compiled and saved as "<title> (Snapshot).docx"
// at the top of the project folder, every few minutes while the project changes, when it closes
// and on Ctrl+S. It is a valid Word file with the compounds' text, is never written to a
// read-only project, never becomes a step of Undo, and never replaces a copy saved in Word.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { MemoryFolder } from '../src/si/folder';
import { SiProject } from '../src/si/project';
import { JournalFolder } from '../src/si/journal';
import { molFacts } from '../src/si/chem';
import { readScene, sceneToDoc } from '../src/io/chem-formats';
import { writeDocx, type DocxDeps } from '../src/io/docx-write';
import { ACS_1996 } from '../src/style';
import { saveSnapshot } from '../src/si/snapshot';
import { SnapshotKeeper, isSnapshotDocx, savedHere, snapshotDocxName, type SnapshotHost } from '../src/si/snapshot-docx';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let RDKit: any;
beforeAll(async () => { RDKit = await createRequire(import.meta.url)('@rdkit/rdkit')(); });
afterEach(() => { vi.useRealTimers(); });

const FIXTURE = join(__dirname, 'fixtures', 'si-example');
function exampleFolder(): MemoryFolder {
  const f = new MemoryFolder('Example project');
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name !== 'README.md') f.files.set(relative(FIXTURE, p).split('\\').join('/'), new Uint8Array(readFileSync(p)));
    }
  };
  walk(FIXTURE);
  return f;
}

// (from the fixture's project.json; its ":" can't be in a file name on Windows)
const TITLE = JSON.parse(readFileSync(join(FIXTURE, 'project.json'), 'utf8')).title as string;
// (a compound of the fixture, by its name and ID: sections/…/c-26c39a99_1-phenylethan/compound.json, section.json's ID table)
const COMPOUND = '1-Phenylethan-1-ol (2a).';

/** A one-pixel PNG, as a data URL: a spectrum page's picture. */
const PNG_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/** A picture for each drawing: a PNG's signature is all Word needs to place it. */
const deps: DocxDeps = { picture: async () => ({ png: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), w: 72, h: 36 }) };

function host(flashes: string[] = [], compiles = { n: 0 }): SnapshotHost {
  return {
    compileHost: () => {
      compiles.n++;
      return {
        contentsOf: (mol) => { const s = readScene('mol', mol); return s ? sceneToDoc(s, ACS_1996).doc.contents() : null; },
        sizeOf: () => null,
        facts: async (mols) => mols.map((m) => (m ? molFacts(RDKit, m) : null)),
      };
    },
    docx: (doc) => writeDocx({ ...doc, drawingStyle: { ...ACS_1996 } }, deps, 'SI'),
    saved: async () => {},
    flash: (m) => { flashes.push(m); },
  };
}

async function setup(): Promise<{ f: MemoryFolder; j: JournalFolder; p: SiProject }> {
  const f = exampleFolder();
  const j = new JournalFolder(f);
  const p = await SiProject.open(j);
  return { f, j, p };
}

const snapshots = (f: MemoryFolder): string[] => [...f.files.keys()].filter((k) => k.endsWith('(Snapshot).docx'));
/** The text of a Word file's body. */
const bodyText = (docx: Uint8Array): string => [...strFromU8(unzipSync(docx)['word/document.xml']).matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('');

describe('the Word snapshot of an SI project', () => {
  it('is named after the project, made safe for a file name', () => {
    expect(snapshotDocxName('NaBH4 Reduction SI')).toBe('NaBH4 Reduction SI (Snapshot).docx');
    expect(snapshotDocxName('A/B: C?')).toBe('A_B_ C_ (Snapshot).docx');
    expect(snapshotDocxName('   ')).toBe('SI Snapshot.docx');
    expect(snapshotDocxName('CON')).toBe('CON_ (Snapshot).docx');
    // (a long title is cut at a word, so the file can still be opened in Word)
    expect(snapshotDocxName(TITLE)).toBe('Sodium Borohydride Reduction of Aryl Methyl Ketones_ an Example Project for Chem (Snapshot).docx');
    expect(isSnapshotDocx('NaBH4 Reduction SI (Snapshot).docx')).toBe(true);
    expect(isSnapshotDocx('sections/x (Snapshot).docx')).toBe(false);
    expect(isSnapshotDocx('project.json')).toBe(false);
  });

  it('is the whole SI compiled, as a Word file at the top of the project folder', async () => {
    const { f, p } = await setup();
    const flashes: string[] = [];
    expect(await new SnapshotKeeper(host(flashes)).saveNow(p)).toBe('written');
    const name = snapshotDocxName(TITLE);
    expect(snapshots(f)).toEqual([name]);
    const bytes = f.files.get(name)!;
    expect(strFromU8(bytes.subarray(0, 2))).toBe('PK');
    const parts = unzipSync(bytes);
    expect(Object.keys(parts)).toContain('word/document.xml');
    expect(Object.keys(parts)).toContain('[Content_Types].xml');
    const text = bodyText(bytes);
    expect(text).toContain(COMPOUND);
    expect(text).toContain('General Procedure A');
    expect(savedHere(bytes)).toBe(true);
    expect(flashes[flashes.length - 1]).toMatch(/^Saved “Sodium Borohydride.* \(Snapshot\)\.docx” in the project folder/);
  });

  it('is never written to a read-only project', async () => {
    const { f, p } = await setup();
    p.readOnly = true;
    const flashes: string[] = [];
    const keeper = new SnapshotKeeper(host(flashes), 1000);
    expect(await keeper.saveNow(p)).toBe('read-only');
    expect(flashes).toEqual(['This SI project is open read-only, so its Word snapshot is not saved.']);
    vi.useFakeTimers();
    keeper.changed(p);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await keeper.closing(p)).toBe('read-only');
    expect(snapshots(f)).toEqual([]);
  });

  it('stops being written once the project becomes read-only (its lock was lost)', async () => {
    const { f, p } = await setup();
    const h = host();
    // (the lock is lost while the SI is being compiled)
    const compileHost = h.compileHost;
    h.compileHost = (q) => { p.readOnly = true; return compileHost(q); };
    expect(await new SnapshotKeeper(h).saveNow(p)).toBe('read-only');
    expect(snapshots(f)).toEqual([]);
  });

  it('is not a step of Undo, and Undo leaves it alone', async () => {
    const { f, j, p } = await setup();
    let heard = 0;
    j.onChange = () => { heard++; };
    const keeper = new SnapshotKeeper(host());
    expect(await keeper.saveNow(p)).toBe('written');
    j.settle();
    expect(j.history(false)).toBeNull();
    expect(heard).toBe(0);
    // a change, then a snapshot: Ctrl+Z takes back the change alone, in one step
    const c = p.compounds[0];
    await j.step('Edit', () => p.setFlag(c, 'yield', true, 'check'));
    keeper.changed(p);
    const before = f.files.get(snapshotDocxName(TITLE));
    expect(await keeper.snapshot(p, 'manual')).toBe('written');
    const after = f.files.get(snapshotDocxName(TITLE));
    expect(after).not.toBe(before);
    expect(j.history(false)).toBe('Edit');
    expect(await j.undo()).toBe('Edit');
    expect(j.history(false)).toBeNull();
    expect(f.files.get(snapshotDocxName(TITLE))).toBe(after);
  });

  it('is saved on the timer only while the project has changed, one compile at a time', async () => {
    const { f, p } = await setup();
    const compiles = { n: 0 };
    const keeper = new SnapshotKeeper(host([], compiles), 1000);
    vi.useFakeTimers();
    await vi.advanceTimersByTimeAsync(3000);
    expect(compiles.n).toBe(0);
    keeper.changed(p);
    keeper.changed(p);
    expect(keeper.isChanged(p)).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(snapshots(f)).toHaveLength(1));
    await vi.waitFor(() => expect(keeper.isChanged(p)).toBe(false));
    expect(compiles.n).toBe(1);
    // nothing changed since: the timer doesn't turn, and Ctrl+S needn't compile again
    await vi.advanceTimersByTimeAsync(5000);
    expect(compiles.n).toBe(1);
    expect(await keeper.saveNow(p)).toBe('up-to-date');
    expect(compiles.n).toBe(1);
    // asked for twice while one waits: the two make one
    keeper.changed(p);
    const [a, b] = [keeper.snapshot(p, 'manual'), keeper.snapshot(p, 'manual')];
    expect(await a).toBe('written');
    expect(await b).toBe('written');
    expect(compiles.n).toBe(2);
  });

  it('is saved when the project closes, if it changed', async () => {
    const { f, p } = await setup();
    const keeper = new SnapshotKeeper(host());
    expect(await keeper.closing(p)).toBe('up-to-date');
    expect(snapshots(f)).toEqual([]);
    keeper.changed(p);
    expect(await keeper.closing(p)).toBe('written');
    expect(snapshots(f)).toHaveLength(1);
    // (once closed, changes start no timer)
    expect(keeper.isChanged(p)).toBe(false);
  });

  it('is made soon after a project with none opens', async () => {
    const { f, p } = await setup();
    const keeper = new SnapshotKeeper(host(), 1000);
    vi.useFakeTimers();
    await keeper.opened(p);
    expect(keeper.isChanged(p)).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(snapshots(f)).toHaveLength(1));
  });

  it('says a failure once, not at every turn of the timer', async () => {
    const { p } = await setup();
    const flashes: string[] = [];
    const h = host(flashes);
    h.docx = async () => { throw new Error('the disk is full'); };
    const keeper = new SnapshotKeeper(h, 1000);
    vi.useFakeTimers();
    keeper.changed(p);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(flashes).toHaveLength(1));
    await vi.advanceTimersByTimeAsync(5000);
    expect(flashes).toEqual([`The Word snapshot of “${TITLE}” could not be saved: the disk is full`]);
    // (one asked for is always answered)
    expect(await keeper.saveNow(p)).toBe('failed');
    expect(flashes.filter((m) => m.startsWith('The Word snapshot'))).toHaveLength(2);
  });

  it('never replaces a snapshot saved in Word since', async () => {
    const { f, p } = await setup();
    const name = snapshotDocxName(TITLE);
    const word = zipSync({ '[Content_Types].xml': strToU8('<Types/>'), 'docProps/app.xml': strToU8('<Properties><Application>Microsoft Office Word</Application></Properties>') });
    f.files.set(name, word);
    const flashes: string[] = [];
    const compiles = { n: 0 };
    const keeper = new SnapshotKeeper(host(flashes, compiles));
    keeper.changed(p);
    expect(await keeper.snapshot(p, 'timer')).toBe('theirs');
    expect(f.files.get(name)).toBe(word);
    expect(compiles.n).toBe(0);
    expect(flashes).toHaveLength(1);
    expect(flashes[0]).toMatch(/was saved in another program since, so it was not replaced/);
    // renamed out of the way: the next one is saved
    f.files.delete(name);
    expect(await keeper.snapshot(p, 'manual')).toBe('written');
    expect(savedHere(f.files.get(name)!)).toBe(true);
  });

  it('draws each spectrum PDF once, when nothing else is happening, until it changes', async () => {
    const { f, p } = await setup();
    // (the fixture lists 2a_1H.pdf and 2a_13C.pdf among compound 2a's spectra, without the files: two stand-ins)
    const dir = 'sections/s-972b3c47_synthesis-and-charac/compounds/c-26c39a99_1-phenylethan/spectra';
    f.files.set(`${dir}/2a_1H.pdf`, strToU8('%PDF-1.4 one'));
    f.files.set(`${dir}/2a_13C.pdf`, strToU8('%PDF-1.4 two'));
    const drawn: string[] = [];
    let idles = 0;
    const h = host();
    const compileHost = h.compileHost;
    h.compileHost = (q) => ({
      ...compileHost(q),
      pdfPages: async (b) => { drawn.push(strFromU8(b)); return [{ src: PNG_1PX, w: 792, h: 612, px: { w: 1, h: 1 }, of: 1 }]; },
    });
    h.idle = async () => { idles++; };
    const keeper = new SnapshotKeeper(h);
    keeper.changed(p);
    expect(await keeper.snapshot(p, 'manual')).toBe('written');
    expect(drawn.sort()).toEqual(['%PDF-1.4 one', '%PDF-1.4 two']);
    expect(idles).toBe(2);
    const parts = unzipSync(f.files.get(snapshotDocxName(TITLE))!);
    expect(Object.keys(parts).filter((k) => k.startsWith('word/media/') && k.endsWith('.png')).length).toBeGreaterThanOrEqual(2);
    // the next snapshot uses the pages drawn; a spectrum changed since is drawn again
    f.files.set(`${dir}/2a_13C.pdf`, strToU8('%PDF-1.4 two, again'));
    keeper.changed(p);
    expect(await keeper.snapshot(p, 'manual')).toBe('written');
    expect(drawn.sort()).toEqual(['%PDF-1.4 one', '%PDF-1.4 two', '%PDF-1.4 two, again']);
  });

  it('is left out of Save Snapshot’s zip (it is made again from the project)', async () => {
    const { f, p } = await setup();
    await new SnapshotKeeper(host()).saveNow(p);
    const path = await saveSnapshot(p, 'test', new Date(2026, 10, 23, 9, 0, 0));
    const names = Object.keys(unzipSync(f.files.get(path)!));
    expect(names.some((n) => n.endsWith('project.json'))).toBe(true);
    expect(names.some((n) => n.endsWith('.docx'))).toBe(false);
  });
});
