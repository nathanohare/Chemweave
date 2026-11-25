// The Style panel: shows how the selected arrows, shapes and captions look, and changes them;
// the stereo labels of selected stereocentres and double bonds; and a single selected atom or
// bond (label, charge, atom number; order and style).
// Anything the drawing tools set automatically can be changed here by hand.

import { addInfo, infoIcon, setInfo } from './info-tip';
import { Doc, Arrow, Shape, Caption, Atom, Bond, PICTURE_STYLES, turnsFreely, isDataFrame, type PictureLook, type StepRoles, type ArrowTextSide, type ArrowKind, type Pattern, type AttachSide, type Attachment, type DescriptorKey, type HighlightEnds, type HighlightFill, type HighlightLine, type HighlightShape, type HighlightSoftSide, type HighlightStyle } from '../model';
import { fullStyle, tidyStyle } from '../render/highlight';
import type { HighlightLookPreset } from './highlight-looks';

export { tidyStyle };
import { descriptorChoices } from './analysis-panel';
import { captionReading, speciesSummary } from '../chem/species';
import { COMMON_ADDUCTS } from '../chem/hrms';
import { DOT_DENSITY, PATTERN_CHOICES, PATTERNS, RING_FILL_COLOUR, patternSwatch, RING_PATTERN_COLOUR, patternSpacing, ringShadowSize, shadowLook } from '../render/fills';
import { arrowKind, drawnKind, type Role } from '../chem/reaction';
import { setStereoShown, setStereoText } from '../chem/stereo';
import { arialWidth } from '../text-metrics';
import { Selection } from '../editor/editor';
import { freeformPoints } from '../design/geo';
import { electronLook, fillElectrons, fillProblems, fromChoices, fromOf, fromValue, MO_ATOMS, MO_CUSTOM, MO_MOLECULES, MO_TWO_ATOMS, moCounts, moMolecule, moParts, moPeriod, moPlain, parseMarkup, moSides, setElectrons, setMolecule, setSides, sources, toRelative, withLevel, type MoLevel, type MoSpec } from '../design/mo';
import { D_GEOMETRIES, deltaMarkup, dGeometry, dReadout, ionD, lfseMarkup, resetDSplitLevels, setDSplit, spinMatters, splitLevels, type DGeometry, type DSplit } from '../design/dsplit';
import { ORBITAL_KIND_NAMES, ORBITAL_LOOK_NAMES, orbitalsAmong, readOrbital, type OrbitalKind, type OrbitalLook, type OrbitalSpec } from '../chem/orbitals';
import { isSmoothPath, reshapeFreeform } from '../design/freeform';
import { DEG, normDegrees, mul, type Vec } from '../geom';
import { isCircle, cropTo, isCurved, headBend, swapHalf, arrowEllipseFrame, ellipseArrow } from '../objects';
import { firstBend, shapeBez, shapeOf } from '../arrow-path';
import { GEOS, geoDef } from '../design/geo';
import { drawGeoIcon } from './design-panel';
import { nextNumber } from '../chem/sprouts';
import { ringFillsOn } from '../chem/ring-fill';
import { frameMembers } from '../editor/frames';
import { methylState, writeTerminalMethyls, type MethylStyle } from '../chem/hydrogens';
import type { TableData } from '../model';
import { canShowGuides, guidesOn, plainReactionArrow } from '../chem/arrow-text';
import { RIBBON_ICONS } from './ribbon-icons';
import { attachedAtoms } from '../editor/attached';
import { lookPatch } from '../editor/tied-look';
import { labelAlignment, labelAlignPatch, type LabelAlign } from '../chem/label-align';
import { labelAtoms, labelLookOf, setLabelFont, setLabelSize } from '../editor/label-font';
import { ringsThroughBond } from '../chem/aromatic';
import { clearFocal, focalKind } from '../chem/focal';
import { canMerge, deleteColumn, deleteRow, fitColumns, insertColumn, insertRow, mergeDown, mergeRight, rowSpanOf, setColumnAlign, setColumnWidth, setRowSpan, setSpan, spanOf, splitCell, type TablePart } from '../table';
import { SLIDE_TABLE_STYLES, lookOf, slideCellLook, slideTableStyle } from '../deck/table-styles';
import type { Measure } from '../text/layout';
import { colourButton } from './colour-picker';
import { centreEnd, haptoText, splitHapto } from '../chem/hapto';
import { straightenAt } from '../chem/chemgeom';
import type { EnergyData } from '../design/energy';
import { TLC_LOOKS, GEL_LOOKS, LOCK_SPOTS_INFO, type PlateData } from '../design/plates';
import { DIAGRAM_COLOURS, DIAGRAM_LAYOUTS, type DiagramData } from '../design/diagrams';
import { LIGAND_TYPES, countRows, electronPrefs, countSummary, countsDiffer, ligandText, roman, selectedComplex, signed, sup, typeKey, typeText, type MetalCount } from '../chem/electrons';
import { ECOUNT_RANGE } from '../chem/ecount-settings';
import type { ElectronCountSettings } from '../model';

/** What the table controls need from the editor. */
export interface TableHooks {
  /** The cell (or title or footnotes) last clicked or typed into. */
  part(): { id: number; part: TablePart } | null;
  setPart(p: { id: number; part: TablePart } | null): void;
  /** Change a table, keeping its size in step with its text. */
  update(id: number, t: TableData): void;
  /** Start typing into a part of a table. */
  edit(id: number, part: TablePart): void;
  measure: Measure;
}

/** What the Reaction controls need from the editor. */
export interface ReactionHooks {
  roles(arrowId: number): StepRoles | null;
  /** How many things other than arrows are selected. */
  others(): number;
  setRole(arrowId: number, role: Role | 'results' | 'none'): void;
  reset(arrowId: number): void;
  select(arrowId: number, role: Role): void;
  cleanUp(): void;
  arrange(): void;
  /** The text above and below the arrow and its Results line (the nearest line of each), as plain text, with how each lines up. */
  sideText(arrowId: number): (Record<ArrowTextSide, string> & { align: Record<ArrowTextSide, 'left' | 'center' | 'right'> }) | null;
  /** Set it: a new line of text if there is none, the nearest one changed, or removed when emptied. */
  setSideText(arrowId: number, side: ArrowTextSide, text: string): void;
  /** Line one side up this arrow's own way (null: the drawing style's). */
  setTextAlign(arrowId: number, side: ArrowTextSide, how: 'left' | 'center' | 'right' | null): void;
  /** Show or hide the arrows' dashed text guides (null: as usual). */
  setGuides(arrowIds: number[], on: boolean | null): void;
}

type Opt<T> = [T, string];

const HEADS: Opt<Arrow['headStyle']>[] = [['none', 'None'], ['full', 'Full'], ['halfLeft', 'Half, left side'], ['halfRight', 'Half, right side']];
/** A curved arrow's half head is a fishhook: it moves one electron. */
const CURVED_HEADS: Opt<Arrow['headStyle']>[] = [['none', 'None'], ['full', 'Full (electron pair)'], ['halfLeft', 'Fishhook, left side'], ['halfRight', 'Fishhook, right side']];
const KINDS: Opt<ArrowKind>[] = [['reaction', 'Reaction'], ['mechanism', 'Mechanism'], ['plain', 'Plain']];
const HEAD_TYPES: Opt<Arrow['headType']>[] = [['solid', 'Solid'], ['hollow', 'Hollow'], ['angle', 'Open']];
const NO_GOS: Opt<'none' | 'cross' | 'hash'>[] = [['none', 'None'], ['cross', 'Cross'], ['hash', 'Hash']];
const LINES: Opt<Arrow['line']>[] = [['solid', 'Solid'], ['dashed', 'Dashed'], ['bold', 'Bold'], ['wavy', 'Wavy']];
const SHAFTS: Opt<string>[] = [['one', 'One line'], ['equilibrium', 'Equilibrium (two half arrows)'], ['retro', 'Retrosynthetic (double line)']];
const BRACKETS: Opt<NonNullable<Shape['bracket']>>[] = [['square', 'Square [ ]'], ['round', 'Round ( )'], ['curly', 'Curly { }']];
const VALIGN: Opt<NonNullable<Shape['textValign']>>[] = [['top', 'Top'], ['middle', 'Middle'], ['bottom', 'Bottom']];
const HL_SHAPES: Opt<HighlightShape>[] = [['round', 'Round (discs and bands)'], ['straight', 'Straight (sharp corners, discs around labels)']];
const HL_ENDS: Opt<HighlightEnds>[] = [['round', 'Round'], ['square', 'Square'], ['pointed', 'Pointed']];
const HL_FILLS: Opt<HighlightFill>[] = [['solid', 'One color'], ['linear', 'Gradient across'], ['edge', 'Gradient (bonds to edge)'], ['none', 'None (outline or texture only)']];
const HL_LINES: Opt<HighlightLine>[] = [['none', 'None'], ['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted']];
const HL_SOFT_SIDES: Opt<HighlightSoftSide>[] = [['outer', 'At the outer edge'], ['inner', 'Inside (along the middle)'], ['both', 'Both (half each)']];
const SHADOW_DIRS: Opt<string>[] = [['45', 'Down and right'], ['90', 'Down'], ['135', 'Down and left'], ['0', 'Right'], ['180', 'Left'], ['-45', 'Up and right'], ['-90', 'Up'], ['-135', 'Up and left']];
/** The Style panel's folding groups that are open. */
const OPEN_GROUPS = new Set<string>();
const SIDES: Opt<AttachSide>[] = [['below', 'Below'], ['above', 'Above'], ['left', 'Left'], ['right', 'Right']];
const READ_AS: Opt<'auto' | 'on' | 'off'>[] = [['auto', 'Automatically'], ['on', 'Chemical'], ['off', 'Plain text']];
const JUSTIFY: Opt<Caption['justify']>[] = [['left', 'Left'], ['center', 'Center'], ['right', 'Right']];
const TIED_KINDS: Opt<'label' | 'caption'>[] = [['label', 'ID label'], ['caption', 'Caption']];
const TABLE_LINES: Opt<TableData['lines']>[] = [['acs', 'ACS style (rules above and below the headings, and at the end)'], ['grid', 'Every cell boxed'], ['none', 'None']];

/** How an atom's label lines up on the atom (ChemDraw's label alignment; Above and Below are one Center choice). */
const LABEL_ALIGNS: Opt<LabelAlign>[] = [['auto', 'Auto (away from the bonds)'], ['left', 'Left (OMe)'], ['center', 'Center (stacked on the atom)'], ['right', 'Right (MeO)']];

type Fill = 'none' | 'solid' | 'faded' | 'shaded' | 'gradient';
const FILLS: Opt<Fill>[] = [['none', 'None'], ['solid', 'Solid color'], ['faded', 'Faded (light tint)'], ['shaded', 'Shaded (light to dark)'], ['gradient', 'Gradient (two colors)']];
const GRAD_DIRS: Opt<string>[] = [['90', 'Top to bottom'], ['270', 'Bottom to top'], ['0', 'Left to right'], ['180', 'Right to left'], ['45', 'Diagonal, top left to bottom right'], ['-45', 'Diagonal, bottom left to top right'], ['radial', 'Out from the middle']];
const PATTERN_OPTS: Opt<string>[] = [['none', 'None'], ...PATTERNS];
/** The patterns shown as swatches (one Dots: its density is a setting of its own). */
const PATTERN_PICKS: Opt<string>[] = [['none', 'None'], ...PATTERN_CHOICES];

const BOND_ORDERS: Opt<string>[] = [['1', 'Single'], ['2', 'Double'], ['3', 'Triple'], ['1.5', 'Aromatic'], ['4', 'Quadruple'], ['0.5', 'Partial (transition state)']];
const BOND_STYLES: Opt<Bond['display']>[] = [['solid', 'Plain'], ['wedge', 'Wedge'], ['hashWedge', 'Hashed wedge'], ['hollowWedge', 'Hollow wedge'], ['wavyWedge', 'Wavy wedge'], ['hash', 'Hashed'], ['bold', 'Bold'], ['dash', 'Dashed'], ['wavy', 'Wavy'], ['dative', 'Dative (arrow to the acceptor)'], ['hydrogen', 'Hydrogen bond (dotted, from the H)'], ['ionic', 'Ionic (dashed, from the + end)']];
/** A double bond's styles: wavy is the crossed (either E or Z) double bond. */
const DOUBLE_STYLES: Opt<Bond['display']>[] = [['solid', 'Plain'], ['bold', 'Bold'], ['dash', 'Dashed'], ['wavy', 'Crossed (E or Z)'], ['wedge', 'Wedge'], ['hashWedge', 'Hashed wedge']];
const SECOND_LINES: Opt<string>[] = [['', 'Plain'], ['dash', 'Dashed'], ['bold', 'Bold'], ['hash', 'Hashed']];
const DOUBLE_POS: Opt<Bond['dpos']>[] = [['auto', 'Automatic'], ['left', 'Left'], ['center', 'Centered'], ['right', 'Right']];

const round = (x: number, k = 100) => Math.round(x * k) / k;

export class StylePanel {
  private key = '';

  /** Turns typed label text into a label (the editor's rules: "OH" is an O with its H, and so on). */
  applyLabel: (atomId: number, text: string) => void = () => {};
  /** Crop a picture with the mouse (its handles cut the edges off), or stop. */
  cropWithMouse: (shapeId: number) => void = () => {};
  /** Frames (set up by the app): add one round the selection, or fit a box round what is inside it. */
  frames: { add(): void; fit(shapeId: number): void } | null = null;
  /** Draws a Newman or sawhorse projection again with part of its look changed, and opens its window. */
  newman: { look(shapeId: number, patch: Partial<NonNullable<Shape['newman']>['look']>): void; edit(shapeId: number): void } | null = null;
  /** Opens a torsion chart's window. */
  torsion: { edit(shapeId: number): void } | null = null;
  /** A highlight colour was chosen (the app remembers it for Chemistry > Highlight and Fill > Highlight). */
  highlightUsed: (colour: string) => void = () => {};
  /** The look last chosen for highlights (new highlights take it). */
  highlightStyleUsed: (style: HighlightStyle) => void = () => {};
  /** Highlight looks (set up by the app): the ready-made and saved ones, giving the selection one, saving one. */
  highlightLooks: { list(): HighlightLookPreset[]; apply(look: HighlightLookPreset): void; save(): void } = { list: () => [], apply: () => {}, save: () => {} };
  /** Fill the rings in the selection (set up by the app). */
  ringFill: (() => void) | null = null;
  /** Click the spot on the drawing to make a structure's focal point (set up by the app). */
  focalPick: (() => void) | null = null;
  /** Picture Format… for the selected pictures (set up by the app). */
  formatPicture: () => void = () => {};
  /** Make a picture's white background see-through (set up by the app). */
  removeWhite: (shapeIds: number[]) => void = () => {};
  /** A picture's width and height change together. */
  private keepProportions = true;
  /** Table commands (set up by the app). */
  tables: TableHooks | null = null;
  /** Reaction step commands (set up by the app). */
  reaction: ReactionHooks | null = null;
  /** Energy diagrams (set up by the app): open the window, or redraw with some settings changed. */
  energy: { edit(shapeId: number): void; restyle(shapeId: number, patch: Partial<EnergyData>): void } | null = null;
  plate: {
    edit(shapeId: number): void; restyle(shapeId: number, patch: Partial<PlateData>): void;
    /** An MO diagram's level last pressed on the page (its place in the levels), to show its settings. */
    moLevel?(shapeId: number): number | null;
    moRename?(shapeId: number, level: number): void;
    moDelete?(shapeId: number, level: number): void;
    /** Fit Width: make the MO diagram just wide enough. */
    moFit?(shapeId: number): void;
  } | null = null;
  /** SmartArt-style diagrams: the window with their text, a change of layout or look, and Convert to Shapes. */
  diagram: { edit(shapeId: number): void; restyle(shapeId: number, patch: Partial<DiagramData>): void; ungroup(shapeId: number): void } | null = null;
  /** A Smart Scheme's layouts (those it can't take left out, the one it has marked) and how to change it. */
  smart: { layouts(shapeId: number): { id: string; name: string; on: boolean }[]; arrange(shapeId: number, layout: string): void; ungroup(shapeId: number): void } | null = null;
  /** Orbitals drawn here (set up by the app): the Edit Orbital window, or the selected ones drawn again with some settings changed. */
  orbital: { edit(): void; restyle(shapeIds: number[], patch: Partial<OrbitalSpec>): void } | null = null;
  /** Tie captions to the structure nearest each (Tie to Structure). */
  tie: ((captionIds: number[]) => void) | null = null;
  /** Electron Count's Insert as Table (set up by the app): the count's rows as a table beside the metal's structure. */
  electronTable: ((metal: number, rows: string[][]) => void) | null = null;
  /** Brackets drawn as a pair: whether the other halves can be selected or deselected now, and doing it. */
  bracketPartner: { state(): 'select' | 'deselect' | null; toggle(): void } | null = null;

  /** Open a chart's data and settings (Edit chart…). */
  onEditChart: (id: number) => void = () => {};
  /** Playback… for a video or sound. */
  onEditMedia: (id: number) => void = () => {};
  /** Open an equation in the equation window (Edit equation…), and colour equations. */
  onEditEquation: (id: number) => void = () => {};
  onEquationColour: (ids: number[], colour: string) => void = () => {};
  /** Pictures and shapes turn to any angle here (Slides and Design), so the panel offers a Rotation box. */
  turnable: () => boolean = () => false;

  /** The first heading of this redraw has gone into the section's title. */
  private titled = false;

  constructor(private section: HTMLElement, private body: HTMLElement, private doc: Doc, private sel: () => Selection, private changed: () => void) {}

  /**
   * A selection box or Ctrl+A that takes in a whole MO diagram selects its frame and every line and
   * caption in it. That is the diagram, not a pile of shapes: the selection is then the frame alone,
   * so its settings show. Anything else selected too (not part of the diagram) leaves it as it is.
   */
  private wholeMoDiagram(s: Selection): Selection {
    if (s.shapes.size < 2 && !s.captions.size) return s;
    const frames = [...s.shapes].map((id) => this.doc.shapes.get(id)).filter((x): x is Shape => !!x && x.plate?.kind === 'mo' && !!x.frame);
    if (frames.length !== 1) return s;
    const f = frames[0], m = frameMembers(this.doc, f.frame!);
    if (s.atoms.size || s.bonds.size || s.arrows.size) return s;
    for (const id of s.shapes) if (id !== f.id && !m.shapes.has(id)) return s;
    for (const id of s.captions) if (!m.captions.has(id)) return s;
    return { ...s, shapes: new Set([f.id]), captions: new Set() };
  }

