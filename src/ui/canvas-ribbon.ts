// The Canvas ribbon: a compact ribbon over the drawing with the chemistry commands that have no
// toolbox of their own, or that are hard to find in the menus. It is a tabbed ribbon like the
// other modes' (so collapsing, fitting a narrow window, command search and Customize work the
// same), with two rows of buttons under the tabs. Only the major commands carry words (the groups
// have no names shown); the rest are pictures, named in their tooltips. Settings ▸ Ribbon offers
// the one-row Simplified look.
//
// Families of commands sit behind one large button each, a flyout: a click drops a list of the
// commands (Align, Rotate, Order, Focal Point, Schemes, Structure From…, Predict NMR) or a pane of
// pictures to look over and pick from (Diagrams) under it. The list is the ribbon's own buttons,
// kept inside the ribbon (src/ui/ribbon-flyout.ts opens it, as the other modes' dropdowns), so a
// click on one runs its command as any ribbon button does, and Search still finds it.
//
// The tabs stay put whatever is drawn or selected: the Canvas has no tabs that come and go with an
// object (the arrow and ring commands are on the right-click menu and in the menus). The right end
// of the tab row holds the Lab Calculator and the warnings, and the right end of the buttons a
// one-line Analysis drop-down (see canvas-ribbon-boxes.ts).

import { DIAGRAM_THUMBS } from './diagram-thumbs';
import { closeRibbonFlyout } from './ribbon-flyout';

/** A command button (data-cmd, run as the menus run it). */
export interface RibbonCmd {
  cmd: string;
  label: string;
  major?: boolean;
  tip?: string;
  /** A small ▾ on the button opens its options (CanvasRibbonHost.itemMenu). */
  menu?: boolean;
  /** Passed with the command (a ready-made form of it: the MO diagram of water). */
  arg?: string;
  /** In a template pane: its picture (a DIAGRAM_THUMBS key), until the host draws a better one. */
  thumb?: string;
  /** Turns something on or off (Show Reaction Roles): in a flyout's list it shows a check while on (CanvasRibbonHost.checked). */
  check?: boolean;
}
/** A drawing tool's button. */
export interface RibbonTool { tool: string; label: string; major?: boolean; tip?: string }
/** One button of the ribbon: a command or a tool. */
export type RibbonButton = RibbonCmd | RibbonTool;
/** What a flyout holds: buttons, a heading over the ones after it, or a line between (null). */
export type FlyoutEntry = RibbonButton | { head: string } | null;
/**
 * A flyout: one large button that drops its commands under it, as a list with pictures and names
 * (`pane` 'list') or as a pane of labeled pictures to look over and pick from ('templates').
 * Nothing runs until one is picked.
 */
export interface RibbonFlyout {
  /** Its slug (data-cr-fly). */
  fly: string;
  label: string;
  /** The command whose picture the large button shows. */
  icon: string;
  tip: string;
  pane?: 'list' | 'templates';
  items: FlyoutEntry[];
}
export type RibbonItem = RibbonButton | RibbonFlyout;
/**
 * A group: its buttons, or one built specially: the Format Favorites gallery, the Clipboard (Paste,
 * Cut, Copy and Format Painter, as the Spreadsheet's Home tab has them), or the Font and Paragraph
 * groups (every button and box of the text formatting bar, which hides while they show).
 */
export interface RibbonGroup { name: string; items: RibbonItem[]; gallery?: 'favorites'; special?: 'clipboard' | 'font' | 'paragraph' }
export interface RibbonTab { id: string; title: string; groups: RibbonGroup[] }

