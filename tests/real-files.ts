// Suites that compare with files saved by ChemDraw or PowerPoint. Those files can't be in the
// repository (CONTRIBUTING: nothing made by a commercial program; #600), so the suites run only
// where a private copy is named (CHEM_TEST_FILES, CHEM_TEST_PPTX, CHEMDRAW_FIXTURES) and are
// skipped elsewhere, in CI too. A skip is not silent: each skipped suite says so when it loads,
// and the run ends with a count of them (tests/setup/real-files-summary.ts). Run them on the
// laptop with the files at each checkpoint (laptop check G4-16).
import { inject } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

declare module 'vitest' {
  export interface ProvidedContext { realFilesSkipped: string }
}

/**
 * Note whether a real-file suite runs here: `missing` true when its files aren't here, so it is
 * skipped. Returns `missing`, for describe.skipIf / it.skipIf. `files` says what to set to run it.
 */
export function realFilesMissing(suite: string, missing: boolean, files: string): boolean {
  if (!missing) return false;
  console.warn(`Skipped: ${suite} (needs the private real files; set ${files} to run it).`);
  let dir = '';
  try { dir = inject('realFilesSkipped'); } catch { dir = ''; }
  if (dir) try { writeFileSync(join(dir, suite.replace(/[^\w.-]+/g, '_')), `${suite}\t${files}\n`); } catch { /* (the count is only a report) */ }
  return true;
}
