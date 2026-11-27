// Aromatic rings drawn with a circle. A circled ring's bonds are aromatic (order 1.5) and marked
// `circle`, so they draw as single lines round a circle; turning the circle off puts alternating
// single and double bonds back (a Kekulé structure).

import type { Doc } from '../model';
import { implicitHydrogens, maxValence, SYMBOLS } from './elements';
import type { Vec } from '../geom';

const key = (ring: number[]) => [...ring].sort((a, b) => a - b).join(',');

/** A ring through the bond, avoiding some atoms: its atoms in order, a1 first and a2 last. */
function ringAvoiding(doc: Doc, bondId: number, avoid: Set<number>, maxSize = 8): number[] | null {
  const b = doc.bonds.get(bondId);
  if (!b) return null;
  const prev = new Map<number, number>([[b.a2, -1]]);
  let frontier = [b.a2];
  for (let depth = 1; depth < maxSize && frontier.length; depth++) {
    const next: number[] = [];
    for (const id of frontier) {
      for (const bid of doc.adj.get(id) ?? []) {
        if (bid === bondId) continue;
        const bb = doc.bonds.get(bid)!;
        const o = bb.a1 === id ? bb.a2 : bb.a1;
        if (prev.has(o) || avoid.has(o)) continue;
        prev.set(o, id);
        if (o === b.a1) {
          const path = [o];
          let cur = id;
          while (cur !== -1) { path.push(cur); cur = prev.get(cur)!; }
          return path;
        }
        next.push(o);
      }
    }
    frontier = next;
  }
  return null;
}

/** The smallest rings through a bond: one on each side of it (when it is shared by two). Rings bigger than `maxSize` atoms aren't looked for. */
export function ringsThroughBond(doc: Doc, bondId: number, maxSize = 8): number[][] {
  const first = ringAvoiding(doc, bondId, new Set(), maxSize);
  if (!first) return [];
  const b = doc.bonds.get(bondId)!;
  const inner = new Set(first.filter((a) => a !== b.a1 && a !== b.a2));
  const second = ringAvoiding(doc, bondId, inner, maxSize);
  return second && key(second) !== key(first) ? [first, second] : [first];
}

/** The bond between two atoms, if there is one. */
function bondBetween(doc: Doc, a: number, c: number): number | undefined {
  for (const bid of doc.adj.get(a) ?? []) { const b = doc.bonds.get(bid)!; if (b.a1 === c || b.a2 === c) return bid; }
  return undefined;
}

/** The bonds round a ring, in order. */
export function ringBonds(doc: Doc, ring: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < ring.length; i++) { const b = bondBetween(doc, ring[i], ring[(i + 1) % ring.length]); if (b !== undefined) out.push(b); }
  return out;
}

/** Is this ring drawn with a circle (every bond round it aromatic and circled)? */
export function isCircleRing(doc: Doc, ring: number[]): boolean {
  const bs = ringBonds(doc, ring);
  return bs.length === ring.length && bs.every((id) => { const b = doc.bonds.get(id)!; return b.order === 1.5 && !!b.circle; });
}

/**
 * Centre of a ring and the radius its circle is drawn at (well inside the bonds). A ring drawn
 * at an angle (a regular ring in perspective, as on a metallocene) has its circle seen at the
 * same angle: an ellipse, given as `ellipse`.
 */
export function ringCircle(doc: Doc, ring: number[]): RingCircle {
  return circleIn(ring.map((id) => doc.atoms.get(id)!));
}

export interface RingCircle {
  center: Vec;
  radius: number;
  /** The circle seen at an angle: the points center + m·(r cos φ, r sin φ), φ round the ring as its atoms go. */
  ellipse?: { m: [number, number, number, number]; r: number };
}

