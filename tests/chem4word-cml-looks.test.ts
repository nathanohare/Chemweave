// @vitest-environment jsdom
//
// Chem4Word CML (audit G1-18): radicals as the CML schema's spinMultiplicity (xml-cml.org schema:
// 2 a doublet, 3 a triplet) and bond looks CML has no mark for, kept in an attribute of ours. The
// structures are made up here: a methyl radical with a hollow-wedge and a hashed bond.

import { describe, it, expect } from 'vitest';
import { readCml, writeCml } from '../src/io/cml';
import type { Contents } from '../src/model';

function sample(): Contents {
  return {
    atoms: [
      { id: 1, x: 0, y: 0, z: 6, label: null, charge: 0, isotope: 0, just: 'auto', radical: 'doublet' },
      { id: 2, x: 14, y: 0, z: 6, label: null, charge: 0, isotope: 0, just: 'auto' },
      { id: 3, x: 28, y: 0, z: 8, label: null, charge: 0, isotope: 0, just: 'auto' },
      { id: 4, x: 14, y: 14, z: 6, label: null, charge: 0, isotope: 0, just: 'auto', radical: 'triplet' },
    ],
    bonds: [
      { id: 5, a1: 1, a2: 2, order: 1, display: 'hollowWedge', dpos: 'auto' },
      { id: 6, a1: 2, a2: 3, order: 1, display: 'hash', dpos: 'auto' },
      { id: 7, a1: 2, a2: 4, order: 1, display: 'wedge', dpos: 'auto' },
    ],
    captions: [], arrows: [], shapes: [],
  } as unknown as Contents;
}

describe('Chem4Word CML', () => {
  it('writes radicals as spinMultiplicity and reads them back', () => {
    const text = writeCml(sample(), 'g');
    expect(text).toContain('spinMultiplicity="2"');
    expect(text).toContain('spinMultiplicity="3"');
    const back = readCml(text)!;
    expect(back.atoms.map((a) => a.radical ?? null)).toEqual(['doublet', null, null, 'triplet']);
  });
  it('keeps a hollow wedge (a wedge to Chem4Word) and a hashed bond (no mark) through a save', () => {
    const text = writeCml(sample(), 'g');
    expect(text).toMatch(/c4w:display="hollowWedge"[^>]*><cml:bondStereo>W</);
    const back = readCml(text)!;
    expect(back.bonds.map((b) => b.display)).toEqual(['hollowWedge', 'hash', 'wedge']);
  });
  it('takes the stereo mark when it was changed in Chem4Word', () => {
    const text = writeCml(sample(), 'g').replace('<cml:bondStereo>W</cml:bondStereo></cml:bond><cml:bond', '<cml:bondStereo>H</cml:bondStereo></cml:bond><cml:bond');
    expect(readCml(text)!.bonds[0].display).toBe('hashWedge');
  });
});
