// This program's settings on one object that ChemDraw has no place for (standing rule R3: every
// field survives every file it can go into). They ride in one hidden object tag on the object's
// own element (MORE_TAG), which ChemDraw keeps and passes over, as it does this program's other
// tags (cdxml.ts). Things they name (a frame's atoms, a reagent arrow's step, a lone pair's atoms)
// are named by their elements' ids in the file, and found again by those ids on reading.
//
// A tag holds only what ChemDraw's own attributes cannot say, and only when it differs from what
// the reader works out from them (an untouched ChemDraw file saves unchanged). Where a value sits
// beside something ChemDraw can change (a label's text and faces, a bond's Z, a text's
// justification), the tag keeps a print of what it was written beside, and on reading the value
// is used only while the file still shows that: a file changed in ChemDraw keeps ChemDraw's.

import type { Arrow, Atom, Bond, Caption, Frame, MadeLabel, Pin, Shape, TextRun } from '../model';

/** The tag's name. */
export const MORE_TAG = 'Chem Illustrator settings';

/** What an object kind is called in a reference: atoms, bonds, captions, arrows, shapes. */
export type RefKind = 'a' | 'b' | 'c' | 'r' | 's';
/** An object's element id in the file, or null when it is not in it. */
export type RefOut = (kind: RefKind, id: number) => string | null;
/** The object an element id in the file became, or undefined. */
export type RefIn = (fileId: string) => { kind: RefKind; id: number } | undefined;

const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const vec = (x: unknown): x is { x: number; y: number } => !!x && typeof x === 'object' && num((x as { x?: unknown }).x) && num((x as { y?: unknown }).y);
const runsOk = (x: unknown): x is TextRun[] => Array.isArray(x) && x.every((r) => !!r && typeof r === 'object' && typeof (r as { text?: unknown }).text === 'string');

/** A pin with its atoms by their ids in the file (null when one of them is not in it). */
export function pinOut(p: Pin, ref: RefOut): Record<string, unknown> | null {
  const atoms = p.ref.map((id) => ref('a', id));
  if (atoms.some((x) => x === null)) return null;
  return { ...p, ref: atoms };
}

/** A pin read back (undefined when damaged or its atoms are gone). */
export function pinIn(v: unknown, ref: RefIn): Pin | undefined {
  const p = v as Partial<Record<keyof Pin, unknown>> | undefined;
  if (!p || (p.on !== 'atom' && p.on !== 'bond' && p.on !== 'gap') || !Array.isArray(p.ref) || !vec(p.at) || !num(p.hand) || !vec(p.was)) return undefined;
  const atoms = p.ref.map((x) => { const r = ref(String(x)); return r?.kind === 'a' ? r.id : undefined; });
  if (!atoms.length || atoms.some((x) => x === undefined)) return undefined;
  return {
    on: p.on, ref: atoms as number[], at: { x: p.at.x, y: p.at.y }, hand: p.hand, was: { x: p.was.x, y: p.was.y },
    ...(num(p.len) ? { len: p.len } : {}), ...(vec(p.dir) ? { dir: { x: p.dir.x, y: p.dir.y } } : {}),
  };
}

/** What the reader works out from a label's runs (cdxml.ts labelLookOf): raised digits and marks. */
export type LabelLook = { supDigits?: boolean; marks?: string };

/**
 * The print of a label as written: its text and each run's face, so a digit raised or lowered in
 * ChemDraw (the same text) no longer takes the settings kept for it.
 */
export function labelSeen(t: Element): string {
  const runs = Array.from(t.childNodes).filter((k): k is Element => k.nodeType === 1 && (k as Element).nodeName === 's');
  return `${runs.map((r) => r.textContent ?? '').join('')}|${runs.map((r) => r.getAttribute('face') ?? '0').join(',')}`;
}

/**
 * The tag's value for an atom (null when it needs none). `seen` is the label's print as written
 * (labelSeen), `look` what the reader will work out from its runs, `stereo` the stereo label's text,
 * `packed` that its depth goes in its structure's tag instead (fragMore).
 * Marks and raised digits set on the atom are kept only where they differ from `look` (not set,
 * the reader works them out from the runs as for any file).
 */
