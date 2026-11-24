// The workflows in .github/workflows: steps that call an outside service try again before they
// give up, and nothing is published from a pull request or a try-out run.
//
// Why (2026-11-24): the Web version deploy (#699) and the Windows signing step (#705)
// both failed in jobs that run only on main. Nothing tried them before the merge, and the signing
// step gave up on Azure's first refusal. So: workflow changes are tried on their pull request
// (each main-only workflow builds without publishing there), and every call to an outside service
// goes through scripts/retry.mjs, or is listed in NOT_RETRIED below with the reason.

import { describe, it, expect } from 'vitest';
// @ts-expect-error a plain JavaScript script
import { parseArgs, run } from '../scripts/retry.mjs';
import { readFileSync, readdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const DIR = '.github/workflows';
const workflows = readdirSync(DIR).filter((f) => f.endsWith('.yml'));
const text = (f: string) => readFileSync(join(DIR, f), 'utf8');

// Commands that reach a service outside the runner (Windows signing has its own retrying script,
// checked below). Package installs (npm ci, pip, cargo build)
// are left out: their tools already try again by themselves.
const OUTSIDE = /\b(gh (api|release \w+)|curl\b|git (push|clone)\b|cargo install\b|xcrun (altool|notarytool)\b)/;
const RETRIED = /node (\S*scripts\/retry\.mjs|"\$retry") --/;

// Outside calls that deliberately don't go through retry.mjs, each with its reason.
const NOT_RETRIED: { file: string; match: RegExp; why: string }[] = [
  { file: '*', match: /gh release create\b/, why: 'a create that fails part way can leave the release behind, and creating the same tag again then fails anyway; re-run the job' },
  { file: '*', match: /gh release view\b/, why: 'asks whether a release exists: "no" is a non-zero exit, so trying again would only wait' },
  { file: 'ci.yml', match: /curl -sf http:\/\/localhost/, why: 'the app served on this runner, not an outside service; the loop already waits for it' },
  { file: 'ci.yml', match: /gh api\b/, why: 'pull-request checks: a failure shows on the pull request at once and is re-run there (the first call runs before the checkout)' },
];

/** The lines of a workflow's run: scripts, without comment lines. */
function scriptLines(src: string): { line: string; n: number }[] {
  const out: { line: string; n: number }[] = [];
  src.split('\n').forEach((line, i) => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return;
    out.push({ line: t, n: i + 1 });
  });
  return out;
}

