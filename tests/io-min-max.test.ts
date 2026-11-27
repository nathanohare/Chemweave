// src/io/min-max.ts, and the check that keeps src/io from spreading a list into Math.min or
// Math.max. Why (2026-11-24): a spectrum of more than about 125,000 points was skipped because
// Math.min(...ys) overflowed the stack, and 24 other such spreads sat in the readers and writers.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { maxOf, minOf } from '../src/io/min-max';

describe('minOf and maxOf', () => {
  it('answer as Math.min and Math.max do', () => {
    expect(minOf([3, -2, 7])).toBe(-2);
    expect(maxOf([3, -2, 7])).toBe(7);
    expect(minOf([])).toBe(Infinity);
    expect(maxOf([])).toBe(-Infinity);
    expect(minOf([1, NaN, 0])).toBeNaN();
    expect(maxOf(new Set([4, 9]))).toBe(9);
  });

  it('take a list far longer than Math.min(...list) can', () => {
    const big = Array.from({ length: 1_000_000 }, (_, i) => Math.sin(i) * i);
    expect(() => Math.min(...big)).toThrow(RangeError);
    expect(minOf(big)).toBe(big.reduce((a, b) => (b < a ? b : a)));
    expect(maxOf(big)).toBe(big.reduce((a, b) => (b > a ? b : a)));
  });
});

/**
 * Where a list is spread into Math.min or Math.max (Math.max(0, ...list), Math.max(f(g(a)), ...list),
 * over several lines), or passed with Math.max.apply: the line of each. A spread counts only as one of
 * its own arguments (depth 1), not inside a call in them (Math.max(0, f(...xs)) is fine).
 */
function spreads(text: string): number[] {
  // (comments may name it: blanked, keeping the lines)
  const src = text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' ')).replace(/\/\/[^\n]*/g, '');
  const lineAt = (i: number) => src.slice(0, i).split('\n').length;
  const out: number[] = [];
  for (const m of src.matchAll(/Math\.(min|max)\s*(\(|\.apply\s*\()/g)) {
    if (m[2] !== '(') { out.push(lineAt(m.index!)); continue; }
    let depth = 0;
    for (let i = m.index! + m[0].length - 1; i < src.length; i++) {
      const ch = src[i];
      if (ch === '(' || ch === '[' || ch === '{') depth++;
      else if (ch === ')' || ch === ']' || ch === '}') { if (--depth === 0) break; }
      else if (depth === 1 && src.startsWith('...', i)) { out.push(lineAt(m.index!)); break; }
    }
  }
  return out;
}

describe('src/io never spreads a list into Math.min or Math.max', () => {
  it('finds a spread however the call is written', () => {
    expect(spreads('const a = Math.max(0, ...list);')).toEqual([1]);
    expect(spreads('const a = Math.max(f(g(a)), ...list);')).toEqual([1]);
    expect(spreads('x;\nconst a = Math.min(\n  first,\n  ...rest,\n);')).toEqual([2]);
    expect(spreads('Math.max.apply(null, xs);')).toEqual([1]);
    expect(spreads('Math.max(0, f(...xs)); Math.max(a, [...xs].length);')).toEqual([]);
    expect(spreads('// Math.max(...xs)\n/* Math.min(...ys) */')).toEqual([]);
  });

  it('uses minOf and maxOf instead', () => {
    const files = (readdirSync('src/io', { recursive: true }) as string[]).filter((f) => /\.tsx?$/.test(f));
    const found: string[] = [];
    // (a spread anywhere in its arguments, as Math.max(0, ...list), not only first; review F572)
    for (const f of files) for (const line of spreads(readFileSync(join('src/io', f), 'utf8'))) found.push(`src/io/${f}:${line}`);
    expect(found, 'use minOf or maxOf from src/io/min-max.ts: a spread overflows the stack on a long list').toEqual([]);
  });
});