export function atomMore(a: Atom, seen: string | null, look: LabelLook, stereo: string | null, packed = false): Record<string, unknown> | null {
  const v: Record<string, unknown> = {};
  if (!packed && a.depth !== undefined && num(a.depth)) v.depth = a.depth;
  if (seen !== null) {
    const l: Record<string, unknown> = {};
    if (a.asTyped && a.label) { l.asTyped = true; l.label = a.label; }
    if (a.labelMarks !== undefined && a.labelMarks !== look.marks) l.marks = a.labelMarks;
    if (a.supDigits !== undefined && a.supDigits !== look.supDigits) l.supDigits = a.supDigits;
    if (Object.keys(l).length) v.label = { ...l, seen };
  }
  if (a.stereoLabel?.manual && stereo !== null) v.stereo = { manual: true, ...(a.stereoLabel.fromFile ? { fromFile: true } : {}), seen: stereo };
  return Object.keys(v).length ? v : null;
}

/** Puts an atom's settings from its tag back. `seen` is the label's print in the file now (labelSeen), `bonded` whether it has bonds. */
export function atomMoreIn(a: Atom, v: Record<string, unknown>, seen: string | null, bonded: boolean): void {
  if (num(v.depth)) a.depth = v.depth;
  const l = v.label as Record<string, unknown> | undefined;
  if (l && typeof l === 'object' && seen !== null && l.seen === seen) {
    if (typeof l.marks === 'string') a.labelMarks = l.marks;
    if (typeof l.supDigits === 'boolean') a.supDigits = l.supDigits;
    // typed on its own, it is shown just as typed until it is bonded (Doc.addBond)
    if (l.asTyped === true && typeof l.label === 'string' && !bonded) { a.asTyped = true; a.label = l.label; delete a.fileLabel; }
  }
  stereoIn(a, v.stereo);
}

/**
 * The print of the drawing order ChemDraw has where a bond crosses others: its Z and the Z of each
 * bond it crosses (CrossingBonds, found by id with `bond`). A place among crossing bonds means
 * something only beside the others' places, so Bring to Front or Send to Back in ChemDraw on any
 * of them leaves ChemDraw's order for all of them.
 */
export function zPrint(e: Element, bond: (id: string) => Element | null): string {
  const others = (e.getAttribute('CrossingBonds') ?? '').trim().split(/\s+/).filter(Boolean)
    .map((id) => bond(id)?.getAttribute('Z') ?? '').sort();
  return [e.getAttribute('Z') ?? '', ...others].join(' ');
}

/**
 * The tag's value for a bond (null when it needs none). `fileZ` is the Z the reader takes from the
 * element itself, if any, and `zAt` the print of its order among the bonds it crosses as written
 * (zPrint): a place among crossing bonds is used again only while ChemDraw's order there is unchanged.
 */
export function bondMore(b: Bond, stereo: string | null, fileZ: number | undefined, zAt: string | null, packed = false): Record<string, unknown> | null {
  const v: Record<string, unknown> = {};
  if (!packed && b.z !== undefined && num(b.z) && b.z !== fileZ) { v.z = b.z; v.zAt = zAt; }
  if (b.stereoLabel?.manual && stereo !== null) v.stereo = { manual: true, ...(b.stereoLabel.fromFile ? { fromFile: true } : {}), seen: stereo };
  return Object.keys(v).length ? v : null;
}

/** Puts a bond's settings from its tag back. `zAt` is the print of its order in the file now (zPrint). */
export function bondMoreIn(b: Bond, v: Record<string, unknown>, zAt: string | null): void {
  if (num(v.z) && (v.zAt ?? null) === zAt) b.z = v.z;
  stereoIn(b, v.stereo);
}

/** A structure's atoms (<n>) and bonds (<b>) in the order they stand in its <fragment>. */
function fragParts(f: Element): { ns: Element[]; bs: Element[] } {
  const ns: Element[] = [], bs: Element[] = [];
  for (let k = f.firstElementChild; k; k = k.nextElementSibling) {
    if (k.nodeName === 'n') ns.push(k);
    else if (k.nodeName === 'b') bs.push(k);
  }
  return { ns, bs };
}

