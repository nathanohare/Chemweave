// Review batch 08, F380: a circled ring system with no Kekulé structure (an odd number of carbons,
// every one needing a double bond; or carbons that can't be paired off for another reason) is
// reported quickly, not after trying every partial pattern. A Kekulé structure is a perfect
// matching of the carbons (IUPAC Gold Book, "Kekulé structure"); a ladder of fused four-membered
// rings is bipartite, so two more carbons on one side of it can never all be paired.
import { describe, expect, it } from 'vitest';
import { Doc } from '../src/model';
import { kekuleDoubles } from '../src/chem/aromatic';

describe('Kekulé search', () => {
  it('fails fast on a long aromatic ladder with one carbon too many', () => {
    const doc = new Doc();
    const todo = new Set<number>();
    doc.bulk(() => {
      const n = 40;
      const top = Array.from({ length: n }, (_, i) => doc.addAtom(i * 14, 0).id);
      const bottom = Array.from({ length: n }, (_, i) => doc.addAtom(i * 14, 14).id);
      for (let i = 0; i < n; i++) {
        todo.add(doc.addBond(top[i], bottom[i], 1.5).id);
        if (i) { todo.add(doc.addBond(top[i - 1], top[i], 1.5).id); todo.add(doc.addBond(bottom[i - 1], bottom[i], 1.5).id); }
      }
      // one more carbon on the end, in the same system: 81 carbons can't all be paired
      const extra = doc.addAtom(n * 14, 7).id;
      todo.add(doc.addBond(top[n - 1], extra, 1.5).id);
    });
    const t = performance.now();
    expect(kekuleDoubles(doc, todo)).toBeNull();
    // (the search took 456 s for this before; the limit is wide, for a busy machine)
    expect(performance.now() - t).toBeLessThan(5000);
  });

  /** The ladder of n rungs with extra atoms hung on top-row atoms of one colour (even places). */
  function ladder(n: number, extra: number[]) {
    const doc = new Doc();
    const todo = new Set<number>();
    doc.bulk(() => {
      const top = Array.from({ length: n }, (_, i) => doc.addAtom(i * 14, 0).id);
      const bottom = Array.from({ length: n }, (_, i) => doc.addAtom(i * 14, 14).id);
      for (let i = 0; i < n; i++) {
        todo.add(doc.addBond(top[i], bottom[i], 1.5).id);
        if (i) { todo.add(doc.addBond(top[i - 1], top[i], 1.5).id); todo.add(doc.addBond(bottom[i - 1], bottom[i], 1.5).id); }
      }
      extra.forEach((z, k) => { const x = doc.addAtom(k * 28, -14, z).id; todo.add(doc.addBond(top[2 * k], x, 1.5).id); });
    });
    return { doc, todo };
  }

  it('fails quickly when the count is even but two carbons are left over', () => {
    const { doc, todo } = ladder(40, [6, 6]);
    const t = performance.now();
    expect(kekuleDoubles(doc, todo)).toBeNull();
    expect(performance.now() - t).toBeLessThan(5000);
  });

  it('fails quickly when an odd system has an N in it (which may go without a double bond)', () => {
    const { doc, todo } = ladder(40, [6, 6, 7]);
    const t = performance.now();
    expect(kekuleDoubles(doc, todo)).toBeNull();
    expect(performance.now() - t).toBeLessThan(5000);
  });

  it('still finds a pattern when the extra atoms can be paired', () => {
    // one extra carbon on the top row's first atom and an N on the bottom row's first atom (the
    // other colour): the carbon pairs with the ladder, which leaves a ladder atom to pair with the N
    const { doc, todo } = ladder(40, [6]);
    const bottom0 = [...doc.atoms.values()].find((a) => a.x === 0 && a.y === 14)!.id;
    doc.bulk(() => { const nAt = doc.addAtom(0, 28, 7).id; todo.add(doc.addBond(bottom0, nAt, 1.5).id); });
    const got = kekuleDoubles(doc, todo);
    expect(got).not.toBeNull();
    // every carbon has exactly one of the double bonds
    const count = new Map<number, number>();
    for (const id of got!) { const b = doc.bonds.get(id)!; for (const a of [b.a1, b.a2]) count.set(a, (count.get(a) ?? 0) + 1); }
    for (const a of doc.atoms.values()) if (a.z === 6) expect(count.get(a.id), `atom ${a.id}`).toBe(1);
  });

  it('still finds a pattern for each of two separate systems', () => {
    const doc = new Doc();
    const todo = new Set<number>();
    doc.bulk(() => {
      for (const x0 of [0, 100]) {
        const ring = Array.from({ length: 6 }, (_, k) => doc.addAtom(x0 + 14 * Math.cos(k * Math.PI / 3), 14 * Math.sin(k * Math.PI / 3)).id);
        ring.forEach((id, k) => todo.add(doc.addBond(id, ring[(k + 1) % 6], 1.5).id));
      }
    });
    // benzene: three double bonds each
    expect(kekuleDoubles(doc, todo)?.size).toBe(6);
  });
});
