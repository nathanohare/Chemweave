// @vitest-environment jsdom
//
// Standing rule R3 (automates review item 79): every field of every object in the drawing model
// survives each file it can go into. The fields are read from src/model.ts itself, so a field added
// later is walked too: a simple one (true/false, a number, a string, a choice of words) gets a sample
// value on its own, and one with a structured value fails here until it is given a sample below.
//
// For each object type (atom, bond, caption, arrow, shape, and a caption's text run) and each of
// its fields, a small drawing is made with that one field set, then saved and opened again through
// the real code for CDXML, PowerPoint (.pptx), Word (.docx) and Excel (.xlsx). The field must come
// back with the same value, unless:
//   - CANT_CARRY says that format can't hold it, and why (a fact about the format), or
//   - KNOWN_GAPS says it is lost today and should not be (a bug to fix; the reason says what is lost).
// A known gap that starts to come back fails too, so its line is taken out and the field stays fixed.
//
// Run alone: npx vitest run tests/field-round-trip.test.ts

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { Doc, type Contents } from '../src/model';
import { writeCdxml } from '../src/io/cdxml-write';
import { readCdxml } from '../src/io/cdxml';
import { Deck } from '../src/deck/deck';
import { writePptx, type PptxOptions } from '../src/io/pptx-write';
import { readPptx } from '../src/io/pptx-read';
import { writeDocx, readDocx, type DocxDeps } from '../src/io/docx';
import { newDocument, objectRun, paraFromStyle, runStyleOf, type DocText } from '../src/document/document';
import * as rt from '../src/richtext';
import { Workbook } from '../src/sheet/workbook';
import { writeXlsx, readXlsx, type XlsxPictures } from '../src/io/xlsx';

// ---------------------------------------------------------------------------------------------
// The fields, read from the model's own source

const TYPES = ['Atom', 'Bond', 'Caption', 'Arrow', 'Shape', 'TextRun'] as const;
type TypeName = (typeof TYPES)[number];

/** Each type's fields and the text of their types, from src/model.ts. */
function modelFields(): Record<TypeName, { name: string; type: string }[]> {
  const src = readFileSync(join(__dirname, '../src/model.ts'), 'utf8');
  const sf = ts.createSourceFile('model.ts', src, ts.ScriptTarget.Latest, true);
  const out = {} as Record<TypeName, { name: string; type: string }[]>;
  ts.forEachChild(sf, (n) => {
    if (ts.isInterfaceDeclaration(n) && (TYPES as readonly string[]).includes(n.name.text)) {
      out[n.name.text as TypeName] = n.members.filter(ts.isPropertySignature).map((m) => ({ name: m.name.getText(sf), type: (m.type?.getText(sf) ?? '').replace(/\s+/g, ' ') }));
    }
  });
  return out;
}

// ---------------------------------------------------------------------------------------------
// Sample values

/**
 * The ids of the objects in a test drawing: atoms a1–a2–a3 (a1 leftmost), bonds b1 (a1–a2) and
 * b2 (a2–a3), and a helper shape and arrow for fields that point at one. A sample written as a
 * function of these is worked out again with the ids the reopened file gave them, because ids are
 * renumbered on reading.
 */
interface Ids { a1: number; a2: number; a3: number; b1: number; b2: number; shape: number; arrow: number }
type Val = unknown | ((ids: Ids) => unknown);
/**
 * A field set for the test: its value, any other fields it needs to mean something (`with`), and
 * `label` for numbers that are only names (group numbers, the drawing order, a kept object's id),
 * which a file may renumber as long as they stay the same shape.
 */
interface Sample {
  v: Val; with?: Val; label?: true;
  /** The atom under test has no bonds (for fields that only mean something on a lone atom). */
  alone?: true;
  /** Other changes to the drawing the field needs (a label on the bond's first atom…). */
  setup?: (doc: Doc, ids: Ids) => void;
  /** Its own test of "the same", where a file may rewrite the value without changing it. */
  cmp?: (want: unknown, got: unknown) => boolean;
}
const val = (v: Val, ids: Ids): unknown => (typeof v === 'function' ? (v as (i: Ids) => unknown)(ids) : v);

/**
 * A sample value for a simple type: true, a number, a string, or the last word of a choice (the
 * first is usually the default). Null when the type needs a hand-written sample.
 */
