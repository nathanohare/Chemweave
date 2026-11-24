// Where compound structures and figures go in the compiled SI and how the text wraps round them
// (Word's Position and Wrap Text): the project's choice (Project Settings ▸ Layout) and each one's
// own (Picture Format, or right-click it in the Live Preview). Kept in project.json under a key of
// Chemweave's own, which SI Assistant keeps without reading:
//
//   "chemweave_layout": {
//     "structures": { "position": "left", "wrap": "square", "top": "below", "gap": 0.3 },
//     "figures": { "position": "inline", "wrap": "square", "gap": 0.3 },
//     "items": { "c:<compound id>": { "position": "right" }, "f:<figure key>": { "position": "left" } }
//   }
//
// A structure in the line (position "inline") is centered in a paragraph of its own, as SI
// Assistant prints it. Any other position floats it at the left, in the middle or at the right of
// the margins, its top level with the first line under the compound's title ("below") or with the
// title itself ("title"), and the compound after it starts below it.
//
// A figure in the line is in a paragraph of its own, its caption under it, as SI Assistant prints
// it. Any other position floats the figure and its caption together (a text frame), with the text
// beside it (Square) or only above and below it (Top and Bottom; always so in the middle, as
// text can't go down both sides); the next heading, figure or table starts below it.

import type { Json } from './project';
import type { ParaFramePlace } from '../model';
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

/** What a placement is for: compound structures, or figures with their captions. */
export type PlacedKind = 'structures' | 'figures';

/** Compound structures at the left with the text beside them (Nate, 2026-11-24), the title above them. */
export const DEFAULT_PLACEMENT: Placement = { position: 'left', wrap: 'square', top: 'below', gap: 0.3 };

/** How SI Assistant prints a structure, and this program did before (centered in its own paragraph). */
export const INLINE_PLACEMENT: Placement = { ...DEFAULT_PLACEMENT, position: 'inline' };

/** Figures as SI Assistant prints them (in the line); Square once they float. */
export const DEFAULT_FIGURE_PLACEMENT: Placement = { position: 'inline', wrap: 'square', top: 'below', gap: 0.3 };

export const POSITIONS: SiPosition[] = ['inline', 'left', 'center', 'right'];
export const WRAPS: SiWrap[] = ['square', 'topBottom', 'behind', 'front'];
/** A figure's caption is text: it floats in a frame, which has no Behind Text or In Front of Text. */
export const FIGURE_WRAPS: SiWrap[] = ['square', 'topBottom'];

/** The names the menus and the settings show (Word's). */
export const POSITION_NAMES: Record<SiPosition, string> = { inline: 'In Line with Text', left: 'Left', center: 'Center', right: 'Right' };
export const WRAP_NAMES: Record<SiWrap, string> = { square: 'Square', topBottom: 'Top and Bottom', behind: 'Behind Text', front: 'In Front of Text' };

const KEY = 'chemweave_layout';
/** Room between a structure and the text, at most (cm): more is taken as a typing slip. */
export const MAX_GAP = 5;

const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const pick = <T extends string>(v: unknown, from: readonly T[]): T | undefined => (typeof v === 'string' && (from as readonly string[]).includes(v) ? (v as T) : undefined);

/** A compound structure's key among the own choices. */
export const structureKey = (compoundId: string): string => `c:${compoundId}`;
/** A figure's key among the own choices (its key in the compiled SI: the figure's id, or its place). */
export const figureKey = (key: string): string => `f:${key}`;
/** What an own choice's key is for. */
export const kindOfKey = (key: string): PlacedKind => (key.startsWith('f:') ? 'figures' : 'structures');
const PREFIX: Record<PlacedKind, string> = { structures: 'c:', figures: 'f:' };

function own(v: unknown, kind: PlacedKind = 'structures'): OwnPlacement {
  const o = isObj(v) ? v : {};
  const out: OwnPlacement = {};
  const position = pick(o.position, POSITIONS), wrap = pick(o.wrap, kind === 'figures' ? FIGURE_WRAPS : WRAPS), top = kind === 'figures' ? undefined : pick(o.top, ['title', 'below'] as const);
  if (position) out.position = position;
  if (wrap) out.wrap = wrap;
  if (top) out.top = top;
  return out;
}

