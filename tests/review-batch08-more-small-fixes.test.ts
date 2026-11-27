// Review batch 08: F382 (a wavy-bond reference is named as one), F390 (CH3F has its geminal H–F
// coupling), F395 (a deuterated compound gets a density estimate), F421 (a CXSMILES is read as a
// structure, not a name).
import { describe, expect, it } from 'vitest';
import { attachName } from '../src/chem/attach-codes';
import { predictCouplings, type JGraph } from '../src/chem/nmr/coupling';
import { girolamiDensity } from '../src/chem/density';
import { molfileOrSmiles } from '../src/chem/text-molfile';

describe('more small fixes', () => {
  it('F382: the 〰 and ◆ symbols are named as attachCodesFor reads them', () => {
    expect(attachName('〰')).toBe('wavy-bond');
    expect(attachName('◆1')).toBe('numbered (1)');
  });

  it('F390: fluoromethane\'s methyl protons couple to F', () => {
    // CH3F: 2J(H,F) = 46.4 Hz (Pretsch, Bühlmann, Badertscher, Structure Determination of Organic
    // Compounds, 4th ed., Springer 2009, H–F coupling constants)
    const g: JGraph = { atoms: [{ el: 'C', arom: false, h: 3 }, { el: 'F', arom: false, h: 0 }], bonds: [{ u: 0, v: 1, o: 1 }] };
    const j = predictCouplings(g).find((c) => c.kind === 'HF-gem')?.j;
    expect(j).toBeDefined();
    expect(Math.abs(j! - 46.4)).toBeLessThan(3);
  });

  it('F395: deuterium takes hydrogen\'s volume (CDCl3 as CHCl3)', () => {
    // (one molar mass for both: only the volumes are compared)
    const none = { hydroxyl: 0, acid: 0, amine: 0, amide: 0, sulfoxide: 0, sulfone: 0, loneRings: 0, fusedRings: 0 };
    const h = girolamiDensity({ C: 1, H: 1, Cl: 3 }, 120.38, none);
    const d = girolamiDensity({ C: 1, D: 1, Cl: 3 }, 120.38, none);
    expect(h).not.toBeNull();
    expect(d).toBe(h);
  });

  it('F421: a SMILES with its |…| extras goes to the SMILES reader', async () => {
    const asked: string[] = [];
    const mb = await molfileOrSmiles('C[C@H](N)C(=O)O |&1:1|', async (s) => { asked.push(s); return 'molfile'; });
    expect(mb).toBe('molfile');
    expect(asked).toEqual(['C[C@H](N)C(=O)O |&1:1|']);
    // a name with spaces is still not a SMILES
    expect(await molfileOrSmiles('acetic acid', async () => 'molfile')).toBeNull();
  });
});
