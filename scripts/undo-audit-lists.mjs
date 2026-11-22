// What the undo audit (scripts/undo-audit.mjs, standing rule R7) runs, leaves out and already knows
// about. Kept apart from the audit so tests/undo-every-command.test.ts can check, on every pull
// request and without a browser, that every registered command is either run by the audit or left
// out here with its reason, and that nothing here has gone stale.
//
// Never weaken the check to make it pass: a command that changes the file without an undo step is
// a bug to fix (or, until then, a line in KNOWN_UNDO_PROBLEMS with its gap id), not a line in
// NOT_UNDOABLE.
import fs from 'node:fs';
import ts from 'typescript';

/**
 * Commands the audit leaves out, each with its reason. Only commands that do not change the open
 * file belong here: ones that work with other files or programs, open a window that changes
 * nothing until its OK (that window's own edits are checked by its own tests), or change only what
 * is shown. Prefer an exact name (`$`) to a prefix, so a new command that edits is not hidden.
 */
export const NOT_UNDOABLE = [
  { match: /^(new|new-slides|new-design|new-sheet|new-document|new-from-template|new-si-project|open|open-si-project|open-workspace|close-tab|next-tab|prev-tab|tab-.*|window-.*|recent.*)$/, why: 'makes, opens or switches tabs: the file in the tab is not changed' },
  { match: /^(save|save-as|save-template|save-workspace|save-workspace-as|revert|reload)$/, why: 'writes or reads the file on disk, not its contents' },
  { match: /^(export-.*|print|print-preview|sheet-print.*|batch-convert|find-in-files|send|share|email)$/, why: 'writes another file or hands the file to another program' },
  { match: /^(import-settings|export-settings|preferences|settings|save-format-favorite|save-highlight-look|hotkeys|keyboard.*)$/, why: 'changes the program’s settings, not the file' },
  { match: /^(insert-picture|insert-object|hf-picture|import-picture|import-pdf|import-paste|compare-docs|combine-docs|open-object|open-link|open-inspector|open-log-folder)$/, why: 'asks for a file or opens another program first; what it then inserts is checked by the insert tests' },
  { match: /^(present|present-current|presenter-view|slide-show.*|start-show.*|play.*|rehearse.*|record-show.*)$/, why: 'runs the slide show; the deck is not changed (timings it records are checked by tests/slide-show*.test.ts)' },
  { match: /^(help.*|about|feedback|send-feedback|support.*|sponsor|update|check-updates|tour|guide)$/, why: 'help and the program’s own windows' },
  { match: /^(dev-tools|diagnostics|stress-\d+)$/, why: 'developer tools: Stress Test replaces the drawing on purpose, to time it' },
  { match: /^(undo|redo)$/, why: 'the audit uses these itself' },
  { match: /^(zoom.*|fullscreen|split-view|split-window|view-.*|show-.*|close-master-view|ui-scale-.*)$/, why: 'changes only what is shown (zoom, panes, view, marks), never the file' },
];

/** The reason a command is left out, or undefined when the audit runs it. */
export function notUndoable(cmd) {
  return NOT_UNDOABLE.find((e) => e.match.test(cmd))?.why;
}

/**
 * Undo problems the audit has already found and that are not fixed yet: the exact line it prints.
 * The audit fails only on a problem not listed here, and says which of these no longer happen so
 * they can be taken off. Each is a known gap (see fix-F6 in the November 2026 audit).
 */
