// Where an SI project's files are: a folder on this computer (the desktop app), or, for the
// tests, a folder kept in memory. Paths inside it are relative and use "/".

export interface SiFolder {
  /** The folder's own path or name, as shown to the person. */
  readonly where: string;
  /** A file's text (null when there is no such file). */
  readText(rel: string): Promise<string | null>;
  readBytes(rel: string): Promise<Uint8Array | null>;
  /** Write a file whole (through a temporary file, so a failure never leaves half of one); folders it needs are made. */
  writeText(rel: string, text: string): Promise<void>;
  writeBytes(rel: string, bytes: Uint8Array): Promise<void>;
  exists(rel: string): Promise<boolean>;
  /** Every file under `rel` (and the folders inside it) with one of these extensions, as paths from the project folder. */
  list(rel: string, extensions: readonly string[]): Promise<string[]>;
  /** Move a file or folder (to the Trash); `to` must not be there yet. */
  move(from: string, to: string): Promise<void>;
  /** Delete one file (the lock), if it is there. */
  remove(rel: string): Promise<void>;
  /** The files and folders directly inside `rel` (hidden ones left out), sorted by name; [] when there is no such folder. A file's size in bytes and when it last changed (ms since 1970) are given when known. */
  entries(rel: string): Promise<FolderEntry[]>;
  /** Delete a folder of the project's Trash (trash/ itself or one entry in it), or of Chemweave's undo holding folder (build/chemweave-undo), with everything in it. Nothing else can be deleted this way. */
  removeTrash(rel: string): Promise<void>;
  /**
   * Asked before each change to the folder (not the lock, nor build/): the open project checks
   * here that it may still write (it still has the lock, the folder is still there), and throws
   * when it may not. Set by the project; folders that wrap another pass changes to it.
   */
  beforeChange?: ((rel: string) => Promise<void>) | null;
}

/** One file or folder directly inside a folder: its size in bytes and when it last changed (ms since 1970) when known. */
export interface FolderEntry { name: string; folder: boolean; size?: number; modified?: number }

/** Changes that are never held up: the lock itself, and Chemweave's own working files in build/. */
const unguarded = (rel: string): boolean => /^(\.lock$|build(\/|$))/.test(rel);

/** Where Chemweave keeps files that Undo took away, until Redo puts them back (build/ is never part of the project). */
export const UNDO_HOLDING = 'build/chemweave-undo';

/** Whether `rel` is the project's trash folder or one entry directly inside it (or the same of the undo holding folder). */
export function isTrashPath(rel: string): boolean {
  try {
    return /^(trash|build\/chemweave-undo)(\/[^/]+)?$/.test(norm(rel));
  } catch {
    return false;
  }
}

/**
 * Project text is UTF-8, but a file saved by another editor (Notepad's "ANSI", Windows-1252)
 * is still read rather than failing: bytes that aren't UTF-8 are read as Windows-1252, as
 * SI Assistant reads them.
 */
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  const start = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  const body = bytes.subarray(start);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch {
    return decodeMixed(body);
  }
}

/** How many bytes the UTF-8 character starting at `i` takes (0: the byte there is not the start of one). */
function utf8Length(b: Uint8Array, i: number): number {
  const c = b[i];
  if (c < 0x80) return 1;
  const cont = (k: number, lo = 0x80, hi = 0xbf): boolean => i + k < b.length && b[i + k] >= lo && b[i + k] <= hi;
  if (c >= 0xc2 && c <= 0xdf) return cont(1) ? 2 : 0;
  if (c === 0xe0) return cont(1, 0xa0) && cont(2) ? 3 : 0;
  if (c === 0xed) return cont(1, 0x80, 0x9f) && cont(2) ? 3 : 0;
  if (c >= 0xe1 && c <= 0xef) return cont(1) && cont(2) ? 3 : 0;
  if (c === 0xf0) return cont(1, 0x90) && cont(2) && cont(3) ? 4 : 0;
  if (c >= 0xf1 && c <= 0xf3) return cont(1) && cont(2) && cont(3) ? 4 : 0;
  if (c === 0xf4) return cont(1, 0x80, 0x8f) && cont(2) && cont(3) ? 4 : 0;
  return 0;
}

/** Text that is mostly UTF-8: only the bytes that are not are read as Windows-1252 (0xB0 → °), so a δ beside them stays a δ. */
function decodeMixed(b: Uint8Array): string {
  const utf8 = new TextDecoder('utf-8');
  const cp1252 = new TextDecoder('windows-1252');
  let out = '';
  let good = 0;
  for (let i = 0; i < b.length;) {
    const n = utf8Length(b, i);
    if (n) { i += n; continue; }
    out += utf8.decode(b.subarray(good, i)) + cp1252.decode(b.subarray(i, i + 1));
    good = ++i;
  }
  return out + utf8.decode(b.subarray(good));
}