/** A short hash of a text (FNV-1a, 32 bits, as 8 hex digits). */
function hash(t: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

/**
 * The print of a structure as written, whatever its ids: each atom's element and kind in order, and
 * each bond's ends by their places among the atoms. While it holds, the values kept for its atoms
 * and bonds (fragMore) go back by place, even after ChemDraw gave everything new ids.
 */
export function fragPrint(f: Element): string {
  const { ns, bs } = fragParts(f);
  const at = new Map(ns.map((n, i) => [n.getAttribute('id') ?? '', i]));
  return hash(ns.map((n) => `${n.getAttribute('Element') ?? '6'}:${n.getAttribute('NodeType') ?? ''}`).join(';') + '|'
    + bs.map((b) => `${at.get(b.getAttribute('B') ?? '') ?? '?'}-${at.get(b.getAttribute('E') ?? '') ?? '?'}`).join(';'));
}

/** One atom's own print: its element and how many bonds of its structure end at it. */
function atomPrint(n: Element, ends: Map<string, number>): string {
  return `${n.getAttribute('Element') ?? '6'}:${ends.get(n.getAttribute('id') ?? '') ?? 0}`;
}

function endsOf(bs: Element[]): Map<string, number> {
  const ends = new Map<string, number>();
  for (const b of bs) for (const k of [b.getAttribute('B'), b.getAttribute('E')]) if (k) ends.set(k, (ends.get(k) ?? 0) + 1);
  return ends;
}

/** A bond's own place among crossing bonds to keep, and its print (zPrint), or null. */
export type BondZ = { z: number; at: string | null } | null;

/**
 * One tag for a structure (its <fragment>) with the values its atoms or bonds may carry: 3-D depth
 * for atoms, a place among crossing bonds for bonds (with each one's own print, zPrint). One tag per
 * structure instead of one per atom and bond keeps a file of many 3-D structures small (F7b R09,
 * Nate: fine as long as ChemDraw still draws the file the same; it passes over tags it doesn't know).
 * `depths` and `zs` are in the order of the fragment's <n> and <b> children (null where one has
 * none). Each value is kept with its element's id and its own print (element and bond count for an
 * atom), and the whole with the structure's print (fragPrint), so on reading (fragMoreIn):
 * - while the structure's print holds, the values go back by place (ids renumbered, atoms moved);
 * - otherwise each goes back to the element with its id while that atom's own print holds, so an
 *   atom added, deleted or changed in ChemDraw drops only its own value (review F8a-R06).
 * Null when no atom or bond needs anything.
 */
export function fragMore(f: Element, depths: (number | null)[], zs: BondZ[]): Record<string, unknown> | null {
  const { ns, bs } = fragParts(f);
  const ends = endsOf(bs);
  const v: Record<string, unknown> = {};
  const ad: [number, string, string, number][] = [];
  depths.forEach((d, i) => { if (d !== null && ns[i]) ad.push([i, ns[i].getAttribute('id') ?? '', atomPrint(ns[i], ends), d]); });
  const bz: [number, string, number, string | null][] = [];
  zs.forEach((z, i) => { if (z && bs[i]) bz.push([i, bs[i].getAttribute('id') ?? '', z.z, z.at]); });
  if (ad.length) v.depth = ad;
  if (bz.length) v.z = bz;
  if (!Object.keys(v).length) return null;
  v.at = fragPrint(f);
  return v;
}

/**
 * Puts a structure's values from its tag back (fragMore). `f` is the <fragment> in the file now,
 * `atomOf` and `bondOf` what an <n> or <b> element became, and `zNow` each bond element's order
 * among crossing bonds now (zPrint).
 */
export function fragMoreIn(v: Record<string, unknown>, f: Element, atomOf: (n: Element) => Atom | undefined, bondOf: (b: Element) => Bond | undefined, zNow: (el: Element) => string): void {
  const { ns, bs } = fragParts(f);
  const whole = v.at === fragPrint(f);
  const ends = endsOf(bs);
  const nById = new Map(ns.map((n) => [n.getAttribute('id') ?? '', n]));
  const bById = new Map(bs.map((b) => [b.getAttribute('id') ?? '', b]));
  if (Array.isArray(v.depth)) for (const e of v.depth) {
    if (!Array.isArray(e) || !Number.isInteger(e[0]) || typeof e[1] !== 'string' || typeof e[2] !== 'string' || !num(e[3])) continue;
    const n = whole ? ns[e[0]] : nById.get(e[1]);
    if (!n || (!whole && atomPrint(n, ends) !== e[2])) continue;
    const a = atomOf(n);
    if (a) a.depth = e[3];
  }
  if (Array.isArray(v.z)) for (const e of v.z) {
    if (!Array.isArray(e) || !Number.isInteger(e[0]) || typeof e[1] !== 'string' || !num(e[2])) continue;
    const el = whole ? bs[e[0]] : bById.get(e[1]);
    if (!el || (e[3] ?? null) !== zNow(el)) continue;
    const b = bondOf(el);
    if (b) b.z = e[2];
  }
}

/** A stereo label typed by hand stays typed by hand while ChemDraw shows the text it was given. */
function stereoIn(o: Atom | Bond, s: unknown): void {
  const st = s as { manual?: unknown; fromFile?: unknown; seen?: unknown } | undefined;
  if (!st || st.manual !== true || !o.stereoLabel || o.stereoLabel.text !== st.seen) return;
  const { fromFile: _f, ...rest } = o.stereoLabel;
  o.stereoLabel = { ...rest, manual: true, ...(st.fromFile === true ? { fromFile: true } : {}) };
}

/**
 * A caption's text box settings that ChemDraw's text has no place for. `fileWidth` is the width the
 * reader takes from the element itself, if any, and `at` the print of what lines the text up in
 * ChemDraw (captionAt): a width is used again only while that is unchanged.
 */
export function captionMore(c: Caption, fileWidth: number | undefined, at: string, seen = ''): Record<string, unknown> | null {
  const v: Record<string, unknown> = {};
  const marks = runMarks(c.runs);
  if (marks.length) { v.marks = marks; v.marksAt = seen; }
  if (c.width !== undefined && num(c.width) && !(fileWidth !== undefined && Math.abs(c.width - fileWidth) < 0.005)) { v.width = c.width; v.widthAt = at; }
  if (c.cols !== undefined && num(c.cols)) v.cols = c.cols;
  if (c.colGap !== undefined && num(c.colGap)) v.colGap = c.colGap;
  if (c.fit) v.fit = c.fit;
  return Object.keys(v).length ? v : null;
}

/** What lines a text up in ChemDraw: its justification (none is on the left) and wrap width (as a number). */
export function captionAt(t: Element): string {
  const j = t.getAttribute('Justification') ?? t.getAttribute('CaptionJustification') ?? 'Left';
  const ww = Number(t.getAttribute('WordWrapWidth'));
  return `${j}|${ww > 0 ? ww.toFixed(2) : ''}`;
}

/** Puts a caption's settings from its tag back. `at` is captionAt of the element in the file now. */
export function captionMoreIn(c: Caption, v: Record<string, unknown>, at: string, seen = ''): void {
  if (Array.isArray(v.marks) && v.marksAt === seen) c.runs = withMarks(c.runs, v.marks);
  if (num(v.width) && v.width > 0 && v.widthAt === at) c.width = v.width;
  if (num(v.cols) && v.cols >= 1) c.cols = Math.round(v.cols);
  if (num(v.colGap) && v.colGap >= 0) c.colGap = v.colGap;
  if (v.fit === 'shrink' || v.fit === 'fixed') c.fit = v.fit;
}

/**
 * The print of a text as written: the characters of its runs (<s>) in order. A text's highlight
 * and language (marks) are used again only while ChemDraw shows the same characters, so text
 * edited or replaced there never gets them on the wrong letters (Nate, F8a item 8).
 */
export function textSeen(t: Element): string {
  let s = '';
  for (let k = t.firstElementChild; k; k = k.nextElementSibling) if (k.nodeName === 's') s += k.textContent ?? '';
  return s;
}

/**
 * A text's highlight and language, which ChemDraw's text style has no place for (its style is a
 * font, size, face and colour only: CDX SDK, CDXString and Style): [from, to, highlight, lang] per
 * stretch of characters that has either, by place in the text's runs.
 */
export function runMarks(runs: readonly TextRun[]): [number, number, string | null, string | null][] {
  const out: [number, number, string | null, string | null][] = [];
  let at = 0;
  for (const r of runs) {
    const n = r.text.length, hl = r.highlight ?? null, lang = r.lang ?? null;
    if (n && (hl || lang)) {
      const last = out[out.length - 1];
      if (last && last[1] === at && last[2] === hl && last[3] === lang) last[1] = at + n;
      else out.push([at, at + n, hl, lang]);
    }
    at += n;
  }
  return out;
}

/** The runs with the marks (runMarks) put back, split where a mark starts or ends; marks past the text's end are left out. */
export function withMarks(runs: readonly TextRun[], marks: unknown[]): TextRun[] {
  const total = runs.reduce((n, r) => n + r.text.length, 0);
  const ok = marks.filter((m): m is [number, number, string | null, string | null] =>
    Array.isArray(m) && Number.isInteger(m[0]) && Number.isInteger(m[1]) && m[0] >= 0 && m[1] > m[0] && m[1] <= total &&
    (m[2] === null || (typeof m[2] === 'string' && /^#[0-9a-f]{6}$/i.test(m[2]))) && (m[3] === null || (typeof m[3] === 'string' && /^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$/.test(m[3]))));
  if (!ok.length) return runs as TextRun[];
  const cuts = new Set<number>();
  for (const m of ok) { cuts.add(m[0]); cuts.add(m[1]); }
  const out: TextRun[] = [];
  let at = 0;
  for (const r of runs) {
    const end = at + r.text.length;
    const inner = [...cuts].filter((x) => x > at && x < end).sort((a, b) => a - b);
    let from = at;
    for (const x of [...inner, end]) {
      if (x > from || !r.text.length) {
        const piece: TextRun = { ...r, text: r.text.slice(from - at, x - at) };
        const m = ok.find((k) => k[0] <= from && k[1] >= x && x > from);
        if (m) { if (m[2]) piece.highlight = m[2]; if (m[3]) piece.lang = m[3]; }
        out.push(piece);
      }
      from = x;
    }
    at = end;
  }
  return out;
}

/** An arrow's settings: bent by hand, and the step a catalytic cycle's reagent arrow feeds (by its arrow's id in the file). */
export function arrowMore(r: Arrow, ref: RefOut): Record<string, unknown> | null {
  const v: Record<string, unknown> = {};
  if (r.bent) v.bent = true;
  const feeds = r.reagentFor !== undefined ? ref('r', r.reagentFor) : null;
  if (feeds !== null) v.reagentFor = feeds;
  return Object.keys(v).length ? v : null;
}

export function arrowMoreIn(r: Arrow, v: Record<string, unknown>, ref: RefIn): void {
  if (v.bent === true) r.bent = true;
  if (v.reagentFor !== undefined) {
    const to = ref(String(v.reagentFor));
    if (to?.kind === 'r') r.reagentFor = to.id;
  }
}

/** A frame's members by their ids in the file (ones not in it are left out). */
function frameOut(f: Frame, ref: RefOut): Record<string, string[]> {
  const ids = (kind: RefKind, list: number[]) => list.map((id) => ref(kind, id)).filter((x): x is string => x !== null);
  return { atoms: ids('a', f.atoms), captions: ids('c', f.captions), arrows: ids('r', f.arrows), shapes: ids('s', f.shapes) };
}

/** A shape's settings: its name and hidden (Selection Pane, Layers), a placeholder's label, a frame's made labels and members, and a pin. */
export function shapeMore(s: Shape, ref: RefOut): Record<string, unknown> | null {
  const v: Record<string, unknown> = {};
  if (s.name !== undefined) v.name = s.name;
  if (s.hidden) v.hidden = true;
  if (s.holder) v.holder = s.holder;
  if (s.madeLabels?.length) v.madeLabels = s.madeLabels;
  if (s.frame) {
    const m = frameOut(s.frame, ref);
    if (m.atoms.length + m.captions.length + m.arrows.length + m.shapes.length) v.frame = m;
  }
  const pin = s.pin ? pinOut(s.pin, ref) : null;
  if (pin) v.pin = pin;
  return Object.keys(v).length ? v : null;
}

export function shapeMoreIn(s: Shape, v: Record<string, unknown>, ref: RefIn): void {
  if (typeof v.name === 'string') s.name = v.name;
  if (v.hidden === true) s.hidden = true;
  const h = v.holder as { runs?: unknown } | undefined;
  if (h && typeof h === 'object') s.holder = runsOk(h.runs) ? { runs: h.runs } : {};
  if (Array.isArray(v.madeLabels)) {
    const made = v.madeLabels.filter((m): m is MadeLabel => !!m && typeof m === 'object' && typeof (m as MadeLabel).text === 'string' && runsOk((m as MadeLabel).runs));
    if (made.length) s.madeLabels = made.map((m) => ({ text: m.text, runs: m.runs, ...(m.atom ? { atom: true as const } : {}) }));
  }
  const fm = v.frame as Record<string, unknown> | undefined;
  if (s.frame && fm && typeof fm === 'object') {
    const ids = (kind: RefKind, list: unknown) => (Array.isArray(list) ? list : []).map((x) => ref(String(x))).filter((r): r is { kind: RefKind; id: number } => r?.kind === kind).map((r) => r.id);
    s.frame = { ...s.frame, atoms: ids('a', fm.atoms), captions: ids('c', fm.captions), arrows: ids('r', fm.arrows), shapes: ids('s', fm.shapes) };
  }
  const pin = pinIn(v.pin, ref);
  if (pin) s.pin = pin;
}
