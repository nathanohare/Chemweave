// Schemes that branch, read from their steps. A Smart Scheme's species are joined by step
// arrows; when every species has at most one step in and one out it is a single line, and when
// the steps make loops it is a catalytic cycle (cycle-net.ts). Anything else that never comes
// back on itself is worked out here: a main route (the longest way through), and the branches
// off it: routes that lead away from a species (a side product, another route from a common
// intermediate) and routes that lead into one (a second starting material, a fragment made
// separately and coupled). A branch can branch again.
//
// Nothing of this is kept in the file: it is read afresh from the arrows each time, as a Smart
// Scheme's order is, so a branching scheme drawn by hand (or by an older version) is the same
// thing. This file is geometry only (no drawing), so it can be tested by itself.

import type { Vec } from '../geom';

export interface TreeLink { from: number; to: number }

/** One route: species in the order its arrows go, each joined to the next by one step. */
export interface TreeRun {
  nodes: number[];
  /** links[k] is the step from nodes[k] to nodes[k + 1]. */
  links: number[];
  /** A branch: the run it hangs from (an index into the runs), the species of that run it joins, and the step that joins it. */
  parent?: number;
  at?: number;
  via?: number;
  /** A branch: `out` leads away from `at` (its first species follows `at`), `in` leads into it (its last species comes before `at`). */
  dir?: 'out' | 'in';
  /**
   * A branch, when it is laid out: the side of its parent run it is on now (1: below a run across
   * the page, right of a run down it; −1: the other side), which it keeps. Not set: the side with more room.
   */
  side?: 1 | -1;
}

export interface Tree {
  /** The main route first, then each branch followed by its own branches. More than one run without a parent: parts that nothing joins. */
  runs: TreeRun[];
  /** Steps between two species that are both on a route already (two routes to one product): drawn straight across. */
  extra: number[];
  /** Every species once, run by run. */
  order: number[];
}

/** How far off straight (as 1 − the cosine of the angle, about 4°) one step is counted as bending away from another. */
const BEND = 0.003;

/**
 * Read the routes that `links` make between `n` species: null when a step leads back to a species
 * before it (that is a cycle). With `centres` (where the species are now) and `flow` (the way the
 * scheme's layout runs: across the page or down it), the main route is the one drawn straight on,
 * so a scheme read again keeps the main route it had, however long its branches have grown.
 * Without them it is the longest way through.
 */
