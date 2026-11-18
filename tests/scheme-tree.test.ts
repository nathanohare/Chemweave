// A scheme that branches (one species leading to several, several coming together, a side product
// off a line): read from its steps as a main route with branches, and laid out with straight arrows.

import { describe, expect, it } from 'vitest';
import { layoutTree, readTree, type TreeLink, type TreeSizes } from '../src/chem/scheme-tree';

const L = (...pairs: [number, number][]): TreeLink[] => pairs.map(([from, to]) => ({ from, to }));

/** Every species 60 by 20, every arrow 40 long, nothing written on the arrows. */
function sizes(n: number, links: number): TreeSizes {
  return {
    w: new Array(n).fill(60), h: new Array(n).fill(20),
    lenAcross: new Array(links).fill(40), lenDown: new Array(links).fill(30),
    reachAcross: new Array(links).fill([0, 0]) as [number, number][], reachDown: new Array(links).fill([0, 0]) as [number, number][],
    gap: 5, rowGap: 18,
  };
}

const overlap = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(a.x - b.x) < 60 && Math.abs(a.y - b.y) < 20;

describe('reading the routes of a scheme', () => {
  it('reads a line as one route', () => {
    const t = readTree(4, L([0, 1], [1, 2], [2, 3]))!;
    expect(t.runs).toHaveLength(1);
    expect(t.runs[0].nodes).toEqual([0, 1, 2, 3]);
    expect(t.extra).toEqual([]);
  });

  it('takes the longest way through as the main route, with a side product as a branch leading away', () => {
    // 0 → 1 → 2 → 3, and 1 → 4
    const t = readTree(5, L([0, 1], [1, 2], [2, 3], [1, 4]))!;
    expect(t.runs[0].nodes).toEqual([0, 1, 2, 3]);
    expect(t.runs[1]).toMatchObject({ nodes: [4], parent: 0, at: 1, via: 3, dir: 'out' });
    expect(t.order).toEqual([0, 1, 2, 3, 4]);
  });

  it('reads two routes coming together as a main route and a branch leading in', () => {
    // 0 → 1 → 4 → 5, and 2 → 3 → 4
    const t = readTree(6, L([0, 1], [1, 4], [4, 5], [2, 3], [3, 4]))!;
    expect(t.runs[0].nodes).toEqual([0, 1, 4, 5]);
    expect(t.runs[1]).toMatchObject({ nodes: [2, 3], parent: 0, at: 4, dir: 'in' });
  });

  it('reads one species leading to three as a main route and two branches', () => {
    const t = readTree(4, L([0, 1], [0, 2], [0, 3]))!;
    expect(t.runs).toHaveLength(3);
    expect(t.runs[0].nodes).toHaveLength(2);
    expect(t.runs.slice(1).every((r) => r.dir === 'out' && r.at === 0 && r.parent === 0)).toBe(true);
  });

  it('reads branches off branches', () => {
    // 0 → 1 → 2 → 3; 1 → 4 → 5; 4 → 6
    const t = readTree(7, L([0, 1], [1, 2], [2, 3], [1, 4], [4, 5], [4, 6]))!;
    expect(t.runs[0].nodes).toEqual([0, 1, 2, 3]);
    expect(t.runs[1]).toMatchObject({ nodes: [4, 5], parent: 0, at: 1 });
    expect(t.runs[2]).toMatchObject({ nodes: [6], parent: 1, at: 4 });
  });

  it('keeps the route drawn straight on as the main route when a branch has grown longer than it', () => {
    // 0 → 1 → 2 in a line across the page; a branch 1 → 3 → 4 → 5 squarely below species 1 and on to the right
    const links = L([0, 1], [1, 2], [1, 3], [3, 4], [4, 5]);
    const c = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }, { x: 100, y: 60 }, { x: 200, y: 60 }, { x: 300, y: 60 }];
    // (the way it runs known from its layout)
    const t = readTree(6, links, c, { x: 1, y: 0 })!;
    expect(t.runs[0].nodes).toEqual([0, 1, 2]);
    expect(t.runs[1]).toMatchObject({ nodes: [3, 4, 5], at: 1, dir: 'out' });
    // a route that comes in from a start of its own, longer than the main route's start
    const inLinks = L([0, 1], [1, 2], [3, 4], [4, 5], [5, 1]);
    const ic = [{ x: 100, y: 0 }, { x: 200, y: 0 }, { x: 300, y: 0 }, { x: 0, y: 60 }, { x: 100, y: 60 }, { x: 200, y: 60 }];
    const ti = readTree(6, inLinks, ic, { x: 1, y: 0 })!;
    expect(ti.runs[0].nodes).toEqual([0, 1, 2]);
    expect(ti.runs[1]).toMatchObject({ nodes: [3, 4, 5], at: 1, dir: 'in' });
    // down the page
    const dc = c.map((p) => ({ x: p.y, y: p.x }));
    expect(readTree(6, links, dc, { x: 0, y: 1 })!.runs[0].nodes).toEqual([0, 1, 2]);
    // with nothing known about how it runs, the longest way through is the main route
    expect(readTree(6, links)!.runs[0].nodes).toEqual([0, 1, 3, 4, 5]);
  });

  it('is not a tree when the steps lead back round (that is a cycle)', () => {
    expect(readTree(3, L([0, 1], [1, 2], [2, 0]))).toBeNull();
  });

  it('keeps a second step between two routes as an extra one', () => {
    // 0 → 1 → 3 and 0 → 2 → 3
    const t = readTree(4, L([0, 1], [1, 3], [0, 2], [2, 3]))!;
    expect(t.extra).toHaveLength(1);
    expect(t.order.slice().sort()).toEqual([0, 1, 2, 3]);
  });

  it('keeps the main route it had when two ways through are as long: the one that runs straight on', () => {
    const links = L([0, 1], [1, 2], [1, 3]);
    // species 3 squarely below species 1 (a branch in a line); then above it; then 2 and 3 fanned
    const below = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }, { x: 100, y: 60 }];
    const above = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }, { x: 100, y: -60 }];
    const fanned = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }, { x: 200, y: -60 }];
    for (const c of [below, above, fanned]) expect(readTree(4, links, c)!.runs[0].nodes).toEqual([0, 1, 2]);
    // down the page, with the branch beside (higher on the page than where the main route goes on)
    const down = [{ x: 0, y: 0 }, { x: 0, y: 60 }, { x: 0, y: 120 }, { x: 90, y: 60 }];
    expect(readTree(4, links, down)!.runs[0].nodes).toEqual([0, 1, 2]);
    // and the other way through when that is the straight one
    const other = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 60 }, { x: 200, y: 0 }];
    expect(readTree(4, links, other)!.runs[0].nodes).toEqual([0, 1, 3]);
  });
});

