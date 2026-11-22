// Keeps structures the chemistry engine can't handle away from the calls that would break it.
//
// RDKit's WebAssembly build has a small fixed stack. Writing or reading SMILES walks the molecule
// depth first, one stack frame per atom along the walk, so a long unbranched run of atoms (a
// polymer or PEG drawn in full, a long macrocycle, a big fused ring sheet) runs out of stack:
// measured with the RDKit_minimal.wasm Chemweave ships, a chain or ring of about 620 atoms, or a
// 640-atom ladder of fused rings, kills the module ("memory access out of bounds", or a hang), and
// every later request then fails (the facts the SI tab works out fail from about 590). The 2-D
// layout (set_new_coords) breaks the same way on a 900-atom chain. Reading a molfile, formulas,
// masses and R/S were fine up to 3,000 atoms; InChI and splitting into pieces hang on big fused
// ring systems.
//
// Separately, CoordGen's layout (set_new_coords(true)) takes minutes or never ends on a ring of
// about 40 atoms or more (a 34-atom ring 3.4 s, 40 atoms over 60 s; cyclosporin's 33-atom ring,
// β-cyclodextrin and C60 well under a second), so it is skipped when a structure has one
// (`hasMacrocycle`).
//
// So before a SMILES call the worker asks `tooDeep`: an upper bound on the longest walk is worked
// out from the structure's graph, and anything over DEEP_LIMIT skips the SMILES-based work (with
// TOO_DEEP said where the answer would show). The client's watchdog (client.ts) catches anything
// this misses.

/** The longest run of atoms (an upper bound) allowed into a SMILES call; failures start at about 620. */
export const DEEP_LIMIT = 500;

/** What is said instead of an answer the guard held back. */
export const TOO_DEEP = `This structure has more than ${DEEP_LIMIT} atoms in a row (through chains and rings), which is more than the chemistry engine can handle, so this can’t be calculated for it. Draw a long chain as its repeat unit in polymer brackets instead.`;

/** The largest ring CoordGen lays out in good time (see above). */
export const COORDGEN_RING_LIMIT = 36;

/**
 * Whether some bond's smallest ring has more than `limit` atoms (a macrocycle that isn't made of
 * small fused rings): for each bond, the shortest way round from one end to the other without it.
 */
export function hasMacrocycle(g: Graph, limit = COORDGEN_RING_LIMIT): boolean {
  const { n } = g;
  if (n <= limit) return false;
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (const [a, b] of g.edges) {
    if (a === b || a < 0 || b < 0 || a >= n || b >= n) continue;
    adj[a].push(b);
    adj[b].push(a);
  }
  const dist = new Int32Array(n);
  for (const [a, b] of g.edges) {
    if (a === b || a < 0 || b < 0 || a >= n || b >= n) continue;
    // breadth first from a to b, not using the bond a–b, no further than `limit` steps
    dist.fill(-1);
    dist[a] = 0;
    let frontier = [a], found = -1;
    while (frontier.length && found < 0) {
      const next: number[] = [];
      for (const v of frontier) {
        if (dist[v] >= limit) continue;
        for (const w of adj[v]) {
          if ((v === a && w === b) || dist[w] >= 0) continue;
          dist[w] = dist[v] + 1;
          if (w === b) { found = dist[w]; break; }
          next.push(w);
        }
        if (found >= 0) break;
      }
      frontier = next;
    }
    if (found >= 0) continue; // a ring of found + 1 atoms, small enough
    // no way round within the limit: a chain bond (no ring at all), or a ring bigger than it
    if (connectedWithout(adj, a, b)) return true;
  }
  return false;
}

/** Whether a and b are still joined once the bond a–b is left out. */
function connectedWithout(adj: number[][], a: number, b: number): boolean {
  const seen = new Uint8Array(adj.length);
  seen[a] = 1;
  const todo = [a];
  while (todo.length) {
    const v = todo.pop()!;
    for (const w of adj[v]) {
      if ((v === a && w === b) || seen[w]) continue;
      if (w === b) return true;
      seen[w] = 1;
      todo.push(w);
    }
  }
  return false;
}

/** A molfile or SMILES string's graph (null when it can't be read). */
export function graphOf(input: string): Graph | null {
  const molfile = /\n/.test(input) && /M {2}END|V[23]000/.test(input);
  return molfile ? molfileGraph(input) : smilesGraph(input);
}

/** A structure's atoms (0…n−1) and bonds, enough to bound the engine's walk. */
export interface Graph { n: number; edges: [number, number][] }

/** The atoms and bonds of a V2000 or V3000 molfile; null when it can't be read this way. */
export function molfileGraph(text: string): Graph | null {
  const lines = text.split(/\r?\n/);
  const counts = lines[3] ?? '';
  if (/V3000/.test(counts)) {
    let n = 0;
    const edges: [number, number][] = [];
    let inBonds = false;
    for (const l of lines) {
      if (!l.startsWith('M  V30')) continue;
      const f = l.slice(6).trim().split(/\s+/);
      if (f[0] === 'COUNTS') n = Number(f[1]) || 0;
      else if (f[0] === 'BEGIN' && f[1] === 'BOND') inBonds = true;
      else if (f[0] === 'END' && f[1] === 'BOND') inBonds = false;
      else if (inBonds && f.length >= 4) edges.push([Number(f[2]) - 1, Number(f[3]) - 1]);
    }
    return { n, edges };
  }
  const n = Number(counts.slice(0, 3)), m = Number(counts.slice(3, 6));
  if (!Number.isFinite(n) || !Number.isFinite(m)) return null;
  const edges: [number, number][] = [];
  for (let k = 0; k < m; k++) {
    const l = lines[4 + n + k] ?? '';
    edges.push([Number(l.slice(0, 3)) - 1, Number(l.slice(3, 6)) - 1]);
  }
  return { n, edges };
}

