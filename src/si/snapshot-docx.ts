// The Word snapshot of an SI project (Nate's request): the whole SI compiled, exactly as
// Compile to Document makes it, and saved as "<project title> (Snapshot).docx" in the project
// folder, so that if Chemweave breaks or the project can't be opened, the SI can still be
// worked on in Word. It is saved
//   - every SNAPSHOT_EVERY_MS (5 minutes) while the project has changed since the last one,
//   - when the project closes (its tab closed, or the app quitting: best effort), and
//   - when asked (Compile ▸ Save Word Snapshot).
//
// Where: beside a project file (.chemsi), in the folder it is in (packing a large Word file into
// the project file on every save would slow saving and double the file to share); else the
// project folder's top, beside project.json, where the person looks first. Not in
// build/ (SI Assistant says build/ is safe to delete, so a backup kept there could be lost with
// it) and not in snapshots/ (SI Assistant's zip snapshots, by date). Chem SI Assistant reads
// only the files it knows (project.json, references.json, sections/…), so the file is left
// alone there; Chemweave's Save Snapshot leaves it out of its zips (it is made again from the
// project).
//
// Writing it is never a step of Undo: the file is written to the folder under the project's
// history (JournalFolder.inner), so Ctrl+Z never takes a snapshot back, and the history (and
// the Edit menu, and anything that follows it) never hears of it. The folder still asks the
// project before each write, so nothing is written once the project is read-only or its lock
// was lost.
//
// One snapshot is made at a time (for all projects), in the background: a timer that comes due
// while one is being made is skipped, and asking again while one waits to start joins it. A
// failure is said once (until a snapshot succeeds again); one asked for is always answered.
//
// Spectra are where the time goes (each PDF page drawn at 150 dpi and saved as PNG, about 80 ms
// a page, on the page's thread). So the pages drawn are kept for the next snapshot, by the PDF's
// bytes (up to PAGES_KEPT_CHARS of pictures, the oldest going first, all of them once no
// project is open): only a spectrum added or changed since is drawn again. And each PDF waits
// for a moment when nothing else is happening (host.idle), so typing goes first.
//
// A snapshot changed in another program since (Word saved it: its docProps/app.xml names another
// application) is never overwritten: the person may be working on it there. They are told once,
// and a snapshot is saved again once they rename or move that file.

import { strFromU8, unzipSync } from 'fflate';
import { compileSi, type CompileHost, type PagePicture } from './compile-doc';
import { journalOf } from './journal';
import { safeFilename } from './ids';
import type { SiFolder } from './folder';
import type { SiProject } from './project';
import type { DocText } from '../document/document';

/** How often a changed project's snapshot is saved again. */
export const SNAPSHOT_EVERY_MS = 5 * 60 * 1000;
/** What a snapshot's name ends with. */
export const SNAPSHOT_TAIL = ' (Snapshot).docx';
/** The name when the title gives none. */
export const SNAPSHOT_FALLBACK = 'SI Snapshot.docx';
/** The most spectrum pictures kept between snapshots, in characters of their data URLs (about as many bytes). */
export const PAGES_KEPT_CHARS = 120_000_000;
/** The longest the title part of the name can be (the project's own path also counts towards Windows' limit). */
const TITLE_MOST = 80;

/** The snapshot's file name for a project titled `title`. */
export function snapshotDocxName(title: string): string {
  let t = title.trim().replace(/\s+/g, ' ');
  // (a long title is cut at a word: Word can't open a file whose whole path is over 259 characters)
  if (t.length > TITLE_MOST) { t = t.slice(0, TITLE_MOST + 1); t = t.slice(0, t.lastIndexOf(' ') > TITLE_MOST / 2 ? t.lastIndexOf(' ') : TITLE_MOST).trim(); }
  const clean = t ? safeFilename(t) : '';
  return clean && clean !== 'file' ? clean + SNAPSHOT_TAIL : SNAPSHOT_FALLBACK;
}

/** Whether a path in a project folder is a Word snapshot (one at the folder's top). */
export function isSnapshotDocx(rel: string): boolean {
  const r = rel.replace(/\\/g, '/').replace(/^\/+/, '');
  return !r.includes('/') && (r.endsWith(SNAPSHOT_TAIL) || r === SNAPSHOT_FALLBACK);
}

/** Where the snapshots of project files (.chemsi) go: the folder the file is in (set when it is opened or saved as). */
const besideFile = new WeakMap<SiProject, SiFolder>();
/** A project file's snapshot goes beside it, in `folder` (the file's own folder), not into the file. */
export function setSnapshotFolder(p: SiProject, folder: SiFolder | null): void {
  if (folder) besideFile.set(p, folder); else besideFile.delete(p);
}

