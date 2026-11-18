// @vitest-environment jsdom
//
// The side panel's sections as tabs in its one header row: one shows at a time, a tab can be
// stacked under the tabs (and folded there), and both can be put in another order. Kept per mode.

import { describe, it, expect, beforeEach } from 'vitest';
import { SideSections, arrange, withMoved, withFolded, parseSideLayouts, titleCase, type SideLayout } from '../src/ui/side-sections';
import { parseToolboxes, withLayoutReset } from '../src/ui/toolboxes';

describe('which sections are tabs and which are stacked', () => {
  const visible = ['anim-section', 'cmt-section', 'style-section'];
  it('starts with every section a tab, Style first and open', () => {
    expect(arrange({}, visible)).toEqual({ tabs: ['style-section', 'anim-section', 'cmt-section'], stacked: [], active: 'style-section' });
  });
  it('opens the tab last picked, or the first when that one is not showing', () => {
    expect(arrange({ active: 'cmt-section' }, visible).active).toBe('cmt-section');
    expect(arrange({ active: 'cell-section' }, visible).active).toBe('style-section');
    expect(arrange({}, []).active).toBeNull();
  });
  it('stacks a tab dragged down, and it stops being the open tab', () => {
    const l = withMoved({ active: 'anim-section' }, 'anim-section', 'stack', null);
    expect(arrange(l, visible)).toEqual({ tabs: ['style-section', 'cmt-section'], stacked: ['anim-section'], active: 'style-section' });
  });
  it('makes a stacked section a tab again, open', () => {
    const l = withMoved(withMoved({}, 'anim-section', 'stack', null), 'anim-section', 'tabs', 'style-section');
    expect(arrange(l, visible)).toEqual({ tabs: ['anim-section', 'style-section', 'cmt-section'], stacked: [], active: 'anim-section' });
  });
  it('reorders tabs, and stacked sections among themselves', () => {
    expect(arrange(withMoved({}, 'cmt-section', 'tabs', 'style-section'), visible).tabs).toEqual(['cmt-section', 'style-section', 'anim-section']);
    expect(arrange(withMoved({}, 'style-section', 'tabs', null), visible).tabs).toEqual(['anim-section', 'cmt-section', 'style-section']);
    let l: SideLayout = withMoved(withMoved({}, 'anim-section', 'stack', null), 'cmt-section', 'stack', null);
    expect(arrange(l, visible).stacked).toEqual(['anim-section', 'cmt-section']);
    l = withMoved(l, 'cmt-section', 'stack', 'anim-section');
    expect(arrange(l, visible).stacked).toEqual(['cmt-section', 'anim-section']);
  });
  it('keeps a section it has never heard of, after the rest', () => {
    expect(arrange({}, ['new-section', 'style-section']).tabs).toEqual(['style-section', 'new-section']);
  });
  it('folds and opens a stacked section', () => {
    const l = withFolded({}, 'anim-section', true);
    expect(l.folded).toEqual(['anim-section']);
    expect(withFolded(l, 'anim-section', false).folded).toEqual([]);
  });
});

describe('the layout kept with the settings', () => {
  it('reads each mode\'s layout and drops what makes no sense', () => {
    const got = parseSideLayouts({ slides: { order: ['cmt-section', 'x y', 7, 'cmt-section'], stacked: ['anim-section'], folded: 'no', active: 'cmt-section' }, 'bad mode': {}, sheet: 5 });
    expect(got).toEqual({ slides: { order: ['cmt-section'], stacked: ['anim-section'], active: 'cmt-section' } });
    expect(parseSideLayouts(null)).toBeUndefined();
    expect(parseToolboxes({ sideLayout: { slides: { stacked: ['anim-section'] } } }).sideLayout).toEqual({ slides: { stacked: ['anim-section'] } });
  });
  it('goes back to how it comes with Reset Toolboxes', () => {
    const st = parseToolboxes({ sideLayout: { slides: { stacked: ['anim-section'] } } });
    expect(withLayoutReset(st).sideLayout).toBeUndefined();
  });
});

describe('what is selected, as a title', () => {
  it('capitalizes the words and leaves numbers and short words alone', () => {
    expect(titleCase('13 atoms, 13 bonds')).toBe('13 Atoms, 13 Bonds');
    expect(titleCase('2 captions')).toBe('2 Captions');
    expect(titleCase('reaction arrow')).toBe('Reaction Arrow');
    expect(titleCase('A1')).toBe('A1');
  });
});