const c = (cmd: string, label: string, major = false): RibbonCmd => ({ cmd, label, major });
/** A picture in a template pane. */
const t = (cmd: string, label: string, thumb: string, tip: string, arg?: string): RibbonCmd => ({ cmd, label, thumb, tip, ...(arg ? { arg } : {}) });
export const isFlyout = (it: RibbonItem): it is RibbonFlyout => 'fly' in it;
/** A command that is on or off. */
const onOff = (cmd: string, label: string): RibbonCmd => ({ cmd, label, check: true });
/** Every button of a group, those in its flyouts too. */
export const buttonsOf = (g: RibbonGroup): RibbonButton[] => g.items.flatMap((it) => (isFlyout(it) ? it.items.filter((x): x is RibbonButton => !!x && !('head' in x)) : [it]));

/** What the Canvas ribbon holds. Home is the essentials; the other tabs take the rest. */
export const CANVAS_TABS: RibbonTab[] = [
  {
    id: 'home', title: 'Home', groups: [
      // first, as the Spreadsheet's Home tab starts
      { name: 'Clipboard', items: [], special: 'clipboard' },
      { name: 'Font', items: [], special: 'font' },
      { name: 'Paragraph', items: [], special: 'paragraph' },
      // (filled by the shared Format Favorites gallery, as on every mode's Home tab)
      { name: 'Format Favorites', items: [], gallery: 'favorites' },
      // (Smart Clean: a scheme, cycle, mechanism arrow or structure, whichever is selected; both are on Chemistry too)
      { name: 'Clean Up', items: [c('smart-clean', 'Smart Clean', true), c('number-compounds', 'Number Compounds', true)] },
      // lining up, turning and stacking, four flyouts (the Arrange toolbox has them all as buttons)
      { name: 'Arrange', items: [
        { fly: 'align', label: 'Align', icon: 'align-left', tip: 'Align and distribute the selected objects, or arrange them in a row, column or grid', items: [
          c('align-left', 'Align Left'), c('align-hcenter', 'Align Center'), c('align-right', 'Align Right'), null,
          c('align-top', 'Align Top'), c('align-vcenter', 'Align Middle'), c('align-bottom', 'Align Bottom'), null,
          { ...c('distribute-h', 'Distribute Horizontally'), menu: true }, { ...c('distribute-v', 'Distribute Vertically'), menu: true }, null,
          c('arrange-row', 'Arrange in a Row'), c('arrange-column', 'Arrange in a Column'), c('arrange-grid', 'Arrange in a Grid…'),
        ] },
        { fly: 'rotate', label: 'Rotate', icon: 'rotate-cw', tip: 'Rotate or flip the selected objects', items: [
          c('rotate-cw', 'Rotate Right 90°'), c('rotate-ccw', 'Rotate Left 90°'), c('rotate-dialog', 'Rotate…'), null,
          c('flip-h', 'Flip Horizontal'), c('flip-v', 'Flip Vertical'),
        ] },
        { fly: 'order', label: 'Order', icon: 'shape-front', tip: 'Bring the selected objects forward or send them back', items: [
          c('shape-front', 'Bring to Front'), c('shape-forward', 'Bring Forward'), c('shape-back', 'Send to Back'), c('shape-backward', 'Send Backward'),
        ] },
        { fly: 'focal', label: 'Focal Point', icon: 'set-focal-point', tip: 'Focal points: the spot each structure lines up by when aligned, distributed or arranged', items: [
          c('set-focal-point', 'Set as Focal Point'), c('match-focal-points', 'Match Focal Points'), c('reset-focal-point', 'Reset Focal Point'), null, onOff('show-focal-points', 'Show Focal Points'),
        ] },
      ] },
    ],
  },
  {
    id: 'insert', title: 'Insert', groups: [
      { name: 'Structures', items: [
        { fly: 'structure-from', label: 'Structure From…', icon: 'name-to-structure', tip: 'Structure From: a name or SMILES, a picture or PDF, or a peptide or nucleic acid sequence', items: [
          c('name-to-structure', 'Name to Structure…'), c('import-picture', 'Structures from Picture…'), c('sequence-to-structure', 'Structure from Sequence…'),
        ] },
        c('crystal-structure', 'Crystal Structure (CIF)…'), c('ligand-library', 'Ligand Library…'), c('compound-library', 'Compound Library…'),
      ] },
      { name: 'Schemes', items: [
        { fly: 'schemes', label: 'Schemes', icon: 'smart-scheme', tip: 'Schemes: Smart Scheme, reaction roles, stoichiometry, balance and atom maps', items: [
          c('smart-scheme', 'Smart Scheme'), c('convert-smart-scheme', 'Convert to Smart Scheme'), onOff('show-roles', 'Show Reaction Roles'), null,
          c('stoichiometry-table', 'Stoichiometry Table…'), c('check-balance', 'Check Balance…'), c('map-atoms', 'Map Atoms…'),
        ] },
      ] },
      { name: 'Diagrams', items: [
        { fly: 'diagrams', label: 'Diagrams', icon: 'energy-diagram', pane: 'templates', tip: 'Diagrams: energy diagrams, MO and d-orbital diagrams, orbitals, Newman projections and more. Look them over, then choose one', items: [
          // (two rows of five: reactions, conformations and text diagrams; then the orbitals)
          t('energy-diagram', 'Energy Diagram', 'energy', 'Energy Diagram: a reaction energy diagram from a table of energies (opens its window)'),
          t('ts-brackets', 'Transition State Brackets', 'ts', 'Transition State Brackets: square brackets with ‡ around the selected transition state'),
          t('torsion-chart', 'Torsional Energy Chart', 'torsion', 'Torsional Energy Chart: the energy of rotation about the selected single bond (opens its window)'),
          t('newman-projection', 'Newman Projection', 'newman', 'Newman Projection: the selected single bond seen end on (opens its window)'),
          t('insert-diagram', 'Diagram', 'diagram', 'Diagram: lists, processes, cycles, hierarchies and Venn diagrams drawn from lines of text (opens its window)'),
          t('mo-diagram', 'MO Diagram', 'mo', 'MO Diagram: two atoms (H₂ to start); choose the atoms in the Side Panel'),
          t('mo-diagram', 'MO Diagram: H₂O', 'mo', 'MO Diagram of water (H₂O), with its group orbitals', 'H2O'),
          t('mo-diagram', 'MO Diagram: NH₃', 'mo', 'MO Diagram of ammonia (NH₃), with its group orbitals', 'NH3'),
          t('d-orbital-splitting', 'd-Orbital Splitting', 'dsplit', 'd-Orbital Splitting: a metal ion\'s five d orbitals and the levels they split into; choose the geometry in the Side Panel'),
          t('orbital', 'Orbital', 'orbital', 'Orbital: an s, p, d or hybrid orbital on each selected atom (opens its window)'),
        ] },
      ] },
      { name: 'Mechanism', items: [c('animate-reaction', 'Animate', true), c('check-arrows', 'Check Arrows'), c('draw-from-arrows', 'Draw Next Intermediate'), c('homolysis-arrows', 'Homolysis Arrows'), c('model-3d', '3-D Model…')] },
      { name: 'Lab', items: [c('tlc-plate', 'TLC Plate', true), c('insert-table', 'Table'), c('rgroup-table', 'R-Group Table…')] },
    ],
  },
  {
    id: 'chemistry', title: 'Chemistry', groups: [
      { name: 'Structure', items: [c('smart-clean', 'Smart Clean', true), c('clean-up', 'Clean Up Structure'), c('check-structure', 'Check Structure'), c('expand-label', 'Expand Label'), c('contract-label', 'Contract Label'), c('stereo-labels', 'Stereo Labels')] },
      { name: 'Reaction', items: [c('number-compounds', 'Number Compounds', true), c('clean-up-reaction', 'Clean Up Reaction'), c('show-roles', 'Show Reaction Roles'), c('link-steps', 'Link Steps in Order'), c('add-frame', 'Add Frame'), c('attach-descriptors', 'Attach Descriptors')] },
      // (left out where NMR isn't offered; Solvent, Check Data and NMR Settings are in Chemistry ▸ NMR and the spectrum window)
      { name: 'NMR', items: [
        { fly: 'nmr', label: 'Predict NMR', icon: 'predict-nmr', tip: 'Predict NMR: ¹H or ¹³C shifts for the selected structure, on the drawing or in the spectrum window', items: [
          { cmd: 'nmr-1h', label: 'Predict ¹H NMR', tip: 'Predict the ¹H NMR spectrum of the selected structure' },
          { cmd: 'nmr-13c', label: 'Predict ¹³C NMR', tip: 'Predict the ¹³C NMR spectrum of the selected structure' }, null,
          onOff('nmr-marks', 'Show on Drawing'), c('nmr-window', 'Spectrum Window'),
        ] },
      ] },
      { name: 'Look Up', items: [c('structure-to-name', 'Structure to Name'), c('find-cas', 'Find CAS RN'), c('pubchem-lookup', 'Look Up on PubChem'), c('knowledge-base', 'Knowledge Base…'), c('compound-library', 'Compound Library…'), c('periodic-table', 'Periodic Table…'), c('lab-calculator', 'Lab Calculator…')] },
    ],
  },
  {
    id: 'view', title: 'View', groups: [
      { name: 'Zoom', items: [c('zoom-fit', 'Fit', true), c('focus-view', 'Focus View')] },
      { name: 'Show', items: [c('navigator', 'Document Map'), c('dark-page', 'Reading Mode'), c('show-stereo', 'Stereo Labels'), c('show-focal-points', 'Focal Points'), c('show-roles', 'Reaction Roles')] },
      // (turning in 3-D: the two Perspective tools drag a structure round; 3-D Rotation… turns it by angles typed in)
      { name: '3-D', items: [
        { tool: 'perspective', label: 'Perspective', major: true, tip: 'Perspective: drag a structure to tilt it in 3-D as a flat sheet (Shift: 15° steps)' },
        { tool: 'perspective-3d', label: '3-D Perspective', tip: '3-D Perspective: drag a structure to rotate its real 3-D shape (Shift: 15° steps)' },
        c('turn-3d', '3-D Rotation…'), c('flatten-3d', 'Flatten'),
      ] },
    ],
  },
];