function autoSample(type: string): unknown | null {
  const t = type.trim();
  if (t === 'boolean' || t === 'true') return true;
  if (t === 'number') return 3;
  if (t === 'string') return 'Sample';
  const words = t.split('|').map((x) => x.trim());
  if (words.length && words.every((w) => /^'[^']*'$/.test(w))) return words[words.length - 1].slice(1, -1);
  return null;
}

// The ids in the test drawings: atoms 1 to 3 (1–2–3 bonded), bond 4 (1–2), bond 5 (2–3); the
// object under test is atom 2, bond 4, or the one caption, arrow or shape.
const STEREO = { text: '(R)', dx: 4, dy: -6, size: 8, italic: true, manual: true };
const HL = { shape: 'straight', size: 1.5, shadow: true };
/** Office's looks (glow, bevel, text inside…) are tested on an Office shape (Insert ▸ Shapes), not on a ChemDraw-style rectangle. */
const GEO = { kind: 'geo', geo: 'rect' };
/** A real 1 × 1 PNG, for pictures. */
const PNG1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** Hand-written samples, and samples that need other fields to mean something. */
const SAMPLES: Record<TypeName, Record<string, Sample>> = {
  Atom: {
    piece: { v: 2 },
    ole: { v: { id: 1, prog: 'ChemDraw.Document.6.0' }, label: true },
    grp: { v: 7, label: true },
    grpPath: { v: [7, 8], with: { grp: 7 }, label: true },
    stack: { v: 5, label: true },
    z: { v: 7 },
    label: { v: 'OMe' },
    charge: { v: 1 },
    isotope: { v: 13 },
    just: { v: 'right', with: { label: 'OMe' } },
    fileLabel: { v: true, with: { label: 'OMe' } },
    color: { v: '#ff0000' },
    s: { v: 1.5 },
    face: { v: 1, with: { label: 'OMe' } },
    font: { v: 'Times New Roman', with: { label: 'OMe' } },
    marginWidth: { v: 2.5, with: { label: 'OMe' } },
    xyz: { v: [1.5, -2.25, 3] },
    depth: { v: 4.5 },
    group: { v: 'OC', with: { label: 'OMe' } },
    // (ChemDraw's own fragment comes back with the file's new ids in it)
    // (only kept while it still fits the atom; this made-up one is rebuilt from the label, so only what it is for is checked)
    cdxInner: { v: { label: 'OMe', type: 'Fragment', xml: '<fragment id="900"><n id="901" p="0 0"/></fragment>' }, with: { label: 'OMe' }, cmp: (w, g) => same({ label: 'OMe', type: 'Fragment' }, g) && /^<fragment/.test(String((g as { xml?: string } | undefined)?.xml)) },
    alt: { v: 'Ethanol, a two-carbon alcohol' },
    showCarbon: { v: true },
    asTyped: { v: true, with: { label: 'NH2' }, alone: true },
    bare: { v: true, alone: true },
    hideCharge: { v: true, with: { charge: 1, label: 'NMe3' } },
    supDigits: { v: false, with: { label: 'R1' } },
    labelMarks: { v: '^==', with: { label: 'OMe' } },
    centred: { v: true, with: { label: 'OMe' } },
    // (the label's bonds go down, so it stacks up: a label stacked toward its bonds is turned round, labels.ts fitStacked)
    stacked: { v: 'up', with: { label: 'OMe' } },
    hDot: { v: 'dash' },
    stackedLoose: { v: true, with: { label: 'OMe', stacked: 'up' } },
    fixedDir: { v: true, with: { label: 'OMe', just: 'left' } },
    showStereo: { v: true },
    stereoLabel: { v: STEREO },
    ignoreWarnings: { v: true },
    highlight: { v: '#ffff00' },
    hl: { v: HL, with: { highlight: '#ffff00' } },
    radical: { v: 'doublet' },
    attach: { v: 'Wavy' },
    attachNum: { v: 2, with: { attach: 'Wavy' } },
    atomNumber: { v: '12' },
    showNumber: { v: true, with: { atomNumber: '12' } },
    numberLabel: { v: { dx: 5, dy: -5, size: 7, color: '#0000ff', face: 1 }, with: { atomNumber: '12', showNumber: true } },
    mapNo: { v: 4 },
    focal: { v: true },
    enhStereo: { v: { type: 'and', group: 2 } },
    multi: { v: (i) => [i.a1, i.a3] },
    kekule: { v: true, with: (i) => ({ multi: [i.a1, i.a3] }) },
    variable: { v: true, with: (i) => ({ multi: [i.a1, i.a3] }) },
    ringOf: { v: (i) => [i.a1, i.a3], with: (i) => ({ multi: [i.a1, i.a3], variable: true }) },
  },
  Bond: {
    order: { v: 2 },
    display: { v: 'wedge' },
    dpos: { v: 'left', with: { order: 2 } },
    color: { v: '#00aa00' },
    s: { v: 1.5 },
    boldWidth: { v: 3 },
    hashSpacing: { v: 3.5 },
    marginWidth: { v: 2.5 },
    bondLength: { v: 20 },
    circle: { v: true, with: { order: 1.5 } },
    plain: { v: true, with: { order: 1.5 } },
    z: { v: 3 },
    crossing: { v: (i) => [i.b2] },
    line2: { v: 'dash', with: { order: 2 } },
    beginAttach: { v: 1, setup: (doc, i) => Object.assign(doc.atoms.get(i.a1)!, { label: 'OMe' }) },
    endAttach: { v: 1, setup: (doc, i) => Object.assign(doc.atoms.get(i.a2)!, { label: 'NMe' }) },
    ignoreWarnings: { v: true },
    spokes: { v: true },
    showStereo: { v: true, with: { order: 2 } },
    stereoLabel: { v: { ...STEREO, text: '(E)' }, with: { order: 2 } },
    highlight: { v: '#ffff00' },
    hl: { v: HL, with: { highlight: '#ffff00' } },
  },
  Caption: {
    piece: { v: 2 },
    ole: { v: { id: 1, prog: 'ChemDraw.Document.6.0' }, label: true },
    grp: { v: 7, label: true },
    grpPath: { v: [7, 8], with: { grp: 7 }, label: true },
    stack: { v: 5, label: true },
    runs: { v: [{ text: 'Bold ', bold: true }, { text: 'and red', color: '#ff0000' }] },
    justify: { v: 'center' },
    width: { v: 120 },
    lineHeight: { v: 14 },
    lineSpacing: { v: 1.5 },
    inkLines: { v: true },
    wrap: { v: 150 },
    paras: { v: [{ align: 'center', spaceBefore: 6 }] },
    ph: { v: 'title' },
    boxH: { v: 40, with: { ph: 'body' } },
    refsBox: { v: true },
    attach: { v: (i) => ({ atoms: [i.a1, i.a2, i.a3], side: 'below', gap: 6, shift: 0 }) },
    ignoreWarnings: { v: true },
    results: { v: true },
    chem: { v: true },
    rot: { v: 30 },
    name: { v: 'Label 1' },
    hidden: { v: true },
    cols: { v: 2, with: { wrap: 200 } },
    colGap: { v: 12, with: { wrap: 200, cols: 2 } },
    fit: { v: 'shrink', with: { wrap: 200 } },
    dir: { v: 'vert', with: { rot: 90 } },
  },
  Arrow: {
    piece: { v: 2 },
    ole: { v: { id: 1, prog: 'ChemDraw.Document.6.0' }, label: true },
    ppt: { v: true },
    grp: { v: 7, label: true },
    grpPath: { v: [7, 8], with: { grp: 7 }, label: true },
    stack: { v: 5, label: true },
    headStyle: { v: 'halfLeft' },
    tailStyle: { v: 'full' },
    headType: { v: 'hollow' },
    line: { v: 'dashed' },
    noGo: { v: true },
    noGoKind: { v: 'hash', with: { noGo: true } },
    dipole: { v: true },
    equilibrium: { v: true, with: { headStyle: 'halfLeft', tailStyle: 'halfLeft' } },
    boldWidth: { v: 3, with: { line: 'bold' } },
    hashSpacing: { v: 3.5, with: { line: 'dashed' } },
    shaftSpacing: { v: 4 },
    sweep: { v: 1.2 },
    headLength: { v: 9 },
    headWidth: { v: 2.5 },
    headCenter: { v: 0.6 },
    color: { v: '#0000ff' },
    lineWidth: { v: 1.5 },
    // (a step's species are whole structures, named by their first atom: a1 here)
    step: { v: (i) => ({ reactants: [`a${i.a1}`], products: [], above: [], below: [], manual: true }) },
    reagentFor: { v: (i) => i.arrow },
    from: { v: (i) => ({ shape: i.shape, port: 1 }) },
    to: { v: (i) => ({ shape: i.shape, port: 3 }) },
    elbow: { v: true },
    morph: { v: (i) => ({ pairs: [[i.a1, i.a3]], exact: true }) },
    bez: { v: [{ x: 120, y: 60 }, { x: 160, y: 60 }] },
    ellipse: { v: { center: { x: 150, y: 100 }, major: { x: 180, y: 100 }, minor: { x: 150, y: 80 }, angular: 90 } },
    // (`was` is where the tail is, as it would be when stuck)
    pin: { v: (i) => ({ tail: { on: 'atom', ref: [i.a1, i.a2], at: { x: 0.2, y: 0.1 }, hand: 1, was: { x: 100, y: 200 } } }) },
    bent: { v: true },
    textLook: { v: { align: { above: 'left' }, guides: false } },
    kind: { v: 'mechanism' },
  },
  Shape: {
    piece: { v: 2 },
    ole: { v: { id: 1, prog: 'ChemDraw.Document.6.0' }, label: true },
    ppt: { v: true },
    grp: { v: 7, label: true },
    grpPath: { v: [7, 8], with: { grp: 7 }, label: true },
    stack: { v: 5, label: true },
    kind: { v: 'oval' },
    ring: { v: (i) => [i.a1, i.a2, i.a3], with: { kind: 'ring', filled: true, fillColor: '#ffd966', poly: [{ x: 100, y: 100 }, { x: 115, y: 90 }, { x: 130, y: 100 }] } },
    poly: { v: [{ x: 100, y: 100 }, { x: 150, y: 120 }, { x: 120, y: 160 }], with: { kind: 'geo', geo: 'freeform' } },
    pin: { v: (i) => ({ on: 'atom', ref: [i.a1, i.a2], at: { x: 0.2, y: 0.1 }, hand: 1, was: { x: 100, y: 200 } }), with: { kind: 'symbol', symbol: 'LonePair' } },
    geo: { v: 'star5', with: { kind: 'geo' } },
    orbital: { v: 's', with: { kind: 'oval' } },
    orb: { v: { kind: 'p', look: 'shaded', part: 0 }, with: { kind: 'symbol', orbital: 'p' } },
    text: { v: { runs: [{ text: 'Inside', italic: true }] }, with: GEO },
    textAlign: { v: 'right', with: { ...GEO, text: { runs: [{ text: 'Inside' }] } } },
    textValign: { v: 'bottom', with: { ...GEO, text: { runs: [{ text: 'Inside' }] } } },
    lineWidth: { v: 2 },
    transparency: { v: 0.25, with: { ...GEO, filled: true, fillColor: '#ffd966' } },
    rot: { v: 30 },
    dashed: { v: true },
    hashSpacing: { v: 3.5, with: { dashed: true } },
    dotted: { v: true, with: { kind: 'line', dashed: true } },
    filled: { v: true, with: { fillColor: '#ffd966' } },
    fill: { v: 'gradient', with: { filled: true, fillColor: '#ffd966' } },
    fill2: { v: '#336699', with: { filled: true, fill: 'gradient', fillColor: '#ffd966' } },
    gradAngle: { v: 45, with: { filled: true, fill: 'gradient', fillColor: '#ffd966' } },
    gradRadial: { v: true, with: { filled: true, fill: 'gradient', fillColor: '#ffd966' } },
    pattern: { v: 'crosshatch', with: { filled: true, fillColor: '#ffd966' } },
    patternColor: { v: '#336699', with: { filled: true, fillColor: '#ffd966', pattern: 'crosshatch' } },
    patternSize: { v: 6, with: { filled: true, fillColor: '#ffd966', pattern: 'crosshatch' } },
    patternTransparency: { v: 0.5, with: { filled: true, fillColor: '#ffd966', pattern: 'crosshatch' } },
    patternClear: { v: true, with: { filled: true, fillColor: '#ffd966', pattern: 'crosshatch' } },
    fillColor: { v: '#ffd966', with: { filled: true } },
    fade: { v: 0.4, with: { ...GEO, filled: true, fill: 'faded', fillColor: '#ffd966' } },
    rounded: { v: true },
    radius: { v: 8, with: { rounded: true } },
    shadow: { v: true },
    shadowBetween: { v: true, with: { ...GEO, shadow: true } },
    shadowSize: { v: 4, with: { shadow: true } },
    shadowColor: { v: '#333333', with: { ...GEO, shadow: true } },
    shadowOpacity: { v: 0.5, with: { ...GEO, shadow: true } },
    shadowAngle: { v: 135, with: { ...GEO, shadow: true } },
    shadowBlur: { v: 3, with: { ...GEO, shadow: true } },
    glow: { v: { color: '#00b050', size: 4, transparency: 0.3 }, with: GEO },
    softEdge: { v: 3, with: GEO },
    bevel: { v: { kind: 'circle', w: 6, h: 6 }, with: GEO },
    reflection: { v: { size: 0.5, opacity: 0.4, dist: 2 }, with: GEO },
    picFill: { v: { src: PNG1, transparency: 0.2 }, with: GEO },
    bold: { v: true, with: { kind: 'line' } },
    symbol: { v: 'plusCircle', with: { kind: 'symbol' } },
    bracket: { v: 'curly', with: { kind: 'bracket' } },
    pair: { v: true, with: { kind: 'bracket', bracket: 'round' } },
    bracketPair: { v: (i) => i.shape, with: { kind: 'bracket', bracket: 'round' } },
    repeat: { v: 'n', with: { kind: 'bracket', bracket: 'round' } },
    repeatLook: { v: { color: '#ff0000', face: 1, size: 9 }, with: { kind: 'bracket', bracket: 'round', repeat: 'n' } },
    picture: { v: true, with: { kind: 'picture', src: PNG1 } },
    src: { v: PNG1, with: { kind: 'picture' } },
    // (measured again from the picture itself, a 1 × 1 PNG)
    px: { v: { w: 1, h: 1 }, with: { kind: 'picture', src: PNG1 } },
    video: { v: { src: 'data:video/mp4;base64,AAAA', once: true }, with: { kind: 'picture', src: PNG1 } },
    link: { v: 'https://example.org/', with: GEO },
    zoom: { v: { to: 'slide-2' } },
    crop: { v: { l: 0.1, t: 0.1, r: 0.1, b: 0.1 }, with: { kind: 'picture', src: PNG1 } },
    phPic: { v: 1, with: { kind: 'picture', src: PNG1 } },
    look: { v: { line: 2, lineColor: '#ff0000' }, with: { kind: 'picture', src: PNG1 } },
    fx: { v: { bright: 0.2 }, with: { kind: 'picture', src: PNG1 } },
    color: { v: '#c00000' },
    z: { v: 3, label: true },
    alt: { v: 'A yellow box', with: GEO },
    name: { v: 'Box 1' },
    hidden: { v: true },
    locked: { v: true, with: GEO },
    table: { v: { cols: [60, 40], rows: [[{ runs: [{ text: 'A' }] }, { runs: [{ text: 'B', bold: true }] }]], head: 0, lines: 'grid' }, with: { kind: 'table' } },
    chart: { v: null },
    math: { v: { tex: 'x^2', size: 12 }, with: { kind: 'picture', src: PNG1 } },
    frame: { v: (i) => ({ atoms: [i.a1, i.a2, i.a3], captions: [], arrows: [], shapes: [], padX: 6, padY: 4, fit: true }) },
    energy: { v: null },
    newman: { v: null },
    torsion: { v: null },
    plate: { v: null },
    diagram: { v: null },
    smart: { v: null },
    holder: { v: { runs: [{ text: 'Click to add text' }] } },
    madeLabels: { v: [{ text: 'OMe', runs: [{ text: 'OMe' }] }] },
  },
  TextRun: {
    text: { v: 'Sample text' },
    font: { v: 'Times New Roman' },
    obj: { v: null },
    hide: { v: null },
    color: { v: '#ff0000' },
    highlight: { v: '#ffff00' },
    size: { v: 14 },
    rev: { v: 'ins|Nate|2026-10-14T21:00:00Z' },
    fmt: { v: 'Nate|2026-10-14T21:00:00Z|{"bold":true}' },
    cmt: { v: '2' },
    link: { v: 'https://example.org/' },
    spacing: { v: 1.5 },
    field: { v: 'slidenum' },
    cite: { v: 'r1' },
    lang: { v: 'de-DE' },
    cstyle: { v: 'Emphasis' },
    cc: { v: 'c1' },
    transparency: { v: 0.5 },
    outline: { v: '#0000ff' },
    outlineW: { v: 1.5, with: { outline: '#0000ff' } },
    wfx: { v: '<w14:glow/>' },
    raise: { v: 3 },
    // (only means something on a run with a sign in it)
    symbolFont: { v: true, with: { text: 'Sample 25 °C' } },
  },
};

/**
 * Fields that are not data to carry: ids are renumbered on reading (identity is kept by order),
 * positions are checked as the distance between the drawing's objects (a file may move the whole
 * drawing), and the text a caption holds is checked through its runs. `v: null` in SAMPLES also
 * leaves a field out, for these reasons:
 */
const NOT_WALKED: Record<TypeName, Record<string, string>> = {
  Atom: { id: 'renumbered on reading', x: 'checked as positions relative to the other atoms', y: 'checked as positions relative to the other atoms' },
  Bond: {
    id: 'renumbered on reading', a1: 'which atoms it joins: checked by finding the bond again', a2: 'which atoms it joins: checked by finding the bond again',
    circle: 'needs a whole aromatic ring drawn with its circle, which this three-atom drawing has not (tests/hapto.test.ts, tests/cdxml-write-robust.test.ts)',
    crossing: 'needs a bond passing across it, which this drawing has not (tests/crossing.test.ts)',
  },
  Caption: { id: 'renumbered on reading', x: 'checked as position relative to the structure', y: 'checked as position relative to the structure' },
  Arrow: { id: 'renumbered on reading', tail: 'checked as position relative to the structure', head: 'checked as position relative to the structure' },
  Shape: {
    id: 'renumbered on reading', x1: 'position', y1: 'position', x2: 'position', y2: 'position',
    picture: "stands in for a picture kept from a ChemDraw file, so it needs that file's own picture (tests/cdxml-files.test.ts)",
    chart: 'a chart: its own round trips in tests/office-charts.test.ts and tests/chart.test.ts',
    energy: 'an energy diagram: its own round trip in tests/round-trip-review-objects.test.ts',
    newman: 'a Newman projection: made by the Newman tool, round trip in tests/newman.test.ts',
    torsion: 'a torsion chart: made from a conformer scan, tested in tests/torsion-chart.test.ts',
    plate: 'a TLC plate: tested in tests/plates.test.ts',
    diagram: 'a SmartArt-style diagram: tested in tests/diagrams.test.ts',
    smart: 'a Smart Scheme: its own round trip in tests/round-trip-review-objects.test.ts',
  },
  TextRun: {
    text: 'the text itself: checked in every case',
    obj: 'a document object character: only in Document text, never in a drawing',
    hide: 'never in a file (only on runs being laid out, src/model.ts)',
  },
};

// ---------------------------------------------------------------------------------------------
// What a format can't carry, and what it loses today

type Format = 'cdxml' | 'pptx' | 'docx' | 'xlsx';
const FORMATS: Format[] = ['cdxml', 'pptx', 'docx', 'xlsx'];

/** "Type.field" -> reason, per format: the format has no place for it (a fact, not a bug). */
const CANT_CARRY: Record<Format, Record<string, string>> = {
  cdxml: {
    'Arrow.ole': "ties it to a ChemDraw object kept in a PowerPoint file; only .pptx keeps that object",
    'Arrow.ppt': "marks a PowerPoint shape; only .pptx has them",
    'Atom.ole': "ties it to a ChemDraw object kept in a PowerPoint file; only .pptx keeps that object",
    'Caption.boxH': "a slide placeholder's height: slides are saved as PowerPoint, never as CDXML",
    'Caption.dir': "PowerPoint's text direction (src/model.ts: \"for PowerPoint\"); the turn itself is kept in rot",
    'Caption.hidden': "hidden in the Selection Pane of a slide: slides are saved as PowerPoint",
    'Caption.name': "its name in the Selection Pane of a slide (src/model.ts): slides are saved as PowerPoint",
    'Caption.ole': "ties it to a ChemDraw object kept in a PowerPoint file; only .pptx keeps that object",
    'Caption.ph': "a slide placeholder: slides are saved as PowerPoint, never as CDXML",
    'Caption.refsBox': "a slide layout's References placeholder: slides are saved as PowerPoint, never as CDXML",
    'Shape.ole': "ties it to a ChemDraw object kept in a PowerPoint file; only .pptx keeps that object",
    'Shape.phPic': "a picture in a slide layout's picture placeholder: slides are saved as PowerPoint",
    'Shape.ppt': "marks a PowerPoint shape; only .pptx has them",
    'Shape.zoom': "a Slide Zoom: slides are saved as PowerPoint",
    'TextRun.allCaps': "Document text only (src/model.ts \"Documents:\"); drawings' captions never have it, and Word files keep it",
    'TextRun.cc': "Document text only (src/model.ts \"Documents:\"); drawings' captions never have it, and Word files keep it",
    'TextRun.cite': "a citation of the presentation's references: slides are saved as PowerPoint",
    'TextRun.cmt': "Document text only (src/model.ts \"Documents:\"); drawings' captions never have it, and Word files keep it",
    'TextRun.cstyle': "Document text only (src/model.ts \"Documents:\"); drawings' captions never have it, and Word files keep it",
    'TextRun.field': "a PowerPoint field (slide number, date): slides are saved as PowerPoint",
    'TextRun.fmt': "Document text only (src/model.ts \"Documents:\"); drawings' captions never have it, and Word files keep it",
    'TextRun.highlight': "Document text only (src/model.ts \"Documents:\"); drawings' captions never have it, and Word files keep it",
    'TextRun.lang': "ChemDraw text has no language; kept from Word and PowerPoint for spelling",
    'TextRun.noProof': "Document text only (src/model.ts \"Documents:\"); drawings' captions never have it, and Word files keep it",
    'TextRun.raise': "Document text only (src/model.ts \"Documents:\"); drawings' captions never have it, and Word files keep it",
    'TextRun.rev': "Document text only (src/model.ts \"Documents:\"); drawings' captions never have it, and Word files keep it",
    'TextRun.smallCaps': "Document text only (src/model.ts \"Documents:\"); drawings' captions never have it, and Word files keep it",
    'TextRun.wfx': "Document text only (src/model.ts \"Documents:\"); drawings' captions never have it, and Word files keep it",
  },
  pptx: {},
  docx: {},
  xlsx: {},
};

/**
 * "Type.field" -> what is lost, per format: lost today, and should not be. Found when this test
 * was added (2026-11-22). Fix the writer or reader, then delete the line (the test fails while a
 * fixed field is still listed). Word and Excel keep each drawing's own data whole, so they lose
 * nothing; PowerPoint keeps a slide's structures as CDXML, so it shares CDXML's atom and bond gaps.
 */
const KNOWN_GAPS: Record<Format, Record<string, string>> = {
  cdxml: {
    'Arrow.bent': "a hand-bent curved arrow comes back unbent, so it finds its own way round again when the structure changes",
    'Arrow.elbow': "an elbow connector comes back straight",
    'Arrow.ellipse': "an arrow drawn along an ellipse loses its ellipse",
    'Arrow.from': "a connector's tail comes unstuck from its shape",
    'Arrow.reagentFor': "a catalytic cycle's reagent arrow loses which step it feeds",
    'Arrow.step': "a step set by hand (manual) comes back as worked out automatically",
    'Arrow.to': "a connector's head comes unstuck from its shape",
    'Atom.asTyped': "a lone typed label (NH2) loses \"shown as typed\"",
    'Atom.depth': "an atom's depth from a perspective drawing is not saved, so which crossing bond is in front can change",
    'Atom.face': "a label face of 1 (bold, not formula) comes back 97 (bold formula)",
    'Atom.labelMarks': "\"=\" marks (on the line, set by hand) come back \".\" ",
    'Atom.ringOf': "a variable attachment loses its ring (it then sits at the middle of multi)",
    'Atom.stereoLabel': "a hand-typed stereo label (manual) comes back as fromFile, so it is replaced once the structure changes",
    'Atom.supDigits': "supDigits false on R1 (keep the 1 down) comes back true",
    'Bond.stereoLabel': "a hand-typed E/Z label (manual) comes back as fromFile, so it is replaced once the structure changes",
    'Bond.z': "a bond's place among crossing bonds is not kept",
    'Caption.colGap': "the gap between text box columns is lost (see cols)",
    'Caption.cols': "text box columns are lost (if text boxes with columns are slide-only, move this to CANT_CARRY)",
    'Caption.fit': "shrink-to-fit is lost (if only slide text boxes have it, move this to CANT_CARRY)",
    'Caption.width': "the text box width read from a file is not written back",
    'Shape.crop': "a picture's crop is lost",
    'Shape.frame': "a frame forgets what it surrounds (atoms come back []), so it stops following the structure",
    'Shape.hidden': "hidden in the Layers panel (Design) is lost",
    'Shape.holder': "a Smart Scheme placeholder box loses its waiting label",
    'Shape.look': "a picture's frame (Picture Styles) is lost",
    'Shape.madeLabels': "labels of a frame drawn from data are lost (checked on a plain rectangle, not a real energy diagram)",
    'Shape.name': "the Layers panel name (Design) is lost",
    'Shape.pin': "a lone pair stuck to its atom comes unstuck",
    'Shape.repeat': "a bracket's repeat label (n) is lost (checked on one round bracket, not a pair)",
    'Shape.repeatLook': "the repeat label's own look is lost (see repeat)",
    'Shape.video': "a video on a picture is lost (if videos are slide-only, move this to CANT_CARRY)",
    'TextRun.noFill': "text effects (Font box) are not kept on drawing text",
    'TextRun.noKern': "text effects (Font box) are not kept on drawing text",
    'TextRun.outline': "text effects (Font box) are not kept on drawing text",
    'TextRun.outlineW': "text effects (Font box) are not kept on drawing text",
    'TextRun.shadow': "text effects (Font box) are not kept on drawing text",
    'TextRun.spacing': "character spacing is not kept on drawing text",
    'TextRun.strike': "strikethrough is not kept on drawing text",
    'TextRun.symbolFont': "which font a sign was in is not written back",
    'TextRun.transparency': "text effects (Font box) are not kept on drawing text",
  },
  pptx: {
    'Arrow.bent': "the slide's structures go through CDXML: a hand-bent curved arrow comes back unbent, so it finds its own way round again when the structure changes",
    'Arrow.ellipse': "the slide's structures go through CDXML: an arrow drawn along an ellipse loses its ellipse",
    'Arrow.from': "the slide's structures go through CDXML: a connector's tail comes unstuck from its shape",
    'Arrow.morph': "the animation's atom pairs are lost",
    'Arrow.pin': "an electron-pushing arrow comes unstuck from its atoms",
    'Arrow.reagentFor': "the slide's structures go through CDXML: a catalytic cycle's reagent arrow loses which step it feeds",
    'Arrow.step': "a step loses its species and its \"set by hand\"",
    'Arrow.to': "the slide's structures go through CDXML: a connector's head comes unstuck from its shape",
    'Atom.asTyped': "the slide's structures go through CDXML: a lone typed label (NH2) loses \"shown as typed\"",
    'Atom.depth': "the slide's structures go through CDXML: an atom's depth from a perspective drawing is not saved, so which crossing bond is in front can change",
    'Atom.face': "the slide's structures go through CDXML: a label face of 1 (bold, not formula) comes back 97 (bold formula)",
    'Atom.labelMarks': "the slide's structures go through CDXML: \"=\" marks (on the line, set by hand) come back \".\" ",
    'Atom.ringOf': "the slide's structures go through CDXML: a variable attachment loses its ring (it then sits at the middle of multi)",
    'Atom.stereoLabel': "the slide's structures go through CDXML: a hand-typed stereo label (manual) comes back as fromFile, so it is replaced once the structure changes",
    'Atom.supDigits': "the slide's structures go through CDXML: supDigits false on R1 (keep the 1 down) comes back true",
    'Bond.stereoLabel': "the slide's structures go through CDXML: a hand-typed E/Z label (manual) comes back as fromFile, so it is replaced once the structure changes",
    'Bond.z': "the slide's structures go through CDXML: a bond's place among crossing bonds is not kept",
    'Caption.attach': "a caption tied to a structure keeps the old atom ids while the structure's atoms are renumbered on reading, so it points at the wrong atoms",
    'Shape.bracketPair': "a bracket keeps the old id of its partner while shapes are renumbered",
    'Shape.frame': "the slide's structures go through CDXML: a frame forgets what it surrounds (atoms come back []), so it stops following the structure",
    'Shape.grp': "a ChemDraw-style shape loses its group",
    'Shape.grpPath': "a ChemDraw-style shape loses its group nesting",
    'Shape.hashSpacing': "a ChemDraw-style dashed rectangle loses its dash length",
    'Shape.holder': "the slide's structures go through CDXML: a Smart Scheme placeholder box loses its waiting label",
    'Shape.lineWidth': "a ChemDraw-style rectangle loses its line width",
    'Shape.madeLabels': "the slide's structures go through CDXML: labels of a frame drawn from data are lost (checked on a plain rectangle, not a real energy diagram)",
    'Shape.orbital': "a ChemDraw orbital comes back a plain oval",
    'Shape.pattern': "a ChemDraw-style rectangle loses its pattern fill",
    'Shape.patternClear': "a ChemDraw-style rectangle loses its pattern fill",
    'Shape.patternColor': "a ChemDraw-style rectangle loses its pattern fill",
    'Shape.patternSize': "a ChemDraw-style rectangle loses its pattern fill",
    'Shape.patternTransparency': "a ChemDraw-style rectangle loses its pattern fill",
    'Shape.phPic': "a picture in a layout's picture placeholder is not put back in it (checked without a layout that has one)",
    'Shape.piece': "a ChemDraw-style shape loses its Auto-Animate piece",
    'Shape.pin': "the slide's structures go through CDXML: a lone pair stuck to its atom comes unstuck",
    'Shape.repeat': "the slide's structures go through CDXML: a bracket's repeat label (n) is lost (checked on one round bracket, not a pair)",
    'Shape.repeatLook': "the slide's structures go through CDXML: the repeat label's own look is lost (see repeat)",
    'Shape.ring': "a ring fill keeps the old atom ids while the structure's atoms are renumbered on reading, so it points at the wrong atoms",
    'Shape.shadow': "a ChemDraw-style rectangle loses its shadow",
    'Shape.shadowSize': "a ChemDraw-style rectangle loses its shadow size",
    'Shape.stack': "a ChemDraw-style shape loses its Format ▸ Order place",
    'Shape.z': "a ChemDraw-style shape loses its drawing order",
    'Shape.zoom': "a Slide Zoom is lost (checked without the slide it zooms to)",
  },
  docx: {},
  xlsx: {},
};

// ---------------------------------------------------------------------------------------------
// Building the drawings, and saving and opening them

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 40, 0, 0, 0, 30]);
const pptxOpts: PptxOptions = { async picture(d) { const b = d.bounds(); return b ? { png: PNG, svg: '<svg xmlns="http://www.w3.org/2000/svg"/>', box: b } : null; }, async svgToPng() { return PNG; } };
const docxDeps: DocxDeps = { async picture() { return { png: PNG, w: 80, h: 40 }; }, async svgToPng() { return PNG; } };
const xlsxDeps: XlsxPictures = { box: () => ({ w: 60, h: 40 }), picture: async () => PNG };

