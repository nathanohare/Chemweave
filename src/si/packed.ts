// SI projects kept as one file (.chemsi): a zip of the project folder, as a .docx is a zip of
// Word's parts. Inside is exactly the folder Chem SI Assistant uses, so renaming the file to
// .zip and unzipping it gives that folder back, and a zip of a project folder (an SI Assistant
// snapshot) opens too.
//
// While one is open, Chemweave works in a copy unpacked into its own data folder (the desktop
// app: src-tauri/src/si_file.rs), so editing is as quick as in a folder project; Save packs that
// copy back into the file. `ChangeCounter` wraps the copy's folder to tell when there are changes
// not saved to the file yet. The copy is kept until the project closes, so after a crash its
// changes can be recovered (`source.json` beside it says which file it came from).

import { isSnapshotDocx } from './snapshot-docx';
import type { FolderEntry, SiFolder } from './folder';

/** The extension of an SI project file. */
export const SI_FILE_EXT = 'chemsi';
/** Files that open as SI projects: the project file, and a zip of a project's folder. */
export const SI_OPEN_EXTS = [SI_FILE_EXT, 'zip'] as const;

/** Whether a path names an SI project file (rather than a project folder). */
export function isSiFile(path: string): boolean {
  const ext = /\.([^./\\]+)$/.exec(path)?.[1]?.toLowerCase() ?? '';
  return (SI_OPEN_EXTS as readonly string[]).includes(ext);
}

/** The file's name without its folder or extension. */
export function siFileStem(path: string): string {
  const name = path.replace(/\\/g, '/').split('/').pop() ?? '';
  return name.replace(/\.[^.]+$/, '') || 'SI Project';
}

/** `path` with the project file's extension (a .zip opened is saved as a .chemsi beside it). */
export function asSiFile(path: string): string {
  return /\.chemsi$/i.test(path) ? path : path.replace(/\.zip$/i, '') + '.' + SI_FILE_EXT;
}

/**
 * Changes that leave the project as it was saved: the lock, Chemweave's own working files in
 * build/, the manuscript check's cache, and the Word snapshot (made again from the project).
 */
export function unsavedChange(rel: string): boolean {
  const r = rel.replace(/\\/g, '/').replace(/^\/+/, '');
  return !/^(\.lock$|build(\/|$)|manuscript\/check\.json$)/.test(r) && !isSnapshotDocx(r);
}

/** What the project file leaves out of the names at the project folder's top: the Word snapshot (made again from the project). */
export function packSkips(names: readonly string[]): string[] {
  return names.filter((n) => isSnapshotDocx(n));
}

/**
 * A project folder that counts its changes, so the tab knows when there are some not saved to
 * the project file yet. `changes` goes up with each; `saved` is what it was at the last save.
 */
export class ChangeCounter implements SiFolder {
  changes = 0;
  saved = 0;
  onChange: (() => void) | null = null;

  constructor(readonly inner: SiFolder) {}

  get where(): string { return this.inner.where; }
  get beforeChange(): ((rel: string) => Promise<void>) | null | undefined { return this.inner.beforeChange; }
  set beforeChange(f: ((rel: string) => Promise<void>) | null | undefined) { this.inner.beforeChange = f; }

  /** Whether there are changes not in the project file yet. */
  get dirty(): boolean { return this.changes !== this.saved; }

  private changed(rel: string): void {
    if (!unsavedChange(rel)) return;
    this.changes++;
    this.onChange?.();
  }

  readText(rel: string): Promise<string | null> { return this.inner.readText(rel); }
  readBytes(rel: string): Promise<Uint8Array | null> { return this.inner.readBytes(rel); }
  exists(rel: string): Promise<boolean> { return this.inner.exists(rel); }
  list(rel: string, extensions: readonly string[]): Promise<string[]> { return this.inner.list(rel, extensions); }
  entries(rel: string): Promise<FolderEntry[]> { return this.inner.entries(rel); }
  remove(rel: string): Promise<void> { return this.inner.remove(rel); }

