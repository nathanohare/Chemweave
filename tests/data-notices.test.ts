// Every data set the app ships is credited in THIRD-PARTY-NOTICES.md with its licence (G4-11): a
// new data file has to be named there before this passes.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
const notices = readFileSync(join(root, 'THIRD-PARTY-NOTICES.md'), 'utf8');
const bundled = notices.slice(notices.indexOf('## Bundled data'), notices.indexOf('## Font copyrights'));

describe('bundled data in THIRD-PARTY-NOTICES.md', () => {
  it('has a Bundled data section', () => {
    expect(notices).toContain('## Bundled data');
    expect(bundled.length).toBeGreaterThan(500);
  });

  it('names every NMR data file and every Knowledge Base data file', () => {
    const files = [
      ...readdirSync(join(root, 'public', 'nmr')).filter((f) => !/^NOTICE\.md$|-sources\.txt$/.test(f)).map((f) => `public/nmr/${f}`),
      ...readdirSync(join(root, 'src', 'kb')).filter((f) => f.endsWith('.json')).map((f) => `src/kb/${f}`),
    ];
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) expect(bundled, f).toContain(`\`${f}\``);
  });

  it('carries the notices the licences ask for', () => {
    // nmrshiftdb2 Database License, section 4.3 (its example notice) and 4.2 (the licence's address)
    const nmrshiftdb = 'Contains information from nmrshiftdb2 (www.nmrshiftdb.org), which is made available here under the nmrshiftdb2 Database License';
    const uri = 'https://nmrshiftdb.nmr.uni-koeln.de/nmrshiftdbhtml/nmrshiftdb2datalicense.txt';
    const nmrNotice = readFileSync(join(root, 'public', 'nmr', 'NOTICE.md'), 'utf8').replace(/\s+/g, ' ');
    for (const text of [bundled, nmrNotice]) {
      expect(text.replace(/\s+/g, ' ')).toContain(nmrshiftdb);
      expect(text).toContain(uri);
    }
    // NMRexp (CC BY 4.0) and the EU classification (CC BY 4.0)
    expect(bundled).toContain('Contains data from NMRexp (CC BY 4.0), DOI 10.5281/zenodo.17296666.');
    expect(bundled).toMatch(/© European Union, reused under CC BY 4\.0/);
  });
});
