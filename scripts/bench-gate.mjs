// The speed check on pull requests: compares two runs of bench/core.bench.ts (the pull request's
// code and the code it would merge into, timed on the same machine, taking turns) and fails when
// any measure got more than 40% slower (two runs of the same code can differ by up to 30%). Each
// measure's fastest run over all the files for a side is compared, which shakes off most of the
// noise of a shared machine; differences under 10 ms are ignored. node scripts/bench-gate.mjs <base.json>[,<base2.json>…] <head.json>[,<head2.json>…]
//
// It also fails when a measure in BUDGETS takes longer than its budget at all, whatever the base
// branch takes (standing rule R6): a slowdown that creeps in over many pull requests, each under the
// 40% step, still fails. Exported so tests/bench-gate.test.ts can check it.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const LIMIT = 1.4, FLOOR_MS = 10;

/**
 * The most each measure may take (its fastest run, in ms), at the real sizes of bench/core.bench.ts.
 * How they were set: about 3 times the fastest run on a shared 4-core cloud machine in November 2026
 * (the numbers in the comments), rounded up, so a slow Checks machine passes and a real slowdown
 * fails. Raise one only with the reason in the pull request; lower one when a speed-up lands.
 */
export const BUDGETS = {
  'big drawing (2,000 structures, 14,000 atoms) / save CDXML (2,000 structures)': 6000, // 1846
  'big drawing (2,000 structures, 14,000 atoms) / open CDXML (2,000 structures)': 6000, // 2004
  'big drawing (2,000 structures, 14,000 atoms) / edit: move one atom (2,000 structures)': 20, // 0.005 (the floor: under 20 ms is instant)
  'big drawing (2,000 structures, 14,000 atoms) / Clean Up checks every structure (2,000 structures)': 750, // 232
  'big molecule (600 atoms) / save CDXML (600-atom molecule)': 300, // 83
  'big molecule (600 atoms) / open CDXML (600-atom molecule)': 150, // 31
  'big molecule (600 atoms) / Clean Up (600-atom molecule)': 150, // 23
  'Gaussian log (43 MB) / read a 43 MB Gaussian log': 250, // 53
};
const read = (list) => {
  const out = {};
  for (const f of list.split(','))
    for (const file of JSON.parse(fs.readFileSync(f, 'utf8')).files)
      for (const g of file.groups) for (const b of g.benchmarks) {
        const k = `${g.fullName.split(' > ').pop()} / ${b.name}`;
        out[k] = Math.min(out[k] ?? Infinity, b.min);
      }
  return out;
};
/** The measures over their budget: [{ k, now, budget }]. A budget whose measure is missing is reported too. */
export function overBudget(head, budgets = BUDGETS) {
  const out = [];
  for (const [k, budget] of Object.entries(budgets)) {
    if (!(k in head)) out.push({ k, now: undefined, budget });
    else if (head[k] > budget) out.push({ k, now: head[k], budget });
  }
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();

function main() {
const [baseFile, headFile] = process.argv.slice(2);
const base = read(baseFile), head = read(headFile);
let slower = 0;
console.log(`${'measure'.padEnd(72)} ${'before'.padStart(9)} ${'now'.padStart(9)}  change`);
for (const [k, now] of Object.entries(head)) {
  const was = base[k];
  if (was === undefined) { console.log(`${k.padEnd(72)} ${'new'.padStart(9)} ${now.toFixed(1).padStart(9)}`); continue; }
  const bad = now > was * LIMIT && now - was > FLOOR_MS;
  if (bad) slower++;
  const pct = ((now - was) / was) * 100;
  console.log(`${k.padEnd(72)} ${was.toFixed(1).padStart(9)} ${now.toFixed(1).padStart(9)}  ${pct > 0 ? '+' : ''}${pct.toFixed(0)}%${bad ? '  SLOWER' : ''}`);
}
const over = overBudget(head);
for (const { k, now, budget } of over)
  console.log(now === undefined
    ? `\n"${k}" has a budget in scripts/bench-gate.mjs BUDGETS but bench/core.bench.ts no longer measures it. Rename the budget with the measure.`
    : `\n"${k}" takes ${now.toFixed(0)} ms, over its ${budget} ms budget (scripts/bench-gate.mjs BUDGETS). Make it faster, or raise the budget with the reason in the pull request.`);
if (slower) console.log(`\n${slower} measure${slower === 1 ? '' : 's'} more than ${Math.round((LIMIT - 1) * 100)}% slower than the base branch. If that is expected, say why in the pull request.`);
if (slower || over.length) process.exit(1);
console.log('\nNo measure got noticeably slower, and every measure is within its budget.');
}
