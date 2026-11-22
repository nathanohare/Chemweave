// The check of a drawing in our own whole-drawing clipboard format before it is pasted (review
// F1b-R05, F1c-R05, F1d-R03). Each field this version knows must have the type it is used with:
// a number finite, a place within a million points of the origin (a drawing further out would
// take a save for ever), a list a list of the right things, text runs with their text, a pin
// its atoms and point. Fields this version doesn't know are kept as they are. References between
// objects (a bond's atoms, a frame's members, a pin's atoms, a caption's structure) must be lists
// of numbers; those that point at nothing in the copy are let go when it is pasted (insertDrawing),
// and a bond to an atom that isn't there is left out here. The check reads each value once, so a
// big paste costs little more than the paste itself.

import type { Contents } from '../model';

/** How far from the origin (in points) a pasted drawing's places may be: far beyond any page. */
export const MAX_PLACE = 1e6;

type Obj = Record<string, unknown>;
type Check = (v: unknown) => boolean;

const obj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const num: Check = (v) => typeof v === 'number' && Number.isFinite(v);
const place: Check = (v) => num(v) && Math.abs(v as number) <= MAX_PLACE;
const str: Check = (v) => typeof v === 'string';
const bool: Check = (v) => typeof v === 'boolean';
const listOf = (c: Check): Check => (v) => Array.isArray(v) && v.every(c);
const oneOf = (...vals: string[]): Check => (v) => typeof v === 'string' && vals.includes(v);
const ids = listOf(num);
const pt: Check = (v) => obj(v) && place(v.x) && place(v.y);
/** An object whose known fields have their types (others kept); `need` lists the ones it must have. */
const shape = (fields: Record<string, Check>, need: string[] = []): Check => (v) => {
  if (!obj(v)) return false;
  for (const k of need) if (v[k] === undefined) return false;
  for (const k in v) {
    const c = fields[k];
    if (c && v[k] !== undefined && !c(v[k])) return false;
  }
  return true;
};
/** Any value with no number in it that isn't finite (JSON's 1e400 reads as Infinity), nested no more than 40 deep. */
const finite = (v: unknown, depth = 0): boolean => {
  if (typeof v === 'number') return Number.isFinite(v);
  if (!v || typeof v !== 'object') return true;
  if (depth > 40) return false;
  if (Array.isArray(v)) { for (const x of v) if (!finite(x, depth + 1)) return false; return true; }
  for (const k in v as Obj) if (!finite((v as Obj)[k], depth + 1)) return false;
  return true;
};
/** Settings data kept on a frame or a picture (an energy diagram's, a table's…): an object, finite throughout. */
const data: Check = (v) => obj(v) && finite(v);

const run = shape({
  text: str, bold: bool, italic: bool, underline: bool, sub: bool, sup: bool, formula: bool,
  size: (v) => num(v) && (v as number) > 0 && (v as number) < 1000,
  font: str, color: str, highlight: str, obj: num, strike: bool, rev: str, fmt: str, hide: bool, cmt: str,
  link: str, spacing: num, field: str, cite: str, lang: str, smallCaps: bool, allCaps: bool, cstyle: str,
  cc: str, noKern: bool, noFill: bool, transparency: num, outline: str, outlineW: num, shadow: bool,
  wfx: str, noProof: bool, raise: num, symbolFont: bool,
}, ['text']);
const runs = listOf(run);
const paras = listOf(data);
const pin = shape({ on: oneOf('atom', 'bond', 'gap'), ref: ids, at: pt, hand: num, was: pt, len: num, dir: pt }, ['on', 'ref', 'at', 'hand', 'was']);
const frame = shape({ atoms: ids, captions: ids, arrows: ids, shapes: ids, padX: num, padY: num, fit: bool }, ['atoms', 'captions', 'arrows', 'shapes']);
const stereoLabel = shape({ text: str, dx: num, dy: num, size: num, italic: bool, manual: bool });
const common: Record<string, Check> = { piece: num, ole: shape({ id: num, prog: str }), ppt: bool, id: num, grp: num, grpPath: ids, stack: num };

const atom = shape({
  ...common, x: place, y: place, z: (v) => num(v) && (v as number) >= 0 && (v as number) < 200,
  label: (v) => v === null || str(v), charge: num, isotope: num, just: oneOf('auto', 'left', 'right'),
  fileLabel: bool, color: str, s: num, face: num, font: str, marginWidth: num, xyz: (v) => listOf(num)(v) && (v as unknown[]).length === 3,
  depth: num, group: str, cdxInner: shape({ label: str, type: str, nick: str, xml: str, x: num, y: num }, ['label', 'type', 'xml']),
  alt: str, showCarbon: bool, asTyped: bool, bare: bool, hideCharge: bool, supDigits: bool, labelMarks: str,
  centred: bool, stacked: oneOf('up', 'down'), hDot: oneOf('dot', 'dash'), stackedLoose: bool, fixedDir: bool,
  showStereo: bool, stereoLabel, ignoreWarnings: bool, highlight: str, hl: data,
  radical: oneOf('singlet', 'doublet', 'triplet'), attach: str, attachNum: num, atomNumber: str, showNumber: bool,
  numberLabel: data, mapNo: num, focal: bool, enhStereo: shape({ type: oneOf('abs', 'and', 'or'), group: num }, ['type']),
  multi: ids, kekule: bool, variable: bool, ringOf: ids, pin,
}, ['x', 'y', 'z']);

