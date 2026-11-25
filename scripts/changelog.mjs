// The changelog: what changed in each version, from the small change files every pull request adds
// to changes/ (how to write one: changes/README.md).
//
//   node scripts/changelog.mjs check <base ref> [labels]
//     On a pull request (.github/workflows/changelog.yml): fails when the pull request changes what
//     people use (src/, src-tauri/, index.html, public/, opsin-js/) without adding a change file, unless it has
//     the "no changelog" label; and checks every change file it adds or edits is written right.
//   node scripts/changelog.mjs notes <out file> [<version>]
//     For the release of a build of main (.github/workflows/desktop.yml): the change files added
//     since the last published version, as the release's notes (Markdown). The app's Help ▸ What's
//     New and update notice show these notes. A version with no change files lists the titles of
//     the pull requests it holds instead, never an empty pull request template.
//   node scripts/changelog.mjs write [<version>]
//     Makes CHANGELOG.md again: every change file under the version it was first published in
//     (one not published yet goes under <version>, the version being published now, or under
//     "Unreleased" when no version is given), then the history from before change files (changes/history/), with the milestones at the top.
//   node scripts/changelog.mjs push <version> [--dry-run]
//     After a release: makes CHANGELOG.md on the newest main, with the new version's tag fetched,
//     and commits and pushes it to main if it changed (run through scripts/retry.mjs).
//
// Only Node's own modules, so it runs without npm ci.

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const REPO = 'nathanohare/Chemweave';
export const DIR = 'changes';
export const TYPES = ['Added', 'Changed', 'Fixed', 'Removed', 'Under the hood'];
/** Change files are every .md file in changes/ but its README; changes/history/ holds the rest. */
const NOT_ENTRIES = new Set(['README.md']);
/** What people use: a pull request that changes any of these adds a change file. */
const USER_FACING = /^(src\/|src-tauri\/|index\.html$|public\/|opsin-js\/)/;
export const SKIP_LABEL = 'no changelog';
const MAX_TEXT = 400;

/**
 * One change file: each line is "<Type>: <what changed>", such as
 * "Fixed: Slides: a video's poster frame shows again after saving. Fixes #123."
 * Blank lines and lines starting with "<!--" or "#" are skipped.
 */
export function parseChangeFile(text, name = 'change file') {
  const entries = [], errors = [];
  const src = text.replace(/<!--[\s\S]*?-->/g, '');
  src.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const type = TYPES.find((t) => line.toLowerCase().startsWith(t.toLowerCase() + ':'));
    if (!type) { errors.push(`${name}:${i + 1}: start the line with one of ${TYPES.map((t) => `"${t}:"`).join(', ')}`); return; }
    const said = line.slice(type.length + 1).trim();
    if (said.length < 10) errors.push(`${name}:${i + 1}: say what changed in a sentence`);
    else if (said.length > MAX_TEXT) errors.push(`${name}:${i + 1}: keep it to one or two sentences (${said.length} characters, at most ${MAX_TEXT})`);
    else if (/\b(TODO|TBD|lorem ipsum)\b/i.test(said)) errors.push(`${name}:${i + 1}: finish the entry`);
    else {
      // a change file written after its pull request merged can name it: "... (#717)"
      const own = /\s*\(#(\d+)\)$/.exec(said);
      entries.push(own ? { type, text: said.slice(0, own.index), pr: +own[1] } : { type, text: said });
    }
  });
  if (!entries.length && !errors.length) errors.push(`${name}: no entries (write at least one "<Type>: <what changed>" line)`);
  return { entries, errors };
}

