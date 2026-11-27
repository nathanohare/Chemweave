// Deleting one of a torsion chart's own arrows (a dashed barrier arrow, or an axis) is one
// undoable step: refitTorsion runs in doc.beforeCommit and must skip arrows that this edit removed
// (they are in `before` but no longer in doc.arrows) rather than throw and leave the edit open.
// The chart is drawn from butane's MMFF scan, made in the test as tests/torsion-chart.test.ts does;
// no energies are checked here.

import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
import { Resources } from 'openchemlib';
import { Doc } from '../src/model';
import { toMolfile } from '../src/chem/molfile';
import { addMolfile } from '../src/io/chem-formats';
import { searchModel } from '../src/chem/model3d-build';
import { scanTorsion } from '../src/chem/torsion-scan';
import { extrema, fitProfile } from '../src/chem/torsion-profile';
import { newmanView, norm360, torsion } from '../src/chem/newman';
import { putTorsion, refitTorsion, type TorsionData } from '../src/design/torsion';
import { NEWMAN_LOOK } from '../src/design/newman';
import { plainMeasure } from '../src/chem/reaction';

let butane: TorsionData;

beforeAll(async () => {
  const RDKit = await createRequire(import.meta.url)('@rdkit/rdkit')();
  Resources.registerFromNodejs();
  const m = RDKit.get_mol('CCCC');
  const doc = new Doc();
  doc.bulk(() => addMolfile(doc, m.get_molblock(), 200, 200));
  m.delete();
  const ex = toMolfile(doc, doc.atoms.keys());
  const model = searchModel(ex.molblock, { starts: 30, window: 6, rmsd: 0.3 })!;
  const xyz0 = model.conformers[0].xyz;
  const scan = scanTorsion(ex.molblock, xyz0, [0, 1, 2, 3], { step: 15 })!;
  const points = scan.points.map((p) => ({ phi: p.phi, energy: p.energy }));
  const profile = fitProfile(points);
  const view = newmanView(model, xyz0, 1, 2);
  butane = {
    profile, extrema: extrema(profile), front: view.front, back: view.back, phi0: norm360(torsion(xyz0, 0, 1, 2, 3)),
    unit: 'kcal/mol', insets: 'minima', names: 'textbook', barriers: true, barrierColor: '#1a56db', digits: 1,
    w: 26 * 14.4, h: 8 * 14.4, method: 'MMFF94s+', look: structuredClone(NEWMAN_LOOK), sawhorse: false, points,
  };
}, 120000);

describe('deleting a torsion chart’s arrow', () => {
  const chart = () => {
    const doc = new Doc();
    const m = plainMeasure(doc);
    doc.beforeCommit = (before) => refitTorsion(doc, m, before);
    let id = 0;
    doc.edit('Chart', () => { id = putTorsion(doc, m, butane, { x: 100, y: 200 }); });
    return { doc, frame: doc.shapes.get(id)!.frame! };
  };

  it('deletes a barrier arrow in one undoable step', () => {
    const { doc, frame } = chart();
    const barrier = frame.arrows.find((a) => { const r = doc.arrows.get(a)!; return r.line === 'dashed' && r.color === '#1a56db'; })!;
    expect(barrier).toBeDefined();
    expect(() => doc.edit('Delete', () => doc.removeArrow(barrier))).not.toThrow();
    expect(doc.arrows.has(barrier)).toBe(false);
    expect(doc.undoLabel).toBe('Delete');
    doc.undo();
    expect(doc.arrows.has(barrier)).toBe(true);
    expect(doc.undoLabel).toBe('Chart');
  });

  it('deletes an axis in one undoable step', () => {
    const { doc, frame } = chart();
    const axis = frame.arrows.find((a) => { const r = doc.arrows.get(a)!; return r.line === 'solid' && r.headStyle !== 'none'; })!;
    expect(axis).toBeDefined();
    expect(() => doc.edit('Delete', () => doc.removeArrow(axis))).not.toThrow();
    expect(doc.undoLabel).toBe('Delete');
    doc.undo();
    expect(doc.arrows.has(axis)).toBe(true);
  });
});
