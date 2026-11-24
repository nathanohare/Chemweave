// Runs a command that talks to an outside service (signing, notarization, an upload, a push) and
// tries again when it fails, for the workflows in .github/workflows. Usage:
//   node scripts/retry.mjs [--waits 15,45,90] -- <command> [arguments...]
//
// Outside services refuse a single request now and then (Azure signing on 2026-11-22 and
// 2026-11-24). A step that gives up on the first refusal fails a build that a re-run would pass,
// and only on main, where nobody is watching. So this runs the command, lets everything it prints
// through to the log (the service's own error included), and tries again after each pause in
// --waits (seconds; default 15, 45 and 90, so four tries in all). It stops with the command's
// last exit code, and at once when the command can't be started or is killed by a signal (a
// timeout or a cancelled job), since trying again can't help then. tests/ci-workflows.test.ts checks that the workflows use it for such steps.
//
// Only Node's own modules, so it also runs in jobs that skip `npm ci`.
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function parseArgs(argv) {
  let waits = [15, 45, 90];
  let i = 0;
  for (; i < argv.length && argv[i] !== '--'; i++) {
    if (argv[i] === '--waits' && i + 1 < argv.length) {
      const list = argv[++i].split(',').map((s) => Number(s.trim()));
      if (!argv[i].trim() || list.some((n) => !Number.isFinite(n) || n < 0)) throw new Error(`--waits takes seconds, such as 15,45,90 (got "${argv[i]}")`);
      waits = list;
    } else {
      throw new Error(`unknown option "${argv[i]}" (put the command after --)`);
    }
  }
  const command = argv.slice(i + 1);
  if (i >= argv.length || command.length === 0) throw new Error('no command after --');
  return { waits, command };
}

const sleep = (s) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, s * 1000);

export function run(command, waits, { say = (t) => console.error(t), pause = sleep } = {}) {
  const tries = waits.length + 1;
  const name = command[0];
  let status = 1;
  for (let i = 0; i < tries; i++) {
    if (i > 0) {
      say(`retry.mjs: waiting ${waits[i - 1]} s before trying "${name}" again`);
      pause(waits[i - 1]);
      say(`retry.mjs: try ${i + 1} of ${tries}`);
    }
    // no shell, so arguments arrive exactly as written (a .cmd file on Windows needs `cmd /c`)
    const r = spawnSync(name, command.slice(1), { stdio: 'inherit' });
    if (r.error) {
      say(`retry.mjs: could not start "${name}": ${r.error.message}`);
      return 127;
    }
    if (r.signal) {
      say(`retry.mjs: "${name}" was stopped by ${r.signal}; not trying again`);
      return 1;
    }
    status = r.status ?? 1;
    if (status === 0) return 0;
    say(`retry.mjs: "${name}" stopped with exit code ${status}`);
  }
  say(`retry.mjs: "${name}" failed ${tries} times; its own messages are above`);
  return status;
}

// run as a script (not imported by the test); realpath, so a path through a link still counts
const isMain = () => { try { return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href; } catch { return false; } };
if (process.argv[1] && isMain()) {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`retry.mjs: ${e.message}\nusage: node scripts/retry.mjs [--waits 15,45,90] -- <command> [arguments...]`);
    process.exit(2);
  }
  process.exit(run(parsed.command, parsed.waits));
}
