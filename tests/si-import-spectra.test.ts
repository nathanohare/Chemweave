// @vitest-environment jsdom
// Import SI, spectra: SI Assistant's own tests of it (tests/test_si_import_spectra.py), on the same
// made-up spectra: EMF pictures written like Mnova's (an axis, peak labels turned by 90°, a
// title), and the Word files its tests build from them (recorded: 4a and 4b, then their spectra).

import { beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as Rd from '../src/si/si-import-read';
import * as I from '../src/si/si-import';
import * as S from '../src/si/si-import-spectra';
import { applyPlan } from '../src/si/si-import-apply';
import { assignStructures, type StructureTools } from '../src/si/si-import-structures';
import { molFacts } from '../src/si/chem';
import { readCdxml } from '../src/io/cdxml';
import { toMolfile } from '../src/chem/molfile';
import { MemoryFolder } from '../src/si/folder';
import { SiProject, valuesOf, type Json } from '../src/si/project';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let RDKit: any;
beforeAll(async () => { RDKit = await createRequire(import.meta.url)('@rdkit/rdkit')(); });

const tools: StructureTools = {
  facts: async (ms) => ms.map((m) => molFacts(RDKit, m)),
  molfileOf: (cdxml) => {
    const { doc } = readCdxml(cdxml);
    if (!doc.atoms.size) return null;
    const m = toMolfile(doc, doc.atoms.keys());
    return m.unknownLabels.length ? null : m.molblock;
  },
};

// ---------------------------------------------------------------------- EMF pictures (as SI Assistant's tests write them)

/** An EMF writing `texts` ([x, y, escapement in tenths of a degree, text]) as EMR_EXTTEXTOUTW records, each with a font of that escapement. */
function emf(texts: [number, number, number, string][]): Uint8Array {
  const recs: number[][] = [];
  const u32 = (...v: number[]): number[] => v.flatMap((x) => [x & 255, (x >>> 8) & 255, (x >>> 16) & 255, (x >>> 24) & 255]);
  const f32 = (x: number): number[] => { const b = new Uint8Array(new Float32Array([x]).buffer); return [...b]; };
  const zeros = (n: number): number[] => new Array(n).fill(0);
  recs.push([...u32(1, 88), ...zeros(32), ...[32, 69, 77, 70], ...zeros(44)]);
  const fonts = new Map<number, number>();
  for (const [x, y, esc, text] of texts) {
    if (!fonts.has(esc)) {
      const handle = fonts.size + 1;
      fonts.set(esc, handle);
      const face = [...'Arial'].flatMap((c) => [c.charCodeAt(0), 0]);
      const logfont = [...u32(-12, 0, esc, esc, 400), ...zeros(8), ...face, ...zeros(64 - face.length)];
      recs.push([...u32(82, 12 + logfont.length, handle), ...logfont]);
    }
    recs.push(u32(37, 12, fonts.get(esc)!));
    let raw = [...text].flatMap((c) => [c.charCodeAt(0) & 255, c.charCodeAt(0) >> 8]);
    raw = [...raw, ...zeros((4 - (raw.length % 4)) % 4)];
    const body = [...zeros(16), ...u32(1), ...f32(1), ...f32(1), ...u32(x, y, text.length, 76, 0), ...zeros(16), ...u32(0)];
    recs.push([...u32(84, 8 + body.length + raw.length), ...body, ...raw]);
  }
  recs.push(u32(14, 20, 0, 0, 20));
  return new Uint8Array(recs.flat());
}

function spectrumEmf(axis: string[], peaks: string[], title = ''): Uint8Array {
  const texts: [number, number, number, string][] = axis.map((v, k) => [100 + 60 * k, 900, 0, v]);
  texts.push([100 + 60 * axis.length, 900, 0, 'ppm']);
  peaks.forEach((label, k) => [...label].forEach((ch, i) => texts.push([120 + 40 * k, 200 - 10 * i, 900, ch])));
  if (title) texts.push([300, 50, 0, title]);
  return emf(texts);
}

const headerEmf = (cid: string, title: string): Uint8Array => emf([[10, 10, 0, 'O'], [30, 40, 0, 'Me'], [20, 80, 0, cid], [100, 20, 0, title]]);

const C13_AXIS = Array.from({ length: 11 }, (_, k) => String(20 * k));
const H1_AXIS = Array.from({ length: 11 }, (_, k) => k.toFixed(1));

describe('Import SI: spectra', () => {
  it('reads the peak labels and axis of a spectrum picture', () => {
    const data = spectrumEmf(C13_AXIS, ['128.50', '77.16', '21.30']);
    expect(S.emfPeaks(data)).toEqual([128.5, 77.16, 21.3]);
    expect(S.typeOfEmf(data)[0]).toBe('13C');
    expect(S.typeOfEmf(spectrumEmf(H1_AXIS, ['7.26', '2.35']))[0]).toBe('1H');
    expect(S.typeOfEmf(spectrumEmf(['-200', '-150', '-100', '-50', '0'], []))[0]).toBe('19F');
    const titled = spectrumEmf(C13_AXIS, [], '19F{1H} NMR (376 MHz, CDCl3)');
    expect(S.typeOfEmf(titled)).toEqual(['19F', '19F{1H} NMR (376 MHz, CDCl3)']);
    expect(S.isSpectrumPicture(data)).toBe(true);
    expect(S.isSpectrumPicture(headerEmf('5a', '1H NMR (CDCl3, 400 MHz)'))).toBe(false);
  });

  it('reads the types named in headers', () => {
    expect(S.typeFromText('2a — 13C{1H} NMR (126 MHz, CDCl3)')).toBe('13C');
    expect(S.typeFromText('31P NMR of 5')).toBe('31P');
    expect(S.typeFromText('29Si NMR (99 MHz)')).toBe('Other NMR');
    expect(S.typeFromText('HSQC of 3b')).toBe('2D NMR');
    expect(S.typeFromText('HPLC trace of rac-4')).toBe('HPLC/SFC');
    expect(S.typeFromText('General remarks')).toBe('');
  });

  it('finds the compound ID in a PDF spectrum header', () => {
    const ids = ['9a', '2a', '2', '1'];
    expect(S.findId('2a — 1H NMR (500 MHz, CDCl3)', ids)).toBe('2a');
    expect(S.findId('1H NMR of 2', ids)).toBe('2');          // (not the "1" of ¹H)
    expect(S.findId('9a13C NMR', ids)).toBe('9a');
  });

  const compound = (cid: string, c13: string, h1 = ''): I.ImportedCompound => {
    const c = I.newCompound(cid, cid);
    c.values.nmr = [{ nucleus: '13C', text: `13C NMR (101 MHz, CDCl3) δ ${c13}.` }];
    if (h1) (c.values.nmr as Json[]).push({ nucleus: '1H', text: `1H NMR (400 MHz, CDCl3) δ ${h1}.` });
    return c;
  };

  it('matches spectra to the report their peaks fit', () => {
    const a = compound('4a', '170.1, 133.2, 128.5, 21.3', '7.40 – 7.31 (m, 5H), 2.35 (s, 3H)');
    const b = compound('4b', '165.0, 140.2, 116.4, 55.6');
    const peaks = [170.12, 133.21, 128.48, 77.16, 21.30];
    const text = (c: I.ImportedCompound): string => String(((c.values.nmr as Json[])[0] as Json).text);
    expect(S.matchScore(peaks, text(a), '13C')).toBeGreaterThan(0.9);
    expect(S.matchScore(peaks, text(b), '13C')).toBeLessThan(0.3);
    expect(S.bestByPeaks(peaks, '13C', [a, b])[0]).toBe('4a');
    // ¹H: a range counts when a peak lies in it
    expect(S.bestByPeaks([7.38, 7.35, 7.33, 7.26, 2.35], '1H', [a, b])[0]).toBe('4a');
    // two compounds fitting about as well: no match (the user chooses)
    expect(S.bestByPeaks(peaks, '13C', [a, compound('4c', '170.1, 133.2, 128.5, 21.3')])).toEqual(['', 0]);
  });

  const DIR = join(__dirname, 'fixtures', 'si-import', 'spectra');
  const planOf = async (file: string): Promise<I.ImportPlan> => {
    const plan = I.analyse(Rd.readSiDocx('si.docx', new Uint8Array(readFileSync(join(DIR, file)))).paras);
    await assignStructures(plan, tools);
    plan.spectra = await S.wordSpectra(plan, tools);
    return plan;
  };

  // spectra.docx: 4a and 4b, then a spectra section: 4a's ¹³C spectrum (its peaks fit 4a's report);
  // a header picture "4b 1H NMR" grouped with a spectrum with no peak labels; a group of a ChemDraw
  // drawing labelled 4b with a ¹³C spectrum (no peaks), followed by a stray header naming 4a (the ID
  // in the group wins); and an Mnova page that is a molecule only (no axis: not a spectrum).
  it('matches the Mnova spectra in a Word SI to their compounds', async () => {
    const plan = await planOf('spectra.docx');
    expect(plan.objects.filter((o) => o.kind === 'mnova').length).toBe(6);
    expect(plan.spectra.map((s) => [s.cid, s.type])).toEqual([['4a', '13C'], ['4b', '1H'], ['4b', '13C']]);
    const hows = plan.spectra.map((s) => s.how);
    expect(hows[0].startsWith('its peaks fit the 13C NMR report of 4a')).toBe(true);
    expect(hows[1]).toBe('by the header next to it (4b)');
    expect(plan.spectra[1].title).toBe('1H NMR (CDCl3, 400 MHz)');
    expect(hows[2]).toBe('by the ID under the structure next to it');
  });

  it('does not let a drawing’s label override the peaks', async () => {
    // a spectrum grouped with a drawing labelled 4b whose peaks fit 4a: it is 4a's
    const plan = await planOf('peaks-win.docx');
    expect(plan.spectra.map((s) => [s.cid, s.type])).toEqual([['4a', '13C']]);
  });

  it('stores the Word spectra (Mnova’s picture kept beside each)', async () => {
    const plan = await planOf('spectra.docx');
    plan.spectra[2].keep = false;
    const p = await SiProject.create(new MemoryFolder('P'), 'P');
    const converted: Uint8Array[] = [];
    const result = await applyPlan(p, plan, 'si.docx', {
      spectrumFor: async (e) => { converted.push(e); return [new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10'/>"), '.svg', e, '.emf']; },
    });
    expect(result.spectra).toBe(2);
    expect(converted.length).toBe(2);
    const r = p.idReport();
    const by = new Map(result.created.map((id) => [r.ids.get(id), p.compound(id)]));
    const items = valuesOf(by.get('4a')!).spectra as Json[];
    expect(items.map((i) => [i.type, String(i.file).replace(/^.*(\.[^.]+)$/, '$1')])).toEqual([['13C', '.svg']]);
    expect(String(items[0].original)).toMatch(/\.emf$/);          // (Mnova's copy kept)
    expect((valuesOf(by.get('4b')!).spectra as Json[]).map((i) => i.type)).toEqual(['1H']);
  });
});