/** The tab a saved or asked-for tab id comes to: itself, or Home for a tab there is no more (Arrange). */
export const canvasTabFor = (id: string | null | undefined): string => (id && CANVAS_TABS.some((x) => x.id === id) ? id : 'home');

export type RibbonLook = 'classic' | 'simple';
export type GroupNames = 'top' | 'side' | 'none';

export interface CanvasRibbonHost {
  /** Run a menu command (with `arg`: a ready-made form of it, from a template pane). */
  command(cmd: string, arg?: string): void;
  /** Pick a drawing tool. */
  pickTool(name: string): void;
  /** Is there such a tool (the ribbon leaves out tools this build lacks)? */
  hasTool(name: string): boolean;
  /** A command's or tool's picture (24×24 SVG), if it has one. */
  icon(item: RibbonButton): string | undefined;
  /** Whether a command that turns something on or off (RibbonCmd.check) is on now. */
  checked?(cmd: string): boolean;
  /** A template pane's picture drawn by the drawing code (an SVG), where it can be; undefined keeps the plain one. */
  thumb?(item: RibbonCmd): string | undefined;
  /** Fill the Font and Paragraph groups' rows with the text formatting bar's buttons and boxes. */
  textGroups(font: HTMLElement, paragraph: HTMLElement): void;
  /** Paste's ▾: its menu, under the button. */
  pasteMenu(at: DOMRect): void;
  /** A button's ▾ (RibbonItem.menu): its options, under the button. */
  itemMenu?(cmd: string, at: DOMRect): void;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);

