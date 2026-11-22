// Ends a test run with how many real-file suites were skipped for want of the private files
// (tests/real-files.ts), so a run without them never looks as though they passed.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestProject } from 'vitest/node';

export default function setup(project: TestProject): () => void {
  const dir = mkdtempSync(join(tmpdir(), 'chemweave-real-files-'));
  project.provide('realFilesSkipped', dir);
  return () => {
    let lines: string[] = [];
    try { lines = readdirSync(dir).map((f) => readFileSync(join(dir, f), 'utf8').trim()).sort(); } catch { lines = []; }
    rmSync(dir, { recursive: true, force: true });
    if (!lines.length) return;
    const names = lines.map((l) => l.split('\t')[0]);
    const vars = [...new Set(lines.map((l) => l.split('\t')[1]))];
    console.log(`\n${lines.length} real-file suite${lines.length === 1 ? '' : 's'} skipped (the ChemDraw and PowerPoint files are private; set ${vars.join(' or ')} to run them): ${names.join(', ')}.\n`);
  };
}
