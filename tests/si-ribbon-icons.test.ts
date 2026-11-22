// @vitest-environment jsdom
// The SI tab's ribbon (retrospective audit G5-06, G5-07, G5-35): no column holds more than three
// buttons (so the ribbon is the other modes' height), every button but the Font group's B, I, U,
// x₂, x² and Ω has a picture, a button doing what a command elsewhere does shows that command's
// picture, and the SI's own drawings are all different and drawn with the set's roles only.
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ICON_SET, applyIconSet, buttonKey } from '../src/ui/icon-set';
import { SI_ICONS, SI_ICON_SAME } from '../src/ui/si-icons';
import { TEXT_ICONS } from '../src/ui/icon-picks';

const src = (f: string) => readFileSync(join(__dirname, '..', f), 'utf8');
const siSrc = src('src/ui/si-mode.ts');
const RIBBON = siSrc.slice(siSrc.indexOf('const RIBBON = `') + 16, siSrc.indexOf('`;', siSrc.indexOf('const RIBBON = `')));

describe('SI ribbon', () => {
  let ribbon: HTMLElement;
  beforeAll(() => {
    ribbon = document.createElement('div');
    ribbon.className = 'ribbon tabbed si-ribbon si-only';
    ribbon.id = 'si-ribbon';
    ribbon.innerHTML = RIBBON;
    document.body.append(ribbon);
    applyIconSet(ribbon);
  });
  it('has at most three buttons in a column (G5-06)', () => {
    const tall = [...ribbon.querySelectorAll('.rb-col')].filter((c) => c.querySelectorAll(':scope > button').length > 3).map((c) => c.textContent!.trim().replace(/\s+/g, ' '));
    expect(tall).toEqual([]);
  });
  it('gives every button a picture but the Font group\'s letters (G5-07)', () => {
    const bare = [...ribbon.querySelectorAll<HTMLElement>('.rb-panel button')].filter((b) => !b.querySelector('svg') && !b.dataset.siFmt && b.dataset.si !== 'symbol').map((b) => buttonKey(b));
    expect(bare).toEqual([]);
    expect(ribbon.querySelectorAll('.rb-panel button svg').length).toBeGreaterThan(100);
    // the typed stand-ins went with the drawing that took their place
    const moveUp = ribbon.querySelector<HTMLElement>('[data-si="move-up"]')!;
    expect(moveUp.textContent!.trim()).toBe('Move Up');
  });
  it('keys SI buttons by their kind, with an argument after it', () => {
    expect(buttonKey(ribbon.querySelector<HTMLElement>('[data-si="rename"]')!)).toBe('si:rename');
    expect(buttonKey(ribbon.querySelector<HTMLElement>('[data-si-scheme="add-step"]')!)).toBe('si-scheme:add-step');
    expect(buttonKey(ribbon.querySelector<HTMLElement>('[data-si-scheme="align"][data-arg=""]')!)).toBe('si-scheme:align:');
    expect(buttonKey(ribbon.querySelector<HTMLElement>('[data-si-tbl="row-above"]')!)).toBe('si-tbl:row-above');
  });
  it('uses the same picture for the same command (table rows, Paste, Delete, Copy)', () => {
    for (const [k, v] of Object.entries(SI_ICON_SAME)) expect(ICON_SET[v] ?? TEXT_ICONS[v] ?? SI_ICONS[v], `${k} → ${v}`).toBeTruthy();
    const drawn = (sel: string) => ribbon.querySelector(`${sel} svg`)!.innerHTML;
    const norm = (d: string) => { const g = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); g.innerHTML = d; return g.innerHTML; };
    expect(drawn('[data-si-tbl="row-above"]')).toBe(norm(TEXT_ICONS['doc:table-row-above']));
    expect(drawn('[data-si-ms="ms-open"]')).toBe(drawn('[data-si-scheme="open-compound"]'));
    expect(drawn('[data-si-spectrum="up"]')).toBe(drawn('[data-si="move-up"]'));
  });
  it('draws each SI command differently, with the set\'s roles only', () => {
    const seen = new Map<string, string>();
    const others = new Set([...Object.values(ICON_SET).map((d) => d.d), ...Object.values(TEXT_ICONS)]);
    for (const [k, d] of Object.entries(SI_ICONS)) {
      expect(seen.get(d), `${k} is drawn as ${seen.get(d)}`).toBeUndefined();
      expect(others.has(d), k).toBe(false);
      seen.set(d, k);
      for (const [, c] of d.matchAll(/class="([^"]*)"/g)) for (const x of c.split(' ')) expect(['a', 'f', 'p', 's']).toContain(x);
      expect(d).not.toMatch(/<(image|use|foreignObject)/);
    }
  });
  it('the smoke test checks the SI tab\'s height with the other modes\'', () => {
    const smoke = src('scripts/smoke.mjs');
    expect(smoke).toContain("window.__app.openMemorySi({ 'project.json'");
    expect(smoke).toContain('size < 6) fail(');
  });
});

describe('the last words-only ribbon buttons (G5-35)', () => {
  it('have drawings', () => {
    for (const k of ['sh:outline-settings', 'sh:custom-views', 'doc:styles-pane', 'shape-fill-menu']) expect(TEXT_ICONS[k], k).toBeTruthy();
    expect(src('index.html')).not.toContain('<span>⋯</span>More Styles');
  });
  it('an empty lead kept for a picture takes it (Shape Fill ▾)', () => {
    const r = document.createElement('div');
    r.className = 'ribbon';
    r.innerHTML = '<div class="rb-panel"><button data-cmd="shape-fill-menu" class="rb-labelled"><span class="rb-lead"></span>Fill ▾</button></div>';
    document.body.append(r);
    applyIconSet(r);
    const b = r.querySelector('button')!;
    expect(b.querySelectorAll('.rb-lead')).toHaveLength(1);
    expect(b.querySelector('.rb-lead svg')).toBeTruthy();
  });
});

describe('SI status bar zoom (G5-34)', () => {
  it('is the shared status-bar zoom at the right end, zooming the Live Preview, and the preview header no longer has its own', () => {
    expect(siSrc).toContain("this.zoomBar = statusZoom({");
    expect(siSrc).toContain("fit: { label: 'Page Width', icon: FIT_WIDTH_ICON");
    expect(siSrc).toContain("side.before(this.zoomBar.el);");
    expect(siSrc).not.toContain("btn('−', 'Zoom out'");
    expect(siSrc).not.toContain("btn('↔', 'Fit width'");
    // (doc-view stays out of the SI tab's first load)
    expect(siSrc).not.toMatch(/^import \{[^}]*\bACTUAL\b[^}]*\} from '\.\/doc-view'/m);
  });
});