export const KNOWN_UNDO_PROBLEMS = [
  // Add Caption puts the text in, then a second step lays it out
  'Canvas: add-caption took 2 undos (one is expected)',
  'Presentation: add-caption took 2 undos (one is expected)',
  'Design: add-caption took 2 undos (one is expected)',
  // Add ID Label: the label, then the number filled in when the chemistry engine answers
  'Presentation: add-id-label took 2 undos (one is expected)',
  // the layout and master editors change the deck's master directly (G7, Edit Layouts)
  'Presentation: edit-layouts changed the file without an undo step',
  'Presentation: edit-layout changed the file without an undo step',
  'Presentation: slide-master changed the file without an undo step',
  // Document: Header/Footer editing (Insert ▸ Header, Edit Header, Go to Header/Footer) puts an empty
  // header or footer in, and Undo leaves it (with the header still being edited): check by hand
  'Document, floating picture picked: footer-edit: Undo did not put the file back',
  'Document, floating picture picked: header-edit: Undo did not put the file back',
  'Document, floating picture picked: hf-goto-footer: Undo did not put the file back',
  'Document, floating picture picked: hf-goto-header: Undo did not put the file back',
  'Document, floating picture picked: hf-goto: Undo did not put the file back',
  'Document, picture in line picked: footer-edit: Undo did not put the file back',
  'Document, picture in line picked: header-edit: Undo did not put the file back',
  'Document, picture in line picked: hf-goto-footer: Undo did not put the file back',
  'Document, picture in line picked: hf-goto-header: Undo did not put the file back',
  'Document, picture in line picked: hf-goto: Undo did not put the file back',
  'Document, text picked: footer-edit: Undo did not put the file back',
  'Document, text picked: header-edit: Undo did not put the file back',
  'Document, text picked: hf-goto-footer: Undo did not put the file back',
  'Document, text picked: hf-goto-header: Undo did not put the file back',
  'Document, text picked: hf-goto: Undo did not put the file back',
  // Document: a section break (Insert ▸ Break ▸ Section Break) is two undo steps (found once the
  // audit ran Insert menu commands too)
  'Document, floating picture picked: breaks-continuous took 2 undos (one is expected)',
  'Document, floating picture picked: breaks-nextPage took 2 undos (one is expected)',
  'Document, picture in line picked: breaks-continuous took 2 undos (one is expected)',
  'Document, picture in line picked: breaks-nextPage took 2 undos (one is expected)',
  'Document, text picked: breaks-continuous took 2 undos (one is expected)',
  'Document, text picked: breaks-nextPage took 2 undos (one is expected)',
];

/** Where each kind of tab's commands are registered (main.ts records, the modes' own run()). */
const RECORDS = {
  drawing: { file: 'src/main.ts', name: 'COMMANDS' },
  sheet: { file: 'src/main.ts', name: 'SHEET_COMMANDS' },
  document: { file: 'src/main.ts', name: 'DOC_COMMANDS' },
};
const RUN_METHODS = {
  sheet: { file: 'src/ui/sheet-mode.ts', from: '  run(name: string): boolean {' },
  document: { file: 'src/ui/doc-mode.ts', from: '  run(cmd: string): boolean {', to: '  /** The pinned settings boxes were read' },
};

/**
 * The keys of a `const NAME: Record<…> = { … }` in a source file, with `...Object.fromEntries([
 * 'a', 'b' ].map(…))` read too. `unresolved` lists the entries whose names can't be read without
 * running the code (such as names made from a list of numbers), as their source text.
 */
