// Regular expressions built from data (a template literal or a variable in new RegExp(...)) were the
// cause of CodeQL alerts #52, #54 and #55 to #58: a hand-escaped name that missed one dot, or
// escaping that CodeQL doesn't accept. For a name, an id or any text from a file, use a plain text
// method (startsWith, includes, indexOf, an exact-name lookup) or a regular expression written out
// as a literal. This check counts the new RegExp( calls with a built argument per file: a file may
// not gain one, and a file that loses one must lower its number below, so the list only shrinks.
// (The numbers are the calls that were there when the check began; most build from fixed pieces.)
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..');
const BUILT = /new RegExp\((?!['"/])/g;

const BASELINE: Record<string, number> = {
  'scripts/undo-audit-lists.mjs': 1,
  'src/chem/arrow-text.ts': 2,
  'src/chem/bench.ts': 4,
  'src/chem/hydrogen-count.ts': 2,
  'src/chem/nmr/check.ts': 2,
  'src/chem/qm-output.ts': 13,
  'src/chem/step-list.ts': 2,
  'src/deck/canvas-export.ts': 1,
  'src/design/dsplit.ts': 5,
  'src/document/find.ts': 1,
  'src/document/index-toa.ts': 1,
  'src/io/cdx.ts': 2,
  'src/io/cdxml.ts': 1,
  'src/io/docx-read.ts': 10,
  'src/io/docx-write.ts': 1,
  'src/io/odt.ts': 1,
  'src/io/pptx-keep.ts': 1,
  'src/io/xlsx-ole.ts': 3,
  'src/io/xlsx.ts': 1,
  'src/kb/pretty.ts': 1,
  'src/sheet/analysis-tools.ts': 2,
  'src/sheet/data-tools.ts': 1,
  'src/sheet/fn-criteria.ts': 1,
  'src/sheet/fn-text.ts': 1,
  'src/sheet/workbook.ts': 2,
  'src/si/chem-names.ts': 2,
  'src/si/chem.ts': 8,
  'src/si/chemtext.ts': 5,
  'src/si/manuscript.ts': 2,
  'src/si/ms-parse.ts': 9,
  'src/si/ms-reports.ts': 6,
  'src/si/nmr.ts': 3,
  'src/si/py.ts': 3,
  'src/si/si-import-spectra.ts': 6,
  'src/si/spectra.ts': 1,
  'src/text/chemtext.ts': 5,
  'tests/cdxml-write.test.ts': 1,
  'tests/csp.test.ts': 1,
  'tests/dashboard.test.ts': 1,
  'tests/docx-comment-parts.test.ts': 1,
  'tests/docx-comments-in-cells.test.ts': 2,
  'tests/docx-copied-drawing.test.ts': 3,
  'tests/docx-keep-bibliography.test.ts': 1,
  'tests/docx-keep-word-parts.test.ts': 4,
  'tests/docx-list-start.test.ts': 1,
  'tests/docx-named-figure-id.test.ts': 1,
  'tests/docx-native-prints.test.ts': 1,
  'tests/docx-note-space.test.ts': 1,
  'tests/exchange-review-f1.test.ts': 1,
  'tests/field-round-trip.test.ts': 1,
  'tests/format-menu-modes.test.ts': 1,
  'tests/hapto.test.ts': 1,
  'tests/kept-parts.test.ts': 1,
  'tests/label-font.test.ts': 1,
  'tests/menu-paths.test.ts': 1,
  'tests/office-alt-line-breaks.test.ts': 1,
  'tests/office-doc-props.test.ts': 1,
  'tests/office-sampler/docx-fields-notes.ts': 1,
  'tests/office-sampler/pptx-masters.ts': 2,
  'tests/office-sampler/pptx-objects.ts': 5,
  'tests/office-sampler/pptx-shapes.ts': 1,
  'tests/office-sampler/xlsx-notes.ts': 1,
  'tests/office-templates-macros.test.ts': 1,
  'tests/popup-menu-layer.test.ts': 1,
  'tests/pptx-deck-probe.test.ts': 1,
  'tests/pptx-fidelity.test.ts': 2,
  'tests/pptx-keep-text.test.ts': 1,
  'tests/pptx-picture-placeholder.test.ts': 2,
  'tests/pptx-slide-links.test.ts': 1,
  'tests/round-trip-new-objects.test.ts': 1,
  'tests/sheet-files.test.ts': 1,
  'tests/sheet-font-group.test.ts': 1,
  'tests/si-import-apply.test.ts': 1,
  'tests/stereo.test.ts': 2,
  'tests/xlsx-excel-kept.test.ts': 1,
  'tests/xlsx-features.test.ts': 2,
  'tests/xlsx-format-fidelity.test.ts': 1,
  'tests/xlsx-future-functions.test.ts': 1,
  'tests/xlsx-row-fits.test.ts': 1,};

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (n === 'node_modules' || n === 'regex-from-data-lint.test.ts') continue; // (this file's own samples)
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|mjs)$/.test(n)) out.push(p);
  }
  return out;
}

export function builtCount(code: string): number {
  let n = 0;
  for (const line of code.split('\n')) {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
    n += (line.match(BUILT) ?? []).length;
  }
  return n;
}

function current(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const dir of ['src', 'tests', 'scripts']) {
    for (const f of walk(join(ROOT, dir))) {
      const n = builtCount(readFileSync(f, 'utf8'));
      if (n) out[relative(ROOT, f).replace(/\\/g, '/')] = n;
    }
  }
  return out;
}

describe('regular expressions built from data', () => {
  it('counts only calls with a built argument', () => {
    expect(builtCount("new RegExp('a.b')\nnew RegExp(/x/, 'g')")).toBe(0);
    expect(builtCount('new RegExp(`a${x}`)\nconst r = new RegExp(name)')).toBe(2);
    expect(builtCount('// new RegExp(name)')).toBe(0);
  });

  it('no file gains one', () => {
    const now = current();
    const more = Object.entries(now).filter(([f, n]) => n > (BASELINE[f] ?? 0)).map(([f, n]) => `${f}: ${n} (was ${BASELINE[f] ?? 0})`);
    expect(more, 'use a plain text method or a regular expression literal instead of building one from data').toEqual([]);
  });

  it('the list only shrinks', () => {
    const now = current();
    const fewer = Object.entries(BASELINE).filter(([f, n]) => (now[f] ?? 0) < n).map(([f, n]) => `${f}: now ${now[f] ?? 0}, list says ${n}`);
    expect(fewer, 'lower the number (or remove the file) in BASELINE').toEqual([]);
  });
});