export function readTree(n: number, links: TreeLink[], centres?: Vec[], flow?: Vec): Tree | null {
  if (n < 1) return null;
  const outs: number[][] = Array.from({ length: n }, () => []), ins: number[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < links.length; i++) {
    const l = links[i];
    if (l.from === l.to || l.from < 0 || l.to < 0 || l.from >= n || l.to >= n) return null;
    outs[l.from].push(i);
    ins[l.to].push(i);
  }
  // in arrow order (none when a step leads back)
  const waiting = ins.map((x) => x.length);
  const topo: number[] = [];
  for (let i = 0; i < n; i++) if (!waiting[i]) topo.push(i);
  for (let k = 0; k < topo.length; k++) for (const li of outs[topo[k]]) if (--waiting[links[li].to] === 0) topo.push(links[li].to);
  if (topo.length < n) return null;
  // how many steps lead on from each species, and how many lead up to it (the longest way)
  const down = new Array<number>(n).fill(0), up = new Array<number>(n).fill(0);
  for (let k = n - 1; k >= 0; k--) for (const li of outs[topo[k]]) down[topo[k]] = Math.max(down[topo[k]], down[links[li].to] + 1);
  for (let k = 0; k < n; k++) for (const li of ins[topo[k]]) up[topo[k]] = Math.max(up[topo[k]], up[links[li].from] + 1);

  // of two that are as good: the one more nearly straight on the way the scheme runs (so the main
  // route stays the main route when it is read again), then the one higher on the page, then further left
  let fx = flow?.x ?? 0, fy = flow?.y ?? 0;
  // (the way it runs: as its layout says; when that isn't known, the way its steps lead taken together, which is a guess)
  const known = !!flow && Math.hypot(fx, fy) > 1e-6 && !!centres;
  if (!known) { fx = 0; fy = 0; if (centres) for (const l of links) if (centres[l.from] && centres[l.to]) { fx += centres[l.to].x - centres[l.from].x; fy += centres[l.to].y - centres[l.from].y; } }
  const flen = Math.hypot(fx, fy);
  /** How straight on the step from `a` to `b` is: 1 along the way the scheme runs, 0 square to it. */
  const straight = (a: number, b: number): number => {
    if (!centres?.[a] || !centres[b] || flen < 1e-6) return 0;
    const dx = centres[b].x - centres[a].x, dy = centres[b].y - centres[a].y, d = Math.hypot(dx, dy);
    return d < 1e-6 ? 0 : (dx * fx + dy * fy) / (d * flen);
  };
  const before = (a: number, b: number) => {
    if (centres?.[a] && centres[b]) {
      const dy = centres[a].y - centres[b].y;
      if (Math.abs(dy) > 1e-6) return dy < 0;
      const dx = centres[a].x - centres[b].x;
      if (Math.abs(dx) > 1e-6) return dx < 0;
    }
    return a < b;
  };
  const seen = new Set<number>();
  const used = new Set<number>();
  const runs: TreeRun[] = [];
  /** The best step on from `i` (forwards) or up to it (backwards) to a species not placed yet. */
  const next = (i: number, forward: boolean): number | undefined => {
    let best: number | undefined;
    for (const li of forward ? outs[i] : ins[i]) {
      const o = forward ? links[li].to : links[li].from;
      if (seen.has(o) || used.has(li)) continue;
      if (best === undefined) { best = li; continue; }
      const p = forward ? links[best].to : links[best].from;
      // the one that runs straight on (a route keeps going the way it is drawn, however long a
      // branch off it has grown), then the longer way, then the one higher up
      const so = forward ? straight(i, o) : straight(o, i), sp = forward ? straight(i, p) : straight(p, i);
      if (known && Math.abs(so - sp) > BEND) { if (so > sp) best = li; continue; }
      const depth = forward ? down : up;
      if (depth[o] !== depth[p]) { if (depth[o] > depth[p]) best = li; continue; }
      // (how it runs only guessed: the longer way first, then the straighter)
      if (!known && Math.abs(so - sp) > 0.02) { if (so > sp) best = li; continue; }
      if (before(o, p)) best = li;
    }
    return best;
  };
  /** A run from species `start`, going on forwards (or back up the arrows), and the branches off it. */
  const grow = (start: number, forward: boolean, join?: { parent: number; at: number; via: number }): void => {
    const nodes = [start], ls: number[] = [];
    seen.add(start);
    for (let li = next(start, forward); li !== undefined; li = next(nodes[nodes.length - 1], forward)) {
      const o = forward ? links[li].to : links[li].from;
      used.add(li);
      seen.add(o);
      nodes.push(o);
      ls.push(li);
    }
    if (!forward) { nodes.reverse(); ls.reverse(); }
    const me = runs.length;
    runs.push({ nodes, links: ls, ...(join ? { ...join, dir: forward ? 'out' as const : 'in' as const } : {}) });
    // the branches, from the start of the run to its end: those leading away first, then those leading in
    for (const x of nodes) {
      for (const forwardKid of [true, false]) {
        for (const li of forwardKid ? outs[x] : ins[x]) {
          const o = forwardKid ? links[li].to : links[li].from;
          if (seen.has(o) || used.has(li)) continue;
          used.add(li);
          grow(o, forwardKid, { parent: me, at: x, via: li });
        }
      }
    }
  };
  /** How straight the way on from `i` runs at its least straight step (1: in a line all the way). */
  const run = (i: number): number => {
    let worst = 1;
    const gone = new Set<number>([i]);
    for (let at = i, li = next(at, true); li !== undefined && !gone.has(links[li].to); li = next(at, true)) {
      worst = Math.min(worst, straight(at, links[li].to));
      at = links[li].to;
      gone.add(at);
    }
    return worst;
  };
  for (;;) {
    // the main route starts where nothing leads in: the start of the way that runs in a line, then of the longest way through
    let start: number | undefined, startRun = 0;
    for (let i = 0; i < n; i++) {
      if (seen.has(i) || ins[i].some((li) => !seen.has(links[li].from))) continue;
      const r = run(i);
      const better = start === undefined ? true
        : known && Math.abs(r - startRun) > BEND ? r > startRun
        : down[i] !== down[start] ? down[i] > down[start]
        : !known && Math.abs(r - startRun) > 0.02 ? r > startRun
        : before(i, start);
      if (better) { start = i; startRun = r; }
    }
    if (start === undefined) break;
    grow(start, true);
  }
  if (seen.size < n) return null;
  const extra = links.map((_, i) => i).filter((i) => !used.has(i));
  return { runs, extra, order: runs.flatMap((r) => r.nodes) };
}