/** The circle (or, for a regular ring seen at an angle, the ellipse) inside a ring of points in order. */
export function circleIn(pts: Vec[]): RingCircle {
  const n = pts.length;
  let x = 0, y = 0;
  for (const p of pts) { x += p.x; y += p.y; }
  const center = { x: x / n, y: y / n };
  // distance from the centre to the nearest bond middle
  let apothem = Infinity;
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    apothem = Math.min(apothem, Math.hypot((p.x + q.x) / 2 - center.x, (p.y + q.y) / 2 - center.y));
  }
  const plain = { center, radius: 0.62 * apothem };
  if (n < 3) return plain;
  // the regular polygon that, stretched and turned (m), best gives these points
  let a = 0, b = 0, c = 0, d = 0;
  pts.forEach((p, k) => {
    const u = Math.cos((2 * Math.PI * k) / n), v = Math.sin((2 * Math.PI * k) / n);
    a += (p.x - center.x) * u; b += (p.x - center.x) * v; c += (p.y - center.y) * u; d += (p.y - center.y) * v;
  });
  const m: [number, number, number, number] = [(2 * a) / n, (2 * b) / n, (2 * c) / n, (2 * d) / n];
  let miss = 0, size = 0;
  pts.forEach((p, k) => {
    const u = Math.cos((2 * Math.PI * k) / n), v = Math.sin((2 * Math.PI * k) / n);
    miss = Math.max(miss, Math.hypot(center.x + m[0] * u + m[1] * v - p.x, center.y + m[2] * u + m[3] * v - p.y));
    size += Math.hypot(p.x - center.x, p.y - center.y) / n;
  });
  // not a regular ring in perspective: the plain circle
  if (miss > 0.12 * size) return plain;
  const [s1, s2] = singularValues(m);
  // seen face on (or nearly): the plain circle
  if (s2 > 0.96 * s1) return plain;
  return { center, radius: plain.radius, ellipse: { m, r: 0.62 * Math.cos(Math.PI / n) } };
}

/** The two singular values of a 2×2 matrix, larger first. */
export function singularValues([a, b, c, d]: [number, number, number, number]): [number, number] {
  const s = a * a + b * b + c * c + d * d, det = a * d - b * c;
  const root = Math.sqrt(Math.max(0, s * s - 4 * det * det));
  return [Math.sqrt((s + root) / 2), Math.sqrt(Math.max(0, (s - root) / 2))];
}

/** The ends of an ellipse's long and short axes, from its middle. */
export function ellipseAxes(e: { m: [number, number, number, number]; r: number }): { major: Vec; minor: Vec } {
  const [a, b, c, d] = e.m;
  // the direction φ where |m·(cos φ, sin φ)| is largest
  const phi = 0.5 * Math.atan2(2 * (a * b + c * d), a * a + c * c - b * b - d * d);
  const at = (f: number) => ({ x: (a * Math.cos(f) + b * Math.sin(f)) * e.r, y: (c * Math.cos(f) + d * Math.sin(f)) * e.r });
  const p = at(phi), q = at(phi + Math.PI / 2);
  return Math.hypot(p.x, p.y) >= Math.hypot(q.x, q.y) ? { major: p, minor: q } : { major: q, minor: p };
}

/** Points along an ellipse's arc from the one towards `p` to the one towards `q` (the short way round). */
export function ellipseArc(center: Vec, e: { m: [number, number, number, number]; r: number }, p: Vec, q: Vec, steps = 14): Vec[] {
  const [a, b, c, d] = e.m;
  const det = a * d - b * c || 1e-12;
  const phiOf = (v: Vec) => { const dx = v.x - center.x, dy = v.y - center.y; return Math.atan2((-c * dx + a * dy) / det, (d * dx - b * dy) / det); };
  const f1 = phiOf(p);
  let df = phiOf(q) - f1;
  while (df > Math.PI) df -= 2 * Math.PI;
  while (df < -Math.PI) df += 2 * Math.PI;
  const out: Vec[] = [];
  for (let k = 0; k <= steps; k++) {
    const f = f1 + (df * k) / steps;
    out.push({ x: center.x + (a * Math.cos(f) + b * Math.sin(f)) * e.r, y: center.y + (c * Math.cos(f) + d * Math.sin(f)) * e.r });
  }
  return out;
}