const bond = shape({
  ...common, a1: num, a2: num, order: num,
  display: oneOf('solid', 'wedge', 'hashWedge', 'hash', 'bold', 'dash', 'wavy', 'dative', 'hollowWedge', 'wavyWedge', 'hydrogen', 'ionic'),
  dpos: oneOf('auto', 'left', 'right', 'center'), color: str, s: num, boldWidth: num, hashSpacing: num,
  marginWidth: num, bondLength: num, circle: bool, plain: bool, z: num, crossing: ids, line2: oneOf('dash', 'bold', 'hash'),
  beginAttach: num, endAttach: num, ignoreWarnings: bool, spokes: bool, showStereo: bool, stereoLabel, highlight: str, hl: data,
}, ['a1', 'a2', 'order']);

const caption = shape({
  ...common, x: place, y: place, runs, justify: oneOf('left', 'center', 'right', 'justify'), width: num,
  lineHeight: num, lineSpacing: num, inkLines: bool, wrap: num, paras, ph: data, boxH: num, refsBox: bool,
  attach: shape({ atoms: ids, gap: num, shift: num, show: listOf(str), adduct: str, sig: str, keepText: bool }, ['atoms']),
  ignoreWarnings: bool, results: bool, chem: bool, rot: num, name: str, hidden: bool, cols: num, colGap: num,
  fit: oneOf('shrink', 'fixed'), dir: oneOf('vert', 'vert270'), pin,
}, ['x', 'y', 'runs']);

const arrowHead = oneOf('none', 'full', 'halfLeft', 'halfRight');
const arrow = shape({
  ...common, tail: pt, head: pt, headStyle: arrowHead, tailStyle: arrowHead, headType: oneOf('solid', 'hollow', 'angle'), line: oneOf('solid', 'dashed', 'bold', 'wavy'), noGo: bool, noGoKind: str,
  dipole: bool, equilibrium: bool, boldWidth: num, hashSpacing: num, shaftSpacing: num, sweep: num,
  headLength: num, headWidth: num, headCenter: num, color: str, lineWidth: num, step: data, reagentFor: num,
  from: data, to: data, elbow: bool, morph: data, bez: listOf(pt),
  ellipse: shape({ center: pt, major: pt, minor: pt, angular: num }, ['center', 'major', 'minor']),
  pin: shape({ tail: pin, head: pin }), bent: bool, textLook: data, kind: str,
}, ['tail', 'head']);

const shapeRecord = shape({
  ...common, kind: oneOf('line', 'rect', 'oval', 'symbol', 'bracket', 'picture', 'table', 'geo', 'ring'), ring: ids, poly: listOf(pt), pin, geo: str, orbital: str, orb: data,
  text: (v) => v === null || shape({ runs, paras }, ['runs'])(v), textAlign: oneOf('left', 'center', 'right', 'justify'), textValign: oneOf('top', 'middle', 'bottom'),
  lineWidth: num, transparency: num, x1: place, y1: place, x2: place, y2: place, rot: num, dashed: bool,
  hashSpacing: num, dotted: bool, filled: bool, fill: oneOf('faded', 'shaded', 'gradient'), fill2: str, gradAngle: num, gradRadial: bool,
  pattern: oneOf('hatch', 'backhatch', 'crosshatch', 'horizontal', 'vertical', 'grid', 'dots', 'dense-dots'), patternColor: str, patternSize: num, patternTransparency: num, patternClear: bool,
  fillColor: str, fade: num, rounded: bool, radius: num, shadow: bool, shadowBetween: bool, shadowSize: num,
  shadowColor: str, shadowOpacity: num, shadowAngle: num, shadowBlur: num, glow: data, softEdge: num,
  bevel: data, reflection: data, picFill: data, bold: bool, symbol: str, bracket: oneOf('square', 'round', 'curly'),
  pair: bool, bracketPair: num, repeat: str, repeatLook: data, picture: bool, src: str,
  px: shape({ w: num, h: num }, ['w', 'h']), video: data, link: str, zoom: data,
  crop: shape({ l: num, t: num, r: num, b: num }, ['l', 't', 'r', 'b']), phPic: num, look: data, fx: data,
  color: str, z: num, alt: str, name: str, hidden: bool, locked: bool, table: data, chart: data, math: data,
  frame, editedOutside: bool, energy: data, newman: data, torsion: data, plate: data, diagram: data, smart: data,
  holder: shape({ runs }),
}, ['kind', 'x1', 'y1', 'x2', 'y2']);

/**
 * The contents of a whole-drawing copy when every object in it is sound (see above), with bonds
 * to atoms that aren't there left out; null when anything isn't, so the CDXML beside it is pasted.
 */
export function soundContents(c: unknown): Contents | null {
  if (!obj(c)) return null;
  const lists: Record<string, Check> = { atoms: atom, bonds: bond, captions: caption, arrows: arrow, shapes: shapeRecord };
  const got: Record<string, Obj[]> = {};
  for (const [k, check] of Object.entries(lists)) {
    const v = c[k];
    if (v === undefined) { got[k] = []; continue; }
    if (!Array.isArray(v)) return null;
    const seen = new Set<unknown>();
    for (const o of v) {
      // (each object once: two with one id would be one object pasted twice)
      if (!obj(o) || seen.has(o.id) || !check(o) || !num(o.id) || !finite(o)) return null;
      seen.add(o.id);
    }
    got[k] = v as Obj[];
  }
  if (!got.atoms.length && !got.captions.length && !got.arrows.length && !got.shapes.length) return null;
  const have = new Set(got.atoms.map((a) => a.id));
  // (a bond to an atom that isn't there is left out)
  got.bonds = got.bonds.filter((b) => have.has(b.a1) && have.has(b.a2) && b.a1 !== b.a2);
  return got as unknown as Contents;
}
