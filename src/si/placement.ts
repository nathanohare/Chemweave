// Where compound structures go in the compiled SI and how the text wraps round them (Word's
// Position and Wrap Text): the project's choice (Project Settings ▸ Layout) and each structure's
// own (Picture Format, or right-click it in the Live Preview). Kept in project.json under a key of
// Chemweave's own, which SI Assistant keeps without reading:
//
//   "chemweave_layout": {
//     "structures": { "position": "left", "wrap": "square", "top": "below", "gap": 0.3 },
//     "items": { "c:<compound id>": { "position": "right" } }
//   }
//
// A structure in the line (position "inline") is centered in a paragraph of its own, as SI
// Assistant prints it. Any other position floats it at the left, in the middle or at the right of
// the margins, its top level with the first line under the compound's title ("below") or with the
// title itself ("title"), and the compound after it starts below it.

import type { Json } from './project';
import type { Float, WrapKind } from '../document/document';

export type SiPosition = 'inline' | 'left' | 'center' | 'right';
export type SiWrap = WrapKind;

export interface Placement {
  position: SiPosition;
  /** How the text goes round it when it isn't in the line. */
  wrap: SiWrap;
  /** Its top level with the compound's title, or with the first line below it. */
  top: 'title' | 'below';
  /** The room kept between it and the text beside it, in centimeters. */
  gap: number;
}

/** A structure's own choices (unset: the project's). */
export type OwnPlacement = Partial<Pick<Placement, 'position' | 'wrap' | 'top'>>;

/** Compound structures at the left with the text beside them (Nate, 2026-11-24), the title above them. */
export const DEFAULT_PLACEMENT: Placement = { position: 'left', wrap: 'square', top: 'below', gap: 0.3 };

/** How SI Assistant prints a structure, and this program did before (centered in its own paragraph). */
export const INLINE_PLACEMENT: Placement = { ...DEFAULT_PLACEMENT, position: 'inline' };

export const POSITIONS: SiPosition[] = ['inline', 'left', 'center', 'right'];
export const WRAPS: SiWrap[] = ['square', 'topBottom', 'behind', 'front'];

/** The names the menus and the settings show (Word's). */
export const POSITION_NAMES: Record<SiPosition, string> = { inline: 'In Line with Text', left: 'Left', center: 'Center', right: 'Right' };
export const WRAP_NAMES: Record<SiWrap, string> = { square: 'Square', topBottom: 'Top and Bottom', behind: 'Behind Text', front: 'In Front of Text' };

const KEY = 'chemweave_layout';
/** Room between a structure and the text, at most (cm): more is taken as a typing slip. */
export const MAX_GAP = 5;

const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const pick = <T extends string>(v: unknown, from: readonly T[]): T | undefined => (typeof v === 'string' && (from as readonly string[]).includes(v) ? (v as T) : undefined);

/** A compound structure's key among the structures' own choices. */
export const structureKey = (compoundId: string): string => `c:${compoundId}`;

function own(v: unknown): OwnPlacement {
  const o = isObj(v) ? v : {};
  const out: OwnPlacement = {};
  const position = pick(o.position, POSITIONS), wrap = pick(o.wrap, WRAPS), top = pick(o.top, ['title', 'below'] as const);
  if (position) out.position = position;
  if (wrap) out.wrap = wrap;
  if (top) out.top = top;
  return out;
}

/** The project's choice for compound structures (its settings, else the defaults). */
export function projectPlacement(settings: Json): Placement {
  const all = isObj(settings[KEY]) ? (settings[KEY] as Json) : {};
  const s = isObj(all.structures) ? (all.structures as Json) : {};
  const gap = typeof s.gap === 'number' && Number.isFinite(s.gap) ? Math.max(0, Math.min(MAX_GAP, s.gap)) : DEFAULT_PLACEMENT.gap;
  return { ...DEFAULT_PLACEMENT, ...own(s), gap };
}

/** A structure's own choices (none: the project's). */
export function ownPlacement(settings: Json, key: string): OwnPlacement {
  const all = isObj(settings[KEY]) ? (settings[KEY] as Json) : {};
  const items = isObj(all.items) ? (all.items as Json) : {};
  return own(items[key]);
}

/** Where a structure goes: its own choices over the project's. */
export function placementOf(settings: Json, key: string): Placement {
  return { ...projectPlacement(settings), ...ownPlacement(settings, key) };
}

function layoutOf(settings: Json): Json {
  if (!isObj(settings[KEY])) settings[KEY] = {};
  return settings[KEY] as Json;
}

/** Store the project's choice for compound structures. */
export function storeProjectPlacement(settings: Json, p: Placement): void {
  layoutOf(settings).structures = { position: p.position, wrap: p.wrap, top: p.top, gap: Math.round(Math.max(0, Math.min(MAX_GAP, p.gap)) * 100) / 100 };
}

/**
 * Change a structure's own choices (`null`: back to the project's). A choice the same as the
 * project's is not kept, so changing the project's later moves it too.
 */
export function storeOwnPlacement(settings: Json, key: string, change: OwnPlacement | null): void {
  const all = layoutOf(settings);
  const items: Json = isObj(all.items) ? { ...(all.items as Json) } : {};
  const next: OwnPlacement = change === null ? {} : { ...own(items[key]), ...change };
  const base = projectPlacement(settings);
  for (const k of Object.keys(next) as (keyof OwnPlacement)[]) if (next[k] === base[k]) delete next[k];
  if (Object.keys(next).length) items[key] = next as Json;
  else delete items[key];
  if (Object.keys(items).length) all.items = items;
  else delete all.items;
}

/** Every structure's own choices taken away (Apply to All Structures, after the project's is set). */
export function clearOwnPlacements(settings: Json): void {
  const all = layoutOf(settings);
  const items = isObj(all.items) ? (all.items as Json) : {};
  const rest: Json = {};
  for (const [k, v] of Object.entries(items)) if (!k.startsWith('c:')) rest[k] = v;
  if (Object.keys(rest).length) all.items = rest;
  else delete all.items;
}

/** How many structures have choices of their own. */
export function ownPlacementCount(settings: Json): number {
  const all = isObj(settings[KEY]) ? (settings[KEY] as Json) : {};
  const items = isObj(all.items) ? (all.items as Json) : {};
  return Object.entries(items).filter(([k, v]) => k.startsWith('c:') && Object.keys(own(v)).length).length;
}

const PT_PER_CM = 72 / 2.54;

/**
 * The structure's place on the page for a placement (none: in the line), for a structure `w`
 * points wide in text `textW` points wide: lined up in the margins as Word's Alignment, with
 * `gap` beside it and half that under it (none above: its top is the line's).
 */
export function floatOf(p: Placement, w: number, textW: number): Float | undefined {
  if (p.position === 'inline') return undefined;
  const gap = Math.round(p.gap * PT_PER_CM * 100) / 100;
  const x = p.position === 'left' ? 0 : p.position === 'right' ? textW - w : (textW - w) / 2;
  return { wrap: p.wrap, x: Math.round(Math.max(0, x) * 100) / 100, y: 0, align: p.position, gap, gapTop: 0, gapBottom: Math.round((gap / 2) * 100) / 100 };
}
