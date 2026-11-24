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

describe('src/io never spreads a list into Math.min or Math.max', () => {
  it('uses minOf and maxOf instead', () => {
    const files = (readdirSync('src/io', { recursive: true }) as string[]).filter((f) => /\.tsx?$/.test(f));
    const found: string[] = [];
    for (const f of files)
      readFileSync(join('src/io', f), 'utf8').split('\n').forEach((line, i) => {
        if (/^\s*(\/\/|\*)/.test(line)) return; // (comments may name it)
        if (/Math\.(min|max)\(\s*\.\.\./.test(line) || /Math\.(min|max)\.apply\(/.test(line)) found.push(`src/io/${f}:${i + 1}`);
      });
    expect(found, 'use minOf or maxOf from src/io/min-max.ts: a spread overflows the stack on a long list').toEqual([]);
  });
});
