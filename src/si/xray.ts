// An X-ray structure section of an SI project (SPEC §13v): its CIF read with the program's own
// reader, drawn as SI Assistant's section stores its view, with the automatic captions and the
// crystal data table's rows (the CIF's values, those typed over, rows left out). Used by the
// compiler, which prints the drawing as a live crystal structure (double-click it to turn it,
// change its style or labels) with its caption, and the table when the section prints it.

import { readCif, type CifBlock } from '../chem/cif';
import { CrystalError, crystalTable, grow, structureFromCif, type M3 } from '../chem/crystal';
import { bestRotation, crystalShapes, defaultView, shapesBounds, specAtoms, type CrystalSpec, type LabelPlace, type XView } from '../design/xray';
import type { Json } from './project';

/** A new drawing's width when the section has no view stored yet: about 12 cm (SI Assistant's). */
export const XRAY_WIDTH = 340;

const dict = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** The section's data block: the one it names, else the first with atoms; null when the CIF has none. */
export function xrayBlock(cif: string, wanted: string): { block: CifBlock | null; error: string } {
  const blocks = readCif(cif).filter((b) => b.rows('_atom_site_label').length);
  if (!blocks.length) return { block: null, error: 'its CIF holds no structure (no _atom_site_ table)' };
  return { block: blocks.find((b) => b.name === wanted) ?? blocks[0], error: '' };
}

/** SI Assistant's stored view (ViewSettings JSON) as this program's; nothing stored: the best view. */
function viewOf(stored: Json, atoms: CrystalSpec['atoms']): { view: XView; zoom: number | null } {
  const v: XView = { ...defaultView(), hiddenMolecules: [], hiddenParts: [], labelOffsets: {} };
  const r = stored.rotation;
  const rot = Array.isArray(r) && r.length === 3 && r.every((row) => Array.isArray(row) && row.length === 3 && row.every((x) => typeof x === 'number' && Number.isFinite(x))) ? (r as M3) : null;
  v.rotation = rot ?? bestRotation(atoms.filter((a) => a.el !== 'H' && a.el !== 'D').map((a) => a.xyz));
  // (SI Assistant draws ORTEP or ball-and-stick; Chemweave's other styles are kept beside it)
  const style = str(stored.cw_style) || str(stored.style);
  if (['ball', 'stick', 'fill', 'wire'].includes(style)) v.style = style as XView['style'];
  if ([30, 50, 70, 90].includes(Number(stored.probability))) v.probability = Number(stored.probability) as XView['probability'];
  if (stored.hydrogens === 'hide') v.hydrogens = false;
  if (typeof stored.colour === 'boolean') v.colour = stored.colour;
  if (typeof stored.principal === 'boolean') v.principal = stored.principal;
  if (typeof stored.labels === 'boolean') v.labels = stored.labels;
  const size = Number(stored.label_size);
  if (Number.isFinite(size) && size >= 4 && size <= 30) v.labelSize = size;
  for (const [k, o] of Object.entries(dict(stored.label_offsets))) {
    if (Array.isArray(o) && o.length === 2 && o.every((x) => typeof x === 'number' && Number.isFinite(x))) v.labelOffsets[k] = [o[0], o[1]];
  }
  if (Array.isArray(stored.hidden_molecules)) v.hiddenMolecules = stored.hidden_molecules.filter((x): x is number => typeof x === 'number');
  if (Array.isArray(stored.hidden_parts)) v.hiddenParts = stored.hidden_parts.map(String);
  // what Chemweave's viewer adds (SI Assistant reads past these keys)
  const places = ['auto', 'open', 'right', 'left', 'above', 'below', 'center'];
  if (places.includes(str(stored.label_place))) v.labelPlace = stored.label_place as LabelPlace;
  const gap = Number(stored.label_gap);
  if (stored.label_gap !== undefined && Number.isFinite(gap) && gap >= 0 && gap <= 20) v.labelGap = gap;
  if (typeof stored.leaders === 'boolean') v.leaders = stored.leaders;
  if (stored.label_style === 'paren' || stored.label_style === 'plain') v.labelStyle = stored.label_style;
  const sides = Object.entries(dict(stored.label_sides)).filter(([, x]) => places.includes(str(x)));
  if (sides.length) v.labelSides = Object.fromEntries(sides) as Record<string, LabelPlace>;
  const which = Object.entries(dict(stored.label_atoms)).filter(([, x]) => typeof x === 'boolean');
  if (which.length) v.labelAtoms = Object.fromEntries(which) as Record<string, boolean>;
  const nums = (x: unknown): number[] => (Array.isArray(x) ? x.filter((n): n is number => typeof n === 'number' && Number.isInteger(n)) : []);
  if (nums(stored.hidden_atoms).length) v.hiddenAtoms = nums(stored.hidden_atoms);
  if (nums(stored.faded_atoms).length) v.fadedAtoms = nums(stored.faded_atoms);
  const fade = Number(stored.fade);
  if (stored.fade !== undefined && Number.isFinite(fade) && fade >= 0 && fade <= 1) v.fade = fade;
  const zoom = Number(stored.zoom);
  return { view: v, zoom: rot && Number.isFinite(zoom) && zoom > 0 ? zoom : null };
}

/**
 * A view from Chemweave's crystal viewer as SI Assistant stores it (its ViewSettings JSON), with
 * what only Chemweave draws in keys of their own: SI Assistant reads past them, and draws a style
 * it lacks (sticks, space-filling, wire) as ORTEP.
 */
