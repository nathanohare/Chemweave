// Undo and Redo in the SI Project tab. Chemweave keeps its own history of an SI project (Nate's
// choice: SI Assistant's build/undo journal is not shared; the Trash is). The project's folder is
// wrapped so every change a command makes to its files is recorded, and one command is one step:
//   a file written:  what it held before (or that it wasn't there)
//   a file or folder moved (to the Trash, or between sections)
// Undo puts each back, newest first, and what it does is recorded in turn, so Redo is the same
// thing the other way. A file that a step made is not deleted by Undo: it is moved into
// build/chemweave-undo/ (build/ is never part of the project: SI Assistant makes it again and
// snapshots leave it out), where Redo finds it; that folder is emptied when the project closes,
// and what a step kept there goes when the step leaves the history (Redo dropped by a new
// change, or the oldest step past the limit). Items emptied from the Trash wait there too, so
// Empty Trash can be undone until then. Undo and Redo run one at a time; commands and saves that
// start meanwhile wait for them.
//
// Before a step is undone, the files it wrote are checked: if one was changed since (in Chem SI
// Assistant, or by hand), Undo says so and changes nothing, rather than lose that change.

import { UNDO_HOLDING, isTrashPath, type SiFolder } from './folder';

type Change =
  | { kind: 'write'; path: string; before: Uint8Array | null; after: string }
  | { kind: 'move'; from: string; to: string };

export interface UndoStep { label: string; changes: Change[] }

/** The most steps kept (the oldest goes first). */
export const MAX_STEPS = 100;
/** The most bytes of earlier file contents the history keeps in memory (the oldest steps go first; the newest always stays). */
export const MAX_HELD_BYTES = 64 * 1024 * 1024;
/** Files no step records: the lock, the build output (and the undo holding folder in it), snapshots, the manuscript check's cache. */
const UNRECORDED = /^(\.lock$|build(\/|$)|snapshots(\/|$)|manuscript\/check\.json$)/;

const norm = (rel: string): string => rel.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
const parentOf = (p: string): string => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const under = (p: string, dir: string): boolean => p === dir || p.startsWith(dir + '/');

/** A short fingerprint of a file's bytes (FNV-1a and the length), to tell whether it changed. */
export function fingerprint(b: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 0x01000193); }
  return `${b.length}:${(h >>> 0).toString(16)}`;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Undo can't go ahead (a file changed outside Chemweave since, or something failed). */
export class UndoError extends Error {}

let held = 0;

/** An SI project's folder, with the history of its changes. */
export class JournalFolder implements SiFolder {
  private undos: UndoStep[] = [];
  private redos: UndoStep[] = [];
  private open: UndoStep | null = null;
  private depth = 0;
  private implicit = 0;
  /** While Undo or Redo is putting a step back: ends when it has (commands and saves wait for it). */
  private busy: Promise<void> | null = null;
  /** The most bytes of earlier contents kept (tests make it small). */
  maxHeldBytes = MAX_HELD_BYTES;
  /** Called when what Undo and Redo would do changes (for the Edit menu). */
  onChange: (() => void) | null = null;
  /**
   * Goes up each time a file is written, moved or put back, at the start and again at the end of
   * it, so what was worked out from the folder is known to be current while this has not moved.
   */
  changes = 0;

  constructor(readonly inner: SiFolder) {}

  get where(): string { return this.inner.where; }

  // ---------------------------------------------------------------- steps

  /** Start a step (steps started inside one are part of it). */
  begin(label: string): void {
    if (this.depth === 0) {
      this.settle();
      this.open = { label, changes: [] };
    }
    this.depth++;
  }

  /** End the step begun last. */
  end(): void {
    if (this.depth === 0) return;
    if (--this.depth === 0) this.finish();
  }

  /** `f` as one step (it waits for an Undo or Redo under way). */
  async step<T>(label: string, f: () => Promise<T>): Promise<T> {
    while (this.busy) await this.busy;
    this.begin(label);
    try { return await f(); } finally { this.end(); }
  }