/** The sizes a branching scheme is laid out with. */
export interface TreeSizes {
  /** Each species' width and height. */
  w: number[];
  h: number[];
  /** Each step: how long its arrow is drawn across the page and down it (to fit its conditions). */
  lenAcross: number[];
  lenDown: number[];
  /** Each step: how far its conditions reach off an arrow drawn across the page, [above it, below it]. */
  reachAcross: [number, number][];
  /** Each step: how far its conditions reach off an arrow drawn down the page, [to its right, to its left]. */
  reachDown: [number, number][];
  /** Each step: how wide what is written on its arrow is, along an arrow drawn across the page and down it (left out: as long as the arrow). */
  textAcross?: number[];
  textDown?: number[];
  /** Between a species and an arrow's end. */
  gap: number;
  /** Clear space kept between one route and the next. */
  rowGap: number;
}

export interface TreeOptions {
  /** The main route runs down the page (branches go off to the side); otherwise across it (branches go below and above). */
  vertical?: boolean;
  /** Branches fan out: a branch's first species sits a step on from the species it leaves (or a step before the one it joins), on a slanted arrow. Otherwise it sits squarely beside that species, on an upright arrow. */
  fan?: boolean;
}

export interface TreePlace {
  /** The middle of each species. */
  centres: Vec[];
  /** Each step's arrow (null for a step that joins nothing placed). */
  arrows: ({ tail: Vec; head: Vec } | null)[];
}

/** A point along the flow (m) and across it (c). */
interface P { m: number; c: number }
interface R { m1: number; m2: number; c1: number; c2: number }
/** A run laid out: where its species and arrows are, the room they take (`rects`: species, and arrows with all the room their words may take), and more exactly the species' boxes and the words on the arrows (`texts`). */
interface Sub { pos: Map<number, P>; rects: R[]; arrows: Map<number, { tail: P; head: P }>; boxes: R[]; texts: R[] }

/**
 * Lay a branching scheme out. The main route runs straight (across the page, or down it); each
 * branch runs beside it, as near as it fits, the first off a species below it (to the right of a
 * route running down) and the next on the other side. The first species of the main route is at (0, 0).
 */