describe('the tabs in the header row', () => {
  let content: HTMLElement;
  let layouts: Record<string, SideLayout>;
  let mode: string;
  const make = () => new SideSections(content, { mode: () => mode, get: (m) => layouts[m] ?? {}, set: (m, l) => { layouts[m] = l; } });
  const tabs = (ss: SideSections) => [...ss.tabs.querySelectorAll<HTMLElement>('.ss-tab')].map((t) => t.textContent + (t.getAttribute('aria-selected') === 'true' ? '*' : ''));
  const sec = (id: string) => content.querySelector<HTMLElement>(`#${id}`)!;

  beforeEach(() => {
    document.body.innerHTML = `<section class="toolbox" data-id="details"><div class="tb-head"><span class="tb-grip"></span><span class="tb-title">Side Panel</span><button class="tb-lock"></button></div><div class="tb-body"><div id="side-content">
      <section id="anim-section" hidden><h2>Animation<button class="an-close" title="Close the Animation pane">×</button></h2><p>list</p></section>
      <section id="style-section" class="empty"><h2>Style</h2><div id="style-body"><p>Select something</p></div></section>
      <section id="warnings-section" hidden><h2>Warnings <span class="count">3</span><label class="check"><input type="checkbox"> Show on Drawing</label></h2><div>list</div></section>
    </div></div></section><button id="side-fold">×</button>`;
    content = document.getElementById('side-content')!;
    layouts = {};
    mode = 'slides';
  });

  it('names the one section showing, and is the header alone with nothing selected', () => {
    const ss = make();
    ss.mount(document.querySelector('.tb-head')!, document.getElementById('side-fold')!);
    expect(tabs(ss)).toEqual(['Style*']);
    expect(ss.tabs.classList.contains('single')).toBe(true);
    expect(document.querySelector('.toolbox')!.classList.contains('ss-bare')).toBe(true);
    // the header row: grip, (title), tabs, », padlock, ×
    expect([...document.querySelector('.tb-head')!.children].map((c) => c.className || c.id)).toEqual(['tb-grip', 'tb-title', 'ss-tabs single', 'ss-more', 'tb-lock', 'side-fold']);
  });

  it('says what is selected after the name, in the open tab only', () => {
    const ss = make();
    sec('style-section').classList.remove('empty');
    sec('style-section').querySelector('h2')!.insertAdjacentHTML('beforeend', '<span class="style-of"> – 2 captions</span>');
    ss.refresh();
    expect(tabs(ss)).toEqual(['Style: 2 Captions*']);
    expect(document.querySelector('.toolbox')!.classList.contains('ss-bare')).toBe(false);
    expect(sec('style-section').querySelector('h2')!.classList.contains('ss-plain')).toBe(true);
  });

  it('opens a section that has just appeared, and hides the other tabs\' sections', () => {
    const ss = make();
    sec('anim-section').hidden = false;
    ss.refresh();
    expect(tabs(ss)).toEqual(['Style', 'Animation*']);
    expect(sec('style-section').classList.contains('ss-off')).toBe(true);
    expect(sec('anim-section').classList.contains('ss-off')).toBe(false);
    // its own × moves onto the open tab
    expect(ss.tabs.querySelector('.ss-tab-x')?.getAttribute('aria-label')).toBe('Close the Animation pane');
    ss.tabs.querySelector<HTMLElement>('.ss-tab[data-sec="style-section"]')!.click();
    expect(tabs(ss)).toEqual(['Style*', 'Animation']);
    expect(layouts.slides.active).toBe('style-section');
  });

  it('does not switch tabs just because the mode changed', () => {
    layouts = { slides: { active: 'style-section' } };
    const ss = make();
    mode = 'drawing';
    ss.refresh();
    mode = 'slides';
    sec('anim-section').hidden = false;
    ss.refresh();
    expect(tabs(ss)).toEqual(['Style*', 'Animation']);
  });

  it('keeps a heading\'s own controls on a row under the tabs, and its count on the tab', () => {
    const ss = make();
    sec('warnings-section').hidden = false;
    ss.refresh();
    expect(tabs(ss)).toEqual(['Style', 'Warnings3*']);
    expect(sec('warnings-section').querySelector('h2')!.classList.contains('ss-plain')).toBe(false);
  });

  it('stacks a section under the tabs with a heading that folds it', () => {
    layouts = { slides: { stacked: ['anim-section'] } };
    const ss = make();
    sec('anim-section').hidden = false;
    ss.refresh();
    expect(tabs(ss)).toEqual(['Style*']);
    const a = sec('anim-section');
    expect(a.classList.contains('ss-stacked')).toBe(true);
    // the open tab's section comes first, the stacked ones after it
    expect([...content.querySelectorAll(':scope > section')].filter((s) => !(s as HTMLElement).hidden).map((s) => s.id)).toEqual(['style-section', 'anim-section']);
    const title = a.querySelector<HTMLElement>('h2 > .ss-title')!;
    expect(title.getAttribute('aria-expanded')).toBe('true');
    title.click();
    expect(a.classList.contains('ss-folded')).toBe(true);
    expect(a.querySelector('h2 > .ss-title')!.getAttribute('aria-expanded')).toBe('false');
    expect(layouts.slides.folded).toEqual(['anim-section']);
    // asked for (as Fill Rings asks for Style), a folded section opens
    ss.show('anim-section');
    expect(a.classList.contains('ss-folded')).toBe(false);
  });

  it('gives each mode its own layout', () => {
    layouts = { slides: { stacked: ['anim-section'] } };
    const ss = make();
    sec('anim-section').hidden = false;
    mode = 'design';
    ss.refresh();
    expect(sec('anim-section').classList.contains('ss-stacked')).toBe(false);
    expect(tabs(ss)).toContain('Animation');
  });
});