export function storedView(v: XView, zoom: number): Json {
  const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
  const out: Json = {
    rotation: v.rotation.map((row) => row.map(r6)),
    zoom: Math.round(zoom * 1e4) / 1e4,
    style: v.style === 'ball' ? 'ball' : 'ortep',
    probability: v.probability,
    hydrogens: v.hydrogens ? 'spheres' : 'hide',
    colour: v.colour,
    principal: v.principal,
    labels: v.labels,
    label_size: v.labelSize,
    label_offsets: Object.fromEntries(Object.entries(v.labelOffsets).map(([k, o]) => [k, [Math.round(o[0] * 10) / 10, Math.round(o[1] * 10) / 10]])),
    hidden_molecules: [...v.hiddenMolecules],
    hidden_parts: [...v.hiddenParts],
  };
  if (v.style !== 'ortep' && v.style !== 'ball') out.cw_style = v.style;
  if (v.labelPlace) out.label_place = v.labelPlace;
  if (v.labelGap !== undefined) out.label_gap = v.labelGap;
  if (v.leaders !== undefined) out.leaders = v.leaders;
  if (v.labelStyle) out.label_style = v.labelStyle;
  if (v.labelSides && Object.keys(v.labelSides).length) out.label_sides = { ...v.labelSides };
  if (v.labelAtoms && Object.keys(v.labelAtoms).length) out.label_atoms = { ...v.labelAtoms };
  if (v.hiddenAtoms?.length) out.hidden_atoms = [...v.hiddenAtoms];
  if (v.fadedAtoms?.length) out.faded_atoms = [...v.fadedAtoms];
  if (v.fade !== undefined) out.fade = v.fade;
  return out;
}

/** The structure to draw and its size in points (as SI Assistant's view has it, at most `maxW` wide). */
export function xrayDrawing(block: CifBlock, stored: Json, maxW: number): { spec: CrystalSpec; w: number; h: number } | { error: string } {
  try {
    const s = structureFromCif(block);
    const g = grow(s);
    if (!g.atoms.length) return { error: 'its CIF has no atoms' };
    const atoms = specAtoms(g.atoms);
    const { view, zoom } = viewOf(stored, atoms);
    const r = (x: number) => Math.round(x * 1e4) / 1e4;
    const spec: CrystalSpec = { name: block.name, atoms, bonds: g.bonds, view, axes: s.orth.map((row) => row.map(r)) as M3, ...(g.complete ? {} : { partial: true }) };
    // its size: as the stored zoom draws it, else about 12 cm wide; never wider than the text
    // (labels keep their size: room for them round the structure, as the picture fits it)
    const b = shapesBounds(crystalShapes(spec, { ...view, zoom: 1, labels: false }));
    const bw = Math.max(1, b[2] - b[0]);
    const size = (z: number): [number, number] => { const l = shapesBounds(crystalShapes(spec, { ...view, zoom: z })); return [l[2] - l[0] + 2, l[3] - l[1] + 2]; };
    const extra = (z: number) => size(z)[0] - bw * z;
    let k = zoom ?? (XRAY_WIDTH - extra(XRAY_WIDTH / bw)) / bw;
    if (size(k)[0] > maxW) k = (maxW - extra(k)) / bw;
    const [w, h] = size(Math.max(0.05, k));
    return { spec, w: Math.round(w * 10) / 10, h: Math.round(h * 10) / 10 };
  } catch (e) {
    return { error: e instanceof CrystalError ? e.message : 'its CIF could not be read' };
  }
}

/** [key, label, value] rows of the crystal data table as printed: the CIF's values with those typed over, rows left out and empty ones dropped. */
export function xrayTableRows(data: Json, block: CifBlock): [string, string, string][] {
  const typed = dict(data.table_values);
  const hidden = new Set(Array.isArray(data.table_hidden) ? data.table_hidden.map(String) : []);
  const out: [string, string, string][] = [];
  for (const [key, label, cifValue] of crystalTable(block, true)) {
    const t = typed[key];
    const value = typeof t === 'string' && t.trim() ? t : cifValue;
    if (!hidden.has(key) && value.trim()) out.push([key, label, value]);
  }
  return out;
}

/** The compound the structure shows, as a mention ('' when it has none or it no longer exists). */
export function xrayCompound(data: Json, exists: (id: string) => boolean): string {
  const cid = str(data.compound);
  return cid && exists(cid) ? `@{${cid}}` : '';
}

/** How a caption names each way of drawing the molecule other than thermal ellipsoids. */
const STYLE_WORDS: Partial<Record<XView['style'], string>> = { ball: 'ball-and-stick model', stick: 'stick model', fill: 'space-filling model', wire: 'wireframe model' };

/** "Molecular structure of @{c-…} (thermal ellipsoids at 50% probability; …). CCDC 2345678." in stored text, from how it is drawn. */
export function xrayAutoCaption(view: XView, ref: string, ccdc: string): string {
  const notes = [view.style === 'ortep' ? `thermal ellipsoids at ${view.probability}% probability` : STYLE_WORDS[view.style] ?? 'ball-and-stick model'];
  if (!view.hydrogens) notes.push('hydrogen atoms omitted for clarity');
  if (view.hiddenMolecules.length) notes.push('solvent molecules omitted for clarity');
  if (view.hiddenParts.length) notes.push('the minor disorder component omitted for clarity');
  let text = `${ref ? `Molecular structure of ${ref}` : 'Molecular structure'} (${notes.join('; ')}).`;
  if (ccdc) text += ` CCDC ${ccdc}.`;
  return text;
}

/** The table's caption in stored text: typed, or "Crystal data and structure refinement for @{c-…}." */
export function xrayTableCaption(data: Json, ref: string): string {
  return str(data.table_caption).trim() || (ref ? `Crystal data and structure refinement for ${ref}.` : 'Crystal data and structure refinement.');
}
