// The smallest and largest of a list of numbers, for the readers and writers. Math.min(...list)
// passes every value as an argument, which overflows the stack past about 125,000 values (a
// spectrum's points, a big drawing's coordinates). These loop instead, and answer as Math.min and
// Math.max do: Infinity and -Infinity for an empty list, NaN when any value is NaN.
// tests/io-min-max.test.ts keeps src/io from spreading a list into Math.min or Math.max.

export function minOf(values: Iterable<number>): number {
  let m = Infinity;
  for (const v of values) {
    if (v !== v) return NaN;
    if (v < m) m = v;
  }
  return m;
}

export function maxOf(values: Iterable<number>): number {
  let m = -Infinity;
  for (const v of values) {
    if (v !== v) return NaN;
    if (v > m) m = v;
  }
  return m;
}
