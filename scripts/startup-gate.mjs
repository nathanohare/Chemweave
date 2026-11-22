// The start-up check on pull requests: starts the built app of the branch being merged into and of
// the pull request (each served by `vite preview`) in turns on the same machine, and fails when the
// pull request's app takes more than 25% and 100 ms longer to be up. The fastest start of each
// side is compared, which shakes off most of a shared machine's noise (as scripts/bench-gate.mjs
// does). How busy the window is in its first seconds is printed, not checked.
// node scripts/startup-gate.mjs <base url> <head url> [rounds] [starts per round]
import { launch } from '../bench/browser.mjs';
import { median, startOnce, startupSlower } from '../bench/startup.mjs';

const [baseUrl, headUrl, rounds = '2', per = '3'] = process.argv.slice(2);
const browser = await launch();
const runs = { base: [], head: [] };
// (one start each first, not counted: the server's and the disk's first reads)
await startOnce(browser, baseUrl, 500);
await startOnce(browser, headUrl, 500);
const min = (list, k) => Math.min(...list.map((o) => o[k]));
const slower = () => startupSlower(runs.base, runs.head);
const time = async (n) => {
  for (let r = 0; r < n; r++)
    for (const side of r % 2 ? ['head', 'base'] : ['base', 'head'])
      for (let i = 0; i < Number(per); i++) runs[side].push(await startOnce(browser, side === 'base' ? baseUrl : headUrl, 3000));
};
await time(Number(rounds));
// (a slower result is timed again before it counts: a busy moment on the machine can look like one)
if (slower()) { console.log('Slower on the first rounds: timing again.'); await time(Number(rounds)); }
await browser.close();

const row = (k) => `${k.padEnd(28)} ${String(min(runs.base, k)).padStart(7)} ${String(min(runs.head, k)).padStart(7)}   (medians ${median(runs.base, k)} / ${median(runs.head, k)})`;
console.log(`${'start-up (ms, fastest)'.padEnd(28)} ${'before'.padStart(7)} ${'now'.padStart(7)}`);
for (const k of ['up', 'busy', 'longest']) console.log(row(k));
const was = min(runs.base, 'up'), now = min(runs.head, 'up');
if (slower()) {
  console.log(`\nThe app takes ${now - was} ms (${Math.round((now / was - 1) * 100)}%) longer to start than on the base branch. If that is expected, say why in the pull request.`);
  process.exit(1);
}
console.log('\nStart-up did not get noticeably slower.');
