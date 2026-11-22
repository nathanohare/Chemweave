// Settings ▸ Toolboxes and Ribbon's preview (retrospective audit G5-16): a small Canvas ribbon as
// Classic (two rows of small buttons under each group's big one) or Simplified (one row), and a
// few toolbox buttons with the chosen cells (none, grid lines, raised, or both). The icons are
// copies of the program's own, passed in by the caller. The tab and group names are the real
// Canvas ribbon's (its first three tabs, and Home's first two groups; review of F5, R10).

import { CANVAS_TABS } from './canvas-ribbon';

export type RibbonLook = 'classic' | 'simple';
export type ToolCells = 'off' | 'grid' | 'raised' | 'both';

const div = (cls: string, ...kids: Node[]) => { const d = document.createElement('div'); d.className = cls; d.append(...kids); return d; };

/** A copy of icon `i` of `icons` (cycling), or an empty square when there are none. */
function icon(icons: readonly Element[], i: number): Node {
  const src = icons.length ? icons[i % icons.length] : null;
  if (!src) return div('tbp-blank');
  const c = src.cloneNode(true) as Element;
  c.removeAttribute('id');
  c.setAttribute('aria-hidden', 'true');
  return c;
}

export function toolboxPreview(look: RibbonLook, cells: ToolCells, icons: { ribbon: readonly Element[]; tools: readonly Element[] }): HTMLElement {
  const box = div('tbp');
  // the ribbon: tab names, then two groups
  const tabs = div('tbp-tabs');
  for (const t of CANVAS_TABS.slice(0, 3).map((x) => x.title)) { const s = document.createElement('span'); s.textContent = t; tabs.append(s); }
  const panel = div(`tbp-panel tbp-${look}`);
  let n = 0;
  for (const name of CANVAS_TABS[0].groups.slice(0, 2).map((g) => g.name)) {
    const btn = () => div('tbp-btn', icon(icons.ribbon, n++));
    const group = look === 'classic'
      ? div('tbp-group', div('tbp-big', icon(icons.ribbon, n++)), div('tbp-rows', div('tbp-row', btn(), btn(), btn()), div('tbp-row', btn(), btn(), btn())))
      : div('tbp-group', div('tbp-row', btn(), btn(), btn(), btn()));
    const label = document.createElement('span');
    label.className = 'tbp-name';
    label.textContent = name;
    panel.append(div('tbp-gwrap', group, ...(look === 'classic' ? [label] : [])));
  }
  const ribbon = div('tbp-ribbon', tabs, panel);
  ribbon.setAttribute('role', 'img');
  ribbon.setAttribute('aria-label', look === 'classic' ? 'Classic ribbon: two rows of buttons with group names' : 'Simplified ribbon: one row of buttons');
  // the toolbox: two columns of four
  const tools = div(`tbp-tools tbp-cells-${cells}`);
  for (let i = 0; i < 8; i++) tools.append(div('tbp-tool', icon(icons.tools, i)));
  tools.setAttribute('role', 'img');
  tools.setAttribute('aria-label', { off: 'Toolbox buttons without cells', grid: 'Toolbox buttons with grid lines', raised: 'Raised toolbox buttons', both: 'Raised toolbox buttons with grid lines' }[cells]);
  const cap = (t: string) => { const c = document.createElement('div'); c.className = 'tbp-cap'; c.textContent = t; return c; };
  box.append(cap('Canvas ribbon'), ribbon, cap('Toolbox'), tools);
  return box;
}