  /** Redraw the panel for the current selection, keeping the focus on the same control. */
  refresh(force = false): void {
    if (force) this.key = '';
    const s = this.wholeMoDiagram(this.sel());
    const tp = this.tables?.part();
    const key = `${electronPrefs.method}|${this.doc.version}|${this.doc.stereo?.version}|${tp ? JSON.stringify(tp) : ''}|${[...s.arrows].join(',')}|${[...s.shapes].join(',')}|${[...s.captions].join(',')}|${[...s.atoms].join(',')}|${[...s.bonds].join(',')}|${[...s.shapes].map((id) => this.plate?.moLevel?.(id) ?? '').join(',')}`;
    if (key === this.key) return;
    this.key = key;
    const focused = this.body.contains(document.activeElement) ? document.activeElement!.closest('.style-row')?.textContent : null;
    this.body.textContent = '';
    this.titled = false;
    for (const i of this.section.querySelectorAll(':scope > h2 > .style-help')) i.remove();
    this.subtitle('');
    const arrows = [...s.arrows].map((id) => this.doc.arrows.get(id)).filter((x): x is Arrow => !!x);
    const all = [...s.shapes].map((id) => this.doc.shapes.get(id)).filter((x): x is Shape => !!x && !x.picture);
    const shapes = all.filter((x) => x.kind !== 'picture' && x.kind !== 'table' && x.kind !== 'ring'), pictures = all.filter((x) => x.kind === 'picture');
    // ring fills get their own section, with those on the selected structures and on the
    // structures inside selected frames, so they can be changed without picking them out
    const under = new Set(s.atoms);
    for (const x of all) if (x.frame) for (const id of frameMembers(this.doc, x.frame).atoms) under.add(id);
    const ringIds = new Set([...all.filter((x) => x.kind === 'ring').map((x) => x.id), ...ringFillsOn(this.doc, under)]);
    const rings = [...ringIds].map((id) => this.doc.shapes.get(id)).filter((x): x is Shape => !!x);
    const tables = all.filter((x) => x.kind === 'table' && x.table);
    const caps = [...s.captions].map((id) => this.doc.captions.get(id)).filter((x): x is Caption => !!x);
    // stereocentres and E/Z double bonds among the selected atoms and bonds
    const info = this.doc.stereo;
    const centres = [...s.atoms].map((id) => this.doc.atoms.get(id)).filter((a): a is Atom => !!a && (!!info?.atom(a.id) || !!info?.undecided?.('a', a.id) || !!a.stereoLabel));
    const dbls = [...s.bonds].map((id) => this.doc.bonds.get(id)).filter((b): b is Bond => !!b && (!!info?.bond(b.id) || !!info?.undecided?.('b', b.id) || !!b.stereoLabel));
    // one atom or one bond on its own (as after / or ? over it)
    const atom = s.atoms.size === 1 && !s.bonds.size ? this.doc.atoms.get([...s.atoms][0]) : undefined;
    const bond = s.bonds.size === 1 && s.atoms.size <= 2 ? this.doc.bonds.get([...s.bonds][0]) : undefined;
    const selAtoms = [...s.atoms].map((id) => this.doc.atoms.get(id)).filter((a): a is Atom => !!a);
    const selBonds = [...s.bonds].map((id) => this.doc.bonds.get(id)).filter((b): b is Bond => !!b);
    const several = !atom && !bond && selAtoms.length + selBonds.length > 1;
    // the section stays in its place with nothing selected, so Warnings and Analysis don't jump
    const empty = !arrows.length && !shapes.length && !rings.length && !pictures.length && !tables.length && !caps.length && !centres.length && !dbls.length && !atom && !bond && !several;
    this.section.hidden = false;
    this.section.classList.toggle('empty', empty);
    if (empty) {
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = 'Select something to change how it looks.';
      this.body.append(p);
    }
    if (atom) this.atomControls(atom);
    if (bond) this.bondControls(bond);
    if (several) this.structureControls(selAtoms, selBonds);
    if (arrows.length) this.arrowControls(arrows);
    // an energy diagram is a frame drawn from its numbers: its own section, not a rectangle's
    const diagram = all.length === 1 && isDataFrame(all[0]) ? all[0] : undefined;
    if (diagram?.energy) this.energyControls(diagram);
    else if (diagram?.plate) this.plateControls(diagram);
    else if (diagram?.newman) this.newmanControls(diagram);
    else if (diagram?.diagram) this.diagramControls(diagram);
    else if (diagram?.torsion) this.torsionControls(diagram);
    else if (diagram?.smart) {
      // how its list works is behind the "i" by the list's title; here, its layout
      this.heading('Smart Scheme');
      const id = diagram.id;
      const lays = this.smart?.layouts(id) ?? [];
      if (lays.length) this.select('Layout', lays.map((l) => [l.id, l.name] as [string, string]), lays.find((l) => l.on)?.id ?? lays[0].id, (v) => this.smart?.arrange(id, v));
      const row = document.createElement('div');
      row.className = 'style-buttons';
      const u = document.createElement('button');
      u.type = 'button';
      u.textContent = 'Ungroup';
      u.title = 'Make it ordinary structures, text and arrows again';
      u.addEventListener('click', () => this.smart?.ungroup(id));
      row.append(u);
      this.body.append(row);
    }
    else if (shapes.length && this.orbital && shapes.every((x) => x.orb)) this.orbitalControls(shapes);
    else if (shapes.length) this.shapeControls(shapes);
    if (rings.length) this.shapeControls(rings, rings.length > 1 ? `${rings.length} ring fills` : 'Ring fill');
    if (pictures.length) this.pictureControls(pictures);
    if (tables.length) this.tableControls(tables[0]);
    if (caps.length) this.captionControls(caps);
    if (centres.length || dbls.length) this.stereoControls(centres, dbls);
    if (atom || several) {
      const c = selectedComplex(this.doc, s.atoms);
      if (c) this.electronControls(c);
    }
    const boxes = shapes.filter((x) => x.kind === 'rect' || x.kind === 'oval' || x.kind === 'geo');
    if (diagram) { /* the diagram keeps its own frame fitted */ }
    else if (boxes.length === 1 && all.length === 1 && !caps.length && !arrows.length && !s.atoms.size) this.frameControls(boxes[0]);
    else if (!empty && this.frames) {
      const row = document.createElement('div');
      row.className = 'style-buttons';
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = 'Add Frame';
      b.title = 'Draw a box around the selection that grows and moves with it (Chemistry ▸ Labels and Numbers ▸ Add Frame)';
      b.addEventListener('click', () => this.frames?.add());
      row.append(b);
      this.body.append(row);
    }
    if (focused) [...this.body.querySelectorAll<HTMLElement>('.style-row')].find((r) => r.textContent === focused)?.querySelector<HTMLElement>('select, input, textarea')?.focus();
  }

  // ------------------------------------------------------------------ arrows

  private arrowControls(arrows: Arrow[]): void {
    const r = arrows[0];
    const lw = this.doc.style.lineWidth;
    const set = (label: string, patch: (a: Arrow) => Partial<Arrow>) => this.edit(label, () => { for (const a of arrows) this.doc.updateArrow(a.id, patch(a)); });
    this.heading(arrows.length > 1 ? `${arrows.length} arrows` : 'Arrow');
    // what the arrow is for: a reaction step (its starting materials and products worked out), a
    // mechanism's electron movement, or plain (resonance, retrosynthetic: lines up only)
    const curved = arrows.some((a) => isCurved(a) && !a.step);
    const kinds = curved ? KINDS.filter(([k]) => k !== 'reaction') : KINDS;
    const kind = arrowKind(r);
    this.select('Type', kinds, kinds.some(([k]) => k === kind) ? kind : kinds[0][0], (v) => set('Arrow Type', (a) => ({ kind: v === drawnKind(a) ? undefined : v })));
    const shafts = r.equilibrium ? 'equilibrium' : r.shaftSpacing ? 'retro' : 'one';
    this.select('Shafts', SHAFTS, shafts, (v) => set('Arrow shafts', (a) => {
      const w = a.lineWidth ?? lw;
      if (v === 'equilibrium') return { equilibrium: true, shaftSpacing: undefined, headStyle: 'halfLeft', tailStyle: 'halfLeft', headType: 'solid', sweep: 0, bez: undefined };
      if (v === 'retro') return { equilibrium: false, shaftSpacing: w * 6, headStyle: 'full', tailStyle: 'none', headType: 'angle', headLength: w * 6, headWidth: w * 1.5, sweep: 0, bez: undefined };
      return { equilibrium: false, shaftSpacing: undefined, ...(a.equilibrium ? { headStyle: 'full', tailStyle: 'none' } : {}), ...(a.shaftSpacing ? { headType: 'solid', headLength: w * 10, headWidth: w * 2.5 } : {}) };
    }));
    if (!r.equilibrium) {
      const heads = isCurved(r) ? CURVED_HEADS : HEADS;
      this.select('Head', heads, r.headStyle, (v) => set('Arrowhead', () => ({ headStyle: v })));
      this.select('Tail', heads, r.tailStyle, (v) => set('Arrow tail', () => ({ tailStyle: v })));
    }
    this.select('Head shape', HEAD_TYPES, r.headType, (v) => set('Arrowhead shape', () => ({ headType: v })));
    this.select('Line', LINES, r.line, (v) => set('Arrow line', () => ({ line: v })));
    this.select('No-go', NO_GOS, r.noGo ? r.noGoKind ?? 'cross' : 'none', (v) => set('No-go arrow', () => ({ noGo: v !== 'none', noGoKind: v === 'hash' ? 'hash' : undefined })));
    if (r.headType === 'solid' && (r.headStyle !== 'none' || r.tailStyle !== 'none')) {
      this.number('Head center (pt)', round(r.headLength * (r.headCenter ?? 0.75), 2), 0.25, 0, 100,
        (v) => set('Arrowhead center', (a) => ({ headCenter: a.headLength > 0 ? Math.max(0, Math.min(1, v / a.headLength)) : undefined })),
        'Depth of the arrowhead\'s notch, measured from the tip. The full head length gives a plain triangle; less gives a swept-back head.');
    }
    if (!r.equilibrium && !r.shaftSpacing) {
      this.check('Square bends (elbow)', !!r.elbow, (v) => set('Elbow connector', () => ({ elbow: v || undefined, sweep: 0, bez: undefined })));
    }
    if (r.from || r.to) {
      const loose = (_a: Arrow) => ({ from: undefined, to: undefined } as Partial<Arrow>);
      this.note('Stuck to shapes: it follows them when they move.');
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = 'Detach from Shapes';
      b.title = 'Let the ends stay where they are when the shapes move';
      b.addEventListener('click', () => set('Detach Connector', loose));
      this.body.append(b);
    }
    if (r.pin) {
      this.note('Stuck to the structure: it follows it when it moves.');
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = 'Detach from Structure';
      b.title = 'Let the ends stay where they are when the structure moves';
      b.addEventListener('click', () => set('Detach', () => ({ pin: undefined })));
      this.body.append(b);
    }
    if (!r.equilibrium && !r.shaftSpacing && !r.elbow && isCurved(r) && !(r.ellipse && arrowEllipseFrame(r))) {
      // a ready-made shape between the same two ends (or the arrow's own path, drawn or built up bend by bend)
      const now = shapeOf(r);
      const opts: Opt<string>[] = [['single', 'Single curve'], ['s', 'S (two bends)'], ['u', 'U-turn'], ['loop', 'Loop']];
      if (!now) opts.push(['path', `Own path (${(r.bez!.length + 1) / 3} curves)`]);
      this.select('Shape', opts, now ?? 'path', (v) => {
        if (v === 'path') return;
        set(v === 'single' ? 'Single-curve arrow' : v === 's' ? 'S-shaped arrow' : v === 'u' ? 'U-turn arrow' : 'Loop arrow', (a) => {
          const side = firstBend(a);
          const patch: Partial<Arrow> = v === 'single' ? { bez: undefined, sweep: -side * 120 * DEG } : { sweep: 0, bez: shapeBez(v as 's' | 'u' | 'loop', side) };
          if (headBend(a) !== headBend({ ...a, ...patch })) Object.assign(patch, { headStyle: swapHalf(a.headStyle), tailStyle: swapHalf(a.tailStyle) });
          return patch;
        });
      });
    }
    const ef = arrowEllipseFrame(r);
    if (ef) {
      const ratio = (f: { u: Vec; v: Vec }) => Math.hypot(f.u.x, f.u.y) / Math.max(Math.hypot(f.v.x, f.v.y), 1e-6);
      this.number('Width/Height (%)', Math.round(ratio(ef) * 100), 5, 10, 1000, (v) => set('Reshape arc', (a) => {
        const f = arrowEllipseFrame(a);
        if (!f || !(v > 0)) return {};
        return ellipseArrow(f.c, mul(f.u, v / 100 / ratio(f)), f.v, f.t0, f.sweep);
      }), 'How wide the curve’s ellipse is for its height: 100 is a circle. Drag the diamonds on the selected arrow to reshape it.');
    }
    if (!r.equilibrium && !r.shaftSpacing && !r.elbow && !r.bez?.length) {
      this.number('Curve (°)', round(r.sweep / DEG, 1), 5, -330, 330, (v) => set('Bend arrow', () => ({ sweep: v * DEG })),
        'Positive bends to the left of the arrow’s direction, negative to the right; 0 is straight.');
    }
    this.number('Head length (pt)', round(r.headLength), 0.5, 0, 100, (v) => set('Arrowhead size', () => ({ headLength: v })));
    this.number('Head width (pt)', round(r.headWidth), 0.25, 0, 100, (v) => set('Arrowhead size', () => ({ headWidth: v })));
    this.number('Line width (pt)', round(r.lineWidth ?? lw), 0.1, 0.1, 20, (v) => set('Arrow line width', () => ({ lineWidth: Math.abs(v - lw) < 1e-9 ? undefined : v })));
    this.color('Color', r.color, (v) => set('Arrow color', () => ({ color: v })));
    // the dashed boxes for typing text above and below: shown on plain reaction arrows, and on any other straight arrow when asked
    if (this.reaction && arrows.every(canShowGuides)) {
      this.check('Show text guides', arrows.every(guidesOn), (v) => this.reaction!.setGuides(arrows.map((a) => a.id), v === arrows.every(plainReactionArrow) ? null : v),
        'The dashed boxes above and below the arrow for typing reagents, conditions and the Results line. Plain reaction arrows show them; turn them on here for any other straight arrow.');
    }
    if (arrows.length === 1) this.reactionControls(r);
  }