/** The folder a snapshot is written to: beside the project file, or the project's own folder (under its Undo history). */
export function snapshotFolder(p: SiProject): SiFolder {
  return besideFile.get(p) ?? journalOf(p.folder)?.inner ?? p.folder;
}

/** The folder a project file (.chemsi) is in, when the project is one (where its snapshots go); null for a project folder. */
export function besideFolderOf(p: SiProject): SiFolder | null {
  return besideFile.get(p) ?? null;
}

/** Where the snapshot is, as said to the person. */
const placeOf = (p: SiProject): string => (besideFile.has(p) ? 'beside the project file' : 'in the project folder');

/** Whether a Word file was saved by Chemweave (Word, LibreOffice and others name themselves in docProps/app.xml instead). */
export function savedHere(bytes: Uint8Array): boolean {
  try {
    const got = unzipSync(bytes, { filter: (f) => f.name === 'docProps/app.xml' })['docProps/app.xml'];
    return !!got && /<Application>Chemweave<\/Application>/.test(strFromU8(got));
  } catch {
    return false;
  }
}

/** What Chemweave knows of the snapshot it wrote last (to tell, without reading it, that it is still that one). */
interface Known { name: string; size?: number; modified?: number }

export interface SnapshotHost {
  /** What compiling needs (as Compile to Document has it), in the project's drawing style. */
  compileHost(p: SiProject): CompileHost;
  /** The compiled SI as a Word file. */
  docx(doc: DocText, p: SiProject): Promise<Uint8Array>;
  /** Done when the changes on their way to the project's folder are written (`all`: what is being typed too). */
  saved(p: SiProject, all: boolean): Promise<void>;
  flash(msg: string, ms?: number): void;
  /** Done at a moment when the person isn't typing or scrolling (each spectrum PDF waits for one). */
  idle?(): Promise<void>;
}

/**
 * A file's bytes as a key to keep its pages by: its length and SHA-256, worked out by the
 * browser's own code (off this thread, far faster than a loop here), else two hashes in a loop.
 */
async function bytesKey(b: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    try {
      const d = new Uint8Array(await subtle.digest('SHA-256', b as Uint8Array<ArrayBuffer>));
      let hex = '';
      for (const x of d) hex += x.toString(16).padStart(2, '0');
      return `${b.length}:${hex}`;
    } catch { /* (the loop below) */ }
  }
  return loopKey(b);
}

function loopKey(b: Uint8Array): string {
  let h1 = 0x811c9dc5, h2 = 5381;
  for (let i = 0; i < b.length; i++) { h1 = Math.imul(h1 ^ b[i], 0x01000193); h2 = (Math.imul(h2, 33) + b[i]) | 0; }
  return `${b.length}:${(h1 >>> 0).toString(36)}:${(h2 >>> 0).toString(36)}`;
}

/** Why a snapshot is made: its timer, asked for, or the project closing. */
export type SnapshotWhy = 'timer' | 'manual' | 'close';
/** What became of it. */
export type SnapshotOutcome = 'written' | 'up-to-date' | 'skipped' | 'read-only' | 'theirs' | 'failed';

/** Is the snapshot there now, and is it the one written here? */
async function lookAt(folder: SiFolder, name: string, known: Known | null): Promise<'absent' | 'ours' | 'theirs'> {
  const e = (await folder.entries('')).find((x) => x.name === name);
  if (!e && !(await folder.exists(name))) return 'absent';
  if (e?.folder) return 'theirs';
  if (known && known.name === name && e?.size !== undefined && e.modified !== undefined && e.size === known.size && e.modified === known.modified) return 'ours';
  const bytes = await folder.readBytes(name);
  if (!bytes) return 'absent';
  return savedHere(bytes) ? 'ours' : 'theirs';
}

/**
 * Compile the whole project and write its snapshot; the file's name, or 'theirs' when the file
 * there was saved in another program (it is left as it is). Throws when it can't be written.
 */
export async function writeSnapshotDocx(p: SiProject, host: Pick<SnapshotHost, 'compileHost' | 'docx'>, known: Known | null = null): Promise<Known | 'theirs'> {
  const folder = snapshotFolder(p);
  const name = snapshotDocxName(p.title);
  if ((await lookAt(folder, name, known)) === 'theirs') return 'theirs';
  // (the flags on the SI page as comments on their text: the snapshot is to go on working from)
  const got = await compileSi(p, host.compileHost(p), undefined, { flagComments: true });
  const bytes = await host.docx(got.doc, p);
  // (the project may have become read-only meanwhile; the folder asks it again as it writes)
  if (p.readOnly) throw new Error('the project is open read-only');
  await folder.writeBytes(name, bytes);
  const e = (await folder.entries('').catch(() => [])).find((x) => x.name === name);
  return { name, size: e?.size, modified: e?.modified };
}