/** A text file as the program works with it: line ends are "\n" whatever editor saved it (as SI Assistant reads them). */
export function decodeTextFile(bytes: Uint8Array): string {
  return decodeText(bytes).replace(/\r\n/g, '\n');
}

/** Something outside the project folder was asked for (a path with ".." in a project file). */
export class SiPathError extends Error {}

/** A path from the project folder, tidied; one that would leave the folder ("..") is refused. */
/** For reading: a path outside the project is simply not there. */
function inside(rel: string): string | null {
  try { return norm(rel); } catch { return null; }
}

function norm(rel: string): string {
  const r = rel.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
  if (r.split('/').some((x) => x === '..' || x === '.')) throw new SiPathError(`“${rel}” is not a file of this project (a path in a project file points outside the project folder), so it was left alone.`);
  return r;
}
const extOf = (p: string): string => (/\.([^./]+)$/.exec(p)?.[1] ?? '').toLowerCase();

/** A folder kept in memory (for the tests, and for trying the SI Project tab without files). */
export class MemoryFolder implements SiFolder {
  files = new Map<string, Uint8Array>();
  beforeChange: ((rel: string) => Promise<void>) | null = null;
  constructor(readonly where = 'memory') {}
  private async ask(rel: string): Promise<void> { if (this.beforeChange && !unguarded(rel)) await this.beforeChange(rel); }

