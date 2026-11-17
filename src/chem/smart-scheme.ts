// Smart Schemes: a reaction scheme or a catalytic cycle kept as one object, like SmartArt. The
// scheme's structures, text and arrows stay ordinary things on the page; an invisible frame round
// them holds how the scheme is laid out (in a line, in rows, as a snake, down the page, or round a
// cycle). Its species are its slots, in the order the arrows join them, read afresh from the
// arrows' roles each time, so a Smart Scheme saved to a file and opened again (where every id
// changes) is still the same scheme.
//
// Slots can be added, taken out and put in another order; each time the arrows are joined up
// again and the scheme is laid out again, the conditions going with their arrows. A species moved
// by hand keeps its new place, and the arrows to and from it follow it.

import type { Arrow, Caption, Doc, Entity, Frame, Shape, StepRoles, TextRun } from '../model';
import { arcCenter, type Rect, type Vec } from '../geom';
import { chemRuns } from '../text/chemtext';
import { plainText } from '../richtext';
import { frameBox, frameMembers } from '../editor/frames';
import type { Measure, Selection } from '../editor/arrange';
import { applyArrange, planArrange, readScheme, schemeNet, type ArrangeKind, type Scope } from './scheme-arrange';
import { crowdedLinks, type NetJoin } from './cycle-net';
import type { Item } from './reaction';
import { spacing, withSchemePrefs } from './scheme-layout';
import { cleanFormat, formatPrefs, restyleSmart, type SmartFormat } from './smart-format';
import { arrowMid, sweepThrough } from '../objects';
import { bezFrom, pathPoints } from '../arrow-path';
import { alongCurve, cycleCurves, fitEllipse, ontoEllipse, type Ellipse } from './cycle-path';
import { fullName, shortName } from './step-names';

export type SmartLayout = Extract<ArrangeKind, 'line' | 'rows' | 'snake' | 'down' | 'cycle'>;

export const SMART_LAYOUTS: { id: SmartLayout; name: string; tip: string }[] = [
  { id: 'line', name: 'Line', tip: 'Every step in one line, left to right' },
  { id: 'rows', name: 'Rows', tip: 'Steps in rows, each row starting again on the left' },
  { id: 'snake', name: 'Snake', tip: 'Steps in rows, every other row running back' },
  { id: 'down', name: 'Down', tip: 'Every step down the page' },
  { id: 'cycle', name: 'Cycle', tip: 'Around a catalytic cycle, the last step back to the first species. A cycle can have several loops and species off it' },
];

/** How a Smart Scheme is laid out, kept on its frame. */
export interface SmartData {
  layout: SmartLayout;
  /** Rows and snake: steps in each row. */
  perRow?: number;
  /** Cycle: round anticlockwise (clockwise when not set). */
  anticlockwise?: boolean;
  /** Cycle: what comes in and goes out on small curved arrows. */
  reagentArrows?: boolean;
  /**
   * Laid out by hand (a scheme that branches): its slots can be retyped and its arrows follow its
   * species, but it isn't laid out again by itself. A cycle of several loops is not: whatever this
   * says (files from before loops were read from the arrows say it), it is laid out as its loops.
   */
  free?: boolean;
  /** Its own font, text sizes, arrows and spacing (from the gear on its species list); unset parts follow the drawing style. */
  fmt?: SmartFormat;
}

/** One species of the scheme: what it holds and where it is. */
export interface Slot {
  items: Item[];
  /** Compound numbers and labels beside it, which go where it goes. */
  labels: Item[];
  box: Rect;
  /** Its text, when it is one text box and no structure (the species list lets it be typed). */
  caption?: number;
  /** Its dashed box, when it is waiting for a structure to be drawn or pasted in. */
  holder?: number;
}

/** One step: its arrow, the slots it joins (by index) and its conditions. */
export interface SmartLink {
  arrow: Arrow;
  from: number;
  to: number;
  above: Item[];
  below: Item[];
  inside: Item[];
  plusses: Item[];
}

/**
 * A cycle of more than one loop, or with species off it: the loops its steps make, how each is
 * joined to one before it, and its branches. Species are named by their slot, steps by their
 * place in `links`.
 */
export interface SmartNet {
  /** `own`: the species that are this loop's (not the ones it shares with the loop it joins). */
  loops: { slots: number[]; links: number[]; own: number[] }[];
  /** One for each loop after the first: `node` and `path` are slots, `a` and `b` steps. */
  joins: NetJoin[];
  /** Species off the cycle, in a row leading away from slot `at`. */
  tails: { at: number; slots: number[]; links: number[] }[];
}

export interface SmartRead {
  slots: Slot[];
  /** The steps in order: link k goes from slot k to slot k + 1 (a closed cycle's last back to slot 0). */
  links: SmartLink[];
  closed: boolean;
  /** The steps join the species in one line or loop. */
  chain: boolean;
  /** Set when the steps make several loops, or a loop with branches (never with `chain`). */
  net?: SmartNet;
}

/** How a Smart Scheme is laid out: what its data says, but several loops are always a cycle. */
export function smartLayoutOf(data: SmartData, read: SmartRead | null): SmartLayout {
  return read?.net ? 'cycle' : data.layout;
}

/** Whether a Smart Scheme keeps the layout it was given by hand (one that branches without making loops). */
export function smartIsFree(data: SmartData, read: SmartRead | null): boolean {
  return !!data.free && !read?.net;
}

const LAYOUT_IDS = new Set<string>(SMART_LAYOUTS.map((l) => l.id));

/** A Smart Scheme's data from a file: null unless it is sensible. */
export function cleanSmart(raw: unknown): SmartData | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.layout !== 'string' || !LAYOUT_IDS.has(r.layout)) return null;
  const out: SmartData = { layout: r.layout as SmartLayout };
  if (typeof r.perRow === 'number' && r.perRow >= 1 && r.perRow <= 20) out.perRow = Math.round(r.perRow);
  if (r.anticlockwise === true) out.anticlockwise = true;
  if (r.reagentArrows === true) out.reagentArrows = true;
  if (r.free === true) out.free = true;
  const fmt = cleanFormat(r.fmt);
  if (fmt) out.fmt = fmt;
  return out;
}

/** The Smart Scheme a thing belongs to (its frame's id), if any. */
export function smartFrameOf(doc: Doc, kind: 'atom' | 'bond' | 'caption' | 'arrow' | 'shape', id: number): number | null {
  if (kind === 'shape' && doc.shapes.get(id)?.smart) return id;
  for (const s of doc.shapes.values()) {
    if (!s.smart || !s.frame) continue;
    const f = s.frame;
    if (kind === 'caption' && f.captions.includes(id)) return s.id;
    if (kind === 'arrow' && f.arrows.includes(id)) return s.id;
    if (kind === 'shape' && f.shapes.includes(id)) return s.id;
    if (kind === 'atom' || kind === 'bond') {
      const atom = kind === 'atom' ? id : doc.bonds.get(id)?.a1;
      if (atom !== undefined && f.atoms.some((a) => a === atom || (doc.atoms.has(a) && doc.fragmentOf(a).has(atom)))) return s.id;
    }
  }
  return null;
}

function scopeOf(doc: Doc, f: Frame): Scope {
  const m = frameMembers(doc, f);
  return { atoms: m.atoms, captions: m.captions, arrows: m.arrows, shapes: m.shapes };
}

/** Read a Smart Scheme: its slots in order and the steps between them. */
export function readSmart(doc: Doc, m: Measure, frameId: number): SmartRead | null {
  const s = doc.shapes.get(frameId);
  if (!s?.smart || !s.frame) return null;
  const scope = scopeOf(doc, s.frame);
  if (!scope.atoms.size && !scope.captions.size && !scope.arrows.size && !scope.shapes.size) return null;
  return readSlots(doc, m, scope);
}

/** Any scheme (the arrows and species in `scope`, or the whole drawing when it is empty) read as slots in arrow order, as a Smart Scheme's are. */
export function readSlots(doc: Doc, m: Measure, scope: Scope): SmartRead | null {
  const sh = readScheme(doc, m, scope);
  // several loops, or a loop with branches: its species in loop order
  const found = sh.path ? null : schemeNet(sh);
  const order = sh.path ?? found?.net.order ?? sh.nodes.map((_, i) => i);
  const at = new Map(order.map((n, i) => [n, i]));
  const slots: Slot[] = order.map((n) => {
    const node = sh.nodes[n];
    const items = node.items.filter((it) => !it.plus);
    const labels = items.flatMap((it) => sh.labels.get(it) ?? []);
    const only = items.length === 1 && items[0].caption !== undefined ? items[0].caption : undefined;
    const holder = items.length === 1 && items[0].shape !== undefined && doc.shapes.get(items[0].shape)?.holder ? items[0].shape : undefined;
    return { items, labels, box: node.box, ...(only !== undefined ? { caption: only } : {}), ...(holder !== undefined ? { holder } : {}) };
  });
  const got: { link: SmartLink; from: number }[] = [];
  sh.links.forEach((l, i) => {
    if (!l.arrow) return;
    const from = at.get(l.from), to = at.get(l.to);
    if (from === undefined || to === undefined) return;
    got.push({ link: { arrow: l.arrow, from, to, above: l.above, below: l.below, inside: l.inside, plusses: l.plusses }, from: i });
  });
  got.sort((a, b) => a.link.from - b.link.from || a.from - b.from);
  const links = got.map((g) => g.link);
  const chain = !!sh.path && links.every((l, i) => l.from === i && l.to === (i + 1) % slots.length);
  if (!found) return { slots, links, closed: sh.closed, chain };
  const linkAt = new Map(got.map((g, k) => [g.from, k]));
  const sl = (n: number) => at.get(n)!, lk = (i: number) => linkAt.get(i)!;
  const net = found.net;
  const joins = net.joins.map((j): NetJoin => (j.kind === 'share' ? { ...j, node: sl(j.node) } : j.kind === 'fused' ? { ...j, path: j.path.map(sl) } : j.kind === 'mesh' ? { ...j, a: lk(j.a), b: lk(j.b) } : j));
  const loops = net.loops.map((lp, i) => {
    const j = joins.find((x) => x.child === i);
    const theirs = j?.kind === 'share' ? [j.node] : j?.kind === 'fused' ? j.path : [];
    const mine = lp.nodes.map(sl);
    return { slots: mine, links: lp.links.map(lk), own: mine.filter((x) => !theirs.includes(x)) };
  });
  return { slots, links, closed: false, chain: false, net: { loops, joins, tails: net.tails.map((t) => ({ at: sl(t.at), slots: t.nodes.map(sl), links: t.links.map(lk) })) } };
}

