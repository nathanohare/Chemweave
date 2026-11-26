// The interface's motion rules (docs/ui-style.md S91 to S97): one set of timings, set by the
// Animations setting, and only cheap properties animated.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { FAST_MS, NORMAL_SCALE, automaticMotion, motionMs } from '../src/ui/motion';
import { parseSettings } from '../src/settings';

const SRC = join(__dirname, '..', 'src');
const css = readFileSync(join(SRC, 'app.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Every `transition` and `animation` declaration in the style sheet, with its line. */
function declarations(prop: 'transition' | 'animation'): { line: number; value: string }[] {
  const out: { line: number; value: string }[] = [];
  const re = prop === 'transition' ? /(?:^|[;{\s])transition(?:-duration)?\s*:\s*([^;}]+)/g : /(?:^|[;{\s])animation(?:-duration)?\s*:\s*([^;}]+)/g;
  for (const m of css.matchAll(re)) out.push({ line: css.slice(0, m.index).split('\n').length, value: m[1].trim() });
  return out;
}

/** The `--m-…` values set in a rule's body, by name. */
function timings(body: string): Record<string, string> {
  return Object.fromEntries([...body.matchAll(/--m-([\w-]+)\s*:\s*([^;]+)/g)].map((m) => [m[1], m[2].trim()]));
}

/** Properties that make the page lay out again on every frame (S92). */
const LAYOUT = /\b(width|height|top|left|right|bottom|margin[\w-]*|padding[\w-]*|max-height|max-width|min-height|min-width|font-size|inset|flex[\w-]*|grid[\w-]*|gap)\b/;

describe('motion', () => {
  it('every timed transition and animation in the style sheet uses the shared timings (S94)', () => {
    const bad = [...declarations('transition'), ...declarations('animation')]
      // a repeating animation (a busy stripe, a jiggle) keeps its own period
      .filter(({ value }) => !/\binfinite\b/.test(value) && !/^(none|initial|inherit|unset)( !important)?$/.test(value))
      .filter(({ value }) => /\d(m?s)\b/.test(value) || !/var\(--m-/.test(value))
      .map(({ line, value }) => `app.css:${line}: ${value}`);
    expect(bad, 'use var(--m-short|--m-toggle|--m-std|--m-large|--m-hi)').toEqual([]);
  });

  it('nothing in the style sheet animates a property that lays the page out again (S92)', () => {
    const bad = declarations('transition')
      .filter(({ value }) => value.split(',').some((part) => LAYOUT.test(part.trim().split(/\s+/)[0])))
      .map(({ line, value }) => `app.css:${line}: ${value}`);
    expect(bad).toEqual([]);
    expect(declarations('transition').filter(({ value }) => /(^|,)\s*all\b/.test(value)).map(({ line }) => `app.css:${line}`), 'name the properties: "all" can animate a size').toEqual([]);
    for (const m of css.matchAll(/@keyframes\s+([\w-]+)\s*\{([\s\S]*?\})\s*\}/g)) {
      const props = [...m[2].matchAll(/([\w-]+)\s*:/g)].map((p) => p[1]);
      expect(props.filter((p) => LAYOUT.test(p)), `@keyframes ${m[1]}`).toEqual([]);
    }
  });

  it('no motion follows the system setting on its own: the Animations setting does (S93)', () => {
    expect(css).not.toMatch(/prefers-reduced-motion/);
  });

  it('Off makes every timing zero and keeps highlights, without a fade', () => {
    const off = css.match(/:root\[data-motion=['"]?off['"]?\]\s*\{([^}]*)\}/)?.[1] ?? '';
    for (const t of ['short', 'toggle', 'std', 'large']) expect(['0ms', '0s', '0'], t).toContain(timings(off)[t]);
    expect(off).toMatch(/--ease-hi\s*:\s*steps\(1/);
    for (const t of ['short', 'toggle', 'std', 'large'] as const) expect(motionMs(t, 'off')).toBe(0);
  });

  it('the style sheet and the scripts agree on the timings', () => {
    const root = css.match(/:root\s*\{([^}]*--m-short[^}]*)\}/)?.[1] ?? '';
    for (const [t, ms] of Object.entries(FAST_MS)) {
      expect(timings(root)[t], t).toBe(`${ms}ms`);
      expect(motionMs(t as keyof typeof FAST_MS, 'fast')).toBe(ms);
      expect(motionMs(t as keyof typeof FAST_MS, 'normal')).toBe(Math.round(ms * NORMAL_SCALE));
    }
    const normal = css.match(/:root\[data-motion=['"]?normal['"]?\]\s*\{([^}]*)\}/)?.[1] ?? '';
    for (const [t, ms] of Object.entries(FAST_MS)) expect(timings(normal)[t], t).toBe(`${Math.round(ms * NORMAL_SCALE)}ms`);
  });

  it('starts on Fast in the desktop app, Off on the web, and Off when the system asks for less motion', () => {
    expect(automaticMotion(false, true)).toBe('fast');
    expect(automaticMotion(false, false)).toBe('off');
    expect(automaticMotion(true, true)).toBe('off');
  });

  it('the setting is kept with the other settings and an unknown value is dropped', () => {
    expect(parseSettings(JSON.stringify({ animations: 'normal' })).animations).toBe('normal');
    expect(parseSettings(JSON.stringify({ animations: 'slow' })).animations).toBeUndefined();
  });

  it('scripts take their timings from motion.ts, not their own numbers', () => {
    const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      (e.isDirectory() ? (e.name === 'vendor' ? [] : files(join(dir, e.name))) : e.name.endsWith('.ts') ? [join(dir, e.name)] : []));
    const bad: string[] = [];
    for (const f of files(SRC)) {
      if (f.endsWith(join('ui', 'motion.ts'))) continue;
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (/\.animate\(/.test(line) && !/motionMs\(|duration:\s*d\b/.test(line + readFileSync(f, 'utf8').split('\n').slice(i, i + 4).join(' '))) bad.push(`${f.slice(SRC.length + 1)}:${i + 1}`);
        if (/(transition|animation)\s*[:=]\s*['"`][^'"`]*\d+m?s\b/.test(line) || /behavior:\s*'smooth'/.test(line)) bad.push(`${f.slice(SRC.length + 1)}:${i + 1}`);
      });
    }
    expect(bad, 'use motionMs(), enter() or scrollToItem() from src/ui/motion.ts').toEqual([]);
  });
});
