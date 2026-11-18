// Catalytic cycles of more than one loop, read from their steps. A Smart Scheme's cycle is a set
// of species joined by step arrows; when every species has one step in and one out it is a single
// loop, and anything else is worked out here: the loops the steps make, how each loop is joined
// to the one before (sharing a species, sharing a stretch of two or more species, turning together
// like gears where two steps meet, or just beside it), and the branches that hang off a loop (a
// precatalyst coming in, a resting state or a deactivated species off the cycle).
//
// Nothing of this is kept in the file: it is read afresh from the arrows each time, as a Smart
// Scheme's order is, so a cycle drawn by an older version (or by hand) is the same thing.
// This file is geometry only (no drawing), so it can be tested by itself.

import type { Vec } from '../geom';
import { add, fromAngle, mul, sub } from '../geom';

export interface NetLink { from: number; to: number }

export interface NetLoop {
  /** Its species in arrow order. A joined loop starts with the species that are its own. */
  nodes: number[];
  /** links[k] is the step from nodes[k] to nodes[k + 1] (the last one back to nodes[0]). */
  links: number[];
}

/** How a loop is joined to one read before it (`parent` and `child` are indexes into the loops). */
export type NetJoin =
  /** One species is in both loops (a figure of eight). */
  | { kind: 'share'; parent: number; child: number; node: number }
  /** A stretch of two or more species, and the steps between them, is in both loops. `path` is in arrow order. */
  | { kind: 'fused'; parent: number; child: number; path: number[] }
  /** Step `a` of the parent faces step `b` of the child and the loops turn opposite ways, like gears. */
  | { kind: 'mesh'; parent: number; child: number; a: number; b: number }
  /** Nothing in common: the child sits beside the rest. */
  | { kind: 'beside'; parent: number; child: number };

/** A branch off a loop: species in a row leading away from `at`, each joined to the one before by one step (either way). */
export interface NetTail { at: number; nodes: number[]; links: number[] }

export interface Net {
  loops: NetLoop[];
  /** One for every loop but the first, in the order the loops are placed. */
  joins: NetJoin[];
  tails: NetTail[];
  /** Every species once: the first loop's, then each joined loop's own, then the branches'. */
  order: number[];
}

/** Where things are now, to tell loops that turn together from loops that are only beside each other. */
export interface NetGeo {
  /** The middle of each species. */
  centres: Vec[];
  /** The middle of each step's arrow. */
  mids: Vec[];
}

const MAX_LOOPS = 12;

/**
 * Read the loops and branches that `links` make between `n` species. `meshes` names the pairs of
 * steps that face each other (when the cycle is being built, before it has a shape); without it,
 * loops with nothing in common turn together when `geo` shows two of their steps close to each other. Null when the
 * steps don't make loops this way (a tree, a species in three loops, a path joining two loops).
 */