/** A slot's name, for the species list: its text, or what kind of thing it is. */
export function slotName(doc: Doc, slot: Slot): string {
  if (slot.caption !== undefined) return plainText(doc.captions.get(slot.caption)?.runs ?? []);
  if (slot.holder !== undefined) return 'Structure: draw or paste in the box';
  const atoms = slot.items.filter((it) => it.atoms.length).length;
  const pics = slot.items.filter((it) => it.shape !== undefined).length;
  const texts = slot.items.filter((it) => it.caption !== undefined).map((it) => plainText(doc.captions.get(it.caption!)?.runs ?? []));
  const parts: string[] = [];
  if (atoms) parts.push(atoms > 1 ? `${atoms} structures` : 'Structure');
  if (pics) parts.push(pics > 1 ? `${pics} pictures` : 'Picture');
  parts.push(...texts);
  return parts.join(' + ') || '…';
}

/**
 * Caption runs as the text typed in the species list: subscripts and superscripts written with
 * _ and ^ (as the ready-made cycles are written), formula digits left plain where they drop
 * by themselves.
 */
export function runsMarkup(runs: TextRun[]): string {
  const explicit = runs.map((r) => (r.sub ? `_{${r.text}}` : r.sup ? `^{${r.text}}` : r.text)).join('');
  const plain = runs.map((r) => (r.sub && /^\d+$/.test(r.text) ? r.text : r.sub ? `_{${r.text}}` : r.sup ? `^{${r.text}}` : r.text)).join('');
  const same = (a: { text: string; sub?: boolean; sup?: boolean }[], b: TextRun[]) => {
    const flat = (xs: { text: string; sub?: boolean; sup?: boolean }[]) => xs.flatMap((x) => [...x.text].map((ch) => `${ch}${x.sub ? 'b' : x.sup ? 'p' : ''}`)).join('|');
    return flat(a) === flat(b);
  };
  const tidy = (t: string) => t.replace(/_\{(.)\}/g, '_$1').replace(/\^\{(.)\}/g, '^$1');
  if (same(chemRuns(tidy(plain)), runs)) return tidy(plain);
  if (same(chemRuns(plain), runs)) return plain;
  return explicit;
}

/** Text typed in the species list as caption runs (keeping the font, size and colour of `like`). */
export function markupRuns(text: string, like?: TextRun): TextRun[] {
  return partsRuns(chemRuns(text), like);
}

/** Pieces of text, each plain, subscript or superscript, as caption runs (keeping the font, size and colour of `like`). */
export type TextPart = { text: string; sub?: boolean; sup?: boolean; bold?: boolean; italic?: boolean; underline?: boolean };
/**
 * Pieces as runs in the look of `like` (the text's first run). With `ownLooks`, bold, italic and
 * underline come with each piece (the n of n-BuLi in italics, typed in the Smart Scheme pane),
 * not from the first run.
 */
export function partsRuns(parts: TextPart[], like?: TextRun, ownLooks = false): TextRun[] {
  const base: Partial<TextRun> = like ? { ...like } : {};
  delete base.sub; delete base.sup; delete base.text; delete base.formula;
  if (ownLooks) { delete base.bold; delete base.italic; delete base.underline; }
  const out = parts.filter((p) => p.text).map((p) => ({ ...base, text: p.text, ...(p.sub ? { sub: true } : p.sup ? { sup: true } : {}), ...(p.bold ? { bold: true } : {}), ...(p.italic ? { italic: true } : {}), ...(p.underline ? { underline: true } : {}) }) as TextRun);
  return out.length ? out : [{ ...base, text: '' } as TextRun];
}

const partsPlain = (parts: TextPart[]) => parts.map((p) => p.text).join('');

/** Put a new Smart Scheme round the selection. Returns the frame's id, or null when there is no scheme there. Call inside an edit. */
export function makeSmart(doc: Doc, m: Measure, sel: Selection, data?: Partial<SmartData>): number | null {
  const f: Frame = {
    atoms: [...sel.atoms], captions: [...sel.captions], arrows: [...sel.arrows],
    shapes: [...sel.shapes].filter((id) => !doc.shapes.get(id)?.frame), padX: 0, padY: 0, fit: true,
  };
  // the reagent arrows of a cycle's steps go with them
  const mine = new Set(f.arrows);
  for (const r of doc.arrows.values()) if (r.reagentFor !== undefined && mine.has(r.reagentFor) && !mine.has(r.id)) f.arrows.push(r.id);
  const scope = scopeOf(doc, f);
  const sh = readScheme(doc, m, scope);
  if (sh.nodes.length < 2 && !sh.links.length) return null;
  const pad = Math.round(0.3 * doc.style.bondLength * 10) / 10;
  f.padX = pad; f.padY = pad;
  const smart: SmartData = { layout: sh.closed ? 'cycle' : guessLayout(sh.nodes.map((n) => n.box), sh.path), ...data };
  // steps that make several loops are a cycle; ones that only branch keep the layout they have
  if (!sh.path) { if (schemeNet(sh)) smart.layout = 'cycle'; else smart.free = true; }
  const b = frameBox(doc, f, m);
  if (!b) return null;
  return doc.addShape({ kind: 'geo', geo: 'rect', ...b, filled: false, lineWidth: 0, color: '#000000', frame: f, smart, name: 'Smart Scheme' }).id;
}

/** How a scheme read in is laid out now: in a line, down the page, or in rows. */
function guessLayout(boxes: Rect[], path: number[] | null): SmartLayout {
  if (!path || path.length < 2) return 'line';
  const c = (i: number) => ({ x: (boxes[i].x1 + boxes[i].x2) / 2, y: (boxes[i].y1 + boxes[i].y2) / 2 });
  let across = 0, down = 0;
  for (let i = 1; i < path.length; i++) {
    const a = c(path[i - 1]), b = c(path[i]);
    if (Math.abs(b.x - a.x) >= Math.abs(b.y - a.y)) across++; else down++;
  }
  if (!across) return 'down';
  return down ? 'rows' : 'line';
}

/** Take a Smart Scheme apart: its frame goes, and what was in it stays as it is. Call inside an edit. */
export function ungroupSmart(doc: Doc, frameId: number): Selection | null {
  const s = doc.shapes.get(frameId);
  if (!s?.smart || !s.frame) return null;
  const members = frameMembers(doc, s.frame);
  doc.removeShape(frameId);
  return members;
}

/**
 * A step with another loop on its far side (at a species two loops share, where two loops turn
 * together, into or out of a stretch they share) has no room outside it, so what joins and
 * leaves there is written inside the loop under the step's name, marked "+" and "−". Put the
 * marks on, and take them off steps that have room outside again (where small arrows show it).
 */
function markCrowded(doc: Doc, read: SmartRead, meshes?: [number, number][], unmark = false): void {
  const net = read.net;
  // (one loop on its own has room everywhere: its text is left as typed, unless a loop was just taken away)
  if (!net && !unmark) return;
  const crowd = net ? crowdedLinks(net.loops.map((lp) => ({ nodes: lp.slots, links: lp.links })), net.joins) : new Set<number>();
  for (const pair of meshes ?? []) read.links.forEach((l, k) => { if (pair.includes(l.arrow.id)) crowd.add(k); });
  const mark = (its: Item[], sign: '+ ' | '− ', on: boolean) => {
    for (const it of its) {
      const c = it.caption !== undefined ? doc.captions.get(it.caption) : undefined;
      if (!c?.runs.length) continue;
      const has = plainText(c.runs).startsWith(sign);
      if (has === on) continue;
      const runs = c.runs.map((r) => ({ ...r }));
      if (on) {
        const like: Partial<TextRun> = { ...runs[0] };
        delete like.sub; delete like.sup; delete like.formula;
        runs.unshift({ ...like, text: sign } as TextRun);
      } else {
        let n = sign.length;
        while (n > 0 && runs.length) {
          const t = runs[0].text;
          if (t.length <= n) { n -= t.length; runs.shift(); } else { runs[0].text = t.slice(n); n = 0; }
        }
        if (!runs.length) continue;
      }
      doc.updateCaption(c.id, { runs });
    }
  };
  read.links.forEach((l, k) => { mark(l.above, '+ ', crowd.has(k)); mark(l.below, '− ', crowd.has(k)); });
}

/** Lay a Smart Scheme out again as its data says (or with `patch` to its data first). Call inside an edit. */
export function arrangeSmart(doc: Doc, m: Measure, frameId: number, patch?: Partial<SmartData>, meshes?: [number, number][], unmark = false): boolean {
  const s = doc.shapes.get(frameId);
  if (!s?.smart || !s.frame) return false;
  const read = readSmart(doc, m, frameId);
  const data: SmartData = { ...s.smart, ...patch };
  // several loops can only go round a cycle (and are never left as laid out by hand)
  if (read?.net) {
    if (patch?.layout && patch.layout !== 'cycle') return false;
    data.layout = 'cycle';
    delete data.free;
  }
  if (patch || data.layout !== s.smart.layout || data.free !== s.smart.free) doc.updateShape(frameId, { smart: data });
  if (!read || read.slots.length < 2 && data.layout !== 'cycle') return false;
  // a layout chosen by hand lays a free scheme out too, when its steps make one line or loop
  if (data.free && !patch?.layout) return false;
  // a cycle laid out in a line or rows loses the step from the last species back to the first
  if (data.layout !== 'cycle' && read.closed && read.links.length === read.slots.length) {
    const l = read.links[read.links.length - 1];
    for (const it of [...l.above, ...l.below, ...l.inside, ...l.plusses]) removeItem(doc, it);
    for (const r of [...doc.arrows.values()]) if (r.reagentFor === l.arrow.id) doc.removeArrow(r.id);
    doc.removeArrow(l.arrow.id);
  }
  // a cycle laid out again (a species added, removed or made a structure) keeps its middle where it was:
  // the middle of the circle its curved step arrows lie on
  const steps = read.links.map((l) => l.arrow.id);
  // (several loops keep their first loop where it is by themselves)
  const was = !read.net && s.smart.layout === 'cycle' && data.layout === 'cycle' ? circleMiddle(doc, steps) : null;
  if (data.layout === 'cycle') markCrowded(doc, read, meshes, unmark);
  // its own look first, so it is laid out at the sizes it will have
  restyleSmart(doc, frameId, data.fmt, smartParts(read));
  const scope = scopeOf(doc, doc.shapes.get(frameId)!.frame!);
  const first = read.slots[0]?.items[0]?.ref;
  const lay = () => {
    const plan = planArrange(doc, m, scope, {
      kind: data.layout, perRow: data.perRow ?? 3, anticlockwise: data.anticlockwise, reagentArrows: data.reagentArrows,
      ...(data.layout === 'cycle' && first && !read.net ? { start: first, startAngle: -Math.PI / 2 } : {}),
      ...(meshes ? { meshes } : {}),
    });
    return plan ? applyArrange(doc, m, plan, 'Arrange Smart Scheme') : null;
  };
  const own = formatPrefs(doc, data.fmt);
  const added = own ? withSchemePrefs(own, lay) : lay();
  if (!added) return false;
  const now = doc.shapes.get(frameId)!;
  const f = now.frame!;
  const arrows = [...f.arrows.filter((id) => doc.arrows.has(id)), ...added];
  doc.updateShape(frameId, { frame: { ...f, arrows }, ...(data.free ? { smart: { ...data, free: undefined } } : {}) });
  // the frame fits round it again now (as it would at the end of the change), so it is right in a file saved straight after
  const b = frameBox(doc, doc.shapes.get(frameId)!.frame!, m);
  const mid = was && circleMiddle(doc, steps);
  if (b && was && mid && Math.hypot(was.x - mid.x, was.y - mid.y) > 1e-6) {
    const dx = was.x - mid.x, dy = was.y - mid.y;
    moveFrameBy(doc, doc.shapes.get(frameId)!.frame!, dx, dy);
    doc.updateShape(frameId, { x1: b.x1 + dx, y1: b.y1 + dy, x2: b.x2 + dx, y2: b.y2 + dy });
  } else if (b) doc.updateShape(frameId, b);
  return true;
}

