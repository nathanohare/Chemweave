// Standing rule R7: every registered command is undone in one step. The undo audit
// (scripts/undo-audit.mjs, in a real browser) runs each command and checks Undo and Redo; this test
// checks, on every pull request and without a browser, that the audit can't miss a command: every
// command registered anywhere is run by it or left out in scripts/undo-audit-lists.mjs with its
// reason, the lists there are not stale, and the problems it already knows are named by command.
import { describe, expect, it } from 'vitest';
// @ts-expect-error (a plain JavaScript module of the scripts)
import { NOT_UNDOABLE, KNOWN_UNDO_PROBLEMS, UNREAD_ENTRIES, RECORDS, registeredCommands, commandsFor, notUndoable, recordKeys } from '../scripts/undo-audit-lists.mjs';

type Entry = { match: RegExp; why: string };
const registered: { id: string; where: string }[] = registeredCommands();
const ids = new Set(registered.map((c) => c.id));
const swept = new Set(['drawing', 'sheet', 'document'].flatMap((m) => commandsFor(m) as string[]));

describe('undo audit covers every command (R7)', () => {
  it('finds the commands (the places it reads them from are still there)', () => {
    expect(registered.length).toBeGreaterThan(500);
  });

  it('runs every registered command, or leaves it out with a reason', () => {
    const missed = registered.filter((c) => !swept.has(c.id) && !notUndoable(c.id)).map((c) => `${c.id} (${c.where})`);
    expect(missed, 'commands the undo audit would not run: add them to its sweep, or to NOT_UNDOABLE in scripts/undo-audit-lists.mjs with the reason').toEqual([]);
  });

  it('gives every left-out group a reason, and every group still matches a command', () => {
    for (const e of NOT_UNDOABLE as Entry[]) expect(e.why.length, String(e.match)).toBeGreaterThan(15);
    const stale = (NOT_UNDOABLE as Entry[]).filter((e) => ![...ids].some((id) => e.match.test(id))).map((e) => String(e.match));
    expect(stale, 'NOT_UNDOABLE entries that match no command any more: take them off').toEqual([]);
  });

  it('leaves out no command that obviously edits the file', () => {
    // names that say they change the file: never in NOT_UNDOABLE (a prefix such as /^new/ once hid
    // New Slide, New Comment and Send Backward from the audit)
    const edits = [...ids].filter((id) => /^(new-slide$|new-slide-|new-canvas-slide|new-comment|new-note|new-rule|send-back|split-hapto|split-steps|newman|insert-|add-|delete-|remove-|set-|clear-)/.test(id));
    expect(edits.filter((id) => notUndoable(id) && !/^(insert-picture|insert-object)$/.test(id))).toEqual([]);
  });

  it('can read every entry of the command records, or knows why not', () => {
    const unread = Object.values(RECORDS as Record<string, { file: string; name: string }>).flatMap((r) => recordKeys(r.file, r.name).unresolved as string[]);
    const unknown = unread.filter((t) => !(UNREAD_ENTRIES as { text: string }[]).some((u) => t.startsWith(u.text)));
    expect(unknown, 'entries of a command record whose names the audit cannot read: write them out, or add them to UNREAD_ENTRIES in scripts/undo-audit-lists.mjs with the reason').toEqual([]);
  });

  it('names a real command in every known problem', () => {
    const bad = (KNOWN_UNDO_PROBLEMS as string[]).filter((p) => {
      const cmd = /^[^:]+: ([a-zA-Z0-9:._-]+)/.exec(p)?.[1]?.replace(/:$/, '');
      return !cmd || !ids.has(cmd);
    });
    expect(bad, 'KNOWN_UNDO_PROBLEMS lines whose command is gone or renamed').toEqual([]);
  });
});
