// @vitest-environment jsdom
// One Font group for every mode (retrospective audit G5-26, S17): the same controls in the same
// order with the same pictures and tips; each mode's own extras at the end of a row; the ⬊ in every
// mode. Document, Presentation and Spreadsheet get theirs from fontGroupHtml, the Canvas (and
// Design) from text-bar.ts, which uses the same FONT_ROWS and FONT_LOOK.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FONT_ROWS, FONT_LOOK, fontGroupHtml, installFontGroups, FONT_SIZE_LIST, type FontMode } from '../src/ui/font-group';
import { buildTextBar } from '../src/ui/text-bar';
import { CanvasRibbon } from '../src/ui/canvas-ribbon';

const src = (f: string) => readFileSync(join(__dirname, '..', f), 'utf8');
const ORDER = ['Font', 'Font size', 'Increase Font Size', 'Decrease Font Size', 'Clear All Formatting', 'Bold', 'Italic', 'Underline', 'Strikethrough', 'Subscript', 'Superscript', 'Formula style', 'Text Color'];

/** The shared controls of a Font group, by name, in order (each mode's extras left out). */
function shared(g: Element): string[] {
  const name = (e: Element) => (e.getAttribute('aria-label') ?? (e as HTMLElement).title).replace(/ \(.*$/, '').replace(/:.*$/, '');
  return [...g.querySelectorAll('input:not([type=color]), button:not(.rb-launch), label.rb-colour')].map(name).filter((n) => ORDER.includes(n));
}
const group = (mode: FontMode) => { const t = document.createElement('template'); t.innerHTML = fontGroupHtml(mode); return t.content.firstElementChild!; };

describe('the shared Font group (G5-26)', () => {
  it('has the same controls in the same order in Document, Presentation and Spreadsheet', () => {
    expect(FONT_ROWS.flat()).toHaveLength(13);
    for (const m of ['document', 'slides', 'sheet'] as const) {
      const g = group(m);
      expect(shared(g), m).toEqual(ORDER);
      expect(g.querySelector('.rb-label')!.textContent).toBe('Font');
      expect(g.querySelector('.rb-launch'), m).not.toBeNull();
      // the same pictures
      for (const k of ['grow', 'shrink', 'clear', 'bold', 'italic', 'underline', 'strike', 'sub', 'sup', 'formula'] as const) {
        const b = [...g.querySelectorAll('button')].find((x) => x.innerHTML === FONT_LOOK[k].html);
        expect(b, `${m} ${k}`).toBeTruthy();
      }
      // the size box is one kind everywhere: typed, with the same list
      const size = g.querySelector<HTMLInputElement>('input[aria-label="Font size"]')!;
      expect(size.getAttribute('list')).toBe(FONT_SIZE_LIST);
    }
  });
  it('keeps each mode\'s own hooks (ids and data attributes its code looks for)', () => {
    const d = group('document'), s = group('slides'), x = group('sheet');
    expect(d.querySelector('#doc-font, #doc-size, #doc-colour, #doc-hl-bar, [data-doc=font-box]')).not.toBeNull();
    expect(d.querySelectorAll('#doc-font, #doc-size, #doc-colour, #doc-hl-bar')).toHaveLength(4);
    expect(s.hasAttribute('data-sl-text')).toBe(true);
    expect(s.querySelectorAll('[data-tx=font], [data-tx=size], [data-tx=colour], [data-tx=spacing], [data-tx=font-box]')).toHaveLength(5);
    expect(x.querySelectorAll('#sh-font, #sh-size, [data-sh=text-colour], [data-sh=fill-colour], [data-sh=borders], [data-sh=cell-strike], [data-sh=cell-sub], [data-sh=cell-sup], [data-sh=font-bigger], [data-sh=font-smaller]')).toHaveLength(10);
  });
  it('is put in where index.html leaves a place for it, with one list of sizes', () => {
    document.body.innerHTML = '<div id="a"><div data-font-group="document"></div></div><div id="b"><div data-font-group="sheet"></div></div>';
    installFontGroups();
    expect(document.querySelectorAll('.rb-font-group')).toHaveLength(2);
    expect(document.querySelectorAll(`datalist#${FONT_SIZE_LIST}`)).toHaveLength(1);
    const page = new DOMParser().parseFromString(src('index.html'), 'text/html');
    expect([...page.querySelectorAll('[data-font-group]')].map((e) => e.getAttribute('data-font-group')).sort()).toEqual(['document', 'sheet', 'slides']);
    expect(page.getElementById('doc-font')).toBeNull();
    expect(src('src/main.ts').indexOf("import './ui/font-groups-install';")).toBeLessThan(src('src/main.ts').indexOf("import { fieldEnv }"));
  });
  it('the Canvas group has the same controls and order, then its own (R)', () => {
    document.body.innerHTML = '';
    const bar = document.createElement('div');
    const par = document.createElement('div');
    buildTextBar(bar, { format: () => true, type: () => true, link: () => {}, state: () => null, back: () => {} }, { ribbon: { paragraph: par } });
    expect(shared(bar)).toEqual(ORDER);
    const btns = [...bar.querySelectorAll('button')];
    expect(btns.at(-1)!.innerHTML).toBe('(<i>R</i>)');
    expect(bar.querySelector('label.rb-colour')!.firstElementChild!.outerHTML).toBe(FONT_LOOK.color.html);
    // the Canvas ribbon's Font group has the ⬊, and it opens the Text Formatting toolbox
    const ran: string[] = [];
    const place = document.createElement('div');
    document.body.append(place);
    const rb = new CanvasRibbon({ command: (c) => ran.push(c), pickTool: () => {}, hasTool: () => true, icon: () => undefined, textGroups: () => {}, pasteMenu: () => {} }, place);
    const font = [...rb.el.querySelectorAll('.rb-group')].find((g) => g.querySelector('.rb-label')?.textContent === 'Font')!;
    font.querySelector<HTMLButtonElement>('.rb-launch')!.click();
    expect(ran).toEqual(['toolbox-text']);
  });
});
