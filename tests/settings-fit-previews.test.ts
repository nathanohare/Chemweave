// @vitest-environment jsdom
// Settings fit and previews (retrospective audit G5-11, G5-12, G5-15, G5-16, G5-30, G5-31): the
// field column gives way at 1024 px, option labels are short with the detail in the "i" tip, and
// NMR Prediction, Depth Shading, Schemes and Toolboxes and Ribbon show what their choices do in
// the right-hand Preview column.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sampleSpectrumData, spectrumSvg } from '../src/ui/nmr-spectrum';
import { toolboxPreview } from '../src/ui/toolbox-preview';

const src = (f: string) => readFileSync(join(__dirname, '..', f), 'utf8');

describe('Settings fit at 1024×700 (G5-30, G5-31)', () => {
  const css = src('src/app.css');
  it('the name column shrinks and a select never runs past the pane', () => {
    expect(css).toContain(".sw-pane .ask-form > .ask-row:not(.ask-check, .ask-wide) { display: grid; grid-template-columns: minmax(9em, 21em) minmax(0, max-content) max-content 1fr; margin: 0; }");
    expect(css).toContain('> select { width: auto; min-width: min(9em, 100%); max-width: min(26em, 100%); }');
    expect(css).not.toContain('grid-template-columns: 21em max-content max-content 1fr');
    expect(css).toContain('.md-controls select { font: inherit; max-width: 100%; }');
  });
  it('a number box whose blank has a meaning is wide enough for it', () => {
    expect(css).toContain("> input[type='number'][placeholder]:not([placeholder='']) { width: 9.5em; }");
  });
  it('NMR Prediction\'s options are one or two words, the detail in the tip', () => {
    const main = src('src/main.ts');
    const at = main.indexOf("const r = await ask('NMR Prediction', [");
    const call = main.slice(at, main.indexOf('{ ok: \'Save\'', at));
    for (const l of [...call.matchAll(/\{ value: '[a-z]+', label: '([^']+)' \}/g)].map((m) => m[1])) expect(l.length, l).toBeLessThanOrEqual(16);
    expect(call).toContain('Balanced: exact simulation of up to 8 coupled protons.');
    expect(call).toContain('Inverted: measured above, predicted mirrored below.');
    expect(call).toContain('Along the top: on one line, with a line down to the peak.');
    expect(call).toContain('CH₂ protons');
  });
});

describe('NMR Prediction preview (G5-11)', () => {
  it('draws ethyl acetate as first-order multiplets, each summing to its number of H', () => {
    // ethyl acetate in CDCl3: 4.12 (q, J = 7, 2H), 2.05 (s, 3H), 1.26 (t, J = 7, 3H)
    // (Fulmer et al., Organometallics 2010, 29, 2176, Table 1)
    const d = sampleSpectrumData(400, false);
    const sp = d.spec!;
    expect(sp.groups.map((g) => [g.shift, g.mult, g.n])).toEqual([[4.12, 'q', 2], [2.05, 's', 3], [1.26, 't', 3]]);
    expect(sp.lines.hz.length).toBe(4 + 1 + 3);
    const sum = [...sp.lines.intensity].reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(8, 9);
    // the quartet's outer lines are 3J apart, centred on 4.12 ppm at 400 MHz, 1:3:3:1
    expect(sp.lines.hz[3] - sp.lines.hz[0]).toBeCloseTo(21, 9);
    expect((sp.lines.hz[0] + sp.lines.hz[3]) / 2).toBeCloseTo(4.12 * 400, 9);
    expect([...sp.lines.intensity.slice(0, 4)].map((x) => x / sp.lines.intensity[0])).toEqual([1, 3, 3, 1]);
    expect(d.measured).toBeUndefined();
    expect(sampleSpectrumData(600, true).measured!.links).toHaveLength(3);
  });
  it('labels the peaks as the boxes say', () => {
    const svg = spectrumSvg(sampleSpectrumData(400, false), { w: 240, h: 170, hi: 4.6, lo: 0.8, labels: true, hotRow: null,
      peakLabels: { label: true, shift: true, mult: true, count: true, j: true, size: 10, place: 'above', hover: false } });
    for (const t of ['OCH₂', '4.12', 'q, 2H', 'J = 7.0 Hz', 's, 3H', 't, 3H']) expect(svg).toContain(t);
    const bare = spectrumSvg(sampleSpectrumData(400, false), { w: 240, h: 170, hi: 4.6, lo: 0.8, labels: true, hotRow: null,
      peakLabels: { label: false, shift: false, mult: true, count: false, j: false, size: 10, place: 'above', hover: false } });
    expect(bare).not.toContain('2H');
    expect(bare).not.toContain('J =');
  });
  it('is the page\'s preview', () => {
    expect(src('src/main.ts')).toContain("{ ok: 'Save', preview: { title: 'Preview', draw: (v) => nmrSettingsPreview(v, pk) } });");
  });
});

describe('Depth Shading preview (G5-12)', () => {
  it('draws a chair shaded with the boxes\' values and puts the settings back after', () => {
    const main = src('src/main.ts');
    expect(main).toContain("preview: { title: 'Preview', draw: (v) => depthShadeSample(readDepthForm(v, s)) }");
    const f = main.slice(main.indexOf('function depthShadeSample('), main.indexOf('/** Depth Shading Settings…'));
    expect(f).toContain('const keep = { ...depthShadePrefs };');
    expect(f).toContain('finally { Object.assign(depthShadePrefs, keep); }');
    // the default note moved into the checkbox's tip (UI rule 2)
    expect(main).not.toContain("note: `Default: black in front fading evenly");
  });
});

describe('Schemes and SI Project Settings previews in the right column (G5-15)', () => {
  it('none of them sits under the fields any more', () => {
    expect(src('src/main.ts')).toContain("preview: { title: 'Preview', wide: true, draw: (v, focus) => schemePreview(doc.style, schemeFrom(v), 352, focus) }");
    const si = src('src/ui/si-settings.ts');
    expect(si).not.toContain('below: true');
    expect(si).toContain("preview: { title: 'Page 2 will read', draw: preview }");
    expect(src('src/ui/ask.ts')).toContain('previewSlot(opts.preview.title, opts.preview.wide)');
  });
});

describe('Toolboxes and Ribbon preview (G5-16)', () => {
  const svg = () => document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  it('shows Classic with group names and two rows, Simplified with one row', () => {
    const c = toolboxPreview('classic', 'off', { ribbon: [svg(), svg()], tools: [svg()] });
    expect(c.querySelector('.tbp-panel')!.classList.contains('tbp-classic')).toBe(true);
    expect([...c.querySelectorAll('.tbp-name')].map((n) => n.textContent)).toEqual(['Clipboard', 'Font']);
    // the real Canvas ribbon's tabs (there is no Draw tab; review R10)
    expect([...c.querySelectorAll('.tbp-tabs span')].map((n) => n.textContent)).toEqual(['Home', 'Insert', 'Chemistry']);
    expect(c.querySelectorAll('.tbp-group')[0].querySelectorAll('.tbp-row')).toHaveLength(2);
    const s = toolboxPreview('simple', 'off', { ribbon: [svg()], tools: [] });
    expect(s.querySelectorAll('.tbp-name')).toHaveLength(0);
    expect(s.querySelectorAll('.tbp-group')[0].querySelectorAll('.tbp-row')).toHaveLength(1);
    expect(s.querySelector('.tbp-ribbon')!.getAttribute('aria-label')).toBe('Simplified ribbon: one row of buttons');
  });
  it('shows the chosen cells, with copies of the icons (or blanks when there are none)', () => {
    const icon = svg();
    icon.id = 'x';
    const g = toolboxPreview('classic', 'both', { ribbon: [], tools: [icon] });
    const tools = g.querySelector('.tbp-tools')!;
    expect(tools.classList.contains('tbp-cells-both')).toBe(true);
    expect(tools.querySelectorAll('svg')).toHaveLength(8);
    expect(tools.querySelector('svg')!.id).toBe('');
    expect(icon.isConnected).toBe(false); // copied, not moved
    expect(g.querySelectorAll('.tbp-ribbon .tbp-blank').length).toBeGreaterThan(0);
    expect(tools.getAttribute('aria-label')).toBe('Raised toolbox buttons with grid lines');
  });
});

describe('SI Project Settings ▸ Page: Insert drop-down (G5-37)', async () => {
  const { ask } = await import('../src/ui/ask');
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true; };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.open = false; };
  it('types the picked field at the caret, keeps the box typable, and is not a value of its own', async () => {
    const got = ask('Page', [{ name: 'header0', label: 'Left', value: 'SI  of', inserts: { label: 'Insert', items: [{ text: '{page}', label: 'Page Number' }, { text: '{title}', label: 'Title' }] } }]);
    const d = [...document.querySelectorAll('dialog')].at(-1)!;
    const box = d.querySelector<HTMLInputElement>('.ask-row[data-field=header0] input')!;
    const sel = d.querySelector<HTMLSelectElement>('select.ask-inserts')!;
    expect([...sel.options].map((o) => o.text)).toEqual(['Insert ▾', 'Page Number', 'Title']);
    expect(sel.getAttribute('aria-label')).toBe('Insert in Left');
    let typed = 0;
    box.addEventListener('input', () => typed++);
    box.setSelectionRange(3, 3);
    sel.value = '{title}';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    expect(box.value).toBe('SI {title} of');
    expect(sel.selectedIndex).toBe(0);
    expect(typed).toBe(1);
    d.querySelector<HTMLButtonElement>('.ask-buttons button:last-child')!.click();
    const r = await got;
    expect(r).toEqual({ header0: 'SI {title} of' });
  });
  it('the header and footer boxes offer the page number, number of pages, title, authors and date', () => {
    const si = src('src/ui/si-settings.ts');
    expect(si).toContain("{ text: '{page}', label: 'Page Number' }, { text: '{pages}', label: 'Number of Pages' }, { text: '{title}', label: 'Title' }, { text: '{authors}', label: 'Authors' }, { text: '{date}', label: 'Date' }");
    expect(si).toMatch(/placeholder: i === 1 && which === 'footer' \? '\{page\}' : '', inserts \}\)/);
    expect(src('src/app.css')).toContain('.si-page-example { width: 100%; max-width: 340px; aspect-ratio: 210 / 297;');
  });
});