/** Issue numbers mentioned in an entry ("Fixes #123", "reported in #45"). */
export function issuesIn(text) {
  return [...text.matchAll(/(?<![\w/])#(\d+)\b/g)].map((m) => +m[1]);
}

/**
 * A version's entries as Markdown: a heading for each kind of change, in TYPES order.
 * `links` turns #123 into links (CHANGELOG.md; GitHub links them by itself in release notes).
 */
export function renderEntries(entries, { links = false, level = 3 } = {}) {
  const h = '#'.repeat(level);
  const link = (s) => links ? s.replace(/(?<![\w/[])#(\d+)\b/g, `[#$1](https://github.com/${REPO}/issues/$1)`) : s;
  const out = [];
  for (const type of TYPES) {
    const of = entries.filter((e) => e.type === type);
    if (!of.length) continue;
    out.push(`${h} ${type}`, '');
    for (const e of of) {
      const pr = e.pr ? ` ${links ? `([#${e.pr}](https://github.com/${REPO}/pull/${e.pr}))` : `(#${e.pr})`}` : '';
      out.push(`- ${link(e.text)}${pr}`);
    }
    out.push('');
  }
  return out.join('\n').trim();
}

/** Whether a pull request's files need a change file. */
export function needsEntry(files) {
  return files.some((f) => USER_FACING.test(f));
}

/** The change files among a list of paths (changes/*.md, not the README or changes/history/). */
export function changeFiles(paths) {
  return paths.filter((p) => /^changes\/[^/]+\.md$/.test(p) && !NOT_ENTRIES.has(p.slice(DIR.length + 1)));
}

/** The pull request number in a squash merge's subject ("Fix a thing (#123)") or a merge commit's. */
export function prOf(subject) {
  const m = /\(#(\d+)\)\s*$/.exec(subject) ?? /^Merge pull request #(\d+)\b/.exec(subject);
  return m ? +m[1] : undefined;
}

/** Release tags (v0.1.123) in version order, oldest first. */
export function sortTags(tags) {
  const num = (t) => t.replace(/^v/, '').split('.').map((x) => parseInt(x, 10) || 0);
  return tags.filter((t) => /^v\d+\.\d+\.\d+$/.test(t)).sort((a, b) => {
    const x = num(a), y = num(b);
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
    return 0;
  });
}

/** The whole CHANGELOG.md from its parts (versions newest first, each { version, date, entries }). */
export function renderChangelog({ versions, history = '', milestones = '' }) {
  const prs = new Set();
  for (const v of versions) for (const e of v.entries) if (e.pr) prs.add(e.pr);
  for (const m of history.matchAll(/\/pull\/(\d+)\)/g)) prs.add(+m[1]);
  const strip = (t) => t.replace(/<!--[\s\S]*?-->\s*/g, '').trim();
  history = strip(history); milestones = strip(milestones);
  const releases = versions.filter((v) => v.version !== 'Unreleased').length + (history.match(/^## \d/gm) ?? []).length;
  const out = [
    '# Changelog',
    '',
    '<!-- Made by scripts/changelog.mjs from changes/ each time a version is published. Edit the files in changes/, not this one. -->',
    '',
    `Every version of Chemweave, newest first: ${releases} versions and ${prs.size} pull requests so far. Each version's installers are on the [Releases](https://github.com/${REPO}/releases) page, and the app shows what's new in **Help ▸ What's New**. Found a problem? **Help ▸ Send Feedback**, or [open an issue](https://github.com/${REPO}/issues); the fix's entry here names the issue it fixes.`,
    '',
  ];
  if (milestones.trim()) out.push('## Milestones', '', milestones.trim(), '');
  for (const v of versions) {
    out.push(`## ${v.version}${v.date ? ` (${v.date})` : ''}`, '');
    out.push(renderEntries(v.entries, { links: true }), '');
  }
  if (history.trim()) out.push(history.trim(), '');
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

// ---------------------------------------------------------------------------------------------
// The parts that read git

const git = (...args) => execFileSync('git', ['-c', 'core.quotePath=false', ...args], { encoding: 'utf8', maxBuffer: 1 << 28 }).replace(/\s+$/, '');
const lines = (s) => s.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.trim());
/** A staging-into-main roll-up, whose pull request number is not the one that wrote a change file. */
export const isRollUp = (subject) => /^(Staging|Checkpoint|Final checkpoint|Merge pull request #\d+ from \S+\/staging)\b/i.test(subject);

/**
 * Where each change file was first added in `rev`'s history: path -> { sha, pr }, in one pass.
 * When a roll-up was squashed into main, the pull request that wrote the file is looked up in the
 * roll-up's own commits (GitHub keeps refs/pull/<n>/head after the branch is deleted).
 */
function addedMap(rev = 'HEAD', wanted = null) {
  const map = new Map();
  const out = git('log', rev, '--no-renames', '--diff-filter=A', '--name-only', '--format=%x00%H%x09%s', '--', DIR);
  for (const block of out.split('\0').filter((b) => b.trim())) {
    const [first, ...paths] = lines(block);
    const [sha, subject = ''] = first.split('\t');
    for (const p of changeFiles(paths)) map.set(p, { sha, subject, pr: prOf(subject) }); // oldest wins (log is newest first)
  }
  const rollUps = new Map();
  for (const [p, a] of map) {
    if (!isRollUp(a.subject) || !a.pr || (wanted && !wanted.has(p))) continue;
    if (!rollUps.has(a.pr)) {
      let inner = new Map();
      // tried three times; if GitHub still can't be reached the entry just has no pull request
      // number (said in the log), rather than holding up a release
      for (let i = 0; i < 3 && !inner.size; i++) {
        try {
          git('fetch', '-q', 'origin', `+refs/pull/${a.pr}/head:refs/changelog/pr-${a.pr}`);
          inner = addedMap(`refs/changelog/pr-${a.pr}`);
        } catch (e) {
          if (i === 2) console.warn(`Could not read pull request #${a.pr}'s commits, so its change files have no pull request number: ${e.message}`);
          else execFileSync('sleep', [String(5 * (i + 1))]);
        }
      }
      rollUps.set(a.pr, inner);
    }
    const inner = rollUps.get(a.pr).get(p);
    map.set(p, { ...a, pr: inner && !isRollUp(inner.subject) ? inner.pr : undefined });
  }
  return map;
}

function readEntries(path) {
  const { entries, errors } = parseChangeFile(readFileSync(path, 'utf8'), path);
  if (errors.length) console.warn(errors.join('\n'));
  return entries;
}

/** The newest release tag that is part of HEAD's history: the version before this one. */
function previousTag(version) {
  const here = new Set(lines(git('tag', '--points-at', 'HEAD', '--list', 'v*')));
  // a re-run after a release was made and removed leaves this version's tag on HEAD: skip it
  return sortTags(lines(git('tag', '--merged', 'HEAD', '--list', 'v*'))).filter((t) => t !== `v${version}` && !here.has(t)).pop();
}

function notes(version) {
  const prev = previousTag(version);
  const range = prev ? `${prev}..HEAD` : 'HEAD';
  const added = prev ? changeFiles(lines(git('diff', '--no-renames', '--name-only', '--diff-filter=A', prev, 'HEAD', '--', DIR))) : changeFiles(lines(git('ls-files', DIR)));
  const by = added.length ? addedMap('HEAD', new Set(added)) : new Map();
  const entries = [];
  for (const f of added.sort()) {
    if (!existsSync(f)) continue;
    for (const e of readEntries(f)) entries.push({ pr: by.get(f)?.pr, ...e });
  }
  if (entries.length) return renderEntries(entries) + `\n\nEvery version: [CHANGELOG.md](https://github.com/${REPO}/blob/main/CHANGELOG.md)`;
  // no change files: the pull requests' titles, never a merge commit's template text
  const titles = lines(git('log', '--format=%s', range)).filter((s) => prOf(s) && !isRollUp(s) && !/^Merge pull request\b/.test(s));
  return titles.length ? titles.map((t) => `- ${t}`).join('\n') : 'Small changes; see the commits for this version.';
}

/**
 * Change file -> the first release tag whose files hold it, walking the tags oldest first (one
 * tree comparison each). By the files, not the commits, so a checkpoint squashed into main and
 * one merged into it both put a file under the version that first shipped it.
 */
function firstTags(tags) {
  const first = new Map();
  let prev;
  for (const t of tags) {
    const found = prev ? lines(git('diff', '--no-renames', '--name-only', '--diff-filter=A', prev, t, '--', DIR)) : lines(git('ls-tree', '-r', '--name-only', t, '--', DIR));
    for (const f of changeFiles(found)) if (!first.has(f)) first.set(f, t);
    prev = t;
  }
  return first;
}

function versions(headVersion) {
  const tags = sortTags(lines(git('tag', '--list', 'v*')));
  const first = firstTags(tags);
  const by = addedMap();
  const byVersion = new Map();
  for (const f of changeFiles(readdirSync(DIR).map((n) => `${DIR}/${n}`)).sort()) {
    const a = by.get(f);
    const tag = first.get(f);
    const version = tag ? tag.slice(1) : headVersion;
    if (!byVersion.has(version)) byVersion.set(version, []);
    for (const e of readEntries(f)) byVersion.get(version).push({ pr: a?.pr, ...e });
  }
  const dated = (v) => tags.includes(`v${v}`) ? git('log', '-1', '--format=%ad', '--date=short', `v${v}`) : v === 'Unreleased' ? '' : new Date().toISOString().slice(0, 10);
  const num = (v) => /^\d+\.\d+\.\d+$/.test(v) ? v.split('.').map(Number) : [Infinity, Infinity, Infinity];
  return [...byVersion.entries()]
    .map(([version, entries]) => ({ version, date: dated(version), entries }))
    .sort((a, b) => { const x = num(a.version), y = num(b.version); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return y[i] - x[i]; return 0; });
}

function readIf(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

function write(version) {
  const text = renderChangelog({
    versions: versions(version),
    history: readIf(join(DIR, 'history', 'before-change-files.md')),
    milestones: readIf(join(DIR, 'history', 'milestones.md')),
  });
  writeFileSync('CHANGELOG.md', text);
}

function check(base, labels = '') {
  const diff = (filter) => lines(git('diff', '--no-renames', '--name-only', ...(filter ? [`--diff-filter=${filter}`] : []), `${base}...HEAD`));
  const files = diff();
  const added = changeFiles(diff('A'));
  const touched = changeFiles(diff('AM'));
  const errors = [];
  for (const f of touched) errors.push(...parseChangeFile(readFileSync(f, 'utf8'), f).errors);
  if (files.includes('CHANGELOG.md')) errors.push('CHANGELOG.md is made on main each time a version is published; change the files in changes/ instead.');
  const removed = changeFiles(diff('D'));
  if (removed.length) errors.push(`Change files are kept once merged (they make CHANGELOG.md); put these back: ${removed.join(', ')}`);
  const skip = labels.split(',').map((l) => l.trim().toLowerCase()).includes(SKIP_LABEL);
  if (needsEntry(files) && !added.length && !skip) {
    errors.push(
      'This pull request changes the app but adds no change file.\n' +
      `Add changes/<short-name>.md with a line such as "Fixed: Slides: a video's poster frame shows again after saving." (how: changes/README.md).\n` +
      `If people won't notice the change at all, add the "${SKIP_LABEL}" label instead.`);
  }
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  console.log(added.length ? `Change files: ${added.join(', ')}` : 'No change file needed.');
}

const BOT = ['-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com'];

/**
 * Makes CHANGELOG.md on the newest main and pushes it. It starts from origin/main each time (so a
 * merge or another release's changelog commit that reached main in the meantime is kept, and a
 * second try after a failed push starts clean, never mid-rebase), fetches the tags (so this version's new tag files
 * its change files under it), writes the file, commits it if it changed, and pushes. A push that
 * still fails exits non-zero, and scripts/retry.mjs runs it again.
 */
function push(version, dry = false) {
  git('fetch', '-q', '--tags', '--force', 'origin', 'main');
  git('checkout', '-q', '-f', '--detach', 'FETCH_HEAD');
  write('Unreleased');
  if (!git('status', '--porcelain', '--', 'CHANGELOG.md')) { console.log('CHANGELOG.md is already up to date'); return; }
  git('add', 'CHANGELOG.md');
  git(...BOT, 'commit', '-q', '-m', `Changelog for ${version}`);
  if (dry) { console.log(`Would push CHANGELOG.md for ${version} (a try-out: nothing pushed)`); return; }
  git('push', 'origin', 'HEAD:main');
  console.log(`Pushed CHANGELOG.md for ${version}`);
}

const run = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (run) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'check') check(rest[0], rest[1]);
  else if (cmd === 'notes') writeFileSync(rest[0], notes(rest[1]) + '\n');
  else if (cmd === 'write') write(rest[0] || 'Unreleased');
  else if (cmd === 'push') push(rest[0], rest[1] === '--dry-run');
  else { console.error('usage: node scripts/changelog.mjs check <base> [labels] | notes <out> [<version>] | write [<version>] | push <version> [--dry-run]'); process.exit(2); }
}