/**
 * The drawing for one field: three bonded atoms, a helper shape and arrow off to the right, and the
 * object under test with the field set.
 */
function build(type: TypeName, field: string, s: Sample): Doc {
  const doc = new Doc();
  doc.bulk(() => {
    const L = doc.style.bondLength;
    const a1 = doc.addAtom(100, 100).id;
    const a2 = doc.addAtom(100 + L, 100 - 10).id;
    const a3 = doc.addAtom(100 + 2 * L, 100).id;
    const b1 = s.alone ? -1 : doc.addBond(a1, a2).id;
    const b2 = s.alone ? -1 : doc.addBond(a2, a3).id;
    const shape = doc.addShape({ kind: 'rect', x1: 400, y1: 300, x2: 440, y2: 330 }).id;
    const arrow = doc.addArrow({ ...ARROW, tail: { x: 400, y: 360 }, head: { x: 460, y: 360 } }).id;
    const ids: Ids = { a1, a2, a3, b1, b2, shape, arrow };
    s.setup?.(doc, ids);
    const v = val(s.v, ids);
    const patch = { ...(val(s.with, ids) as object ?? {}), [field]: v };
    if (type === 'Atom') Object.assign(doc.atoms.get(a2)!, patch);
    else if (type === 'Bond') Object.assign(doc.bonds.get(b1)!, patch);
    else if (type === 'Caption' || type === 'TextRun') {
      const run = type === 'TextRun' ? { text: 'Sample text', ...(val(s.with, ids) as object ?? {}), [field]: field === 'text' ? 'Sample text' : v } : { text: 'Sample text' };
      const c = doc.addCaption({ x: 100, y: 160, runs: [run], justify: 'left' });
      if (type === 'Caption') Object.assign(doc.captions.get(c.id)!, patch);
    } else if (type === 'Arrow') {
      const r = doc.addArrow({ ...ARROW, tail: { x: 100, y: 200 }, head: { x: 180, y: 200 } });
      Object.assign(doc.arrows.get(r.id)!, patch);
    } else if (type === 'Shape') {
      const sh = doc.addShape({ kind: 'rect', x1: 100, y1: 200, x2: 180, y2: 240 });
      Object.assign(doc.shapes.get(sh.id)!, patch);
    }
  });
  return doc;
}
const ARROW = { headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'solid', noGo: false, equilibrium: false, sweep: 0, headLength: 6, headWidth: 1.5 } as const;