interface State {
  /** Goes up with each change to the project; `done` is the change the last snapshot has. */
  gen: number;
  done: number;
  timer: ReturnType<typeof setTimeout> | null;
  /** A snapshot waiting its turn (one asked for meanwhile joins it), and the strongest reason it was asked for. */
  waiting: Promise<SnapshotOutcome> | null;
  want: SnapshotWhy;
  /** The snapshot being made, and the change it has. */
  running: Promise<SnapshotOutcome> | null;
  runningGen: number;
  /** A failure (or a file changed elsewhere) was said: not again until a snapshot is written. */
  said: boolean;
  known: Known | null;
  closed: boolean;
}

const STRENGTH: Record<SnapshotWhy, number> = { timer: 0, close: 1, manual: 2 };

/** Keeps the Word snapshots of the open SI projects. */
export class SnapshotKeeper {
  private states = new Map<SiProject, State>();
  /** Snapshots are made one after another (each compile takes the whole project's spectra). */
  private chain: Promise<unknown> = Promise.resolve();
  /** Spectrum pages drawn for a snapshot, by the PDF's bytes and how many pages, with their size (oldest first). */
  private pages = new Map<string, { got: PagePicture[]; chars: number }>();
  private pageChars = 0;

  constructor(private host: SnapshotHost, readonly every = SNAPSHOT_EVERY_MS) {}

  /** The compile host, with each PDF's pages kept for the next snapshot, and drawn when nothing else is happening. */
  private keeping(h: CompileHost): CompileHost {
    const draw = h.pdfPages;
    if (!draw) return h;
    return {
      ...h,
      pdfPages: async (bytes, most) => {
        const key = `${await bytesKey(bytes)}:${most ?? 0}`;
        const hit = this.pages.get(key);
        if (hit) { this.pages.delete(key); this.pages.set(key, hit); return hit.got; }
        await this.host.idle?.();
        const got = await draw(bytes, most);
        // (pages that could not be drawn are tried again next time, not kept)
        if (!got?.length || got.some((pg) => pg.failed)) return got;
        const chars = got.reduce((n, pg) => n + pg.src.length, 0);
        this.pages.set(key, { got, chars });
        this.pageChars += chars;
        for (const [k, v] of this.pages) {
          if (this.pageChars <= PAGES_KEPT_CHARS || k === key) break;
          this.pages.delete(k);
          this.pageChars -= v.chars;
        }
        return got;
      },
    };
  }

  private state(p: SiProject): State {
    let s = this.states.get(p);
    if (!s) {
      s = { gen: 0, done: 0, timer: null, waiting: null, want: 'timer', running: null, runningGen: 0, said: false, known: null, closed: false };
      this.states.set(p, s);
    }
    return s;
  }

  /** A project opened: with no snapshot yet, one is made at the first turn of the timer. */
  async opened(p: SiProject): Promise<void> {
    const s = this.state(p);
    if (p.readOnly) return;
    const there = await snapshotFolder(p).exists(snapshotDocxName(p.title)).catch(() => true);
    if (!there && s.gen === s.done) { s.gen++; this.arm(p, s); }
  }

  /** The project changed (a step of its history ended, or was undone or redone). */
  changed(p: SiProject): void {
    const s = this.state(p);
    if (s.closed) return;
    s.gen++;
    this.arm(p, s);
  }

  /** Whether the project changed since its last snapshot. */
  isChanged(p: SiProject): boolean {
    const s = this.states.get(p);
    return !!s && s.gen !== s.done;
  }

  private arm(p: SiProject, s: State): void {
    if (s.timer || s.closed || p.readOnly) return;
    s.timer = setTimeout(() => { s.timer = null; void this.snapshot(p, 'timer'); }, this.every);
  }

  /** Make the project's snapshot (in turn); a timer's is skipped while one is being made. */
  snapshot(p: SiProject, why: SnapshotWhy): Promise<SnapshotOutcome> {
    const s = this.state(p);
    if (s.waiting) {
      if (STRENGTH[why] > STRENGTH[s.want]) s.want = why;
      return s.waiting;
    }
    // (the one being made has every change so far: it is the answer)
    if (s.running && (why === 'timer' || s.gen === s.runningGen)) return why === 'timer' ? Promise.resolve('skipped') : s.running;
    s.want = why;
    const run = this.chain.then(() => this.make(p, s));
    s.waiting = run;
    this.chain = run.catch(() => {});
    return run;
  }

