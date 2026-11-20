// A scheme page edited in Chemweave (SPEC §13n.4): boxes and steps added, moved and removed (to
// the Trash as SI Assistant's "scheme_box" items), structures drawn for boxes and put in the
// conditions, boxes marked as compounds, the Layout kept as differences, and structures in the
// conditions drawn over the arrow at the Layout's size (70 % to start).
import { beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { MemoryFolder } from '../src/si/folder';
import { SiProject, type Json } from '../src/si/project';
import * as E from '../src/si/scheme-edit';
import { drawScheme, SCHEME_DEFAULTS } from '../src/si/scheme-draw';
import { readScene, sceneToDoc } from '../src/io/chem-formats';
import { ACS_1996 } from '../src/style';
import type { Contents } from '../src/model';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let RDKit: any;
beforeAll(async () => { RDKit = await createRequire(import.meta.url)('@rdkit/rdkit')(); });
const molOf = (smiles: string): string => { const m = RDKit.get_mol(smiles); m.set_new_coords(); const b = m.get_molblock(); m.delete(); return b; };

const ROOT = join(__dirname, 'fixtures', 'si-example');
const SCHEME = 'sections/s-972b3c47_synthesis-and-charac/compounds/k-730d7f01_reduction-of-a';
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
const json = (f: MemoryFolder, rel: string): Json => JSON.parse(new TextDecoder().decode(f.files.get(rel)));
const contentsOf = (mol: string): Contents => { const s = readScene('mol', mol)!; return sceneToDoc(s, ACS_1996).doc.contents(); };
const trash = (f: MemoryFolder): Json[] => [...f.files.keys()].filter((k) => /^trash\/[^/]+\/entry\.json$/.test(k)).map((k) => json(f, k));

describe('editing a scheme page', () => {
  it('adds, moves and removes boxes and steps; a removed box goes to the Trash for SI Assistant to restore', async () => {
    const f = folder();
    const p = await SiProject.open(f);
    const k = p.schemes.find((x) => x.id === 'k-730d7f01')!;
    const first = E.editorData(k).starting[0];
    const added = await E.addBox(p, k, E.START);
    expect(E.editorData(k).starting.map((b) => b.id)).toEqual([first.id, added.id]);
    expect(await E.moveBox(p, k, String(added.id), -1)).toBe(true);
    expect(E.editorData(k).starting.map((b) => b.id)).toEqual([added.id, first.id]);
    expect(await E.moveBox(p, k, String(added.id), -1)).toBe(false);
    const st = await E.addStep(p, k);
    expect(E.editorData(k).steps).toHaveLength(2);
    await E.setConditions(p, k, st.id, 'top', 'Ac_{2}O, *pyridine*');
    await E.setConditionsAlign(p, k, st.id, 'bottom', 'left');
    // saved as SI Assistant reads it
    const saved = json(f, `${SCHEME}/scheme.json`);
    expect(saved.mode).toBe('editor');
    expect((saved.editor as Json).steps).toMatchObject([{}, { id: st.id, top: 'Ac_{2}O, *pyridine*', bottom: '', bottom_align: 'left' }]);
    // the first starting material's structure goes to the Trash with the box
    await E.removeBox(p, k, String(first.id));
    expect(f.files.has(`${SCHEME}/editor/b-730228e5.mol`)).toBe(false);
    const e = trash(f).find((x) => x.kind === 'scheme_box')!;
    expect(e).toMatchObject({ scheme_id: 'k-730d7f01', where: 'start', box: { id: first.id, label: '1a–f' }, files: { structure: 'b-730228e5.mol' } });
    await E.removeStep(p, k, st.id);
    expect(E.editorData(k).steps).toHaveLength(1);
  });

  it('draws a box’s structure, marks it as a compound in the box order, and unlinks it', async () => {
    const f = folder();
    const p = await SiProject.open(f);
    const k = p.schemes.find((x) => x.id === 'k-730d7f01')!;
    const b = await E.addBox(p, k, E.editorData(k).steps[0].id);
    await E.setBoxStructure(p, k, String(b.id), molOf('CC(O)c1ccccc1'));
    expect(f.files.has(`${SCHEME}/editor/${b.id}.mol`)).toBe(true);
    await E.setBoxValues(p, k, String(b.id), { label: 'S1', yield: '5%' });
    expect(E.findBox(k, String(b.id))!.box).toMatchObject({ label: 'S1', yield: '5%', structure: `editor/${b.id}.mol` });
    const first = E.editorData(k).steps[0].products[0];
    const c1 = await E.markAsCompound(p, k, String(first.id));
    const c2 = await E.markAsCompound(p, k, String(b.id));
    expect(k.children.map((c) => c.id)).toEqual([c1!.id, c2!.id]);
    expect(p.hasStructure(c2!)).toBe(true);
    expect(E.findBox(k, String(b.id))!.box.label).toBeUndefined();
    // moving the box moves its compound too (IDs follow the scheme)
    await E.moveBox(p, k, String(b.id), -1);
    expect(k.children.map((c) => c.id)).toEqual([c2!.id, c1!.id]);
    const again = await SiProject.open(f);
    expect(again.schemes.find((x) => x.id === k.id)!.children.map((c) => c.id)).toEqual([c2!.id, c1!.id]);
    await E.unlinkBox(p, k, String(b.id));
    expect(E.findBox(k, String(b.id))!.box.compound).toBeUndefined();
    expect(k.children.map((c) => c.id)).toEqual([c1!.id, c2!.id]);
  });

  it('keeps a structure for the conditions and the Layout as differences', async () => {
    const f = folder();
    const p = await SiProject.open(f);
    const k = p.schemes.find((x) => x.id === 'k-730d7f01')!;
    const sid = await E.addInlineStructure(p, k, molOf('CB1OC(c2ccccc2)(c2ccccc2)C2CCCN12'));
    expect(E.editorData(k).inline[sid]).toEqual({ structure: `editor/${sid}.mol` });
    expect(E.inlineIds(`@struct{${sid}} BH_{3}`)).toEqual([sid]);
    expect(E.layoutOf(p, k).cond_structure_pct).toBe(70);
    await E.setSchemeLayout(p, k, { ...E.layoutOf(p, k), cond_size_pt: 10 });
    expect(E.editorData(k).layout).toEqual({ cond_size_pt: 10, show_label: true });
    await E.setProjectLayout(p, { ...E.projectLayout(p), gap_mm: 3 });
    // (70 % is written for SI Assistant, whose own default is 60 %)
    expect(p.settings.schemes).toEqual({ gap_mm: 3, cond_structure_pct: 70 });
    await E.setProjectLayout(p, { ...E.projectLayout(p), gap_mm: 2, cond_structure_pct: 60 });
    expect(p.settings.schemes).toEqual({ cond_structure_pct: 60 });
  });
});

describe('structures in the conditions', () => {
  it('are drawn over the arrow’s text at the Layout’s size, and widen the arrow', () => {
    const ketone = contentsOf(molOf('CC(=O)c1ccccc1'));
    const cat = contentsOf(molOf('CB1OC(c2ccccc2)(c2ccccc2)C2CCCN12'));
    const box = { contents: ketone, label: [{ text: '1' }], yieldText: '' };
    const step = { top: [{ text: 'BH3' }], bottom: [], products: [box], topStructures: [cat] };
    const got = drawScheme([box], [step], SCHEME_DEFAULTS, 1000)!;
    const n = ketone.atoms.length;
    // the catalyst's atoms come after the first box's, smaller
    const catAtoms = got.contents.atoms.slice(n, n + cat.atoms.length);
    expect(catAtoms.every((a) => Math.abs((a.s ?? 1) - 0.7) < 1e-9)).toBe(true);
    const len = (atoms: typeof catAtoms, bonds: Contents['bonds']): number => {
      const byId = new Map(atoms.map((a) => [a.id, a]));
      const b = bonds.find((x) => byId.has(x.a1) && byId.has(x.a2))!;
      const a1 = byId.get(b.a1)!, a2 = byId.get(b.a2)!;
      return Math.hypot(a1.x - a2.x, a1.y - a2.y);
    };
    const own = got.contents.atoms.slice(0, n);
    const ratio = len(catAtoms, got.contents.bonds) / len(own, got.contents.bonds);
    expect(ratio).toBeGreaterThan(0.6);
    expect(ratio).toBeLessThan(0.8);
    // above the arrow, over its text
    const arrowY = got.contents.arrows[0].tail.y;
    const text = got.contents.captions.find((c) => c.runs.some((r) => r.text === 'BH3'))!;
    expect(Math.max(...catAtoms.map((a) => a.y))).toBeLessThan(text.y);
    expect(text.y).toBeLessThan(arrowY);
    // the arrow is at least as long as the catalyst is wide
    const w = Math.max(...catAtoms.map((a) => a.x)) - Math.min(...catAtoms.map((a) => a.x));
    const arrow = got.contents.arrows[0];
    expect(arrow.head.x - arrow.tail.x).toBeGreaterThan(w);
    // at 100 % they are as large as the scheme's structures
    const big = drawScheme([box], [step], { ...SCHEME_DEFAULTS, cond_structure_pct: 100 }, 1000)!;
    expect(big.contents.atoms[n].s ?? 1).toBe(1);
  });
});