/**
 * Saves the drawings in one file of the format and opens it again: one CDXML file each, one slide
 * each in a presentation, one figure each in a Word document, one cell each in a workbook.
 */
async function roundTrip(docs: Doc[], format: Format): Promise<Contents[]> {
  if (format === 'cdxml') return docs.map((doc) => readCdxml(writeCdxml(doc)).doc.contents());
  if (format === 'pptx') {
    const d = Deck.design(new Doc(), { w: 720, h: 405 });
    const slides = docs.map((doc) => {
      const slide = new Doc();
      slide.restoreContents(doc.contents());
      return { layout: 'blank', doc: slide, notes: '' };
    });
    const back = readPptx(await writePptx({ size: d.size, master: d.master, slides }, pptxOpts));
    return back.slides.map((s) => s.contents);
  }
  if (format === 'docx') {
    const base = newDocument();
    const n = runStyleOf(base.styles.Normal);
    const N = paraFromStyle(base.styles.Normal, {});
    const runs = docs.flatMap((_, i) => [{ ...n, text: `Figure ${i + 1}\n` }, objectRun(i + 1, n), { ...n, text: '\n' }]);
    const objects = Object.fromEntries(docs.map((doc, i) => [i + 1, { kind: 'drawing' as const, contents: doc.contents() }]));
    const t: DocText = { ...base, runs: rt.normalizeRuns(runs), paras: docs.flatMap(() => [N, N]).concat([N]), objects };
    const back = (await readDocx(await writeDocx(t, docxDeps))).doc;
    // the figures in the order they are in the text
    const ids = back.runs.filter((r) => r.obj !== undefined).map((r) => r.obj!);
    return ids.map((id) => back.objects[id]).filter((o) => o?.kind === 'drawing').map((o) => (o as { contents: Contents }).contents);
  }
  const wb = new Workbook(['Sheet1']);
  wb.build(() => docs.forEach((doc, i) => wb.sheet.setStructure(i, 0, doc.contents())));
  const back = (await readXlsx(await writeXlsx(wb, xlsxDeps))).book;
  return docs.map((_, i) => back.sheet.cell(i, 0)?.structure?.contents ?? { atoms: [], bonds: [], captions: [], arrows: [], shapes: [] });
}