/** The atoms and bonds of a SMILES string (reaction arrows and dots split it; text after a space is a name). */
export function smilesGraph(text: string): Graph {
  const s = text.trim().split(/\s/)[0] ?? '';
  const edges: [number, number][] = [];
  const stack: number[] = [];
  const rings = new Map<string, number>();
  let n = 0, prev = -1;
  const atom = (): void => { if (prev >= 0) edges.push([prev, n]); prev = n++; };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '[') { const e = s.indexOf(']', i); i = e < 0 ? s.length : e; atom(); }
    else if ((c === 'C' && s[i + 1] === 'l') || (c === 'B' && s[i + 1] === 'r')) { i++; atom(); }
    else if ('BCNOPSFIbcnops*'.includes(c)) atom();
    else if (c === '(') stack.push(prev);
    else if (c === ')') prev = stack.pop() ?? prev;
    else if (c === '.' || c === '>') prev = -1;
    else if (c === '%' || (c >= '0' && c <= '9')) {
      const label = c === '%' ? s.slice(i + 1, i + 3) : c;
      if (c === '%') i += 2;
      const open = rings.get(label);
      if (open === undefined) rings.set(label, prev);
      else { rings.delete(label); if (open >= 0 && prev >= 0) edges.push([open, prev]); }
    }
  }
  return { n, edges };
}

/**
 * An upper bound on the number of atoms along any path that visits no atom twice (and so on any
 * depth-first walk): ring systems (atoms joined without a bridge bond) are counted whole, and the
 * heaviest route through the tree of ring systems and chains is taken. A chain of n atoms gives n,
 * a ring or a fused ladder its whole size, a branched dendrimer its longest branch-to-branch route.
 */
export function longestPathBound(g: Graph): number {
  const { n } = g;
  if (n <= 1) return n;
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (const [a, b] of g.edges) {
    if (a === b || a < 0 || b < 0 || a >= n || b >= n) continue;
    adj[a].push(b);
    adj[b].push(a);
  }
  // bridges, by an iterative Tarjan walk (each edge's way back counted once, so a double bond
  // written twice is not a ring)
  const tin = new Int32Array(n).fill(-1), low = new Int32Array(n);
  const bridge = new Set<number>();
  const key = (a: number, b: number): number => (a < b ? a * n + b : b * n + a);
  let timer = 0;
  for (let r = 0; r < n; r++) {
    if (tin[r] >= 0) continue;
    const stack: [number, number, number, boolean][] = [[r, -1, 0, false]];
    tin[r] = low[r] = timer++;
    while (stack.length) {
      const top = stack[stack.length - 1];
      const [v, parent] = top;
      if (top[2] < adj[v].length) {
        const w = adj[v][top[2]++];
        if (w === parent && !top[3]) { top[3] = true; continue; }
        if (tin[w] >= 0) low[v] = Math.min(low[v], tin[w]);
        else { tin[w] = low[w] = timer++; stack.push([w, v, 0, false]); }
      } else {
        stack.pop();
        if (parent >= 0) {
          low[parent] = Math.min(low[parent], low[v]);
          if (low[v] > tin[parent]) bridge.add(key(parent, v));
        }
      }
    }
  }
  // ring systems (joined without bridges) and their sizes
  const comp = new Int32Array(n).fill(-1);
  const size: number[] = [];
  for (let s = 0; s < n; s++) {
    if (comp[s] >= 0) continue;
    const id = size.length;
    let count = 0;
    const todo = [s];
    comp[s] = id;
    while (todo.length) {
      const v = todo.pop()!;
      count++;
      for (const w of adj[v]) if (comp[w] < 0 && !bridge.has(key(v, w))) { comp[w] = id; todo.push(w); }
    }
    size.push(count);
  }
  // the heaviest route through the tree they make, joined by the bridges
  const tree: number[][] = size.map(() => []);
  for (const k of bridge) { const a = Math.floor(k / n), b = k % n; tree[comp[a]].push(comp[b]); tree[comp[b]].push(comp[a]); }
  const down = new Float64Array(size.length);
  const seen = new Uint8Array(size.length);
  let best = 0;
  for (let r = 0; r < size.length; r++) {
    if (seen[r]) continue;
    const order: number[] = [];
    const parent = new Map<number, number>([[r, -1]]);
    const todo = [r];
    seen[r] = 1;
    while (todo.length) {
      const v = todo.pop()!;
      order.push(v);
      for (const w of tree[v]) if (!seen[w]) { seen[w] = 1; parent.set(w, v); todo.push(w); }
    }
    for (let k = order.length - 1; k >= 0; k--) {
      const v = order[k];
      let a = 0, b = 0;
      for (const w of tree[v]) {
        if (w === parent.get(v)) continue;
        if (down[w] > a) { b = a; a = down[w]; } else if (down[w] > b) b = down[w];
      }
      down[v] = size[v] + a;
      best = Math.max(best, size[v] + a + b);
    }
  }
  return best;
}

/** Whether a molfile or SMILES string may have a run of atoms too long for the engine's SMILES calls. */
export function tooDeep(input: string): boolean {
  if (!input) return false;
  const molfile = /\n/.test(input) && /M {2}END|V[23]000/.test(input);
  // (quick ways out: a structure with no more atoms than the limit can't have a longer run)
  if (!molfile && input.length <= DEEP_LIMIT) return false;
  const g = graphOf(input);
  if (!g || g.n <= DEEP_LIMIT) return false;
  return longestPathBound(g) > DEEP_LIMIT;
}
