// Standing rule R7: every registered command is undone in one step. The undo audit
// (scripts/undo-audit.mjs, in a real browser) runs each command and checks Undo and Redo: in full
// by hand (`npm run undo-audit`, about 25 minutes), and as a quick sweep of one slice of the
// commands on every pull request (`npm run undo-audit -- ci` in the build job, about two minutes,
// which first checks that it catches a planted two-step command and a planted missing undo).
// This test checks, without a browser, that the audit's lists are honest: commands are left out
// only by name and with a reason, nothing that edits is left out, the slices cover every command,
// CI runs the quick sweep, and the problems it already knows are named by command.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// @ts-expect-error (a plain JavaScript module of the scripts)
import { NOT_UNDOABLE, KNOWN_UNDO_PROBLEMS, UNREAD_ENTRIES, RECORDS, CI_SLICES, registeredCommands, commandsFor, notUndoable, recordKeys, sliceOf } from '../scripts/undo-audit-lists.mjs';

type Entry = { names: string[]; why: string };
const registered: { id: string; where: string }[] = registeredCommands();
const ids = new Set(registered.map((c) => c.id));
const left = (NOT_UNDOABLE as Entry[]).flatMap((e) => e.names);

describe('undo audit covers every command (R7)', () => {
  it('finds the commands (the places it reads them from are still there)', () => {
    expect(registered.length).toBeGreaterThan(500);
  });

  it('leaves commands out only by their exact names, each a registered command, with a reason', () => {
    for (const e of NOT_UNDOABLE as Entry[]) {
      expect(e.why.length, e.names.join(' ')).toBeGreaterThan(15);
      for (const n of e.names) expect(n, 'a name, not a pattern').toMatch(/^[a-z0-9][a-z0-9:._-]*$/);
    }
    expect(left.filter((n) => !ids.has(n)), 'NOT_UNDOABLE names that are no longer commands: take them off').toEqual([]);
    expect(left.length, 'a name is listed twice').toBe(new Set(left).size);
  });

  it('leaves out no command that edits the file, and runs every View and Show command', () => {
    // names that say they change the file: never in NOT_UNDOABLE (a prefix such as /^new/ once hid
    // New Slide, New Comment and Send Backward from the audit; view-* once hid Gridlines and Headings)
    const edits = [...ids].filter((id) => /^(new-slide$|new-slide-|new-canvas-slide|new-comment|new-note|new-rule|send-back|split-hapto|split-steps|newman|insert-|add-|delete-|remove-|set-|clear-|view-|show-)/.test(id));
    expect(edits.filter((id) => notUndoable(id) && !/^(insert-picture|insert-object)$/.test(id))).toEqual([]);
  });

  it('runs every command in some slice of the quick sweep, and the slices are even', () => {
    const swept = new Set(['drawing', 'sheet', 'document'].flatMap((m) => commandsFor(m) as string[]));
    expect([...ids].filter((id) => !swept.has(id) && !notUndoable(id))).toEqual([]);
    const sizes = Array.from({ length: CI_SLICES }, () => 0);
    for (const c of swept) sizes[sliceOf(c)]++;
    const mean = swept.size / CI_SLICES;
    // an even split keeps each pull request's sweep near two minutes
    expect(Math.max(...sizes), `slice sizes ${sizes.join(' ')}`).toBeLessThan(mean * 1.5);
    expect(Math.min(...sizes)).toBeGreaterThan(0);
  }, 60_000); // (reads main.ts three times: slow on a busy machine)

  it('is run on every pull request', () => {
    const ci = readFileSync(join(__dirname, '..', '.github/workflows/ci.yml'), 'utf8');
    expect(ci).toMatch(/npm run undo-audit -- ci\b/);
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
