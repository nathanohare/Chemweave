// @vitest-environment jsdom
// The UI audit of 2026-11-16: the pieces with logic of their own.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { statusZoom } from '../src/ui/status-zoom';
import { addCloseX } from '../src/ui/window-x';

const css = readFileSync(process.cwd() + '/src/app.css', 'utf8');
const html = readFileSync(process.cwd() + '/index.html', 'utf8');

describe('the status bar zoom controls outside the drawing modes (U1)', () => {
  const make = (start = 100) => {
    let zoom = start;
    let fits = 0;
    const z = statusZoom({ get: () => zoom, set: (p) => { zoom = p; }, fit: { label: 'Page Width', icon: '', run: () => { fits++; } }, refocus: () => {}, min: 25, max: 400 });
    z.show();
    const range = z.el.querySelector<HTMLInputElement>('input[type=range]')!;
    const [out, , inn] = [...z.el.querySelectorAll<HTMLElement>('.sb-zoom > *')];
    return { z, range, out, inn, pct: z.el.querySelector<HTMLElement>('.sb-zoom-pct')!, fit: z.el.querySelector<HTMLElement>('.sb-fit')!, zoom: () => zoom, fits: () => fits, set: (v: number) => { zoom = v; } };
  };

  it('shows the zoom as a percent with 100% at the middle of the slider', () => {
    const c = make();
    expect(c.pct.textContent).toBe('100%');
    expect(c.range.value).toBe('50');
    c.set(250); c.z.show();
    expect(c.pct.textContent).toBe('250%');
    expect(c.range.value).toBe('75');
  });

  it('zooms with the slider and the − and + buttons, within the mode\'s limits', () => {
    const c = make();
    c.range.value = '100';
    c.range.dispatchEvent(new Event('input'));
    expect(c.zoom()).toBe(400);
    c.inn.click();
    expect(c.zoom()).toBe(400);
    c.range.value = '0';
    c.range.dispatchEvent(new Event('input'));
    expect(c.zoom()).toBe(25);
    c.out.click();
    expect(c.zoom()).toBe(25);
    c.inn.click();
    expect(c.zoom()).toBeCloseTo(31.25);
  });

  it('goes to 100% from the percent, and runs the mode\'s fit', () => {
    const c = make(180);
    c.pct.click();
    expect(c.zoom()).toBe(100);
    c.fit.click();
    expect(c.fits()).toBe(1);
    expect(c.fit.getAttribute('aria-label')).toBe('Page Width');
  });

  it('every mode has view buttons drawn from the icon style, not emoji', () => {
    const bar = html.slice(html.indexOf('<footer id="status">'), html.indexOf('</footer>'));
    expect(bar).toContain('id="sheet-statusbar"');
    expect(bar).toContain('data-sh="view-break-preview"');
    expect(bar).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });
});

describe('a window\'s close × (U12)', () => {
  it('closes on a click and on Esc, but leaves Esc to something that already took it', () => {
    const d = document.createElement('dialog');
    const head = document.createElement('div');
    d.append(head);
    let closed = 0;
    const x = addCloseX(d, head, () => { closed++; });
    expect(head.lastElementChild).toBe(x);
    x.click();
    expect(closed).toBe(1);
    d.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(closed).toBe(2);
    const taken = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    taken.preventDefault();
    d.dispatchEvent(taken);
    expect(closed).toBe(2);
  });
});

describe('dialogs (U3)', () => {
  it('keep their button row in view while the rest scrolls, and never outgrow the window', () => {
    expect(css).toMatch(/dialog:not\(\.embedded\) \.ask-buttons \{[^}]*position: sticky;[^}]*bottom:/);
    expect(css).toMatch(/\ndialog \{ max-height: calc\(100vh - 32px\); \}/);
    // no dialog is capped at a fixed height any more: tall screens show more of it
    expect(css).not.toMatch(/max-height: min\(\d+vh, \d+px\)/);
  });
});

describe('the Chemistry menu (U22)', () => {
  it('keeps the label commands in the Labels and Numbers group, not on its top level', () => {
    const menu = html.slice(html.indexOf('id="chemistry-menu"'));
    const group = menu.indexOf('>Labels and Numbers<');
    for (const cmd of ['expand-label', 'expand-label-full', 'contract-label']) {
      const at = menu.indexOf(`data-cmd="${cmd}"`);
      expect(at).toBeGreaterThan(group);
      expect(at).toBeLessThan(menu.indexOf('</div>', group));
    }
  });
});
