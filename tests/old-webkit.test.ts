// The app runs on WebKit as old as Safari 15.4 (apps on macOS 12, older iPads). It can't read regex
// lookbehind or class static blocks, and one in any script stops the app from starting.
import { describe, expect, it } from 'vitest';
import postcss from 'postcss';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { problems } from '../scripts/check-old-webkit.mjs';
import colorMixFallback, { replaceMixes } from '../scripts/color-mix-fallback.mjs';
import { after, guarded, notAfter, reflag } from '../src/regex-behind';
import { safeText, rx, search, sub } from '../src/si/py';
import { findIssues } from '../src/text/chemtext';
import { quantities, sentenceRecords } from '../src/si/ms-parse';
import { parseMFormulaAndCharge } from '../src/si/chem';
import { dataStart, parseIr } from '../src/si/si-import';
import { cleanRef, blankRef } from '../src/document/references';
import { markFormulaLetters } from '../src/text/formula-marks';

const SRC = join(__dirname, '..', 'src');
const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  (e.isDirectory() ? (e.name === 'vendor' ? [] : files(join(dir, e.name))) : e.name.endsWith('.ts') ? [join(dir, e.name)] : []));

describe('old WebKit', () => {
  it('no source file has a regex lookbehind, as a literal or in text that becomes a pattern', () => {
    const bad: string[] = [];
    for (const f of files(SRC)) {
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line) || line.includes('old-webkit-ok')) return;
        if (/\(\?<[=!]/.test(line)) bad.push(`${f.slice(SRC.length + 1)}:${i + 1}`);
      });
    }
    expect(bad, 'use src/regex-behind.ts instead (docs/developers.md)').toEqual([]);
  });

  it('the build check sees what the old engine cannot read, and nothing else', () => {
    expect(problems('const a = /(?<=x)y/;')).toHaveLength(1);
    expect(problems('const a = /x(?<!y)/g;')).toHaveLength(1);
    expect(problems('class A { static { this.x = 1; } }')).toEqual(['class static block']);
    expect(problems("const a = /(?<name>y)\\(\\?<=/, b = /[(?<=]/, c = '(?<=x)';")).toEqual([]);
  });

  /** Random text over `alphabet`, the same every run. */
  const texts = (alphabet: string[]): string[] => {
    let seed = 11;
    const next = (n: number) => { seed = (seed * 48271) % 2147483647; return seed % n; };
    return Array.from({ length: 1500 }, () => Array.from({ length: next(14) }, () => alphabet[next(alphabet.length)]).join(''));
  };
  const all = (re: RegExp, s: string) => [...s.matchAll(re)].map((m) => [m.index, ...m]);

  // (the lookbehind forms themselves: the machine running the tests has them)
  it.each([
    ['not after a letter', notAfter(/(\d+)/g, /[a-z]/), /(?<![a-z])(\d+)/g],
    ['after a letter', after(/(\d+)/g, /[a-z]/), /(?<=[a-z])(\d+)/g],
    ['after a point, spaces', after(/\s+(?=a)/g, /\./), /(?<=\.)\s+(?=a)/g],
    ['nothing matched', notAfter(/x*/g, /a/), /(?<!a)x*/g],
    ['a run of digits', notAfter(/\d+[a-z]/g, /[a-z0-9]/), /(?<![a-z0-9])\d+[a-z]/g],
  ])('a guarded pattern behaves as the lookbehind it replaces: %s', (_name, mine, native) => {
    for (const s of texts(['a', 'b', '1', '2', 'x', '.', ' '])) {
      expect(all(mine, s), s).toEqual(all(native, s));
      expect(s.replace(mine, '<$&>'), s).toBe(s.replace(native, '<$&>'));
      expect(s.split(mine), s).toEqual(s.split(native));
      mine.lastIndex = native.lastIndex = 0;
      expect(mine.test(s), s).toBe(native.test(s));
      mine.lastIndex = native.lastIndex = 0;
    }
  });

  it('a guard stays with a copy of the pattern in other flags, and works without g', () => {
    const re = notAfter(/b/, /a/);
    expect(re.exec('ab cb')?.index).toBe(4);
    expect('ab ab cb'.match(reflag(re, 'g'))).toEqual(['b']);
    expect('abAB'.match(reflag(guarded(/b/, () => false), 'gi'))).toBeNull();
  });

  it('marks only the letters that count in a formula', () => {
    const [i, n, , t, p] = ['\uFDD0', '\uFDD1', '\uFDD2', '\uFDD3', '\uFDD4'];
    expect(markFormulaLetters('iPr OtBu NiPr B2pin2 spin', true)).toBe(`${i}Pr O${t}Bu NiPr B2${p}in2 spin`);
    expect(markFormulaLetters('O-iPr Oi-Pr nBu', false)).toBe(`O-${i}Pr Oi-Pr ${n}Bu`);
  });

  it('gives a plain color for color-mix()', () => {
    expect(replaceMixes('color-mix(in srgb, var(--text) 80%, var(--panel))')).toBe('var(--text)');
    expect(replaceMixes('1px solid color-mix(in srgb, var(--a) 22%, transparent)')).toBe('1px solid rgba(128, 128, 128, 0.22)');
    expect(replaceMixes('color-mix(in srgb, var(--a) 9%, var(--panel))', true)).toBe('rgba(128, 128, 128, 0.22)');
    expect(replaceMixes('color-mix(in srgb, var(--x, color-mix(in srgb, red, blue)) 90%, white)')).toBe('var(--x, red)');
  });
});

