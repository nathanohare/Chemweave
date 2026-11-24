// Signs one Windows file with Azure Artifact Signing, for Tauri's signCommand on the Windows
// build (.github/workflows/desktop.yml). Usage:
//   node scripts/sign-windows.mjs <endpoint> <account> <profile> <file>
//
// Azure's signing service now and then refuses a single request (2026-11-22 and 2026-11-24), and
// Tauri shows only "failed to run artifact-signing-cli" without the tool's own message. So this
// tries up to four times with a pause between tries, and writes everything the tool says to the
// log (stderr, and signing.log in the runner's temp folder, which the workflow prints if the
// build fails).
import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';

const [endpoint, account, profile, file] = process.argv.slice(2);
if (!endpoint || !account || !profile || !file) {
  console.error('usage: node scripts/sign-windows.mjs <endpoint> <account> <profile> <file>');
  process.exit(2);
}

const logFile = join(process.env.RUNNER_TEMP || '.', 'signing.log');
const log = (text) => {
  process.stderr.write(text.endsWith('\n') ? text : text + '\n');
  try { appendFileSync(logFile, text.endsWith('\n') ? text : text + '\n'); } catch { /* log only */ }
};

const args = ['-e', endpoint, '-a', account, '-c', profile, '-d', 'Chemweave', file];
const waits = [0, 15, 45, 90]; // seconds before each try
for (let i = 0; i < waits.length; i++) {
  if (waits[i]) {
    log(`Waiting ${waits[i]} s before trying again`);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, waits[i] * 1000);
  }
  log(`Signing ${file} (try ${i + 1} of ${waits.length})`);
  const run = spawnSync('artifact-signing-cli', args, { encoding: 'utf8', shell: false });
  if (run.stdout) log(run.stdout);
  if (run.stderr) log(run.stderr);
  if (run.error) log(`Could not start artifact-signing-cli: ${run.error.message}`);
  if (run.status === 0) process.exit(0);
  log(`artifact-signing-cli stopped with exit code ${run.status ?? 'none'}`);
}
log(`Signing ${file} failed ${waits.length} times`);
process.exit(1);