export function layoutTree(tree: Tree, links: TreeLink[], z: TreeSizes, opts: TreeOptions = {}): TreePlace {
  const V = !!opts.vertical, fan = !!opts.fan, g = z.gap;
  const hm = (i: number) => (V ? z.h[i] : z.w[i]) / 2, hc = (i: number) => (V ? z.w[i] : z.h[i]) / 2;
  const lenM = (l: number) => (V ? z.lenDown[l] : z.lenAcross[l]), lenC = (l: number) => (V ? z.lenAcross[l] : z.lenDown[l]);
  // how far a step's conditions reach to each side of an arrow along the flow, [towards −c, towards +c]
  const reachM = (l: number): [number, number] => (V ? [z.reachDown[l][1], z.reachDown[l][0]] : z.reachAcross[l]);
  // ... and of an arrow across the flow (either side: it may point either way)
  const reachC = (l: number): number => (V ? Math.max(...z.reachAcross[l]) : Math.max(...z.reachDown[l]));
  const thin = Math.max(1e-3, g * 0.1);
  // how wide the words on a step's arrow are, along the flow
  const textM = (l: number) => Math.min(lenM(l), (V ? z.textDown?.[l] : z.textAcross?.[l]) ?? lenM(l));
  /** Whether the line from a to b passes through box r (grown by pad). */
  const cuts = (a: P, b: P, r: R, pad: number): boolean => {
    let t0 = 0, t1 = 1;
    const dm = b.m - a.m, dc = b.c - a.c;
    for (const [p, q] of [[-dm, a.m - (r.m1 - pad)], [dm, r.m2 + pad - a.m], [-dc, a.c - (r.c1 - pad)], [dc, r.c2 + pad - a.c]]) {
      if (Math.abs(p) < 1e-12) { if (q < 0) return false; continue; }
      const t = q / p;
      if (p < 0) { if (t > t1) return false; t0 = Math.max(t0, t); } else { if (t < t0) return false; t1 = Math.min(t1, t); }
    }
    return t0 <= t1;
  };
  const kids = new Map<number, number[]>();
  tree.runs.forEach((r, i) => { if (r.parent !== undefined) kids.set(r.parent, [...(kids.get(r.parent) ?? []), i]); });
  const box = (i: number, p: P): R => ({ m1: p.m - hm(i), m2: p.m + hm(i), c1: p.c - hc(i), c2: p.c + hc(i) });
  const moved = (r: R, by: P): R => ({ m1: r.m1 + by.m, m2: r.m2 + by.m, c1: r.c1 + by.c, c2: r.c2 + by.c });
  const hits = (a: R, b: R, mm: number, mc: number) => a.m1 < b.m2 + mm && b.m1 < a.m2 + mm && a.c1 < b.c2 + mc && b.c1 < a.c2 + mc;
  /** Where the line from p towards q leaves the box of species i (grown by the gap). */
  const leave = (i: number, p: P, q: P): P => {
    const dm = q.m - p.m, dc = q.c - p.c;
    let t = 1;
    if (Math.abs(dm) > 1e-9) t = Math.min(t, (hm(i) + g) / Math.abs(dm));
    if (Math.abs(dc) > 1e-9) t = Math.min(t, (hc(i) + g) / Math.abs(dc));
    return { m: p.m + dm * t, c: p.c + dc * t };
  };

  /** Run `ri` laid out with the species that joins it at (0, 0). `toward`: the side of that species its parent run is on (kept clear for the arrow that joins them). */
  const sub = (ri: number, toward?: 1 | -1): Sub => {
    const run = tree.runs[ri], back = run.dir === 'in';
    // from the species nearest where it joins, outwards
    const seq = back ? [...run.nodes].reverse() : run.nodes, sl = back ? [...run.links].reverse() : run.links;
    const S: Sub = { pos: new Map(), rects: [], arrows: new Map(), boxes: [], texts: [] };
    S.pos.set(seq[0], { m: 0, c: 0 });
    for (let k = 1; k < seq.length; k++) {
      const a = seq[k - 1], b = seq[k], l = sl[k - 1], at = S.pos.get(a)!.m, len = lenM(l);
      const tail = back ? at - hm(a) - g - len : at + hm(a) + g, head = tail + len;
      S.pos.set(b, { m: back ? tail - g - hm(b) : head + g + hm(b), c: 0 });
      S.arrows.set(l, { tail: { m: tail, c: 0 }, head: { m: head, c: 0 } });
      const [neg, pos] = reachM(l);
      S.rects.push({ m1: tail, m2: head, c1: -Math.max(neg, thin), c2: Math.max(pos, thin) });
      const w = textM(l), mid = (tail + head) / 2;
      if (neg > 0) S.texts.push({ m1: mid - w / 2, m2: mid + w / 2, c1: -neg, c2: 0 });
      if (pos > 0) S.texts.push({ m1: mid - w / 2, m2: mid + w / 2, c1: 0, c2: pos });
    }
    for (const i of seq) { const b = box(i, S.pos.get(i)!); S.rects.push(b); S.boxes.push(b); }
    for (const x of seq) {
      const here = S.pos.get(x)!, own = box(x, here);
      const sided = { 1: 0, [-1]: 0 } as Record<1 | -1, number>;
      // squarely beside a species there is room for one branch on each side (none on the side the run's own parent is on)
      const taken = new Set<1 | -1>();
      if (x === seq[0] && toward !== undefined) taken.add(toward);
      for (const ki of (kids.get(ri) ?? []).filter((k) => tree.runs[k].at === x)) {
        const kid = tree.runs[ki], via = kid.via!, f = kid.dir === 'in' ? -1 : 1;
        const a = kid.dir === 'in' ? kid.nodes[kid.nodes.length - 1] : kid.nodes[0];
        const laid = new Map<string, Sub>();
        /** The branch laid out to go on side `s`: squarely beside the species, or (`slant`) a step on from it. */
        const K = (s: 1 | -1, slant: boolean): Sub => {
          const key = `${s}${slant}`;
          let k = laid.get(key);
          if (!k) { k = sub(ki, slant ? undefined : s > 0 ? -1 : 1); laid.set(key, k); }
          return k;
        };
        const amOf = (slant: boolean) => (slant ? here.m + f * (hm(x) + g + lenM(via) + g + hm(a)) : here.m);
        const joinOf = (s: 1 | -1, slant: boolean, d: number, edge = false): { tail: P; head: P; rect: R; texts: R[] } => {
          const am = amOf(slant), ac = here.c + s * d;
          // slanted: from the middle of the side of one species to the middle of the side of the other, starting a little towards it
          // (`edge`: from the species' edge on that side instead, where words on the arrow straight on are in the way)
          const p = slant ? (edge ? { m: here.m + f * hm(x) * 0.5, c: here.c + s * (hc(x) + g) } : { m: here.m + f * (hm(x) + g), c: here.c + s * Math.min(hc(x) * 0.5, d * 0.25) }) : { m: am, c: here.c + s * (hc(x) + g) };
          const q = slant ? { m: am - f * (hm(a) + g), c: ac } : { m: am, c: ac - s * (hc(a) + g) };
          const r = slant ? thin : Math.max(reachC(via), thin);
          const rect = { m1: Math.min(p.m, q.m) - r, m2: Math.max(p.m, q.m) + r, c1: Math.min(p.c, q.c), c2: Math.max(p.c, q.c) };
          // what is written on a slanted arrow sits off its middle, square to it: room is kept for that too
          const texts: R[] = [];
          if (slant) {
            // (the arrow always points along the flow; "above" it is towards −c, turned with the arrow)
            const t = kid.dir === 'in' ? q : p, h = kid.dir === 'in' ? p : q;
            const len = Math.hypot(h.m - t.m, h.c - t.c) || 1, cos = (h.m - t.m) / len, sin = (h.c - t.c) / len;
            const mid = { m: (t.m + h.m) / 2, c: (t.c + h.c) / 2 }, w = textM(via);
            const [neg, pos] = reachM(via);
            for (const [reach, sign] of [[neg, -1], [pos, 1]] as const) {
              if (reach <= 0) continue;
              // (its box is upright: its nearest corner keeps the words' usual distance from the arrow)
              const D = reach * 0.55 + (w * Math.abs(sin)) / 2;
              const c = { m: mid.m - sign * sin * D, c: mid.c + sign * cos * D };
              texts.push({ m1: c.m - w / 2, m2: c.m + w / 2, c1: c.c - reach * 0.45, c2: c.c + reach * 0.45 });
            }
          } else if (reachC(via) > thin) texts.push(rect);
          return kid.dir === 'in' ? { tail: q, head: p, rect, texts } : { tail: p, head: q, rect, texts };
        };
        const fit = (s: 1 | -1, slant: boolean): { s: 1 | -1; slant: boolean; d: number; blocked: boolean; edge: boolean } => {
          const am = amOf(slant), k = K(s, slant);
          let d = slant ? hc(a) + Math.min(hc(x), hc(a)) + z.rowGap * 0.5 : hc(x) + g + lenC(via) + g + hc(a);
          // (clear of the species first; then, a slanted arrow, moved further for the words, but not for ever)
          let edge = false, clear = -1, pushes = 0;
          for (let round = 0; round < 90; round++) {
            let more = d;
            for (const p of k.rects) {
              const now = moved(p, { m: am, c: here.c + s * d });
              for (const q of S.rects) {
                if (!hits(now, q, g, z.rowGap)) continue;
                more = Math.max(more, s > 0 ? q.c2 + z.rowGap - p.c1 - here.c : here.c + p.c2 - q.c1 + z.rowGap);
              }
            }
            // (and the words on its slanted arrow clear of what is there)
            if (slant && more <= d + 1e-9) {
              if (clear < 0) clear = d;
              const pad = g * 0.5;
              // its arrow not through words already there; its own words not on a species or other words, and well clear of another arrow (so it is plain whose they are)
              const bad = (j: ReturnType<typeof joinOf>) => S.texts.some((t) => cuts(j.tail, j.head, t, pad))
                || j.texts.some((t) => S.boxes.some((q) => hits(t, q, pad, pad)) || S.texts.some((q) => hits(t, q, pad, pad)) || [...S.arrows.values()].some((r) => cuts(r.tail, r.head, t, z.rowGap * 0.3)));
              if (bad(joinOf(s, true, d, edge))) {
                // further off first; if that never clears it (words on the arrow straight on, right where this one sets off), from the species' edge instead
                if (++pushes <= 16) more = d + z.rowGap * 0.25;
                else if (!edge) { edge = true; pushes = 0; d = clear; continue; }
                else { d = clear; edge = false; break; }
              }
            }
            if (more <= d + 1e-9) break;
            d = more;
          }
          // an upright joining arrow has to get there without crossing another route
          // (a slanted arrow's box says nothing: where it fits is found by the species it leads to)
          const j = joinOf(s, slant, d).rect;
          const blocked = !slant && S.rects.some((q) => !(q.m1 === own.m1 && q.m2 === own.m2 && q.c1 === own.c1 && q.c2 === own.c2) && hits(j, q, 0, 0));
          return { s, slant, d, blocked, edge };
        };
        // on the side it is on already; a new one on the side with fewer branches (below first), unless the other is much nearer
        const pref: 1 | -1 = kid.side ?? (sided[-1] < sided[1] ? -1 : 1), other: 1 | -1 = pref > 0 ? -1 : 1;
        const pick = (A: ReturnType<typeof fit> | null, B: ReturnType<typeof fit> | null): ReturnType<typeof fit> | null => {
          if (!A || !B) return A ?? B;
          if (kid.side !== undefined) return A;
          return A.d <= B.d * 1.75 + 1e-9 ? A : B;
        };
        const open = (s: 1 | -1) => { if (fan || taken.has(s)) return null; const got = fit(s, false); return got.blocked ? null : got; };
        const got = pick(open(pref), open(other)) ?? pick(fit(pref, true), fit(other, true))!;
        if (!got.slant) taken.add(got.s);
        sided[got.s]++;
        const k = K(got.s, got.slant);
        const by = { m: amOf(got.slant), c: here.c + got.s * got.d };
        for (const [i, p] of k.pos) S.pos.set(i, { m: p.m + by.m, c: p.c + by.c });
        for (const [l, r] of k.arrows) S.arrows.set(l, { tail: { m: r.tail.m + by.m, c: r.tail.c + by.c }, head: { m: r.head.m + by.m, c: r.head.c + by.c } });
        const jn = joinOf(got.s, got.slant, got.d, got.edge);
        S.arrows.set(via, { tail: jn.tail, head: jn.head });
        for (const p of k.rects) S.rects.push(moved(p, by));
        for (const p of k.boxes) S.boxes.push(moved(p, by));
        for (const p of k.texts) S.texts.push(moved(p, by));
        S.rects.push(jn.rect, ...(got.slant ? jn.texts : []));
        S.texts.push(...jn.texts);
      }
    }
    return S;
  };

  const pos = new Map<number, P>(), arrows = new Map<number, { tail: P; head: P }>();
  let low = -Infinity, left = 0, first = true;
  tree.runs.forEach((r, ri) => {
    if (r.parent !== undefined) return;
    const S = sub(ri);
    // parts that nothing joins go one under the other, their starts in line
    let by = { m: 0, c: 0 };
    if (first) { left = Math.min(...S.rects.map((q) => q.m1)); first = false; }
    else by = { m: left - Math.min(...S.rects.map((q) => q.m1)), c: low + 2 * z.rowGap - Math.min(...S.rects.map((q) => q.c1)) };
    for (const [i, p] of S.pos) pos.set(i, { m: p.m + by.m, c: p.c + by.c });
    for (const [l, a] of S.arrows) arrows.set(l, { tail: { m: a.tail.m + by.m, c: a.tail.c + by.c }, head: { m: a.head.m + by.m, c: a.head.c + by.c } });
    low = Math.max(low, ...S.rects.map((q) => q.c2 + by.c));
  });
  // a step between two species already placed runs straight from one to the other
  for (const l of tree.extra) {
    const a = pos.get(links[l].from), b = pos.get(links[l].to);
    if (a && b) arrows.set(l, { tail: leave(links[l].from, a, b), head: leave(links[l].to, b, a) });
  }
  const xy = (p: P): Vec => (V ? { x: p.c, y: p.m } : { x: p.m, y: p.c });
  return {
    centres: z.w.map((_, i) => xy(pos.get(i) ?? { m: 0, c: 0 })),
    arrows: links.map((_, l) => { const a = arrows.get(l); return a ? { tail: xy(a.tail), head: xy(a.head) } : null; }),
  };
}