/** The middle of the circle a cycle's curved step arrows lie on (their arcs' centres, averaged), or null. */
function circleMiddle(doc: Doc, arrows: number[]): Vec | null {
  let x = 0, y = 0, n = 0;
  for (const id of arrows) {
    const r = doc.arrows.get(id);
    if (!r?.sweep || r.bez?.length) continue;
    const c = arcCenter(r.tail, r.head, r.sweep).center;
    x += c.x; y += c.y; n++;
  }
  return n ? { x: x / n, y: y / n } : null;
}

/** Move everything in a frame by (dx, dy). Call inside an edit. */
function moveFrameBy(doc: Doc, f: Frame, dx: number, dy: number): void {
  const mem = frameMembers(doc, f);
  doc.moveAtoms([...mem.atoms], dx, dy);
  for (const id of mem.captions) { const c = doc.captions.get(id); if (c) doc.updateCaption(id, { x: c.x + dx, y: c.y + dy }); }
  for (const id of mem.arrows) { const a = doc.arrows.get(id); if (a) doc.updateArrow(id, { tail: { x: a.tail.x + dx, y: a.tail.y + dy }, head: { x: a.head.x + dx, y: a.head.y + dy } }); }
  for (const id of mem.shapes) { const h = doc.shapes.get(id); if (h) doc.updateShape(id, { x1: h.x1 + dx, y1: h.y1 + dy, x2: h.x2 + dx, y2: h.y2 + dy }); }
}

/** The scheme's text: species typed as text, and the conditions on its arrows. */
function smartParts(read: SmartRead): { species: number[]; conditions: number[] } {
  const caps = (its: Item[]) => its.flatMap((it) => (it.caption !== undefined ? [it.caption] : []));
  return {
    species: read.slots.flatMap((s) => (s.caption !== undefined ? [s.caption] : [])),
    conditions: read.links.flatMap((l) => [...caps(l.above), ...caps(l.below), ...caps(l.inside)]),
  };
}

/**
 * Give the scheme its own look (the gear on its species list): undefined parts follow the
 * drawing style again. Its text and arrows change, and it is laid out again with its spacing
 * (one laid out by hand keeps its places). Call inside an edit.
 */
export function formatSmart(doc: Doc, m: Measure, frameId: number, fmt: SmartFormat | undefined): boolean {
  const s = doc.shapes.get(frameId);
  if (!s?.smart || !s.frame) return false;
  const was = s.smart.fmt;
  const data: SmartData = { ...s.smart };
  const clean = cleanFormat(fmt);
  if (clean) data.fmt = clean; else delete data.fmt;
  doc.updateShape(frameId, { smart: data });
  const read = readSmart(doc, m, frameId);
  if (!read) return false;
  // parts going back to the drawing style lose the look they were given
  const back: SmartFormat = {};
  const st = doc.style;
  if (was?.font !== undefined && clean?.font === undefined) back.font = st.captionFont;
  if (was?.speciesSize !== undefined && clean?.speciesSize === undefined) back.speciesSize = st.captionSize;
  if (was?.textSize !== undefined && clean?.textSize === undefined) back.textSize = st.arrowTextSize ?? st.captionSize;
  if (was?.arrowWidth !== undefined && clean?.arrowWidth === undefined) back.arrowWidth = st.lineWidth;
  if (was?.headType !== undefined && clean?.headType === undefined) back.headType = 'solid';
  if (was?.headLength !== undefined && clean?.headLength === undefined) back.headLength = st.lineWidth * 10;
  if (Object.keys(back).length) restyleSmart(doc, frameId, back, smartParts(read));
  if (smartIsFree(data, read)) { restyleSmart(doc, frameId, data.fmt, smartParts(read)); return true; }
  return arrangeSmart(doc, m, frameId) || true;
}

/** A step's roles, joining slot `a` to slot `b`, with its conditions. */
function roles(a: Slot, b: Slot, l: Pick<SmartLink, 'above' | 'below' | 'inside' | 'plusses'> | null): StepRoles {
  const refs = (its: Item[]) => its.map((it) => it.ref);
  return {
    reactants: refs(a.items), products: refs(b.items), above: refs(l?.above ?? []), below: refs(l?.below ?? []),
    ...(l?.plusses.length ? { plusses: refs(l.plusses) } : {}), ...(l?.inside.length ? { inside: refs(l.inside) } : {}), manual: true,
  };
}

/** Join the slots up in this order with these arrows (arrow k from slot k to slot k + 1, round to the first for a cycle). */
function relink(doc: Doc, slots: Slot[], links: (SmartLink | { arrow: Arrow; above: Item[]; below: Item[]; inside: Item[]; plusses: Item[] })[], closed: boolean): void {
  const n = slots.length;
  links.forEach((l, k) => {
    if (k + 1 >= n && !closed) return;
    doc.updateArrow(l.arrow.id, { step: roles(slots[k], slots[(k + 1) % n], l) });
  });
}

const DEFAULT_LOOK: Omit<Arrow, 'id' | 'tail' | 'head'> = {
  headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'solid', noGo: false, equilibrium: false, sweep: 0, headLength: 10, headWidth: 2.5,
};

/**
 * Add a slot after slot `after` (−1: before the first): a new species to type over, and a new
 * arrow joining it in. The scheme is laid out again. Returns the new species' text box. Call inside an edit.
 */
export function insertSlot(doc: Doc, m: Measure, frameId: number, after: number, text = 'new species', link?: number): number | null {
  const read = readSmart(doc, m, frameId);
  const s = doc.shapes.get(frameId);
  if (read?.net && s?.frame) return insertOnStep(doc, m, frameId, read, link ?? read.links.findIndex((l) => l.from === after), text);
  if (!read || !read.chain || !s?.frame) return null;
  const { slots, links, closed } = read;
  const k = Math.max(-1, Math.min(slots.length - 1, after));
  const near = slots[Math.max(0, k)]?.box ?? frameBox(doc, s.frame, m)!;
  const L = doc.style.bondLength;
  const cap = doc.addCaption({ x: near.x2 + 2 * L, y: (near.y1 + near.y2) / 2, runs: chemRuns(text), justify: 'center' });
  const like = links[0]?.arrow;
  const look = like ? { headStyle: like.headStyle, tailStyle: like.tailStyle, headType: like.headType, line: like.line, headLength: like.headLength, headWidth: like.headWidth, ...(like.color ? { color: like.color } : {}), ...(like.lineWidth ? { lineWidth: like.lineWidth } : {}) } : { headLength: doc.style.lineWidth * 10, headWidth: doc.style.lineWidth * 2.5 };
  const arrow = doc.addArrow({ ...DEFAULT_LOOK, ...look, sweep: 0, equilibrium: false, tail: { x: near.x2 + 0.5 * L, y: near.y2 }, head: { x: near.x2 + 1.5 * L, y: near.y2 } });
  const newSlot: Slot = { items: [{ ref: 'c' + cap.id, box: m.captionBox(cap), plus: false, atoms: [], caption: cap.id }], labels: [], box: m.captionBox(cap), caption: cap.id };
  const blank = { arrow, above: [], below: [], inside: [], plusses: [] };
  const nextSlots = [...slots.slice(0, k + 1), newSlot, ...slots.slice(k + 1)];
  // before the first species, the new one comes first (a cycle's last step then leads to it)
  const nextLinks = k < 0 ? [blank, ...links] : links[k] ? [...links.slice(0, k + 1), blank, ...links.slice(k + 1)] : [...links, blank];
  relink(doc, nextSlots, nextLinks, closed);
  const f = doc.shapes.get(frameId)!.frame!;
  doc.updateShape(frameId, { frame: { ...f, captions: [...f.captions, cap.id], arrows: [...f.arrows, arrow.id] } });
  arrangeSmart(doc, m, frameId);
  return cap.id;
}

/** An equilibrium arrow, as the arrow tool draws one (and as it is kept in files). */
const EQUILIBRIUM: Partial<Arrow> = { headStyle: 'halfLeft', tailStyle: 'halfLeft', equilibrium: true };

/** The look of a scheme's new arrows: its first arrow's (an equilibrium arrow's half heads aside). */
function arrowLike(doc: Doc, like: Arrow | undefined): Partial<Arrow> {
  return like
    ? { headStyle: like.equilibrium ? 'full' : like.headStyle, tailStyle: like.equilibrium ? 'none' : like.tailStyle, headType: like.headType, line: like.line, headLength: like.headLength, headWidth: like.headWidth, ...(like.color ? { color: like.color } : {}), ...(like.lineWidth ? { lineWidth: like.lineWidth } : {}) }
    : { headLength: doc.style.lineWidth * 10, headWidth: doc.style.lineWidth * 2.5 };
}