/**
 * Is this ring aromatic as drawn? Every atom round it has a double bond within a ring (its own,
 * or a ring fused to it, as in naphthalene), except that a five-membered ring may have one N, O,
 * S or negatively charged atom without (pyrrole, furan, cyclopentadienide) and a seven-membered
 * ring one positive carbon (tropylium). A double bond out of the ring (a quinone's C=O) doesn't count.
 */
function kekuleAromatic(doc: Doc, ring: number[]): boolean {
  const n = ring.length;
  if (n < 5 || n > 7) return false;
  const bs = ringBonds(doc, ring).map((id) => doc.bonds.get(id)!);
  if (bs.length !== n || bs.some((b) => b.order !== 1 && b.order !== 2 && b.order !== 1.5)) return false;
  const ringDouble = (id: number) => [...(doc.adj.get(id) ?? [])].some((bid) => {
    const b = doc.bonds.get(bid)!;
    return (b.order === 2 || b.order === 1.5) && doc.ringThroughBond(bid) !== null;
  });
  const free = ring.filter((id) => !ringDouble(id));
  if (n === 6) return free.length === 0;
  if (free.length !== 1) return false;
  const a = doc.atoms.get(free[0])!;
  if (n === 5) return [7, 8, 15, 16, 34].includes(a.z) || a.charge < 0;
  return a.charge > 0;
}

/** Rings that use these bonds (every ring in the drawing when `bonds` is empty). */
export function ringsAmong(doc: Doc, bonds: Iterable<number>): number[][] {
  const seen = new Map<string, number[]>();
  const ids = [...bonds];
  for (const id of ids.length ? ids : doc.bonds.keys()) for (const r of ringsThroughBond(doc, id)) seen.set(key(r), r);
  return [...seen.values()];
}

/** Draw the aromatic rings among these bonds (all, when empty) with circles. Returns how many. */
export function circleRings(doc: Doc, bonds: Iterable<number>): number {
  const rings = ringsAmong(doc, bonds).filter((r) => !isCircleRing(doc, r) && kekuleAromatic(doc, r));
  // an NH (pyrrole, indole) keeps its H as a written label, which aromatic bonds alone can't show
  const nh = new Set<number>();
  for (const r of rings) {
    for (const id of r) {
      const a = doc.atoms.get(id)!;
      if (a.label || a.charge || !(a.z === 7 || a.z === 15)) continue;
      if (implicitHydrogens(a.z, doc.valenceSum(id), 0) > 0 && ![...(doc.adj.get(id) ?? [])].some((b) => doc.bonds.get(b)!.order === 2)) nh.add(id);
    }
  }
  for (const r of rings) for (const id of ringBonds(doc, r)) doc.updateBond(id, { order: 1.5, circle: true });
  for (const id of nh) doc.updateAtom(id, { label: SYMBOLS[doc.atoms.get(id)!.z] + 'H' });
  return rings.length;
}

/** Make one ring's bonds circled aromatic bonds (a ring just drawn with Ctrl held). */
export function circleRing(doc: Doc, ring: number[]): void {
  for (const id of ringBonds(doc, ring)) doc.updateBond(id, { order: 1.5, circle: true });
}

/**
 * Put alternating single and double bonds back in circled rings among these bonds (all, when
 * empty). Every carbon gets one double bond; N, O, S and charged atoms may go without (pyrrole
 * NH, furan O). Returns how many rings changed, or −1 when no such pattern exists.
 */