  /** A reaction arrow's step: what its starting materials, products and conditions are, and changing them. */
  private reactionControls(r: Arrow): void {
    const hooks = this.reaction;
    const roles = hooks?.roles(r.id);
    if (!hooks || !roles) return;
    this.heading('Reaction');
    // reagents and conditions typed straight in (the "+" boxes on the drawing do the same)
    const sides = hooks.sideText(r.id);
    if (sides) {
      const fields: [ArrowTextSide, string, string][] = [['above', 'Above arrow', 'Reagents'], ['below', 'Below arrow', 'Solvent, temperature, time'], ['results', 'Results', 'Yield, ee, dr']];
      for (const [side, label, hint] of fields) {
        const ta = document.createElement('textarea');
        ta.rows = Math.min(4, Math.max(1, sides[side].split('\n').length));
        ta.value = sides[side];
        ta.placeholder = hint;
        ta.className = 'style-arrow-text';
        const set = () => { if (ta.value !== sides[side]) hooks.setSideText(r.id, side, ta.value); };
        ta.addEventListener('change', set);
        ta.addEventListener('keydown', (e) => {
          e.stopPropagation();
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ta.blur(); }
        });
        ta.addEventListener('input', () => { ta.rows = Math.min(4, Math.max(1, ta.value.split('\n').length)); });
        // how its lines line up, beside it: this arrow's own choice; the pressed button again goes back to the drawing style's
        const own = r.textLook?.align?.[side];
        const seg = document.createElement('div');
        seg.className = 'seg seg-align';
        seg.setAttribute('role', 'radiogroup');
        seg.setAttribute('aria-label', `${label}: alignment`);
        for (const how of ['left', 'center', 'right'] as const) {
          const b = document.createElement('button');
          b.type = 'button';
          b.innerHTML = RIBBON_ICONS[`doc-align-${how}`] ?? how[0].toUpperCase();
          const name = how === 'left' ? 'Align Left' : how === 'center' ? 'Center' : 'Align Right';
          b.title = own === how ? `${name} (this arrow's own; click to use the drawing style's)` : name;
          b.setAttribute('role', 'radio');
          b.setAttribute('aria-label', name);
          b.setAttribute('aria-checked', String(sides.align[side] === how));
          if (own === how) b.classList.add('own');
          b.addEventListener('click', () => hooks.setTextAlign(r.id, side, own === how ? null : how));
          seg.append(b);
        }
        const box = document.createElement('div');
        box.className = 'style-arrow-field';
        box.append(ta, seg);
        const tip = side === 'results'
          ? 'The line under the text below the arrow, for yield, ee or dr. It has its own font, size, alignment and gap in Drawing Style.'
          : `Text ${side} the arrow.`;
        this.row(label, box, `${tip} Enter applies; Shift+Enter adds a line. Formulas are subscripted automatically (H2O, Pd(PPh3)4); select the text in the drawing for other formatting. A numbered list of steps lines up on the left unless you choose an alignment.`);
      }
    }
    const names: [Role, string, string][] = [
      ['reactants', 'Starting materials', 'starting material'], ['products', 'Products', 'product'],
      ['above', 'Above the arrow', 'thing'], ['below', 'Below the arrow', 'thing'],
    ];
    const list = document.createElement('div');
    list.className = 'style-roles';
    for (const [k, label] of names) {
      const n = roles[k].length;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `role-${k}`;
      b.innerHTML = `<span class="role-dot"></span>${label}<span class="muted">${n || 'none'}</span>`;
      b.title = n ? `Select the ${label.toLowerCase()}` : `Nothing is ${label.toLowerCase()}`;
      b.disabled = !n;
      b.addEventListener('click', () => hooks.select(r.id, k));
      list.append(b);
    }
    this.body.appendChild(list);
    this.note(r.step?.manual ? 'Chosen by hand.' : r.step ? 'Kept with the arrow (from the file, or when it was last tidied).' : 'Determined from object positions.');
    if (hooks.others()) {
      const opts: Opt<string>[] = [['', 'Choose…'], ['reactants', 'Starting materials'], ['products', 'Products'], ['above', 'Above the arrow'], ['below', 'Below the arrow'], ['results', 'Results'], ['none', 'Not part of this step']];
      this.select('Set Selection As', opts, '', (v) => { if (v) hooks.setRole(r.id, v as Role | 'results' | 'none'); },);
    } else this.help('To change a role by hand, select the arrow and the things with Shift, then choose what they are here.');
    const buttons = document.createElement('div');
    buttons.className = 'style-buttons';
    const button = (text: string, title: string, on: () => void) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = text;
      btn.title = title;
      btn.addEventListener('click', on);
      buttons.append(btn);
    };
    button('Clean Up Reaction', 'Space this step evenly: starting materials and products in line with the arrow, conditions centered on it (Ctrl+Shift+R)', () => hooks.cleanUp());
    button('Arrange…', 'Lay the scheme out as a line, rows, a snake, down the page, a catalytic cycle or a branching tree', () => hooks.arrange());
    if (r.step) button('Reset to Automatic', 'Forget the kept roles and calculate them from where things sit', () => hooks.reset(r.id));
    this.body.appendChild(buttons);
  }

  // ------------------------------------------------------------------ shapes

  /** Orbitals drawn here: their type, phases, angle and size, drawn again as they change; then their outline and fill. */
  private orbitalControls(shapes: Shape[]): void {
    const list = orbitalsAmong(this.doc, shapes.map((x) => x.id));
    const first = list.length ? readOrbital(list[0]) : null;
    if (!first) { this.shapeControls(shapes); return; }
    const spec = first.spec;
    const L = this.doc.style.bondLength;
    this.heading(list.length > 1 ? `${list.length} orbitals` : 'Orbital');
    const set = (patch: Partial<OrbitalSpec>) => { this.key = ''; this.orbital?.restyle(shapes.map((x) => x.id), patch); };
    this.select('Orbital', ORBITAL_KIND_NAMES.map((k): Opt<OrbitalKind> => [k.value, k.label]), spec.kind, (v) => set({ kind: v }));
    this.select('Phases', ORBITAL_LOOK_NAMES.map((k): Opt<OrbitalLook> => [k.value, k.label]), spec.look, (v) => set({ look: v }));
    if (spec.kind !== 's') this.number('Angle (°)', round(spec.angle, 10), 1, -360, 360, (v) => set({ angle: ((v % 360) + 360) % 360 }), 'Which way it points: degrees clockwise from straight up');
    this.number('Lobe length', round(spec.size / L, 100), 0.1, 0.2, 5, (v) => set({ size: v * L }), 'In bond lengths');
    if (spec.look !== 'outline') this.check('Swap phases', !!spec.flip, (v) => set({ flip: v }));
    this.subheading('Outline and fill');
    this.shapeControls(shapes, null);
  }

  private shapeControls(shapes: Shape[], title?: string | null): void {
    const s = shapes[0];
    const lw = this.doc.style.lineWidth;
    const set = (label: string, ok: (x: Shape) => boolean, patch: (x: Shape) => Partial<Shape>) =>
      this.edit(label, () => { for (const x of shapes) if (ok(x)) this.doc.updateShape(x.id, patch(x)); });
    const any = (f: (x: Shape) => boolean) => shapes.find(f);
    const names: Record<Shape['kind'], string> = { line: 'Line', rect: 'Rectangle', oval: 'Oval', symbol: 'Symbol', bracket: 'Bracket', picture: 'Picture', table: 'Table', geo: 'Shape', ring: 'Ring fill' };
    if (title !== null) this.heading(title ?? (shapes.length > 1 ? `${shapes.length} shapes` : isCircle(s) ? 'Circle' : s.kind === 'geo' ? geoDef(s.geo).name : names[s.kind]));
    this.rotation(shapes);
    const geo = any((x) => x.kind === 'geo');
    const isGeo = (x: Shape) => x.kind === 'geo';
    if (geo) {
      // another shape from the library, keeping the size, colours and text
      // (an icon is listed too, so it can be swapped for a shape and back)
      const own = geoDef(geo.geo);
      const ff = freeformPoints(geo);
      if (ff) {
        // a freeform (or ChemDraw curve): closed or open, smooth or with straight sides, through the same points
        const isFree = (x: Shape) => !!freeformPoints(x);
        this.check('Closed', ff.closed, (v) => set(v ? 'Close shape' : 'Open shape', isFree, (x) => reshapeFreeform(x, { closed: v }) ?? {}));
        this.check('Smooth', isSmoothPath(ff.pts), (v) => set(v ? 'Smooth shape' : 'Straighten shape', isFree, (x) => reshapeFreeform(x, { smooth: v }) ?? {}));
      } else if (this.pickShape) this.shapePicker(own.id, (v) => set('Change shape', isGeo, () => ({ geo: v })));
      else {
        const opts = [...(own.icon ? [own] : []), ...GEOS].map((g): Opt<string> => [g.id, `${g.name} (${g.group.toLowerCase()})`]);
        this.select('Shape', opts, own.id, (v) => set('Change shape', isGeo, () => ({ geo: v })));
      }
    }
    const lined = (x: Shape) => x.kind !== 'symbol' && x.kind !== 'ring';
    const l = any(lined);
    const fillable = (x: Shape) => x.kind === 'rect' || x.kind === 'oval' || x.kind === 'geo' || x.kind === 'ring';
    const f = any(fillable);
    if (f) {
      const now: Fill = !f.filled ? 'none' : f.fill ?? 'solid';
      this.select('Fill', FILLS, now, (v) => set('Fill', fillable, () => (v === 'none' ? { filled: false } : { filled: true, fill: v === 'solid' ? undefined : v })));
      // a ring fill has no line of its own: its colour unless chosen is the soft blue
      const ringOnly = shapes.every((x) => x.kind === 'ring');
      if (f.filled) {
        this.color(f.fill === 'gradient' ? 'From color' : 'Fill color', f.fillColor, (v) => set('Fill color', fillable, (x) => (x.kind === 'ring' && !v ? { fillColor: undefined, color: undefined } : { fillColor: v })),
          ringOnly ? 'Soft blue' : 'Same as the line', ringOnly ? RING_FILL_COLOUR : f.color ?? '#000000');
      }
      if (f.filled && f.fill === 'gradient') {
        this.color('To color', f.fill2, (v) => set('Gradient color', fillable, () => ({ fill2: v })), 'White', '#ffffff');
        this.select('Direction', GRAD_DIRS, f.gradRadial ? 'radial' : String(f.gradAngle ?? 90), (v) => set('Gradient direction', fillable, () => (v === 'radial' ? { gradRadial: true } : { gradRadial: undefined, gradAngle: Number(v) })));
      }
      const see = any((x) => x.kind === 'geo' || x.kind === 'ring');
      if (f.filled && see) {
        const seeable = (x: Shape) => x.kind === 'geo' || x.kind === 'ring';
        this.number('Transparency (%)', Math.round((see.transparency ?? 0) * 100), 5, 0, 100, (v) => set('Transparency', seeable, () => ({ transparency: v ? v / 100 : undefined })), 'How much shows through the fill: 0 is solid');
      }
      // hatching and stippling, over the fill or on their own
      this.patternPicker('Pattern', f.pattern ?? 'none', (v) => set('Pattern', fillable, () => ({ pattern: v === 'none' ? undefined : (v as Pattern) })));
      if (f.pattern === 'dots' || f.pattern === 'dense-dots') {
        const ring = f.kind === 'ring';
        this.densityPicker(patternSpacing(f), ring, (gap) => set('Dot density', fillable, () => ({ pattern: 'dots', patternSize: gap })));
      }
      if (f.pattern) {
        this.color('Pattern color', f.patternColor, (v) => set('Pattern color', fillable, () => ({ patternColor: v })),
          f.kind === 'ring' ? 'Light gray' : 'Same as the line', f.kind === 'ring' ? RING_PATTERN_COLOUR : f.color ?? '#000000');
        this.number('Pattern Transparency (%)', Math.round((f.patternTransparency ?? 0) * 100), 5, 0, 100, (v) => set('Pattern transparency', fillable, () => ({ patternTransparency: v ? v / 100 : undefined })),
          'How much shows through the lines or dots: 0 is solid');
        this.number('Pattern spacing (pt)', round(patternSpacing(f)), 0.25, 0.5, 40, (v) => set('Pattern spacing', fillable, () => ({ patternSize: v })), 'How far apart the lines or dots are');
        const ring = any((x) => x.kind === 'ring' && !!x.pattern);
        if (ring) this.check('Pattern under double bonds', !ring.patternClear, (v) => set('Pattern under double bonds', (x) => x.kind === 'ring', () => ({ patternClear: v ? undefined : true })),
          'Run the lines or dots up to the bonds and under the double bonds; clear to keep them clear of the bonds and labels');
      }
    }
    // ring fills and design shapes: a drop shadow, with its colour, darkness, direction and blur folded away
    const shaded = (x: Shape) => x.kind === 'ring' || x.kind === 'geo';
    const sh = any(shaded);
    if (sh) {
      const dist = (x: Shape) => (x.kind === 'ring' ? ringShadowSize(x, this.doc.style.bondLength) : x.shadowSize ?? Math.max(2, 0.04 * Math.min(Math.abs(x.x2 - x.x1), Math.abs(x.y2 - x.y1))));
      const look = shadowLook(sh, dist(sh));
      this.group('Shadow', sh.shadow ? `${Math.round(look.opacity * 100)}%${look.blur ? ', blurred' : ''}` : 'off', () => {
        this.check('Shadow', !!sh.shadow, (v) => set(sh.kind === 'ring' ? 'Ring fill shadow' : 'Shadow', shaded, () => ({ shadow: v || undefined })), 'A drop shadow, down and to the right unless you choose another way');
        if (sh.shadow) this.shadowRows({ ...look }, 'pt', (p) => set('Shadow', shaded, () => ({
          ...(p.colour !== undefined ? { shadowColor: p.colour === '#000000' ? undefined : p.colour } : {}), ...(p.opacity !== undefined ? { shadowOpacity: p.opacity } : {}),
          ...(p.angle !== undefined ? { shadowAngle: p.angle === 45 ? undefined : p.angle } : {}), ...(p.distance !== undefined ? { shadowSize: p.distance } : {}), ...(p.blur !== undefined ? { shadowBlur: p.blur || undefined } : {}),
        })));
        // fused ring fills cast one shadow round their outer edge unless asked for one between them
        const ring = any((x) => x.kind === 'ring' && !!x.shadow);
        if (ring) this.check('Shadow between fused rings', !!ring.shadowBetween, (v) => set('Shadow between fused rings', (x) => x.kind === 'ring', () => ({ shadowBetween: v || undefined })),
          'Each ring casts its own shadow, onto the rings fused to it too; clear for one shadow around the outer edge');
      });
    }
    if (geo) {
      this.select('Horizontal Alignment', JUSTIFY, geo.textAlign ?? 'center', (v) => set('Text alignment', isGeo, () => ({ textAlign: v === 'center' ? undefined : v })));
      this.select('Vertical Alignment', VALIGN, geo.textValign ?? 'middle', (v) => set('Text alignment', isGeo, () => ({ textValign: v === 'middle' ? undefined : v })));
    }
    const br = any((x) => x.kind === 'bracket');
    if (br) this.select('Bracket', BRACKETS, br.bracket ?? 'square', (v) => set('Bracket shape', (x) => x.kind === 'bracket', () => ({ bracket: v })));
    const mate = br && this.bracketPartner?.state();
    if (mate) {
      const row = document.createElement('div');
      row.className = 'style-buttons';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = mate === 'select' ? 'Select Partner' : 'Deselect Partner';
      btn.title = mate === 'select' ? 'Select the other bracket of the pair too' : 'Leave only this bracket selected, to change or move it on its own';
      btn.addEventListener('click', () => this.bracketPartner?.toggle());
      row.append(btn);
      this.body.append(row);
    }
    // the border together: its colour, weight, dashes, corners and shadow
    // (ring fills have no line, so no line colour: it only stood in for a fill colour that wasn't set)
    const box = any((x) => x.kind === 'rect');
    const oval = any((x) => x.kind === 'oval');
    // a lone pair: two dots, or ChemDraw's bar
    const pair = any((x) => x.kind === 'symbol' && (x.symbol === 'LonePair' || x.symbol === 'LonePairBar'));
    if (pair) {
      const isPair = (x: Shape) => x.kind === 'symbol' && (x.symbol === 'LonePair' || x.symbol === 'LonePairBar');
      this.select('Drawn as', [['LonePair', 'Two dots'], ['LonePairBar', 'Bar']], pair.symbol as string, (v) => set('Lone pair look', isPair, (x) => {
        // (the same two ends: a bar runs a little past them, as ChemDraw draws it)
        return x.symbol === v ? {} : { symbol: v };
      }));
    }
    if (l || box) this.subheading('Border');
    if (shapes.some((x) => x.kind !== 'ring')) this.color(f?.filled && f.fillColor ? 'Line color' : 'Color', s.color, (v) => set('Color', (x) => x.kind !== 'ring', () => ({ color: v })));
    if (geo) this.number('Outline (pt)', round(geo.lineWidth ?? (geo.bold ? lw * 2.5 : lw)), 0.25, 0, 50, (v) => set('Outline width', isGeo, () => ({ lineWidth: v, bold: undefined })), '0 for no outline');
    if (l) {
      this.check('Dashed', !!l.dashed && !l.dotted, (v) => set('Dashed', lined, () => ({ dashed: v, dotted: false })));
      if (l.kind === 'line') this.check('Dotted', !!l.dotted, (v) => set('Dotted', (x) => x.kind === 'line', () => ({ dotted: v, dashed: v })));
      if (!geo) this.check('Bold', !!l.bold, (v) => set('Bold', lined, () => ({ bold: v })));
    }
    if (box) {
      const isBox = (x: Shape) => x.kind === 'rect';
      this.check('Round corners', !!box.rounded, (v) => set('Round corners', isBox, () => ({ rounded: v })));
      if (box.rounded) this.number('Corner radius (pt)', round(box.radius ?? 6 * lw), 0.5, 0, 200, (v) => set('Corner radius', isBox, () => ({ radius: v })));
      this.check('Shadow', !!box.shadow, (v) => set('Shadow', isBox, () => ({ shadow: v })));
      if (box.shadow) this.number('Shadow size (pt)', round(box.shadowSize ?? 4 * lw), 0.5, 0, 100, (v) => set('Shadow size', isBox, () => ({ shadowSize: v })));
    }
    if (oval && !box) {
      const isOval = (x: Shape) => x.kind === 'oval';
      this.check('Shadow', !!oval.shadow, (v) => set('Shadow', isOval, () => ({ shadow: v || undefined })));
      if (oval.shadow) this.number('Shadow size (pt)', round(oval.shadowSize ?? 4 * lw), 0.5, 0, 100, (v) => set('Shadow size', isOval, () => ({ shadowSize: v })));
    }
  }

  // ------------------------------------------------------------------ energy diagrams

  /** An energy diagram: how it is drawn, and the window with its numbers. */
  /** A Newman or sawhorse projection: how it is drawn and written. */
  private newmanControls(sh: Shape): void {
    const d = sh.newman!, look = d.look, tx = look.text ?? { auto: false };
    const saw = d.kind === 'sawhorse';
    this.heading(saw ? 'Sawhorse Projection' : 'Newman Projection');
    const set = (patch: Partial<typeof look>) => this.newman?.look(sh.id, patch);
    this.check('Idealized Angles', !!look.ideal, (v) => set({ ideal: v }), 'Bonds 120° apart on each atom and staggered at exactly 60°, as textbooks draw them. Clear it to draw the true angles.');
    const size = document.createElement('input');
    size.type = 'number'; size.min = '4'; size.max = '72'; size.step = '0.5'; size.placeholder = 'Auto';
    size.value = tx.size !== undefined ? String(tx.size) : '';
    const apply = () => { const v = Number(size.value); const { size: _old, ...rest } = tx; set({ text: size.value.trim() !== '' && Number.isFinite(v) ? { ...rest, size: Math.max(4, Math.min(72, v)) } : rest }); };
    size.addEventListener('change', apply);
    size.addEventListener('keydown', (e) => { if (e.key === 'Enter') { apply(); size.blur(); } e.stopPropagation(); });
    this.row('Text Size', size, "In points. Empty: 2 points smaller than the drawing's caption text.");
    this.check('Bold', !!tx.bold, (v) => set({ text: { ...tx, bold: v || undefined } }));
    this.check('Italic', !!tx.italic, (v) => set({ text: { ...tx, italic: v || undefined } }));
    if (!saw) this.check('Auto-Scale Text', !!tx.auto, (v) => set({ text: { ...tx, auto: v } }), 'Make the labels smaller, down to 70%, where they would not fit at full size.');
    if (saw) {
      this.check('Wedges', !!look.wedges, (v) => set({ wedges: v }), 'A wedge and a hashed wedge on each carbon show which groups point toward and away from you.');
      this.check('R/S Labels', !!look.rs, (v) => set({ rs: v }), 'R or S beside each stereocenter.');
    }
    const row = document.createElement('div');
    row.className = 'style-buttons';
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = 'Edit Projection…';
    b.addEventListener('click', () => this.newman?.edit(sh.id));
    row.append(b);
    this.body.append(row);
  }

  /** A torsion chart: its look is set in its window (the frame round it has none of its own). */
  private torsionControls(sh: Shape): void {
    this.heading('Torsional energy chart');
    const row = document.createElement('div');
    row.className = 'style-buttons';
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = 'Edit Torsional Energy Chart…';
    b.addEventListener('click', () => this.torsion?.edit(sh.id));
    row.append(b);
    this.body.append(row);
  }

  private energyControls(sh: Shape): void {
    const d = sh.energy!;
    this.heading('Energy diagram');
    const set = (patch: Partial<EnergyData>) => this.energy?.restyle(sh.id, patch);
    this.select('Joined by', [['levels', 'Levels and dashed lines'], ['curve', 'A smooth curve']], d.style, (v) => set({ style: v as EnergyData['style'] }));
    this.check('Show the energies', d.values, (v) => set({ values: v }));
    this.check('Axis and its titles', d.axis, (v) => set({ axis: v }));
    this.check('Mark the largest barrier', d.barrier, (v) => set({ barrier: v }), 'A double arrow from the lowest point up to the highest after it, on each pathway');
    this.check('Mark the overall change', !!d.overall, (v) => set({ overall: v }), 'A double arrow from the first species to the last, on each pathway');
    this.number('Decimal places', d.digits, 1, 0, 3, (v) => set({ digits: v }));
    const n = Math.max(...d.paths.map((p) => p.points.length));
    this.note(`${d.paths.length === 1 ? 'One pathway' : `${d.paths.length} pathways`} through ${n} species.`);
    this.help('Change the names and energies in the window; drag a corner to resize it. Anything you draw inside stays when it is redrawn.');
    const row = document.createElement('div');
    row.className = 'style-buttons';
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = 'Edit Energy Diagram…';
    b.title = 'Change the species, energies and pathways (or double-click the diagram)';
    b.addEventListener('click', () => this.energy?.edit(sh.id));
    row.append(b);
    this.body.append(row);
  }

  /**
   * An MO diagram: what each side is (an atom, one orbital, or custom), the molecule's electrons
   * with Fill Electrons, a warning where the filling breaks the aufbau principle, the level last
   * pressed, and how it is drawn. The levels themselves are dragged and pressed on the page.
   */
  private moControls(sh: Shape, d: PlateData, mo: MoSpec): void {
    const set = (next: MoSpec) => this.plate?.restyle(sh.id, { mo: next });
    const sides = moSides(mo);
    const molecule = moMolecule(mo.molecule);
    // first what the diagram is of: two atoms (each side picked below), a ready-made molecule, or custom
    const kinds: Opt<string>[] = [[MO_TWO_ATOMS, 'Two Atoms'], ...MO_MOLECULES.map((m): Opt<string> => [m.id, m.name]), [MO_CUSTOM, 'Custom']];
    // a molecule this version does not know (a file from a later one): shown as such, so Custom can still be picked
    if (mo.molecule && !molecule) kinds.splice(kinds.length - 1, 0, [mo.molecule, 'Other Molecule']);
    const kind = mo.molecule ? mo.molecule : sides.left === MO_CUSTOM && sides.right === MO_CUSTOM ? MO_CUSTOM : MO_TWO_ATOMS;
    // a ready-made molecule has twice the levels of most two-atom diagrams: one shorter than 22 bond lengths grows to that, so its names stay apart
    const tall = Math.round(22 * this.doc.style.bondLength);
    this.select('Molecule', kinds, kind, (v) => this.plate?.restyle(sh.id, { mo: setMolecule(mo, v), ...(moMolecule(v) && d.h < tall ? { h: tall } : {}) }));
    const opts: Opt<string>[] = [...MO_ATOMS.map((a): Opt<string> => [a.id, a.name]), [MO_CUSTOM, 'Custom']];
    // the list in groups: the atoms by period, then the single orbitals (Custom on its own)
    const groups: Record<number, string> = { 1: 'Hydrogen to Neon', 2: 'Hydrogen to Neon', 3: 'Sodium to Argon', 0: 'Single Orbitals' };
    const group = (v: string) => { const a = MO_ATOMS.find((x) => x.id === v); return a ? groups[moPeriod(a)] : undefined; };
    if (!molecule) {
      this.select('Left', opts, sides.left, (v) => set(setSides(mo, { left: v })), group);
      this.select('Right', opts, sides.right, (v) => set(setSides(mo, { right: v })), group);
    }
    this.help(`${molecule ? 'The central atom\'s valence orbitals are on the left and the outer atoms\' group orbitals, named by their symmetry, on the right. ' : ''}Drag a level up or down. Click a level to add an electron (a full level empties). Double-click a name to change it; right-click to add or delete a level. Custom lets ${molecule ? 'the' : 'a side\'s'} levels be set by hand.`);
    const A = MO_ATOMS.find((a) => a.id === sides.left), B = MO_ATOMS.find((a) => a.id === sides.right);
    if (!molecule && A && B && !A.orbital && !B.orbital && A.orbitals.length > 1 && B.orbitals.length > 1) {
      this.check('π Below σ', sides.mixing, (v) => set(setSides(mo, { mixing: v })), 'With s–p mixing the π orbitals lie below σ in the p set, as in B₂, C₂ and N₂. Without it σ is lower, as in O₂ and F₂.');
    }
    // the molecule's electrons: type how many and fill them in lowest first
    const counts = moCounts(mo.levels);
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.min = '0';
    inp.step = '1';
    inp.max = String(2 * counts.moOrbitals);
    inp.value = String(counts.moElectrons);
    inp.className = 'mo-electrons';
    const fill = document.createElement('button');
    fill.type = 'button';
    fill.className = 'primary';
    fill.textContent = 'Fill Electrons';
    fill.title = 'Put this many electrons into the molecule\'s orbitals, lowest first, by the aufbau principle and Hund\'s rule';
    const apply = () => { const n = Number(inp.value); if (inp.value.trim() !== '' && Number.isFinite(n)) set(fillElectrons(toRelative(mo), n)); };
    fill.addEventListener('click', apply);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { apply(); inp.blur(); } e.stopPropagation(); });
    const both = document.createElement('span');
    both.className = 'mo-fill';
    both.append(inp, fill);
    this.row('Electrons', both, 'Electrons in the molecule\'s orbitals');
    // a ready-made molecule draws no electrons on its atoms' orbitals: its charge is from the neutral molecule's count, and
    // a bond order between two atoms means nothing for it
    const whole = molecule?.electrons ?? (mo.molecule || (sides.left === MO_CUSTOM && sides.right === MO_CUSTOM) ? mo.neutral : undefined);
    const charge = (whole ?? counts.atomElectrons) - counts.moElectrons;
    const sign = charge === 0 ? '0' : `${Math.abs(charge)}${charge > 0 ? '+' : '−'}`;
    const facts = whole !== undefined || mo.molecule ? [`Charge ${sign}`, `${counts.unpaired} Unpaired`] : [`Charge ${sign}`, `Bond Order ${counts.bondOrder}`, `${counts.unpaired} Unpaired`];
    this.note(facts.join(' · '));
    const name = (l: MoLevel, into: HTMLElement, first = false) => {
      if (!l.label.trim()) { into.append(first ? 'A level with no name' : 'a level with no name'); return; }
      richInto(mo, l.label, into);
    };
    for (const bad of fillProblems(mo.levels).slice(0, 2)) {
      const w = document.createElement('p');
      w.className = 'mo-warning';
      w.setAttribute('role', 'status');
      const mark = document.createElement('b');
      mark.textContent = '⚠';
      mark.setAttribute('aria-label', 'Warning');
      const text = document.createElement('span');
      name(bad.empty, text, true);
      text.append(' is not full, but ');
      name(bad.filled, text);
      text.append(` holds ${bad.filled.electrons === 1 ? 'an electron' : 'electrons'}`);
      w.append(mark, text);
      this.body.appendChild(w);
    }
    if (counts.atomOrbitals !== counts.moOrbitals && mo.levels.some((l) => l.column === 'middle')) {
      const w = document.createElement('p');
      w.className = 'mo-warning';
      w.setAttribute('role', 'status');
      const mark = document.createElement('b');
      mark.textContent = '⚠';
      mark.setAttribute('aria-label', 'Warning');
      const text = document.createElement('span');
      text.textContent = `${counts.atomOrbitals} atomic ${counts.atomOrbitals === 1 ? 'orbital' : 'orbitals'} but ${counts.moOrbitals} molecular ${counts.moOrbitals === 1 ? 'orbital' : 'orbitals'}`;
      w.append(mark, text);
      this.body.appendChild(w);
    }
    this.moLevelRows(sh, mo, name);
    this.check('Energy Axis', mo.axis, (v) => set({ ...mo, axis: v }));
    // (the pictures show two atoms' orbitals mixing, so they are for two atoms only)
    if (!molecule) this.check('Orbital Pictures', !!mo.pictures, (v) => set({ ...mo, pictures: v || undefined }), 'Each atomic orbital\'s shape beside it, and each molecular orbital\'s in-phase or out-of-phase combination');
    if (mo.pictures && !molecule) this.number('Picture Size (%)', Math.round((mo.pictureSize ?? 1) * 100), 10, 20, 400, (v) => set({ ...mo, pictureSize: v / 100 }));
    if (mo.pictures && !molecule) this.select('Phases', ORBITAL_LOOK_NAMES.map((k): Opt<OrbitalLook> => [k.value, k.label]), mo.pictureLook ?? 'shaded', (v) => set({ ...mo, pictureLook: v }));
    this.check('White Background Behind Names', !!mo.labelBack, (v) => set({ ...mo, labelBack: v ? 'white' : undefined }));
    this.check('Names Avoid Dashed Lines', !!mo.labelClear, (v) => set({ ...mo, labelClear: v || undefined }));
    this.moLineRows(sh, d, mo);
    if (this.plate?.moFit) {
      const row = document.createElement('div');
      row.className = 'style-buttons';
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = 'Fit Width';
      b.title = 'Make the diagram just wide enough to keep the molecule\'s orbitals, names and pictures clear of each atom\'s';
      b.addEventListener('click', () => this.plate?.moFit?.(sh.id));
      row.append(b);
      this.body.appendChild(row);
    }
  }

  /** The level of an MO diagram (or d-orbital splitting diagram) last pressed, dragged or right-clicked: its energy, degeneracy, what it is made from, Rename and Delete; then the Look heading. */
  private moLevelRows(sh: Shape, mo: MoSpec, name: (l: MoLevel, into: HTMLElement, first?: boolean) => void): void {
    const set = (next: MoSpec) => this.plate?.restyle(sh.id, { mo: next });
    const at = this.plate?.moLevel?.(sh.id) ?? null;
    const l = at !== null ? mo.levels[at] : undefined;
    if (l && at !== null) {
      const h = document.createElement('h3');
      h.append('Level: ');
      name(l, h, true);
      this.body.appendChild(h);
      const rel = toRelative(mo).levels[at];
      this.number('Energy', rel.e, 0.01, 0, 1, (v) => set(withLevel(mo, at, { e: v })), 'Its place up the diagram, from 0 at the bottom to 1 at the top (no units). Dragging the level sets it too.');
      if (!l.auto) {
        this.number('Degeneracy', l.n, 1, 1, 5, (v) => set(withLevel(mo, at, { n: v })), 'How many orbitals share this level');
        if (l.column === 'middle') {
          const choices = fromChoices(mo.levels), want = fromValue(l);
          const list: Opt<string>[] = choices.map((c): Opt<string> => [c.value, c.text]);
          if (want && !choices.some((c) => c.value === want)) list.push([want, `${(l.from ?? '').split(',').map((x) => moPlain(x)).filter(Boolean).join(' + ')}${sources(mo.levels, l).length ? '' : ' (Not Found)'}`]);
          this.select('Made From', list, want, (v) => set(withLevel(mo, at, fromOf(v))));
        }
      }
      const row = document.createElement('div');
      row.className = 'style-buttons';
      const ren = document.createElement('button');
      ren.type = 'button';
      ren.textContent = 'Rename';
      ren.addEventListener('click', () => this.plate?.moRename?.(sh.id, at));
      row.append(ren);
      if (!l.auto) {
        const del = document.createElement('button');
        del.type = 'button';
        del.textContent = 'Delete';
        del.addEventListener('click', () => this.plate?.moDelete?.(sh.id, at));
        row.append(del);
      }
      this.body.appendChild(row);
      const look = document.createElement('h3');
      look.textContent = 'Look';
      this.body.appendChild(look);
    }
  }

  /** The electron arrows' size and the dashed lines' color, as an MO diagram and a d-orbital splitting diagram both have them. */
  private moLineRows(sh: Shape, d: PlateData, mo: MoSpec): void {
    const set = (next: MoSpec) => this.plate?.restyle(sh.id, { mo: next });
    const now = electronLook(mo, this.doc.style, d.w, d.h);
    const r1 = (x: number) => Math.round(x * 10) / 10;
    this.number('Arrow Height (pt)', r1(now.tall), 0.5, 2, 48, (v) => set(setElectrons(mo, { ...now, tall: v }, d.w, d.h)), 'How tall the electron arrows are');
    this.number('Arrow Width (pt)', r1(now.thick), 0.1, 0.1, 6, (v) => set(setElectrons(mo, { ...now, thick: v }, d.w, d.h)), 'The electron arrows\' line width');
    this.number('Arrow Gap (pt)', r1(now.lift), 0.5, 0, 24, (v) => set(setElectrons(mo, { ...now, lift: v }, d.w, d.h)), 'How far above the level line the electron arrows start');
    this.color('Dashed Lines', mo.lineColor, (v) => set({ ...mo, lineColor: v }));
    this.number('Line Transparency (%)', Math.round((mo.lineTransparency ?? 0) * 100), 5, 0, 90, (v) => set({ ...mo, lineTransparency: v ? v / 100 : undefined }));
  }

  /**
   * A d-orbital splitting diagram (dsplit.ts): the geometry, the metal ion, its d electrons and
   * spin, the splitting's name, what the drawn electrons add up to, and how it is drawn. Every
   * value filled in can be changed: the d count by hand here, the levels dragged, clicked and
   * renamed on the page.
   */
  private dsplitControls(sh: Shape, d: PlateData, mo: MoSpec, ds: DSplit): void {
    const set = (next: MoSpec) => this.plate?.restyle(sh.id, { mo: next });
    const change = (patch: Partial<DSplit>) => set(setDSplit(mo, patch));
    this.help('Drag a level up or down. Click a split level to add an electron (a full level empties). Double-click a name or title to change it; right-click to add a level.');
    const geos: Opt<DGeometry>[] = D_GEOMETRIES.map((g): Opt<DGeometry> => [g.id, g.name]);
    this.select('Geometry', geos, ds.geometry, (v) => change({ geometry: v }));
    if (ds.geometry === 'sq') this.tipOnLast('The order of the lower levels depends on the ligands. This is a common order: dx²−y² far above dz², then dxz and dyz, then dxy lowest. Drag the levels to change it. No LFSE is shown for square planar.');
    this.text('Metal Ion', supText(ds.ion), 'Co³⁺', (v) => change({ ion: v }));
    this.tipOnLast('Type the ion with its charge, such as Co³⁺, Fe²⁺ or Ni(II); a charge typed on the line, or one sign for each charge, is read too. Its group and charge set d Electrons, and its row the d shell (3d, 4d or 5d).');
    // text that gives no d count (not a d-block ion, or one with fewer than 0 or more than 10 d electrons): a quiet mark on the field
    if (ionD(ds.ion) === null) {
      const inp = this.body.lastElementChild?.querySelector('input');
      if (inp) {
        inp.classList.add('unread');
        inp.setAttribute('aria-invalid', 'true');
        inp.title = 'Not read as a d-block ion with 0 to 10 d electrons, so d Electrons was left as it was';
      }
    }
    const counts: Opt<string>[] = Array.from({ length: 11 }, (_, k): Opt<string> => [String(k), `d${supText(`^{${k}}`)}`]);
    this.select('d Electrons', counts, String(ds.d), (v) => change({ d: Number(v) }));
    this.tipOnLast('Set automatically from the metal ion; choose another count to change it by hand.');
    // high or low spin: two buttons, disabled with the reason where both fill the levels alike
    const split = splitLevels(mo);
    const matters = spinMatters(split, ds.d);
    // (the button lit is the way the electrons drawn are put in: neither when they are put in neither way)
    const drawnSpin = dReadout(mo).spin;
    const seg = document.createElement('div');
    seg.className = 'seg';
    seg.setAttribute('role', 'radiogroup');
    seg.setAttribute('aria-label', 'Spin');
    for (const [v, text] of [['high', 'High Spin'], ['low', 'Low Spin']] as const) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = text;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(matters && drawnSpin === v));
      b.disabled = !matters;
      // (a press always fills the levels again, the spin already chosen too)
      b.addEventListener('click', () => change({ spin: v }));
      seg.append(b);
    }
    if (!matters) seg.title = `High and low spin fill these levels the same way for d${supText(`^{${ds.d}}`)}`;
    this.row('Spin', seg);
    this.tipOnLast('Low spin fills the lower levels before the upper ones; high spin puts one electron in each orbital before pairing any. Which one a complex takes depends on the splitting against the pairing energy.');
    this.text('Splitting Label', supText(ds.label), dGeometry(ds.geometry).delta.replace(/_\{(.*)\}/, '$1'), (v) => change({ label: deltaMarkup(v) }));
    // what the electrons drawn add up to
    const r = dReadout(mo);
    const value = (label: string, markup: string, tip?: string) => {
      const v = document.createElement('span');
      v.className = 'ds-value';
      richInto(mo, markup, v);
      this.row(label, v);
      this.body.lastElementChild?.classList.add('ds-read');
      if (tip) this.tipOnLast(tip);
    };
    value('Configuration', r.config || '–');
    value('Unpaired Electrons', String(r.unpaired));
    if (r.lfse !== null) value('LFSE', lfseMarkup(r.lfse, ds.label || 'Δ'), 'Ligand field stabilization energy: the d electrons\' energy compared with the same electrons in five orbitals at their average energy, from the electrons drawn. Pairing energy is not included.');
    value('Spin-Only Moment', `${r.moment.toFixed(2)} μ_{B}`, 'μ = √(n(n + 2)) μB for n unpaired electrons, leaving out any orbital contribution.');
    this.moLevelRows(sh, mo, (l, into, first) => { if (!l.label.trim()) into.append(first ? 'A level with no name' : 'a level with no name'); else richInto(mo, l.label, into); });
    this.check('Energy Axis', mo.axis, (v) => set({ ...mo, axis: v }));
    this.check('Splitting Arrow', ds.arrow, (v) => change({ arrow: v }));
    this.check('Readouts on Diagram', ds.readouts, (v) => change({ readouts: v }));
    this.check('Barycenter Line', !!ds.barycenter, (v) => change({ barycenter: v || undefined }), 'A dotted line across the split levels at their average energy, weighted by the number of orbitals');
    this.check('White Background Behind Names', !!mo.labelBack, (v) => set({ ...mo, labelBack: v ? 'white' : undefined }));
    this.moLineRows(sh, d, mo);
    const buttons = document.createElement('div');
    buttons.className = 'style-buttons';
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.textContent = 'Reset Levels';
    reset.title = 'Put the split levels back at the geometry\'s heights, names and number, filled again; the ion, d Electrons and spin stay';
    reset.addEventListener('click', () => set(resetDSplitLevels(mo)));
    buttons.append(reset);
    this.body.append(buttons);
  }

  /** An "i" with `tip` beside the label of the row just added. */
  private tipOnLast(tip: string): void {
    const span = this.body.lastElementChild?.querySelector<HTMLElement>(':scope > span');
    if (span) span.append(' ', infoIcon(tip));
  }

  /** A TLC plate or gel: its stain or dye and what is written, and the window with its lanes. */
  private plateControls(sh: Shape): void {
    const d = sh.plate!;
    if (d.kind === 'mo' && d.mo?.dsplit) {
      this.heading('d-Orbital Splitting');
      this.dsplitControls(sh, d, d.mo, d.mo.dsplit);
      return;
    }
    if (d.kind === 'mo') {
      this.heading('MO Diagram');
      if (d.mo) this.moControls(sh, d, d.mo);
      return;
    }
    if (d.kind === 'crystal') {
      this.heading('Crystal structure');
      const c = d.crystal;
      if (c) {
        const view = (patch: Partial<typeof c.view>) => this.plate?.restyle(sh.id, { crystal: { ...c, view: { ...c.view, ...patch } } });
        this.select('Drawing', [['ortep', 'Thermal ellipsoids'], ['ball', 'Ball-and-stick']], c.view.style, (v) => view({ style: v as typeof c.view.style }));
        this.check('Hydrogen atoms', c.view.hydrogens, (v) => view({ hydrogens: v }));
        this.check('Color', c.view.colour, (v) => view({ colour: v }));
        this.check('Atom labels', c.view.labels, (v) => view({ labels: v }));
      }
      this.help('Rotate it, change the ellipsoids or view the crystal data in the window; drag a corner to resize.');
      const row = document.createElement('div');
      row.className = 'style-buttons';
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = 'Edit Crystal Structure…';
      b.title = 'Rotate, change the display style, or view crystal data (or double-click it)';
      b.addEventListener('click', () => this.plate?.edit(sh.id));
      row.append(b);
      this.body.append(row);
      return;
    }
    const tlc = d.kind === 'tlc';
    this.heading(tlc ? 'TLC plate' : 'Gel');
    const set = (patch: Partial<PlateData>) => this.plate?.restyle(sh.id, patch);
    if (tlc) this.select('Stain', TLC_LOOKS.map((l) => [l.id, l.name]), d.look, (v) => set({ look: v }));
    else this.select('Dye', GEL_LOOKS.map((l) => [l.id, l.name]), d.look, (v) => set({ look: v }));
    if (tlc) this.check('Write the Rf values', d.rf, (v) => set({ rf: v }));
    if (tlc) this.check('Start and solvent-front lines', d.lines, (v) => set({ lines: v }));
    if (tlc) {
      this.check('Lock spots', !!d.locked, (v) => set({ locked: v }));
      addInfo(this.body.lastElementChild?.querySelector('span'), LOCK_SPOTS_INFO);
    }
    if (!tlc) this.check('Write the marker sizes', d.sizes, (v) => set({ sizes: v }));
    this.check('Lane names', d.labels, (v) => set({ labels: v }));
    this.note(`${d.lanes.length} lane${d.lanes.length === 1 ? '' : 's'}.`);
    this.help(`Change the ${tlc ? 'spots' : 'bands'} in the window; drag a corner to resize it.`);
    const row = document.createElement('div');
    row.className = 'style-buttons';
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = tlc ? 'Edit TLC Plate…' : 'Edit Gel…';
    b.title = `Change the lanes and their ${tlc ? 'spots' : 'bands'} (or double-click it)`;
    b.addEventListener('click', () => this.plate?.edit(sh.id));
    row.append(b);
    this.body.append(row);
  }

  // ------------------------------------------------------------------ SmartArt-style diagrams

  /** A diagram: its layout and look, the window with its text, and Convert to Shapes. */
  private diagramControls(sh: Shape): void {
    const d = sh.diagram!;
    this.heading('Diagram');
    const set = (patch: Partial<DiagramData>) => this.diagram?.restyle(sh.id, patch);
    this.select('Layout', DIAGRAM_LAYOUTS.map((l) => [l.id, `${l.category}: ${l.name}`] as [string, string]), d.layout, (v) => set({ layout: v }));
    this.select('Colors', DIAGRAM_COLOURS, d.colours, (v) => set({ colours: v }));
    if (d.colours !== 'colourful' && d.colours !== 'mono' && d.colours !== 'grey') this.color('Accent color', d.accent, (v) => set({ accent: v ?? '#4472c4' }), 'Blue', '#4472c4');
    this.check('Rounded corners', d.rounded, (v) => set({ rounded: v }));
    this.check('Shadow', d.shadow, (v) => set({ shadow: v }));
    this.check('AutoFit Text', d.size === undefined, (v) => set({ size: v ? undefined : 14 }), 'The text as big as fits, the same size in every shape; off, a custom size');
    if (d.size !== undefined) this.number('Text size', d.size, 1, 4, 96, (v) => set({ size: v }));
    this.help('Double-click a shape to type in it, or change all the text in the window. Drag a corner to resize it: it is drawn again to fill the box.');
    const row = document.createElement('div');
    row.className = 'style-buttons';
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = 'Edit Diagram…';
    b.title = 'Change the text, one item per line (or double-click away from the words)';
    b.addEventListener('click', () => this.diagram?.edit(sh.id));
    const u = document.createElement('button');
    u.type = 'button';
    u.textContent = 'Convert to Shapes';
    u.title = 'Make it ordinary shapes and connectors, to change one by one (it is no longer drawn from its text)';
    u.addEventListener('click', () => this.diagram?.ungroup(sh.id));
    row.append(b, u);
    this.body.append(row);
  }

  // ------------------------------------------------------------------ frames

  /** A box: as a frame, the gap it keeps round what it surrounds and whether it follows them. */
  private frameControls(sh: Shape): void {
    const f = sh.frame;
    // what a frame does, as the heading's tooltip rather than a paragraph in the panel
    const about = 'The frame fits around its contents with a margin and keeps fitting as they change. Moving or resizing it by hand stops this; check Fit to Contents to restore it.';
    this.heading('Frame');
    (this.body.lastElementChild as HTMLElement).title = about;
    if (f) {
      const set = (label: string, patch: Partial<NonNullable<Shape['frame']>>) => this.edit(label, () => {
        const now = this.doc.shapes.get(sh.id)?.frame;
        if (now) this.doc.updateShape(sh.id, { frame: { ...now, ...patch } });
      });
      // each structure counts once, however many of its atoms were selected
      const seen = new Set<number>();
      let n = f.captions.length + f.arrows.length + f.shapes.length;
      for (const id of f.atoms) if (this.doc.atoms.has(id) && !seen.has(id)) { n++; for (const a of this.doc.fragmentOf(id)) seen.add(a); }
      this.check('Fit to Contents', f.fit, (v) => (v ? this.frames?.fit(sh.id) : set('Stop fitting frame', { fit: false })),
        `${f.fit ? 'Follows' : 'Surrounds'} ${n} ${n === 1 ? 'thing' : 'things'} (structures, text, arrows, shapes). ${about}`);
      this.number('Horizontal Padding (pt)', round(f.padX, 10), 0.5, 0, 500, (v) => set('Frame gap', { padX: v }),
        'Space between the frame and what it surrounds, left and right.');
      this.number('Vertical Padding (pt)', round(f.padY, 10), 0.5, 0, 500, (v) => set('Frame gap', { padY: v }),
        'Space between the frame and what it surrounds, above and below.');
    }
    if (!f || !f.fit) {
      const row = document.createElement('div');
      row.className = 'style-buttons';
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = f ? 'Fit Now' : 'Fit to Contents';
      b.title = about;
      b.addEventListener('click', () => this.frames?.fit(sh.id));
      row.append(b);
      this.body.append(row);
    }
  }

  // ------------------------------------------------------------------ pictures

  /** Rotation in degrees clockwise (Slides and Design), as PowerPoint's Size and Position box: the shapes turn about their middles. */
  private rotation(list: Shape[]): void {
    const turning = list.filter((x) => turnsFreely(x));
    if (!this.turnable() || !turning.length) return;
    const now = ((turning[0].rot ?? 0) % 360 + 360) % 360;
    this.number('Rotation (°)', round(now, 10), 1, -360, 360, (v) => this.edit('Rotate', () => {
      const rot = normDegrees(v);
      for (const x of turning) this.doc.updateShape(x.id, { rot: Math.abs(rot) < 1e-9 ? undefined : rot });
    }), 'Rotates it about its middle, clockwise, as PowerPoint’s Rotation box. Drag the round handle above a selection to rotate it by hand.');
  }

  private pictureControls(pics: Shape[]): void {
    const p = pics[0];
    const set = (label: string, patch: (x: Shape) => Partial<Shape>) => this.edit(label, () => { for (const x of pics) this.doc.updateShape(x.id, patch(x)); });
    const box = (x: Shape) => ({ x1: Math.min(x.x1, x.x2), y1: Math.min(x.y1, x.y2), w: Math.abs(x.x2 - x.x1), h: Math.abs(x.y2 - x.y1) });
    const charts = pics.every((x) => x.chart);
    if (pics.every((x) => x.math)) { this.equationControls(pics); return; }
    this.heading(charts ? (pics.length > 1 ? `${pics.length} charts` : 'Chart') : pics.length > 1 ? `${pics.length} pictures` : 'Picture');
    // vector pictures (SVG, Windows metafiles) have no pixels to count
    if (charts) this.help('A chart with its own data. Double-click it to change the data, the chart type and its formatting; resizing it lays it out again.');
    else if (pics.every((x) => x.zoom)) {
      this.help('A Slide Zoom: in the slide show a click zooms into its slide. Its picture follows the slide.');
      this.check('Return to Zoom', !!p.zoom?.back, (v) => set('Return to Zoom', (x) => ({ zoom: { ...x.zoom, back: v || undefined } })), 'After its slide (or its part of a Summary Zoom), the show comes back to this slide');
    } else if (pics.length === 1 && p.video) {
      const v = p.video;
      const how = `${v.start === 'click' ? 'Starts when clicked' : 'Starts automatically'}${v.once ? '' : ', loops'}${v.trimStart || v.trimEnd ? ', trimmed' : ''}`;
      this.note(v.audio ? `Sound. ${how}. It plays in the slide show and in PowerPoint.` : `Video${p.px ? `, ${p.px.w} × ${p.px.h} pixels` : ''}. ${how}. It plays in the slide show and in PowerPoint.`);
      const buttons = document.createElement('div');
      buttons.className = 'style-buttons';
      const btn = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Playback…', title: 'Trim, fades, volume, when it starts, looping (or double-click it)' });
      btn.addEventListener('click', () => this.onEditMedia(p.id));
      buttons.append(btn);
      this.body.appendChild(buttons);
    }
    else if (pics.length === 1 && p.px) this.note(/^data:image\/(svg|x-emf)/.test(p.src ?? '') ? pictureType(p.src) : `${pictureType(p.src)}, ${p.px.w} × ${p.px.h} pixels`);
    // sizes change from the top left corner, as in PowerPoint's size boxes
    const size = (w: number | null, h: number | null) => set('Resize picture', (x) => {
      const b = box(x);
      let nw = w ?? b.w, nh = h ?? b.h;
      if (this.keepProportions && w !== null && h === null) nh = b.h * (w / b.w);
      if (this.keepProportions && h !== null && w === null) nw = b.w * (h / b.h);
      return { x1: b.x1, y1: b.y1, x2: b.x1 + nw, y2: b.y1 + nh };
    });
    const b = box(p);
    this.number('Width (pt)', round(b.w, 10), 1, 1, 20000, (v) => size(v, null));
    this.number('Height (pt)', round(b.h, 10), 1, 1, 20000, (v) => size(null, v));
    this.check('Keep proportions', this.keepProportions, (v) => { this.keepProportions = v; });
    this.rotation(pics);
    if (charts) {
      this.pictureLook(pics);
      if (pics.length === 1) {
        const buttons = document.createElement('div');
        buttons.className = 'style-buttons';
        const btn = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Edit chart…', title: 'Its data, the chart type, titles, axes, colors and fitted lines' });
        btn.addEventListener('click', () => this.onEditChart(p.id));
        buttons.append(btn);
        this.body.appendChild(buttons);
      }
      return;
    }
    const c = p.crop ?? { l: 0, t: 0, r: 0, b: 0 };
    const sides: [keyof typeof c, string][] = [['l', 'Crop left (%)'], ['t', 'Crop top (%)'], ['r', 'Crop right (%)'], ['b', 'Crop bottom (%)']];
    for (const [k, label] of sides) {
      this.number(label, round(c[k] * 100, 10), 1, 0, 98, (v) => set('Crop picture', (x) => cropTo(x, { ...(x.crop ?? { l: 0, t: 0, r: 0, b: 0 }), [k]: v / 100 })),
        'How much of the picture is cut off on this side, as a percentage of its full width or height.');
    }
    this.pictureLook(pics);
    const buttons = document.createElement('div');
    buttons.className = 'style-buttons';
    const button = (text: string, title: string, on: () => void) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = text;
      btn.title = title;
      btn.addEventListener('click', on);
      buttons.append(btn);
    };
    const plain = pics.filter((x) => !x.video);
    if (plain.length) button('Picture Format…', 'Brightness, contrast, sharpen, recolor, transparency, Remove Background, crop to a shape or proportions (saved as PowerPoint\'s own settings)', () => this.formatPicture());
    if (pics.length === 1) button('Crop with mouse', 'Drag the black handles to cut the edges off; Esc when done', () => this.cropWithMouse(p.id));
    if (pics.some((x) => x.crop)) button('Uncrop', 'Show the whole picture again', () => set('Uncrop picture', (x) => cropTo(x, { l: 0, t: 0, r: 0, b: 0 })));
    // only pictures made of pixels have a background to take out
    const bitmaps = pics.filter((x) => x.src && !/^data:image\/(svg|x-emf|x-wmf)/.test(x.src));
    if (bitmaps.length) button('Remove white…', 'Make the white background see-through (a logo or a picture of a structure on white)', () => this.removeWhite(bitmaps.map((x) => x.id)));
    button('Original size', 'Its own size: 96 pixels to the inch, as in PowerPoint', () => set('Picture size', (x) => {
      const bx = box(x), cc = x.crop ?? { l: 0, t: 0, r: 0, b: 0 };
      if (!x.px) return {};
      return { x2: bx.x1 + x.px.w * 0.75 * (1 - cc.l - cc.r), y2: bx.y1 + x.px.h * 0.75 * (1 - cc.t - cc.b) };
    }));
    this.body.appendChild(buttons);
  }

  /** A picture's frame, corners and shadow: a ready-made style, then each part on its own. */
  /** Equations on slides: their colour, and the equation window. Resizing one makes its text larger or smaller. */
  private equationControls(maths: Shape[]): void {
    const p = maths[0];
    this.heading(maths.length > 1 ? `${maths.length} equations` : 'Equation');
    this.help('Double-click it to change it in the equation window. Drag a corner to make it larger or smaller. PowerPoint opens it as its own equation.');
    this.color('Color', p.math!.color ?? '#000000', (v) => this.onEquationColour(maths.map((x) => x.id), v ?? '#000000'));
    if (maths.length === 1) {
      const buttons = document.createElement('div');
      buttons.className = 'style-buttons';
      const btn = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Edit equation…', title: 'Change it in the equation window (or double-click it)' });
      btn.addEventListener('click', () => this.onEditEquation(p.id));
      buttons.append(btn);
      this.body.appendChild(buttons);
    }
  }

  private pictureLook(pics: Shape[]): void {
    const look = pics[0].look ?? {};
    const setLook = (label: string, patch: (l: PictureLook) => PictureLook | undefined) => this.edit(label, () => {
      for (const x of pics) {
        const next = patch({ ...(x.look ?? {}) });
        const tidy = next && Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined && v !== 0)) as PictureLook;
        this.doc.updateShape(x.id, { look: tidy && Object.keys(tidy).length ? tidy : undefined });
      }
    });
    const same = (a: PictureLook | undefined, b: PictureLook | undefined) => JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});
    const preset = PICTURE_STYLES.find((p) => same(p.look, pics[0].look))?.id ?? 'custom';
    const opts: Opt<string>[] = PICTURE_STYLES.map((p) => [p.id, p.name]);
    if (preset === 'custom') opts.push(['custom', 'Custom']);
    this.select('Frame style', opts, preset, (v) => {
      const p = PICTURE_STYLES.find((x) => x.id === v);
      if (p) setLook('Picture style', () => p.look && { ...p.look });
    });
    this.number('Frame line (pt)', look.line ?? 0, 0.5, 0, 72, (v) => setLook('Picture frame', (l) => ({ ...l, line: v })),
      'The width of the line around the picture; 0 for none.');
    if (look.line) this.color('Frame color', look.lineColor, (v) => setLook('Picture frame color', (l) => ({ ...l, lineColor: v ?? '#000000' })));
    this.number('Rounded corners (%)', round((look.round ?? 0) * 100, 10), 1, 0, 50, (v) => setLook('Rounded corners', (l) => ({ ...l, round: v / 100 })),
      'How round the corners are, as a percentage of the shorter side (50 makes a circle or a pill).');
    this.select<'none' | 'soft' | 'hard'>('Shadow', [['none', 'None'], ['soft', 'Soft'], ['hard', 'Hard']], look.shadow ?? 'none',
      (v) => setLook('Picture shadow', (l) => ({ ...l, shadow: v === 'none' ? undefined : v })));
  }

  // ------------------------------------------------------------------ tables

  private tableControls(s: Shape): void {
    const hooks = this.tables;
    const t = s.table!;
    if (!hooks) return;
    const set = (label: string, next: TableData, part?: TablePart | null) => this.edit(label, () => {
      hooks.update(s.id, next);
      if (part !== undefined) hooks.setPart(part ? { id: s.id, part } : null);
    });
    const cur = hooks.part();
    const part = cur?.id === s.id ? cur.part : null;
    const cell = part && typeof part !== 'string' && t.rows[part.r] && part.c < t.cols.length ? part : null;
    this.heading('Table');
    this.note(cell ? `Row ${cell.r + 1}, column ${cell.c + 1}${cell.r < t.head ? ' (a heading)' : ''}. Double-click a cell to edit; Tab moves to the next.`
      : 'Click a cell to choose its row and column; double-click it to type.');
    const buttons = (list: [string, string, (() => void) | null][]) => {
      const box = document.createElement('div');
      box.className = 'style-buttons';
      for (const [text, title, on] of list) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = text;
        btn.title = title;
        btn.disabled = !on;
        if (on) btn.addEventListener('click', on);
        box.append(btn);
      }
      this.body.appendChild(box);
    };
    const r = cell?.r ?? t.rows.length - 1, c = cell?.c ?? t.cols.length - 1;
    buttons([
      ['Row above', 'Put a new row above this one', cell ? () => set('Add table row', insertRow(t, r), { r: r + 1, c }) : null],
      ['Row below', 'Put a new row below this one', () => set('Add table row', insertRow(t, r + 1), { r: r + 1, c })],
      ['Delete row', 'Take this row out', cell && t.rows.length > 1 ? () => set('Delete table row', deleteRow(t, r), { r: Math.min(r, t.rows.length - 2), c }) : null],
    ]);
    buttons([
      ['Column left', 'Put a new column to the left of this one', cell ? () => set('Add table column', insertColumn(t, c), { r, c: c + 1 }) : null],
      ['Column right', 'Put a new column to the right of this one', () => set('Add table column', insertColumn(t, c + 1), { r, c: c + 1 })],
      ['Delete column', 'Take this column out', cell && t.cols.length > 1 ? () => set('Delete table column', deleteColumn(t, c), { r, c: Math.min(c, t.cols.length - 2) }) : null],
    ]);
    this.number('Heading rows', t.head, 1, 0, t.rows.length, (v) => set('Table headings', { ...t, head: Math.round(v) }),
      'How many rows at the top are headings; in the ACS style a rule goes under them.');
    // a PowerPoint table style, or plain rules (ACS, a grid or none)
    const styleNow = slideTableStyle(t.style)?.id ?? `lines-${t.lines}`;
    const styles: Opt<string>[] = [...TABLE_LINES.map(([k, label]): Opt<string> => [`lines-${k}`, `No style: ${label.charAt(0).toLowerCase()}${label.slice(1)}`]), ...SLIDE_TABLE_STYLES.map((x): Opt<string> => [x.id, x.name])];
    this.select('Table style', styles, styleNow, (v) => {
      if (v.startsWith('lines-')) { const { style: _, ...rest } = t; set('Table style', { ...rest, lines: v.slice(6) as TableData['lines'] }); }
      else set('Table style', { ...t, style: v });
    });
    if (slideTableStyle(t.style)) {
      // PowerPoint's Table Style Options
      const o = lookOf(t);
      const opt = (label: string, on: boolean, f: (v: boolean) => TableData, help: string) => this.check(label, on, (v) => set('Table style options', f(v)), help);
      const flag = (k: 'total' | 'bandRows' | 'firstCol' | 'lastCol' | 'bandCols') => (v: boolean): TableData => ({ ...t, look: { ...t.look, [k]: v } });
      opt('Header row', o.header, (v) => ({ ...t, head: v ? Math.max(1, t.head) : 0 }), 'The first row in the style’s strong color, its text bold');
      opt('Total row', o.total, flag('total'), 'The last row set off with a line above it, its text bold');
      opt('Banded rows', o.bandRows, flag('bandRows'), 'Every other row shaded, for reading across');
      opt('First column', o.firstCol, flag('firstCol'), 'The first column in bold (or the strong color)');
      opt('Last column', o.lastCol, flag('lastCol'), 'The last column in bold (or the strong color)');
      opt('Banded columns', o.bandCols, flag('bandCols'), 'Every other column shaded');
    }
    if (cell) {
      const colAlign = t.align?.[cell.c] ?? (cell.c === 0 ? 'left' : 'center');
      this.select('Column Alignment', JUSTIFY, colAlign === 'justify' ? 'left' : colAlign, (v) => set('Column alignment', setColumnAlign(t, cell.c, v)));
      this.number('Column width (pt)', round(t.cols[cell.c], 10), 1, 4, 2000, (v) => set('Column width', setColumnWidth(t, cell.c, v)),
        'You can also drag the handle at the right of the text box while typing in a cell.');
      this.number('Cell spans (columns)', spanOf(t, cell.r, cell.c), 1, 1, t.cols.length - cell.c, (v) => set('Join table cells', setSpan(t, cell.r, cell.c, v)),
        'Join this cell with the ones to its right, for a heading over several columns.');
      this.number('Cell spans (rows)', rowSpanOf(t, cell.r, cell.c), 1, 1, t.rows.length - cell.r, (v) => set('Join table cells', setRowSpan(t, cell.r, cell.c, v)),
        'Join this cell with the ones under it (a vertical merge), for a label beside several rows.');
      buttons([
        ['Merge right', 'Join this cell with the one to its right; their text goes together', canMerge(t, cell.r, cell.c, 'right') ? () => set('Merge cells', mergeRight(t, cell.r, cell.c), cell) : null],
        ['Merge down', 'Join this cell with the one below it; their text goes together', canMerge(t, cell.r, cell.c, 'down') ? () => set('Merge cells', mergeDown(t, cell.r, cell.c), cell) : null],
        ['Split cell', 'Split a joined cell back into single cells', spanOf(t, cell.r, cell.c) > 1 || rowSpanOf(t, cell.r, cell.c) > 1 ? () => set('Split cell', splitCell(t, cell.r, cell.c), cell) : null],
      ]);
      const own = t.rows[cell.r][cell.c]?.fill;
      this.color('Cell color', own, (v) => set('Cell color', { ...t, rows: t.rows.map((row, rr) => rr !== cell.r ? row : row.map((x, cc) => { if (cc !== cell.c) return x; const { fill: _, ...rest } = x; return v ? { ...rest, fill: v } : rest; })) }),
        undefined, slideCellLook(t, cell.r, cell.c)?.fill);
    }
    const size = t.size ?? this.doc.style.captionSize;
    this.number('Text size (pt)', round(size, 10), 0.5, 1, 200, (v) => set('Table text size', resizeTableText(t, v)),
      'Changes all the table’s text; the footnotes are set a little smaller. Double-click a cell to change part of it.');
    this.color('Line color', s.color, (v) => this.edit('Table line color', () => this.doc.updateShape(s.id, { color: v })));
    buttons([
      [t.title ? 'Edit title' : 'Add title', 'The title above the table, such as “Table 1. Optimization of the Reaction Conditions”', () => hooks.edit(s.id, 'title')],
      [t.notes ? 'Edit footnotes' : 'Add footnotes', 'Notes under the table, such as “a Isolated yield.”', () => hooks.edit(s.id, 'notes')],
    ]);
    buttons([
      ['Fit columns to text', 'Make each column as wide as its longest line', () => set('Fit table columns', fitColumns(t, hooks.measure, this.doc.style.captionSize))],
    ]);
  }

  // ------------------------------------------------------------------ captions

  private captionControls(caps: Caption[]): void {
    const c = caps[0];
    const def = this.doc.style.captionSize;
    const set = (label: string, patch: (x: Caption) => Partial<Caption>) => this.edit(label, () => { for (const x of caps) this.doc.updateCaption(x.id, patch(x)); });
    this.heading(caps.length > 1 ? `${caps.length} captions` : 'Caption');
    const size = c.runs[0]?.size ?? def;
    this.number('Text size (pt)', round(size, 10), 1, 1, 200, (v) => set('Text size', (x) => ({ runs: x.runs.map((r) => ({ ...r, size: v })) })),
      'Changes the whole caption; double-click a caption to change part of it.');
    const all = (k: 'bold' | 'italic' | 'formula') => caps.every((x) => x.runs.every((r) => r[k] || !r.text.trim()));
    const whole = (label: string, k: 'bold' | 'italic' | 'formula') =>
      this.check(label, all(k), (v) => set(label, (x) => ({ runs: x.runs.map((r) => ({ ...r, [k]: v || undefined, ...(k === 'formula' && v ? { sub: undefined, sup: undefined } : {}) })) })));
    whole('Bold', 'bold');
    whole('Italic', 'italic');
    whole('Formula style (CH₃, NH₄⁺)', 'formula');
    this.select('Alignment', JUSTIFY, c.justify, (v) => set('Justification', () => ({ justify: v })));
    this.color('Color', c.runs[0]?.color, (v) => set('Text color', (x) => ({ runs: x.runs.map((r) => ({ ...r, color: v })) })));
    this.chemControls(caps);
    this.attachControls(caps);
  }

  /** Read as chemistry or as plain text, and what the text is read as. */
  private chemControls(caps: Caption[]): void {
    const now = new Set(caps.map((x) => (x.chem === undefined ? 'auto' : x.chem ? 'on' : 'off')));
    const value = now.size === 1 ? [...now][0] as 'auto' | 'on' | 'off' : 'auto';
    this.select<'auto' | 'on' | 'off'>('Read as', READ_AS, value, (v) => this.edit(v === 'off' ? 'Read as plain text' : v === 'on' ? 'Read as chemistry' : 'Read text automatically', () => {
      for (const x of caps) this.doc.updateCaption(x.id, { chem: v === 'auto' ? undefined : v === 'on' });
    }));
    if (caps.length !== 1) return;
    const r = captionReading(this.doc, caps[0]);
    if (r.species) this.note(`Chemistry: ${speciesSummary(r.species)}. It counts in the formula, mass and SMILES of what it is selected with.`);
    else if (r.why === 'arrow') this.help('Text above or below a reaction arrow stays text. Choose Chemical to count it.');
    else if (r.why === 'unread' && r.forced) this.note('Set to Chemical, but this text can\'t be read as chemistry.');
    else if (r.why === 'tied') this.help('Text attached to a structure stays text.');
  }

  /** Where a caption tied to a structure sits, what descriptors it shows; tie or untie it. */
  private attachControls(caps: Caption[]): void {
    const tied = caps.filter((x) => x.attach);
    const loose = caps.filter((x) => !x.attach);
    let row: HTMLDivElement | null = null;
    const button = (text: string, help: string, on: () => void) => {
      if (!row) { row = document.createElement('div'); row.className = 'style-buttons'; }
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = text;
      b.title = help;
      b.addEventListener('click', on);
      row.append(b);
      this.body.appendChild(row);
    };
    if (!tied.length) {
      if (this.tie) button('Pin to Nearest Structure', 'Keep this caption beside the structure nearest it: it follows when the structure moves', () => this.tie?.(loose.map((x) => x.id)));
      return;
    }
    const a = tied[0].attach!;
    const setA = (label: string, patch: (x: Attachment) => Partial<Attachment>) =>
      this.edit(label, () => { for (const x of tied) this.doc.updateCaption(x.id, { attach: { ...x.attach!, ...patch(x.attach!) } }); });
    this.heading(a.role === 'descriptors' ? 'Attached Descriptors' : a.role === 'label' ? 'Attached ID Label' : 'Attached to Structure');
    // text beside a structure lines up towards it; above and below, centred (Line up changes it back)
    if (tied.every((x) => x.attach!.role !== 'descriptors')) {
      const roles = new Set(tied.map((x) => x.attach!.role));
      this.select<'label' | 'caption'>('Kind', TIED_KINDS, roles.size === 1 ? a.role as 'label' | 'caption' : 'caption', (v) => this.edit(v === 'label' ? 'Make ID label' : 'Make caption', () => {
        for (const x of tied) this.doc.updateCaption(x.id, { attach: { ...x.attach!, role: v } });
      }));
    }
    this.select<AttachSide>('Sits', SIDES, a.side, (v) => this.edit('Caption side', () => {
      for (const x of tied) {
        const at: Attachment = { ...x.attach!, side: v, shift: 0 };
        if (v === 'left' || v === 'right') delete at.align;
        this.doc.updateCaption(x.id, { attach: at, justify: v === 'right' ? 'left' : v === 'left' ? 'right' : at.align ?? 'center' });
      }
    }));
    this.number('Gap (pt)', round(a.gap, 10), 0.5, -200, 500, (v) => setA('Caption gap', () => ({ gap: v })),
      'Space between the structure (with its atom labels) and the caption. You can also drag the caption.');
    this.number('Shift (pt)', round(a.shift, 10), 0.5, -1000, 1000, (v) => setA('Caption shift', () => ({ shift: v })),
      'How far off the middle of its side: across for below and above, down for left and right. 0 centers it.');
    const desc = tied.filter((x) => x.attach!.role === 'descriptors');
    if (desc.length) {
      const show = new Set<DescriptorKey>(desc[0].attach!.show ?? []);
      const choices = descriptorChoices();
      for (const d of choices) {
        this.check(d.label, show.has(d.key), (v) => setA(`Show ${d.label.toLowerCase()}`, (x) => {
          if (x.role !== 'descriptors') return {};
          const now = new Set(x.show ?? []);
          if (v) now.add(d.key); else now.delete(d.key);
          // keep the usual order; the text is worked out again
          return { show: choices.map((y) => y.key).filter((k) => now.has(k)), sig: undefined, keepText: undefined };
        }));
      }
      const ions: Opt<string>[] = COMMON_ADDUCTS.map((x) => [x, x]);
      const ion = desc[0].attach!.adduct ?? '[M+H]+';
      if (!COMMON_ADDUCTS.includes(ion)) ions.push([ion, ion]);
      this.select('Ion (m/z, HRMS)', ions, ion, (v) => setA('Ion', (x) => (x.role === 'descriptors' ? { adduct: v, sig: undefined, keepText: undefined } : {})));
      this.check('Update when the structure changes', !desc[0].attach!.keepText, (v) => setA(v ? 'Update descriptors' : 'Keep descriptor text', (x) => (x.role === 'descriptors' ? { keepText: v ? undefined : true, sig: v ? undefined : x.sig } : {})),
        'Turn off to keep the text as it is, for instance after typing over it by hand.');
    }
    button('Reset to Default Style', 'Give it the ID label or caption style and position set in File ▸ Drawing Style', () =>
      this.edit('Reset to Default Style', () => { for (const x of tied) this.doc.updateCaption(x.id, lookPatch(this.doc, x, attachedAtoms(this.doc, x.attach!))); }));
    button('Unpin from Structure', 'Leave the caption where it is as ordinary text: it no longer follows the structure', () =>
      this.edit('Unpin Caption', () => { for (const x of tied) this.doc.updateCaption(x.id, { attach: undefined }); }));
    if (loose.length && this.tie) button('Tie the others too', 'Tie the selected captions that are loose to the structure nearest each', () => this.tie?.(loose.map((x) => x.id)));
  }

  // ------------------------------------------------------------------ building blocks

  // ------------------------------------------------------------------ one atom, one bond

  private atomControls(a: Atom): void {
    const set = (label: string, patch: Partial<Atom>) => this.edit(label, () => this.doc.updateAtom(a.id, patch));
    if (a.multi) {
      this.heading(`Middle of ${a.multi.length === 2 ? 'a π-bond' : 'a ring'} (${haptoText(a.multi.length)})`);
      const note = document.createElement('p');
      note.className = 'muted';
      note.textContent = 'Where a metal\'s hapto bond ends. It stays in the middle of its atoms; delete it to remove the bond.';
      this.help(note.textContent);
      return;
    }
    if (a.attach) {
      this.heading('Point of attachment');
      const kind = a.attach === 'Unspecified' || a.attach === 'Diamond' ? 'Numbered' : a.attach;
      const kinds: Opt<string>[] = [['Wavy', 'Wavy bond'], ['Star', 'Star (*)'], ['Numbered', 'Numbered (diamond)']];
      if (!kinds.some(([v]) => v === kind)) kinds.push([kind, kind]);
      this.select('Kind', kinds, kind, (v) => set('Attachment point', v === 'Numbered'
        ? { attach: 'Unspecified', attachNum: a.attachNum ?? nextNumber(this.doc, a.id, (x) => (x.attach ? x.attachNum : undefined)) }
        : { attach: v, attachNum: undefined }));
      if (kind === 'Numbered') this.number('Number', a.attachNum ?? 0, 1, 0, 99, (v) => set('Attachment number', { attachNum: v || undefined }),
        'The number in the black diamond; 0 for none.');
      return;
    }
    this.heading('Atom');
    this.text('Label', a.label ?? '', a.z === 6 ? 'carbon (no label)' : 'automatic', (v) => this.edit('Label', () => this.applyLabel(a.id, v)),
      'Type a label (O, NH₂, OTBS, CO₂Et…); leave empty for a plain carbon.');
    this.number('Charge', a.charge, 1, -8, 8, (v) => set('Charge', { charge: v }));
    this.color('Color', a.color, (v) => set('Atom color', { color: v }));
    this.color('Highlight', a.highlight, (v) => { set(v ? 'Highlight' : 'Remove highlight', { highlight: v }); if (v) this.highlightUsed(v); }, 'None');
    this.highlightControls([a], []);
    if (a.label || a.z !== 6 || a.showCarbon) this.labelFontControls([a]);
    if (a.label || a.z !== 6 || a.showCarbon) {
      this.select('Label alignment', LABEL_ALIGNS, labelAlignment(a), (v) => this.edit('Label alignment', () => this.doc.updateAtom(a.id, labelAlignPatch(this.doc, a, v))));
    } else if (a.z === 6 && this.doc.degree(a.id) === 3 && (this.doc.adj.get(a.id) ?? []).every((bid) => ringsThroughBond(this.doc, bid).length > 0)) {
      // a ring-fusion carbon: its H shown as a dot (toward the viewer) or a hashed dot (away)
      this.select<'' | 'dot' | 'dash'>('Ring-fusion H', [['', 'None'], ['dot', 'H-Dot (toward viewer)'], ['dash', 'H-Dash (away from viewer)']], a.hDot ?? '',
        (v) => set(v ? 'Ring-fusion H' : 'No ring-fusion H', { hDot: v || undefined }));
    }
    if (methylState(this.doc, [a.id]) !== 'none') this.methylControls([a.id]);
    else if (a.z === 6 && !a.label && this.doc.degree(a.id) > 0) {
      this.check('Show C and its H', !!a.showCarbon, (v) => set(v ? 'Show carbon' : 'Hide carbon', { showCarbon: v || undefined }));
    }
    this.check('Show atom number', !!a.showNumber, (v) => set(v ? 'Show atom number' : 'Hide atom number',
      v ? { showNumber: true, atomNumber: a.atomNumber || String(nextNumber(this.doc, a.id, (x) => x.atomNumber)) } : { showNumber: false }));
    if (a.showNumber || a.atomNumber) {
      this.text('Atom number', a.atomNumber ?? '', 'number', (v) => set('Atom number', { atomNumber: v.trim() || undefined, showNumber: !!v.trim() && a.showNumber }),
        'Any text: 1, 2a, C-7…');
    }
  }

  private bondControls(b: Bond): void {
    const set = (label: string, patch: Partial<Bond>) => this.edit(label, () => this.doc.updateBond(b.id, patch));
    const centre = centreEnd(this.doc, b);
    if (centre?.variable) {
      // a group on one of several ring atoms
      this.heading('Variable attachment');
      this.help(`The group is on one of ${centre.multi!.length} ring atoms. With the Variable Attachment tool (on the Hapto bond button), click a ring atom to add it or remove it.`);
      this.select('Style', BOND_STYLES.filter(([v]) => !['wedge', 'hashWedge', 'hollowWedge', 'wavyWedge', 'hydrogen', 'ionic', 'dative'].includes(v)), b.display, (v) => set('Bond style', { display: v }));
      this.color('Color', b.color, (v) => set('Bond color', { color: v }));
      return;
    }
    if (centre) {
      // a metal bonded to the middle of a ring or π-bond
      this.heading(`Hapto bond (${haptoText(centre.multi!.length)})`);
      this.select('Style', BOND_STYLES.filter(([v]) => v !== 'wedge' && v !== 'hashWedge'), b.display, (v) => set('Bond style', { display: v }));
      this.check('A line to each atom', !!b.spokes, (v) => set(v ? 'Hapto bond to each atom' : 'Hapto bond to the middle', { spokes: v || undefined }),
        'Draw a line from the metal to each atom of the ring or π-bond, instead of one line to its middle. ChemDraw shows it to the middle either way.');
      this.color('Color', b.color, (v) => set('Bond color', { color: v }));
      const row = document.createElement('div');
      row.className = 'style-buttons';
      const split = document.createElement('button');
      split.type = 'button';
      split.textContent = 'Split into single bonds';
      split.title = 'Replace the hapto bond with an ordinary bond from the metal to each atom (σ bonds, or a κ chelate)';
      split.addEventListener('click', () => this.edit('Split hapto bond', () => { splitHapto(this.doc, b.id); }));
      row.append(split);
      this.body.appendChild(row);
      return;
    }
    this.heading('Bond');
    // a partial bond is drawn dashed (until another style is chosen)
    this.select('Order', BOND_ORDERS, String(b.order), (v) => this.edit('Bond order', () => {
      this.doc.updateBond(b.id, { order: Number(v), ...(Number(v) === 0.5 && b.display === 'solid' ? { display: 'dash' as const } : {}) });
      straightenAt(this.doc, b.id);
    }));
    const styles = b.order === 2 ? DOUBLE_STYLES : b.order === 1 || b.order === 0.5 ? BOND_STYLES : BOND_STYLES.filter(([v]) => !['hollowWedge', 'wavyWedge', 'hydrogen', 'ionic', 'dative'].includes(v));
    this.select('Style', styles.some(([v]) => v === b.display) ? styles : [...styles, ...BOND_STYLES.filter(([v]) => v === b.display)], b.display, (v) => set('Bond style', { display: v }));
    if (b.order === 2 && b.display !== 'wavy') {
      this.select('Second line', DOUBLE_POS, b.dpos, (v) => set('Double bond position', { dpos: v }));
      this.select('Second line style', SECOND_LINES, b.line2 ?? '', (v) => set('Second line style', { line2: (v || undefined) as Bond['line2'] }));
    }
    this.color('Color', b.color, (v) => set('Bond color', { color: v }));
    this.color('Highlight', b.highlight, (v) => { set(v ? 'Highlight' : 'Remove highlight', { highlight: v }); if (v) this.highlightUsed(v); }, 'None');
    this.highlightControls([], [b]);
  }

  /**
   * How the highlight on these atoms and bonds is drawn: a saved look, its shape, smooth or
   * ends and size, then folded groups for placement, fill and texture, outline, soft edges,
   * shadow and glow (each saying in a word or two how it is set while folded).
   */
  private highlightControls(atoms: Atom[], bonds: Bond[]): void {
    const lit = [...atoms, ...bonds].filter((x) => x.highlight);
    if (!lit.length) return;
    const st = fullStyle(lit[0].hl);
    const set = (label: string, patch: HighlightStyle) => {
      this.edit(label, () => {
        for (const a of atoms) if (a.highlight) this.doc.updateAtom(a.id, { hl: tidyStyle({ ...a.hl, ...patch }) });
        for (const b of bonds) if (b.highlight) this.doc.updateBond(b.id, { hl: tidyStyle({ ...b.hl, ...patch }) });
      });
      this.highlightStyleUsed({ ...st, ...patch });
    };
    const pct = (x: number) => Math.round(x * 100);
    const looks = this.highlightLooks.list();
    if (looks.length) {
      this.select<string>('Style', [['', 'Choose a style…'], ...looks.map((l, i): Opt<string> => [String(i), l.name])], '', (v) => { if (v !== '') this.highlightLooks.apply(looks[Number(v)]); });
    }
    this.select<HighlightShape>('Highlight shape', HL_SHAPES, st.shape, (v) => set('Highlight shape', { shape: v }));
    // straight highlights are always one even band; round ones can have a disc on each atom
    if (st.shape === 'round') this.check('Smooth outline', st.smooth, (v) => set(v ? 'Smooth highlight' : 'Highlight with discs', { smooth: v }),
      'One even band along the bonds, with no disc bulging out at each atom (Chemistry ▸ Highlight and Fill ▸ Smooth Highlight).');
    else this.select<HighlightEnds>('Highlight ends', HL_ENDS, st.ends, (v) => set('Highlight ends', { ends: v }));
    this.number('Highlight size (%)', pct(st.size), 10, 20, 400, (v) => set('Highlight size', { size: v / 100 }),
      '100% is the usual size; larger for a bolder highlight.');

    this.group('Placement', [st.centre && 'centred', !st.fit && 'labels not held'].filter(Boolean).join(', ') || 'on the bonds', () => {
      this.check('Center on double bonds', st.centre, (v) => set(v ? 'Center highlight on double bonds' : 'Highlight on the bonds', { centre: v }),
        'Center the highlight between a double bond\'s two lines, and in rings between the ring and its inner double-bond lines (Chemistry ▸ Highlight and Fill ▸ Center Highlight on Double Bonds).');
      this.check('Grow around atom labels', st.fit, (v) => set(v ? 'Highlight around labels' : 'Highlight not around labels', { fit: v }),
        'Make the highlight under a labeled atom (Me, OTBS, CO₂Et) big enough to hold its whole label.');
    });

    const fillName = HL_FILLS.find(([v]) => v === st.fill)![1].split(' (')[0];
    this.group('Fill and texture', [fillName, st.transparency > 0 && `${pct(st.transparency)}% transparent`, st.pattern !== 'none' && PATTERN_OPTS.find(([v]) => v === st.pattern)?.[1].split(' (')[0].toLowerCase()].filter(Boolean).join(', '), () => {
      this.select<HighlightFill>('Fill', HL_FILLS, st.fill, (v) => set('Highlight fill', { fill: v }));
      if (st.fill === 'linear' || st.fill === 'edge') {
        this.color(st.fill === 'edge' ? 'Color at the edge' : 'Second color', st.colour2 || undefined, (v) => set('Highlight gradient color', { colour2: v ?? '' }), 'White', '#ffffff');
        if (st.fill === 'linear') {
          const dirs = GRAD_DIRS.filter(([v]) => v !== 'radial');
          this.select<string>('Direction', dirs.some(([v]) => v === String(st.gradAngle)) ? dirs : [...dirs, [String(st.gradAngle), `${st.gradAngle}°`]], String(st.gradAngle), (v) => set('Highlight gradient direction', { gradAngle: Number(v) }));
        }
      }
      this.number('Transparency (%)', pct(st.transparency), 5, 0, 100, (v) => set('Highlight transparency', { transparency: v / 100 }), 'How much shows through the fill and texture: 0 is solid');
      this.patternPicker('Texture', st.pattern, (v) => set('Highlight texture', { pattern: v as HighlightStyle['pattern'] }));
      if (st.pattern === 'dots' || st.pattern === 'dense-dots') {
        this.densityPicker(st.patternSize || (st.pattern === 'dense-dots' ? DOT_DENSITY[2].gap : DOT_DENSITY[1].gap), false, (gap) => set('Highlight dot density', { pattern: 'dots', patternSize: gap }));
      }
      if (st.pattern !== 'none') {
        this.color('Texture color', st.patternColour || undefined, (v) => set('Highlight texture color', { patternColour: v ?? '' }), 'A darker shade', '#808080');
        this.number('Texture spacing (pt)', st.patternSize, 0.25, 0, 40, (v) => set('Highlight texture spacing', { patternSize: v }), 'How far apart the lines or dots are: 0 for the usual spacing');
      }
    });

    this.group('Outline', st.line === 'none' ? 'none' : HL_LINES.find(([v]) => v === st.line)![1].toLowerCase(), () => {
      this.select<HighlightLine>('Line around it', HL_LINES, st.line, (v) => set('Highlight outline', { line: v }));
      if (st.line !== 'none') {
        this.color('Line color', st.lineColour || undefined, (v) => set('Highlight outline color', { lineColour: v ?? '' }), 'A darker shade', '#808080');
        this.number('Line width (pt)', st.lineWidth, 0.25, 0.25, 10, (v) => set('Highlight outline width', { lineWidth: v }));
      }
      if (st.fill !== 'none') this.help('For an outline on its own, set Fill to None (Chemistry ▸ Highlight and Fill ▸ Outline-Only Highlight).');
    });

    this.group('Soft edges', st.soft ? `${pct(st.softAmount)}%, ${HL_SOFT_SIDES.find(([v]) => v === st.softSide)![1].split(' (')[0].toLowerCase()}` : 'off', () => {
      this.check('Soft edges', st.soft, (v) => set(v ? 'Soft highlight' : 'Sharp highlight', { soft: v }), 'Fade the highlight out instead of a sharp edge (Chemistry ▸ Highlight and Fill ▸ Soft Highlight Edges).');
      if (st.soft) {
        this.number('Soft Edge Amount (%)', pct(st.softAmount), 5, 5, 100, (v) => set('Soft edge amount', { softAmount: v / 100 }),
          'How much of the band fades, measured from its edge in to its middle: 25% fades only the outer quarter');
        this.select<HighlightSoftSide>('Fades', HL_SOFT_SIDES, st.softSide, (v) => set('Soft edge side', { softSide: v }));
      }
    });

    this.group('Shadow', st.shadow ? `${pct(st.shadowOpacity)}%${st.shadowBlur > 0 ? ', blurred' : ''}` : 'off', () => {
      this.check('Shadow', st.shadow, (v) => set(v ? 'Highlight shadow' : 'No highlight shadow', { shadow: v }), 'A drop shadow under the highlight (Chemistry ▸ Highlight and Fill ▸ Highlight Shadow).');
      if (st.shadow) this.shadowRows(
        { colour: st.shadowColour, opacity: st.shadowOpacity, angle: st.shadowAngle, distance: pct(st.shadowDistance), blur: pct(st.shadowBlur) }, '% of a bond',
        (p) => set('Highlight shadow', {
          ...(p.colour !== undefined ? { shadowColour: p.colour } : {}), ...(p.opacity !== undefined ? { shadowOpacity: p.opacity } : {}), ...(p.angle !== undefined ? { shadowAngle: p.angle } : {}),
          ...(p.distance !== undefined ? { shadowDistance: p.distance / 100 } : {}), ...(p.blur !== undefined ? { shadowBlur: p.blur / 100 } : {}),
        }));
    });

    this.group('Glow', st.glow ? `${pct(st.glowSize)}%` : 'off', () => {
      this.check('Glow', st.glow, (v) => set(v ? 'Highlight glow' : 'No highlight glow', { glow: v }), 'A soft halo of color around the outside (Chemistry ▸ Highlight and Fill ▸ Highlight Glow).');
      if (st.glow) {
        this.color('Glow color', st.glowColour || undefined, (v) => set('Glow color', { glowColour: v ?? '' }), 'The highlight\'s', '#ffe680');
        this.number('Glow size (% of a bond)', pct(st.glowSize), 1, 1, 200, (v) => set('Glow size', { glowSize: v / 100 }));
        this.number('Glow Transparency (%)', pct(st.glowTransparency), 5, 0, 95, (v) => set('Glow transparency', { glowTransparency: v / 100 }));
      }
    });

    const row = document.createElement('div');
    row.className = 'style-buttons';
    const save = document.createElement('button');
    save.type = 'button';
    save.textContent = 'Save Style…';
    save.title = 'Keep this highlight\'s style (and color) under a name, to use again in any drawing (Chemistry ▸ Highlight and Fill ▸ Save Highlight Style)';
    save.addEventListener('click', () => this.highlightLooks.save());
    row.append(save);
    this.body.append(row);
  }

  /** A drop shadow's colour, darkness, direction, distance and blur (distance and blur in `unit`). */
  private shadowRows(now: { colour: string; opacity: number; angle: number; distance: number; blur: number }, unit: string, on: (patch: Partial<typeof now>) => void): void {
    this.color('Shadow color', now.colour === '#000000' ? undefined : now.colour, (v) => on({ colour: v ?? '#000000' }), 'Black', '#000000');
    this.number('Shadow Opacity (%)', Math.round(now.opacity * 100), 5, 0, 100, (v) => on({ opacity: v / 100 }));
    const a = Math.round(now.angle);
    this.select<string>('Falls', SHADOW_DIRS.some(([v]) => Number(v) === a) ? SHADOW_DIRS : [...SHADOW_DIRS, [String(a), `${a}°`]], String(a), (v) => on({ angle: Number(v) }));
    this.number(`Distance (${unit})`, round(now.distance), unit === 'pt' ? 0.25 : 1, 0, unit === 'pt' ? 50 : 200, (v) => on({ distance: v }));
    this.number(`Blur (${unit})`, round(now.blur), unit === 'pt' ? 0.25 : 1, 0, unit === 'pt' ? 50 : 200, (v) => on({ blur: v }), 'How far the shadow fades out: 0 for a sharp shadow');
  }

  /** Settings that fold away under a title, with a word or two saying how they are set. */
  private group(title: string, state: string, fill: () => void): void {
    const d = document.createElement('details');
    d.className = 'style-group';
    d.open = OPEN_GROUPS.has(title);
    const sum = document.createElement('summary');
    const name = document.createElement('span');
    name.textContent = title;
    const st = document.createElement('span');
    st.className = 'style-group-state';
    st.textContent = state;
    sum.append(name, st);
    d.append(sum);
    // which groups are open is remembered (for the rest of the session), so a setting stays in view
    d.addEventListener('toggle', () => { if (d.open) OPEN_GROUPS.add(title); else OPEN_GROUPS.delete(title); });
    const body = this.body;
    this.body = d;
    try { fill(); } finally { this.body = body; }
    body.append(d);
  }

  /** Several atoms and bonds: their colour (labels and lines together). */
  private structureControls(atoms: Atom[], bonds: Bond[]): void {
    const parts = [atoms.length && `${atoms.length} atom${atoms.length > 1 ? 's' : ''}`, bonds.length && `${bonds.length} bond${bonds.length > 1 ? 's' : ''}`].filter(Boolean);
    this.heading(parts.join(', '));
    const first = atoms[0]?.color ?? bonds[0]?.color;
    this.color('Color', first, (v) => this.edit('Color', () => {
      for (const a of atoms) this.doc.updateAtom(a.id, { color: v });
      for (const b of bonds) this.doc.updateBond(b.id, { color: v });
    }));
    // a highlight picks out part of a structure: a disc under each atom and a band under each bond
    const hl = [...atoms, ...bonds].map((x) => x.highlight);
    this.color('Highlight', hl.every((c) => c === hl[0]) ? hl[0] : undefined, (v) => {
      this.edit(v ? 'Highlight' : 'Remove highlight', () => {
        for (const a of atoms) this.doc.updateAtom(a.id, { highlight: v });
        for (const b of bonds) this.doc.updateBond(b.id, { highlight: v });
      });
      if (v) this.highlightUsed(v);
    }, 'None');
    this.highlightControls(atoms, bonds);
    if (atoms.length) this.labelFontControls(atoms);
    if (bonds.length >= 3 && this.ringFill) {
      const row = document.createElement('div');
      row.className = 'style-buttons';
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = 'Fill Rings';
      b.title = 'Color in, shade or hatch the rings in the selection (Chemistry ▸ Highlight and Fill ▸ Fill Rings)';
      b.addEventListener('click', () => this.ringFill?.());
      row.append(b);
      this.body.append(row);
    }
    this.methylControls(atoms.map((a) => a.id));
    this.focalControls(atoms);
  }

  /** One whole structure picked: what its focal point is on, with Reset and Pick on the drawing. */
  private focalControls(atoms: Atom[]): void {
    if (!atoms.length || !this.focalPick) return;
    const frag = this.doc.fragmentOf(atoms[0].id);
    if (frag.size !== atoms.length || atoms.some((a) => !frag.has(a.id))) return;
    const kind = focalKind(this.doc, frag);
    const names = { atom: 'Atom', bond: 'Bond', ring: 'Ring' } as const;
    const sel = document.createElement('select');
    const opts: [string, string][] = [...(kind ? [['own', names[kind]] as [string, string]] : []), ['box', 'Center of box'], ['pick', 'Click an atom, bond or ring…']];
    for (const [v, text] of opts) {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = text;
      sel.appendChild(o);
    }
    sel.value = kind ? 'own' : 'box';
    sel.addEventListener('change', () => {
      if (sel.value === 'box' && kind) this.edit('Reset Focal Point', () => clearFocal(this.doc, frag));
      else if (sel.value === 'pick') { sel.value = kind ? 'own' : 'box'; this.focalPick?.(); }
    });
    const row = document.createElement('label');
    row.className = 'style-row';
    const name = document.createElement('span');
    name.textContent = 'Focal point';
    addInfo(name, 'The spot that counts as this structure\'s middle when lining things up (Align Center and Middle, Distribute, Arrange). Set it on an atom, a bond or a ring so compounds that share a core line up on the core. Center of box goes back to the middle of the structure.');
    row.append(name, sel);
    this.body.appendChild(row);
  }

  /**
   * The labels' own font and size (as Home ▸ Font sets them with atoms picked): an empty font box
   * shows the drawing's font, greyed, and goes back to it.
   */
  private labelFontControls(list: Atom[]): void {
    const atoms = labelAtoms(this.doc, list.map((a) => a.id));
    if (!atoms.length) return;
    const look = labelLookOf(this.doc, atoms);
    const font = document.createElement('input');
    font.type = 'text';
    font.className = 'style-font';
    font.spellcheck = false;
    font.value = look.font ?? '';
    font.placeholder = look.mixedFont ? 'Mixed' : this.doc.style.labelFont || 'Arial';
    font.setAttribute('aria-label', 'Label font');
    font.setAttribute('list', 'ci-fonts');
    font.addEventListener('change', () => this.edit('Label font', () => setLabelFont(this.doc, atoms, font.value)));
    font.addEventListener('keydown', (e) => { if (e.key === 'Enter') font.blur(); e.stopPropagation(); });
    const row = document.createElement('label');
    row.className = 'style-row';
    const name = document.createElement('span');
    name.textContent = 'Label font';
    addInfo(name, 'The font and size of the selected atoms\' labels (Home ▸ Font sets them too). Leave the font empty for the drawing\'s (Drawing Style). A structure from ChemDraw keeps its labels\' own font.');
    row.append(name, font);
    this.body.appendChild(row);
    const size = document.createElement('input');
    size.type = 'number';
    size.step = '0.5';
    size.min = '1';
    size.max = '400';
    size.value = look.size !== undefined ? String(look.size) : '';
    size.placeholder = look.size === undefined ? 'Mixed' : '';
    size.addEventListener('change', () => { const v = Number(size.value); if (size.value.trim() && v > 0) this.edit('Label size', () => setLabelSize(this.doc, atoms, Math.min(400, v))); });
    size.addEventListener('keydown', (e) => { if (e.key === 'Enter') size.blur(); e.stopPropagation(); });
    this.row('Label size (pt)', size);
  }

  /** Terminal methyls among these atoms: not written out, CH3 or Me (Chemistry > Show Terminal Methyls). */
  private methylControls(ids: number[]): void {
    // (no atoms would mean the whole drawing to the methyl commands)
    const now = ids.length ? methylState(this.doc, ids) : 'none';
    if (now === 'none') return;
    const opts: Opt<string>[] = [['hidden', 'Not written out'], ['CH3', 'CH3'], ['Me', 'Me']];
    if (now === 'mixed') opts.unshift(['mixed', 'Mixed']);
    this.select('Terminal methyls', opts, now, (v) => {
      if (v !== 'mixed') this.edit('Terminal Methyls', () => writeTerminalMethyls(this.doc, ids, v as MethylStyle | 'hidden'));
    });
  }

  // ------------------------------------------------------------------ electron count

  /**
   * A metal complex's electron count (chem/electrons.ts): the summary, how it compares with the
   * count expected, the ligands with their types (each can be changed), and the oxidation state,
   * charge and expected count, each automatic or set by hand (kept on the metal, Atom.ecount).
   */
  private electronControls(c: MetalCount): void {
    const metal = c.metal;
    const set = (label: string, patch: (now: ElectronCountSettings) => ElectronCountSettings) => this.edit(label, () => {
      const now = this.doc.atoms.get(metal)?.ecount ?? {};
      const next: ElectronCountSettings = { ...patch({ ...now }) };
      if (next.types && !Object.keys(next.types).length) delete next.types;
      for (const k of Object.keys(next) as (keyof ElectronCountSettings)[]) if (next[k] === undefined) delete next[k];
      this.doc.updateAtom(metal, { ecount: Object.keys(next).length ? next : undefined });
    });
    this.heading('Electron Count');
    const method = electronPrefs.method;
    const neutralOn = method !== 'ionic', ionicOn = method !== 'neutral';
    this.help('Two ways of counting that give the same total. Neutral: the metal atom\'s own electrons, two from each L ligand and one from each X, then the charge taken away (or added for an anion). Ionic: the metal ion\'s d electrons (after its oxidation state), two from each L and two from each X counted as an anion. L gives a lone pair, X shares one electron, Z takes two (Green\'s classes). Change a ligand\'s type below when the automatic one is wrong. Settings ▸ Preferences ▸ Electron Counting Method shows only one of the two.');
    const box = document.createElement('div');
    box.className = 'ec-panel';
    const head = document.createElement('p');
    head.className = 'ec-sum';
    const [lead, cls] = countSummary(c).split(' · ');
    const strong = document.createElement('b');
    strong.textContent = lead;
    head.append(strong, ` · ${cls}`);
    // how it compares with the count expected: a quiet note, here only (never in the drawing)
    const status = document.createElement('p');
    status.className = 'ec-status' + (c.electrons === c.expected.value ? '' : ' off');
    status.textContent = `${c.electrons} of ${c.expected.value} expected: ${c.expected.reason}`;
    box.append(head, status);

    const table = document.createElement('table');
    table.className = 'ec-panel-table';
    const tr = (cells: (string | HTMLElement)[], cls = '') => {
      const row = document.createElement('tr');
      if (cls) row.className = cls;
      for (const x of cells) {
        const td = document.createElement('td');
        td.append(typeof x === 'string' ? scripted(x) : x);
        row.append(td);
      }
      table.append(row);
      return row;
    };
    const th = document.createElement('tr');
    for (const [t, tip] of [['Ligand', ''], ['Type', ''], ...(neutralOn ? [['Neutral', 'Neutral counting: the metal atom\'s electrons, one from each X, two from each L']] : []), ...(ionicOn ? [['Ionic', 'Ionic counting: the metal ion\'s d electrons, two from each X and each L']] : [])]) {
      const h = document.createElement('th');
      h.textContent = t;
      if (tip) h.title = tip;
      th.append(h);
    }
    table.append(th);
    tr([c.symbol, 'metal', ...(neutralOn ? [String(c.group)] : []), ...(ionicOn ? [`d${sup(c.dn)}: ${c.dn}`] : [])]).cells[1].className = 'muted';
    const own = c.settings.types ?? {};
    for (const r of c.ligands) {
      let type: string | HTMLElement = typeText(r.type);
      // (set by hand by its name and the type worked out for it: a bridging Cl's X and L rows are apart)
      const key = typeKey(r.name, r.auto);
      if (!r.mm) {
        const sel = document.createElement('select');
        sel.setAttribute('aria-label', `Type of ${r.name}`);
        const codes = [...new Set([r.type, r.auto, ...LIGAND_TYPES])];
        for (const code of codes) {
          const o = document.createElement('option');
          o.value = code;
          o.textContent = code === r.auto && own[key] ? `${typeText(code)} (auto)` : typeText(code);
          sel.append(o);
        }
        sel.value = r.type;
        if (own[key]) sel.classList.add('own');
        sel.title = own[key] ? `Set by hand (automatic: ${typeText(r.auto)})` : 'Calculated from the drawing; choose another type to change it';
        sel.addEventListener('change', () => set('Ligand Type', (now) => {
          const types = { ...now.types };
          // choosing the automatic type again forgets the one set by hand
          if (sel.value === r.auto) delete types[key];
          else types[key] = sel.value;
          return { ...now, types };
        }));
        type = sel;
      }
      tr([ligandText(r), type, ...(neutralOn ? [String(r.neutral * r.count)] : []), ...(ionicOn ? [String(r.ionic * r.count)] : [])]);
    }
    if (c.charge) tr([`Charge ${signed(c.charge)}`, '', ...(neutralOn ? [signed(-c.charge)] : []), ...(ionicOn ? [`in d${sup(c.dn)}`] : [])]);
    tr(['Total', '', ...(neutralOn ? [String(c.electrons)] : []), ...(ionicOn ? [String(c.ionicTotal)] : [])], 'ec-total');
    box.append(table);
    // an oxidation state set by hand that the ligand types don't give: the two totals differ, and say why
    const differ = countsDiffer(c);
    if (differ) {
      const why = document.createElement('p');
      why.className = 'ec-status off ec-differ';
      why.textContent = differ;
      box.append(why);
    }
    this.body.append(box);

    // the oxidation state: automatic (from the X ligands and the charge) or chosen
    const ox = document.createElement('select');
    const oxOpt = (v: string, text: string) => { const o = document.createElement('option'); o.value = v; o.textContent = text; ox.append(o); };
    oxOpt('auto', `Auto (${signed(c.autoOxidation)})`);
    // (−4 up to the group number, at most +9: no fewer than no d electrons)
    const lo = ECOUNT_RANGE.ox[0], hi = Math.min(ECOUNT_RANGE.ox[1], c.group);
    for (let v = lo; v <= hi; v++) oxOpt(String(v), `${signed(v)} (${roman(v)})`);
    ox.value = c.settings.ox === undefined ? 'auto' : String(c.settings.ox);
    ox.addEventListener('change', () => set('Oxidation State', (now) => ({ ...now, ox: ox.value === 'auto' ? undefined : Number(ox.value) })));
    this.infoRow('Oxidation State', ox, 'Automatic: the number of X ligands plus the complex\'s charge (a Z ligand takes none of the metal\'s electrons). Choose a value to use another; the neutral count does not depend on it, the ionic one does.');

    // the complex's charge: the charges drawn on it, or typed here (empty goes back to the drawing's)
    const q = document.createElement('input');
    q.type = 'number';
    q.step = '1';
    q.min = '-8';
    q.max = '8';
    q.value = String(c.charge);
    q.placeholder = String(c.autoCharge);
    if (c.settings.charge !== undefined) q.classList.add('own');
    q.title = c.settings.charge !== undefined ? `Set by hand (the drawing has ${signed(c.autoCharge)}); clear the box to use the drawing's charge` : 'The charges drawn on the complex, added up; type another to use it here';
    const setQ = () => {
      const v = q.value.trim() === '' ? undefined : Math.round(Number(q.value));
      if (v !== undefined && (!Number.isFinite(v) || Math.abs(v) > 8)) return;
      const keep = v === undefined || v === c.autoCharge ? undefined : v;
      if (keep !== c.settings.charge) set('Complex Charge', (now) => ({ ...now, charge: keep }));
    };
    q.addEventListener('change', setQ);
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') q.blur(); e.stopPropagation(); });
    this.row('Charge', q);

    // the count expected: automatic, a usual one, or any other typed in
    const exp = document.createElement('select');
    const expOpt = (v: string, text: string) => { const o = document.createElement('option'); o.value = v; o.textContent = text; exp.append(o); };
    expOpt('auto', `Auto (${c.expected.auto})`);
    const usual = ['18', '16', '14'];
    for (const v of usual) expOpt(v, v);
    const mine = c.settings.expect;
    if (mine !== undefined && !usual.includes(String(mine))) expOpt(String(mine), String(mine));
    expOpt('other', 'Other…');
    exp.value = mine === undefined ? 'auto' : String(mine);
    const holder = document.createElement('span');
    holder.className = 'ec-expect';
    holder.append(exp);
    exp.addEventListener('change', () => {
      if (exp.value !== 'other') { set('Expected Count', (now) => ({ ...now, expect: exp.value === 'auto' ? undefined : Number(exp.value) })); return; }
      // any other number, typed in place of the list
      const n = document.createElement('input');
      n.type = 'number';
      n.min = '2';
      n.max = '30';
      n.step = '1';
      n.value = String(c.expected.value);
      n.setAttribute('aria-label', 'Expected Count');
      const done = () => {
        const v = Math.round(Number(n.value));
        if (n.value.trim() && Number.isFinite(v) && v >= 2 && v <= 30) set('Expected Count', (now) => ({ ...now, expect: v }));
        else { this.key = ''; this.refresh(); }
      };
      n.addEventListener('change', done);
      n.addEventListener('keydown', (e) => { if (e.key === 'Enter') n.blur(); if (e.key === 'Escape') { this.key = ''; this.refresh(); } e.stopPropagation(); });
      holder.replaceChildren(n);
      n.focus();
      n.select();
    });
    this.infoRow('Expected Count', holder, 'Automatic: 18 (the 18-electron rule), or 16 for a d⁸ metal of groups 9 to 11 with four ligands, which is usually square planar (Miessler, Fischer and Tarr, Inorganic Chemistry, 5th ed., sections 13.3 and 10.6). Many complexes have other counts; choose or type the one you expect.');

    const buttons = document.createElement('div');
    buttons.className = 'style-buttons';
    const ins = document.createElement('button');
    ins.type = 'button';
    ins.textContent = 'Insert as Table';
    ins.title = 'Put this count beside the structure as an ordinary table (a copy: it does not change with the structure)';
    ins.disabled = !this.electronTable;
    ins.addEventListener('click', () => this.electronTable?.(metal, countRows(c)));
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.textContent = 'Reset Types';
    // (only types that still match a ligand count: one kept for a ligand since deleted does nothing)
    const anyOwn = c.ligands.some((r) => !r.mm && own[typeKey(r.name, r.auto)] !== undefined);
    reset.disabled = !anyOwn;
    reset.title = anyOwn ? 'Use the ligand types calculated from the drawing again' : 'Every ligand type is already the automatic one';
    reset.addEventListener('click', () => set('Reset Types', (now) => ({ ...now, types: undefined })));
    buttons.append(ins, reset);
    this.body.append(buttons);
  }

  /** A row whose label has an "i" tip beside it. */
  private infoRow(label: string, control: HTMLElement, tip: string): void {
    const row = document.createElement('label');
    row.className = 'style-row';
    const name = document.createElement('span');
    name.textContent = label;
    addInfo(name, tip);
    row.append(name, control);
    this.body.appendChild(row);
  }

  // ------------------------------------------------------------------ stereo labels

  private stereoControls(centres: Atom[], dbls: Bond[]): void {
    const info = this.doc.stereo;
    const n = centres.length + dbls.length;
    this.heading(n > 1 ? 'Stereo labels' : centres.length ? 'Stereocenter' : 'Double bond');
    const found = [...centres.map((a) => info?.atom(a.id)), ...dbls.map((b) => info?.bond(b.id))].filter(Boolean);
    if (found.length) this.note(`Calculated: ${found.join(', ')}`);
    if (centres.some((a) => info?.undecided?.('a', a.id)) || dbls.some((b) => info?.undecided?.('b', b.id))) {
      this.note('An R, Ar or unrecognized group determines priority here, so CIP rules can\'t assign a label. Type one below if needed.');
    }
    const shown = [...centres, ...dbls].every((x) => x.showStereo || x.stereoLabel);
    this.check('Show label on drawing', shown, (v) => this.edit(v ? 'Show stereo label' : 'Hide stereo label', () => setStereoShown(this.doc, centres.map((a) => a.id), dbls.map((b) => b.id), v)));
    if (n === 1) {
      const a = centres[0], b = dbls[0];
      const l = a ? a.stereoLabel : b.stereoLabel;
      const auto = a ? info?.atom(a.id) : info?.bond(b.id);
      this.text('Label text', l?.manual ? l.text : '', auto ? `(${auto}), calculated` : 'calculated', (v) => this.edit('Stereo label text', () => setStereoText(this.doc, a ? 'a' : 'b', a ? a.id : b.id, v, arialWidth)),
        'Type a custom label (for example (R*) or rel-(S)); leave empty to show the calculated one.');
    }
  }

  /**
   * How to use what is selected, in an "i" beside the last heading (the section title for the
   * first thing styled): help never gets a line of its own.
   */
  private help(text: string): void {
    const hs = this.body.querySelectorAll<HTMLElement>(':scope > h3');
    const at = hs.length ? hs[hs.length - 1] : this.section.querySelector<HTMLElement>(':scope > h2');
    if (at?.querySelector(':scope > .info-icon')) {
      const i = at.querySelector<HTMLElement>(':scope > .info-icon')!;
      setInfo(i, `${i.dataset.tip ?? ''} ${text}`.trim());
      return;
    }
    if (!addInfo(at, text, 'style-help')) this.note(text);
  }

  private note(text: string): void {
    const p = document.createElement('p');
    p.className = 'muted small';
    p.textContent = text;
    this.body.appendChild(p);
  }

  private text(label: string, value: string, placeholder: string, on: (v: string) => void, help?: string): void {
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.value = value;
    inp.placeholder = placeholder;
    inp.addEventListener('change', () => on(inp.value));
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); e.stopPropagation(); });
    this.row(label, inp, help);
  }

  private edit(label: string, fn: () => void): void {
    this.doc.edit(label, fn);
    this.key = '';
    this.changed();
  }

  /**
   * The name of what is being styled: the first one goes up beside the section's own title
   * ("Style – Box"); any after it (a box's Frame) are headings in the panel.
   */
  private heading(text: string): void {
    if (!this.titled) {
      this.titled = true;
      this.subtitle(text);
      return;
    }
    const h = document.createElement('h3');
    h.textContent = text;
    this.body.appendChild(h);
  }

  /** The section title's second half, after "Style". */
  private subtitle(text: string): void {
    const h2 = this.section.querySelector<HTMLElement>(':scope > h2');
    if (!h2) return;
    let sp = h2.querySelector<HTMLElement>('.style-of');
    if (!sp) {
      sp = document.createElement('span');
      sp.className = 'style-of';
      h2.insertBefore(sp, h2.firstChild?.nextSibling ?? null);
    }
    sp.textContent = text ? ` – ${text}` : '';
  }

  /** A small label over a few rows that go together (a shape's border). */
  private subheading(text: string): void {
    const h = document.createElement('div');
    h.className = 'style-sub';
    h.textContent = text;
    this.body.appendChild(h);
  }

  private row(label: string, control: HTMLElement, help?: string): void {
    const l = document.createElement('label');
    l.className = 'style-row';
    const span = document.createElement('span');
    span.textContent = label;
    l.append(span, control);
    if (help) l.title = help;
    this.body.appendChild(l);
  }

  /** A row of pattern swatches to click (None, the lines, Dots), with the one in use pressed. */
  private patternPicker(label: string, value: string, on: (v: string) => void): void {
    const now = value === 'dense-dots' ? 'dots' : value;
    const row = document.createElement('div');
    row.className = 'style-row';
    const span = document.createElement('span');
    span.textContent = label;
    const grid = document.createElement('div');
    grid.className = 'swatch-grid';
    grid.setAttribute('role', 'radiogroup');
    grid.setAttribute('aria-label', label);
    for (const [v, name] of PATTERN_PICKS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch-btn';
      b.title = name;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(v === now));
      b.innerHTML = patternSwatch(v);
      b.addEventListener('click', () => { if (v !== now) on(v); });
      grid.append(b);
    }
    row.append(span, grid);
    this.body.append(row);
  }

  /** Sparse, Medium or Dense dots: their spacing. */
  private densityPicker(gap: number, ring: boolean, on: (gap: number) => void): void {
    const row = document.createElement('div');
    row.className = 'style-row';
    const span = document.createElement('span');
    span.textContent = 'Density';
    const seg = document.createElement('div');
    seg.className = 'seg';
    seg.setAttribute('role', 'radiogroup');
    seg.setAttribute('aria-label', 'Dot density');
    for (const d of DOT_DENSITY) {
      const g = ring ? d.ring : d.gap;
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = d.name;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(Math.abs(g - gap) < 0.05));
      b.addEventListener('click', () => on(g));
      seg.append(b);
    }
    row.append(span, seg);
    this.body.append(row);
  }

  /** Design shapes: the library's shapes in a drop-down of pictures (set up by the app). */
  pickShape?: (anchor: HTMLElement, pick: (id: string) => void) => void;

  /** The shape in use as a picture and its name; a click opens the library's shapes to pick another. */
  private shapePicker(id: string, on: (id: string) => void): void {
    const def = geoDef(id);
    const row = document.createElement('div');
    row.className = 'style-row';
    const span = document.createElement('span');
    span.textContent = 'Shape';
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'shape-pick';
    b.title = 'Change to another shape, keeping the size, colors and text';
    const c = document.createElement('canvas');
    drawGeoIcon(c, def, 20, getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#1d2330');
    const name = document.createElement('span');
    name.textContent = def.name;
    b.append(c, name, ' ▾');
    b.addEventListener('click', () => this.pickShape?.(b, on));
    row.append(span, b);
    this.body.append(row);
  }

  /** A dropdown; with `group`, options next to each other in one group go under its heading. */
  private select<T extends string>(label: string, opts: Opt<T>[], value: T, on: (v: T) => void, group?: (v: T) => string | undefined): void {
    const sel = document.createElement('select');
    let og: HTMLOptGroupElement | null = null;
    for (const [v, text] of opts) {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = text;
      const g = group?.(v);
      if (!g) { og = null; sel.appendChild(o); continue; }
      if (og?.label !== g) { og = document.createElement('optgroup'); og.label = g; sel.appendChild(og); }
      og.appendChild(o);
    }
    sel.value = value;
    sel.addEventListener('change', () => on(sel.value as T));
    this.row(label, sel);
  }

  private check(label: string, value: boolean, on: (v: boolean) => void, help?: string): void {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = value;
    box.addEventListener('change', () => on(box.checked));
    const l = document.createElement('label');
    l.className = 'style-row check';
    const span = document.createElement('span');
    span.textContent = label;
    l.append(box, span);
    if (help) l.title = help;
    this.body.appendChild(l);
  }

  private number(label: string, value: number, step: number, min: number, max: number, on: (v: number) => void, help?: string): void {
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.step = String(step);
    inp.min = String(min);
    inp.max = String(max);
    inp.value = String(value);
    const apply = () => {
      const v = Number(inp.value);
      if (inp.value.trim() !== '' && Number.isFinite(v)) on(Math.max(min, Math.min(max, v)));
    };
    inp.addEventListener('change', apply);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { apply(); inp.blur(); } e.stopPropagation(); });
    this.row(label, inp, help);
  }

  /** A colour row: the drawing's palette, "automatic" (black unless `auto` says otherwise), or any colour. */
  private color(label: string, value: string | undefined, on: (v: string | undefined) => void, auto?: string, autoSwatch?: string): void {
    this.row(label, colourButton(this.doc, value, (v) => on(v && v.toLowerCase() === '#000000' && !auto ? undefined : v), auto ? { autoLabel: auto, autoSwatch } : { autoSwatch: '#000000' }));
  }
}