/** A new species to type over, as a slot (not yet in any step). */
function newSpecies(doc: Doc, m: Measure, at: Vec, text: string): Slot {
  const cap = doc.addCaption({ x: at.x, y: at.y, runs: chemRuns(text), justify: 'center' });
  return { items: [{ ref: 'c' + cap.id, box: m.captionBox(cap), plus: false, atoms: [], caption: cap.id }], labels: [], box: m.captionBox(cap), caption: cap.id };
}

/** A new step arrow from slot a to slot b (straight for now: laying out gives it its place). */
function newStep(doc: Doc, like: Arrow | undefined, a: Slot, b: Slot, extra: Partial<Arrow> = {}): Arrow {
  const p = mid(a.box), q = mid(b.box);
  return doc.addArrow({ ...DEFAULT_LOOK, ...arrowLike(doc, like), sweep: 0, equilibrium: false, ...extra, tail: p, head: Math.hypot(q.x - p.x, q.y - p.y) > 1 ? q : { x: p.x + doc.style.bondLength, y: p.y }, step: roles(a, b, null) });
}

/** Add what was made to a Smart Scheme's frame. */
function intoFrame(doc: Doc, frameId: number, slots: Slot[], arrows: Arrow[], captions: number[] = []): void {
  const f = doc.shapes.get(frameId)!.frame!;
  doc.updateShape(frameId, { frame: { ...f, captions: [...f.captions, ...slots.flatMap((sl) => (sl.caption !== undefined ? [sl.caption] : [])), ...captions], arrows: [...f.arrows, ...arrows.map((r) => r.id)] } });
}

/** In a cycle of several loops: a new species on step `link`, between the two it joins. */
function insertOnStep(doc: Doc, m: Measure, frameId: number, read: SmartRead, link: number, text: string): number | null {
  const l = read.links[link];
  if (!l) return null;
  const a = read.slots[l.from], b = read.slots[l.to];
  const pa = mid(a.box), pb = mid(b.box);
  const fresh = newSpecies(doc, m, { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 }, text);
  // the step keeps its arrow and conditions as far as the new species; a new arrow goes on from there
  doc.updateArrow(l.arrow.id, { step: roles(a, fresh, l) });
  const arrow = newStep(doc, read.links[0]?.arrow, fresh, b);
  intoFrame(doc, frameId, [fresh], [arrow]);
  arrangeSmart(doc, m, frameId, undefined, meshPairs(read));
  return fresh.caption!;
}

/** The pairs of step arrows that face each other where two loops turn together (to keep them so when laid out again after a change). */
function meshPairs(read: SmartRead, more: [number, number][] = []): [number, number][] | undefined {
  if (!read.net && !more.length) return undefined;
  const pairs = (read.net?.joins ?? []).flatMap((j): [number, number][] => (j.kind === 'mesh' ? [[read.links[j.a].arrow.id, read.links[j.b].arrow.id]] : []));
  return [...pairs, ...more];
}

/** Take a step away: its arrow, its conditions and its small in and out arrows. */
function dropStep(doc: Doc, l: SmartLink): void {
  for (const it of [...l.above, ...l.below, ...l.inside, ...l.plusses]) removeItem(doc, it);
  for (const r of [...doc.arrows.values()]) if (r.reagentFor === l.arrow.id) doc.removeArrow(r.id);
  doc.removeArrow(l.arrow.id);
}

/** Whether slot `k` of a cycle of several loops can be taken out by itself (a species two loops share, or one a branch hangs from, can't). */
export function canRemoveSlot(read: SmartRead, k: number): boolean {
  if (!read.net) return read.chain && read.slots.length > 2;
  const ins = read.links.filter((l) => l.to === k), outs = read.links.filter((l) => l.from === k);
  if (ins.length + outs.length === 1) return true;
  if (ins.length !== 1 || outs.length !== 1 || ins[0].from === outs[0].to) return false;
  // not when the species on either side are already joined by a step of their own
  return !read.links.some((l) => l.from === ins[0].from && l.to === outs[0].to);
}

/** Take slot `k` out, with the step leading on from it (or into it, for the last). The scheme is laid out again. Call inside an edit. */
export function removeSlot(doc: Doc, m: Measure, frameId: number, k: number): boolean {
  const read = readSmart(doc, m, frameId);
  if (read?.net) {
    if (!read.slots[k] || !canRemoveSlot(read, k)) return false;
    const into = read.links.find((l) => l.to === k), out = read.links.find((l) => l.from === k);
    const gone = read.slots[k];
    for (const it of [...gone.items, ...gone.labels]) removeItem(doc, it);
    const pairs = meshPairs(read)?.filter(([a, b]) => a !== (out ?? into)!.arrow.id && b !== (out ?? into)!.arrow.id);
    // the step out of it goes, and the step into it leads on to the next species (at the end of a branch its one step goes)
    if (into && out) { dropStep(doc, out); doc.updateArrow(into.arrow.id, { step: roles(read.slots[into.from], read.slots[out.to], into) }); }
    else dropStep(doc, (into ?? out)!);
    arrangeSmart(doc, m, frameId, undefined, pairs);
    return true;
  }
  if (!read || !read.chain || read.slots.length <= 2 || !read.slots[k]) return false;
  const { slots, links, closed } = read;
  const gone = slots[k];
  for (const it of [...gone.items, ...gone.labels]) removeItem(doc, it);
  // the step out of it goes; the last species of a line has none, so the step into it goes
  const drop = links.findIndex((l) => l.from === k) >= 0 ? links.findIndex((l) => l.from === k) : links.findIndex((l) => l.to === k);
  const l = links[drop];
  if (l) {
    for (const it of [...l.above, ...l.below, ...l.inside, ...l.plusses]) removeItem(doc, it);
    for (const r of [...doc.arrows.values()]) if (r.reagentFor === l.arrow.id) doc.removeArrow(r.id);
    doc.removeArrow(l.arrow.id);
  }
  const nextSlots = slots.filter((_, i) => i !== k);
  const nextLinks = links.filter((_, i) => i !== drop);
  relink(doc, nextSlots, nextLinks, closed);
  arrangeSmart(doc, m, frameId);
  return true;
}

/** Move slot `from` to place `to`; the arrows and their conditions stay in their places between. Call inside an edit. */
export function moveSlot(doc: Doc, m: Measure, frameId: number, from: number, to: number): boolean {
  const read = readSmart(doc, m, frameId);
  if (read?.net) {
    // within one loop's own species, or one branch: the species change places, the steps stay
    const run = [...read.net.loops.map((lp) => lp.own), ...read.net.tails.map((t) => t.slots)].find((r) => r.includes(from) && r.includes(to));
    if (!run || from === to) return false;
    const next = [...run];
    next.splice(next.indexOf(from), 1);
    next.splice(run.indexOf(to), 0, from);
    const now = new Map(run.map((place, i) => [place, read.slots[next[i]]]));
    const slotAt = (i: number) => now.get(i) ?? read.slots[i];
    for (const l of read.links) if (now.has(l.from) || now.has(l.to)) doc.updateArrow(l.arrow.id, { step: roles(slotAt(l.from), slotAt(l.to), l) });
    arrangeSmart(doc, m, frameId, undefined, meshPairs(read));
    return true;
  }
  if (!read || !read.chain || from === to || !read.slots[from] || to < 0 || to >= read.slots.length) return false;
  const slots = [...read.slots];
  const [s] = slots.splice(from, 1);
  slots.splice(to, 0, s);
  relink(doc, slots, read.links, read.closed);
  arrangeSmart(doc, m, frameId);
  return true;
}

function removeItem(doc: Doc, it: Item): void {
  for (const a of it.atoms) doc.removeAtom(a);
  if (it.caption !== undefined) doc.removeCaption(it.caption);
  if (it.shape !== undefined) doc.removeShape(it.shape);
}

/** Retype slot `k` (only a slot that is one text box). Call inside an edit. */
export function setSlotText(doc: Doc, m: Measure, frameId: number, k: number, text: string): boolean {
  return setSlotRuns(doc, m, frameId, k, chemRuns(text), false);
}

/** Retype slot `k` with formatted text, as the species list's rows give it. Call inside an edit. */
export function setSlotRuns(doc: Doc, m: Measure, frameId: number, k: number, parts: TextPart[], ownLooks = true): boolean {
  const read = readSmart(doc, m, frameId);
  const id = read?.slots[k]?.caption;
  const c = id !== undefined ? doc.captions.get(id) : undefined;
  if (!c || !partsPlain(parts).trim()) return false;
  doc.updateCaption(c.id, { runs: partsRuns(parts, c.runs[0], ownLooks) });
  return true;
}

// ---------------------------------------------------------------- species waiting for a structure

/** Point the steps at something new where they named `from` (a species changed from text to a box, or a box to a structure). */
function swapRef(doc: Doc, frameId: number, from: string, to: string[]): void {
  const f = doc.shapes.get(frameId)?.frame;
  if (!f) return;
  const sw = (xs: string[]) => xs.flatMap((x) => (x === from ? to : [x]));
  for (const id of f.arrows) {
    const st = doc.arrows.get(id)?.step;
    if (!st) continue;
    const parts = ['above', 'below', 'inside', 'plusses'] as const;
    if (![...st.reactants, ...st.products, ...parts.flatMap((p) => st[p] ?? [])].includes(from)) continue;
    const next = { ...st, reactants: sw(st.reactants), products: sw(st.products) };
    for (const p of parts) if (st[p]) next[p] = sw(st[p]!);
    doc.updateArrow(id, { step: next });
  }
}

/**
 * Make slot `k` (a text label) a dashed box waiting for its structure: drawn in, or pasted into
 * when the box is selected. The label is kept on the box, to go back to. Returns the box's id.
 * Call inside an edit.
 */
export function slotToHolder(doc: Doc, m: Measure, frameId: number, k: number): number | null {
  const read = readSmart(doc, m, frameId);
  const slot = read?.slots[k];
  const c = slot?.caption !== undefined ? doc.captions.get(slot.caption) : undefined;
  const f = doc.shapes.get(frameId)?.frame;
  if (!slot || !c || !f) return null;
  const L = doc.style.bondLength, b = slot.box;
  const w = Math.max(5 * L, b.x2 - b.x1 + 0.6 * L), h = 3 * L, at = mid(b);
  const sh = doc.addShape({
    kind: 'geo', geo: 'rect', x1: at.x - w / 2, y1: at.y - h / 2, x2: at.x + w / 2, y2: at.y + h / 2,
    filled: false, dashed: true, lineWidth: doc.style.lineWidth, color: '#808080', holder: { runs: structuredClone(c.runs) }, name: 'Species placeholder',
  });
  doc.removeCaption(c.id);
  doc.updateShape(frameId, { frame: { ...f, captions: f.captions.filter((x) => x !== c.id), shapes: [...f.shapes, sh.id] } });
  swapRef(doc, frameId, 'c' + c.id, ['s' + sh.id]);
  arrangeSmart(doc, m, frameId);
  return sh.id;
}