/** The project's choice for compound structures or figures (its settings, else the defaults). */
export function projectPlacement(settings: Json, kind: PlacedKind = 'structures'): Placement {
  const all = isObj(settings[KEY]) ? (settings[KEY] as Json) : {};
  const s = isObj(all[kind]) ? (all[kind] as Json) : {};
  const base = kind === 'figures' ? DEFAULT_FIGURE_PLACEMENT : DEFAULT_PLACEMENT;
  const gap = typeof s.gap === 'number' && Number.isFinite(s.gap) ? Math.max(0, Math.min(MAX_GAP, s.gap)) : base.gap;
  return { ...base, ...own(s, kind), gap };
}

/** A structure's or figure's own choices (none: the project's). */
export function ownPlacement(settings: Json, key: string): OwnPlacement {
  const all = isObj(settings[KEY]) ? (settings[KEY] as Json) : {};
  const items = isObj(all.items) ? (all.items as Json) : {};
  return own(items[key], kindOfKey(key));
}

/** Where a structure or figure goes: its own choices over the project's. */
export function placementOf(settings: Json, key: string): Placement {
  return { ...projectPlacement(settings, kindOfKey(key)), ...ownPlacement(settings, key) };
}

function layoutOf(settings: Json): Json {
  if (!isObj(settings[KEY])) settings[KEY] = {};
  return settings[KEY] as Json;
}

/** Store the project's choice for compound structures or figures. */
export function storeProjectPlacement(settings: Json, p: Placement, kind: PlacedKind = 'structures'): void {
  const gap = Math.round(Math.max(0, Math.min(MAX_GAP, p.gap)) * 100) / 100;
  layoutOf(settings)[kind] = kind === 'figures' ? { position: p.position, wrap: FIGURE_WRAPS.includes(p.wrap) ? p.wrap : 'square', gap } : { position: p.position, wrap: p.wrap, top: p.top, gap };
}

/**
 * Change a structure's own choices (`null`: back to the project's). A choice the same as the
 * project's is not kept, so changing the project's later moves it too.
 */
export function storeOwnPlacement(settings: Json, key: string, change: OwnPlacement | null): void {
  const all = layoutOf(settings);
  const items: Json = isObj(all.items) ? { ...(all.items as Json) } : {};
  const kind = kindOfKey(key);
  const next: OwnPlacement = change === null ? {} : own({ ...own(items[key], kind), ...change }, kind);
  const base = projectPlacement(settings, kind);
  for (const k of Object.keys(next) as (keyof OwnPlacement)[]) if (next[k] === base[k]) delete next[k];
  if (Object.keys(next).length) items[key] = next as Json;
  else delete items[key];
  if (Object.keys(items).length) all.items = items;
  else delete all.items;
}

/** Every structure's (or figure's) own choices taken away (Apply to All, after the project's is set). */
export function clearOwnPlacements(settings: Json, kind: PlacedKind = 'structures'): void {
  const all = layoutOf(settings);
  const items = isObj(all.items) ? (all.items as Json) : {};
  const rest: Json = {};
  for (const [k, v] of Object.entries(items)) if (!k.startsWith(PREFIX[kind])) rest[k] = v;
  if (Object.keys(rest).length) all.items = rest;
  else delete all.items;
}

/** How many structures (or figures) have choices of their own. */
export function ownPlacementCount(settings: Json, kind: PlacedKind = 'structures'): number {
  const all = isObj(settings[KEY]) ? (settings[KEY] as Json) : {};
  const items = isObj(all.items) ? (all.items as Json) : {};
  return Object.entries(items).filter(([k, v]) => k.startsWith(PREFIX[kind]) && Object.keys(own(v, kind)).length).length;
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

/**
 * A figure's frame for a placement (none: in the line), for a picture `w` points wide in text
 * `textW` wide: the picture's width (2 inches at least, so its caption has room), with `gap` at
 * its sides. In the middle the text goes above and below it only.
 */
export function figureFrame(p: Placement, w: number, textW: number): ParaFramePlace | undefined {
  if (p.position === 'inline') return undefined;
  return {
    w: Math.round(Math.min(textW, Math.max(w, 144)) * 100) / 100,
    align: p.position,
    wrap: p.position === 'center' || p.wrap === 'topBottom' ? 'topBottom' : 'square',
    gap: Math.round(p.gap * PT_PER_CM * 100) / 100,
  };
}
