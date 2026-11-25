// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { INSERT_MENU, type MenuEntry } from '../src/commands/registry';
import { CANVAS_TABS, buttonsOf, canvasTabFor, isFlyout } from '../src/ui/canvas-ribbon';
import { RIBBON_ONLY_ICONS, commandIcon } from '../src/ui/command-icons';
import { CONTEXT_BOXES, TOOLBOX_IDS, defaultToolboxes } from '../src/ui/toolboxes';

describe('Canvas ribbon', () => {
  it('gives every command button a picture (only group names and major commands carry words)', () => {
    // (the commands in the flyouts too, and the command each flyout's large button borrows its picture from)
    const bare = CANVAS_TABS.flatMap((t) => t.groups.flatMap(buttonsOf)).filter((it) => 'cmd' in it && !(commandIcon(it.cmd) ?? RIBBON_ONLY_ICONS[it.cmd])).map((it) => ('cmd' in it ? it.cmd : ''));
    expect(bare).toEqual([]);
    const flyIcons = CANVAS_TABS.flatMap((t) => t.groups.flatMap((g) => g.items.filter(isFlyout))).filter((f) => !(commandIcon(f.icon) ?? RIBBON_ONLY_ICONS[f.icon])).map((f) => f.fly);
    expect(flyIcons).toEqual([]);
  });

  it('has Home first, opening with Clipboard, Font and Paragraph (as the Spreadsheet does), then Format Favorites', () => {
    expect(CANVAS_TABS[0].id).toBe('home');
    const [clip, font, para, favs] = CANVAS_TABS[0].groups;
    expect([clip.name, clip.special]).toEqual(['Clipboard', 'clipboard']);
    expect([font.name, font.special]).toEqual(['Font', 'font']);
    expect([para.name, para.special]).toEqual(['Paragraph', 'paragraph']);
    expect(favs.gallery).toBe('favorites');
  });

  it('has no tabs that come and go with the selection, and no Arrange tab (its groups moved to Home and View)', () => {
    expect(CANVAS_TABS.map((t) => t.id)).toEqual(['home', 'insert', 'chemistry', 'view']);
    // a tab there is no more (saved, or asked for by name) opens Home
    expect(canvasTabFor('arrange')).toBe('home');
    expect(canvasTabFor(undefined)).toBe('home');
    expect(canvasTabFor('view')).toBe('view');
  });

  it('lays the tabs out as the owner asked (Canvas ribbon cleanup)', () => {
    const tab = (id: string) => CANVAS_TABS.find((t) => t.id === id)!.groups.map((g) => g.name);
    expect(tab('home')).toEqual(['Clipboard', 'Font', 'Paragraph', 'Format Favorites', 'Clean Up', 'Arrange']);
    expect(tab('insert')).toEqual(['Structures', 'Schemes', 'Diagrams', 'Mechanism', 'Lab']);
    expect(tab('chemistry')).toEqual(['Structure', 'Reaction', 'NMR', 'Look Up']);
    expect(tab('view')).toEqual(['Zoom', 'Show', '3-D']);
    const flies = (id: string) => CANVAS_TABS.find((t) => t.id === id)!.groups.flatMap((g) => g.items.filter(isFlyout)).map((f) => f.label);
    expect(flies('home')).toEqual(['Align', 'Rotate', 'Order', 'Focal Point']);
    expect(flies('insert')).toEqual(['Structure From…', 'Schemes', 'Diagrams']);
    expect(flies('chemistry')).toEqual(['Predict NMR']);
    // Smart Clean and Number Compounds on Home
    const home = CANVAS_TABS[0].groups.flatMap(buttonsOf).flatMap((it) => ('cmd' in it ? [it.cmd] : []));
    for (const c of ['smart-clean', 'number-compounds', 'align-left', 'distribute-h', 'arrange-grid', 'flip-h', 'rotate-dialog', 'shape-front', 'set-focal-point']) expect(home).toContain(c);
    // Structure From… holds the three ways of making a structure from something else
    const from = CANVAS_TABS[1].groups[0].items.find(isFlyout)!;
    expect(from.items.map((x) => (x && 'cmd' in x ? x.cmd : x))).toEqual(['name-to-structure', 'import-picture', 'sequence-to-structure']);
    // the Diagrams pane: a picture for each kind of diagram, Diagram… among them, and nothing else
    const pane = CANVAS_TABS[1].groups.find((g) => g.name === 'Diagrams')!.items.find(isFlyout)!;
    expect(pane.pane).toBe('templates');
    const kinds = pane.items.flatMap((x) => (x && 'cmd' in x ? [x.cmd] : []));
    for (const c of ['energy-diagram', 'mo-diagram', 'd-orbital-splitting', 'orbital', 'ts-brackets', 'torsion-chart', 'newman-projection', 'insert-diagram']) expect(kinds).toContain(c);
    for (const x of pane.items) if (x && 'cmd' in x) expect(x.thumb, x.label).toBeTruthy();
    // Predict NMR's list: the two nuclei, Show on Drawing and the spectrum window; nothing else of NMR on the ribbon
    const nmr = CANVAS_TABS[2].groups.find((g) => g.name === 'NMR')!;
    expect(buttonsOf(nmr).map((x) => ('cmd' in x ? x.cmd : ''))).toEqual(['nmr-1h', 'nmr-13c', 'nmr-marks', 'nmr-window']);
  });

  it('has no command twice on one tab, but the Lab Calculator stays in Look Up', () => {
    for (const t of CANVAS_TABS) {
      const cmds = t.groups.flatMap(buttonsOf).flatMap((it) => ('cmd' in it ? [`${it.cmd} ${it.arg ?? ''}`] : []));
      expect(cmds.filter((x, i) => cmds.indexOf(x) !== i), t.id).toEqual([]);
    }
    expect(CANVAS_TABS[2].groups.find((g) => g.name === 'Look Up')!.items.some((it) => 'cmd' in it && it.cmd === 'lab-calculator')).toBe(true);
  });

  it('keeps every command it no longer shows in a top menu (and so in Search and the keymap)', () => {
    // (as strict as the check it replaced: each one an item of a real menu in the menu bar, parsed, not text anywhere in the page)
    const page = new DOMParser().parseFromString(readFileSync('index.html', 'utf8'), 'text/html');
    // (the Insert menu is built from the command list; Format ▸ Align has Distribute as its two spacings)
    const flat = (m: MenuEntry[]): string[] => m.flatMap((e) => (e === '-' ? [] : 'items' in e ? flat(e.items) : [e.id]));
    const insertMenu = new Set(flat(INSERT_MENU));
    const SAME: Record<string, string> = { 'distribute-h': 'distribute-h-gaps', 'distribute-v': 'distribute-v-gaps' };
    const inMenus = (c: string) => insertMenu.has(c) || [...page.querySelectorAll<HTMLElement>(`header .menu-wrap .menu [data-cmd="${SAME[c] ?? c}"]`)].some((b) => b.matches('button[role^="menuitem"]'));
    const gone = ['clean-up-arrow', 'arrow-reverse', 'flip-arrow-bend', 'arrow-single-curve', 'arrow-s-shape', 'arrow-shape-u', 'arrow-shape-loop', 'arrow-add-bend', 'arrow-remove-bend', 'arrow-smooth-path', 'arrow-simplify-path', 'attach-arrow', 'detach-arrow', 'aromatic-circles', 'fill-rings', 'hapto-bond',
      'predict-nmr', 'nmr-solvent', 'nmr-check', 'nmr-settings'];
    const shown = new Set(CANVAS_TABS.flatMap((t) => t.groups.flatMap(buttonsOf)).flatMap((it) => ('cmd' in it ? [it.cmd] : [])));
    for (const c of gone) {
      expect(shown.has(c), c).toBe(false);
      expect(inMenus(c), c).toBe(true);
    }
    // and every command the ribbon now hides in a flyout is in a top menu too
    const inFlyouts = CANVAS_TABS.flatMap((t) => t.groups.flatMap((g) => g.items.filter(isFlyout))).flatMap((f) => f.items.flatMap((x) => (x && 'cmd' in x ? [x.cmd] : [])));
    expect([...new Set(inFlyouts)].filter((c) => !inMenus(c))).toEqual([]);
  });
});

describe('context toolboxes', () => {
  it('are toolboxes, hidden until opened', () => {
    const st = defaultToolboxes();
    for (const id of CONTEXT_BOXES) {
      expect(TOOLBOX_IDS).toContain(id);
      expect(st.places[id].shown).toBe(false);
    }
  });
});