describe('laying a scheme that branches out', () => {
  it('puts a branch squarely beside the species it leaves, on an upright arrow, and runs it along the main route', () => {
    // 0 → 1 → 2 → 3, and 1 → 4 → 5
    const links = L([0, 1], [1, 2], [2, 3], [1, 4], [4, 5]);
    const t = readTree(6, links)!;
    const p = layoutTree(t, links, sizes(6, 5));
    // the main route in a line
    expect(p.centres[0].y).toBeCloseTo(p.centres[1].y);
    expect(p.centres[1].y).toBeCloseTo(p.centres[2].y);
    expect(p.centres[1].x).toBeGreaterThan(p.centres[0].x);
    // the branch below species 1, then on to the right
    expect(p.centres[4].x).toBeCloseTo(p.centres[1].x);
    expect(p.centres[4].y).toBeGreaterThan(p.centres[1].y);
    expect(p.centres[5].y).toBeCloseTo(p.centres[4].y);
    expect(p.centres[5].x).toBeGreaterThan(p.centres[4].x);
    const join = p.arrows[3]!;
    expect(join.tail.x).toBeCloseTo(join.head.x);
    expect(join.head.y).toBeGreaterThan(join.tail.y);
  });

  it('points a branch that leads in at the species it joins', () => {
    // 0 → 1 → 2, and 3 → 1
    const links = L([0, 1], [1, 2], [3, 1]);
    const p = layoutTree(readTree(4, links)!, links, sizes(4, 3));
    const join = p.arrows[2]!;
    expect(p.centres[3].x).toBeCloseTo(p.centres[1].x);
    // (its head is the end nearer species 1)
    expect(Math.abs(join.head.y - p.centres[1].y)).toBeLessThan(Math.abs(join.tail.y - p.centres[1].y));
  });

  it('fans one species out to three in a column, the arrows slanting', () => {
    const links = L([0, 1], [0, 2], [0, 3]);
    const p = layoutTree(readTree(4, links)!, links, sizes(4, 3), { fan: true });
    expect(p.centres[1].x).toBeCloseTo(p.centres[2].x);
    expect(p.centres[2].x).toBeCloseTo(p.centres[3].x);
    expect(p.centres[1].x).toBeGreaterThan(p.centres[0].x);
    const ys = [1, 2, 3].map((i) => p.centres[i].y).sort((a, b) => a - b);
    // one level with the first species, one above and one below
    expect(ys[1]).toBeCloseTo(p.centres[0].y);
    expect(ys[0]).toBeLessThan(ys[1] - 20);
    expect(ys[2]).toBeGreaterThan(ys[1] + 20);
  });

  it('runs the main route down the page with branches beside it', () => {
    const links = L([0, 1], [1, 2], [1, 3]);
    const p = layoutTree(readTree(4, links)!, links, sizes(4, 3), { vertical: true });
    expect(p.centres[0].x).toBeCloseTo(p.centres[1].x);
    expect(p.centres[2].y).toBeGreaterThan(p.centres[1].y);
    expect(p.centres[3].y).toBeCloseTo(p.centres[1].y);
    expect(Math.abs(p.centres[3].x - p.centres[1].x)).toBeGreaterThan(60);
  });

  it('never puts one species on another, however many branches', () => {
    // a main route of five with branches in and out at every species, and branches off those
    const links = L([0, 1], [1, 2], [2, 3], [3, 4], [1, 5], [5, 6], [1, 7], [8, 2], [9, 8], [2, 10], [3, 11], [12, 3], [13, 3], [5, 14], [14, 15], [6, 16]);
    const n = 17;
    for (const opts of [{}, { fan: true }, { vertical: true }]) {
      const t = readTree(n, links)!;
      const p = layoutTree(t, links, sizes(n, links.length), opts);
      const swap = (c: { x: number; y: number }) => (opts.vertical ? { x: c.y, y: c.x } : c);
      for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
        const A = p.centres[a], B = p.centres[b];
        const hit = opts.vertical ? Math.abs(A.x - B.x) < 60 && Math.abs(A.y - B.y) < 20 : overlap(A, B);
        expect(hit, `${JSON.stringify(opts)} species ${a} and ${b} ${JSON.stringify(swap(A))} ${JSON.stringify(swap(B))}`).toBe(false);
      }
      expect(p.arrows.every((r) => r !== null)).toBe(true);
    }
  });
});
