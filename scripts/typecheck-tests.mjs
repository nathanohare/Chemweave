// Type-checks tests/ for the mistakes that mean a test is not testing what it says: a name declared
// twice (a duplicate import), a name or module that doesn't exist, an import the module doesn't
// export. Only those kinds are reported: the tests also hold many looser type complaints that
// don't change what a test does (a mock typed loosely), so those are left out on purpose, not
// added to a list. Run it with `npm run typecheck:tests`; Checks runs it on every pull request.
import { spawnSync } from 'node:child_process';

// duplicate identifier, redeclared block-scoped name, can't find module, no exported member,
// can't find name (and its "did you mean" form), duplicate export, import of a non-module
export const KINDS = [2300, 2451, 2307, 2305, 2304, 2552, 2614, 2724, 2393, 2440, 2308];

/** The lines of tsc's output that report one of the KINDS. */
export function onlyKinds(output, kinds = KINDS) {
  return output.split('\n').filter((l) => {
    const m = /error TS(\d+):/.exec(l);
    return m && kinds.includes(Number(m[1]));
  });
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const r = spawnSync('npx', ['tsc', '-p', 'tsconfig.tests.json'], { encoding: 'utf8', shell: process.platform === 'win32', maxBuffer: 64 * 1024 * 1024 });
  const bad = onlyKinds((r.stdout ?? '') + (r.stderr ?? ''));
  if (bad.length) { console.error(`${bad.length} problem${bad.length === 1 ? '' : 's'} in tests/:\n${bad.join('\n')}`); process.exit(1); }
  console.log('tests/: no duplicate, missing or misspelled names or imports.');
}