export function recordKeys(file, name, root = '.') {
  const src = fs.readFileSync(`${root}/${file}`, 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
  const keys = [], unresolved = [];
  let found = false;
  const visit = (n) => {
    if (ts.isVariableDeclaration(n) && n.name.getText(sf) === name && n.initializer && ts.isObjectLiteralExpression(n.initializer)) {
      found = true;
      for (const p of n.initializer.properties) {
        if (ts.isSpreadAssignment(p)) {
          const e = p.expression;
          const arr = ts.isCallExpression(e) && e.expression.getText(sf) === 'Object.fromEntries' && e.arguments[0] && ts.isCallExpression(e.arguments[0])
            && ts.isPropertyAccessExpression(e.arguments[0].expression) && ts.isArrayLiteralExpression(e.arguments[0].expression.expression) ? e.arguments[0].expression.expression : null;
          if (arr && arr.elements.every((x) => ts.isStringLiteral(x))) keys.push(...arr.elements.map((x) => x.text));
          else unresolved.push(p.getText(sf).replace(/\s+/g, ' ').slice(0, 120));
        } else if (p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) keys.push(p.name.text);
        else unresolved.push(p.getText(sf).replace(/\s+/g, ' ').slice(0, 120));
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  if (!found) throw new Error(`${file}: no ${name} record found (the undo audit reads its commands from it)`);
  return { keys, unresolved };
}

/** The `case '…'` labels of a method (the commands it knows by name). */
export function casesOf(file, from, to, root = '.') {
  const src = fs.readFileSync(`${root}/${file}`, 'utf8');
  const a = src.indexOf(from);
  if (a < 0) throw new Error(`${file}: "${from.trim()}" not found (the undo audit reads its commands from it)`);
  const body = src.slice(a, to ? src.indexOf(to, a) : src.indexOf('\n  }\n', a));
  return [...body.matchAll(/case '([^']+)'/g)].map((m) => m[1]);
}

/**
 * Every command registered anywhere: the menus, ribbons and buttons of index.html (data-cmd,
 * data-doc, data-sh), the command list in src/commands/registry.ts, main.ts's records and the
 * Spreadsheet and Document modes' run(). { id, where }[], one per id (the first place found).
 */
export function registeredCommands(root = '.') {
  const out = new Map();
  const add = (id, where) => { if (!out.has(id) && !id.includes('${')) out.set(id, where); };
  const html = fs.readFileSync(`${root}/index.html`, 'utf8');
  for (const [attr, where] of [['data-cmd', 'index.html data-cmd'], ['data-doc', 'index.html data-doc'], ['data-sh', 'index.html data-sh']])
    for (const m of html.matchAll(new RegExp(`${attr}="([^"]+)"`, 'g'))) add(m[1], where);
  for (const m of fs.readFileSync(`${root}/src/commands/registry.ts`, 'utf8').matchAll(/\{ id: '([^']+)'/g)) add(m[1], 'src/commands/registry.ts');
  for (const [mode, r] of Object.entries(RECORDS)) for (const k of recordKeys(r.file, r.name, root).keys) add(k, `${r.file} ${r.name}`);
  for (const [, r] of Object.entries(RUN_METHODS)) for (const k of casesOf(r.file, r.from, r.to, root)) add(k, `${r.file} run()`);
  return [...out].map(([id, where]) => ({ id, where }));
}

/**
 * The commands the audit runs in each kind of tab: that tab's own commands, and every registered
 * command (one that does nothing there changes nothing, so it costs only time). Left out: NOT_UNDOABLE.
 */
export function commandsFor(mode, root = '.') {
  const own = mode === 'sheet' ? [...recordKeys(RECORDS.sheet.file, RECORDS.sheet.name, root).keys, ...casesOf(RUN_METHODS.sheet.file, RUN_METHODS.sheet.from, undefined, root)]
    : mode === 'document' ? [...recordKeys(RECORDS.document.file, RECORDS.document.name, root).keys, ...casesOf(RUN_METHODS.document.file, RUN_METHODS.document.from, RUN_METHODS.document.to, root)]
      : recordKeys(RECORDS.drawing.file, RECORDS.drawing.name, root).keys;
  return [...new Set([...own, ...registeredCommands(root).map((c) => c.id)])].filter((c) => !notUndoable(c));
}

/**
 * Entries of main.ts's records whose names can't be read from the source, each with what they add
 * and why the audit can do without them. tests/undo-every-command.test.ts fails on one not here.
 */
export const UNREAD_ENTRIES = [
  { text: '...Object.fromEntries(UI_SCALES.map(', why: 'View ▸ Interface Size (ui-scale-80 … ui-scale-150): changes only what is shown' },
];

export { RECORDS };
