// Review batch 08, F423: the clutter score of a 3-D view is worked out quicker, with the same
// answer as counting every pair (written out plainly here from the score's own description).
import { describe, expect, it } from 'vitest';
import { clutter, skeleton, type P3 } from '../src/chem/view3d';

/** The score counted pair by pair: overlaps 3 to 6, an atom on a bond 3, a short bond up to 2, a crossing 1. */
function plain(view: P3[], sk: ReturnType<typeof skeleton>) {
  const { atoms, bonds, L } = sk;
  const bonded = (a: number, b: number) => bonds.some(([p, q]) => (p === a && q === b) || (p === b && q === a));
  let score = 0, overlaps = 0;
  for (let i = 0; i < atoms.length; i++) for (let j = i + 1; j < atoms.length; j++) {
    const a = atoms[i], b = atoms[j];
    if (bonded(a, b)) continue;
    const d = Math.hypot(view[a][0] - view[b][0], view[a][1] - view[b][1]) / L;
    if (d < 0.45) { score += 3 + 3 * (1 - d / 0.45); if (d < 0.3) overlaps++; }
  }
  const seg = (p: number[], a: number[], b: number[]) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
  };
  for (const [a, b] of bonds) {
    const len = Math.hypot(view[a][0] - view[b][0], view[a][1] - view[b][1]) / L;
    if (len < 0.45) score += 1.5 * (1 - len / 0.45) + 0.5;
    for (const c of atoms) {
      if (c === a || c === b) continue;
      const d = seg(view[c], view[a], view[b]) / L;
      if (d < 0.22) { score += 3; if (d < 0.15) overlaps++; }
    }
  }
  const o = (a: P3, b: P3, c: P3) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  for (let i = 0; i < bonds.length; i++) for (let j = i + 1; j < bonds.length; j++) {
    const [a, b] = bonds[i], [c, d] = bonds[j];
    if (a === c || a === d || b === c || b === d) continue;
    if (o(view[a], view[b], view[c]) * o(view[a], view[b], view[d]) < 0 && o(view[c], view[d], view[a]) * o(view[c], view[d], view[b]) < 0) score += 1;
  }
  return { score, overlaps };
}

describe('clutter', () => {
  it('gives the same score as counting every pair', () => {
    // a random chain of 120 carbons squeezed into a small box, so plenty overlaps and crosses
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const n = 120;
    const pts: P3[] = Array.from({ length: n }, () => [rnd() * 12, rnd() * 12, rnd() * 12]);
    const z = Array.from({ length: n }, () => 6);
    const bonds = Array.from({ length: n - 1 }, (_, i) => ({ a: i, b: i + 1 }));
    const sk = skeleton(z, bonds, pts);
    const got = clutter(pts, sk), want = plain(pts, sk);
    expect(got.overlaps).toBe(want.overlaps);
    expect(got.score).toBeCloseTo(want.score, 9);
    expect(want.overlaps).toBeGreaterThan(0);
  });

  it('is quick for a 300-atom model (a view search calls it hundreds of times)', () => {
    // a chain of 300 carbons, 1.5 Å bonds pointing every which way, folded up on itself
    let seed = 11;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const n = 300;
    const pts: P3[] = [[0, 0, 0]];
    for (let i = 1; i < n; i++) {
      const t = rnd() * 2 * Math.PI, u = rnd() * 2 - 1, r = Math.sqrt(1 - u * u), p = pts[i - 1];
      pts.push([p[0] + 1.5 * r * Math.cos(t), p[1] + 1.5 * r * Math.sin(t), p[2] + 1.5 * u]);
    }
    const sk = skeleton(Array(n).fill(6), Array.from({ length: n - 1 }, (_, i) => ({ a: i, b: i + 1 })), pts);
    expect(clutter(pts, sk).score).toBeCloseTo(plain(pts, sk).score, 9);
    const t = performance.now();
    for (let k = 0; k < 200; k++) clutter(pts, sk);
    // (counting every pair took about 2.8 s for this; sorting into squares about 0.3 s)
    expect(performance.now() - t).toBeLessThan(1500);
  });
});