  private async make(p: SiProject, s: State): Promise<SnapshotOutcome> {
    const why = s.want;
    s.waiting = null;
    if (p.readOnly) return 'read-only';
    if (s.gen === s.done) {
      if (why !== 'manual') return 'up-to-date';
      // (asked again with nothing changed: the snapshot written last, still there as it was written, is the answer)
      const name = snapshotDocxName(p.title);
      if (s.known?.name === name && (await lookAt(snapshotFolder(p), name, s.known).catch(() => 'absent')) === 'ours') return 'up-to-date';
    }
    if (s.timer) { clearTimeout(s.timer); s.timer = null; }
    let done!: (o: SnapshotOutcome) => void;
    s.running = new Promise<SnapshotOutcome>((r) => { done = r; });
    s.runningGen = -1;
    let out: SnapshotOutcome = 'failed';
    try {
      // (what was saved last is in the folder before it is read; a timer's leaves what is being typed alone)
      await this.host.saved(p, why !== 'timer');
      const gen = s.gen;
      s.runningGen = gen;
      const got = await writeSnapshotDocx(p, { compileHost: (q) => this.keeping(this.host.compileHost(q)), docx: (d, q) => this.host.docx(d, q) }, s.known);
      if (got === 'theirs') {
        out = 'theirs';
        if (!s.said || why === 'manual') this.host.flash(`“${snapshotDocxName(p.title)}” ${placeOf(p)} was saved in another program since, so it was not replaced. Rename or move it to keep those changes; the Word snapshot is then saved again.`, 10000);
        s.said = true;
      } else {
        out = 'written';
        s.known = got;
        s.done = gen;
        s.said = false;
      }
    } catch (e) {
      out = p.readOnly ? 'read-only' : 'failed';
      if (out === 'failed' && (!s.said || why === 'manual')) {
        this.host.flash(`The Word snapshot of “${p.title}” could not be saved: ${e instanceof Error ? e.message : String(e)}`, 8000);
        s.said = true;
      }
    } finally {
      s.running = null;
      done(out);
      // (changes made while it was being made: the next one comes at the timer's next turn)
      if (s.gen !== s.done && out !== 'theirs' && out !== 'read-only') this.arm(p, s);
    }
    return out;
  }

  /** Save Word Snapshot: made now (after any being made), and the person told how it went. */
  async saveNow(p: SiProject): Promise<SnapshotOutcome> {
    if (p.readOnly) { this.host.flash('This SI project is open read-only, so its Word snapshot is not saved.'); return 'read-only'; }
    this.host.flash('Saving the Word snapshot…', 60000);
    const out = await this.snapshot(p, 'manual');
    if (out === 'written' || out === 'up-to-date') this.host.flash(`Saved “${snapshotDocxName(p.title)}” ${placeOf(p)}. This Word copy is a backup.`, 6000);
    else if (out === 'read-only') this.host.flash('This SI project is open read-only, so its Word snapshot is not saved.');
    return out;
  }

  /** The project is closing: its snapshot is made if it changed since the last one; then it is forgotten. */
  async closing(p: SiProject): Promise<SnapshotOutcome> {
    const s = this.states.get(p);
    if (!s) return 'up-to-date';
    s.closed = true;
    if (s.timer) { clearTimeout(s.timer); s.timer = null; }
    try {
      return s.gen !== s.done || s.waiting || s.running ? await this.snapshot(p, 'close') : 'up-to-date';
    } finally {
      if (this.states.get(p) === s) this.states.delete(p);
      // (no project open: the pages kept go)
      if (!this.states.size) { this.pages.clear(); this.pageChars = 0; }
    }
  }

  /** The app is quitting: each project's snapshot, waited for at most `ms` (what isn't done by then is left). */
  async closingAll(ps: SiProject[], ms: number): Promise<void> {
    const todo = ps.filter((p) => this.isChanged(p) && !p.readOnly);
    if (todo.length) this.host.flash(`Saving the Word snapshot${todo.length === 1 ? '' : 's'} of the SI project${todo.length === 1 ? '' : 's'}…`, ms);
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      Promise.all(ps.map((p) => this.closing(p).catch(() => 'failed'))),
      new Promise((r) => { timer = setTimeout(r, ms); }),
    ]);
    clearTimeout(timer);
  }
}
