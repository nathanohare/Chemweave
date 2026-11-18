// Pasting a spectrum, e.g. from Mnova, onto a compound, as Chem SI Assistant does it (its SPEC
// §13l.1, ui/spectrum_paste.py): one click picks the spectrum's type, guessed from the compound's
// peak reports; the spectrum is stored in the compound's spectra/ folder as "pasted 1H.svg"
// (".png", ".pdf"), with Mnova's own copy beside it ("pasted 1H.emf"), named on the item as
// "original" so it can be converted again later.

import { SPECTRUM_TYPES, SPECTRUM_TYPE_LABELS, partText } from './fields';
import { valuesOf, type Json, type SiCompound } from './project';

export type SpectrumType = (typeof SPECTRUM_TYPES)[number];

/** The chooser's buttons ("¹H NMR", "HPLC/SFC"…), in SI Assistant's order. */
export const PASTE_TYPE_LABELS: Record<SpectrumType, string> = {
  '1H': SPECTRUM_TYPE_LABELS['1H'], '13C': SPECTRUM_TYPE_LABELS['13C'], '19F': SPECTRUM_TYPE_LABELS['19F'],
  '31P': SPECTRUM_TYPE_LABELS['31P'], '11B': SPECTRUM_TYPE_LABELS['11B'], 'Other NMR': 'Other NMR',
  '2D NMR': '2D NMR', 'HPLC/SFC': 'HPLC/SFC', IR: 'IR', Other: 'Other',
};

const NAME_STEMS: Record<string, string> = {
  'Other NMR': 'pasted other NMR', '2D NMR': 'pasted 2D NMR', 'HPLC/SFC': 'pasted HPLC-SFC', IR: 'pasted IR', Other: 'pasted spectrum',
};

/** The name a pasted spectrum is stored under, before its extension ("pasted 1H"); never the compound's ID. */
export function pastedStem(type: string): string {
  return NAME_STEMS[type] ?? `pasted ${type}`;
}

const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * The type a pasted spectrum most likely is: the first of ¹H, ¹³C, ¹⁹F, ³¹P, ¹¹B with a peak
 * report that has text but no spectrum of that type yet; else ¹H when the compound has no
 * spectra; else Other.
 */
export function guessPastedType(c: SiCompound): SpectrumType {
  const v = valuesOf(c);
  const reports = Array.isArray(v.nmr) ? v.nmr.filter(isObj) : [];
  const spectra = Array.isArray(v.spectra) ? v.spectra.filter(isObj) : [];
  const have = new Set(spectra.map((s) => partText(s.type)));
  for (const n of ['1H', '13C', '19F', '31P', '11B'] as const) {
    if (have.has(n)) continue;
    if (reports.some((r) => partText(r.nucleus) === n && partText(r.text).trim())) return n;
  }
  return spectra.length ? 'Other' : '1H';
}

/** What was kept, in one plain line (shown after the paste). */
export function keptLine(how: 'svg' | 'pdf' | 'picture' | 'emf-picture'): string {
  return {
    svg: 'Kept as a vector drawing (SVG).',
    pdf: 'Kept Mnova’s PDF (a vector drawing).',
    picture: 'Kept the copied picture as it is.',
    'emf-picture': 'Mnova copied a picture inside its metafile; it was kept as a picture. For sharper spectra, choose “Enhanced Windows Metafile” in Mnova’s copy options and copy again.',
  }[how];
}
