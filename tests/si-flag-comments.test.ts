// The flags put on fields on the SI page, as Word comments on the text the fields print: in the
// Word snapshot always, in Compile when asked. The example project's values are read from its
// files (tests/fixtures/si-example); the flags are written here.
import { beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { MemoryFolder } from '../src/si/folder';
import { SiProject } from '../src/si/project';
import { molFacts } from '../src/si/chem';
import { compileSi, type CompileHost } from '../src/si/compile-doc';
import { readScene, sceneToDoc } from '../src/io/chem-formats';
import { ACS_1996 } from '../src/style';
import { plainText } from '../src/richtext';
import { placedComments } from '../src/document/comments';
import { writeDocx, type DocxDeps } from '../src/io/docx-write';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let RDKit: any;
beforeAll(async () => { RDKit = await createRequire(import.meta.url)('@rdkit/rdkit')(); });

const ROOT = join(__dirname, 'fixtures', 'si-example');
function folder(): MemoryFolder {
  const f = new MemoryFolder('si-example');
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name !== 'README.md') f.files.set(relative(ROOT, p).split('\\').join('/'), new Uint8Array(readFileSync(p)));
    }
  };
  walk(ROOT);
  return f;
}
const stored = JSON.parse(readFileSync(join(ROOT, 'sections/s-972b3c47_synthesis-and-charac/compounds/c-26c39a99_1-phenylethan/compound.json'), 'utf8')).values;

const host: CompileHost = {
  contentsOf: (mol) => { const s = readScene('mol', mol); return s ? sceneToDoc(s, ACS_1996).doc.contents() : null; },
  sizeOf: () => null,
  facts: async (ms) => ms.map((m) => (m ? molFacts(RDKit, m) : null)),
};

async function flagged(): Promise<SiProject> {
  const p = await SiProject.open(folder());
  const c = p.compounds.find((x) => x.id === 'c-26c39a99')!;
  c.data.flags = {
    yield: { comment: 'Mass from the second batch?', by: 'Nate', at: '2026-11-20T10:00:00' },
    notes: { comment: '', by: 'Nate', at: '2026-11-21T09:30:00' },
  };
  return p;
}

describe('flags as comments', () => {
  it('puts a flag on the text its field prints, with who and what to check', async () => {
    const got = await compileSi(await flagged(), host, undefined, { flagComments: true });
    const text = plainText(got.doc.runs);
    const placed = placedComments(got.doc.runs, got.doc.comments);
    const y = placed.find((x) => x.c.text.includes('Yield'))!;
    expect(y.c.author).toBe('Nate');
    expect(y.c.text).toContain('Mass from the second batch?');
    // (the yield's own words, from the mass to the percent: "69.2 mg, 91%")
    const on = text.slice(y.start, y.end);
    expect(on).toContain(`${stored.yield.mass} ${stored.yield.mass_unit}`);
    expect(on).toContain(`${stored.yield.percent}%`);
    expect(on).not.toContain('\n');
  });

  it('puts a flag on a field that prints nothing on the compound’s name', async () => {
    const got = await compileSi(await flagged(), host, undefined, { flagComments: true });
    const placed = placedComments(got.doc.runs, got.doc.comments);
    const n = placed.find((x) => x.c.text.includes('no comment given'))!;
    expect(plainText(got.doc.runs).slice(n.start, n.end)).toBe(stored.name.text);
  });

  it('leaves them out unless asked', async () => {
    const got = await compileSi(await flagged(), host);
    expect(placedComments(got.doc.runs, got.doc.comments)).toEqual([]);
  });

  it('writes them into the Word file as comments', async () => {
    const got = await compileSi(await flagged(), host, undefined, { flagComments: true });
    // (structures as a stand-in picture: the comments are what is looked at)
    const deps: DocxDeps = { picture: async () => ({ png: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), w: 72, h: 36 }) };
    const files = unzipSync(await writeDocx({ ...got.doc, drawingStyle: { ...ACS_1996 } }, deps, 'SI'));
    const xml = strFromU8(files['word/comments.xml']);
    expect(xml).toContain('Mass from the second batch?');
    expect(xml).toContain('w:author="Nate"');
    expect(strFromU8(files['word/document.xml'])).toContain('w:commentRangeStart');
  });
});
