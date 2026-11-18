// Undo and Redo in the SI Project tab. Chemweave keeps its own history of an SI project (Nate's
// choice: SI Assistant's build/undo journal is not shared; the Trash is). The project's folder is
// wrapped so every change a command makes to its files is recorded, and one command is one step:
//   a file written:  what it held before (or that it wasn't there)
//   a file or folder moved (to the Trash, or between sections)
// Undo puts each back, newest first, and what it does is recorded in turn, so Redo is the same
// thing the other way. A file that a step made is not deleted by Undo: it is moved into
// build/chemweave-undo/ (build/ is never part of the project: SI Assistant makes it again and
// snapshots leave it out), where Redo finds it; that folder is emptied when the project closes.
// Items emptied from the Trash wait there too, so Empty Trash can be undone until then.
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
/** Files no step records: the lock, the build output (and the undo holding folder in it), snapshots. */
const UNRECORDED = /^(\.lock$|build(\/|$)|snapshots(\/|$))/;

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
  private replaying = false;
  /** Called when what Undo and Redo would do changes (for the Edit menu). */
  onChange: (() => void) | null = null;

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

  /** `f` as one step. */
  async step<T>(label: string, f: () => Promise<T>): Promise<T> {
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
    if (this.undos.length > MAX_STEPS) this.undos.shift();
    this.redos = [];
    this.onChange?.();
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
    this.settle();
    this.undos = [];
    this.redos = [];
    this.onChange?.();
    if (await this.inner.exists(UNDO_HOLDING).catch(() => false)) await this.inner.removeTrash(UNDO_HOLDING);
  }

  /** Take back the last step; its name, or null with nothing to undo. */
  undo(): Promise<string | null> { return this.go(false); }
  redo(): Promise<string | null> { return this.go(true); }

  private async go(redo: boolean): Promise<string | null> {
    if (this.depth > 0 || this.replaying) throw new UndoError('Wait for the change being saved to finish, then try again.');
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
    from.pop();
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

  /** Put the step's changes back, newest first; what that does is recorded as the step that reverses it. */
  private async replay(step: UndoStep): Promise<UndoStep> {
    const back: UndoStep = { label: step.label, changes: [] };
    this.open = back;
    this.replaying = true;
    try {
      for (const c of [...step.changes].reverse()) {
        if (c.kind === 'move') {
          if (await this.inner.exists(c.to)) await this.move(c.to, c.from);
          // (a Trash entry the move made, empty now, goes too)
          if (c.to.startsWith('trash/')) await this.prune(parentOf(c.to));
        } else if (c.before) await this.writeBytes(c.path, c.before);
        else await this.takeAway(c.path);
      }
    } catch (e) {
      // (what was put back is reversed again, so the step is still whole)
      this.open = { label: step.label, changes: [] };
      for (const c of [...back.changes].reverse()) {
        try {
          if (c.kind === 'move') await this.inner.move(c.to, c.from);
          else if (c.before) await this.inner.writeBytes(c.path, c.before);
        } catch { /* best effort */ }
      }
      throw e;
    } finally {
      this.open = null;
      this.replaying = false;
    }
    return back;
  }

  /** A file the step made goes to the holding folder (and folders it leaves empty follow it). */
  private async takeAway(path: string): Promise<void> {
    if (!(await this.inner.exists(path))) return;
    await this.move(path, `${UNDO_HOLDING}/${Date.now().toString(36)}-${++held}/${path}`);
    await this.prune(parentOf(path));
  }

  /** Folders left empty (below the project's top folders) go to the holding folder too. */
  private async prune(dir: string): Promise<void> {
    while (dir.includes('/') && !UNRECORDED.test(dir)) {
      if (!(await this.inner.exists(dir)) || (await this.inner.entries(dir)).length) return;
      await this.move(dir, `${UNDO_HOLDING}/${Date.now().toString(36)}-${++held}/${dir}`);
      dir = parentOf(dir);
    }
  }

  // ---------------------------------------------------------------- the folder

  readText(rel: string): Promise<string | null> { return this.inner.readText(rel); }
  readBytes(rel: string): Promise<Uint8Array | null> { return this.inner.readBytes(rel); }
  exists(rel: string): Promise<boolean> { return this.inner.exists(rel); }
  list(rel: string, extensions: readonly string[]): Promise<string[]> { return this.inner.list(rel, extensions); }
  entries(rel: string): Promise<{ name: string; folder: boolean }[]> { return this.inner.entries(rel); }
  remove(rel: string): Promise<void> { return this.inner.remove(rel); }

  private async wrote(rel: string, bytes: Uint8Array, write: () => Promise<void>): Promise<void> {
    const path = norm(rel);
    if (UNRECORDED.test(path)) { await write(); return; }
    const touches = (c: Change): boolean => (c.kind === 'write' ? c.path === path : under(path, c.from) || under(path, c.to));
    const last = this.open ? [...this.open.changes].reverse().find(touches) : undefined;
    const before = last?.kind === 'write' ? null : await this.inner.readBytes(path).catch(() => null);
    await write();
    // (a file saved as it was is no change: a text box saved on leaving it, say)
    if (last?.kind !== 'write' && before && sameBytes(before, bytes)) return;
    const step = this.record();
    if (last?.kind === 'write' && step.changes.includes(last)) last.after = fingerprint(bytes);
    else step.changes.push({ kind: 'write', path, before, after: fingerprint(bytes) });
  }

  writeText(rel: string, text: string): Promise<void> {
    return this.wrote(rel, new TextEncoder().encode(text), () => this.inner.writeText(rel, text));
  }
  writeBytes(rel: string, bytes: Uint8Array): Promise<void> {
    return this.wrote(rel, bytes, () => this.inner.writeBytes(rel, bytes));
  }

  async move(from: string, to: string): Promise<void> {
    const f = norm(from), t = norm(to);
    await this.inner.move(f, t);
    if (!(UNRECORDED.test(f) && UNRECORDED.test(t))) this.record().changes.push({ kind: 'move', from: f, to: t });
  }

  /** Emptying the Trash (or deleting one item from it) moves it to the holding folder, so it can be undone until the project closes. */
  async removeTrash(rel: string): Promise<void> {
    const path = norm(rel);
    if (UNRECORDED.test(path)) { await this.inner.removeTrash(rel); return; }
    if (!isTrashPath(path)) throw new Error(`Only the project's Trash can be emptied this way (not ${rel}).`);
    if (!(await this.inner.exists(path))) return;
    await this.move(path, `${UNDO_HOLDING}/${Date.now().toString(36)}-${++held}/${path}`);
  }
}

/** The history of an SI project's folder, when it keeps one. */
export function journalOf(folder: SiFolder): JournalFolder | null {
  return folder instanceof JournalFolder ? folder : null;
}