  /** A change made outside any step (a drawing saved from a scheme page, say) is its own step, ended once changes stop coming. */
  settle(): void {
    if (!this.implicit) return;
    clearTimeout(this.implicit);
    this.implicit = 0;
    if (this.depth === 0) this.finish();
  }

  private finish(): void {
    const s = this.open;
    this.open = null;
    if (!s?.changes.length) return;
    this.undos.push(s);
    const gone = this.redos;
    this.redos = [];
    this.forget([...gone, ...this.trim()]);
    this.onChange?.();
  }

  /** Take the oldest steps off the history while it is too long or holds too many bytes; the steps taken off. */
  private trim(): UndoStep[] {
    const out: UndoStep[] = [];
    const size = (list: UndoStep[]): number => list.reduce((n, s) => n + s.changes.reduce((m, c) => m + (c.kind === 'write' && c.before ? c.before.length : 0), 0), 0);
    while (this.undos.length > MAX_STEPS) out.push(this.undos.shift()!);
    while (this.undos.length > 1 && size(this.undos) + size(this.redos) > this.maxHeldBytes) out.push(this.undos.shift()!);
    return out;
  }

  /** Steps that left the history: what they kept in the holding folder can never be asked for again, so it goes. */
  private forget(steps: UndoStep[]): void {
    const ids = new Set<string>();
    for (const s of steps) for (const c of s.changes) {
      if (c.kind !== 'move') continue;
      for (const path of [c.from, c.to]) if (under(path, UNDO_HOLDING) && path !== UNDO_HOLDING) ids.add(path.slice(UNDO_HOLDING.length + 1).split('/')[0]);
    }
    for (const id of ids) void this.inner.removeTrash(`${UNDO_HOLDING}/${id}`).catch(() => { /* it stays until the project closes */ });
  }

  private record(): UndoStep {
    if (!this.open) {
      this.open = { label: 'Change', changes: [] };
      this.implicit = setTimeout(() => { this.implicit = 0; if (this.depth === 0) this.finish(); }, 600) as unknown as number;
    } else if (this.implicit) {
      clearTimeout(this.implicit);
      this.implicit = setTimeout(() => { this.implicit = 0; if (this.depth === 0) this.finish(); }, 600) as unknown as number;
    }
    return this.open;
  }

  /** The name of the step Undo (or Redo) would take back; null with none. */
  history(redo: boolean): string | null {
    const list = redo ? this.redos : this.undos;
    if (!redo && this.open?.changes.length && this.depth === 0) return this.open.label;
    return list.length ? list[list.length - 1].label : null;
  }

  /** Forget the history, and empty the holding folder (when the project closes, or opens after a crash). */
  async clear(): Promise<void> {
    while (this.busy) await this.busy;
    this.settle();
    this.undos = [];
    this.redos = [];
    this.onChange?.();
    if (await this.inner.exists(UNDO_HOLDING).catch(() => false)) await this.inner.removeTrash(UNDO_HOLDING);
  }

  /** Take back the last step; its name, or null with nothing to undo. */
  undo(): Promise<string | null> { return this.go(false); }
  redo(): Promise<string | null> { return this.go(true); }

  /** One Undo or Redo at a time: a second one asked for meanwhile (Ctrl+Z held down) takes the next step when the first is done. */
  private async go(redo: boolean): Promise<string | null> {
    this.changes++;
    // (and for writes already begun: one finishing after the Undo would be written into the wrong step)
    for (;;) {
      while (this.busy) await this.busy;
      if (!this.writing.size) break;
      await Promise.allSettled([...this.writing]);
    }
    if (this.depth > 0) throw new UndoError('Wait for the change being saved to finish, then try again.');
    let done!: () => void;
    this.busy = new Promise<void>((r) => { done = r; });
    try {
      return await this.goNow(redo);
    } finally {
      this.changes++;
      this.busy = null;
      done();
    }
  }

