// The built app must be readable by the oldest engine it runs on (Safari 15.4: apps on macOS 12,
// older iPads and school computers). One script it can't read stops the app from starting. Run
// after a build (npm run build does): node scripts/check-old-webkit.mjs [folder]
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

/** What old WebKit can't read in a script: regex lookbehind, the v and d-less new flags, class static blocks. */
const inTry = (node) => {
  for (let n = node; n.parent; n = n.parent) if (ts.isTryStatement(n.parent) && n.parent.tryBlock === n) return true;
  return false;
};

export function problems(code, name = 'x.js') {
  const found = [];
  const file = ts.createSourceFile(name, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  // (a list of nodes still to see, not recursion: an unminified build joins thousands of strings)
  const todo = [file];
  while (todo.length) {
    const node = todo.pop();
    if (node.kind === ts.SyntaxKind.RegularExpressionLiteral) {
      const text = node.text, slash = text.lastIndexOf('/');
      // (an escaped bracket, or one inside a character class, is only text)
      const bare = text.slice(1, slash).replace(/\\.|\[(?:\\.|[^\]\\])*\]/g, '_');
      if (/\(\?<[=!]/.test(bare)) found.push(`regex lookbehind: ${text.slice(0, 80)}`);
      if (text.slice(slash + 1).includes('v')) found.push(`regex v flag: ${text.slice(0, 80)}`);
    }
    if (ts.isClassStaticBlockDeclaration(node)) found.push('class static block');
    // (esbuild turns a literal the target can't read into RegExp("…"), which fails when it runs.
    // One inside try is a library asking whether the engine can.)
    if ((ts.isNewExpression(node) || ts.isCallExpression(node)) && node.expression.getText(file) === 'RegExp') {
      const [source, flags] = node.arguments ?? [];
      if (source && ts.isStringLiteralLike(source) && !inTry(node)) {
        if (/\(\?<[=!]/.test(source.text.replace(/\\.|\[(?:\\.|[^\]\\])*\]/g, '_'))) found.push(`regex lookbehind: ${source.text.slice(0, 80)}`);
        if (flags && ts.isStringLiteralLike(flags) && flags.text.includes('v')) found.push(`regex v flag: ${source.text.slice(0, 80)}`);
      }
    }
    ts.forEachChild(node, (child) => { todo.push(child); });
  }
  return found;
}

/** Third-party files copied as they are, loaded only by features that say so when they can't start. */
const SKIP = /^(?:pyodide|ort-)/;

function main(dir) {
  const bad = [];
  for (const f of readdirSync(dir)) {
    if (!/\.m?js$/.test(f) || SKIP.test(f)) continue;
    for (const p of problems(readFileSync(join(dir, f), 'utf8'), f)) bad.push(`${f}: ${p}`);
  }
  if (bad.length) {
    console.error(`Old WebKit (Safari 15.4) can't read the built app:\n${bad.join('\n')}`);
    process.exit(1);
  }
  console.log('Old WebKit check: the built scripts are readable by Safari 15.4.');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv[2] ?? 'dist');
