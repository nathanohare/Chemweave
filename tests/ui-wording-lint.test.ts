// UI wording lint (retrospective audit G5-21..23): the words wording audit 2 (2026-11-16) and the
// style guide (S26, S29, S70) replaced must not come back in UI text. It reads every string in
// src (TypeScript string literals and templates, found with the TypeScript parser, so code
// names such as `picked` or `ticked` are not counted) and the text and tooltips of index.html.
// src/io is read too: its warnings are shown when a file opens (review of F5, R06).
// Ruler "ticks" (the Guides toolbox) and other programs ("the program that made it") are fine;
// those few are listed below. Command search keeps the old words on purpose (FORMER_NAMES).
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

const ROOT = join(__dirname, '..');

interface Str { file: string; line: number; text: string }

function walk(dir: string, out: string[]): void {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) { if (!/vendor/.test(p)) walk(p, out); } else if (/\.ts$/.test(n) && !/\.d\.ts$/.test(n)) out.push(p);
  }
}

function strings(): Str[] {
  const files: string[] = [];
  walk(join(ROOT, 'src'), files);
  const out: Str[] = [];
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    const src = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true);
    const visit = (n: ts.Node): void => {
      let t: string | null = null;
      if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) t = n.text;
      else if (ts.isTemplateExpression(n)) t = n.head.text + n.templateSpans.map((s) => '${…}' + s.literal.text).join('');
      // UI text has words with spaces between them; imports and lone keys do not
      if (t !== null && /[A-Za-z]{2,}\s+[A-Za-z]/.test(t) && !ts.isImportDeclaration(n.parent)) {
        out.push({ file: relative(ROOT, f), line: src.getLineAndCharacterOfPosition(n.getStart()).line + 1, text: t });
      }
      ts.forEachChild(n, visit);
    };
    visit(src);
  }
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8').split('\n');
  html.forEach((ln, i) => {
    for (const m of ln.matchAll(/>([^<>]*[A-Za-z]{2,}\s+[A-Za-z][^<>]*)</g)) out.push({ file: 'index.html', line: i + 1, text: m[1] });
    for (const m of ln.matchAll(/(?:title|data-info|aria-label|placeholder)="([^"]+)"/g)) out.push({ file: 'index.html', line: i + 1, text: m[1] });
  });
  return out;
}

/** The banned word or phrase, and what to write instead. */
const BANNED: [RegExp, string][] = [
  [/\bpicked\b/i, 'selected / chosen (S26)'],
  [/\b(worked|works|working) out\b|\bwork out\b/i, 'calculate (S26, S70)'],
  [/\bby itself\b/i, 'automatically (S26)'],
  [/\buntick|\bticked\b|\btick (it|a|the|what)\b|\bTick\b/, 'check / uncheck (S26)'],
  [/\b[Tt]he program (makes|prints|does|keeps)|\bby the program\b/, 'Chemweave (S70)'],
  [/\b(labelled|recognised|analysed|centred|towards)\b/i, 'American spelling (S29)'],
  [/\bfor good\b/i, 'permanently'],
  [/\bmy own\b|\(your own ±\)/i, 'custom (S70)'],
  [/\b(?:the|its|their) plain look\b|\bnumber format and look\b|\band look of\b/i, 'style or formatting, not look (S70)'],
  [/\bturned (with|to read|to match)\b|\bEach is turned\b|\bNothing to turn\b/, 'rotate, not turn (S26)'],
  [/\bpick from Insert\b/i, 'choose (S26; Pick From Drop-down List is Excel\'s own name)'],
];

/** Strings that may keep a word: other programs, ruler ticks, typed syntax and search aliases. */
const ALLOWED: [string, RegExp][] = [
  ['src/ui/command-search.ts', /./], // former names, so old words still find commands
  ['src/text/symbol-table.ts', /tick/], // the ✓ symbol's search words
  ['src/sheet/fn-help.ts', /./], // Excel's own function help
  ['src/design/', /./], // template text a person replaces
  ['src/document/templates.ts', /./],
];

describe('UI wording lint', () => {
  const all = strings();
  it.each(BANNED.map(([re, why]) => [String(re), re, why] as const))('no UI text uses %s', (_name, re, why) => {
    const hits = all.filter((s) => re.test(s.text) && !ALLOWED.some(([f, ok]) => s.file.startsWith(f) && ok.test(s.text)))
      .map((s) => `${s.file}:${s.line} ${s.text.replace(/\s+/g, ' ').slice(0, 120)} → ${why}`);
    expect(hits).toEqual([]);
  });
});