  async readText(rel: string): Promise<string | null> {
    const b = this.files.get(inside(rel) ?? '\0');
    return b ? decodeTextFile(b) : null;
  }
  async readBytes(rel: string): Promise<Uint8Array | null> { return this.files.get(inside(rel) ?? '\0') ?? null; }
  async writeText(rel: string, text: string): Promise<void> { const r = norm(rel); await this.ask(r); this.files.set(r, new TextEncoder().encode(text)); }
  async writeBytes(rel: string, bytes: Uint8Array): Promise<void> { const r = norm(rel); await this.ask(r); this.files.set(r, bytes); }
  async exists(rel: string): Promise<boolean> {
    const r = inside(rel);
    if (r === null) return false;
    return this.files.has(r) || [...this.files.keys()].some((k) => k.startsWith(r + '/'));
  }
  async list(rel: string, extensions: readonly string[]): Promise<string[]> {
    const r = inside(rel);
    if (r === null) return [];
    const want = new Set(extensions.map((e) => e.toLowerCase()));
    // hidden files are left out, as the desktop listing leaves them out
    return [...this.files.keys()].filter((k) => (!r || k.startsWith(r + '/')) && want.has(extOf(k)) && !k.split('/').some((s) => s.startsWith('.'))).sort();
  }
  async move(from: string, to: string): Promise<void> {
    const f = norm(from), t = norm(to);
    if (!(unguarded(f) && unguarded(t))) await this.ask(unguarded(f) ? t : f);
    if (!(await this.exists(f))) throw new Error(`${f} is not there (it may have been moved or deleted).`);
    if (await this.exists(t)) throw new Error(`${t} is already there.`);
    for (const k of [...this.files.keys()]) {
      if (k === f || k.startsWith(f + '/')) {
        this.files.set(t + k.slice(f.length), this.files.get(k)!);
        this.files.delete(k);
      }
    }
  }
  /** Only the lock is ever deleted, as on disk (anything else goes to the Trash, or is set aside). */
  async remove(rel: string): Promise<void> {
    const r = norm(rel);
    if (r !== '.lock') throw new Error(`not an SI project's lock: ${rel}`);
    this.files.delete(r);
  }
  async entries(rel: string): Promise<FolderEntry[]> {
    const r = inside(rel);
    if (r === null) return [];
    const out = new Map<string, boolean>();
    for (const k of this.files.keys()) {
      if (r && !k.startsWith(r + '/')) continue;
      const rest = r ? k.slice(r.length + 1) : k;
      const [first, ...more] = rest.split('/');
      if (first.startsWith('.')) continue;
      out.set(first, (out.get(first) ?? false) || more.length > 0);
    }
    return [...out].map(([name, folder]): FolderEntry => (folder ? { name, folder } : { name, folder, size: this.files.get(r ? `${r}/${name}` : name)?.length ?? 0 }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }
  async removeTrash(rel: string): Promise<void> {
    if (!isTrashPath(rel)) throw new Error(`Only the project's Trash can be emptied this way (not ${rel}).`);
    const r = norm(rel);
    await this.ask(r);
    for (const k of [...this.files.keys()]) if (k === r || k.startsWith(r + '/')) this.files.delete(k);
  }
  /** Text of a file (tests). */
  text(rel: string): string | undefined {
    const b = this.files.get(norm(rel));
    return b && decodeTextFile(b);
  }
}

type Invoke = <T>(cmd: string, args?: Record<string, unknown>, opts?: { headers: Record<string, string> }) => Promise<T>;

/** A folder on this computer (the desktop app). */
export class DiskFolder implements SiFolder {
  private sep: string;
  beforeChange: ((rel: string) => Promise<void>) | null = null;
  private async ask(rel: string): Promise<void> { const r = norm(rel); if (this.beforeChange && !unguarded(r)) await this.beforeChange(r); }
  constructor(readonly where: string, private invoke: Invoke) {
    this.sep = where.includes('\\') && !where.includes('/') ? '\\' : '/';
  }
  private abs(rel: string): string {
    const r = norm(rel);
    return r ? this.where.replace(/[\\/]+$/, '') + this.sep + r.split('/').join(this.sep) : this.where;
  }
  private relOf(abs: string): string {
    const base = this.where.replace(/[\\/]+$/, '').replace(/\\/g, '/');
    const a = abs.replace(/\\/g, '/');
    return a.startsWith(base + '/') ? a.slice(base.length + 1) : a;
  }
  async readBytes(rel: string): Promise<Uint8Array | null> {
    if (inside(rel) === null) return null;
    // (one call for a file that is there; whether it is there is only asked when reading fails)
    const path = this.abs(rel);
    try {
      return new Uint8Array(await this.invoke<ArrayBuffer>('read_binary_file', { path }));
    } catch (e) {
      // "no such file" (os error 2; Windows' "no such folder" is 3) is not a failure
      if (/\(os error [23]\)/.test(String(e instanceof Error ? e.message : e))) return null;
      if (!(await this.exists(rel).catch(() => true))) return null;
      throw e;
    }
  }
  async readText(rel: string): Promise<string | null> {
    const b = await this.readBytes(rel);
    return b && decodeTextFile(b);
  }
  private async parentOf(rel: string): Promise<void> {
    const r = norm(rel);
    const cut = r.lastIndexOf('/');
    if (cut > 0) await this.invoke('make_folder', { path: this.abs(r.slice(0, cut)) });
  }
  async writeText(rel: string, text: string): Promise<void> {
    await this.ask(rel);
    await this.parentOf(rel);
    await this.invoke('write_text_file', { path: this.abs(rel), contents: text });
  }
  async writeBytes(rel: string, bytes: Uint8Array): Promise<void> {
    await this.ask(rel);
    await this.parentOf(rel);
    await this.invoke('write_binary_file', bytes as unknown as Record<string, unknown>, { headers: { path: encodeURIComponent(this.abs(rel)) } });
  }
  async exists(rel: string): Promise<boolean> { return inside(rel) !== null && this.invoke<boolean>('path_exists', { path: this.abs(rel) }); }
  async list(rel: string, extensions: readonly string[]): Promise<string[]> {
    if (!(await this.exists(rel))) return [];
    const got = await this.invoke<{ files: { path: string }[] }>('list_folder', { path: this.abs(rel), extensions: [...extensions], sub: true });
    return got.files.map((f) => this.relOf(f.path)).sort();
  }
  async move(from: string, to: string): Promise<void> {
    const f = norm(from), t = norm(to);
    if (!(unguarded(f) && unguarded(t))) await this.ask(unguarded(f) ? t : f);
    await this.parentOf(to);
    await this.invoke('si_move', { from: this.abs(from), to: this.abs(to), root: this.where });
  }
  async remove(rel: string): Promise<void> {
    await this.invoke('si_remove_lock', { path: this.abs(rel) });
  }
  async entries(rel: string): Promise<FolderEntry[]> {
    if (!(await this.exists(rel))) return [];
    const got = await this.invoke<FolderEntry[]>('si_list_dir', { path: this.abs(rel) });
    return got.filter((e) => !e.name.startsWith('.')).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }
  async removeTrash(rel: string): Promise<void> {
    if (!isTrashPath(rel)) throw new Error(`Only the project's Trash can be emptied this way (not ${rel}).`);
    await this.ask(rel);
    await this.invoke('si_remove_trash', { path: this.abs(rel) });
  }
}
