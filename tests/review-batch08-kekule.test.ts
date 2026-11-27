// Review batch 08, F380: a circled ring system with no Kekulé structure (an odd number of carbons,
// every one needing a double bond) is reported at once, not after trying every partial pattern.
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
    expect(performance.now() - t).toBeLessThan(1000);
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