export function readNet(n: number, links: NetLink[], geo?: NetGeo, meshes?: [number, number][]): Net | null {
  if (!links.length || n < 1) return null;
  const seen = new Set<string>();
  for (const l of links) {
    if (l.from === l.to || l.from < 0 || l.to < 0 || l.from >= n || l.to >= n) return null;
    const k = l.from + '>' + l.to;
    if (seen.has(k)) return null;
    seen.add(k);
  }
  const touching: number[][] = Array.from({ length: n }, () => []);
  links.forEach((l, i) => { touching[l.from].push(i); touching[l.to].push(i); });
  if (touching.some((t) => !t.length)) return null;
  const other = (li: number, node: number) => (links[li].from === node ? links[li].to : links[li].from);

  // branches: species at the end of a single step are peeled away until only loops are left
  const deg = touching.map((t) => t.length);
  const peeled = new Set<number>(), cut = new Set<number>();
  const queue = deg.flatMap((d, i) => (d === 1 ? [i] : []));
  while (queue.length) {
    const i = queue.pop()!;
    if (peeled.has(i) || deg[i] !== 1) continue;
    peeled.add(i);
    for (const li of touching[i]) {
      if (cut.has(li)) continue;
      cut.add(li);
      const j = other(li, i);
      deg[j]--;
      if (deg[j] === 1) queue.push(j);
    }
  }
  const core = [...Array(n).keys()].filter((i) => !peeled.has(i));
  if (core.length < 2) return null;
  const coreLinks = links.flatMap((_, i) => (cut.has(i) ? [] : [i]));

  // the loops: every way round the steps that comes back to where it started
  const out: number[][] = Array.from({ length: n }, () => []);
  for (const li of coreLinks) out[links[li].from].push(li);
  const loops: NetLoop[] = [];
  for (const start of core) {
    const pathNodes: number[] = [start], pathLinks: number[] = [];
    const on = new Set([start]);
    const walk = (at: number): boolean => {
      for (const li of out[at]) {
        const to = links[li].to;
        if (to === start) {
          loops.push({ nodes: [...pathNodes], links: [...pathLinks, li] });
          if (loops.length > MAX_LOOPS) return false;
        } else if (to > start && !on.has(to)) {
          on.add(to); pathNodes.push(to); pathLinks.push(li);
          if (!walk(to)) return false;
          on.delete(to); pathNodes.pop(); pathLinks.pop();
        }
      }
      return true;
    };
    if (!walk(start)) return null;
  }
  if (!loops.length) return null;
  // every step left is part of a loop, and the loops are no more than the steps can make by themselves
  const uses = new Map<number, number>();
  for (const lp of loops) for (const li of lp.links) uses.set(li, (uses.get(li) ?? 0) + 1);
  if (coreLinks.some((li) => !uses.has(li)) || [...uses.values()].some((u) => u > 2)) return null;
  const group = new Map<number, number>();
  const top = (i: number): number => { const p = group.get(i) ?? i; if (p === i) return i; const t = top(p); group.set(i, t); return t; };
  for (const li of coreLinks) group.set(top(links[li].from), top(links[li].to));
  const parts = new Set(core.map(top)).size;
  if (loops.length !== coreLinks.length - core.length + parts) return null;

  // in a steady order: by their earliest steps
  const key = (lp: NetLoop) => [...lp.links].sort((a, b) => a - b);
  const byKey = (a: NetLoop, b: NetLoop) => { const ka = key(a), kb = key(b); for (let i = 0; i < Math.min(ka.length, kb.length); i++) if (ka[i] !== kb[i]) return ka[i] - kb[i]; return ka.length - kb.length; };
  loops.sort(byKey);
  const rotate = (lp: NetLoop, first: number): NetLoop => ({ nodes: [...lp.nodes.slice(first), ...lp.nodes.slice(0, first)], links: [...lp.links.slice(first), ...lp.links.slice(0, first)] });
  // a loop starts at the species its earliest step leaves from (so its order doesn't change as things are dragged about)
  const topmost = (lp: NetLoop): number => lp.nodes.indexOf(links[Math.min(...lp.links)].from);
  const centroid = (lp: NetLoop): Vec => { const ps = lp.nodes.map((i) => geo!.centres[i]); return { x: ps.reduce((s, p) => s + p.x, 0) / ps.length, y: ps.reduce((s, p) => s + p.y, 0) / ps.length }; };
  const radius = (lp: NetLoop): number => { const c = centroid(lp); return lp.nodes.reduce((s, i) => s + Math.hypot(geo!.centres[i].x - c.x, geo!.centres[i].y - c.y), 0) / lp.nodes.length; };

  const placed: number[] = [0];
  const done = new Set([0]);
  loops[0] = rotate(loops[0], topmost(loops[0]));
  const joins: NetJoin[] = [];
  const sharedNodes = (a: NetLoop, b: NetLoop) => b.nodes.filter((x) => a.nodes.includes(x));
  // a loop joined by what it shares with one already placed
  const joinShared = (pi: number, qi: number): boolean => {
    const P = loops[pi], Q = loops[qi];
    const both = sharedNodes(P, Q);
    if (both.length === 1) {
      const at = Q.nodes.indexOf(both[0]);
      loops[qi] = rotate(Q, (at + 1) % Q.nodes.length);
      joins.push({ kind: 'share', parent: pi, child: qi, node: both[0] });
      return true;
    }
    // a stretch: the shared species in a row, joined by steps that are in both loops
    const shared = new Set(Q.links.filter((li) => P.links.includes(li)));
    if (shared.size !== both.length - 1) return false;
    const N = Q.nodes.length;
    const firstAt = Q.nodes.findIndex((nd, k) => both.includes(nd) && !shared.has(Q.links[(k - 1 + N) % N]));
    if (firstAt < 0) return false;
    const path: number[] = [];
    for (let k = 0; k < both.length; k++) {
      const at = (firstAt + k) % N;
      if (!both.includes(Q.nodes[at]) || (k < both.length - 1 && !shared.has(Q.links[at]))) return false;
      path.push(Q.nodes[at]);
    }
    loops[qi] = rotate(Q, (firstAt + both.length) % N);
    joins.push({ kind: 'fused', parent: pi, child: qi, path });
    return true;
  };
  for (;;) {
    // loops that share something with a placed one, nearest the start first
    let grew = true;
    while (grew) {
      grew = false;
      for (const pi of placed) {
        for (let qi = 0; qi < loops.length; qi++) {
          if (done.has(qi) || !sharedNodes(loops[pi], loops[qi]).length) continue;
          if (!joinShared(pi, qi)) return null;
          done.add(qi); placed.push(qi); grew = true;
        }
      }
    }
    if (done.size === loops.length) break;
    // then one with nothing in common: turning with a placed loop, or beside the rest
    const rest = loops.map((_, i) => i).filter((i) => !done.has(i));
    let pick: NetJoin | null = null;
    for (const [a, b] of meshes ?? []) {
      for (const [x, y] of [[a, b], [b, a]]) {
        const pi = placed.find((i) => loops[i].links.includes(x)), qi = rest.find((i) => loops[i].links.includes(y));
        if (pick || pi === undefined || qi === undefined) continue;
        pick = { kind: 'mesh', parent: pi, child: qi, a: x, b: y };
      }
    }
    if (!pick && geo && !meshes) {
      let best = Infinity;
      for (const qi of rest) for (const pi of placed) {
        const limit = 0.75 * Math.min(radius(loops[pi]), radius(loops[qi]));
        for (const a of loops[pi].links) for (const b of loops[qi].links) {
          // a step two loops share is drawn straight between them: nothing turns against it
          if ((uses.get(a) ?? 0) > 1 || (uses.get(b) ?? 0) > 1) continue;
          const d = Math.hypot(geo.mids[a].x - geo.mids[b].x, geo.mids[a].y - geo.mids[b].y);
          if (d < limit && d < best) { best = d; pick = { kind: 'mesh', parent: pi, child: qi, a, b }; }
        }
      }
    }
    if (!pick) pick = { kind: 'beside', parent: 0, child: rest[0] };
    const q = loops[pick.child];
    if (pick.kind === 'mesh') {
      const at = q.links.indexOf(pick.b);
      loops[pick.child] = rotate(q, (at + 1) % q.nodes.length);
    } else loops[pick.child] = rotate(q, topmost(q));
    joins.push(pick);
    done.add(pick.child); placed.push(pick.child);
  }
  // loops that share something are joined to each other, and to nothing else (no rings of loops)
  const joined = new Set(joins.map((j) => Math.min(j.parent, j.child) + ':' + Math.max(j.parent, j.child)));
  for (let a = 0; a < loops.length; a++) for (let b = a + 1; b < loops.length; b++) {
    if (sharedNodes(loops[a], loops[b]).length && !joined.has(a + ':' + b)) return null;
  }

  // the branches: each a row of species leading away from a species on a loop
  const tails: NetTail[] = [];
  const inTail = new Set<number>();
  for (const v of core) {
    for (const li of touching[v]) {
      if (!cut.has(li)) continue;
      const t: NetTail = { at: v, nodes: [], links: [] };
      let prev = v, link = li;
      for (;;) {
        const node = other(link, prev);
        if (!peeled.has(node) || inTail.has(node) || touching[node].length > 2) return null;
        inTail.add(node);
        t.nodes.push(node); t.links.push(link);
        const next = touching[node].find((x) => x !== link);
        if (next === undefined) break;
        prev = node; link = next;
      }
      tails.push(t);
    }
  }
  if (inTail.size !== peeled.size) return null;

  const order: number[] = [];
  const had = new Set<number>();
  const take = (i: number) => { if (!had.has(i)) { had.add(i); order.push(i); } };
  for (const pi of placed) for (const nd of loops[pi].nodes) take(nd);
  for (const t of tails) for (const nd of t.nodes) take(nd);
  // the loops in the order they were placed, joins naming them by their new places
  const place = new Map(placed.map((pi, k) => [pi, k]));
  return {
    loops: placed.map((pi) => loops[pi]),
    joins: joins.map((j) => ({ ...j, parent: place.get(j.parent)!, child: place.get(j.child)! })),
    tails, order,
  };
}

