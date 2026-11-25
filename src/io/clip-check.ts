// The check of a drawing in our own whole-drawing clipboard format before it is pasted (review
// F1b-R05, F1c-R05, F1d-R03, F1e-R01). One walk over every value, each compared with a specimen
// of its kind: the fields an atom, bond, caption, arrow or shape can have (the lists below must
// name every field of the model's types, or the type check fails), and for settings kept on a
// frame (an energy diagram's, a plate's, a table's…) an object made the way the program makes a
// new one. A value must have its specimen's type (a number a finite number within a million, a
// list a list of what the specimen's list holds, an object an object whose known fields fit);
// a few lengths must also be more than 0.01 (a dash spacing of 1e-12 would never finish drawing).
// Fields the specimen doesn't know are kept, their numbers finite. References between objects are
// lists of numbers; those that point at nothing in the copy are let go when it is pasted
// (insertDrawing), and a bond to an atom that isn't there is left out here. Whatever the check
// lets through and still fails to paste is undone and the CDXML pasted instead (pasteFallback).

import type { Atom, Bond, Caption, Arrow, Shape, Contents, TextRun, Pin, Frame, ParaStyle, StepRoles, StereoLabel, HighlightStyle, Attachment, TableCell, TableData, EnhancedStereo, MorphStep, PictureFx, Media, PictureLook, OrbitalTag, ShapeGlow, ShapeBevel, ShapeReflection, PicFill, ShapeMath, ArrowTextLook } from '../model';
import { emptyTable } from '../table';
import { ENERGY_DEFAULTS, ENERGY_PRESETS } from '../design/energy';
import { newPlate } from '../design/plates';
import { soundPlateDSplit } from '../design/dsplit';
import { sanitizeEcount } from '../chem/ecount-settings';
import { newDiagram } from '../design/diagrams';
import { newChartBox } from '../sheet/chart-box';

/** How far from the origin (in points) a pasted drawing's places, and any length, may be: far beyond any page. */
export const MAX_PLACE = 1e6;

type Obj = Record<string, unknown>;
type Check = (v: unknown) => boolean;
/** What a value is compared with: a sample value of the right type, a list of one sample, an object of samples, or a check of its own. null: anything, its numbers finite. */
type Spec = number | string | boolean | null | Check | Spec[] | { [k: string]: Spec };