/** Text with subscript and superscript characters (PPh₃, d⁸) shown with real sub and sup elements. */
function scripted(text: string): DocumentFragment {
  const f = document.createDocumentFragment();
  for (const m of text.matchAll(/([₀-₉]+)|([⁰¹²³⁴-⁹⁺⁻]+)|([^₀-₉⁰¹²³⁴-⁹⁺⁻]+)/g)) {
    if (m[3]) { f.append(m[3]); continue; }
    const el = document.createElement(m[1] ? 'sub' : 'sup');
    el.textContent = [...(m[1] ?? m[2])].map((ch) => {
      const k = '₀₁₂₃₄₅₆₇₈₉'.indexOf(ch), j = '⁰¹²³⁴⁵⁶⁷⁸⁹'.indexOf(ch);
      return k >= 0 ? String(k) : j >= 0 ? String(j) : ch === '⁺' ? '+' : '−';
    }).join('');
    f.append(el);
  }
  return f;
}

/** Rich text (markup, or an older diagram's text) put into an element with real subscripts and superscripts. */
function richInto(mo: MoSpec, text: string, into: HTMLElement): void {
  for (const p of moParts(mo, text)) {
    if (p.sub || p.sup) { const x = document.createElement(p.sub ? 'sub' : 'sup'); x.textContent = p.text; into.append(x); } else into.append(p.text);
  }
}

