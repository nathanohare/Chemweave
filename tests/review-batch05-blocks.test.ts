// Code review 2026-11-26, batch 05 (SI builder): the compound paragraphs of the compiled SI.
import { describe, expect, it } from 'vitest';
import { nmrSentence } from '../src/si/blocks';
import { italicSpans } from '../src/si/chem-names';
import { nucleusLabel } from '../src/si/fields';
import { xrayAutoCaption } from '../src/si/xray';
import { defaultView } from '../src/design/xray';

const text = (runs: { text: string }[]): string => runs.map((r) => r.text).join('');

describe('F211: a peak report typed with a superscript mass number', () => {
  // "¹H NMR (400 MHz, CDCl₃) δ …" is the form ACS's guide to Supporting Information prints
  // (The ACS Guide to Scholarly Communication, "NMR data"), typed here with Unicode superscripts.
  const report = { nucleus: '1H', text: '¹H NMR (400 MHz, CDCl₃) δ 7.35–7.25 (m, 5H).' };
  for (const helpers of [false, true]) {
    it(`keeps one header, made bold (chemistry formatting ${helpers ? 'on' : 'off'})`, () => {
      const runs = nmrSentence(report, { facts: null, helpers });
      const t = text(runs);
      expect(t.match(/NMR/g)?.length).toBe(1);
      expect(t.startsWith('¹H NMR')).toBe(true);
      expect(runs[0].bold).toBe(true);
    });
  }
  it('puts a typed label inside the parentheses', () => {
    const t = text(nmrSentence({ ...report, label: 'major' }, { facts: null, helpers: false }));
    expect(t).toContain('(400 MHz, CDCl₃, major)');
  });
});

describe('F918: stereodescriptors with lettered or primed locants', () => {
  // (IUPAC 2013 Recommendations, P-91 and P-93: locants such as 3a, 7a and 1′ before R/S)
  const italic = (name: string): string[] => italicSpans(name).map(([a, b]) => name.slice(a, b));
  it('are italicized', () => {
    expect(italic('(3aR,7aS)-hexahydro-1H-isoindole-1,3(2H)-dione')).toEqual(['R', 'S']);
    expect(italic('(1′R,2S)-2-amino-1′-ol')).toEqual(['R', 'S']);
    expect(italic('(1R,3aS)-x')).toEqual(['R', 'S']);
  });
});

describe('F922: spectrum types that begin with a digit', () => {
  it('"2D NMR" is not raised; nuclei are', () => {
    expect(nucleusLabel('2D NMR')).toBe('2D NMR');
    expect(nucleusLabel('13C')).toBe('¹³C');
    expect(nucleusLabel('19F')).toBe('¹⁹F');
  });
});

describe('F224: the automatic X-ray caption names the drawing style', () => {
  it('for each style', () => {
    const cap = (style: 'ball' | 'stick' | 'fill' | 'wire'): string => xrayAutoCaption({ ...defaultView(), style }, '', '');
    expect(cap('ball')).toBe('Molecular structure (ball-and-stick model).');
    expect(cap('stick')).toBe('Molecular structure (stick model).');
    expect(cap('fill')).toBe('Molecular structure (space-filling model).');
    expect(cap('wire')).toBe('Molecular structure (wireframe model).');
  });
});