const obj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= MAX_PLACE;
/** A length that must be more than nothing: a dash spacing, a text size, a bond length. */
const length: Check = (v) => num(v) && (v as number) >= 0.01;
const str: Check = (v) => typeof v === 'string';
const oneOf = (...vals: string[]): Check => (v) => typeof v === 'string' && vals.includes(v);
const orNull = (c: Check): Check => (v) => v === null || c(v);
/** Times in milliseconds (a video's trim) may run past a million. */
const LONG = new Set(['trimStart', 'trimEnd', 'length']);
const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** Any value whose numbers are finite (JSON's 1e400 reads as Infinity), nested no more than 40 deep. */
function finite(v: unknown, depth: number): boolean {
  if (typeof v === 'number') return Number.isFinite(v);
  if (!v || typeof v !== 'object') return true;
  if (depth > 40) return false;
  if (Array.isArray(v)) { for (const x of v) if (!finite(x, depth + 1)) return false; return true; }
  for (const k in v as Obj) if (k === '__proto__' || !finite((v as Obj)[k], depth + 1)) return false;
  return true;
}

/** Does `v` fit specimen `s` (field `key`)? Undefined fits anything: a field left out. */
function fits(v: unknown, s: Spec, key: string, depth: number): boolean {
  if (v === undefined) return true;
  if (depth > 40) return false;
  if (typeof s === 'function') return s(v) && finite(v, depth);
  if (s === null) return finite(v, depth);
  if (typeof s === 'number') return typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= (LONG.has(key) ? 1e9 : MAX_PLACE);
  if (typeof s !== 'object') return typeof v === typeof s;
  if (Array.isArray(s)) {
    if (!Array.isArray(v)) return false;
    for (const x of v) if (!(s.length ? fits(x, s[0], key, depth + 1) : finite(x, depth + 1))) return false;
    return true;
  }
  if (!obj(v)) return false;
  for (const k in v) {
    if (k === '__proto__') return false;
    if (!(own(s, k) ? fits(v[k], s[k], k, depth + 1) : finite(v[k], depth + 1))) return false;
  }
  return true;
}

/**
 * One specimen from several objects made the way the program makes them (a TLC plate, a gel, an
 * MO diagram…): every field any of them has, a list's items merged into one.
 */
function specimenOf(...samples: unknown[]): Spec {
  const real = samples.filter((x) => x !== undefined && x !== null);
  if (!real.length) return null;
  const first = real[0];
  if (typeof first === 'number' || typeof first === 'string' || typeof first === 'boolean') return first;
  if (Array.isArray(first)) {
    const items = real.flatMap((x) => (Array.isArray(x) ? x : []));
    return items.length ? [specimenOf(...items)] : [];
  }
  if (!obj(first)) return null;
  const out: { [k: string]: Spec } = {};
  for (const x of real) if (obj(x)) for (const k of Object.keys(x)) if (!own(out, k)) out[k] = specimenOf(...real.map((y) => (obj(y) ? y[k] : undefined)));
  return out;
}

const ids: Spec = [0];
const pt: Spec = { x: 0, y: 0 };
const run = { text: str, bold: true, italic: true, underline: true, sub: true, sup: true, formula: true, size: length, font: '', color: '',
  highlight: '', obj: 0, strike: true, rev: '', fmt: '', hide: true, cmt: '', link: '', spacing: 0, field: '', cite: '', lang: '', smallCaps: true,
  allCaps: true, cstyle: '', cc: '', noKern: true, kernAt: 0, noFill: true, transparency: 0, outline: '', outlineW: 0, shadow: true, wfx: '', noProof: true,
  raise: 0, symbolFont: true, ukind: '', wrx: '', ucolor: '', dstrike: true, pfx: '' } satisfies Record<keyof TextRun, Spec>;
const para = { list: oneOf('bullet', 'number'), level: 0, cont: true, soft: true, wpx: '', align: oneOf('left', 'center', 'right', 'justify'),
  spaceBefore: 0, spaceAfter: 0, indent: 0, style: '', ppx: '', pageBreak: true, colBreak: true, firstLine: 0, line: 0, keepNext: true,
  keepLines: true, clear: true, frame: { w: 0, align: oneOf('left', 'center', 'right'), wrap: oneOf('square', 'topBottom'), gap: 0 }, noWidow: true, indentRight: 0, linePt: 0, lineRule: oneOf('exact', 'atLeast'), section: null, noLineNumbers: true,
  noHyphen: true, numLook: { bold: true, italic: true }, marks: [''], tabs: [null], scheme: '', bullet: '', numType: '', startAt: 0,
  border: null, shade: '', xe: [null], ta: [null], cc: '' } satisfies Record<keyof ParaStyle, Spec>;
const pin = { on: oneOf('atom', 'bond', 'gap'), ref: ids, at: pt, hand: 0, was: pt, len: 0, dir: pt } satisfies Record<keyof Pin, Spec>;
const frame = { atoms: ids, captions: ids, arrows: ids, shapes: ids, padX: 0, padY: 0, fit: true } satisfies Record<keyof Frame, Spec>;
const stereoLabel = { text: '', dx: 0, dy: 0, size: length, italic: true, manual: true, offset: true, fromFile: true } satisfies Record<keyof StereoLabel, Spec>;
const numberLabel = { dx: 0, dy: 0, size: length, color: '', face: 0 } satisfies Record<keyof NonNullable<Atom['numberLabel']>, Spec>;
const highlight = { shape: '', ends: '', size: 0, fit: true, shadow: true, soft: true, smooth: true, centre: true, softAmount: 0, softSide: '',
  transparency: 0, fill: '', colour2: '', gradAngle: 0, pattern: '', patternColour: '', patternSize: 0, line: '', lineColour: '', lineWidth: 0,
  shadowColour: '', shadowOpacity: 0, shadowAngle: 0, shadowDistance: 0, shadowBlur: 0, glow: true, glowColour: '', glowSize: 0,
  glowTransparency: 0 } satisfies Record<keyof HighlightStyle, Spec>;
const enh = { type: oneOf('abs', 'and', 'or'), group: 0 } satisfies Record<keyof EnhancedStereo, Spec>;
const attachment = { atoms: ids, side: oneOf('below', 'above', 'left', 'right'), gap: 0, shift: 0, align: oneOf('left', 'right'),
  role: oneOf('label', 'caption', 'descriptors'), show: [''], adduct: '', sig: '', keepText: true } satisfies Record<keyof Attachment, Spec>;
const step = { reactants: [''], products: [''], above: [''], below: [''], plusses: [''], inside: [''], manual: true } satisfies Record<keyof StepRoles, Spec>;
const morph = { pairs: [[0]], exact: true, shifts: [[0]], slides: [[[0]]] } satisfies Record<keyof MorphStep, Spec>;
const textLook = { align: { above: '', below: '', results: '' }, guides: true } satisfies Record<keyof ArrowTextLook, Spec>;
const cell = { runs: [run], paras: [para], align: '', span: 0, rowSpan: 0, fill: '', valign: '', fig: { w: 0, h: 0 }, borders: null, pad: null } satisfies Record<keyof TableCell, Spec>;
const table = { ...(specimenOf(emptyTable(2, 2, 10)) as { [k: string]: Spec }), rows: [[cell]], title: [run], notes: [run], size: length } satisfies Partial<Record<keyof TableData, Spec>>;
const look = { line: 0, lineColor: '', round: 0, shadow: '' } satisfies Record<keyof PictureLook, Spec>;
const fx = { bright: 0, contrast: 0, sharpen: 0, recolor: null, alpha: 0, clear: '', bg: null, shape: '' } satisfies Record<keyof PictureFx, Spec>;
const media = { src: '', once: true, audio: true, trimStart: 0, trimEnd: 0, fadeIn: 0, fadeOut: 0, start: '', vol: 0, mute: true, rewind: true,
  hide: true, across: true, narration: true, full: true, length: 0 } satisfies Record<keyof Media, Spec>;
const orb = { kind: '', look: '', flip: true, colours: [''], part: 0 } satisfies Record<keyof OrbitalTag, Spec>;
const glow = { color: '', size: 0, transparency: 0 } satisfies Record<keyof ShapeGlow, Spec>;
const bevel = { kind: '', w: 0, h: 0 } satisfies Record<keyof ShapeBevel, Spec>;
const reflection = { size: 0, opacity: 0, dist: 0, blur: 0 } satisfies Record<keyof ShapeReflection, Spec>;
const picFill = { src: '', px: { w: 0, h: 0 }, transparency: 0 } satisfies Record<keyof PicFill, Spec>;
const math = { tex: '', size: length, color: '', font: '' } satisfies Record<keyof ShapeMath, Spec>;
const common = { piece: 0, ole: { id: 0, prog: '' }, id: 0, grp: 0, grpPath: ids, stack: 0 };

const atom = {
  ...common, x: 0, y: 0, z: (v: unknown) => num(v) && (v as number) >= 0 && (v as number) < 200, label: orNull(str), charge: 0, isotope: 0,
  just: oneOf('auto', 'left', 'right'), fileLabel: true, hByRule: true, color: '', s: 0, face: 0, font: '', marginWidth: 0, xyz: [0], depth: 0, group: '',
  cdxInner: { label: '', type: '', nick: '', xml: '', x: 0, y: 0 }, alt: '', showCarbon: true, asTyped: true, bare: true, hideCharge: true,
  supDigits: true, labelMarks: '', centred: true, stacked: oneOf('up', 'down'), hDot: oneOf('dot', 'dash'), stackedLoose: true, fixedDir: true,
  showStereo: true, stereoLabel, ignoreWarnings: true, highlight: '', hl: highlight, radical: oneOf('singlet', 'doublet', 'triplet'), attach: '',
  attachNum: 0, atomNumber: '', showNumber: true, numberLabel, mapNo: 0, focal: true, enhStereo: enh, multi: ids, kekule: true, variable: true, ringOf: ids,
  // (made sound, or dropped, by sanitizeEcount when pasted: soundContents)
  ecount: null,
} satisfies Record<keyof Atom, Spec>;
const bond = {
  id: 0, a1: 0, a2: 0, order: 0,
  display: oneOf('solid', 'wedge', 'hashWedge', 'hash', 'bold', 'dash', 'wavy', 'dative', 'hollowWedge', 'wavyWedge', 'hydrogen', 'ionic'),
  dpos: oneOf('auto', 'left', 'right', 'center'), color: '', s: 0, boldWidth: 0, hashSpacing: length, marginWidth: 0, bondLength: length,
  circle: true, plain: true, z: 0, crossing: ids, line2: oneOf('dash', 'bold', 'hash'), beginAttach: 0, endAttach: 0, ignoreWarnings: true,
  spokes: true, showStereo: true, stereoLabel, highlight: '', hl: highlight,
} satisfies Record<keyof Bond, Spec>;
const caption = {
  ...common, x: 0, y: 0, runs: [run], justify: oneOf('left', 'center', 'right', 'justify'), width: 0, lineHeight: 0, lineSpacing: 0, inkLines: true,
  wrap: 0, paras: [para], ph: oneOf('title', 'subtitle', 'body'), boxH: 0, refsBox: true, attach: attachment, ignoreWarnings: true, results: true,
  chem: true, rot: 0, name: '', hidden: true, cols: 0, colGap: 0, fit: oneOf('shrink', 'fixed'), dir: oneOf('vert', 'vert270'), pbox: '',
} satisfies Record<keyof Caption, Spec>;
const arrowHead = oneOf('none', 'full', 'halfLeft', 'halfRight');
const arrow = {
  ...common, ppt: true, tail: pt, head: pt, headStyle: arrowHead, tailStyle: arrowHead, headType: oneOf('solid', 'hollow', 'angle'),
  line: oneOf('solid', 'dashed', 'bold', 'wavy'), noGo: true, noGoKind: oneOf('hash'), dipole: true, equilibrium: true, boldWidth: 0,
  hashSpacing: length, shaftSpacing: length, sweep: 0, headLength: 0, headWidth: 0, headCenter: 0, color: '', lineWidth: 0, step, reagentFor: 0,
  from: { shape: 0, port: 0 }, to: { shape: 0, port: 0 }, elbow: true, morph, bez: [pt], ellipse: { center: pt, major: pt, minor: pt, angular: 0 },
  pin: { tail: pin, head: pin }, bent: true, textLook, kind: oneOf('reaction', 'mechanism', 'plain'), name: '',
} satisfies Record<keyof Arrow, Spec>;
const L = 14.4;
const shape = {
  ...common, ppt: true, kind: oneOf('line', 'rect', 'oval', 'symbol', 'bracket', 'picture', 'table', 'geo', 'ring'), ring: ids, poly: [pt], pin,
  geo: '', orbital: '', orb, text: orNull((v) => fits(v, { runs: [run], paras: [para] }, 'text', 1) && obj(v) && Array.isArray(v.runs)),
  textAlign: oneOf('left', 'center', 'right', 'justify'), textValign: oneOf('top', 'middle', 'bottom'), lineWidth: 0, transparency: 0,
  x1: 0, y1: 0, x2: 0, y2: 0, rot: 0, dashed: true, hashSpacing: length, dotted: true, filled: true, fill: oneOf('faded', 'shaded', 'gradient'),
  fill2: '', gradAngle: 0, gradRadial: true, pattern: oneOf('hatch', 'backhatch', 'crosshatch', 'horizontal', 'vertical', 'grid', 'dots', 'dense-dots'),
  patternColor: '', patternSize: 0, patternTransparency: 0, patternClear: true, fillColor: '', fade: 0, rounded: true, radius: 0, shadow: true,
  shadowBetween: true, shadowSize: 0, shadowColor: '', shadowOpacity: 0, shadowAngle: 0, shadowBlur: 0, glow, softEdge: 0, bevel, reflection,
  picFill, bold: true, symbol: '', bracket: oneOf('square', 'round', 'curly'), pair: true, bracketPair: 0, repeat: '',
  repeatLook: { color: '', face: 0, size: 0 }, picture: true, src: '', px: { w: 0, h: 0 }, video: media, link: '',
  zoom: { back: true, to: '', summary: true }, crop: { l: 0, t: 0, r: 0, b: 0 }, phPic: 0, look, fx, color: '', z: 0, alt: '', name: '',
  hidden: true, locked: true, table, chart: specimenOf(newChartBox('bar'), newChartBox('line'), newChartBox('pie')), math, frame,
  editedOutside: true, madeLabels: null, cdObject: { kind: '', xml: '', box: [0] },
  energy: specimenOf({ ...ENERGY_DEFAULTS, ...ENERGY_PRESETS[0].data }, ...ENERGY_PRESETS.map((p) => p.data)),
  newman: null, torsion: null, smart: null,
  plate: specimenOf(newPlate('tlc', L), newPlate('gel', L), newPlate('mo', L), newPlate('crystal', L)),
  diagram: specimenOf(newDiagram('org', 'a\n\tb')), holder: { runs: [run] },
} satisfies Record<keyof Shape, Spec>;

const KINDS: Record<string, [Spec, string[]]> = {
  atoms: [atom, ['id', 'x', 'y', 'z']],
  bonds: [bond, ['id', 'a1', 'a2', 'order']],
  captions: [caption, ['id', 'x', 'y', 'runs']],
  arrows: [arrow, ['id', 'tail', 'head']],
  shapes: [shape, ['id', 'kind', 'x1', 'y1', 'x2', 'y2']],
};
const needs = (o: Obj, keys: string[]) => keys.every((k) => o[k] !== undefined);

/** The fields the parts inside an object must have: a run its text, a pin its atoms and place, a frame its lists, a table its rows. */
function inner(o: Obj): boolean {
  for (const r of (o.runs ?? []) as Obj[]) if (!obj(r) || typeof r.text !== 'string') return false;
  const pins = [o.pin, ...(obj(o.pin) && !('on' in o.pin) ? [o.pin.tail, o.pin.head] : [])].filter((p) => obj(p) && 'on' in p) as Obj[];
  if (obj(o.pin) && !('on' in o.pin) && !('tail' in o.pin) && !('head' in o.pin) && Object.keys(o.pin).length) return false;
  for (const p of pins) if (!needs(p, ['on', 'ref', 'at', 'hand', 'was'])) return false;
  if (o.frame !== undefined && !(obj(o.frame) && needs(o.frame, ['atoms', 'captions', 'arrows', 'shapes']))) return false;
  if (obj(o.text) && !Array.isArray(o.text.runs)) return false;
  if (obj(o.stereoLabel) && !needs(o.stereoLabel, ['text', 'dx', 'dy', 'size'])) return false;
  if (obj(o.numberLabel) && !needs(o.numberLabel, ['dx', 'dy', 'size'])) return false;
  if (obj(o.table) && !needs(o.table, ['cols', 'rows', 'head', 'lines'])) return false;
  // (each cell its runs: a cell without them can't be drawn or saved)
  if (obj(o.table) && Array.isArray(o.table.rows) && !o.table.rows.every((row) => !Array.isArray(row) || row.every((c) => !obj(c) || Array.isArray(c.runs)))) return false;
  if (obj(o.step) && !needs(o.step, ['reactants', 'products', 'above', 'below'])) return false;
  if (obj(o.attach) && !needs(o.attach, ['atoms'])) return false;
  return true;
}

/** Drawing settings with the type and range a fresh drawing's have (lengths and sizes more than 0.01). */
export function soundStyle(style: Obj, fresh: Obj): Obj {
  const out: Obj = {};
  for (const [k, v] of Object.entries(style)) {
    if (k === '__proto__') continue;
    if (!own(fresh, k)) { if (finite(v, 0)) out[k] = v; continue; }
    const s = fresh[k];
    if (typeof s === 'number') { if (num(v) && (!/Size$|Spacing$|Length$|Width$/.test(k) || s <= 0 || (v as number) >= 0.01)) out[k] = v; continue; }
    if (fits(v, specimenOf(s), k, 0)) out[k] = v;
  }
  return out;
}

/**
 * The contents of a whole-drawing copy when every object in it is sound (see above), with bonds
 * to atoms that aren't there left out; null when anything isn't, so the CDXML beside it is pasted.
 */
export function soundContents(c: unknown): Contents | null {
  if (!obj(c)) return null;
  const got: Record<string, Obj[]> = {};
  for (const [k, [spec, need]] of Object.entries(KINDS)) {
    const v = c[k];
    if (v === undefined) { got[k] = []; continue; }
    if (!Array.isArray(v)) return null;
    const seen = new Set<unknown>();
    for (const o of v) {
      // (each object once: two with one id would be one object pasted twice)
      if (!obj(o) || !needs(o, need) || seen.has(o.id) || !fits(o, spec, k, 0) || !inner(o)) return null;
      seen.add(o.id);
    }
    got[k] = v as Obj[];
  }
  if (!got.atoms.length && !got.captions.length && !got.arrows.length && !got.shapes.length) return null;
  // a metal's electron count set by hand: only what is sound kept (whole numbers in range, type codes that read)
  got.atoms = got.atoms.map((a) => {
    if (a.ecount === undefined) return a;
    const { ecount, ...rest } = a;
    const sound = sanitizeEcount(ecount);
    return sound ? { ...rest, ecount: sound } : rest;
  });
  // a d-orbital splitting diagram's choices made sound (a label that isn't text would stop it drawing)
  got.shapes = got.shapes.map((s) => (obj(s.plate) ? { ...s, plate: soundPlateDSplit(s.plate) } : s));
  const have = new Set(got.atoms.map((a) => a.id));
  // (a bond to an atom that isn't there is left out)
  got.bonds = got.bonds.filter((b) => have.has(b.a1) && have.has(b.a2) && b.a1 !== b.a2);
  return got as unknown as Contents;
}