/** Make slot `k`'s dashed box a text label again (the label it had, or "species N"). Returns the label's id. Call inside an edit. */
export function holderToSlotText(doc: Doc, m: Measure, frameId: number, k: number): number | null {
  const read = readSmart(doc, m, frameId);
  const slot = read?.slots[k];
  const sh = slot?.holder !== undefined ? doc.shapes.get(slot.holder) : undefined;
  const f = doc.shapes.get(frameId)?.frame;
  if (!slot || !sh?.holder || !f) return null;
  const runs = sh.holder.runs?.some((r) => r.text.trim()) ? sh.holder.runs : chemRuns(`species ${k + 1}`);
  const at = mid(slot.box);
  const cap = doc.addCaption({ x: at.x, y: at.y, runs, justify: 'center' });
  doc.removeShape(sh.id);
  doc.updateShape(frameId, { frame: { ...f, shapes: f.shapes.filter((x) => x !== sh.id), captions: [...f.captions, cap.id] } });
  swapRef(doc, frameId, 's' + sh.id, ['c' + cap.id]);
  arrangeSmart(doc, m, frameId);
  return cap.id;
}

/** The Smart Scheme a dashed species box is in. */
export function holderFrameOf(doc: Doc, holder: number): number | null {
  if (!doc.shapes.get(holder)?.holder) return null;
  for (const s of doc.shapes.values()) if (s.smart && s.frame?.shapes.includes(holder)) return s.id;
  return null;
}

/**
 * A structure (these atoms, and any text with it) takes the place of a dashed species box: the
 * box goes and the structure is that species. With `arrange`, the scheme is laid out again round
 * it (a paste); otherwise it stays where it was drawn. Call inside an edit.
 */
export function fillHolder(doc: Doc, m: Measure, holder: number, atoms: number[], captions: number[] = [], arrange = true): boolean {
  const frameId = holderFrameOf(doc, holder);
  const f = frameId !== null ? doc.shapes.get(frameId)?.frame : undefined;
  if (frameId === null || !f || !atoms.length) return false;
  // one atom of each structure stands for it
  const seen = new Set<number>(), firsts: number[] = [];
  for (const a of atoms) {
    if (seen.has(a) || !doc.atoms.has(a)) continue;
    const frag = [...doc.fragmentOf(a)];
    for (const x of frag) seen.add(x);
    firsts.push(Math.min(...frag));
  }
  if (!firsts.length) return false;
  doc.removeShape(holder);
  doc.updateShape(frameId, { frame: { ...f, shapes: f.shapes.filter((x) => x !== holder), atoms: [...f.atoms, ...firsts], captions: [...f.captions, ...captions] } });
  swapRef(doc, frameId, 's' + holder, firsts.map((a) => 'a' + a));
  if (arrange) arrangeSmart(doc, m, frameId);
  return true;
}

/** At the end of a change: atoms drawn inside a Smart Scheme's dashed species box become that species. */
export function fillHoldersDrawn(doc: Doc, before: ReadonlyMap<string, Entity | null>, m: Measure): void {
  const made = [...before].filter(([k, v]) => v === null && k[0] === 'a').map(([k]) => Number(k.slice(1))).filter((id) => doc.atoms.has(id));
  if (!made.length) return;
  for (const s of [...doc.shapes.values()]) {
    if (!s.holder || holderFrameOf(doc, s.id) === null) continue;
    const b = { x1: Math.min(s.x1, s.x2), y1: Math.min(s.y1, s.y2), x2: Math.max(s.x1, s.x2), y2: Math.max(s.y1, s.y2) };
    const inside = made.filter((id) => { const a = doc.atoms.get(id)!; return a.x >= b.x1 && a.x <= b.x2 && a.y >= b.y1 && a.y <= b.y2; });
    if (inside.length) fillHolder(doc, m, s.id, inside, [], false);
  }
}

export type StepPart = 'above' | 'below' | 'inside';

/** What a step's conditions above or below its arrow are: text, a dashed box waiting for a structure, or a drawn structure. */
export function stepPartKind(doc: Doc, l: SmartLink, part: StepPart): 'text' | 'box' | 'structure' {
  if (l[part].some((it) => it.shape !== undefined && doc.shapes.get(it.shape)?.holder)) return 'box';
  if (l[part].some((it) => it.atoms.length)) return 'structure';
  return 'text';
}

/** The dashed box in a step's conditions, if there is one. */
export function stepHolder(doc: Doc, l: SmartLink, part: StepPart): number | null {
  const it = l[part].find((x) => x.shape !== undefined && doc.shapes.get(x.shape)?.holder);
  return it?.shape ?? null;
}

/**
 * Make what joins or leaves at step `k` (its text above or below the arrow; outside a cycle's
 * loop, or on its small curved arrow) a dashed box to draw or paste a structure in, keeping the
 * text to go back to. Returns the box's id. Call inside an edit.
 */
export function stepToHolder(doc: Doc, m: Measure, frameId: number, k: number, part: Exclude<StepPart, 'inside'>): number | null {
  const read = readSmart(doc, m, frameId);
  const l = read?.links[k];
  const f = doc.shapes.get(frameId)?.frame;
  if (!read || !l || !f || stepPartKind(doc, l, part) !== 'text') return null;
  const it = l[part].find((x) => x.caption !== undefined);
  const c = it ? doc.captions.get(it.caption!) : undefined;
  const L = doc.style.bondLength;
  const am = arrowMid(l.arrow);
  const at = it ? mid(it.box) : { x: am.x, y: am.y + (part === 'above' ? -L : L) };
  const w = Math.max(3.5 * L, it ? it.box.x2 - it.box.x1 + 0.6 * L : 0), h = 2.2 * L;
  const sh = doc.addShape({
    kind: 'geo', geo: 'rect', x1: at.x - w / 2, y1: at.y - h / 2, x2: at.x + w / 2, y2: at.y + h / 2,
    filled: false, dashed: true, lineWidth: doc.style.lineWidth, color: '#808080', holder: { runs: c ? structuredClone(c.runs) : [] }, name: 'Reagent placeholder',
  });
  const step = { ...(l.arrow.step ?? roles(read.slots[l.from], read.slots[l.to], l)) };
  if (c) {
    doc.removeCaption(c.id);
    step[part] = (step[part] ?? []).map((r) => (r === 'c' + c.id ? 's' + sh.id : r));
  } else step[part] = [...(step[part] ?? []), 's' + sh.id];
  doc.updateArrow(l.arrow.id, { step: { ...step, manual: true } });
  doc.updateShape(frameId, { frame: { ...f, captions: f.captions.filter((x) => x !== c?.id), shapes: [...f.shapes, sh.id] } });
  arrangeSmart(doc, m, frameId);
  return sh.id;
}

/** Make a step's dashed reagent box text again (the text it had, if any). Call inside an edit. */
export function stepHolderToText(doc: Doc, m: Measure, frameId: number, k: number, part: Exclude<StepPart, 'inside'>): boolean {
  const read = readSmart(doc, m, frameId);
  const l = read?.links[k];
  const f = doc.shapes.get(frameId)?.frame;
  const id = l ? stepHolder(doc, l, part) : null;
  const sh = id !== null ? doc.shapes.get(id) : undefined;
  if (!read || !l || !f || !sh?.holder) return false;
  const runs = sh.holder.runs?.some((r) => r.text.trim()) ? sh.holder.runs : null;
  const step = { ...(l.arrow.step ?? roles(read.slots[l.from], read.slots[l.to], l)) };
  let cap: number | null = null;
  if (runs) {
    const at = mid({ x1: Math.min(sh.x1, sh.x2), y1: Math.min(sh.y1, sh.y2), x2: Math.max(sh.x1, sh.x2), y2: Math.max(sh.y1, sh.y2) });
    cap = doc.addCaption({ x: at.x, y: at.y, runs, justify: 'center' }).id;
  }
  doc.removeShape(sh.id);
  step[part] = (step[part] ?? []).flatMap((r) => (r === 's' + sh.id ? (cap !== null ? ['c' + cap] : []) : [r]));
  doc.updateArrow(l.arrow.id, { step: { ...step, manual: true } });
  doc.updateShape(frameId, { frame: { ...f, shapes: f.shapes.filter((x) => x !== sh.id), captions: cap !== null ? [...f.captions, cap] : f.captions } });
  arrangeSmart(doc, m, frameId);
  return true;
}

/** The text of a step's conditions above or below its arrow, or its name inside a cycle (the first text box there). */
export function stepText(doc: Doc, l: SmartLink, part: StepPart): string {
  const it = l[part].find((x) => x.caption !== undefined);
  const c = it ? doc.captions.get(it.caption!) : undefined;
  return c ? runsMarkup(c.runs) : '';
}

/**
 * Retype a step's conditions (or its name inside a cycle): the first text box there changes, a
 * new one is written when there is none, and an emptied one goes. The scheme is laid out again
 * when one is added or taken away. Call inside an edit.
 */
export function setStepText(doc: Doc, m: Measure, frameId: number, k: number, part: StepPart, text: string): boolean {
  return setStepRuns(doc, m, frameId, k, part, chemRuns(text.trim()), false);
}

/** Retype a step's conditions with formatted text, as the species list's rows give it. Call inside an edit. */
export function setStepRuns(doc: Doc, m: Measure, frameId: number, k: number, part: StepPart, parts: TextPart[], ownLooks = true): boolean {
  const read = readSmart(doc, m, frameId);
  const l = read?.links[k];
  if (!read || !l) return false;
  const it = l[part].find((x) => x.caption !== undefined);
  const c = it ? doc.captions.get(it.caption!) : undefined;
  // spaces at the ends go
  const trimmed = parts.map((p) => ({ ...p })).filter((p) => p.text);
  if (trimmed.length) { trimmed[0].text = trimmed[0].text.trimStart(); trimmed[trimmed.length - 1].text = trimmed[trimmed.length - 1].text.trimEnd(); }
  const t = partsPlain(trimmed).trim();
  if (c && t) { doc.updateCaption(c.id, { runs: partsRuns(trimmed, c.runs[0], ownLooks) }); return true; }
  if (!c && !t) return false;
  const step = { ...(l.arrow.step ?? roles(read.slots[l.from], read.slots[l.to], l)) };
  const f = doc.shapes.get(frameId)!.frame!;
  if (c) {
    doc.removeCaption(c.id);
    step[part] = (step[part] ?? []).filter((r) => r !== 'c' + c.id);
    doc.updateArrow(l.arrow.id, { step });
  } else {
    const mid = arrowMid(l.arrow), L = doc.style.bondLength;
    const n = doc.addCaption({ x: mid.x, y: mid.y + (part === 'above' ? -0.6 * L : part === 'below' ? 1.2 * L : 2 * L), runs: partsRuns(trimmed), justify: 'center' });
    step[part] = [...(step[part] ?? []), 'c' + n.id];
    doc.updateArrow(l.arrow.id, { step: { ...step, manual: true } });
    doc.updateShape(frameId, { frame: { ...f, captions: [...f.captions, n.id] } });
  }
  arrangeSmart(doc, m, frameId);
  return true;
}

