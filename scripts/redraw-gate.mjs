// The redraw check on pull requests: drags in a big drawing in the built app of the branch being
// merged into and of the pull request (each served by `vite preview`), in turns on the same
// machine, and fails when a redraw is over its budget or got more than 40% slower
// (bench/redraw.mjs). The fastest of each side's runs is compared, as scripts/bench-gate.mjs does.
// node scripts/redraw-gate.mjs <base url> <head url> [runs per side]
import { launch } from '../bench/browser.mjs';
import { redrawOnce, redrawVerdict } from '../bench/redraw.mjs';

const [baseUrl, headUrl, per = '3'] = process.argv.slice(2);
const browser = await launch();
const runs = { base: [], head: [] };
try {
  for (let i = 0; i < Number(per); i++)
    for (const side of i % 2 ? ['head', 'base'] : ['base', 'head']) {
      try {
        runs[side].push(await redrawOnce(browser, side === 'base' ? baseUrl : headUrl));
      } catch (e) {
        const who = side === 'base' ? 'The base branch’s app' : 'This pull request’s app';
        throw new Error(`${who} could not be timed at ${side === 'base' ? baseUrl : headUrl} (${String(e?.message ?? e).split('\n')[0]}).`);
      }
    }
} catch (e) {
  console.log(e.message);
  await browser.close();
  process.exit(1);
}
await browser.close();
const v = redrawVerdict(runs.base, runs.head);
console.log(v.text);
if (v.fail) process.exit(1);