  async writeText(rel: string, text: string): Promise<void> {
    try { await this.inner.writeText(rel, text); } finally { this.changed(rel); }
  }
  async writeBytes(rel: string, bytes: Uint8Array): Promise<void> {
    try { await this.inner.writeBytes(rel, bytes); } finally { this.changed(rel); }
  }
  async move(from: string, to: string): Promise<void> {
    try { await this.inner.move(from, to); } finally { this.changed(unsavedChange(from) ? from : to); }
  }
  async removeTrash(rel: string): Promise<void> {
    try { await this.inner.removeTrash(rel); } finally { this.changed(rel); }
  }
}

/** The change counter under a project's folder (under its Undo history), if it is a project file's. */
export function counterOf(folder: SiFolder): ChangeCounter | null {
  let f: SiFolder | undefined = folder;
  for (let i = 0; f && i < 4; i++) {
    if (f instanceof ChangeCounter) return f;
    f = (f as { inner?: SiFolder }).inner;
  }
  return null;
}

/** Where an open project file's copy is: `working` is deleted when it closes; `root` is the project's folder in it. */
export interface SiWorking { working: string; root: string }

/**
 * What `source.json` in a working folder says: the file it was unpacked from (null: never saved
 * yet), its title, whether it has changes not saved to the file, the file as it was when last
 * opened or saved (to tell whether it changed elsewhere since), and where the project's folder is.
 */
export interface SiSource { file: string | null; title: string; opened: string; unsaved: boolean; stamp: { modified: number; size: number } | null; root: string }

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

/** The desktop app's side of project files (src-tauri/src/si_file.rs). */
export class SiFiles {
  constructor(private invoke: Invoke) {}

  /** Unpack a project file into a new working copy. */
  unpack(file: string): Promise<SiWorking> { return this.invoke<SiWorking>('si_unpack', { file }); }
  /** A new, empty working folder for a project not saved as a file yet, its folder named `name`. */
  fresh(name: string): Promise<SiWorking> { return this.invoke<SiWorking>('si_new_working', { name }); }
  /** Pack a project folder into `file` (written beside it, then put in its place). Its size in bytes. */
  pack(root: string, file: string, skip: string[] = []): Promise<number> { return this.invoke<number>('si_pack', { root, file, skip }); }
  /** Unpack a project file into a new folder (Save As ▸ SI Project Folder). The project's folder. */
  unpackTo(file: string, into: string): Promise<string> { return this.invoke<string>('si_unpack_to', { file, into }); }
  /** Delete a working copy (only ever one inside Chemweave's own working folder). */
  discard(w: SiWorking): Promise<void> { return this.invoke<void>('si_discard_working', { working: w.working }); }
  /** Working copies left from before (a crash): for recovery. */
  leftOver(): Promise<{ working: string; modified: number }[]> { return this.invoke('si_list_working'); }

  /** Note in the working copy which file it is (for recovery after a crash). */
  async note(w: SiWorking, src: SiSource): Promise<void> {
    await this.invoke('write_text_file', { path: joinPath(w.working, 'source.json'), contents: JSON.stringify(src, null, 1) });
  }
  async source(working: string): Promise<SiSource | null> {
    try {
      const got = JSON.parse(await this.invoke<string>('read_text_file', { path: joinPath(working, 'source.json') })) as Partial<SiSource>;
      const st = got.stamp && typeof got.stamp === 'object' && typeof got.stamp.modified === 'number' && typeof got.stamp.size === 'number' ? { modified: got.stamp.modified, size: got.stamp.size } : null;
      return {
        file: typeof got.file === 'string' ? got.file : null, title: typeof got.title === 'string' ? got.title : '', opened: typeof got.opened === 'string' ? got.opened : '',
        unsaved: got.unsaved === true, stamp: st, root: typeof got.root === 'string' ? got.root : '',
      };
    } catch {
      return null;
    }
  }
}

/** `dir` and a name, with the separator `dir` uses. */
export function joinPath(dir: string, name: string): string {
  const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/';
  return dir.replace(/[\\/]+$/, '') + sep + name;
}
