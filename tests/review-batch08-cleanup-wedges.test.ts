// @vitest-environment jsdom
// Review batch 08, F043: Clean Up Structure keeps a stereocentre drawn with a hollow wedge (read
// as a wedge: toward the viewer) as it keeps one drawn with a plain wedge, and a wavy wedge's
// centre keeps the order of its neighbours; Flip keeps it too, and a chain grows past it the same.
import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
import { Doc } from '../src/model';
import { toMolfile } from '../src/chem/molfile';
import { addMolfile } from '../src/io/chem-formats';
import { cleanUpOptions, cleanUpWays, turnOption } from '../src/chem/cleanup';
import { sproutDir } from '../src/chem/chemgeom';
import { Editor } from '../src/editor/editor';
import { Renderer } from '../src/render/renderer';
import { plainMeasure } from '../src/chem/reaction';

// the editor draws on the next frame; there is no canvas to draw on here
window.requestAnimationFrame = () => 0;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let RDKit: any;
beforeAll(async () => {
  RDKit = await createRequire(import.meta.url)('@rdkit/rdkit')();
}, 30000);

// L-alanine, PubChem CID 5950 (isomeric SMILES as PubChem lists it)
const L_ALANINE = 'C[C@@H](C(=O)O)N';

function pasted(smi: string): Doc {
  const m = RDKit.get_mol(smi);
  m.set_new_coords(true);
  const doc = new Doc();
  doc.bulk(() => addMolfile(doc, m.get_molblock(), 200, 200));
  m.delete();
  return doc;
}
const smilesOf = (doc: Doc) => {
  const m = RDKit.get_mol(toMolfile(doc, doc.atoms.keys()).molblock);
  try { return m.get_smiles(); } finally { m.delete(); }
};
const canonical = (smi: string) => { const m = RDKit.get_mol(smi); try { return m.get_smiles(); } finally { m.delete(); } };
/** The same drawing with every plain wedge drawn as a hollow wedge. */
const hollow = (doc: Doc) => doc.bulk(() => { for (const b of [...doc.bonds.values()]) if (b.display === 'wedge') doc.updateBond(b.id, { display: 'hollowWedge' }); });

