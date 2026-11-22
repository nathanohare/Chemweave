// @vitest-environment jsdom
// Undo audit, Document mode (review round 2, finding 8): every command of the ribbon that changes
// the document is undone by one Ctrl+Z, which leaves it exactly as it was, and redone by one
// Ctrl+Y. The sweep runs each command (from DocumentMode.run's list) on a document holding text,
// a list, a picture in line, a floating picture, a structure, a text box and a table, with text
// picked, then with the picture picked; a few known cases are checked on their own below.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { docMode } from './doc-mode-harness';
import { objectRun, type DocText } from '../src/document/document';
import type { DocumentMode } from '../src/ui/doc-mode';
import type { DocFile } from '../src/document/doc-file';
import * as rt from '../src/richtext';

const PIC = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const ETHANE = {
  atoms: [{ id: 1, x: 0, y: 0, element: 'C' }, { id: 2, x: 20, y: 0, element: 'C' }],
  bonds: [{ id: 3, a1: 1, a2: 2, order: 1 }], captions: [], arrows: [], shapes: [],
};

/** The commands DocumentMode.run knows by name (its `case` labels). */
function commands(): string[] {
  const src = readFileSync(join(__dirname, '../src/ui/doc-mode.ts'), 'utf8');
  const body = src.slice(src.indexOf('  run(cmd: string): boolean {'), src.indexOf('  /** The pinned settings boxes were read'));
  return [...new Set([...body.matchAll(/case '([^']+)'/g)].map((m) => m[1]))];
}
/** Commands that open another window, file picker or program (comparing needs the other open documents). */
const SKIP = /^(undo|redo|print|save|export|open|insert-picture|insert-object|hf-picture|paste|paste-\w+|copy|cut|compare-docs|combine-docs)$/;

beforeAll(() => {
  const el = Element.prototype as unknown as Record<string, unknown>;
  el.setPointerCapture ??= () => undefined;
  el.releasePointerCapture ??= () => undefined;
  const dlg = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  dlg.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
  dlg.show ??= function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
  dlg.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open'); this.dispatchEvent(new Event('close')); };
});

const sample = (): Partial<DocText> => ({
  runs: [
    { text: 'Synthesis of the ketone\nThe ' }, { text: 'ketone', bold: true }, { text: ' was made as shown ' }, objectRun(1, {}),
    { text: ' and purified.\nFirst item\nSecond item\n' }, objectRun(2, {}), { text: ' Floating picture beside this text. ' }, objectRun(3, {}),
    { text: '\n' }, objectRun(4, {}), { text: ' A text box.\n' }, objectRun(5, {}), { text: '\nThe end.' },
  ] as never,
  paras: [{ style: 'Heading1' }, {}, { list: 'bullet' }, { list: 'bullet' }, {}, {}, {}, {}] as never,
  objects: {
    1: { kind: 'picture', src: PIC, w: 60, h: 40 },
    2: { kind: 'picture', src: PIC, w: 120, h: 80, float: { wrap: 'square', x: 300, y: 0 } },
    3: { kind: 'drawing', contents: ETHANE },
    4: { kind: 'textbox', runs: [{ text: 'Boxed' }], w: 100, float: { wrap: 'square', x: 20, y: 0 } },
    5: { kind: 'table', table: { cols: [100, 100], rows: [[{ runs: [{ text: 'Entry' }] }, { runs: [{ text: 'Yield' }] }], [{ runs: [{ text: '1' }] }, { runs: [{ text: '85%' }] }]], head: 1 } },
  } as never,
});

const state = (f: DocFile) => JSON.stringify(f.t);
const steps = (f: DocFile) => (f.ed as unknown as { undoStack: unknown[] }).undoStack.length;
const offsetOf = (f: DocFile, id: number) => { let at = 0; for (const r of f.t.runs) { if (r.obj === id) return at; at += r.text.length; } return -1; };

async function fresh(): Promise<{ dm: DocumentMode; f: DocFile }> {
  const { dm, f } = await docMode(sample());
  return { dm, f };
}

function closeWindows(): void {
  for (const d of document.querySelectorAll('dialog[open]')) (d as HTMLDialogElement).close();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
}

describe('Document: every command that changes the document is one undo step', () => {
  for (const [picked, select] of [
    ['text picked', (f: DocFile) => f.ed.select(30, 70)],
    ['a picture picked', (f: DocFile) => { const at = offsetOf(f, 1); f.ed.select(at, at + 1); }],
  ] as const) {
    it(`with ${picked}`, async () => {
      const problems: string[] = [];
      let changed = 0;
      for (const cmd of commands().filter((c) => !SKIP.test(c))) {
        const { dm, f } = await fresh();
        select(f);
        const before = state(f), n0 = steps(f);
        try { dm.run(cmd); } catch { /* a command that needs the app around it: nothing to check */ }
        closeWindows();
        const after = state(f), made = steps(f) - n0;
        if (after === before && made === 0) continue;
        changed++;
        if (after !== before && made === 0) { problems.push(`${cmd}: changed the document without an undo step`); continue; }
        if (after === before) { problems.push(`${cmd}: made an undo step that changes nothing`); continue; }
        if (made > 1) problems.push(`${cmd}: made ${made} undo steps (one is expected)`);
        dm.run('undo');
        if (state(f) !== before) { problems.push(`${cmd}: one undo did not put the document back`); continue; }
        dm.run('redo');
        if (state(f) !== after) problems.push(`${cmd}: redo did not bring the change back`);
      }
      expect(problems).toEqual([]);
      // the sweep really ran commands that change things
      expect(changed).toBeGreaterThan(20);
    }, 600000);
  }
});

describe('Document: commands that were not one undo step', () => {
  for (const [cmd, kind] of [['insert-text-box', 'textbox'], ['insert-footnote', 'note'], ['insert-endnote', 'note']] as const) {
    it(`${cmd}: Ctrl+Z straight away takes it out (typing in it is undone first)`, async () => {
      const { dm, f } = await fresh();
      f.ed.setCaret(30);
      const before = state(f);
      dm.run(cmd);
      expect(Object.values(f.t.objects).filter((o) => o.kind === kind).length).toBe(kind === 'textbox' ? 2 : 1);
      dm.run('undo');
      expect(state(f)).toBe(before);
      dm.run('redo');
      expect(Object.values(f.t.objects).filter((o) => o.kind === kind).length).toBe(kind === 'textbox' ? 2 : 1);
    }, 60000);
  }

  for (const cmd of ['page-break', 'col-break', 'blank-page']) {
    it(`${cmd}: one Ctrl+Z`, async () => {
      const { dm, f } = await fresh();
      f.ed.setCaret(30);
      const before = state(f);
      dm.run(cmd);
      expect(state(f)).not.toBe(before);
      dm.run('undo');
      expect(state(f)).toBe(before);
    }, 60000);
  }

  it('a command that changes nothing makes no undo step', async () => {
    const { dm, f } = await fresh();
    f.ed.setCaret(30);
    dm.run('doc-align-left');
    dm.run('doc-outdent');
    expect(steps(f)).toBe(0);
    expect(dm.canUndo()).toBe(false);
  }, 60000);

  it('a change made after a command that changed nothing still has its own step', async () => {
    const { f } = await fresh();
    const before = state(f);
    // (as a drag's first move does: a step named, nothing changed yet, then the change)
    f.ed.update({ ...f.t, paras: f.t.paras.map((p) => ({ ...p })) }, 'Resize');
    f.ed.update({ ...f.t, objects: { ...f.t.objects, 1: { ...f.t.objects[1], w: 90 } as never } }, null);
    expect(steps(f)).toBe(1);
    f.ed.undo();
    expect(state(f)).toBe(before);
    expect(rt.plainText(f.t.runs).length).toBeGreaterThan(0);
  }, 60000);
});
