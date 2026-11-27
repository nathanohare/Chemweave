// Code review 2026-11-26, batch 05 (SI builder), F936: the X-ray check keeps one result for each
// X-ray section, so a check of every section in turn never reads an unchanged CIF again, however
// many sections the project has. The CIF text is made up here (a data block with an empty
// _atom_site_ loop is no structure: the CIF 1.1 syntax, IUCr).
import { describe, expect, it, vi } from 'vitest';

const reads = vi.hoisted(() => ({ n: 0 }));
vi.mock('../src/chem/cif', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/chem/cif')>();
  return { ...real, readCif: (text: string) => { reads.n++; return real.readCif(text); } };
});

import { MemoryFolder } from '../src/si/folder';
import { SiProject, type SiSection } from '../src/si/project';
import { xrayError } from '../src/si/project-warnings';

const enc = (t: string): Uint8Array => new TextEncoder().encode(t);

describe('F936: the X-ray check with more X-ray sections than the old 64 results', () => {
  it('reads each unchanged CIF once, and a changed one again', async () => {
    const f = new MemoryFolder('xr');
    const p = await SiProject.create(f, 'X');
    const sections: SiSection[] = [];
    for (let i = 0; i < 70; i++) {
      const folder = `sections/s-x${i}`;
      f.files.set(`${folder}/c.cif`, enc(`data_x${i}\n_cell_length_a 5\n`));
      sections.push({ id: `s-x${i}`, type: 'xray', name: `X${i}`, folder, data: { file: 'c.cif' }, items: [], children: [], parentId: null } as unknown as SiSection);
    }
    for (const s of sections) expect(await xrayError(p, s)).toMatch(/holds no structure/);
    expect(reads.n).toBe(70);
    for (const s of sections) await xrayError(p, s);
    expect(reads.n).toBe(70);
    f.files.set('sections/s-x3/c.cif', enc('data_y\n_cell_length_a 6\n'));
    await xrayError(p, sections[3]);
    expect(reads.n).toBe(71);
  });
});
