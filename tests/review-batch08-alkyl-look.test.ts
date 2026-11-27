// Review batch 08, F049: the alkyl look (t-Bu or tBu) changes the dash only where the label is
// still an abbreviation afterwards. Ligand abbreviations are spelled as their papers spell them
// (tBuDavePhos, ItBu, iPr-MACHO, t-Bu-Xantphos) and keep that spelling; tBu itself still follows
// the look, and so does a ligand known both ways (tBuXPhos and t-BuXPhos).
import { describe, expect, it } from 'vitest';
import { labelGraph, styleLabel } from '../src/chem/labels';

describe('alkyl look on ligand abbreviations', () => {
  it('keeps the dash as typed where the other spelling is not an abbreviation', () => {
    for (const l of ['tBuDavePhos', 'ItBu', 'iPr-MACHO', 'tBuMePhos']) {
      expect(styleLabel(l, undefined, 'dash').label, l).toBe(l);
      expect(styleLabel(l, undefined, 'both').label, l).toBe(l);
    }
    expect(styleLabel('t-Bu-Xantphos', undefined, 'plain').label).toBe('t-Bu-Xantphos');
    // still read as the ligand
    expect(labelGraph(styleLabel('tBuDavePhos', undefined, 'dash').label)).not.toBeNull();
  });

  it('still restyles plain alkyl groups and ligands known both ways', () => {
    expect(styleLabel('tBu', undefined, 'dash').label).toBe('t-Bu');
    expect(styleLabel('OtBu', undefined, 'dash').label).toBe('Ot-Bu');
    expect(styleLabel('t-Bu', undefined, 'plain').label).toBe('tBu');
    expect(styleLabel('tBuXPhos', undefined, 'dash').label).toBe('t-BuXPhos');
    // the italic mark is still applied where the dash stays
    expect(styleLabel('tBuDavePhos', undefined, 'italic').marks?.[0]).not.toBe('.');
  });
});