// ---------------------------------------------------------------- loops and branches

/** How a new loop is joined to a cycle: at a species both loops share, along a stretch of species (from one to another, the way the arrows go), facing a step, or beside it. */
export type LoopJoin =
  | { kind: 'share'; slot: number }
  | { kind: 'fused'; from: number; to: number }
  | { kind: 'mesh'; link: number }
  | { kind: 'beside' };

/** The species from slot `from` on to slot `to` along the steps of one loop (both included), or null when no loop runs that way. */
export function stretch(read: SmartRead, from: number, to: number): number[] | null {
  const loops = read.net ? read.net.loops.map((lp) => lp.slots) : read.closed && read.chain ? [read.slots.map((_, i) => i)] : [];
  for (const lp of loops) {
    const a = lp.indexOf(from), b = lp.indexOf(to);
    if (a < 0 || b < 0 || a === b) continue;
    const n = lp.length, len = ((b - a + n) % n) + 1;
    // some of the loop has to be left over for the loop that is there already
    if (len < 2 || len > n) continue;
    return Array.from({ length: len }, (_, k) => lp[(a + k) % n]);
  }
  return null;
}

/**
 * Add a loop of `count` new species to a cycle, joined as `join` says. The scheme is laid out
 * again. Returns the new species' text boxes (null when it can't be joined that way). Call inside an edit.
 */
export function addLoop(doc: Doc, m: Measure, frameId: number, join: LoopJoin, count = 3): number[] | null {
  const read = readSmart(doc, m, frameId);
  const s = doc.shapes.get(frameId);
  if (!read || !s?.frame || !s.smart) return null;
  if (!read.net && !(read.closed && read.chain)) return null;
  const box = frameBox(doc, s.frame, m);
  if (!box) return null;
  const L = doc.style.bondLength;
  const least = join.kind === 'share' || join.kind === 'fused' ? 1 : 2;
  const n = Math.max(least, Math.min(12, Math.round(count)));
  let first: Slot, last: Slot;
  if (join.kind === 'share') {
    if (!read.slots[join.slot]) return null;
    first = last = read.slots[join.slot];
  } else if (join.kind === 'fused') {
    const path = stretch(read, join.from, join.to);
    if (!path) return null;
    // the new loop runs on from the end of the stretch and comes back to its start
    first = read.slots[join.to]; last = read.slots[join.from];
  } else if (join.kind === 'mesh' && !read.links[join.link]) return null;
  // well clear of the rest until it is laid out, so nothing of it is taken for part of another loop
  const fresh = Array.from({ length: n }, (_, k) => newSpecies(doc, m, { x: box.x2 + (8 + 6 * k) * L, y: box.y1 - 12 * L }, `Species ${read.slots.length + k + 1}`));
  const like = read.links[0]?.arrow;
  const arrows: Arrow[] = [];
  for (let k = 0; k + 1 < n; k++) arrows.push(newStep(doc, like, fresh[k], fresh[k + 1]));
  if (join.kind === 'share' || join.kind === 'fused') {
    arrows.unshift(newStep(doc, like, first!, fresh[0]));
    arrows.push(newStep(doc, like, fresh[n - 1], last!));
  } else arrows.push(newStep(doc, like, fresh[n - 1], fresh[0]));
  intoFrame(doc, frameId, fresh, arrows);
  const pairs = meshPairs(read, join.kind === 'mesh' ? [[read.links[join.link].arrow.id, arrows[arrows.length - 1].id]] : []) ?? [];
  arrangeSmart(doc, m, frameId, undefined, pairs);
  return fresh.map((sl) => sl.caption!);
}

/** Text in a Smart Scheme that is no species, label or condition: for each loop, the one nearest its middle (the catalyst's name). */
export function loopMiddles(doc: Doc, m: Measure, frameId: number, read: SmartRead): (number | undefined)[] {
  const f = doc.shapes.get(frameId)?.frame;
  const loops = read.net ? read.net.loops.map((lp) => lp.slots) : read.closed ? [read.slots.map((_, i) => i)] : [];
  if (!f || !loops.length) return [];
  const used = new Set<number>();
  for (const sl of read.slots) for (const it of [...sl.items, ...sl.labels]) if (it.caption !== undefined) used.add(it.caption);
  for (const l of read.links) for (const it of [...l.above, ...l.below, ...l.inside, ...l.plusses]) if (it.caption !== undefined) used.add(it.caption);
  const centres = loops.map((lp) => loopCentre(read, lp));
  const out: (number | undefined)[] = loops.map(() => undefined);
  for (const id of frameMembers(doc, f).captions) {
    const c = doc.captions.get(id);
    if (!c || used.has(id)) continue;
    const p = mid(m.captionBox(c));
    let best = 0;
    centres.forEach((q, i) => { if (Math.hypot(q.x - p.x, q.y - p.y) < Math.hypot(centres[best].x - p.x, centres[best].y - p.y)) best = i; });
    if (out[best] === undefined) out[best] = id;
  }
  return out;
}

const loopCentre = (read: SmartRead, slots: number[]): Vec => {
  const ps = slots.map((i) => mid(read.slots[i].box));
  return { x: ps.reduce((a, p) => a + p.x, 0) / ps.length, y: ps.reduce((a, p) => a + p.y, 0) / ps.length };
};

/** Write `parts` in the middle of loop `loop` (the catalyst's name); nothing typed takes it away. Call inside an edit. */
export function setLoopMiddle(doc: Doc, m: Measure, frameId: number, loop: number, parts: TextPart[]): boolean {
  const read = readSmart(doc, m, frameId);
  if (!read) return false;
  const now = loopMiddles(doc, m, frameId, read);
  if (loop < 0 || loop >= now.length) return false;
  const id = now[loop], text = partsPlain(parts).trim();
  if (id !== undefined) {
    const c = doc.captions.get(id)!;
    if (text) doc.updateCaption(id, { runs: partsRuns(parts, c.runs[0]) });
    else doc.removeCaption(id);
  } else {
    if (!text) return false;
    const slots = read.net ? read.net.loops[loop].slots : read.slots.map((_, i) => i);
    const at = loopCentre(read, slots);
    const cap = doc.addCaption({ x: at.x, y: at.y, runs: partsRuns(parts), justify: 'center' });
    intoFrame(doc, frameId, [], [], [cap.id]);
  }
  arrangeSmart(doc, m, frameId, undefined, meshPairs(read));
  return true;
}

/**
 * Take loop `loop` out of a cycle of several loops (not the first): its own species and steps,
 * what is written in its middle, the branches off it, and the loops joined to it by something
 * they share. Loops that only turned with it stay. Call inside an edit.
 */
export function removeLoop(doc: Doc, m: Measure, frameId: number, loop: number): boolean {
  const read = readSmart(doc, m, frameId);
  const net = read?.net;
  if (!read || !net || loop < 1 || loop >= net.loops.length) return false;
  const middles = loopMiddles(doc, m, frameId, read);
  const loopsGone = new Set([loop]);
  const gone = new Set(net.loops[loop].own);
  for (let grew = true; grew;) {
    grew = false;
    for (const j of net.joins) {
      if (loopsGone.has(j.child)) continue;
      const lost = j.kind === 'share' ? gone.has(j.node) : j.kind === 'fused' ? j.path.some((x) => gone.has(x)) : false;
      if (!lost) continue;
      loopsGone.add(j.child);
      for (const x of net.loops[j.child].own) gone.add(x);
      grew = true;
    }
  }
  for (const t of net.tails) if (gone.has(t.at)) for (const x of t.slots) gone.add(x);
  const pairs = meshPairs(read)!;
  const dead = new Set<number>();
  for (const l of read.links) if (gone.has(l.from) || gone.has(l.to)) { dead.add(l.arrow.id); dropStep(doc, l); }
  for (const k of gone) for (const it of [...read.slots[k].items, ...read.slots[k].labels]) removeItem(doc, it);
  for (const li of loopsGone) { const id = middles[li]; if (id !== undefined && doc.captions.has(id)) doc.removeCaption(id); }
  arrangeSmart(doc, m, frameId, undefined, pairs.filter(([a, b]) => !dead.has(a) && !dead.has(b)), true);
  return true;
}

/**
 * Add a species off the cycle at slot `k`: one that comes in (a precatalyst), goes out (a
 * deactivated species), or is in equilibrium with it (a resting state). Returns its text box.
 * Call inside an edit.
 */
export function addBranch(doc: Doc, m: Measure, frameId: number, k: number, dir: 'in' | 'out' | 'both', text = 'off-cycle species'): number | null {
  const read = readSmart(doc, m, frameId);
  const s = doc.shapes.get(frameId);
  const on = read?.slots[k];
  if (!read || !on || !s?.frame || !(read.net || (read.closed && read.chain))) return null;
  const box = frameBox(doc, s.frame, m);
  if (!box) return null;
  const L = doc.style.bondLength;
  const fresh = newSpecies(doc, m, { x: box.x2 + 8 * L, y: box.y1 - 12 * L }, text);
  const like = read.links[0]?.arrow;
  const arrow = dir === 'in' ? newStep(doc, like, fresh, on) : newStep(doc, like, on, fresh, dir === 'both' ? EQUILIBRIUM : {});
  intoFrame(doc, frameId, [fresh], [arrow]);
  arrangeSmart(doc, m, frameId, undefined, meshPairs(read) ?? []);
  return fresh.caption!;
}

/** The names of a cycle's steps, all short (OA) or all in full (oxidative addition), where they are ones it knows; null when none is. */
export function stepNamesNow(doc: Doc, read: SmartRead): 'short' | 'full' | null {
  let short = 0, full = 0;
  for (const l of read.links) for (const it of l.inside) {
    const c = it.caption !== undefined ? doc.captions.get(it.caption) : undefined;
    if (!c) continue;
    const t = plainText(c.runs).trim();
    if (fullName(t) !== t) short++; else if (shortName(t) !== t) full++;
  }
  return short + full === 0 ? null : full > short ? 'full' : 'short';
}