describe('Clean Up with hollow wedges', () => {
  it('a hollow wedge is read as a wedge (the structure is still L-alanine)', () => {
    const doc = pasted(L_ALANINE);
    hollow(doc);
    expect([...doc.bonds.values()].some((b) => b.display === 'hollowWedge')).toBe(true);
    expect(smilesOf(doc)).toBe(canonical(L_ALANINE));
  });

  it('flipping a layout turns a hollow wedge over, so the molecule stays the same', () => {
    const doc = pasted(L_ALANINE);
    hollow(doc);
    const o = cleanUpOptions(doc, doc.fragments()[0])[0];
    const flipped = turnOption(o, 0, true);
    doc.bulk(() => {
      for (const [id, p] of flipped.pos) doc.updateAtom(id, { x: p.x, y: p.y });
      for (const [id, d] of flipped.displays) doc.updateBond(id, { display: d });
    });
    expect(smilesOf(doc)).toBe(canonical(L_ALANINE));
  });

  it('a stereocentre whose neighbours are drawn crowded keeps its configuration', () => {
    // the three bonds round the stereocentre squeezed into a fan on one side, in an order that
    // Clean Up would otherwise rearrange
    for (let turn = 0; turn < 12; turn++) {
      const doc = pasted(L_ALANINE);
      hollow(doc);
      const centre = [...doc.atoms.values()].find((a) => (doc.adj.get(a.id) ?? []).length === 3 && a.z === 6)!;
      const nbrs = (doc.adj.get(centre.id) ?? []).map((bid) => { const b = doc.bonds.get(bid)!; return b.a1 === centre.id ? b.a2 : b.a1; });
      const L = doc.style.bondLength;
      doc.bulk(() => nbrs.forEach((id, k) => {
        const a = doc.atoms.get(id)!;
        const t = (turn * 30 + [0, 40, 80][k] * (turn % 2 ? 1 : -1)) * Math.PI / 180;
        const dx = centre.x + Math.cos(t) * L - a.x, dy = centre.y + Math.sin(t) * L - a.y;
        // the atom moves with everything beyond it (the carboxyl's oxygens)
        doc.updateAtom(id, { x: a.x + dx, y: a.y + dy });
        for (const bid of doc.adj.get(id) ?? []) {
          const b = doc.bonds.get(bid)!;
          const o = b.a1 === id ? b.a2 : b.a1;
          if (o === centre.id) continue;
          const oa = doc.atoms.get(o)!;
          doc.updateAtom(o, { x: oa.x + dx, y: oa.y + dy });
        }
      }));
      // what the drawing now says (moving the bonds round may have changed the configuration)
      const want = smilesOf(doc);
      const w = cleanUpWays(doc, doc.fragments()[0])[0];
      doc.bulk(() => {
        for (const [id, p] of w.moves) doc.updateAtom(id, { x: p.x, y: p.y });
        for (const [id, d] of w.displays) doc.updateBond(id, { display: d });
      });
      expect(smilesOf(doc), `turn ${turn}`).toBe(want);
    }
  });

  it('a scrambled drawing cleaned up keeps a hollow-wedged centre as drawn', () => {
    // L-alanine with its atoms thrown about (a layout Clean Up has to rearrange round the centre)
    for (const seed of [5, 7, 8, 10]) {
      const doc = pasted(L_ALANINE);
      hollow(doc);
      const L = doc.style.bondLength;
      let i = 0;
      doc.bulk(() => { for (const a of [...doc.atoms.values()]) { i++; doc.updateAtom(a.id, { x: 200 + Math.sin(i * seed * 12.9898) * L * 2, y: 200 + Math.cos(i * seed * 78.233) * L * 2 }); } });
      const want = smilesOf(doc);
      const w = cleanUpWays(doc, doc.fragments()[0])[0];
      doc.bulk(() => {
        for (const [id, p] of w.moves) doc.updateAtom(id, { x: p.x, y: p.y });
        for (const [id, d] of w.displays) doc.updateBond(id, { display: d });
      });
      expect(smilesOf(doc), `seed ${seed}`).toBe(want);
    }
  });

  it('a wavy-wedged centre keeps the order of its neighbours round it', () => {
    for (const seed of Array.from({ length: 12 }, (_, k) => k + 1)) {
      const doc = pasted(L_ALANINE);
      doc.bulk(() => { for (const b of [...doc.bonds.values()]) if (b.display === 'wedge') doc.updateBond(b.id, { display: 'wavyWedge' }); });
      const L = doc.style.bondLength;
      let i = 0;
      doc.bulk(() => { for (const a of [...doc.atoms.values()]) { i++; doc.updateAtom(a.id, { x: 200 + Math.sin(i * seed * 12.9898) * L * 2, y: 200 + Math.cos(i * seed * 78.233) * L * 2 }); } });
      const centre = [...doc.bonds.values()].find((b) => b.display === 'wavyWedge')!.a1;
      const nbrs = (doc.adj.get(centre) ?? []).map((bid) => { const b = doc.bonds.get(bid)!; return b.a1 === centre ? b.a2 : b.a1; });
      // the neighbours in turn round the centre, starting from the lowest id
      const order = () => {
        const c = doc.atoms.get(centre)!;
        const ang = nbrs.map((id) => ({ id, t: Math.atan2(doc.atoms.get(id)!.y - c.y, doc.atoms.get(id)!.x - c.x) })).sort((p, q) => p.t - q.t).map((x) => x.id);
        const k = ang.indexOf(Math.min(...ang));
        return [...ang.slice(k), ...ang.slice(0, k)].join(',');
      };
      const before = order();
      const w = cleanUpWays(doc, doc.fragments()[0])[0];
      doc.bulk(() => { for (const [id, p] of w.moves) doc.updateAtom(id, { x: p.x, y: p.y }); });
      expect(order(), `seed ${seed}`).toBe(before);
    }
  });

  it('Flip with Preserve Stereochemistry turns a hollow wedge over', () => {
    const doc = pasted(L_ALANINE);
    hollow(doc);
    const scene = document.createElement('canvas'), overlay = document.createElement('canvas'), host = document.createElement('div');
    host.append(scene, overlay);
    document.body.append(host);
    const ed = new Editor(doc, new Renderer(scene, overlay), host);
    ed.paused = true;
    // (no canvas to measure labels with here)
    const m = plainMeasure(doc);
    Object.assign(ed, { measure: () => m, fullMeasure: () => m });
    ed.setTool('select');
    ed.selectAll();
    // a plain flip makes the mirror image, and says so
    expect(ed.flip('h')).toBe('stereo');
    doc.undo();
    ed.selectAll();
    expect(ed.flip('h', true)).toBe(true);
    expect(smilesOf(doc)).toBe(canonical(L_ALANINE));
  });

  it('a hollow-wedged methyl doesn\'t steer a chain, as a wedged one doesn\'t', () => {
    // C1–C2–C3 zig-zag, and a methyl on C2 wedged from C2, placed so that as a chain bond it would
    // turn the next bond from C3 the other way: drawn with either wedge, it doesn't
    const dir = (display: 'wedge' | 'hollowWedge' | 'solid') => {
      const doc = new Doc();
      const L = doc.style.bondLength;
      const c3 = doc.edit('d', () => {
        const c1 = doc.addAtom(0, 0), c2 = doc.addAtom(L * 0.866, -L / 2), c3 = doc.addAtom(L * 1.732, 0), me = doc.addAtom(L * (0.866 - Math.cos(100 * Math.PI / 180)), L * (-0.5 - Math.sin(100 * Math.PI / 180)));
        doc.addBond(c1.id, c2.id); doc.addBond(c2.id, c3.id); doc.addBond(c2.id, me.id, 1, display);
        return c3.id;
      });
      const d = sproutDir(doc, c3);
      return `${d.x.toFixed(3)},${d.y.toFixed(3)}`;
    };
    expect(dir('wedge')).not.toBe(dir('solid'));
    expect(dir('hollowWedge')).toBe(dir('wedge'));
  });
});
