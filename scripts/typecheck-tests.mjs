// Type-checks tests/ for the mistakes that mean a test is not testing what it says: a name declared
// twice (a duplicate import), a name or module that doesn't exist, an import the module doesn't
// export. Only those kinds are reported: the tests also hold many looser type complaints that
// don't change what a test does (a mock typed loosely), so those are left out on purpose, not
// added to a list. It fails too when tsc itself could not run or crashed, so a broken setup is
// never read as "no problems". Run it with `npm run typecheck:tests`; Checks runs it on every
// pull request. Imports from scripts/*.mjs are not checked (they are untyped).
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

// duplicate identifier / declaration, can't find module, no exported member (and "declared locally
// but not exported", no default export, not a module), can't find name (and "did you mean"),
// namespace not found, name used as a type or a value, import of a non-module
export const KINDS = [2300, 2451, 2307, 2305, 2304, 2552, 2614, 2724, 2393, 2440, 2308, 2459, 2460, 1192, 2613, 2306, 2694, 2503, 2693, 2323, 2528, 2792, 2732, 18004];

/** The lines of tsc's output that report one of the KINDS. */
export function onlyKinds(output, kinds = KINDS) {
  return output.split('\n').filter((l) => {
    const m = /error TS(\d+):/.exec(l);
    return m && kinds.includes(Number(m[1]));
  });
}

/**
 * What to say and whether it failed, from how tsc ended: `status` (its exit code; 0 clean, 2 with
 * errors), `error` and `signal` (it could not start, or was killed) and its output.
 */
export function verdict({ status, error, signal, output }) {
  if (error || signal) return { fail: true, text: `tsc could not run: ${error?.message ?? `stopped by ${signal}`}` };
  if (status !== 0 && status !== 2) return { fail: true, text: `tsc ended with status ${status}, not a normal result:\n${output.slice(0, 2000)}` };
  // an error with no file in front of it is the setup (the config, a missing path), not a test
  const global = output.split('\n').filter((l) => /^error TS\d+:/.test(l));
  if (global.length) return { fail: true, text: `tsc could not check the tests:\n${global.join('\n')}` };
  const bad = onlyKinds(output);
  if (status === 2 && !/error TS\d+:/.test(output)) return { fail: true, text: 'tsc found errors but printed none' };
  if (bad.length) return { fail: true, text: `${bad.length} problem${bad.length === 1 ? '' : 's'} in tests/ (or src/):\n${bad.join('\n')}` };
  return { fail: false, text: 'tests/: no duplicate, missing or misspelled names or imports.' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const tsc = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url));
  const r = spawnSync(process.execPath, [tsc, '-p', 'tsconfig.tests.json'], { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const v = verdict({ status: r.status, error: r.error, signal: r.signal, output: `${r.stdout ?? ''}${r.stderr ?? ''}` });
  (v.fail ? console.error : console.log)(v.text);
  process.exit(v.fail ? 1 : 0);
}