export class CanvasRibbon {
  readonly el: HTMLDivElement;
  readonly tabRow: HTMLDivElement;
  /** The right end of the tab row (the warnings go here). */
  readonly tabEnd: HTMLDivElement;
  /** The right end of the buttons (the Analysis drop-down goes here). */
  readonly bodyEnd: HTMLDivElement;
  private tabs = new Map<string, HTMLButtonElement>();
  private panels = new Map<string, HTMLDivElement>();

  /** Made in front of `place` (the first of the other modes' ribbons). */
  constructor(private host: CanvasRibbonHost, place: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'canvas-ribbon';
    this.el.className = 'ribbon tabbed canvas-ribbon cr-classic';
    this.el.setAttribute('role', 'toolbar');
    this.el.setAttribute('aria-label', 'Canvas');
    this.tabRow = document.createElement('div');
    this.tabRow.className = 'rb-tabs';
    // the tabs in a tablist of their own: the warnings, the gear and ▴ beside them are not tabs
    const tabList = document.createElement('div');
    tabList.className = 'rb-tablist';
    tabList.setAttribute('role', 'tablist');
    tabList.setAttribute('aria-label', 'Ribbon tabs');
    this.tabRow.append(tabList);
    this.tabEnd = document.createElement('div');
    this.tabEnd.className = 'cr-tab-end';
    // the Lab Calculator, on every tab, left of the warnings (words only where the window has room)
    const calc = document.createElement('button');
    calc.type = 'button';
    calc.className = 'cr-calc';
    calc.dataset.cmd = 'lab-calculator';
    calc.title = 'Lab Calculator: mass, mmol and volume, solutions and dilutions (uses the selected structure\'s MW)';
    calc.setAttribute('aria-label', 'Lab Calculator');
    calc.innerHTML = `${host.icon({ cmd: 'lab-calculator', label: 'Lab Calculator' }) ?? ''}<span class="cr-calc-name">Lab Calculator</span>`;
    calc.addEventListener('click', () => host.command('lab-calculator'));
    this.tabEnd.append(calc);
    this.bodyEnd = document.createElement('div');
    this.bodyEnd.className = 'cr-body-end';
    for (const tab of CANVAS_TABS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.dataset.crTab = tab.id;
      b.textContent = tab.title;
      b.setAttribute('aria-selected', String(tab.id === 'home'));
      b.addEventListener('click', () => this.pick(tab.id));
      tabList.append(b);
      this.tabs.set(tab.id, b);
      this.panels.set(tab.id, this.panel(tab));
    }
    this.tabRow.append(this.tabEnd);
    this.el.append(this.tabRow, ...this.panels.values());
    this.panels.get('home')!.append(this.bodyEnd);
    place.before(this.el);
    // the buttons run the same commands as the menus, or pick their tool
    this.el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-cmd], button[data-cr-tool]');
      if (!b || !this.el.contains(b)) return;
      if ((e.target as HTMLElement).closest('.cr-drop') && b.dataset.cmd) {
        const r = b.getBoundingClientRect();
        // (in a flyout's list the options open beside the row, not over the rows under it)
        host.itemMenu?.(b.dataset.cmd, b.closest('.rb-fly-menu') ? new DOMRect(r.right - 2, r.top - 2, 0, 0) : r);
        return;
      }
      if (b.dataset.crTool) host.pickTool(b.dataset.crTool);
      else if (b.dataset.cmd && !b.closest('.cr-body-end, .cr-tab-end')) host.command(b.dataset.cmd, b.dataset.arg);
    });
  }

  private panel(tab: RibbonTab): HTMLDivElement {
    const p = document.createElement('div');
    p.className = 'rb-panel';
    p.dataset.crPanel = tab.id;
    p.hidden = tab.id !== 'home';
    p.setAttribute('role', 'tabpanel');
    const text: Partial<Record<'font' | 'paragraph', HTMLElement>> = {};
    for (const g of tab.groups) {
      const items = g.items.filter((it) => !('tool' in it) || this.host.hasTool(it.tool));
      if (!items.length && !g.gallery && !g.special) continue;
      const group = document.createElement('div');
      group.className = 'rb-group';
      // (the least used group on Home: the last to open back up in a narrow window)
      if (g.name === 'Look Up') group.classList.add('rb-open-last');
      // (the Arrange flyouts are wanted on Home: in a narrow window the other groups fold first)
      if (g.items.length && g.items.every(isFlyout)) group.classList.add('rb-fold-late');
      const row = document.createElement('div');
      row.className = 'rb-row cr-rows';
      if (g.special === 'clipboard') this.clipboard(row);
      if (g.special === 'font' || g.special === 'paragraph') {
        row.className = 'rb-row cr-font';
        // (a click in them keeps text being typed open, as the Text Formatting toolbox does, and so
        // does a click on the button they fold into in a narrow window)
        group.dataset.keepsTyping = '';
        text[g.special] = row;
      }
      if (g.gallery) {
        // the gallery fills its host itself (main.ts mounts every [data-favorites-gallery])
        row.className = 'rb-row cr-gallery';
        const host = document.createElement('div');
        host.className = 'rb-styles-host';
        host.dataset.favoritesGallery = '';
        row.append(host);
      }
      for (const it of items) row.append(isFlyout(it) ? this.flyout(it) : this.button(it));
      const label = document.createElement('div');
      label.className = 'rb-label';
      label.textContent = g.name;
      group.append(row, label);
      // the Font group's ⬊, as every mode's Font group has one (G5-26)
      if (g.special === 'font') {
        const launch = document.createElement('button');
        launch.type = 'button';
        launch.className = 'rb-launch';
        launch.dataset.cmd = 'toolbox-text';
        launch.title = 'Font settings: the Text Formatting toolbox, with character and line spacing, symbols and every text setting';
        launch.setAttribute('aria-label', 'Font settings');
        launch.textContent = '⬊';
        group.append(launch);
      }
      p.append(group);
    }
    if (text.font && text.paragraph) this.host.textGroups(text.font, text.paragraph);
    return p;
  }

  /** Paste (with its ▾), then Cut, Copy and Format Painter in a column: as the Spreadsheet's Clipboard group. */
  private clipboard(row: HTMLElement): void {
    row.className = 'rb-row cr-clipboard';
    const btn = (cmd: string, html: string, title: string, cls = '') => {
      const b = document.createElement('button');
      b.type = 'button';
      if (cls) b.className = cls;
      b.dataset.cmd = cmd;
      b.title = title;
      b.innerHTML = html;
      return b;
    };
    const paste = document.createElement('div');
    paste.className = 'rb-col rb-paste';
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'rb-paste-more';
    more.textContent = '▾';
    more.title = 'Paste options: Paste, or Paste SMILES (text on the clipboard read as structures)';
    more.setAttribute('aria-label', 'Paste options');
    more.setAttribute('aria-haspopup', 'menu');
    more.addEventListener('click', () => this.host.pasteMenu(more.getBoundingClientRect()));
    paste.append(btn('paste', '<span class="rb-icon">⎘</span>Paste', 'Paste (Ctrl+V): structures from ChemDraw, pictures or text', 'rb-big'), more);
    const col = document.createElement('div');
    col.className = 'rb-col';
    col.append(
      btn('cut', 'Cut', 'Cut (Ctrl+X)'),
      btn('copy', 'Copy', 'Copy (Ctrl+C): structures go as a drawing for ChemDraw, Word and PowerPoint'),
      btn('format-painter', '<span class="rb-lead" data-ic-lead="format-painter"></span>Format Painter', 'Format Painter: copy the style of the selection (or of the text where the cursor is) to what you click next. Double-click to keep painting until Esc'),
    );
    col.lastElementChild!.setAttribute('aria-pressed', 'false');
    row.append(paste, col);
  }

  /** A flyout: its large button, and the list or pane it drops (hidden until the button is clicked; ribbon-flyout.ts opens it). */
  private flyout(f: RibbonFlyout): HTMLDivElement {
    const wrap = document.createElement('div');
    wrap.className = 'rb-fly cr-fly';
    wrap.dataset.crFly = f.fly;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'rb-big cr-major rb-fly-btn';
    b.title = f.tip;
    b.setAttribute('aria-label', f.label.replace(/…$/, ''));
    b.setAttribute('aria-haspopup', 'menu');
    b.setAttribute('aria-expanded', 'false');
    const words = f.label.split(' ');
    const half = Math.ceil(words.length / 2);
    // (the ▾ follows the last word, on its line, so the button stays three rows tall)
    const name = words.length > 1
      ? `<span class="cr-line">${esc(words.slice(0, half).join(' '))}</span> <span class="cr-line">${esc(words.slice(half).join(' '))}<span class="cr-caret" aria-hidden="true">▾</span></span>`
      : `<span class="cr-line">${esc(f.label)}<span class="cr-caret" aria-hidden="true">▾</span></span>`;
    b.innerHTML = `<span class="rb-icon">${this.host.icon({ cmd: f.icon, label: f.label }) ?? ''}</span><span class="cr-name">${name}</span>`;
    const menu = document.createElement('div');
    menu.className = `rb-fly-menu cr-fly-menu${f.pane === 'templates' ? ' cr-tpl-pane' : ''}`;
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', f.label.replace(/…$/, ''));
    menu.hidden = true;
    let grid: HTMLElement | null = null;
    for (const x of f.items) {
      if (x === null) { menu.append(document.createElement('hr')); grid = null; continue; }
      if ('head' in x) {
        const h = document.createElement('div');
        h.className = 'rb-fly-head';
        h.textContent = x.head;
        menu.append(h);
        grid = null;
        continue;
      }
      if ('tool' in x && !this.host.hasTool(x.tool)) continue;
      if (f.pane === 'templates' && 'cmd' in x) {
        if (!grid) { grid = document.createElement('div'); grid.className = 'cr-tpl-grid'; menu.append(grid); }
        grid.append(this.template(x));
      } else menu.append(this.menuItem(x));
    }
    // the on-or-off commands show how they are now, each time the list opens
    menu.addEventListener('rb-fly-open', () => {
      for (const x of menu.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"][data-cmd]')) x.setAttribute('aria-checked', String(!!this.host.checked?.(x.dataset.cmd!)));
    });
    if (f.pane === 'templates') {
      menu.dataset.grid = '';
      // the pictures the drawing code can draw are drawn the first time the pane opens
      menu.addEventListener('rb-fly-open', () => {
        for (const tile of menu.querySelectorAll<HTMLElement>('.cr-tpl:not([data-drawn])')) {
          tile.dataset.drawn = '';
          const it = f.items.find((x): x is RibbonCmd => !!x && 'cmd' in x && x.cmd === tile.dataset.cmd && (x.arg ?? '') === (tile.dataset.arg ?? ''));
          const svg = it && this.host.thumb?.(it);
          if (!svg) continue;
          const pic = tile.querySelector<HTMLElement>('.cr-tpl-pic')!;
          pic.innerHTML = svg;
          pic.dataset.drawn = '';
        }
      });
    }
    wrap.append(b, menu);
    return wrap;
  }

  /** A row of a flyout's list: picture and name. */
  private menuItem(it: RibbonButton): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'cmd' in it && it.check ? 'menuitemcheckbox' : 'menuitem');
    if ('cmd' in it && it.check) b.setAttribute('aria-checked', 'false');
    if ('cmd' in it) b.dataset.cmd = it.cmd; else b.dataset.crTool = it.tool;
    b.title = it.tip ?? it.label;
    b.innerHTML = `<span class="rb-icon">${this.host.icon(it) ?? ''}</span><span class="cr-fly-name">${esc(it.label)}</span>`;
    if ('cmd' in it && it.menu) {
      b.classList.add('cr-has-drop');
      b.insertAdjacentHTML('beforeend', '<span class="cr-drop" aria-hidden="true">▸</span>');
    }
    if ('cmd' in it && it.check) b.insertAdjacentHTML('beforeend', '<span class="cr-check" aria-hidden="true">✓</span>');
    return b;
  }

  /** A template pane's tile: its picture over its name. */
  private template(it: RibbonCmd): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cr-tpl';
    b.setAttribute('role', 'menuitem');
    b.dataset.cmd = it.cmd;
    if (it.arg) b.dataset.arg = it.arg;
    b.title = it.tip ?? it.label;
    b.setAttribute('aria-label', it.label);
    b.innerHTML = `<span class="cr-tpl-pic" aria-hidden="true">${(it.thumb && DIAGRAM_THUMBS[it.thumb]) ?? this.host.icon(it) ?? ''}</span><span class="cr-tpl-name">${esc(it.label)}</span>`;
    return b;
  }

  private button(it: RibbonButton): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    if ('cmd' in it) b.dataset.cmd = it.cmd; else b.dataset.crTool = it.tool;
    const pic = this.host.icon(it);
    const name = it.label.replace(/…$/, '');
    b.title = it.tip ?? it.label;
    b.setAttribute('aria-label', name);
    if (it.major) {
      // picture over its name, both rows tall; a long name breaks onto two lines
      b.className = 'rb-big cr-major';
      const words = name.split(' ');
      // (two lines in Classic, one in Simplified: the space between them shows there)
      const two = words.length > 1 ? `<span class="cr-line">${esc(words.slice(0, Math.ceil(words.length / 2)).join(' '))}</span> <span class="cr-line">${esc(words.slice(Math.ceil(words.length / 2)).join(' '))}</span>` : esc(name);
      b.innerHTML = `<span class="rb-icon">${pic ?? ''}</span><span class="cr-name">${two}</span>`;
    } else {
      b.className = 'rb-iconbtn cr-minor';
      // a command with no picture yet shows a short form of its name
      // (where its tab has room, its name shows beside the picture: from aria-label, in app.css; ribbon-fit.ts)
      b.innerHTML = pic ?? `<span class="cr-word">${esc(name)}</span>`;
    }
    if ('cmd' in it && it.menu) {
      b.classList.add('cr-has-drop');
      b.setAttribute('aria-haspopup', 'menu');
      b.insertAdjacentHTML('beforeend', '<span class="cr-drop" aria-hidden="true">▾</span>');
    }
    return b;
  }

  /** Show it (the Canvas) or hide it (other modes). */
  show(on: boolean): void {
    // (a list open in it is put away with it, when another kind of tab takes over)
    if (!on && this.el.querySelector('.rb-fly-menu:not([hidden])')) closeRibbonFlyout();
    this.el.hidden = !on;
  }

  /** The look: two rows (Classic) or one (Simplified). */
  setLook(look: RibbonLook): void {
    this.el.classList.toggle('cr-classic', look === 'classic');
    this.el.classList.toggle('cr-simple', look === 'simple');
  }

  get look(): RibbonLook {
    return this.el.classList.contains('cr-simple') ? 'simple' : 'classic';
  }

  get tab(): string {
    return [...this.tabs].find(([, b]) => b.getAttribute('aria-selected') === 'true')?.[0] ?? 'home';
  }

  /** Open a tab (one there is no more, such as Arrange, opens Home). */
  pick(id: string): void {
    id = canvasTabFor(id);
    if (!this.tabs.has(id)) return;
    if (this.el.querySelector('.rb-fly-menu:not([hidden])')) closeRibbonFlyout();
    for (const [k, b] of this.tabs) b.setAttribute('aria-selected', String(k === id));
    for (const [k, p] of this.panels) p.hidden = k !== id;
    // (the Analysis box stays at the right end of whichever tab is open)
    this.panels.get(id)!.append(this.bodyEnd);
    this.el.dispatchEvent(new CustomEvent('cr-tab', { detail: id }));
  }
}
