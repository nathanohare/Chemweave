// What each toolbox of buttons comes with, and how many columns wide. Each list fills whole rows at
// its width, so no cell of a toolbox is left empty (tests/toolbox-defaults.test.ts holds that).
//
// Commands that only edit or set up one selected object (Edit Energy Diagram, Depth Shading
// Settings, Convert Diagram to Shapes and the like) are on that object's right-click menu and in
// the Side Panel, not in a toolbox.

/** Menu commands as toolbox items. */
const cmds = (list: string[]) => list.map((c) => `cmd:${c}`);

/** How many columns each toolbox comes with. */
export const BOX_COLS: Readonly<Record<string, number>> = { structure: 4, arrange: 6, templates: 7, custom: 5, schemes: 3, diagrams: 4, tables: 6, biopolymers: 4, perspective: 6 };

/** What the toolboxes come with ("cmd:", "tool:", "pal:"). The drawing tools, the templates and My Toolbox are made up in main.ts. */
export const BOX_DEFAULTS: Readonly<Record<string, readonly string[]>> = {
  structure: cmds(['clean-up', 'add-frame', 'fill-rings', 'name-to-structure', 'highlight', 'remove-highlight', 'aromatic-circles', 'stereo-labels', 'add-id-label', 'add-caption', 'attach-descriptors', 'number-compounds', 'contract-label', 'expand-label', 'expand-label-full', 'hapto-bond']),
  arrange: cmds(['align-left', 'align-hcenter', 'align-right', 'align-top', 'align-vcenter', 'align-bottom', 'distribute-h', 'distribute-v', 'arrange-row', 'arrange-column', 'arrange-grid', 'turn-3d', 'flip-h', 'flip-v', 'rotate-cw', 'rotate-ccw', 'shape-front', 'shape-back']),
  schemes: cmds(['smart-scheme', 'convert-smart-scheme', 'ungroup-smart-scheme', 'arrange-scheme', 'clean-up-cycle', 'check-balance', 'stoichiometry-table', 'map-atoms', 'animate-reaction']),
  diagrams: cmds(['energy-diagram', 'mo-diagram', 'd-orbital-splitting', 'torsion-chart', 'orbital', 'p-orbitals', 'ts-brackets', 'newman-projection']),
  tables: cmds(['insert-table', 'rgroup-table', 'stoichiometry-table', 'insert-chart', 'tlc-plate', 'gel']),
  biopolymers: ['cmd:sequence-to-structure', 'pal:tpl-amino', 'pal:tpl-sugars', 'pal:tpl-nucleic'],
  perspective: ['tool:perspective', 'tool:perspective-3d', ...cmds(['turn-3d', 'flatten-3d', 'model-3d', 'depth-shading', 'ring-chair', 'ring-chair-flip', 'crystal-structure']), 'pal:tpl-perspective', 'pal:tpl-conformers', 'pal:tpl-projections'],
};

/** Commands kept out of the toolboxes: each edits or sets up one selected object, and is offered where that object is. */
export const NOT_IN_TOOLBOXES: readonly string[] = ['edit-energy', 'edit-torsion', 'copy-torsion-data', 'edit-newman', 'unlink-newman', 'edit-diagram', 'diagram-to-shapes', 'edit-chart', 'edit-plate', 'depth-shading-settings', 'clean-up-options', 'scheme-settings'];
