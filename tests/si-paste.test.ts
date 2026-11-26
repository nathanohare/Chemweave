// @vitest-environment jsdom
// Pasting into SI pages (round 4): a spectrum copied in Mnova gets the type its compound most
// likely lacks, and text pasted from Word or Mnova keeps only bold, italics, sub- and superscripts.
import { describe, expect, it } from 'vitest';
import { guessPastedType, keptLine, pastedStem } from '../src/si/spectrum-paste';
import { cleanPastedHtml } from '../src/ui/si-paste-html';
import { SiRichBox } from '../src/ui/si-rich';
import type { SiCompound } from '../src/si/project';

const compound = (values: Record<string, unknown>): SiCompound => ({ id: 'c', folder: 'c', sectionId: 's', data: { values } } as unknown as SiCompound);

describe('pasting a spectrum', () => {
  it('guesses the type from the peak reports without a spectrum', () => {
    expect(guessPastedType(compound({}))).toBe('1H');
    const reports = [{ nucleus: '1H', text: 'δ 7.26 (s, 1H)' }, { nucleus: '13C', text: 'δ 128.4' }, { nucleus: '19F', text: '' }];
    expect(guessPastedType(compound({ nmr: reports }))).toBe('1H');
    expect(guessPastedType(compound({ nmr: reports, spectra: [{ file: 'a.pdf', type: '1H' }] }))).toBe('13C');
    expect(guessPastedType(compound({ nmr: reports, spectra: [{ file: 'a.pdf', type: '1H' }, { file: 'b.pdf', type: '13C' }] }))).toBe('Other');
  });

  it('names the stored file by its type, never the compound ID', () => {
    expect(pastedStem('1H')).toBe('pasted 1H');
    expect(pastedStem('HPLC/SFC')).toBe('pasted HPLC-SFC');
    expect(pastedStem('Other')).toBe('pasted spectrum');
    expect(keptLine('emf-picture')).toMatch(/Enhanced Windows Metafile/);
  });
});

describe('pasting formatted text', () => {
  it('keeps bold, italics, sub- and superscripts and drops the rest', () => {
    const html = '<html><head><style>p{color:red}</style></head><body><p class=MsoNormal><span style="font-family:Arial;color:blue">Yield: <b>95%</b>, CH<sub>2</sub>Cl<sub>2</sub>, <i>J</i> = 7.2 Hz, 10<sup>−3</sup> <a href="x">link</a></span></p></body></html>';
    expect(cleanPastedHtml(html, false)).toBe('Yield: <b>95%</b>, CH<sub>2</sub>Cl<sub>2</sub>, <i>J</i> = 7.2 Hz, 10<sup>−3</sup> link');
  });

  it('leaves out a bare U+FFFC (a picture or equation’s place in copied text)', () => {
    expect(cleanPastedHtml('<p>CH<sub>2</sub>\uFFFCCl<sub>2</sub> \uFFFC</p>', false)).toBe('CH<sub>2</sub>Cl<sub>2</sub>');
  });

  it('never keeps a U+FFFC in a field, whichever way it came in (Paste on the ribbon, a drop, a browser’s own paste)', () => {
    const b = new SiRichBox('', { label: (r) => r, changed: () => {} });
    b.el.innerHTML = '<p>Yield \uFFFC95%\uFFFC</p>';
    expect(b.text).toBe('Yield 95%');
  });

  it('reads styles written as CSS (Word, Mnova) and keeps lines only where asked', () => {
    const html = '<p><span style="font-weight:bold">1a</span>: δ<span style="vertical-align:super">1</span>H</p><p><span style="font-style:italic">trans</span></p>';
    expect(cleanPastedHtml(html, true)).toBe('<b>1a</b>: δ<sup>1</sup>H<br><i>trans</i>');
    expect(cleanPastedHtml(html, false)).toBe('<b>1a</b>: δ<sup>1</sup>H <i>trans</i>');
  });
});