const SUP_DIGITS: Record<string, string> = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '+': '⁺', '−': '⁻', '-': '⁻' };

/** Markup as plain text for a box or a list: superscript digits and signs as Unicode superscripts (Co³⁺), the rest as plain letters. */
function supText(markup: string): string {
  return parseMarkup(markup).map((p) => (p.sup && [...p.text].every((c) => c in SUP_DIGITS) ? [...p.text].map((c) => SUP_DIGITS[c]).join('') : p.text)).join('');
}

/** A picture's kind, from its data, as people know it. */
function pictureType(src: string | undefined): string {
  const m = /^data:image\/([^;,]+)/.exec(src ?? '');
  const t = m?.[1] ?? '';
  return ({ png: 'PNG', jpeg: 'JPEG', gif: 'GIF', 'svg+xml': 'SVG (sharp at any size)', bmp: 'Bitmap', 'x-emf': 'Windows metafile (sharp at any size)', tiff: 'TIFF', webp: 'WebP' } as Record<string, string>)[t] ?? 'Picture';
}

/** A table with all its text at one size (runs that set their own size take the new one too). */
function resizeTableText(t: TableData, size: number): TableData {
  const plain = (runs: TextRunList) => runs.map((r) => { if (r.size === undefined) return r; const { size: _, ...rest } = r; return rest; });
  return {
    ...t,
    size,
    rows: t.rows.map((row) => row.map((cell) => ({ ...cell, runs: plain(cell.runs) }))),
    title: t.title && plain(t.title),
    notes: t.notes && plain(t.notes),
  };
}

type TextRunList = TableData['rows'][number][number]['runs'];

