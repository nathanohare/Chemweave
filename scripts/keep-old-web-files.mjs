// Keeps the files of earlier web versions on the site for a while (run by the Web version workflow,
// .github/workflows/pages.yml, after the build and before the upload).
//
// A page opened before a new version is published keeps running the version it started with, and
// fetches more of its own files as they are first needed (a dialog, Document mode, the .docx
// writer). Publishing replaces the whole site, so without this those files would be gone and the
// part would fail to open until the page is reloaded. The build stamps each file's contents into
// its name (vite.config.ts), so the files of earlier versions can sit beside the new ones.
//
// The site lists its stamped files in kept-files.json, each with when it was last part of a
// published version. This script reads that list from the live site, downloads the files of the
// last KEEP_DAYS days that the new build no longer has (newest first, up to KEEP_BYTES in all), and
// writes the new list into dist/. Nothing here fails the deploy: if the site can't be reached, the
// new version is published without the old files and says so in the log.
//
//   node scripts/keep-old-web-files.mjs [dist folder]     (site: WEB_SITE_URL, or the usual address)

import { readdirSync, statSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const LIST = 'kept-files.json';
export const KEEP_DAYS = 7;
/** All the old files kept together, at most (GitHub Pages sites should stay under 1 GB). */
export const KEEP_BYTES = 300 * 1024 * 1024;
const DAY_MS = 86_400_000;

/** Files in dist/ that are replaced by every build rather than stamped: never listed or kept. */
const UNSTAMPED = new Set(['index.html', 'audience.html', 'version.json', LIST, '404.html', 'privacy.html']);

/**
 * Whether a path from the site's list is one this script may write: plain names in folders,
 * nothing hidden, no going up a folder, not one of the pages.
 */
export function safePath(p) {
  if (typeof p !== 'string' || !p || p.length > 200 || UNSTAMPED.has(p)) return false;
  return p.split('/').every((seg) => seg.length > 0 && !seg.startsWith('.') && [...seg].every((c) => /[A-Za-z0-9._-]/.test(c)));
}

/** The list read from the site, as entries this script can use (anything else in it is left out). */
export function parseList(text) {
  let r;
  try { r = JSON.parse(text); } catch { return []; }
  const files = r && typeof r === 'object' && Array.isArray(r.files) ? r.files : [];
  return files.filter((f) => f && typeof f === 'object' && safePath(f.path) && Number.isFinite(f.last) && Number.isFinite(f.size) && f.size >= 0)
    .map((f) => ({ path: f.path, last: f.last, size: f.size }));
}

/**
 * What to keep. `built`: the new build's stamped files ({ path, size }). `listed`: the site's list.
 * Returns the old files to download (newest first, within the days and the size limit) and the new
 * list: the built files as published now, then the kept ones with when they were last published.
 */
export function plan(built, listed, now, days = KEEP_DAYS, maxBytes = KEEP_BYTES) {
  const have = new Set(built.map((f) => f.path));
  const seen = new Set();
  const old = listed
    .filter((f) => !have.has(f.path) && now - f.last <= days * DAY_MS && !seen.has(f.path) && seen.add(f.path))
    .sort((a, b) => b.last - a.last || (a.path < b.path ? -1 : 1));
  const keep = [];
  let bytes = 0;
  for (const f of old) {
    if (bytes + f.size > maxBytes) continue;
    bytes += f.size;
    keep.push(f);
  }
  return { keep, list: [...built.map((f) => ({ path: f.path, last: now, size: f.size })), ...keep] };
}

/** The build's stamped files: everything in dist/ that didn't come from public/ and isn't a page. */
export function builtFiles(dist, pub) {
  const out = [];
  const walk = (rel) => {
    for (const name of readdirSync(path.join(dist, rel))) {
      const p = rel ? `${rel}/${name}` : name;
      const full = path.join(dist, p);
      if (statSync(full).isDirectory()) { walk(p); continue; }
      if (UNSTAMPED.has(p) || existsSync(path.join(pub, p))) continue;
      out.push({ path: p, size: statSync(full).size });
    }
  };
  walk('');
  return out.sort((a, b) => (a.path < b.path ? -1 : 1));
}

async function get(url) {
  return fetch(url, { signal: AbortSignal.timeout(60_000), cache: 'no-store' });
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const dist = path.resolve(process.argv[2] ?? path.join(root, 'dist'));
  const site = (process.env.WEB_SITE_URL || 'https://nathanohare.github.io/Chemweave/').replace(/\/?$/, '/');
  const built = builtFiles(dist, path.join(root, 'public'));
  const now = Date.now();
  let listed = [];
  try {
    const r = await get(new URL(LIST, site));
    if (r.ok) listed = parseList(await r.text());
    else console.log(`No ${LIST} on ${site} yet (${r.status}): publishing without earlier versions' files.`);
  } catch (e) {
    console.log(`::warning::Couldn't read ${LIST} from ${site} (${e}): publishing without earlier versions' files.`);
  }
  const { keep, list } = plan(built, listed, now);
  const missing = new Set();
  let done = 0, bytes = 0;
  const queue = [...keep];
  const worker = async () => {
    for (let f = queue.shift(); f; f = queue.shift()) {
      try {
        const r = await get(new URL(f.path, site));
        if (!r.ok) { missing.add(f.path); continue; }
        const data = new Uint8Array(await r.arrayBuffer());
        const to = path.join(dist, ...f.path.split('/'));
        if (existsSync(to)) continue;
        mkdirSync(path.dirname(to), { recursive: true });
        writeFileSync(to, data);
        done++;
        bytes += data.length;
      } catch {
        missing.add(f.path);
      }
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  const final = list.filter((f) => !missing.has(f.path));
  writeFileSync(path.join(dist, LIST), JSON.stringify({ files: final }) + '\n');
  console.log(`Kept ${done} files of earlier versions (${(bytes / 1048576).toFixed(1)} MB); ${missing.size} could not be fetched. Listed ${final.length} files.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
