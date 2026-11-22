// Why a drawing command cannot run with what is selected now (style guide S15, S85; retrospective
// audit G5-28 and its review, R03). One table holds each command's need and the reason it gives:
// the menus and ribbon grey the command with that reason in its tooltip, and running it anyway
// (a key, the command search) shows the same reason. The needs are only what the command cannot
// do without, cheap to ask on every change; a command that passes may still find something
// wrong with what is selected, and says so itself.

/** What is picked now, as the checks need it. main.ts gives getters, so only what is asked is worked out. */
export interface Picked {
  /** Anything selected at all. */
  readonly any: boolean;
  /** Selected things counted one by one (atoms, bonds, captions, arrows, shapes). */
  readonly count: number;
  readonly atoms: number;
  readonly bonds: number;
  readonly captions: number;
  readonly arrows: number;
  /** A structure to act on: one with a selected atom, or the one last drawn. */
  readonly structure: boolean;
  /** Selected curved (mechanism) arrows. */
  readonly curved: boolean;
  /** Selected shapes from Insert ▸ Shapes (not diagrams). */
  readonly geo: boolean;
  /** Selected pictures (any kind), and those that are plain pictures (not charts, equations or videos). */
  readonly pictures: number;
  readonly plainPictures: number;
  readonly brackets: boolean;
  readonly orbitals: boolean;
  /** Nothing in the drawing at all. */
  readonly empty: boolean;
  /** Atoms in the drawing. */
  readonly drawnAtoms: number;
  /** Reaction (or other) arrows in the drawing. */
  readonly drawnArrows: number;
}

/** The reasons, once each: the commands' own messages use these too. */
export const WHY = {
  cut: 'Select something to cut.',
  copy: 'There is nothing to copy.',
  copySmiles: 'There is no structure to copy.',
  noStep: 'No reaction step found: draw the starting materials, an arrow and the products.',
  goTo: 'Select something first, then Go to Selection brings it into view.',
  cropOne: 'Select one picture to crop.',
  picture: 'Select a picture first.',
  altText: 'Click a picture, chart or structure first, then Alt Text.',
  align: 'Select two or more structures, captions, arrows or shapes to line them up.',
  distribute: 'Select three or more structures, captions, arrows or shapes to space them evenly.',
  distributeFocal: 'Select three or more structures, captions, arrows or shapes to space their focal points evenly.',
  row: 'Select two or more structures or objects to put in a row (or they already are, evenly spaced).',
  column: 'Select two or more structures or objects to put in a column (or they already are, evenly spaced).',
  grid: 'Select two or more structures or objects to put in a grid.',
  flip: 'Select something to flip.',
  rotate: 'Select something to rotate.',
  rotate3d: 'Select a structure to rotate in 3-D.',
  flatten: 'Select a structure to flatten.',
  front: 'Select the objects or bonds to bring to the front.',
  forward: 'Select the objects or bonds to bring forward.',
  backward: 'Select the objects or bonds to send backward.',
  back: 'Select the objects or bonds to send to the back.',
  scale: 'Select something to scale.',
  frame: 'Select what to frame: structures, text, arrows or shapes.',
  group: 'Select two or more things to group: structures, text, arrows or shapes.',
  ungroup: 'Select a group to take apart.',
  link: 'Select the text to link (and the structure to link it to; else it goes to the nearest).',
  unlink: 'Select linked text, or a structure with text linked to it.',
  orient: 'Select two or more structures. Each is rotated to match the first one (top left), keeping its configuration.',
  join: 'Select two atoms, or two bonds, to join them into one.',
  highlight: 'Select the atoms and bonds to highlight.',
  unhighlight: 'Select the atoms and bonds to take the highlight off.',
  highlighted: 'Select highlighted atoms and bonds first.',
  fillRings: 'Select the rings to fill (or the whole structure) first.',
  expand: 'Select a label to expand: an abbreviation (OMe, Boc, CO2Et), a ligand (BINAP, dppf), or a ligand on a metal (PPh3, dppe, Cp*).',
  structure: 'Select a structure first.',
  name: 'Select a structure to name.',
  library: 'Select one or more structures in the drawing first.',
  stereoGroup: 'Select the stereocenters to group first.',
  repeat: 'Select the brackets first (draw them around the repeat unit with the bracket tool).',
  hapto: 'Select one metal and the atoms of the ring or π-bond it is bonded to (two or more).',
  splitHapto: 'Select a hapto (η) bond, or the metal it comes from.',
  smart: 'Select a reaction scheme (structures and the arrows between them) to make into a Smart Scheme.',
  ts: 'Select the transition state first (draw it with partial bonds: P over a bond).',
  pOrbitals: 'Select the atoms of the π system first (drag around them, or Shift-click each).',
  orbital: 'Select an orbital first.',
  curved: 'Select one or more curved (mechanism) arrows first.',
  curvedOne: 'Select one curved (mechanism) arrow first.',
  homolysis: 'Select the bond that breaks first (click it with the selection tool).',
  attach: 'Select curved arrows whose ends sit on atoms, bonds or lone pairs (or lone pairs and charges) first.',
  animate: 'Draw at least two structures (with a reaction arrow or an equivalency sign between them) to animate.',
  shape: 'Select a shape first (Insert ▸ Shapes).',
  autoAnimate: 'Select a scheme with reaction arrows first (or nothing, to build every scheme on the slide).',
} as const;
export type Why = keyof typeof WHY;

type Need = (p: Picked) => boolean;
const any: Need = (p) => p.any;
const two: Need = (p) => p.count >= 2;
const three: Need = (p) => p.count >= 3;
const atoms: Need = (p) => p.atoms > 0;
const atomsOrBonds: Need = (p) => p.atoms + p.bonds > 0;
const structure: Need = (p) => p.structure;
const curved: Need = (p) => p.curved;
const geo: Need = (p) => p.geo;
const something: Need = (p) => p.any || !p.empty;
// Arrange in a Row/Column/Grid works on everything when nothing is selected
const setOut: Need = (p) => (p.any ? p.count >= 2 : !p.empty);