export function kekulize(doc: Doc, bonds: Iterable<number>): number {
  const rings = ringsAmong(doc, bonds).filter((r) => isCircleRing(doc, r));
  if (!rings.length) return 0;
  // all circled bonds joined to these rings (a fused system has to be done as one)
  const todo = new Set<number>();
  const stack = rings.flatMap((r) => ringBonds(doc, r));
  while (stack.length) {
    const id = stack.pop()!;
    if (todo.has(id)) continue;
    todo.add(id);
    const b = doc.bonds.get(id)!;
    for (const a of [b.a1, b.a2]) for (const n of doc.adj.get(a) ?? []) { const o = doc.bonds.get(n)!; if (o.circle && o.order === 1.5 && !todo.has(n)) stack.push(n); }
  }
  const chosen = kekuleDoubles(doc, todo);
  if (!chosen) return -1;
  const paired = new Set([...chosen].flatMap((id) => { const b = doc.bonds.get(id)!; return [b.a1, b.a2]; }));
  const atoms = [...new Set([...todo].flatMap((id) => { const b = doc.bonds.get(id)!; return [b.a1, b.a2]; }))];
  for (const id of todo) doc.updateBond(id, { order: chosen.has(id) ? 2 : 1, circle: undefined });
  // an NH label written when the ring was circled goes back to an automatic one
  for (const id of atoms) {
    const a = doc.atoms.get(id)!;
    if (a.label === SYMBOLS[a.z] + 'H' && !paired.has(id) && implicitHydrogens(a.z, doc.valenceSum(id), a.charge) === 1) doc.updateAtom(id, { label: null });
  }
  return rings.length;
}

/**
 * Which of these bonds (a set of 1½ bonds) to make double so every neutral carbon has one
 * double bond; N, O, S and charged atoms (tropylium's C⁺, cyclopentadienide's C⁻) may go
 * without. Null when no such pattern exists. The drawing is not changed.
 */
export function kekuleDoubles(doc: Doc, todo: Set<number>, strict = false): Set<number> | null {
  const atoms = [...new Set([...todo].flatMap((id) => { const b = doc.bonds.get(id)!; return [b.a1, b.a2]; }))];
  // an atom already double-bonded outside the rings (a quinone's C=O) needs none inside
  const optional = (id: number) => {
    const a = doc.atoms.get(id)!;
    if (a.z !== 6 || a.charge !== 0 || (strict && a.label)) return true;
    return [...(doc.adj.get(id) ?? [])].some((bid) => !todo.has(bid) && doc.bonds.get(bid)!.order === 2);
  };
  // (strict: only an atom with room for one more bond takes a double bond, so the neutral O of
  // a ring ether isn't made an oxonium)
  const room = (id: number) => {
    const a = doc.atoms.get(id)!;
    const max = maxValence(a.z, a.charge);
    if (!strict || a.label || max === undefined) return true;
    let used = 0;
    for (const bid of doc.adj.get(id) ?? []) { const b = doc.bonds.get(bid)!; used += todo.has(bid) ? 1 : b.order === 1.5 ? 1 : b.order; }
    return used + 1 <= max;
  };
  const paired = new Map<number, number>();
  const chosen = new Set<number>();
  // Each ring system on its own: a system with no pattern fails at once, without trying every
  // pattern of the systems before it again. A system whose atoms all need a double bond and are
  // odd in number has none (each double bond pairs two of them).
  const comp = new Map<number, number>();
  const comps: number[][] = [];
  for (const start of atoms) {
    if (comp.has(start)) continue;
    const list = [start];
    comp.set(start, comps.length);
    for (let k = 0; k < list.length; k++) for (const bid of doc.adj.get(list[k]) ?? []) {
      if (!todo.has(bid)) continue;
      const b = doc.bonds.get(bid)!;
      const o = b.a1 === list[k] ? b.a2 : b.a1;
      if (!comp.has(o)) { comp.set(o, comps.length); list.push(o); }
    }
    comps.push(list);
  }
  if (comps.some((c) => c.length % 2 === 1 && !c.some(optional))) return null;
  let part: number[] = [];
  // The search below tries the atoms in the order they come and keeps the first pattern, as
  // before; it is given a number of steps. A system it can't settle in them (a large one with no
  // pattern that isn't simply odd: two carbons too many, or an odd one with an N in it) is
  // settled by a matching instead, which takes time in proportion to a power of the atoms, not
  // to the patterns (review F380).
  let steps = 0;
  const STEPS = 20000;
  const solve = (i: number): boolean | null => {
    if (++steps > STEPS) return null;
    if (i === part.length) return true;
    const a = part[i];
    if (paired.has(a)) return solve(i + 1);
    for (const bid of doc.adj.get(a) ?? []) {
      if (!todo.has(bid)) continue;
      const b = doc.bonds.get(bid)!;
      const o = b.a1 === a ? b.a2 : b.a1;
      if (paired.has(o) || !room(a) || !room(o)) continue;
      paired.set(a, o); paired.set(o, a); chosen.add(bid);
      const r = solve(i + 1);
      if (r !== false) return r;
      paired.delete(a); paired.delete(o); chosen.delete(bid);
    }
    return optional(a) ? solve(i + 1) : false;
  };
  for (let k = 0; k < comps.length; k++) {
    // (in the order the atoms come, as before: the same pattern is found)
    part = atoms.filter((a) => comp.get(a) === k);
    steps = 0;
    const r = solve(0);
    if (r === false) return null;
    if (r === true) continue;
    // too many steps: this system's part of the search is undone and a matching is used
    for (const a of part) paired.delete(a);
    for (const bid of [...chosen]) { const b = doc.bonds.get(bid)!; if (comp.get(b.a1) === k) chosen.delete(bid); }
    const found = matchedBonds(doc, todo, part, optional, room);
    if (!found) return null;
    for (const bid of found) { const b = doc.bonds.get(bid)!; chosen.add(bid); paired.set(b.a1, b.a2); paired.set(b.a2, b.a1); }
  }
  return chosen;
}