describe('the build check on an unminified script', () => {
  it('reads thousands of joined strings without running out of stack', () => {
    expect(problems(`const a = ${"'x' + ".repeat(20000)}/(?<=x)y/;`)).toHaveLength(1);
  });
});

describe('guarded patterns on long runs', () => {
  // each took seconds when a pattern was tried from inside every run before its guard was asked
  const spaces = ' '.repeat(100_000);
  it.each([
    ['a long word, while typing', () => findIssues('A'.repeat(100_000))],
    // (not a formula: it says so, quickly)
    ['spaces after a formula', () => expect(() => parseMFormulaAndCharge(`C6H6${spaces}x`)).toThrow()],
    ['spaces in sentences', () => sentenceRecords(`a.${spaces}x`)],
    ['spaces before the data', () => dataStart(`a.${spaces}x`)],
    ['hyphens in page numbers', () => cleanRef({ ...blankRef(), pages: `1${'-'.repeat(20_000)}x` })],
    ['a long number', () => quantities('1'.repeat(20_000))],
  ])('%s', (_name, run) => {
    const t = performance.now();
    run();
    expect(performance.now() - t).toBeLessThan(1500);
  }, 60_000);
});

describe('Unicode patterns on an old engine', () => {
  it('stands in for characters outside the basic plane without moving anything', () => {
    const s = 'a\u{1D45B}-BuLi \u{1F600}.';
    expect(safeText(s, true)).toHaveLength(s.length);
    expect(/[\uD800-\uDFFF]/.test(safeText(s, true))).toBe(false);
    expect(safeText(s, false)).toBe(s);
    expect(search(rx('(?P<w>.*?)-BuLi'), s)?.group('w')).toBe('a\u{1D45B}');
  });

  // (it hung the app: an empty match before such a character was found again and again)
  it('finds the empty matches of a text with such characters once each, and ends', () => {
    expect(sub(rx('\\s*'), '-', 'a\u{1F600}b')).toBe('-a-\u{1F600}-b-');
    expect(parseIr('\u{1D45B}see https://doi.org/\u{1F600}calc./.')).toEqual({});
  });
});