  private async goNow(redo: boolean): Promise<string | null> {
    this.settle();
    const from = redo ? this.redos : this.undos;
    const step = from[from.length - 1];
    if (!step) return null;
    const changed = await this.changedSince(step);
    if (changed.length) {
      const names = changed.slice(0, 3).join(', ') + (changed.length > 3 ? ` and ${changed.length - 3} more` : '');
      throw new UndoError(`${redo ? 'Redo' : 'Undo'} ${step.label} would overwrite changes made outside Chemweave since (to ${names}), so nothing was changed.`);
    }
    let back: UndoStep;
    try {
      back = await this.replay(step);
    } catch (e) {
      throw new UndoError(`${redo ? 'Redo' : 'Undo'} ${step.label} could not finish: ${e instanceof Error ? e.message : String(e)}`);
    }
    // (the step itself, wherever it is now: a change begun with begin() meanwhile may have ended a step of its own)
    const list = redo ? this.redos : this.undos;
    const at = list.lastIndexOf(step);
    if (at >= 0) list.splice(at, 1);
    (redo ? this.undos : this.redos).push(back);
    this.onChange?.();
    return step.label;
  }

  /** The files the step wrote that hold something else now. */
  private async changedSince(step: UndoStep): Promise<string[]> {
    const expect = new Map<string, string | true>();
    for (const c of step.changes) {
      if (c.kind === 'write') expect.set(c.path, c.after);
      else {
        for (const k of [...expect.keys()]) if (under(k, c.from)) expect.delete(k);
        expect.set(c.to, true);
      }
    }
    const out: string[] = [];
    for (const [path, want] of expect) {
      if (want === true) { if (!(await this.inner.exists(path))) out.push(path); continue; }
      const now = await this.inner.readBytes(path).catch(() => null);
      if (!now || fingerprint(now) !== want) out.push(path);
    }
    return out;
  }

  /**
   * Put the step's changes back, newest first; what that does is the step that reverses it. It
   * is written down here directly, never through the step that is open: a command or a save
   * that starts meanwhile keeps its own step.
   */
  private async replay(step: UndoStep): Promise<UndoStep> {
    const back: UndoStep = { label: step.label, changes: [] };
    try {
      for (const c of [...step.changes].reverse()) {
        if (c.kind === 'move') {
          if (await this.inner.exists(c.to)) await this.moved(c.to, c.from, back);
          // (a Trash entry the move made, empty now, goes too)
          if (c.to.startsWith('trash/')) await this.prune(parentOf(c.to), back);
        } else if (c.before) {
          const before = await this.inner.readBytes(c.path).catch(() => null);
          await this.inner.writeBytes(c.path, c.before);
          back.changes.push({ kind: 'write', path: c.path, before, after: fingerprint(c.before) });
        } else await this.takeAway(c.path, back);
      }
    } catch (e) {
      // (what was put back is reversed again, so the step is still whole)
      for (const c of [...back.changes].reverse()) {
        try {
          if (c.kind === 'move') await this.inner.move(c.to, c.from);
          else if (c.before) await this.inner.writeBytes(c.path, c.before);
        } catch { /* best effort */ }
      }
      throw e;
    }
    return back;
  }

  /** Move, written down in `into` (a step being put back), or in the step that is open. */
  private async moved(from: string, to: string, into?: UndoStep): Promise<void> {
    this.changes++;
    try { await this.inner.move(from, to); } finally { this.changes++; }
    if (!(UNRECORDED.test(from) && UNRECORDED.test(to))) (into ?? this.record()).changes.push({ kind: 'move', from, to });
  }

  private holding(path: string): string { return `${UNDO_HOLDING}/${Date.now().toString(36)}-${++held}/${path}`; }

  /** A file the step made goes to the holding folder (and folders it leaves empty follow it). */
  private async takeAway(path: string, into?: UndoStep): Promise<void> {
    if (!(await this.inner.exists(path))) return;
    await this.moved(path, this.holding(path), into);
    await this.prune(parentOf(path), into);
  }

  /** Folders left empty (below the project's top folders) go to the holding folder too. */
  private async prune(dir: string, into?: UndoStep): Promise<void> {
    while (dir.includes('/') && !UNRECORDED.test(dir)) {
      if (!(await this.inner.exists(dir)) || (await this.inner.entries(dir)).length) return;
      await this.moved(dir, this.holding(dir), into);
      dir = parentOf(dir);
    }
  }