/**
 * Bonds among `todo` to make double so each atom of `part` that isn't optional has one: a
 * matching that covers those atoms, found with Edmonds' blossom method (J. Edmonds, "Paths,
 * trees, and flowers", Can. J. Math. 1965, 17, 449–467) on the ring system doubled, each optional
 * atom joined to its own copy, where such a matching is a perfect matching. Null when there is none.
 */
function matchedBonds(doc: Doc, todo: Set<number>, part: number[], optional: (id: number) => boolean, room: (id: number) => boolean): number[] | null {
  const n = part.length;
  const index = new Map(part.map((a, i) => [a, i]));
  const adj: number[][] = Array.from({ length: 2 * n }, () => []);
  const bondOf = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const a = part[i];
    if (!room(a) && !optional(a)) return null;
    if (optional(a)) { adj[i].push(i + n); adj[i + n].push(i); }
    if (!room(a)) continue;
    for (const bid of doc.adj.get(a) ?? []) {
      if (!todo.has(bid)) continue;
      const b = doc.bonds.get(bid)!;
      const j = index.get(b.a1 === a ? b.a2 : b.a1);
      if (j === undefined || j <= i || !room(part[j])) continue;
      adj[i].push(j); adj[j].push(i); adj[i + n].push(j + n); adj[j + n].push(i + n);
      bondOf.set(i * n + j, bid);
    }
  }
  const match = maximumMatching(adj);
  if (match.some((m) => m < 0)) return null;
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (match[i] >= 0 && match[i] < n && match[i] > i) out.push(bondOf.get(i * n + match[i])!);
  return out;
}

