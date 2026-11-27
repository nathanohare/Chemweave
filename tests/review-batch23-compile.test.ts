// Review batch 23, round 2: a spectrum PDF with a page that can't be drawn, compiled into the SI.
// On the example project (made by hand for the tests, tests/fixtures/si-example). No chemistry values.
import { beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { MemoryFolder } from '../src/si/folder';
import { SiProject, type Json } from '../src/si/project';
import { molFacts } from '../src/si/chem';
import { compileSi, type CompileHost, type PagePicture } from '../src/si/compile-doc';
import { readScene, sceneToDoc } from '../src/io/chem-formats';
import { ACS_1996 } from '../src/style';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let RDKit: any;
beforeAll(async () => { RDKit = await createRequire(import.meta.url)('@rdkit/rdkit')(); });

function folder(): MemoryFolder {
  const root = join(__dirname, 'fixtures', 'si-example');
  const f = new MemoryFolder('si-example');
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name !== 'README.md') f.files.set(relative(root, p).split('\\').join('/'), new Uint8Array(readFileSync(p)));
    }
  };
  walk(root);
  return f;
}
const C2A = 'sections/s-972b3c47_synthesis-and-charac/compounds/c-26c39a99_1-phenylethan';

/** Three pages of 792 × 612 points; the second could not be drawn (as pdfPages marks it). */
const pages: PagePicture[] = [
  { src: 'data:image/png;base64,AAAA', w: 792, h: 612, of: 3 },
  { src: 'data:image/svg+xml;charset=utf-8,FAILED', w: 792, h: 612, of: 3, failed: true },
  { src: 'data:image/png;base64,CCCC', w: 792, h: 612, of: 3 },
];
const host = (): CompileHost => ({
  contentsOf: (mol) => { const s = readScene('mol', mol); return s ? sceneToDoc(s, ACS_1996).doc.contents() : null; },
  sizeOf: () => ({ w: 108, h: 79.2 }),
  facts: async (mols) => mols.map((m) => (m ? molFacts(RDKit, m) : null)),
  pdfPages: async () => pages,
});

describe('F894: a spectrum PDF page that could not be drawn', () => {
  it('keeps its place, so the pages after it keep their numbers, and is noted', async () => {
    const f = folder();
    const cj = JSON.parse(new TextDecoder().decode(f.files.get(`${C2A}/compound.json`))) as Json;
    (cj.values as Json).spectra = [{ file: '2a_1H.pdf', type: '1H', title: '', struct_caption: '' }];
    f.files.set(`${C2A}/compound.json`, new TextEncoder().encode(JSON.stringify(cj)));
    f.files.set(`${C2A}/spectra/2a_1H.pdf`, new Uint8Array([37, 80, 68, 70]));
    const p = await SiProject.open(f);
    const got = await compileSi(p, host());
    expect(got.notes.some((n) => n.includes('page 2 of 2a_1H.pdf could not be drawn'))).toBe(true);
    // the three pages in their order: the drawn first, the box saying page 2 failed, the drawn third
    const text = JSON.stringify(got.doc);
    const at = ['AAAA', 'FAILED', 'CCCC'].map((s) => text.indexOf(s));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });
});