  // ---------------------------------------------------------------- the folder

  readText(rel: string): Promise<string | null> { return this.inner.readText(rel); }
  readBytes(rel: string): Promise<Uint8Array | null> { return this.inner.readBytes(rel); }
  exists(rel: string): Promise<boolean> { return this.inner.exists(rel); }
  list(rel: string, extensions: readonly string[]): Promise<string[]> { return this.inner.list(rel, extensions); }
  entries(rel: string): Promise<{ name: string; folder: boolean }[]> { return this.inner.entries(rel); }
  /**
   * The lock is deleted. Any other file (one Chemweave made a moment ago and no longer needs) is
   * never deleted: it goes to the holding folder, so Undo puts it back.
   */
  async remove(rel: string): Promise<void> {
    this.changes++;
    const path = norm(rel);
    if (UNRECORDED.test(path)) { await this.inner.remove(rel); return; }
    while (this.busy) await this.busy;
    await this.tracked(async () => { if (await this.inner.exists(path)) await this.moved(path, this.holding(path)); });
  }

  private async wrote(rel: string, bytes: Uint8Array, write: () => Promise<void>): Promise<void> {
    const path = norm(rel);
    this.changes++;
    const counted = async (): Promise<void> => { try { await write(); } finally { this.changes++; } };
    if (UNRECORDED.test(path)) { await counted(); return; }
    while (this.busy) await this.busy;
    // (Undo and Redo wait for it, from reading what the file held to writing it down)
    await this.tracked(() => this.wroteNow(path, bytes, counted));
  }

  /** Writes, moves and removals being made now: Undo and Redo wait for them, so none is written down in the wrong step. */
  private readonly writing = new Set<Promise<void>>();

  private async tracked(run: () => Promise<void>): Promise<void> {
    const job = run();
    this.writing.add(job);
    try {
      await job;
    } finally {
      this.writing.delete(job);
    }
  }

  private async wroteNow(path: string, bytes: Uint8Array, write: () => Promise<void>): Promise<void> {
    // (read every time: the step may end while the file is being written, and the next step then needs what the file held)
    const before = await this.inner.readBytes(path).catch(() => null);
    await write();
    const touches = (c: Change): boolean => (c.kind === 'write' ? c.path === path : under(path, c.from) || under(path, c.to));
    const last = this.open ? [...this.open.changes].reverse().find(touches) : undefined;
    // (the step's earlier write of this file keeps what the file held before the step)
    if (last?.kind === 'write') { last.after = fingerprint(bytes); this.record(); return; }
    // (a file saved as it was is no change: a text box saved on leaving it, say)
    if (before && sameBytes(before, bytes)) return;
    this.record().changes.push({ kind: 'write', path, before, after: fingerprint(bytes) });
  }

  writeText(rel: string, text: string): Promise<void> {
    return this.wrote(rel, new TextEncoder().encode(text), () => this.inner.writeText(rel, text));
  }
  writeBytes(rel: string, bytes: Uint8Array): Promise<void> {
    return this.wrote(rel, bytes, () => this.inner.writeBytes(rel, bytes));
  }

  async move(from: string, to: string): Promise<void> {
    while (this.busy) await this.busy;
    await this.tracked(() => this.moved(norm(from), norm(to)));
  }

  /** Emptying the Trash (or deleting one item from it) moves it to the holding folder, so it can be undone until the project closes. */
  async removeTrash(rel: string): Promise<void> {
    this.changes++;
    const path = norm(rel);
    if (UNRECORDED.test(path)) { await this.inner.removeTrash(rel); return; }
    if (!isTrashPath(path)) throw new Error(`Only the project's Trash can be emptied this way (not ${rel}).`);
    while (this.busy) await this.busy;
    await this.tracked(async () => { if (await this.inner.exists(path)) await this.moved(path, this.holding(path)); });
  }
}

/** The history of an SI project's folder, when it keeps one. */
export function journalOf(folder: SiFolder): JournalFolder | null {
  return folder instanceof JournalFolder ? folder : null;
}