// (macOS 12 with "Show scroll bars: Always": the build's gray stand-in for color-mix() made the
// page's scroll bar thumb the color of the Dark Gray surround, so it could not be seen)
describe('the scroll bar thumb without color-mix()', () => {
  const css = readFileSync(join(SRC, 'app.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const luminance = (c: number[]) => {
    const [r, g, b] = c.map((v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  /** The block that sets a theme's tokens, found by what it begins with. */
  const block = (start: string) => css.slice(css.indexOf(start), css.indexOf('}', css.indexOf(start)));
  const token = (text: string, name: string): string | undefined => {
    const at = text.indexOf(`${name}: `);
    return at < 0 ? undefined : text.slice(at + name.length + 2, text.indexOf(';', at));
  };

  it('is set by a rule that comes after the build’s stand-ins, from a theme token', () => {
    // (as the build writes the style sheet, its own stand-ins for color-mix() included: what an old
    // engine reads last for the resting thumb must be the theme's token)
    const built = postcss([colorMixFallback()]).process(css, { from: undefined }).css;
    const seen: string[] = [];
    postcss.parse(built).walkRules((rule) => {
      const old = rule.parent?.type === 'atrule' && (rule.parent as postcss.AtRule).params.startsWith('not (color: color-mix');
      if (rule.selector !== '.sb-fade :not(.tb-body, .sh-tabs)::-webkit-scrollbar-thumb') return;
      rule.walkDecls('background', (d) => { if (old || !d.value.includes('color-mix(')) seen.push(d.value); });
    });
    expect(seen.at(-1)).toBe('var(--sb-thumb) content-box');
  });

  /** An rgba() thumb over a surface: how well it stands out (WCAG contrast). */
  const contrast = (thumb: string, surface: string): number => {
    const [r, g, b, a] = /rgba\(([^)]+)\)/.exec(thumb)![1].split(',').map(Number);
    const under = surface.length === 4 ? rgb(`#${[...surface.slice(1)].map((c) => c + c).join('')}`) : rgb(surface);
    const on = under.map((v, i) => a * [r, g, b][i] + (1 - a) * v);
    const [hi, lo] = [luminance(on), luminance(under)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  // (each pane whose ground isn't the theme's own, with the tokens set for it)
  it.each([
    ['the Dark Gray dock', ":root[data-gray]:not([data-shadows='off']) .dock {", ':root[data-gray] { --chrome', '--chrome'],
    ['a card in the Dark Gray dock', ":root[data-gray]:not([data-shadows='off']) .dock > * {", ':root[data-gray] .dock, :root[data-gray] aside {', '--panel'],
  ])('stands out on %s', (_name, tokens, from, surface) => {
    for (const t of ['--sb-thumb', '--sb-thumb-on']) expect(contrast(token(block(tokens), t)!, token(block(from), surface)!), t).toBeGreaterThan(1.4);
  });

  it.each([['the grid', '\n.sh-scroll {', '#fff'], ['a dashboard', '\n.dash {', '#f3f4f6']])('stands out on %s, light in every theme', (_name, rule, ground) => {
    expect(block(rule)).toContain(ground);
    for (const t of ['--sb-thumb', '--sb-thumb-on']) expect(contrast(token(block('.sh-scroll, .dash {'), t)!, ground), t).toBeGreaterThan(1.4);
  });

  it('has the same colors for the Dark theme and the system’s dark mode', () => {
    const dark = block(":root[data-theme='dark'] {"), system = block(":root:not([data-theme='light']) {");
    for (const t of ['--sb-thumb', '--sb-thumb-on', '--sb-track']) expect(token(system, t), t).toBe(token(dark, t));
  });

  it.each([
    ['Light', ':root {', undefined],
    ['Dark', ":root[data-theme='dark'] {", undefined],
    ['Dark Gray', ':root {', ':root[data-gray] { --chrome'],
  ])('stands out from every surface of the %s theme', (_name, base, over) => {
    for (const surface of ['--surround', '--bg', '--panel']) {
      const color = (over && token(block(over), surface)) || token(block(base), surface)!;
      for (const t of ['--sb-thumb', '--sb-thumb-on']) expect(contrast(token(block(base), t)!, color), `${t} ${surface} ${color}`).toBeGreaterThan(1.4);
    }
  });
});