/** The loops a species is in. */
export function loopsOf(net: Net, node: number): number[] {
  return net.loops.flatMap((lp, i) => (lp.nodes.includes(node) ? [i] : []));
}

/** The species that are a loop's own (not the parent's it shares), in arrow order. */
export function ownNodes(net: Net, loop: number): number[] {
  const j = net.joins.find((x) => x.child === loop);
  if (!j) return net.loops[loop].nodes;
  const theirs = j.kind === 'share' ? [j.node] : j.kind === 'fused' ? j.path : [];
  return net.loops[loop].nodes.filter((nd) => !theirs.includes(nd));
}

// ---------------------------------------------------------------- laying it out

export interface NetSizes {
  /** Each species' box. */
  boxes: { w: number; h: number }[];
  /** The least length of each step's arrow (room for its head and what is written along it). */
  need: number[];
  /** How far in from its arrow each step's names reach (so a loop is wide enough for them all round its middle). */
  inward?: number[];
  /** How wide the widest of each step's names is (so the names of steps next to each other have room side by side). */
  inwide?: number[];
  /** How far out from the middle of each loop the text there reaches. */
  middle?: number[];
  /** The length of each branch step's straight arrow. */
  straight?: number[];
}

export interface NetOptions {
  bond: number;
  /** The gap kept between a species and its arrows. */
  gap: number;
  /** The first loop runs anticlockwise (the loops joined to it turn the other way, like gears). */
  anticlockwise?: boolean;
  /** Where the first loop's first species goes round it, in radians (the top by default; y points down). */
  startAngle?: number;
}

