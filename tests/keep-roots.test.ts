// The desktop app keeps its copies in one folder, and its Rust side (src-tauri/src/keep.rs,
// key_path) only takes keys under the places it lists. Every place the TypeScript keeps things
// in must be on that list, or every write there fails on the desktop only (the web version's
// store takes any key). Reopening tabs after an update ("restart/") and the Knowledge Base's
// imported tables ("kb/") were both missing once.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? (n === 'vendor' ? [] : files(p)) : /\.ts$/.test(n) ? [p] : [];
  });
}

/** The first part of every key the app's code gives the keep store. */
function rootsUsed(): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of files('src')) {
    const text = readFileSync(f, 'utf8');
    if (!/\bkeepStore\b|\bKeepStore\b/.test(text)) continue;
    // a folder constant (const FOLDER = 'recovery'), or a key constant ('kb/imported-tables.json')
    for (const m of text.matchAll(/const\s+[A-Z_]*FOLDER\s*=\s*'([a-z0-9_-]+)'/g)) out.set(m[1], f);
    for (const m of text.matchAll(/const\s+[A-Z_]*KEY\s*=\s*'([a-z0-9_-]+)\//g)) out.set(m[1], f);
    // a key written out where it is used: getText(store, 'library/…'), store.put(`library/…`)
    for (const m of text.matchAll(/(?:getText|putText)\(\s*[\w.()]+\s*,\s*['`]([a-z0-9_-]+)\//g)) out.set(m[1], f);
    for (const m of text.matchAll(/store\.(?:put|get|remove|list)\(\s*['`]([a-z0-9_-]+)\//g)) out.set(m[1], f);
  }
  return out;
}

describe('the desktop keep folder', () => {
  it('takes every place the app keeps things in', () => {
    const rust = readFileSync('src-tauri/src/keep.rs', 'utf8');
    const m = /matches!\(parts\[0\],([^)]*)\)/.exec(rust);
    expect(m, 'key_path lists its places with matches!(parts[0], …)').not.toBeNull();
    const allowed = new Set([...m![1].matchAll(/"([^"]+)"/g)].map((x) => x[1]));
    const used = rootsUsed();
    // (the scan finds the places that are known to be used, so it is still reading the code)
    for (const known of ['recovery', 'versions', 'restart', 'diagnostics', 'library', 'kb']) expect(used.has(known), known).toBe(true);
    const missing = [...used].filter(([root]) => !allowed.has(root)).map(([root, f]) => `${root} (${f})`);
    expect(missing).toEqual([]);
  });
});