const left = (o: { x1: number; x2: number } | { tail: { x: number }; head: { x: number } }) => ('x1' in o ? Math.min(o.x1, o.x2) : Math.min(o.tail.x, o.head.x));

/** The test drawing's ids in what came back (found by position), and the object under test. */
function findBack(type: TypeName, c: Contents): { ids: Ids; obj: Record<string, unknown> | undefined } {
  // the three atoms left to right (a multicentre point a field makes is still one of them)
  const atoms = [...c.atoms].sort((p, q) => p.x - q.x);
  const [a1, a2, a3] = atoms.map((a) => a.id);
  const bond = (p: number, q: number) => c.bonds.find((b) => (b.a1 === p && b.a2 === q) || (b.a1 === q && b.a2 === p));
  // the helper shape and arrow are the right-most ones; the one under test is the left-most
  const shapes = [...c.shapes].sort((p, q) => left(p) - left(q));
  const arrows = [...c.arrows].sort((p, q) => left(p) - left(q));
  const ids: Ids = { a1, a2, a3, b1: bond(a1, a2)?.id ?? -1, b2: bond(a2, a3)?.id ?? -1, shape: shapes[shapes.length - 1]?.id ?? -1, arrow: arrows[arrows.length - 1]?.id ?? -1 };
  let obj: unknown;
  if (type === 'Atom') obj = atoms.length >= 3 ? atoms[1] : undefined;
  else if (type === 'Bond') obj = bond(a1, a2);
  else if (type === 'Caption') obj = c.captions.find((x) => /Sample|Bold/.test(rt.plainText(x.runs)));
  else if (type === 'TextRun') obj = c.captions.find((x) => rt.plainText(x.runs).includes('Sample'))?.runs.find((r) => r.text.includes('Sample'));
  else if (type === 'Arrow') obj = arrows.length >= 2 ? arrows[0] : undefined;
  else obj = shapes.length >= 2 ? shapes[0] : undefined;
  return { ids, obj: obj as Record<string, unknown> | undefined };
}

