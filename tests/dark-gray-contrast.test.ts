// Dark Gray contrast (retrospective audit G5-01..05): the colors app.css gives muted text on the
// Dark Gray theme's gray surfaces meet WCAG 2.1 AA, 4.5:1 for text and 3:1 for control glyphs.
// The ratio is WCAG 2.1's (https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio, relative luminance
// per https://www.w3.org/TR/WCAG21/#dfn-relative-luminance), written out here, not taken from the app.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/app.css', import.meta.url), 'utf8');

const channel = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const luminance = (hex: string) => { const n = parseInt(hex.slice(1), 16); return 0.2126 * channel(n >> 16) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255); };
const ratio = (a: string, b: string) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

/** The declarations of the rule whose selector starts with `selector` (the first such rule). */
function rule(selector: string): Record<string, string> {
  const i = css.indexOf(selector + ' {');
  expect(i, selector).toBeGreaterThanOrEqual(0);
  const body = css.slice(css.indexOf('{', i) + 1, css.indexOf('}', i));
  return Object.fromEntries(body.split(';').map((d) => d.split(':').map((x) => x.trim())).filter((d) => d.length === 2 && d[0]) as [string, string][]);
}

describe('the WCAG ratio written here', () => {
  it('gives the published end points', () => {
    // WCAG: black on white is 21:1, a color on itself 1:1
    expect(ratio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(ratio('#777777', '#777777')).toBeCloseTo(1, 5);
    // the sweep's measured failures: #677084 on the Dark Gray ribbon (#d3d6db) 3.41, in dialogs (#dfe1e5) 3.79
    expect(ratio('#677084', '#d3d6db')).toBeCloseTo(3.41, 2);
    expect(ratio('#677084', '#dfe1e5')).toBeCloseTo(3.79, 2);
  });
});

describe('Dark Gray muted text', () => {
  const ribbon = rule(':root[data-gray] .ribbon > .rb-panel, :root[data-gray] .doc-ribbon > .rb-panel');
  const dialog = rule(':root[data-gray] dialog, :root[data-gray] .tool-window, :root[data-gray] .template-window');
  const dock = rule(':root[data-gray] .dock, :root[data-gray] aside');
  it('ribbon group names, captions and launchers read at 4.5:1 on the panel and on its hover fill', () => {
    expect(ratio(ribbon['--muted'], ribbon['--panel'])).toBeGreaterThanOrEqual(4.5);
    expect(ratio(ribbon['--muted'], ribbon['--accent-soft'])).toBeGreaterThanOrEqual(3);
  });
  it('dialog and Settings muted text (units, "i" tips, inactive tabs) reads at 4.5:1, also on a selected row', () => {
    expect(ratio(dialog['--muted'], dialog['--panel'])).toBeGreaterThanOrEqual(4.5);
    expect(ratio(dialog['--muted'], dialog['--accent-soft'])).toBeGreaterThanOrEqual(4.5);
  });
  it('side panels and docks read at 4.5:1', () => {
    expect(ratio(dock['--muted'], dock['--panel'])).toBeGreaterThanOrEqual(4.5);
  });
  it('keycaps, atomic numbers, slide numbers and the add-sheet + read at 4.5:1 on the darker gray (--bg)', () => {
    const bg = rule(':root[data-gray]')['--bg'];
    const onBg = rule(':root[data-gray] :is(.kb-cap, .pt-cell small, .sh-tab-add, .sl-num)').color;
    expect(ratio(onBg, bg)).toBeGreaterThanOrEqual(4.5);
  });
  it('the file tabs ▾ and + use the dark band\'s muted gray, 3:1 or more for a glyph', () => {
    const band = rule(':root[data-gray] header, :root[data-gray] footer, :root[data-gray] .rb-tabs');
    expect(css).toContain(":root[data-gray] .tab-ctl:not(:hover), :root[data-theme='dark'] .tab-ctl:not(:hover) { color: var(--muted); }");
    expect(ratio(band['--muted'], rule(':root[data-gray]')['--chrome'])).toBeGreaterThanOrEqual(3);
    // full Dark: the dark theme's muted on its darkest band (#14171b, measured by the sweep)
    expect(ratio('#9aa3b5', '#14171b')).toBeGreaterThanOrEqual(3);
  });
  it('a pressed ribbon button\'s words take the text color in the dark themes', () => {
    expect(css).toContain(":root[data-gray] .ribbon button[aria-pressed='true'], :root[data-theme='dark'] .ribbon button[aria-pressed='true'] { color: var(--text); }");
    // the light text color on the gray pressed fill
    expect(ratio(rule(':root')['--text'], ribbon['--accent-soft'])).toBeGreaterThanOrEqual(4.5);
  });
});
