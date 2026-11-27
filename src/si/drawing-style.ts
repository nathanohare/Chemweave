// How an SI project's structures and schemes are drawn (Project Settings ▸ Structures): any of
// Chemweave's drawing styles, kept in project.json as "drawing_style" (Chemweave's own key, which SI
// Assistant keeps without reading). A project without one is drawn as SI Assistant draws it: ACS
// 1996, with SI Assistant's own Structures settings ("structure_drawing": bond length, line width,
// label size and font) where it has them. Saving a style also writes those four into
// "structure_drawing", so SI Assistant draws the project's structures the same size.

import { ACS_1996, type DocStyle } from '../style';
import type { Json } from './project';

const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown, max: number): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= max ? v : null);

/** SI Assistant's label fonts that Chemweave also offers by name (its built-in Roboto and Telex aren't). */
const SI_FONTS = new Set(['Arial', 'Helvetica', 'Liberation Sans', 'DejaVu Sans', 'Calibri', 'Times New Roman']);
const SI_DEFAULT_FONT = 'Roboto (built in)';
const CM = 72 / 2.54;

/** The style a project starts in: ACS 1996 with SI Assistant's Structures settings. */
export function siDefaultStyle(settings: Json): DocStyle {
  const raw = isObj(settings.structure_drawing) ? settings.structure_drawing : {};
  const out: DocStyle = { ...ACS_1996 };
  const bond = num(raw.bond_length_cm, 20);
  if (bond) out.bondLength = Math.round(bond * CM * 100) / 100;
  const line = num(raw.line_width_pt, 50);
  if (line) out.lineWidth = line;
  const size = num(raw.font_size_pt, 200);
  if (size) out.labelSize = size;
  if (typeof raw.font === 'string' && SI_FONTS.has(raw.font)) out.labelFont = raw.font;
  return out;
}

/** The style the project's structures and schemes are drawn in. */
export function siDrawingStyle(settings: Json): DocStyle {
  const base = siDefaultStyle(settings);
  const raw = settings.drawing_style;
  if (!isObj(raw)) return base;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(raw)) {
    const had = (base as unknown as Record<string, unknown>)[k];
    // a hand-edited value of the wrong kind (or a size of nothing) is left at the default
    if (typeof v === 'number') { if (Number.isFinite(v) && v >= 0 && v <= 1000 && (had === undefined || typeof had === 'number')) out[k] = v; }
    else if (typeof v === 'string') { if (v.trim() && (had === undefined || typeof had === 'string')) out[k] = v; }
    else if (typeof v === 'boolean' || isObj(v)) { if (had === undefined || typeof had === typeof v) out[k] = v; }
  }
  return out as unknown as DocStyle;
}

/** Keep a style as the project's: in Chemweave's key, and its sizes in SI Assistant's Structures settings. */
export function storeSiDrawingStyle(settings: Json, style: DocStyle): void {
  settings.drawing_style = JSON.parse(JSON.stringify(style)) as Json;
  const had = isObj(settings.structure_drawing);
  const sd: Json = had ? { ...(settings.structure_drawing as Json) } : {};
  const values: Json = {
    bond_length_cm: Math.round((style.bondLength / CM) * 1000) / 1000,
    line_width_pt: style.lineWidth,
    font_size_pt: style.labelSize,
  };
  if (SI_FONTS.has(style.labelFont)) values.font = style.labelFont;
  // (SI Assistant's defaults, ACS 1996 and its label font, aren't written into a project that had none: another font is)
  const same = values.bond_length_cm === 0.508 && values.line_width_pt === 0.6 && values.font_size_pt === 10 && (values.font === undefined || values.font === ACS_1996.labelFont);
  if (!had && same) return;
  for (const [k, v] of Object.entries(values)) sd[k] = v;
  if (!had && sd.font === undefined) sd.font = SI_DEFAULT_FONT;
  settings.structure_drawing = sd;
}

/** Back to drawing as SI Assistant does (Chemweave's key taken out). */
export function clearSiDrawingStyle(settings: Json): void { delete settings.drawing_style; }