export type NetStep =
  /** Along a loop's circle, from angle s to angle e. `crowded`: the far side of it is another loop, so nothing is written or drawn outside it. */
  | { kind: 'arc'; loop: number; s: number; e: number; tail: Vec; head: Vec; crowded: boolean }
  /** Straight: a step two loops share, or a branch's step. */
  | { kind: 'line'; tail: Vec; head: Vec; shared: boolean };

export interface NetRing { c: Vec; R: number; sign: 1 | -1 }

export interface NetPlace {
  /** The middle of each species. */
  at: Vec[];
  rings: NetRing[];
  /** One for each step (by its index in the links). */
  steps: (NetStep | null)[];
}

const TAU = 2 * Math.PI;
const norm = (v: Vec): Vec => { const l = Math.hypot(v.x, v.y) || 1; return { x: v.x / l, y: v.y / l }; };
/** How far round from a to b going the way of `sign` (0 to 2π). */
const turn = (a: number, b: number, sign: number) => (((sign * (b - a)) % TAU) + TAU) % TAU;

/**
 * The steps with another loop on their far side, so nothing can be drawn outside them: the steps
 * at a species two loops share, the two steps that turn together, and the steps into and out of
 * a stretch two loops share. (`loops`: each loop's species and steps in arrow order.)
 */