/** Write every step name the cycle knows short or in full. Call inside an edit. */
export function setStepNames(doc: Doc, m: Measure, frameId: number, how: 'short' | 'full'): boolean {
  const read = readSmart(doc, m, frameId);
  if (!read) return false;
  let any = false;
  for (const l of read.links) for (const it of l.inside) {
    const c = it.caption !== undefined ? doc.captions.get(it.caption) : undefined;
    if (!c) continue;
    const t = plainText(c.runs).trim();
    const next = how === 'short' ? shortName(t) : fullName(t);
    if (next === t) continue;
    doc.updateCaption(c.id, { runs: markupRuns(next, c.runs[0]) });
    any = true;
  }
  if (any) arrangeSmart(doc, m, frameId, undefined, meshPairs(read));
  return any;
}

// ---------------------------------------------------------------- following moves made by hand

/** Where the line from `p` (inside box r) towards `q` leaves r grown by `pad`. */
function leave(p: Vec, q: Vec, r: Rect, pad: number): Vec {
  const d = { x: q.x - p.x, y: q.y - p.y };
  const rr = { x1: r.x1 - pad, y1: r.y1 - pad, x2: r.x2 + pad, y2: r.y2 + pad };
  let t = 1;
  if (d.x > 0) t = Math.min(t, (rr.x2 - p.x) / d.x); else if (d.x < 0) t = Math.min(t, (rr.x1 - p.x) / d.x);
  if (d.y > 0) t = Math.min(t, (rr.y2 - p.y) / d.y); else if (d.y < 0) t = Math.min(t, (rr.y1 - p.y) / d.y);
  t = Math.max(0, t);
  return { x: p.x + d.x * t, y: p.y + d.y * t };
}

const mid = (r: Rect): Vec => ({ x: (r.x1 + r.x2) / 2, y: (r.y1 + r.y2) / 2 });

/**
 * At the end of a change: in a Smart Scheme where a species was moved by hand (and its arrows
 * weren't), the arrows to and from it run between the species' new places, and the conditions
 * go with them.
 */
export function refitSmart(doc: Doc, before: ReadonlyMap<string, Entity | null>, m: Measure): void {
  for (const s of [...doc.shapes.values()]) {
    if (!s.smart || !s.frame) continue;
    const f = s.frame;
    if (f.arrows.some((id) => before.has('r' + id))) continue;
    const mem = frameMembers(doc, f);
    let moved = false;
    for (const id of mem.atoms) if (before.has('a' + id)) { moved = true; break; }
    if (!moved) for (const id of mem.captions) if (before.has('c' + id)) { moved = true; break; }
    if (!moved) for (const id of mem.shapes) if (before.has('s' + id)) { moved = true; break; }
    if (!moved) continue;
    const read = readSmart(doc, m, s.id);
    if (!read) continue;
    const gap = s.smart.fmt?.structGap ?? spacing(doc.style.bondLength).gap;
    // round a cycle, every step's arrow follows one smooth path through all the species (once one
    // of them has moved: one only retyped or recolored leaves the arrows where they are)
    if (simpleLoop(s.smart, read)) {
      if (read.slots.some((sl) => slotMoved(doc, sl, before))) refitCycle(doc, read, gap);
      continue;
    }
    if (read.net) { refitNet(doc, read, gap, before); continue; }
    for (const l of read.links) refitLink(doc, read, l, gap, before);
  }
}

/** One step's arrow run again between its two species where they are now, its conditions going with it. */
function refitLink(doc: Doc, read: SmartRead, l: SmartLink, gap: number, before: ReadonlyMap<string, Entity | null>): void {
  const a = read.slots[l.from], b = read.slots[l.to];
  if (!a || !b) return;
  // a curved arrow (round a cycle) follows only a species that moved: one retyped, recolored
  // or given another atom stays where it is, its arcs where the layout put them
  const curved = !!l.arrow.sweep || !!l.arrow.bez?.length;
  if (curved && !slotMoved(doc, a, before) && !slotMoved(doc, b, before)) return;
  // conditions moved on their own were placed by hand: leave the step as it is
  if ([...l.above, ...l.below, ...l.inside].some((it) => it.caption !== undefined && before.has('c' + it.caption))
    && !a.items.some((it) => it.caption !== undefined && before.has('c' + it.caption))
    && !b.items.some((it) => it.caption !== undefined && before.has('c' + it.caption))) return;
  const pa = mid(a.box), pb = mid(b.box);
  const r = l.arrow;
  // an arc keeps its bend: its ends move to the boxes' edges facing each other
  const tail = leave(pa, pb, a.box, gap), head = leave(pb, pa, b.box, gap);
  const was = arrowMid(r);
  const fwd = r.headStyle !== 'none' || r.tailStyle === 'none';
  const next = fwd ? { tail, head } : { tail: head, head: tail };
  if (Math.hypot(next.tail.x - r.tail.x, next.tail.y - r.tail.y) + Math.hypot(next.head.x - r.head.x, next.head.y - r.head.y) < 1e-6) return;
  doc.updateArrow(r.id, next);
  const now = arrowMid({ ...r, ...next });
  const d = { x: now.x - was.x, y: now.y - was.y };
  for (const it of [...l.above, ...l.below, ...l.inside]) {
    if (it.caption === undefined) continue;
    const c = doc.captions.get(it.caption);
    if (c) doc.updateCaption(c.id, { x: c.x + d.x, y: c.y + d.y });
  }
  for (const x of [...doc.arrows.values()]) if (x.reagentFor === r.id) doc.updateArrow(x.id, { tail: { x: x.tail.x + d.x, y: x.tail.y + d.y }, head: { x: x.head.x + d.x, y: x.head.y + d.y } });
}

/**
 * A cycle of several loops where a species moved: each loop it is in runs along its own smooth
 * path again, and the straight steps (ones two loops share, and the branches') follow their species.
 */
function refitNet(doc: Doc, read: SmartRead, gap: number, before: ReadonlyMap<string, Entity | null>): void {
  const net = read.net!;
  const moved = new Set(read.slots.flatMap((sl, i) => (slotMoved(doc, sl, before) ? [i] : [])));
  if (!moved.size) return;
  const uses = new Map<number, number>();
  for (const lp of net.loops) for (const li of lp.links) uses.set(li, (uses.get(li) ?? 0) + 1);
  const straight = (li: number) => uses.get(li) !== 1;
  for (const lp of net.loops) {
    if (!lp.slots.some((i) => moved.has(i))) continue;
    refitCycle(doc, { slots: lp.slots.map((i) => read.slots[i]), links: lp.links.map((i) => read.links[i]) }, gap, undefined, new Set(lp.links.flatMap((li, k) => (straight(li) ? [k] : []))));
  }
  read.links.forEach((l, li) => { if (straight(li) && (moved.has(l.from) || moved.has(l.to))) refitLink(doc, read, l, gap, before); });
}

/** Whether a Smart Scheme is one loop that its arrows go round in order (what Clean Up Cycle and the smooth path work on). */
function simpleLoop(data: SmartData, read: SmartRead): boolean {
  const n = read.slots.length;
  return data.layout === 'cycle' && !data.free && read.closed && read.chain && n >= 2 && read.links.length === n
    && read.links.every((l, k) => l.from === k && l.to === (k + 1) % n);
}

/** Move everything of a species by d. */
function shiftSlot(doc: Doc, slot: Slot, d: Vec): void {
  if (Math.hypot(d.x, d.y) < 1e-9) return;
  for (const it of [...slot.items, ...slot.labels]) {
    if (it.atoms.length) doc.moveAtoms(new Set(it.atoms), d.x, d.y);
    if (it.caption !== undefined) { const c = doc.captions.get(it.caption); if (c) doc.updateCaption(c.id, { x: c.x + d.x, y: c.y + d.y }); }
    if (it.shape !== undefined) {
      const h = doc.shapes.get(it.shape);
      if (h) doc.updateShape(h.id, { x1: h.x1 + d.x, y1: h.y1 + d.y, x2: h.x2 + d.x, y2: h.y2 + d.y, ...(h.poly ? { poly: h.poly.map((p) => ({ x: p.x + d.x, y: p.y + d.y })) } : {}) });
    }
  }
  slot.box = { x1: slot.box.x1 + d.x, y1: slot.box.y1 + d.y, x2: slot.box.x2 + d.x, y2: slot.box.y2 + d.y };
}

/**
 * Clean Up Cycle: the species of a Smart Scheme's cycle go onto the upright ellipse that best fits
 * where they are now (each along the line from its middle), and the step arrows follow its arcs.
 * False when it isn't a single loop of three or more species. Call inside an edit.
 */
export function cleanUpCycle(doc: Doc, m: Measure, frameId: number): boolean {
  const data = doc.shapes.get(frameId)?.smart;
  const read = data && readSmart(doc, m, frameId);
  // several loops: every loop back onto its circle, joined as they are
  if (read?.net) return arrangeSmart(doc, m, frameId, undefined, meshPairs(read));
  if (!data || !read || !simpleLoop(data, read) || read.slots.length < 3) return false;
  const e = fitEllipse(read.slots.map((sl) => mid(sl.box)));
  if (!e) return false;
  for (const sl of read.slots) { const c = mid(sl.box), p = ontoEllipse(e, c); shiftSlot(doc, sl, { x: p.x - c.x, y: p.y - c.y }); }
  refitCycle(doc, read, data.fmt?.structGap ?? spacing(doc.style.bondLength).gap, e);
  return true;
}

/**
 * A cycle where a species moved: the arrows of every step run along one smooth closed path through
 * all the species (so each arrow leaves a species the way the one before came in), their names and
 * what comes in and goes out going with them.
 */