/** A largest matching of a graph (any graph, odd rings too): each vertex's partner, or −1. Edmonds' blossom method. */
function maximumMatching(adj: number[][]): number[] {
  const n = adj.length;
  const match = new Array<number>(n).fill(-1), p = new Array<number>(n).fill(-1), base = new Array<number>(n).fill(0);
  const used = new Array<boolean>(n).fill(false), blossom = new Array<boolean>(n).fill(false);
  const lca = (a: number, b: number) => {
    const seen = new Array<boolean>(n).fill(false);
    for (;;) { a = base[a]; seen[a] = true; if (match[a] < 0) break; a = p[match[a]]; }
    for (;;) { b = base[b]; if (seen[b]) return b; b = p[match[b]]; }
  };
  const markPath = (v: number, b: number, child: number) => {
    while (base[v] !== b) {
      blossom[base[v]] = blossom[base[match[v]]] = true;
      p[v] = child; child = match[v]; v = p[match[v]];
    }
  };
  const findPath = (root: number): number => {
    used.fill(false); p.fill(-1);
    for (let i = 0; i < n; i++) base[i] = i;
    used[root] = true;
    const q = [root];
    for (let h = 0; h < q.length; h++) {
      const v = q[h];
      for (const to of adj[v]) {
        if (base[v] === base[to] || match[v] === to) continue;
        if (to === root || (match[to] >= 0 && p[match[to]] >= 0)) {
          const cur = lca(v, to);
          blossom.fill(false);
          markPath(v, cur, to); markPath(to, cur, v);
          for (let i = 0; i < n; i++) if (blossom[base[i]]) { base[i] = cur; if (!used[i]) { used[i] = true; q.push(i); } }
        } else if (p[to] < 0) {
          p[to] = v;
          if (match[to] < 0) return to;
          used[match[to]] = true; q.push(match[to]);
        }
      }
    }
    return -1;
  };
  // a quick start: each vertex with a free neighbour paired with it
  for (let v = 0; v < n; v++) if (match[v] < 0) for (const to of adj[v]) if (match[to] < 0) { match[v] = to; match[to] = v; break; }
  for (let v = 0; v < n; v++) {
    if (match[v] >= 0) continue;
    let u = findPath(v);
    while (u >= 0) { const pv = p[u], ppv = match[pv]; match[u] = pv; match[pv] = u; u = ppv; }
  }
  return match;
}

/** Is this 1½ bond in a ring of 1½ bonds (can a1 be reached from a2 along other 1½ bonds)? */
export function aromaticBondInRing(doc: Doc, bondId: number): boolean {
  const b = doc.bonds.get(bondId);
  if (!b || b.order !== 1.5) return false;
  const seen = new Set<number>([b.a2]);
  const stack = [b.a2];
  while (stack.length) {
    const id = stack.pop()!;
    for (const bid of doc.adj.get(id) ?? []) {
      if (bid === bondId) continue;
      const o = doc.bonds.get(bid)!;
      if (o.order !== 1.5) continue;
      const n = o.a1 === id ? o.a2 : o.a1;
      if (n === b.a1) return true;
      if (!seen.has(n)) { seen.add(n); stack.push(n); }
    }
  }
  return false;
}

/**
 * The 1½ bonds among these that can only be single. ChemDraw draws a 1½ bond with no ring circle
 * as a plain line, and some files have them where no aromatic ring can be (Nate's 2026-11-16
 * pyranose: the ring and its OH, OMe and anomeric bonds, all Order="1.5"). A 1½ bond is read as
 * single when it is in no ring of 1½ bonds, or when its ring system has no Kekulé structure
 * (its carbons can't each get a double bond). The drawing is not changed, so it saves as it came.
 */
export function aromaticAsSingle(doc: Doc, bonds: Iterable<number>): Set<number> {
  const out = new Set<number>();
  const ring = new Set<number>();
  for (const id of bonds) {
    if (doc.bonds.get(id)?.order !== 1.5 || out.has(id) || ring.has(id)) continue;
    if (!aromaticBondInRing(doc, id)) { out.add(id); continue; }
    // the ring system this bond is in: 1½ bonds joined to it that are in rings themselves
    const part = new Set<number>();
    const stack = [id];
    while (stack.length) {
      const bid = stack.pop()!;
      if (part.has(bid)) continue;
      part.add(bid);
      const b = doc.bonds.get(bid)!;
      for (const a of [b.a1, b.a2]) {
        for (const n of doc.adj.get(a) ?? []) {
          if (part.has(n) || out.has(n) || doc.bonds.get(n)!.order !== 1.5) continue;
          if (aromaticBondInRing(doc, n)) stack.push(n);
          else out.add(n);
        }
      }
    }
    if (kekuleDoubles(doc, part, true)) for (const bid of part) ring.add(bid);
    else for (const bid of part) out.add(bid);
  }
  return out;
}
