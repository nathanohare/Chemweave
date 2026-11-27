// Review batch 08, F049: the alkyl look (t-Bu or tBu) changes the dash only where the label is
// still an abbreviation afterwards. Ligand abbreviations are spelled as their papers spell them
// (tBuDavePhos, ItBu, iPr-MACHO, t-Bu-Xantphos) and keep that spelling; tBu itself still follows
// the look, and so does a ligand known both ways (tBuXPhos and t-BuXPhos), and so does any label
// whose other spelling reads as the same group (CO2tBu and CO2t-Bu, PnBu3 and Pn-Bu3).
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

  it('follows the look wherever the other spelling reads as the same group', () => {
    const dash: [string, string][] = [['CO2tBu', 'CO2t-Bu'], ['PnBu3', 'Pn-Bu3'], ['PiPr3', 'Pi-Pr3'], ['tBu3P', 't-Bu3P'], ['CNtBu', 'CNt-Bu'], ['P(OiPr)3', 'P(Oi-Pr)3'], ['PAd2nBu', 'PAd2n-Bu']];
    for (const [l, want] of dash) expect(styleLabel(l, undefined, 'dash').label, l).toBe(want);
    const plain: [string, string][] = [['P(t-Bu)3', 'P(tBu)3'], ['P(i-Pr)3', 'P(iPr)3'], ['P(n-Bu)3', 'P(nBu)3'], ['P(t-Bu)2Me', 'P(tBu)2Me'], ['P(t-Bu)2Ph', 'P(tBu)2Ph']];
    for (const [l, want] of plain) expect(styleLabel(l, undefined, 'plain').label, l).toBe(want);
    // and the restyled label is still read as the same group: the same atoms, and as many bonds
    const formula = (l: string) => { const g = labelGraph(l)!; return [g.atoms.map((a) => a.z).sort((x, y) => x - y).join(' '), g.bonds.length]; };
    for (const [l, want] of [...dash, ...plain]) expect(formula(want), l).toEqual(formula(l));
  });
});