export function crowdedLinks(loops: { nodes: number[]; links: number[] }[], joins: NetJoin[]): Set<number> {
  const out = new Set<number>();
  for (const j of joins) {
    if (j.kind === 'beside') continue;
    if (j.kind === 'mesh') { out.add(j.a); out.add(j.b); continue; }
    const A = j.kind === 'share' ? j.node : j.path[0], B = j.kind === 'share' ? j.node : j.path[j.path.length - 1];
    for (const li of [j.parent, j.child]) {
      const q = loops[li];
      if (!q) continue;
      const M = q.nodes.length, a = q.nodes.indexOf(A), b = q.nodes.indexOf(B);
      if (a >= 0) out.add(q.links[(a - 1 + M) % M]);
      if (b >= 0) out.add(q.links[b]);
    }
  }
  return out;
}

/** Where each species and step of a net goes: the first loop round the origin. */
export function layoutNet(net: Net, links: NetLink[], sizes: NetSizes, opts: NetOptions): NetPlace {
  const { bond, gap } = opts;
  const n = sizes.boxes.length;
  const at: Vec[] = Array.from({ length: n }, () => ({ x: 0, y: 0 }));
  const set = new Set<number>();
  const rings: NetRing[] = [];
  /** For each loop: the angle of each of its species that sits on its circle. */
  const angles: Map<number, number>[] = net.loops.map(() => new Map());
  const size = (i: number) => Math.hypot(sizes.boxes[i].w, sizes.boxes[i].h);
  const box = (i: number, c: Vec) => ({ x1: c.x - sizes.boxes[i].w / 2 - gap, y1: c.y - sizes.boxes[i].h / 2 - gap, x2: c.x + sizes.boxes[i].w / 2 + gap, y2: c.y + sizes.boxes[i].h / 2 + gap });
  const inside = (r: { x1: number; y1: number; x2: number; y2: number }, p: Vec) => p.x >= r.x1 && p.x <= r.x2 && p.y >= r.y1 && p.y <= r.y2;
  const chord = new Set<number>(), crowded = new Set<number>(), moved = new Set<number>();

  /** Where the arc from species a (at angle a0) to b (at a1) leaves a's box and reaches b's, on a circle round c. */
  const ends = (c: Vec, R: number, a: number, a0: number, b: number, a1: number, sign: number, pa?: Vec, pb?: Vec) => {
    const span = turn(a0, a1, sign) || TAU;
    const ba = box(a, pa ?? add(c, fromAngle(a0, R))), bb = box(b, pb ?? add(c, fromAngle(a1, R)));
    const steps = 200;
    let s = a0, e = a0 + sign * span;
    for (let j = 0; j <= steps; j++) { const t = a0 + sign * (span * j) / steps; if (!inside(ba, add(c, fromAngle(t, R)))) { s = t; break; } }
    for (let j = 0; j <= steps; j++) { const t = a0 + sign * span - sign * (span * j) / steps; if (!inside(bb, add(c, fromAngle(t, R)))) { e = t; break; } }
    return { s, e };
  };
  /** Whether every arc of a loop has room, its species at these angles on a circle of radius R. */
  const roomy = (li: number, R: number, sign: number, ang: (k: number) => number | null): boolean => {
    const lp = net.loops[li], N = lp.nodes.length;
    const o = { x: 0, y: 0 };
    for (let k = 0; k < N; k++) {
      const a0 = ang(k), a1 = ang((k + 1) % N);
      if (a0 === null || a1 === null) continue;
      const { s, e } = ends(o, R, lp.nodes[k], a0, lp.nodes[(k + 1) % N], a1, sign);
      if (sign * (e - s) * R < sizes.need[lp.links[k]]) return false;
      const inward = sizes.inward?.[lp.links[k]] ?? 0;
      if (inward > 0 && R - inward < (sizes.middle?.[li] ?? 0) + gap) return false;
      // (the names of two steps side by side, part-way in from the circle)
      const wide = sizes.inwide?.[lp.links[k]] ?? 0;
      if (wide > 0 && N > 2 && 2 * (R - inward / 2) * Math.sin((turn(a0, a1, sign) || TAU) / 2) < wide + gap) return false;
    }
    return true;
  };
  /** The radius of a loop with its species evenly round it. */
  const evenRadius = (li: number): number => {
    const lp = net.loops[li], N = lp.nodes.length;
    let R = Math.max(3 * bond, lp.nodes.reduce((s, i) => s + size(i) + 3 * bond, 0) / TAU);
    for (let tries = 0; tries < 20 && N > 1; tries++) {
      if (roomy(li, R, 1, (k) => (TAU * k) / N)) break;
      R *= 1.15;
    }
    return R;
  };
  const even = (li: number, c: Vec, R: number, sign: 1 | -1, a0: number) => {
    const lp = net.loops[li], N = lp.nodes.length;
    rings[li] = { c, R, sign };
    lp.nodes.forEach((nd, k) => {
      const a = a0 + sign * (TAU * k) / N;
      angles[li].set(nd, a);
      if (!set.has(nd)) { at[nd] = add(c, fromAngle(a, R)); set.add(nd); }
    });
  };
  const rootSign: 1 | -1 = opts.anticlockwise ? -1 : 1;
  even(0, { x: 0, y: 0 }, evenRadius(0), rootSign, opts.startAngle ?? -Math.PI / 2);

  const linkOf = (li: number, k: number) => net.loops[li].links[k];
  const beside = (li: number) => {
    const R = evenRadius(li);
    let right = -Infinity;
    for (const i of set) right = Math.max(right, at[i].x + sizes.boxes[i].w / 2);
    let reach = 0;
    for (const i of net.loops[li].nodes) reach = Math.max(reach, sizes.boxes[i].w / 2);
    even(li, { x: right + 3 * bond + reach + R, y: rings[0].c.y }, R, rootSign, -Math.PI / 2);
  };
  for (const j of net.joins) {
    const P = rings[j.parent], lp = net.loops[j.child], N = lp.nodes.length;
    const sign = (P ? -P.sign : rootSign) as 1 | -1;
    if (j.kind === 'beside' || !P) { beside(j.child); continue; }
    if (j.kind === 'share') {
      const a = angles[j.parent].get(j.node);
      if (a === undefined) { beside(j.child); continue; }
      const R = evenRadius(j.child), G = 2 * bond;
      const dir = fromAngle(a, 1);
      // the shared species sits in a gap between the loops, so the four steps at it don't crowd each other
      if (!moved.has(j.node)) { at[j.node] = add(P.c, mul(dir, P.R + G / 2)); moved.add(j.node); }
      // (the child's species are its own first, the shared one last)
      even(j.child, add(P.c, mul(dir, P.R + R + G)), R, sign, a + Math.PI - sign * (TAU * (N - 1)) / N);
      for (const li of [j.parent, j.child]) {
        const q = net.loops[li], at0 = q.nodes.indexOf(j.node), M = q.nodes.length;
        crowded.add(q.links[at0]); crowded.add(q.links[(at0 - 1 + M) % M]);
      }
      continue;
    }
    if (j.kind === 'mesh') {
      const pl = net.loops[j.parent], k = pl.links.indexOf(j.a);
      const a0 = angles[j.parent].get(pl.nodes[k]), a1 = angles[j.parent].get(pl.nodes[(k + 1) % pl.nodes.length]);
      if (k < 0 || a0 === undefined || a1 === undefined || chord.has(j.a)) { beside(j.child); continue; }
      const mid = a0 + P.sign * (turn(a0, a1, P.sign) || TAU) / 2;
      const R = evenRadius(j.child);
      // (the child starts just after its meshing step, which is its last: from species N − 1 back to species 0)
      even(j.child, add(P.c, fromAngle(mid, P.R + R + 1.6 * bond)), R, sign, mid + Math.PI + sign * Math.PI / N);
      crowded.add(j.a); crowded.add(j.b);
      continue;
    }
    // a shared stretch: its ends stay on the parent's circle, the species between them go on the
    // straight line from one end to the other, and the child's own species go round an arc on the far side
    const A = j.path[0], B = j.path[j.path.length - 1];
    if (!angles[j.parent].has(A) || !angles[j.parent].has(B)) { beside(j.child); continue; }
    const pA = at[A], pB = at[B];
    j.path.forEach((nd, k) => {
      if (k === 0 || k === j.path.length - 1) return;
      const t = k / (j.path.length - 1);
      at[nd] = { x: pA.x + (pB.x - pA.x) * t, y: pA.y + (pB.y - pA.y) * t };
      angles[j.parent].delete(nd);
    });
    const pl = net.loops[j.parent];
    for (let k = 0; k < j.path.length - 1; k++) {
      const li = pl.links.find((x) => links[x].from === j.path[k] && links[x].to === j.path[k + 1]);
      if (li !== undefined) chord.add(li);
    }
    const mid = { x: (pA.x + pB.x) / 2, y: (pA.y + pB.y) / 2 };
    const c = Math.hypot(pB.x - pA.x, pB.y - pA.y);
    let outward = sub(mid, P.c);
    if (Math.hypot(outward.x, outward.y) < 1e-6) outward = { x: pB.y - pA.y, y: pA.x - pB.x };
    outward = norm(outward);
    const own = lp.nodes.slice(0, N - j.path.length);
    const m = own.length;
    const place = (R: number) => {
      const cc = add(mid, mul(outward, Math.sqrt(Math.max(0, R * R - (c * c) / 4))));
      const aA = Math.atan2(pA.y - cc.y, pA.x - cc.x), aB = Math.atan2(pB.y - cc.y, pB.x - cc.x);
      // from B round the far side to A
      const far = Math.atan2(outward.y, outward.x);
      const s: 1 | -1 = turn(aB, far, 1) < turn(aB, aA, 1) ? 1 : -1;
      const span = turn(aB, aA, s);
      const ang = (k: number): number | null => (k < m ? aB + s * (span * (k + 1)) / (m + 1) : k === m ? aA : k === N - 1 ? aB : null);
      return { cc, s, ang };
    };
    let R = Math.max((c / 2) * 1.0001, 3 * bond, (own.reduce((s, i) => s + size(i) + 3 * bond, 3 * bond) + (size(A) + size(B)) / 2) / (1.5 * Math.PI));
    for (let tries = 0; tries < 24; tries++) {
      const p = place(R);
      if (roomy(j.child, R, p.s, p.ang)) break;
      R *= 1.12;
    }
    const p = place(R);
    rings[j.child] = { c: p.cc, R, sign: p.s };
    // the steps into and out of the stretch, in both loops, face each other across a narrow gap
    for (const li of [j.parent, j.child]) {
      const q = net.loops[li], M = q.nodes.length;
      crowded.add(q.links[(q.nodes.indexOf(A) - 1 + M) % M]);
      crowded.add(q.links[q.nodes.indexOf(B)]);
    }
    lp.nodes.forEach((nd, k) => {
      const a = p.ang(k);
      if (a === null) return;
      angles[j.child].set(nd, a);
      if (k < m) { at[nd] = add(p.cc, fromAngle(a, R)); set.add(nd); }
    });
  }

  // the steps
  const steps: (NetStep | null)[] = links.map(() => null);
  const leave = (from: number, toward: Vec): Vec => {
    const p = at[from], r = box(from, p);
    const d = sub(toward, p);
    let t = 1;
    if (d.x > 0) t = Math.min(t, (r.x2 - p.x) / d.x); else if (d.x < 0) t = Math.min(t, (r.x1 - p.x) / d.x);
    if (d.y > 0) t = Math.min(t, (r.y2 - p.y) / d.y); else if (d.y < 0) t = Math.min(t, (r.y1 - p.y) / d.y);
    return add(p, mul(d, Math.max(0, t)));
  };
  net.loops.forEach((lp, li) => {
    const ring = rings[li], N = lp.nodes.length;
    if (!ring) return;
    for (let k = 0; k < N; k++) {
      const link = linkOf(li, k), a = lp.nodes[k], b = lp.nodes[(k + 1) % N];
      if (steps[link]) continue;
      if (chord.has(link)) { steps[link] = { kind: 'line', tail: leave(a, at[b]), head: leave(b, at[a]), shared: true }; continue; }
      const a0 = angles[li].get(a), a1 = angles[li].get(b);
      if (a0 === undefined || a1 === undefined) { steps[link] = { kind: 'line', tail: leave(a, at[b]), head: leave(b, at[a]), shared: false }; continue; }
      const { s, e } = N > 1 ? ends(ring.c, ring.R, a, a0, b, a1, ring.sign, at[a], at[b]) : { s: a0, e: a0 };
      let tail = add(ring.c, fromAngle(s, ring.R)), head = add(ring.c, fromAngle(e, ring.R));
      // a species two loops share sits off both circles: its steps run to its box
      if (moved.has(a)) tail = leave(a, head);
      if (moved.has(b)) head = leave(b, tail);
      steps[link] = { kind: 'arc', loop: li, s, e, tail, head, crowded: crowded.has(link) };
    }
  });

  // the branches: straight out from the loop, two at one species fanned apart
  const loopsAt = (nd: number) => net.loops.flatMap((lp, i) => (lp.nodes.includes(nd) && rings[i] ? [i] : []));
  const extent = (i: number, d: Vec) => Math.abs(d.x) * (sizes.boxes[i].w / 2) + Math.abs(d.y) * (sizes.boxes[i].h / 2);
  const byNode = new Map<number, NetTail[]>();
  for (const t of net.tails) byNode.set(t.at, [...(byNode.get(t.at) ?? []), t]);
  for (const [v, ts] of byNode) {
    let out = { x: 0, y: 0 };
    const ls = loopsAt(v);
    for (const li of ls) out = add(out, norm(sub(at[v], rings[li].c)));
    if (Math.hypot(out.x, out.y) < 0.2) {
      // between two loops: at right angles to the line through their middles, upward
      const a = ls.length ? norm(sub(at[v], rings[ls[0]].c)) : { x: 0, y: 1 };
      out = { x: a.y, y: -a.x };
      if (out.y > 0) out = { x: -out.x, y: -out.y };
    }
    const base = Math.atan2(out.y, out.x);
    ts.forEach((t, k) => {
      const dir = fromAngle(base + (k - (ts.length - 1) / 2) * (50 * Math.PI / 180), 1);
      let p = add(at[v], mul(dir, extent(v, dir) + gap));
      let prev = v;
      t.nodes.forEach((nd, q) => {
        const link = t.links[q];
        const len = sizes.straight?.[link] ?? Math.max(sizes.need[link], 2.8 * bond);
        const far = add(p, mul(dir, len));
        steps[link] = links[link].from === prev ? { kind: 'line', tail: p, head: far, shared: false } : { kind: 'line', tail: far, head: p, shared: false };
        at[nd] = add(far, mul(dir, gap + extent(nd, dir)));
        set.add(nd);
        p = add(at[nd], mul(dir, extent(nd, dir) + gap));
        prev = nd;
      });
    });
  }
  return { at, rings, steps };
}
