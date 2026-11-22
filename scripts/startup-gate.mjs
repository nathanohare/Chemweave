// The start-up check on pull requests: starts the built app of the branch being merged into and of
// the pull request (each served by `vite preview`) in turns on the same machine, and fails when the
// pull request's app takes more than 25% and 100 ms longer to be up. The fastest start of each
// side is compared, which shakes off most of a shared machine's noise (as scripts/bench-gate.mjs
// does). How busy the window is in its first seconds is printed, not checked. An expected slowdown
// passes when STARTUP_SLOWER_OK=true (ci.yml sets it from the pull request's label
// "slower start-up expected").
// node scripts/startup-gate.mjs <base url> <head url> [rounds] [starts per round]
import { launch } from '../bench/browser.mjs';
import { median, startSide, startupSlower, startupVerdict } from '../bench/startup.mjs';

const [baseUrl, headUrl, rounds = '2', per = '3'] = process.argv.slice(2);
const browser = await launch();
const runs = { base: [], head: [] };
const url = (side) => (side === 'base' ? baseUrl : headUrl);
const startOnce = (side, settle) => startSide(browser, side, url(side), settle);
const min = (list, k) => Math.min(...list.map((o) => o[k]));
const slower = () => startupSlower(runs.base, runs.head);
const time = async (n) => {
  for (let r = 0; r < n; r++)
    for (const side of r % 2 ? ['head', 'base'] : ['base', 'head'])
      for (let i = 0; i < Number(per); i++) runs[side].push(await startOnce(side, 3000));
};
try {
  // (one start each first, not counted: the server's and the disk's first reads)
  await startOnce('base', 500);
  await startOnce('head', 500);
  await time(Number(rounds));
  // (a slower result is timed again before it counts: a busy moment on the machine can look like one)
  if (slower()) { console.log('Slower on the first rounds: timing again.'); await time(Number(rounds)); }
} catch (e) {
  // (a side that doesn't start is named, not left as a bare timeout)
  console.log(e.message);
  await browser.close();
  process.exit(1);
}
await browser.close();

const row = (k) => `${k.padEnd(28)} ${String(min(runs.base, k)).padStart(7)} ${String(min(runs.head, k)).padStart(7)}   (medians ${median(runs.base, k)} / ${median(runs.head, k)})`;
console.log(`${'start-up (ms, fastest)'.padEnd(28)} ${'before'.padStart(7)} ${'now'.padStart(7)}`);
for (const k of ['up', 'busy', 'longest']) console.log(row(k));
const verdict = startupVerdict(runs.base, runs.head, process.env.STARTUP_SLOWER_OK === 'true');
console.log(`\n${verdict.text}`);
if (verdict.fail) process.exit(1);