/** Same value: numbers within 0.01 (or 0.1%), colors in any case, objects field by field (extra fields allowed). */
function same(want: unknown, got: unknown, label = false): boolean {
  if (typeof want === 'number' && typeof got === 'number') return label || Math.abs(want - got) <= Math.max(0.011, Math.abs(want) * 1e-3);
  if (typeof want === 'string' && typeof got === 'string') return /^#[0-9a-f]{6}$/i.test(want) ? want.toLowerCase() === got.toLowerCase() : want === got;
  if (Array.isArray(want)) return Array.isArray(got) && want.length === got.length && want.every((w, i) => same(w, got[i], label));
  if (want && typeof want === 'object') return !!got && typeof got === 'object' && Object.entries(want).every(([k, v]) => same(v, (got as Record<string, unknown>)[k], label));
  return want === got;
}

// ---------------------------------------------------------------------------------------------

const FIELDS = modelFields();

/** Every field that is walked, with its sample. */
function walked(): { type: TypeName; field: string; sample: Sample }[] {
  const out: { type: TypeName; field: string; sample: Sample }[] = [];
  for (const type of TYPES) {
    for (const f of FIELDS[type]) {
      if (NOT_WALKED[type][f.name]) continue;
      const s = SAMPLES[type][f.name] ?? (autoSample(f.type) !== null ? { v: autoSample(f.type) } : undefined);
      if (!s || s.v === null) continue;
      out.push({ type, field: f.name, sample: s });
    }
  }
  return out;
}