describe('outside services are tried again (scripts/retry.mjs)', () => {
  it('every call to an outside service goes through retry.mjs or is listed with its reason', () => {
    const missing: string[] = [];
    for (const f of workflows) {
      for (const { line, n } of scriptLines(text(f))) {
        if (!OUTSIDE.test(line) || RETRIED.test(line)) continue;
        if (NOT_RETRIED.some((x) => (x.file === '*' || x.file === f) && x.match.test(line))) continue;
        missing.push(`${f}:${n}: ${line}`);
      }
    }
    expect(missing, 'wrap these in `node scripts/retry.mjs -- …`, or add them to NOT_RETRIED with the reason').toEqual([]);
  });

  it('a script that changes folder reaches retry.mjs by a full path', () => {
    const wrong: string[] = [];
    for (const f of workflows) {
      let moved = false;
      for (const { line, n } of scriptLines(text(f))) {
        if (/^(- |run:|[a-z_-]+:\s*$)/.test(line)) moved = false; // a new step or key
        if (/(^|[;&|]\s*)cd /.test(line) && !/^\(/.test(line)) moved = true;
        if (moved && /node scripts\/retry\.mjs/.test(line)) wrong.push(`${f}:${n}: ${line}`);
      }
    }
    expect(wrong, 'after a cd, use retry="$PWD/scripts/retry.mjs" before it, then node "$retry" --').toEqual([]);
  });

  it('every NOT_RETRIED entry still matches a line (so the list shrinks when a call goes)', () => {
    for (const x of NOT_RETRIED) {
      const files = x.file === '*' ? workflows : [x.file];
      const hit = files.some((f) => scriptLines(text(f)).some(({ line }) => x.match.test(line)));
      expect(hit, `${x.file} ${x.match}`).toBe(true);
    }
  });

  it('the Windows signing step goes through its own retrying script', () => {
    expect(text('desktop.yml')).toContain('scripts/sign-windows.mjs');
  });
});

describe('main-only workflows are tried on their pull request without publishing', () => {
  it('the Web version builds on a pull request that changes it, and deploys only from main', () => {
    const src = text('pages.yml');
    expect(src).toMatch(/pull_request:\n\s+paths: \[\.github\/workflows\/pages\.yml/);
    expect(src).toMatch(/deploy:\n\s+needs: build\n(\s+#.*\n)*\s+if: github\.ref == 'refs\/heads\/main' && github\.event_name != 'pull_request'/);
  });

  it('the Desktop app builds on a pull request that changes it, and publishes only from main', () => {
    const src = text('desktop.yml');
    expect(src).toMatch(/pull_request:\n\s+paths:\n\s+- \.github\/workflows\/desktop\.yml/);
    // the release flag is set only for a push to main with the updater key
    expect(src).toContain('if [ "$GITHUB_REF" = "refs/heads/main" ] && [ "$SIGNED" = "true" ]; then echo "release=true"');
    expect(src).toMatch(/publish:\n\s+needs: \[plan, build\]\n\s+if: needs\.plan\.outputs\.release == 'true'/);
  });

  it('the iPad app runs on a pull request that changes it, and never sends one to TestFlight', () => {
    const src = text('ios.yml');
    expect(src).toMatch(/pull_request:\n\s+paths: \[\.github\/workflows\/ios\.yml,/);
    const ship = src.match(/SHIP: \$\{\{(.*)\}\}/)?.[1] ?? '';
    expect(ship).toContain("github.event_name != 'pull_request'");
    expect(ship).toContain("github.ref == 'refs/heads/main'");
    // inputs.ship is empty on a push, and GitHub compares empty with false as equal, so a bare
    // `inputs.ship != false` would stop every merge from shipping
    expect(ship).not.toMatch(/inputs\.ship != false/);
    expect(ship).toContain("(github.event_name != 'workflow_dispatch' || inputs.ship)");
    expect(src.match(/if: env\.SHIP == 'true'/g)?.length).toBe(2);
  });

  it('the structure reader model and the wiki publish only from main', () => {
    expect(text('recognition-model.yml')).toMatch(/name: Publish\n(\s+#.*\n)*\s+if: github\.event_name != 'pull_request' && github\.ref == 'refs\/heads\/main'/);
    expect(text('wiki.yml')).toMatch(/if \[ "\$GITHUB_EVENT_NAME" = "pull_request" \]; then[\s\S]*?exit 0[\s\S]*?git push/);
  });

  it('a pull request never gets write access for the whole Web version or Desktop app workflow', () => {
    for (const f of ['pages.yml', 'desktop.yml']) {
      const top = text(f).split('\njobs:')[0];
      expect(top, f).toMatch(/permissions:\n\s+contents: read\n/);
      expect(top, f).not.toMatch(/: write/);
    }
  });

  it('workflow files are linted on every pull request that changes them', () => {
    const src = text('workflow-lint.yml');
    expect(src).toContain("paths: ['.github/workflows/**']");
    expect(src).toMatch(/uses: docker:\/\/rhysd\/actionlint:\d+\.\d+\.\d+/);
  });
});

describe('scripts/retry.mjs', () => {
  it('reads the pauses and the command', () => {
    expect(parseArgs(['--', 'git', 'push'])).toEqual({ waits: [15, 45, 90], command: ['git', 'push'] });
    expect(parseArgs(['--waits', '1,2', '--', 'x'])).toEqual({ waits: [1, 2], command: ['x'] });
    expect(() => parseArgs(['git', 'push'])).toThrow(/after --/);
    expect(() => parseArgs(['--'])).toThrow(/no command/);
    expect(() => parseArgs(['--waits', 'soon', '--', 'x'])).toThrow(/seconds/);
  });

  // a command that fails until its counter reaches `succeedOn`
  function flaky(succeedOn: number) {
    const dir = mkdtempSync(join(tmpdir(), 'retry-'));
    const count = join(dir, 'n');
    writeFileSync(count, '0');
    const js = `const fs=require('fs');const n=+fs.readFileSync(${JSON.stringify(count)},'utf8')+1;fs.writeFileSync(${JSON.stringify(count)},String(n));process.exit(n>=${succeedOn}?0:7)`;
    return { command: [process.execPath, '-e', js], tries: () => Number(readFileSync(count, 'utf8')) };
  }

  it('tries again after each pause and stops at the first success', () => {
    const f = flaky(3);
    const pauses: number[] = [];
    const said: string[] = [];
    expect(run(f.command, [5, 10, 20], { say: (t: string) => said.push(t), pause: (s: number) => pauses.push(s) })).toBe(0);
    expect(f.tries()).toBe(3);
    expect(pauses).toEqual([5, 10]);
    expect(said.some((t) => t.includes('exit code 7'))).toBe(true);
  });

  it('gives up after the last pause with the command\'s own exit code', () => {
    const f = flaky(99);
    const said: string[] = [];
    expect(run(f.command, [0, 0], { say: (t: string) => said.push(t), pause: () => {} })).toBe(7);
    expect(f.tries()).toBe(3);
    expect(said.at(-1)).toMatch(/failed 3 times/);
  });

  it('stops at once on a command that cannot be started', () => {
    const said: string[] = [];
    const pauses: number[] = [];
    expect(run(['no-such-command-here'], [5, 5], { say: (t: string) => said.push(t), pause: (s: number) => pauses.push(s) })).toBe(127);
    expect(pauses).toEqual([]);
    expect(said.join('\n')).toMatch(/could not start "no-such-command-here"/);
  });
});
