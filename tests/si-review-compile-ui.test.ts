// @vitest-environment jsdom
// A compound's spectra page keeps the spectrum files it has drawn, for each project open, by the
// file's path and its bytes: a file replaced under the same name is drawn again, and one that
// couldn't be read is read again next time.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { MemoryFolder } from '../src/si/folder';
import { SiProject } from '../src/si/project';
import { SiSpectraPage } from '../src/ui/si-spectra';

const ROOT = join(__dirname, 'fixtures', 'si-example');
function fixture(): MemoryFolder {
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
/** A PNG's first bytes for a picture of w × h pixels (enough to know its size). */
function png(w: number, h: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const dv = new DataView(b.buffer);
  dv.setUint32(16, w); dv.setUint32(20, h);
  b[24] = 8; b[25] = 2;
  return b;
}
type Entry = { aspect: number; src: string | null };
async function shown(p: SiProject, pdfCalls: { n: number }): Promise<Entry[]> {
  const page = new SiSpectraPage({
    project: p, compound: p.compounds[0], section: null, flash: () => {}, idOf: () => '2a', contentsOf: () => null, sizeOf: () => null, pictureOf: () => null,
    pdfPages: async () => { pdfCalls.n++; return [{ src: 'data:image/png;base64,AAAA', w: 612, h: 792 }]; }, contentBox: async () => null, act: async (f) => { await f(); }, chosen: () => {}, openSection: () => {},
  });
  const entries = (): Entry[] => (page as unknown as { entries: Entry[] }).entries;
  for (let i = 0; i < 100 && !entries().length; i++) await new Promise((r) => setTimeout(r, 5));
  return entries();
}

describe('the spectra page’s drawn files', () => {
  it('draws a file again when it is replaced under the same name, and keeps one that is unchanged', async () => {
    const f = fixture();
    const p = await SiProject.open(f);
    const c = p.compounds[0];
    const spectra = (c.data.values as { spectra: Record<string, unknown>[] }).spectra;
    spectra.splice(0, spectra.length, { file: 'scan.png', type: '1H' }, { file: 'scan.pdf', type: '13C' });
    const calls = { n: 0 };
    // missing at first: said, and not kept
    expect((await shown(p, calls))[0].src).toBeNull();
    f.files.set(`${c.folder}/spectra/scan.png`, png(100, 100));
    f.files.set(`${c.folder}/spectra/scan.pdf`, new Uint8Array([37, 80, 68, 70, 1]));
    const first = await shown(p, calls);
    expect(first[0].aspect).toBeCloseTo(1);
    expect(calls.n).toBe(1);
    // the same files: the PDF isn't drawn again
    await shown(p, calls);
    expect(calls.n).toBe(1);
    // replaced under the same names
    f.files.set(`${c.folder}/spectra/scan.png`, png(100, 300));
    f.files.set(`${c.folder}/spectra/scan.pdf`, new Uint8Array([37, 80, 68, 70, 2]));
    const second = await shown(p, calls);
    expect(second[0].aspect).toBeCloseTo(3);
    expect(calls.n).toBe(2);
  });
});