function refitCycle(doc: Doc, read: Pick<SmartRead, 'slots' | 'links'>, gap: number, ellipse?: Ellipse, skip?: Set<number>): void {
  const n = read.slots.length, bond = doc.style.bondLength;
  const pts = read.slots.map((sl) => mid(sl.box));
  const boxes = read.slots.map((sl) => ({ x1: sl.box.x1 - gap, y1: sl.box.y1 - gap, x2: sl.box.x2 + gap, y2: sl.box.y2 + gap }));
  const curves = cycleCurves(pts, boxes, ellipse);
  const centre = { x: pts.reduce((a, p) => a + p.x, 0) / n, y: pts.reduce((a, p) => a + p.y, 0) / n };
  read.links.forEach((l, k) => {
    const c = curves[k], r = l.arrow;
    if (!c || r.bent || skip?.has(k)) return;
    const oldPath = pathPoints(r);
    const fwd = r.headStyle !== 'none' || r.tailStyle === 'none';
    const path = fwd ? c : [...c].reverse();
    const tail = path[0], head = path[path.length - 1];
    const next = { tail, head, sweep: 0, bez: bezFrom(tail, head, path), ellipse: undefined };
    doc.updateArrow(r.id, next);
    // what comes in and goes out on small arrows: back on the arrow, outside the loop
    const smalls = [...doc.arrows.values()].filter((x) => x.reagentFor === r.id);
    const outward = (p: Vec, dir: Vec) => { const nrm = { x: -dir.y, y: dir.x }; return (nrm.x * (p.x - centre.x) + nrm.y * (p.y - centre.y)) >= 0 ? nrm : { x: dir.y, y: -dir.x }; };
    const placed = new Map<number, Vec>();
    for (const x of smalls) {
      // coming in (its head on the arrow) or going out (its tail on it)
      const coming = nearCurve(oldPath, x.head) < nearCurve(oldPath, x.tail);
      const span = curveLength(c);
      const delta = Math.min(0.3, (1.6 * bond) / Math.max(span, 1e-6));
      const touch = coming ? 0.38 : 0.62, far = coming ? touch - delta : touch + delta;
      const at = (t: number, off: number) => { const { p, d: dir } = alongCurve(c, t); const o = outward(p, dir); return { x: p.x + o.x * off, y: p.y + o.y * off }; };
      const dd = 1.5 * bond;
      const oldFar = coming ? x.tail : x.head;
      const t2 = at(far, dd), h2 = at(touch, 0.12 * bond);
      const bend = at(touch + (far - touch) * 0.3, dd * 0.7);
      const tl = coming ? t2 : h2, hd = coming ? h2 : t2;
      doc.updateArrow(x.id, { tail: tl, head: hd, sweep: sweepThrough(tl, hd, bend) });
      placed.set(coming ? 0 : 1, { x: t2.x - oldFar.x, y: t2.y - oldFar.y });
    }
    const moveCaps = (its: Item[], by: Vec) => {
      for (const it of its) {
        if (it.caption === undefined) continue;
        const cap = doc.captions.get(it.caption);
        if (cap) doc.updateCaption(cap.id, { x: cap.x + by.x, y: cap.y + by.y });
      }
    };
    // the step's name (and, without small arrows, what comes in and goes out) keeps its place
    // beside the middle of the arrow, turning as the arrow there turns
    const a0 = alongCurve(oldPath, 0.5), a1 = alongCurve(path, 0.5);
    const beside = (its: Item[]) => {
      for (const it of its) {
        if (it.caption === undefined) continue;
        const cap = doc.captions.get(it.caption);
        if (!cap) continue;
        const o = { x: cap.x - a0.p.x, y: cap.y - a0.p.y };
        const along = o.x * a0.d.x + o.y * a0.d.y, across = -o.x * a0.d.y + o.y * a0.d.x;
        doc.updateCaption(cap.id, { x: a1.p.x + along * a1.d.x - across * a1.d.y, y: a1.p.y + along * a1.d.y + across * a1.d.x });
      }
    };
    if (placed.has(0)) moveCaps(l.above, placed.get(0)!); else beside(l.above);
    if (placed.has(1)) moveCaps(l.below, placed.get(1)!); else beside(l.below);
    beside(l.inside);
  });
}

/** How near p comes to a run of cubic pieces. */
function nearCurve(c: Vec[], p: Vec): number {
  let best = Infinity;
  for (let i = 0; i <= 40; i++) { const q = alongCurve(c, i / 40).p; best = Math.min(best, Math.hypot(q.x - p.x, q.y - p.y)); }
  return best;
}

function curveLength(c: Vec[]): number {
  let s = 0, prev = c[0];
  for (let i = 1; i <= 40; i++) { const q = alongCurve(c, i / 40).p; s += Math.hypot(q.x - prev.x, q.y - prev.y); prev = q; }
  return s;
}

/** Whether something of a species was moved in the change (not just retyped or restyled). */
function slotMoved(doc: Doc, slot: Slot, before: ReadonlyMap<string, Entity | null>): boolean {
  const shifted = (x: number, y: number, was: { x: number; y: number } | null | undefined) => !!was && Math.hypot(x - was.x, y - was.y) > 1e-6;
  for (const it of [...slot.items, ...slot.labels]) {
    for (const id of it.atoms) {
      if (!before.has('a' + id)) continue;
      const a = doc.atoms.get(id), was = before.get('a' + id) as { x: number; y: number } | null;
      if (a && shifted(a.x, a.y, was)) return true;
    }
    if (it.caption !== undefined && before.has('c' + it.caption)) {
      const c = doc.captions.get(it.caption), was = before.get('c' + it.caption) as { x: number; y: number } | null;
      if (c && shifted(c.x, c.y, was)) return true;
    }
    if (it.shape !== undefined && before.has('s' + it.shape)) {
      const h = doc.shapes.get(it.shape), was = before.get('s' + it.shape) as { x1: number; y1: number; x2: number; y2: number } | null;
      if (h && was && (shifted(h.x1, h.y1, { x: was.x1, y: was.y1 }) || shifted(h.x2, h.y2, { x: was.x2, y: was.y2 }))) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------- what shows while it is selected

export interface SmartMarks {
  /** A dashed box round each species, with its number. */
  boxes: Rect[];
  /** Where a + adds a slot: after slot `after` (−1: before the first), on step `link` in a cycle of several loops. */
  adds: { at: Vec; after: number; link?: number }[];
}

/** The dashed boxes and + buttons shown on a selected Smart Scheme. */
export function smartMarks(doc: Doc, m: Measure, frameId: number): SmartMarks | null {
  const read = readSmart(doc, m, frameId);
  const s = doc.shapes.get(frameId);
  if (!read || !s) return null;
  const L = doc.style.bondLength, g = 0.2 * L;
  const boxes = read.slots.map((sl) => {
    let b = sl.box;
    for (const it of sl.labels) b = { x1: Math.min(b.x1, it.box.x1), y1: Math.min(b.y1, it.box.y1), x2: Math.max(b.x2, it.box.x2), y2: Math.max(b.y2, it.box.y2) };
    return { x1: b.x1 - g, y1: b.y1 - g, x2: b.x2 + g, y2: b.y2 + g };
  });
  const adds: SmartMarks['adds'] = [];
  if (read.net) {
    // a + on every step, just outside its own loop; where two loops face each other (or share the
    // step) there is no outside, so it sits on the arrow, nearer its start in one loop and its end in the other
    const net = read.net;
    const along = (r: Arrow, t: number): Vec => {
      const pts = pathPoints(r);
      const at = t * (pts.length - 1), i = Math.min(pts.length - 2, Math.floor(at)), f = at - i;
      return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * f, y: pts[i].y + (pts[i + 1].y - pts[i].y) * f };
    };
    read.links.forEach((l, li) => {
      const mine = net.loops.filter((x) => x.links.includes(li));
      const mesh = net.joins.find((j) => j.kind === 'mesh' && (j.a === li || j.b === li));
      if (mine.length !== 1 || mesh) {
        const fwd = l.arrow.headStyle !== 'none' || l.arrow.tailStyle === 'none';
        const t = mesh && mesh.kind === 'mesh' && mesh.b === li ? 0.75 : 0.25;
        adds.push({ at: along(l.arrow, fwd ? t : 1 - t), after: l.from, link: li });
        return;
      }
      const p = arrowMid(l.arrow), c = loopCentre(read, mine[0].slots);
      const len = Math.hypot(p.x - c.x, p.y - c.y) || 1;
      adds.push({ at: { x: p.x + ((p.x - c.x) / len) * 0.8 * L, y: p.y + ((p.y - c.y) / len) * 0.8 * L }, after: l.from, link: li });
    });
    return { boxes, adds };
  }
  if (!read.chain) return { boxes, adds };
  const all = boxes.reduce((a, b) => ({ x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1), x2: Math.max(a.x2, b.x2), y2: Math.max(a.y2, b.y2) }));
  const centre = mid(all);
  const cycle = s.smart?.layout === 'cycle';
  read.links.forEach((l, k) => {
    const p = arrowMid(l.arrow);
    // past the step's conditions, away from the middle of a cycle or below a line
    const its = [...l.above, ...l.below, ...l.inside];
    let dir = cycle ? { x: p.x - centre.x, y: p.y - centre.y } : { x: 0, y: 1 };
    const len = Math.hypot(dir.x, dir.y) || 1;
    dir = { x: dir.x / len, y: dir.y / len };
    let t = 0.7 * L;
    for (const it of its) {
      const c = mid(it.box);
      const along = (c.x - p.x) * dir.x + (c.y - p.y) * dir.y;
      const half = Math.abs(dir.x) * (it.box.x2 - it.box.x1) / 2 + Math.abs(dir.y) * (it.box.y2 - it.box.y1) / 2;
      if (along > -half) t = Math.max(t, along + half + 0.6 * L);
    }
    if (cycle) t = Math.min(t, 0.8 * L);
    adds.push({ at: { x: p.x + dir.x * t, y: p.y + dir.y * t }, after: k });
  });
  if (!read.closed && read.slots.length) {
    const last = boxes[boxes.length - 1], prev = boxes[boxes.length - 2];
    const d = prev ? { x: mid(last).x - mid(prev).x, y: mid(last).y - mid(prev).y } : { x: 1, y: 0 };
    const horiz = Math.abs(d.x) >= Math.abs(d.y);
    adds.push({ at: horiz ? { x: (d.x >= 0 ? last.x2 : last.x1) + Math.sign(d.x || 1) * 0.9 * L, y: mid(last).y } : { x: mid(last).x, y: last.y2 + 0.9 * L }, after: read.slots.length - 1 });
  }
  return { boxes, adds };
}

/** A Smart Scheme from a file: the frame's members are found again from where they lie (ids change), its data cleaned. */
export function smartShapeLook(s: Shape): Shape {
  const smart = cleanSmart(s.smart);
  return smart ? { ...s, smart } : { ...s, smart: undefined };
}

/** Text boxes that are a Smart Scheme's species, for "Read as" and other per-caption checks. */
export function isSmartCaption(doc: Doc, c: Caption): boolean {
  return smartFrameOf(doc, 'caption', c.id) !== null;
}
