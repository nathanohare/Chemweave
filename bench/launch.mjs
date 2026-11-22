// Start-up: when the app is up, and how long the window is busy in its first 5 s (long tasks).
// `node bench/launch.mjs` with `npm run preview` running.
import { launch } from './browser.mjs';
import { median, startOnce } from './startup.mjs';
const runs = Number(process.env.RUNS || 5);
const browser = await launch();
const out = [];
for (let i = 0; i < runs; i++) out.push(await startOnce(browser, process.env.APP_URL || 'http://localhost:4173/'));
console.log(JSON.stringify({ up: median(out, 'up'), quiet: median(out, 'quiet'), longest: median(out, 'longest'), busy: median(out, 'busy'), runs: out }));
await browser.close();
