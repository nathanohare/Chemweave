// Moving compounds into and out of scheme pages: SI Assistant's own tests of it
// (tests/test_scheme_pages.py and test_scheme_editor.py), on the same made-up projects.

import { describe, expect, it } from 'vitest';
import { MemoryFolder } from '../src/si/folder';
import { SiProject, compoundName, compoundsOf, valuesOf, type SiSection } from '../src/si/project';
import { listTrash, restoreFromTrash } from '../src/si/trash';
import { allBoxes, boxMol, editorData, findBox, markAsCompound, setBoxStructure } from '../src/si/scheme-edit';

const MOL = (atoms: string): string => {
  // a chain of carbons (and an O last when asked), as a molfile
  const els = atoms.split('');
  const lines = ['', '  test', '', `${String(els.length).padStart(3)}${String(els.length - 1).padStart(3)}  0  0  0  0  0  0  0  0999 V2000`];
  els.forEach((e, i) => lines.push(`${(i * 1.5).toFixed(4).padStart(10)}    0.0000    0.0000 ${e.padEnd(3)} 0  0  0  0  0  0  0  0  0  0  0  0`));
  for (let i = 1; i < els.length; i++) lines.push(`${String(i).padStart(3)}${String(i + 1).padStart(3)}  1  0`);
  lines.push('M  END');
  return lines.join('\n');
};

async function project(): Promise<[SiProject, SiSection]> {
  const p = await SiProject.create(new MemoryFolder('P'), 'P');
  const s = await p.addSection('data', 'Products');
  await p.setIdTable(s.id, ['3a', '3b', '3c', '3d', '3e']);
  return [p, s];
}
const names = (cs: { data: unknown }[]): string[] => cs.map((c) => compoundName(c as never));
const shown = (p: SiProject, s: SiSection): string[] => { const r = p.idReport(); return compoundsOf(p.section(s.id)).map((c) => r.ids.get(c.id) ?? ''); };

describe('Scheme pages: moving compounds in and out', () => {
  it('moves compounds into and out of a scheme page (no folder moves in one section)', async () => {
    const [p, s] = await project();
    const a = await p.addCompound(s.id, undefined, 'A');
    const k = await p.addScheme(s.id);
    const b = await p.addSchemeCompound(k, 0, 'B');
    const folderA = a.folder;
    await p.moveCompound(a.id, s.id, 1, k.id);                 // into the scheme, after B
    expect(names(k.children)).toEqual(['B', 'A']);
    expect(a.folder).toBe(folderA);
    expect(a.schemeId).toBe(k.id);
    await p.moveCompound(b.id, s.id, 0);                        // out, to the top
    expect(names(compoundsOf(p.section(s.id)))).toEqual(['B', 'A']);
    expect(b.schemeId).toBeNull();
    const r = await SiProject.open(p.folder);
    expect(names(compoundsOf(r.section(s.id)))).toEqual(['B', 'A']);
    expect(r.compound(a.id).schemeId).toBe(k.id);
  });

  it('moves a scheme page’s compound to another section', async () => {
    const [p, s] = await project();
    const other = await p.addSection('data', 'Derivatives');
    const k = await p.addScheme(s.id);
    const b = await p.addSchemeCompound(k, 0, 'B');
    await p.moveCompound(b.id, other.id, 0);
    expect(k.children).toEqual([]);
    expect(b.folder.startsWith(`${other.folder}/compounds/`)).toBe(true);
    const r = await SiProject.open(p.folder);
    expect(names(compoundsOf(r.section(other.id)))).toEqual(['B']);
    expect(await r.folder.exists(`${r.compound(b.id).folder}/compound.json`)).toBe(true);
  });

  it('changes a compound page to a reaction scheme (numbering unchanged)', async () => {
    const [p, s] = await project();
    await p.addCompound(s.id, undefined, 'A');
    const b = await p.addCompound(s.id, undefined, 'B');
    await p.setStructure(b, MOL('CCO'));
    const k = await p.convertToScheme(b.id);
    expect(p.section(s.id).items[1]).toBe(k);
    expect(k.children).toEqual([b]);
    expect(k.data.name).toBe('Scheme: B');
    expect(k.data.mode).toBe('editor');
    const product = editorData(k).steps[0].products[0];
    expect(product.compound).toBe(b.id);
    expect(await boxMol(p, k, product)).toContain('M  END');
    expect(shown(p, s)).toEqual(['3a', '3b']);
    await expect(p.convertToScheme(b.id)).rejects.toThrow(/already part of a scheme page/);
  });

  it('deletes a scheme page’s compound and restores it into the scheme', async () => {
    const [p, s] = await project();
    const k = await p.addScheme(s.id);
    await p.addSchemeCompound(k, 0, 'B');
    await p.addSchemeCompound(k, 1, 'C');
    await p.deleteCompound(k.children[0].id);
    expect(names(k.children)).toEqual(['C']);
    const [entry] = await listTrash(p);
    expect(entry.info.scheme_id).toBe(k.id);
    await restoreFromTrash(p, entry.id);
    expect(names(p.scheme(k.id).children)).toEqual(['B', 'C']);
  });

  it('leaves the structure (and picture) in the box when a compound is deleted or moved out', async () => {
    const [p, s] = await project();
    const k = await p.addScheme(s.id);
    let box = editorData(k).steps[0].products[0];
    await setBoxStructure(p, k, String(box.id), MOL('CCCO'));
    let c = (await markAsCompound(p, k, String(box.id)))!;
    // a picture of its structure (as SI Assistant keeps a pasted ChemDraw picture), its original beside it
    await p.folder.writeBytes(`${c.folder}/structure_image.svg`, new TextEncoder().encode('<svg/>'));
    await p.folder.writeBytes(`${c.folder}/structure_image.emf`, new Uint8Array([1, 2, 3]));
    valuesOf(c).structure = { image_override: 'structure_image.svg', image_source: 'chemdraw' };
    await p.saveCompound(c);
    await p.deleteCompound(c.id);
    box = findBox(k, String(box.id))!.box;
    expect(box.compound).toBeUndefined();
    expect(await boxMol(p, k, box)).toContain('M  END');            // (a copy: the scheme still shows it)
    expect(String(box.picture)).toMatch(/^editor\/.*\.svg$/);
    expect(await p.folder.exists(`${k.folder}/${String(box.picture).replace(/\.svg$/, '.emf')}`)).toBe(true);
    // moved out of the scheme: the same
    c = (await markAsCompound(p, k, String(box.id)))!;
    await p.moveCompound(c.id, s.id, 0);
    expect(findBox(k, String(box.id))!.box.compound).toBeUndefined();
    expect(k.children).toEqual([]);
    const r = await SiProject.open(p.folder);
    expect(allBoxes(r.scheme(k.id)).some(([b]) => b.compound)).toBe(false);
  });

  it('keeps a scheme page’s compounds in the order of their boxes', async () => {
    const [p, s] = await project();
    const k = await p.addScheme(s.id);
    const first = editorData(k).steps[0].products[0];
    await setBoxStructure(p, k, String(first.id), MOL('CO'));
    const linked = (await markAsCompound(p, k, String(first.id), 'drawn'))!;
    const loose = await p.addCompound(s.id, undefined, 'loose');
    await p.moveCompound(loose.id, s.id, 0, k.id);                // asked for first: boxes win
    expect(names(k.children)).toEqual(['drawn', 'loose']);
    expect(p.position(linked)).toEqual([s.id, k.id, 0]);
  });
});