/** Each command's need and its reason. */
export const NEEDS: Record<string, [Need, Why]> = {
  cut: [any, 'cut'],
  copy: [something, 'copy'],
  'copy-cdxml': [something, 'copy'],
  'copy-svg': [something, 'copy'],
  'copy-smiles': [(p) => p.drawnAtoms > 0, 'copySmiles'],
  'copy-reaction-smiles': [(p) => p.drawnArrows > 0, 'noStep'],
  'copy-rxn': [(p) => p.drawnArrows > 0, 'noStep'],
  'zoom-selection': [any, 'goTo'],
  crop: [(p) => p.pictures === 1, 'cropOne'],
  'picture-format': [(p) => p.plainPictures > 0, 'picture'],
  'alt-text': [any, 'altText'],
  'align-left': [two, 'align'], 'align-hcenter': [two, 'align'], 'align-right': [two, 'align'],
  'align-top': [two, 'align'], 'align-vcenter': [two, 'align'], 'align-bottom': [two, 'align'],
  'distribute-h': [three, 'distribute'], 'distribute-v': [three, 'distribute'],
  'distribute-h-gaps': [three, 'distribute'], 'distribute-v-gaps': [three, 'distribute'],
  'distribute-h-focal': [three, 'distributeFocal'], 'distribute-v-focal': [three, 'distributeFocal'],
  'arrange-row': [setOut, 'row'], 'arrange-column': [setOut, 'column'], 'arrange-grid': [setOut, 'grid'],
  'flip-h': [any, 'flip'], 'flip-v': [any, 'flip'], 'flip-h-keep': [any, 'flip'], 'flip-v-keep': [any, 'flip'],
  'rotate-cw': [any, 'rotate'], 'rotate-ccw': [any, 'rotate'], 'rotate-180': [any, 'rotate'], 'rotate-dialog': [any, 'rotate'],
  'turn-3d': [atoms, 'rotate3d'],
  'flatten-3d': [atoms, 'flatten'],
  'shape-front': [any, 'front'], 'shape-forward': [any, 'forward'], 'shape-backward': [any, 'backward'], 'shape-back': [any, 'back'],
  scale: [any, 'scale'],
  'add-frame': [any, 'frame'],
  group: [two, 'group'],
  ungroup: [any, 'ungroup'],
  'link-text': [(p) => p.captions > 0, 'link'],
  'unlink-text': [(p) => p.captions + p.atoms > 0, 'unlink'],
  'orient-like': [(p) => p.atoms >= 2, 'orient'],
  join: [(p) => p.atoms >= 2 || p.bonds >= 2, 'join'],
  highlight: [atomsOrBonds, 'highlight'],
  'remove-highlight': [atomsOrBonds, 'unhighlight'],
  'smooth-highlight': [atomsOrBonds, 'highlighted'], 'centre-highlight': [atomsOrBonds, 'highlighted'],
  'soft-highlight': [atomsOrBonds, 'highlighted'], 'outline-highlight': [atomsOrBonds, 'highlighted'],
  'shadow-highlight': [atomsOrBonds, 'highlighted'], 'glow-highlight': [atomsOrBonds, 'highlighted'],
  'fill-rings': [any, 'fillRings'],
  'expand-label': [any, 'expand'], 'expand-label-full': [any, 'expand'],
  'add-id-label': [structure, 'structure'], 'add-caption': [structure, 'structure'],
  'attach-descriptors': [structure, 'structure'], 'pubchem-lookup': [structure, 'structure'],
  'chiral-flag': [structure, 'structure'],
  'structure-to-name': [structure, 'name'],
  'add-to-compound-library': [structure, 'library'],
  'enhanced-stereo': [atoms, 'stereoGroup'],
  'repeat-group': [(p) => p.brackets, 'repeat'],
  'hapto-bond': [(p) => p.atoms >= 3, 'hapto'],
  'split-hapto': [atomsOrBonds, 'splitHapto'],
  'convert-smart-scheme': [any, 'smart'],
  'ts-brackets': [any, 'ts'],
  'p-orbitals': [atoms, 'pOrbitals'],
  'edit-orbital': [(p) => p.orbitals, 'orbital'],
  'clean-up-arrow': [curved, 'curved'], 'arrow-s-shape': [curved, 'curved'], 'arrow-single-curve': [curved, 'curved'],
  'arrow-shape-u': [curved, 'curved'], 'arrow-shape-loop': [curved, 'curved'], 'flip-arrow-bend': [curved, 'curved'],
  'arrow-reverse': [curved, 'curved'], 'arrow-smooth-path': [curved, 'curved'], 'arrow-simplify-path': [curved, 'curved'],
  'arrow-add-bend': [curved, 'curvedOne'],
  'homolysis-arrows': [(p) => p.bonds > 0, 'homolysis'],
  'attach-arrow': [any, 'attach'],
  'animate-reaction': [(p) => p.drawnAtoms >= 2, 'animate'],
  'shape-styles': [geo, 'shape'], 'shape-effects': [geo, 'shape'], 'shape-picture-fill': [geo, 'shape'],
  'auto-animate-steps': [(p) => p.drawnArrows > 0, 'autoAnimate'],
};

/** Why `cmd` cannot run with `p` picked: its reason, null when it can, undefined when it has no check here. */
export function whyNot(cmd: string, p: Picked): string | null | undefined {
  const need = NEEDS[cmd];
  if (!need) return undefined;
  return need[0](p) ? null : WHY[need[1]];
}