describe('every model field round-trips every format (R3)', () => {
  it('reads the fields from src/model.ts', () => {
    for (const t of TYPES) expect(FIELDS[t]?.length, t).toBeGreaterThan(5);
  });

  it('has a sample, or a reason it is not walked, for every field', () => {
    const missing: string[] = [];
    for (const type of TYPES) {
      for (const f of FIELDS[type]) {
        const s = SAMPLES[type][f.name];
        if (NOT_WALKED[type][f.name]) continue;
        if (s?.v === null) { missing.push(`${type}.${f.name}: v is null but NOT_WALKED gives no reason`); continue; }
        if (!s && autoSample(f.type) === null) missing.push(`${type}.${f.name} (${f.type}): add a sample value to SAMPLES in tests/field-round-trip.test.ts`);
      }
    }
    expect(missing.join('\n')).toBe('');
  });

  for (const format of FORMATS) {
    it(`${format}: every field comes back, except what the format can't hold and the known gaps`, async () => {
      const lost: string[] = [];
      const fixed: string[] = [];
      const errors: string[] = [];
      const list = walked();
      let backs: Contents[] = [];
      try {
        backs = await roundTrip(list.map(({ type, field, sample }) => build(type, field, sample)), format);
      } catch (e) {
        // one field breaks the whole file: find which, one at a time
        for (const { type, field, sample } of list) {
          try { await roundTrip([build(type, field, sample)], format); } catch (e1) { errors.push(`${type}.${field}: ${String(e1).slice(0, 160)}`); }
        }
        if (!errors.length) errors.push(String(e).slice(0, 300));
      }
      expect(backs.length, `${format}: every drawing comes back`).toBe(list.length);
      list.forEach(({ type, field, sample }, i) => {
        const key = `${type}.${field}`;
        const { ids, obj: back } = findBack(type, backs[i]);
        const got = back?.[field];
        const want = val(sample.v, ids);
        const ok = !!back && (sample.cmp ? sample.cmp(want, got) : same(want, got, sample.label));
        const excused = CANT_CARRY[format][key] ?? KNOWN_GAPS[format][key];
        if (!ok && !excused) lost.push(`${key}: set ${JSON.stringify(want)}, came back ${back ? JSON.stringify(got) ?? 'undefined' : '(object not found)'}`);
        if (ok && KNOWN_GAPS[format][key]) fixed.push(`${key}: now kept; delete it from KNOWN_GAPS.${format}`);
      });
      const report = [
        ...errors.sort().map((x) => `threw: ${x}`),
        ...lost.sort().map((x) => `lost: ${x}`),
        ...fixed.sort().map((x) => `fixed: ${x}`),
      ];
      expect(report.join('\n'), `${format}: carry each lost field (or, only if the format truly can't, add it to CANT_CARRY.${format} with the reason)`).toBe('');
    }, 120_000);
  }
});
