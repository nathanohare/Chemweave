// @vitest-environment jsdom
//
// Standing rule R3: every field of every object in the model survives each file it can go into.
// The fields are read from the model's own source (src/model.ts, src/sheet/workbook.ts,
// src/deck/deck.ts), so a field added later is walked too: a simple one (true/false, a number, a
// string, a choice of words) gets a sample value on its own, and one with a structured value fails
// here until it is given a sample below. The types inside them are walked the same way: each
// interface a field names (a table's TableData, its TableCell, a caption's ParaStyle…) is found by
// reading the field's type, and each of its fields is set inside a sample of the field that holds it.
//
// The columns (each the real code that writes and reads the file):
//   cdxml          a drawing saved as CDXML
//   pptx           a drawing on a slide: captions, arrows and shapes as PowerPoint's own shapes,
//                  structures as CDXML inside the file
//   docx-drawing   a drawing as a figure in a Word document, and
//   xlsx-drawing   a drawing as a structure in an Excel cell: both keep the drawing's own data
//                  whole inside the file, so these two only show that nothing is lost on the way
//   word           a Word document's own text: TextRun and ParaStyle (and what they hold) as
//                  Word's run and paragraph properties
//   excel          a spreadsheet's own cells: Cell, CellStyle and ExcelLook as Excel's cells and
//                  styles
//   pptx-slide     a slide's own fields (transition, background, hidden…) as PowerPoint's
// A field must come back with the same value, unless:
//   - CANT_CARRY says that format can't hold it, and why (a fact about the format), or
//   - KNOWN_GAPS says it is lost today and should not be (a bug to fix; the reason says what is lost),
//   - or the field holding it is in one of those lists (its parts are lost with it).
// A known gap that starts to come back fails, and so does a CANT_CARRY field that comes back, so
// the lists can't go stale; so does a list entry naming a field that no longer exists. The last test
// adds made-up fields to the model and checks that they are reported lost: the check can fail.
//
// Run alone: npx vitest run tests/field-round-trip.test.ts

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { Doc, type Contents, type TextRun } from '../src/model';
import { writeCdxml } from '../src/io/cdxml-write';
import { readCdxml } from '../src/io/cdxml';
import { Deck } from '../src/deck/deck';
import { writePptx, type PptxOptions } from '../src/io/pptx-write';
import { readPptx } from '../src/io/pptx-read';
import { writeDocx, readDocx, type DocxDeps } from '../src/io/docx';
import { newDocument, objectRun, paraFromStyle, runStyleOf, type DocText } from '../src/document/document';
import * as rt from '../src/richtext';
import { Workbook, type Cell } from '../src/sheet/workbook';
import { writeXlsx, readXlsx, type XlsxPictures } from '../src/io/xlsx';

// ---------------------------------------------------------------------------------------------
// The fields, read from the model's own source

type Decls = Record<string, { name: string; type: string }[]>;
/** Type aliases met while reading (Justify = 'left' | 'center' | …), by name. */
const ALIASES: Record<string, string> = {};
/** Every interface (and `type X = { … }`) in a source file, with its fields and the text of their types. */
function declsOf(src: string): Decls {
  const sf = ts.createSourceFile('x.ts', src, ts.ScriptTarget.Latest, true);
  const out: Decls = {};
  // (a type that is only a choice of words, such as Justify, gets a sample on its own like one written out)
  ts.forEachChild(sf, (n) => { if (ts.isTypeAliasDeclaration(n) && !ts.isTypeLiteralNode(n.type)) ALIASES[n.name.text] = n.type.getText(sf).replace(/\s+/g, ' '); });
  const fields = (ms: ts.NodeArray<ts.TypeElement>) => ms.filter(ts.isPropertySignature).map((m) => ({ name: m.name.getText(sf), type: (m.type?.getText(sf) ?? '').replace(/\s+/g, ' ') }));
  ts.forEachChild(sf, (n) => {
    if (ts.isInterfaceDeclaration(n)) out[n.name.text] = fields(n.members);
    else if (ts.isTypeAliasDeclaration(n) && ts.isTypeLiteralNode(n.type)) out[n.name.text] = fields(n.type.members);
  });
  return out;
}
const MODEL_SRC = readFileSync(join(__dirname, '../src/model.ts'), 'utf8');
const MODEL = declsOf(MODEL_SRC);
const SHEET = declsOf(readFileSync(join(__dirname, '../src/sheet/workbook.ts'), 'utf8'));
const DECK = declsOf(readFileSync(join(__dirname, '../src/deck/deck.ts'), 'utf8'));

/** The objects a drawing holds; a Word document's text; a spreadsheet's cells; a slide. */
const DRAWING_TYPES = ['Atom', 'Bond', 'Caption', 'Arrow', 'Shape', 'TextRun'];
const WORD_TYPES = ['TextRun', 'ParaStyle', 'TableData'];
const EXCEL_TYPES = ['Cell', 'CellStyle'];
const SLIDE_TYPES = ['Slide'];

// ---------------------------------------------------------------------------------------------
// Sample values

/**
 * The ids of the objects in a test drawing: atoms a1–a2–a3 (a1 leftmost), bonds b1 (a1–a2) and
 * b2 (a2–a3), and a helper shape and arrow for fields that point at one. A sample written as a
 * function of these is worked out again with the ids the reopened file gave them, because ids are
 * renumbered on reading.
 */
interface Ids { a1: number; a2: number; a3: number; b1: number; b2: number; shape: number; arrow: number }
const NO_IDS: Ids = { a1: 1, a2: 2, a3: 3, b1: 4, b2: 5, shape: 6, arrow: 7 };
type Val = unknown | ((ids: Ids) => unknown);
/**
 * A field set for the test: its value, any other fields it needs to mean something (`with`), and
 * `label` for numbers that are only names (group numbers, the drawing order, a kept object's id),
 * which a file may renumber as long as they stay numbers.
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
function autoSample(type: string, name = ''): unknown | null {
  const t = type.trim();
  if (ALIASES[t] && ALIASES[t] !== t) return autoSample(ALIASES[t], name);
  // (a value in the field's own range: a colour for a colour, a fraction for an amount, a picture for a source)
  if (t === 'string' && /colou?r|Colou?r|^fill$|^clear$|^fg$|^bg$/.test(name)) return '#336699';
  if (t === 'string' && name === 'src') return PNG1;
  if (t === 'number' && /transparen|opacity|alpha|amount|bright|contrast|sharpen|^vol$|^round$|^tol$|Transparency|Opacity|Amount/.test(name)) return 0.4;
  if (t === 'string[]') return ['Sample'];
  if (t === 'number[]' && name) return null;
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
const SAMPLES: Record<string, Record<string, Sample>> = {
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
    table: { v: () => TABLE, with: { kind: 'table' } },
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
    ukind: { v: 'double', with: { underline: true } },
    ucolor: { v: '#ff0000', with: { underline: true } },
    dstrike: { v: true, with: { strike: true } },
    // (Word's own run properties, kept as the file had them: by their place in w:rPr)
    wrx: { v: '{"a":"<w:emboss/>"}' },
    // (the formatting before the change: Word writes back every look the text had, so only the one set here is compared)
    fmt: { v: 'Nate|2026-10-14T21:00:00Z|{"bold":true}', cmp: (w, g) => { const [a, b] = [String(w), String(g ?? '')].map((x) => x.split('|')); return a[0] === b[0] && a[1] === b[1] && same(JSON.parse(a[2]), JSON.parse(b[2] || 'null')); } },
    font: { v: 'Times New Roman' },
    obj: { v: null },
    hide: { v: null },
    color: { v: '#ff0000' },
    highlight: { v: '#ffff00' },
    size: { v: 14 },
    rev: { v: 'ins|Nate|2026-10-14T21:00:00Z' },
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
  // ---- the types inside the fields above, walked field by field (set inside the outer field's sample)
  ArrowTextLook: { align: { v: { above: 'left' } } },
  Attachment: { atoms: { v: (i) => [i.a1, i.a2, i.a3] }, show: { v: ['formula', 'mw'] } },
  BackgroundRemoval: { drop: { v: [[0.2, 0.3]] }, keep: { v: [[0.6, 0.5]] } },
  Frame: { atoms: { v: (i) => [i.a1, i.a2, i.a3] }, arrows: { v: (i) => [i.arrow] }, captions: { v: [] }, shapes: { v: (i) => [i.shape] } },
  HighlightStyle: { pattern: { v: 'crosshatch' } },
  MadeLabel: { runs: { v: [{ text: 'OMe', bold: true }] } },
  MorphStep: { pairs: { v: (i) => [[i.a1, i.a3]] }, shifts: { v: (i) => [[i.a1, i.a2, i.a3]] }, slides: { v: (i) => [[[i.a1, i.a2], [i.a3, i.a2]]] } },
  OrbitalTag: { colours: { v: ['#ff0000', '#0000ff'] } },
  ParaStyle: {
    bullet: { v: '–', with: { list: 'bullet' } },
    cont: { v: true, with: { list: 'bullet' } },
    level: { v: 1, with: { list: 'bullet' } },
    numType: { v: 'alphaUcParenR', with: { list: 'number' } },
    scheme: { v: 'roman', with: { list: 'number' } },
    startAt: { v: 3, with: { list: 'number' } },
    lineRule: { v: 'atLeast', with: { linePt: 14 } },
    shade: { v: '#ffff00' },
    style: { v: 'Heading1' },
    // (Word's own paragraph properties, kept as the file had them: by their place in w:pPr)
    wpx: { v: '{"e":"<w:outlineLvl w:val=\\"1\\"/>"}' },
    border: { v: { bottom: { style: 'single', w: 1, color: '#000000' } } },
    numLook: { v: { bold: true }, with: { list: 'number' } },
    section: { v: { kind: 'continuous' } },
  },
  PicFill: { px: { v: { w: 1, h: 1 } } },
  PictureFx: { recolor: { v: { kind: 'sepia' } }, shape: { v: 'ellipse' } },
  OleMark: { id: { v: 3, label: true }, prog: { v: 'ChemDraw.Document.6.0' } },
  Media: { src: { v: 'data:video/mp4;base64,AAAA' } },
  Pin: { hand: { v: -1 }, at: { v: { x: 0.2, y: 0.1 } }, dir: { v: { x: 1, y: 0 } }, ref: { v: (i) => [i.a1, i.a2] }, was: { v: { x: 100, y: 200 } } },
  TableCell: {
    align: { v: 'right' },
    span: { v: 2 },
    rowSpan: { v: 2 },
    borders: { v: { top: { style: 'single', w: 1, color: '#000000' } } },
    fig: { v: { w: 40, h: 30 } },
    pad: { v: { left: 4 } },
    paras: { v: [{ align: 'center' }] },
    runs: { v: [{ text: 'A', italic: true }] },
  },
  TableData: {
    head: { v: 2 },
    style: { v: 'TableGrid' },
    align: { v: ['right', 'center'] },
    cols: { v: [70, 50] },
    notes: { v: [{ text: 'a Measured at 25 °C.' }] },
    title: { v: [{ text: 'Table 1', bold: true }] },
    width: { v: { pct: 50 } },
  },
  // ---- a spreadsheet's cells (the excel column)
  Cell: {
    input: { v: 'Sample text' },
    array: { v: { rows: 1, cols: 1 }, with: { input: '=1+1' } },
    // (PubChem CID 702 is ethanol, C2H6O: https://pubchem.ncbi.nlm.nih.gov/compound/702)
    compound: { v: { cid: 702, name: 'Ethanol', fields: { Formula: 'C2H6O' } } },
    runs: { v: [{ text: 'Sample ', bold: true }, { text: 'text' }] },
  },
  CellStyle: { valign: { v: 'top' }, borders: { v: { top: { style: 'thin', color: '#ff0000' } } } },
  // ---- a slide's own fields (the pptx-slide column)
  Slide: {
    layout: { v: 'title' },
    notes: { v: 'Say this' },
    transition: { v: { kind: 'push', dir: 'up', dur: 1 } },
    background: { v: { kind: 'solid', color: '#ffd966' } },
    // (comments are numbered again on saving; the date is written with its milliseconds)
    comments: { v: [{ id: 1, x: 10, y: 20, author: 'Nate', date: '2026-10-14T21:00:00.000Z', text: 'Check this' }], label: true },
    notesLook: { v: { text: 'Say this', runs: [{ text: 'Say this', bold: true }] }, with: { notes: 'Say this' } },
    refs: { v: ['r1'] },
    refLook: { v: { form: 'author', numbering: 'deck', place: 'top-right', size: 9 } },
    refList: { v: { which: 'all' } },
    zotero: { v: { id: 'z1', code: 'ADDIN ZOTERO_ITEM', text: '(1)' } },
  },
};

/**
 * Fields that are not data to carry: ids are renumbered on reading (identity is kept by order),
 * positions are checked as the distance between the drawing's objects (a file may move the whole
 * drawing), and the text a caption holds is checked through its runs. `v: null` in SAMPLES also
 * leaves a field out, for these reasons:
 */
const NOT_WALKED: Record<string, Record<string, string>> = {
  Glue: { shape: "the id of the shape a connector is stuck to, renumbered on reading: connectors' round trips are in tests/cdxml-own-tags-kept.test.ts" },
  StepRoles: Object.fromEntries(['reactants', 'products', 'above', 'below', 'inside', 'plusses'].map((k) => [k, "ids of the step's species, renumbered on reading: steps' round trips are in tests/cdxml-own-tags-kept.test.ts and tests/auto-steps.test.ts"])),
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
    editedOutside: 'not written: worked out again on reading, when another program changed a frame Chemweave made (markEditedOutside in src/io/cdxml.ts)',
    energy: 'an energy diagram: its own round trip in tests/round-trip-review-objects.test.ts',
    newman: 'a Newman projection: made by the Newman tool, round trip in tests/newman.test.ts',
    torsion: 'a torsion chart: made from a conformer scan, tested in tests/torsion-chart.test.ts',
    plate: 'a TLC plate: tested in tests/plates.test.ts',
    diagram: 'a SmartArt-style diagram: tested in tests/diagrams.test.ts',
    smart: 'a Smart Scheme: its own round trip in tests/round-trip-review-objects.test.ts',
  },
  Attachment: {
    sig: 'a record of the structure the descriptors were worked out for: they are worked out again when a file is opened',
  },
  Cell: {
    structure: 'a structure in a cell: its drawing is walked by the xlsx-drawing column',
    style: 'walked field by field as CellStyle',
  },
  CellStyle: {
    excel: "Excel's own look as read from a file, written back as read (tests/xlsx-font-kept.test.ts, tests/xlsx.test.ts)",
  },
  Slide: {
    id: 'renumbered on reading',
    doc: "the slide's drawing: walked by the pptx column",
    anims: "an animation names objects on the slide by id, so it needs a slide with objects (tests/slides-animation.test.ts)",
    canvas: 'a canvas slide is saved as a slide for each keyframe and read back as one (tests/canvas-slides.test.ts)',
    section: "a slide's section is saved as the deck's list of sections (PptxRead.sections, how many slides each) and set again from it when the deck is opened (tests/sections.test.ts)",
    notesKept: 'the notes page as read from a file, written back as it was while the notes are unchanged (tests/notes.test.ts)',
  },
  TextRun: {
    text: 'the text itself: checked in every case',
    obj: 'a document object character: only in Document text, never in a drawing',
    hide: 'never in a file (only on runs being laid out, src/model.ts)',
  },
};

/**
 * Fields left out of one column only, and why: they need more than that column's test file has
 * (a comment or content control they name), and are checked where it has.
 */
const NOT_WALKED_IN: Partial<Record<Column, Record<string, string>>> = {
  word: {
    'TextRun.cc': 'names a content control in DocText.controls, which this test document has not (tests/kept-parts.test.ts)',
    'ParaStyle.cc': 'names a content control in DocText.controls, which this test document has not (tests/kept-parts.test.ts)',
    'TextRun.cmt': 'names a comment in DocText.comments, which this test document has not (tests/docx-comment-parts.test.ts)',
    'ParaStyle.soft': "a soft paragraph is saved in the same Word paragraph as the one above it, so it needs one above (tests/docx-soft-breaks.test.ts)",
  },
  excel: {
    'CellStyle.cellStyle': "names one of the workbook's cell styles (ExcelStyles.named), which this test workbook has not (tests/xlsx.test.ts)",
  },
};

/** Types inside a walked field that are not walked field by field, and why (their field is compared whole). */
const NOT_WALKED_TYPES: Record<string, string> = {
  Border: "a spreadsheet cell's border on one side: compared whole within CellStyle.borders",
  ExcelLook: "Excel's own look as read from a file (see NOT_WALKED.CellStyle.excel)",
  Structure: 'a structure in a cell (see NOT_WALKED.Cell.structure)',
};

// ---------------------------------------------------------------------------------------------
// What a format can't carry, and what it loses today

type Column = 'cdxml' | 'pptx' | 'docx-drawing' | 'xlsx-drawing' | 'word' | 'excel' | 'pptx-slide';

/** "Type.field" -> reason, per format: the format has no place for it (a fact, not a bug). */
const CANT_CARRY: Partial<Record<Column, Record<string, string>>> = {
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
    'Caption.pbox': "a PowerPoint text box's frame as the file had it (src/model.ts \"Slides:\"): slides are saved as PowerPoint",
    'TableCell.borders': "Documents only (src/model.ts \"Documents:\"): a Word table's cell borders",
    'TableCell.pad': "Documents only (src/model.ts \"Documents:\"): a Word table's cell margins",
    'TableCell.valign': "Documents only (src/model.ts \"Documents:\"): a Word table's text up and down in a cell",
    'TableData.autofit': "Documents only (src/model.ts \"Documents:\"): a Word table's AutoFit",
    'TableData.float': "Documents only (src/model.ts \"Documents:\"): a Word table's place on the page (a floating table)",
    'TableData.indent': "Documents only (src/model.ts \"Documents:\"): a Word table's indent from the margin",
    'TableData.noRepeat': "Documents only (src/model.ts \"Documents:\"): a Word table's Repeat Header Rows",
    'TableData.pad': "Documents only (src/model.ts \"Documents:\"): a Word table's cell margins",
    'TableData.rowH': "Documents only (src/model.ts \"Documents:\"): a Word table's row heights",
    'TableData.width': "Documents only (src/model.ts \"Documents:\"): a Word table's width on the page",
    'TextRun.pfx': "PowerPoint's own run formatting as the file had it (src/model.ts \"Slides:\"): slides are saved as PowerPoint",
    'TextRun.ucolor': "Documents only (src/model.ts \"Documents:\"): an underline's own colour in Word",
    'TextRun.ukind': "Word's and Excel's kinds of underline (double, wave…); a drawing's caption has one underline",
    'TextRun.wrx': "Word's own run properties as the file had them (src/model.ts \"Documents:\"): drawings' captions never have them",
  },
  pptx: {},
  'docx-drawing': {},
  'xlsx-drawing': {},
  word: {
    'ParaStyle.numType': "Slides only (src/model.ts \"Slides:\"): PowerPoint's numbering type; Word lists use their scheme",
    'ParaStyle.ppx': "Slides only: PowerPoint's own paragraph settings as the file had them",
    'TableCell.fig': "Drawings only (src/model.ts \"Drawings:\"): room for a structure dropped into a drawing's table",
    'TableData.notes': "a drawing table's footnotes; in a document they are paragraphs of their own",
    'TableData.size': "a drawing table's text size; a Word table's text carries its own sizes",
    'TableData.title': "a drawing table's title; in a document a table's caption is a paragraph of its own",
    'TextRun.cite': "Slides only (src/model.ts \"Slides:\"): a citation of the presentation's references; a document's citations are fields of their own",
    'TextRun.field': "Slides only (src/model.ts \"Slides:\"): a PowerPoint field; a document's fields are objects of their own",
    'TextRun.pfx': "Slides only: PowerPoint's own run formatting as the file had it",
    'TextRun.symbolFont': "ChemDraw files only: which font a ChemDraw file had a sign in",
  },
  excel: {},
  'pptx-slide': {},
};

/**
 * "Type.field" -> what is lost, per format: lost today, and should not be. Found when this test
 * was added (2026-11-22). Fix the writer or reader, then delete the line (the test fails while a
 * fixed field is still listed). Word and Excel keep each drawing's own data whole, so they lose
 * nothing; PowerPoint keeps a slide's structures as CDXML, so it shares CDXML's atom and bond gaps.
 */
const KNOWN_GAPS: Partial<Record<Column, Record<string, string>>> = {
  cdxml: {
    'Arrow.bent': "a hand-bent curved arrow comes back unbent, so it finds its own way round again when the structure changes",
    'Arrow.ellipse': "an arrow drawn along an ellipse loses its ellipse",
    'Arrow.reagentFor': "a catalytic cycle's reagent arrow loses which step it feeds",
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
    'Pin.dir': "a pinned thing's direction (a lone pair's two dots) is lost, so it no longer turns with its atoms",
    'TableCell.fill': "a table cell's shading is lost",
    'TableCell.rowSpan': "cells merged down are split again",
    'TableData.look': "the table style options (header row, banded rows…) are lost (see style)",
    'TableData.style': "a table style (PowerPoint's, used on drawings too) is lost",
    'TextRun.dstrike': "double strikethrough is lost (see strike)",
  },
  pptx: {
    'Arrow.step': "the slide's structures go through CDXML with new ids: a step loses its species",
    'Arrow.bent': "the slide's structures go through CDXML: a hand-bent curved arrow comes back unbent, so it finds its own way round again when the structure changes",
    'Arrow.ellipse': "the slide's structures go through CDXML: an arrow drawn along an ellipse loses its ellipse",
    'Arrow.from': "the slide's structures go through CDXML: a connector's tail comes unstuck from its shape",
    'Arrow.morph': "the animation's atom pairs are lost",
    'Arrow.pin': "an electron-pushing arrow comes unstuck from its atoms",
    'Arrow.reagentFor': "the slide's structures go through CDXML: a catalytic cycle's reagent arrow loses which step it feeds",
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
    'Media.across': "a video's Play Across Slides is lost",
    'Media.audio': "a sound (not a video) comes back as a video",
    'Media.hide': "a video's Hide While Not Playing is lost",
    'Media.length': "a video's length is lost",
    'Media.narration': "a recorded narration comes back as an ordinary sound or video",
    'Media.rewind': "a video's Rewind After Playing is lost",
    'PictureFx.bg': "Remove Background's marks (keep, drop, tolerance) are lost",
    'PictureFx.sharpen': "a picture's Sharpen or Soften is lost",
  },
  'docx-drawing': {},
  'xlsx-drawing': {},
  word: {
    'ParaStyle.cont': "a list item that carries on the one above (Shift+Enter) comes back as an item of its own",
    'TableCell.align': "a table cell's own alignment is lost",
    'TableCell.paras': "a table cell's paragraph settings are lost",
    'TableData.look': "the table style options (header row, banded rows…) are lost",
    'TableData.noRepeat': "Repeat Header Rows off is lost",
  },
  excel: {},
  'pptx-slide': {
    'SlideHF.footer': "a slide's own Footer switch is lost (checked on a master with no footer text)",
  },
};

// ---------------------------------------------------------------------------------------------
// Which fields are walked, and where each one is set

/**
 * One field to walk. A field of a type inside another (a TableCell's `align`) is set inside a
 * sample of the outer field that holds it (`root`, such as Shape.table), at `path` within it.
 */
interface Item {
  key: string; type: string; field: string; sample: Sample;
  rootType: string; rootField: string | null; path: (string | number)[];
  /** The fields holding it, outermost first ("Shape.table", "TableData.rows"). */
  chain: string[];
}
interface Walk { items: Item[]; unhosted: string[]; types: string[]; /** Fields walked through the type they hold, so they need no sample of their own. */ covered: Set<string> }

/** Where a type named in a field's type sits in that field's value, or null when it can't be placed. */
function placeIn(type: string, name: string): (string | number)[] | null {
  const t = type.replace(/ \| undefined$/, '');
  if (t === name || t === `Partial<${name}>`) return [];
  if (t === `${name}[]` || t === `(${name} | null)[]`) return [0];
  if (t === `${name}[][]`) return [0, 0];
  const m = new RegExp(`\\{[^}]*?\\b(\\w+)\\??: ${name};`).exec(t);
  return m ? [m[1]] : null;
}

/** Every field reached from `tops`, in `decls`, with the types inside them, walked by their types. */
function walk(decls: Decls, tops: string[]): Walk {
  const items: Item[] = [], unhosted: string[] = [], types: string[] = [], covered = new Set<string>();
  const host = new Map<string, { rootType: string; rootField: string | null; path: (string | number)[]; chain: string[] }>();
  for (const t of tops) host.set(t, { rootType: t, rootField: null, path: [], chain: [] });
  const queue = [...tops];
  while (queue.length) {
    const type = queue.shift()!;
    types.push(type);
    const h = host.get(type)!;
    for (const f of decls[type] ?? []) {
      if (NOT_WALKED[type]?.[f.name]) continue;
      const s = SAMPLES[type]?.[f.name] ?? (autoSample(f.type, f.name) !== null ? { v: autoSample(f.type, f.name) } : undefined);
      if (s?.v === null) continue;
      if (s) items.push({ key: `${type}.${f.name}`, type, field: f.name, sample: s, rootType: h.rootType, rootField: h.rootField, path: h.path, chain: h.chain });
      // the types this field holds
      for (const m of f.type.matchAll(/\b([A-Z][A-Za-z0-9]+)\b/g)) {
        const name = m[1];
        if (!decls[name] || host.has(name) || tops.includes(name)) continue;
        if (NOT_WALKED_TYPES[name]) continue;
        const sub = placeIn(f.type, name);
        if (!sub) { unhosted.push(`${type}.${f.name} (${f.type}) holds ${name}`); continue; }
        covered.add(`${type}.${f.name}`);
        const root = h.rootField === null ? { rootType: type, rootField: f.name, path: sub } : { rootType: h.rootType, rootField: h.rootField, path: [...h.path, f.name, ...sub] };
        host.set(name, { ...root, chain: [...h.chain, `${type}.${f.name}`] });
        queue.push(name);
      }
    }
  }
  return { items, unhosted, types, covered };
}

/** The fields an object of a type must have, when a test makes one to set a field in. */
const TYPE_BASE: Record<string, unknown> = {
  IndexMark: { main: 'Aldol reaction' },
  AuthorityMark: { short: 'Smith' },
  TabStop: { pos: 72, kind: 'left' },
  RowHeight: { h: 20 },
  CellMargins: { top: 2, bottom: 2, left: 4, right: 4 },
};
/** A table to test a table's fields on: two rows of two cells, the first a heading row. */
const TABLE = { cols: [60, 40], rows: [[{ runs: [{ text: 'A' }] }, { runs: [{ text: 'B', bold: true }] }], [{ runs: [{ text: 'C' }] }, { runs: [{ text: 'D' }] }]], head: 1, lines: 'grid' };
/** The object a walk starts from, where it needs fields of its own (a table in a Word document). */
const ROOT_BASE: Record<string, unknown> = { TableData: TABLE };

/** What to set on the outermost object for an item: the field itself, or the outer field with it inside. */
function rootPatch(it: Item, ids: Ids): Record<string, unknown> {
  const own = { ...(val(it.sample.with, ids) as object ?? {}), [it.field]: val(it.sample.v, ids) };
  if (it.rootField === null) return own;
  const outer = SAMPLES[it.rootType]?.[it.rootField];
  const start = val(outer?.v, ids) ?? (ROOT_BASE[it.rootType] as Record<string, unknown> | undefined)?.[it.rootField];
  const value = structuredClone(start ?? (typeof it.path[0] === 'number' ? [] : it.path.length ? {} : TYPE_BASE[it.type] ?? {})) as Record<string | number, unknown>;
  let o: Record<string | number, unknown> = value;
  it.path.forEach((k, i) => {
    const next = it.path[i + 1];
    if (o[k] == null) o[k] = next === undefined ? structuredClone(TYPE_BASE[it.type] ?? {}) : typeof next === 'number' ? [] : {};
    o = o[k] as Record<string | number, unknown>;
  });
  if (it.path.length === 0 || o === value) Object.assign(value, own);
  else Object.assign(o, own);
  return { ...(val(outer?.with, ids) as object ?? {}), [it.rootField]: value };
}
/** The object holding an item's field in what came back, from the outermost object. */
function reach(it: Item, root: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!root || it.rootField === null) return root;
  let o: unknown = root[it.rootField];
  for (const k of it.path) o = (o as Record<string | number, unknown> | undefined)?.[k];
  return o as Record<string, unknown> | undefined;
}
const outerSample = (it: Item): Sample => (it.rootField === null ? it.sample : SAMPLES[it.rootType]?.[it.rootField] ?? { v: null });

// ---------------------------------------------------------------------------------------------
// Building the files, and saving and opening them

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 40, 0, 0, 0, 30]);
const pptxOpts: PptxOptions = { async picture(d) { const b = d.bounds(); return b ? { png: PNG, svg: '<svg xmlns="http://www.w3.org/2000/svg"/>', box: b } : null; }, async svgToPng() { return PNG; } };
const docxDeps: DocxDeps = { async picture() { return { png: PNG, w: 80, h: 40 }; }, async svgToPng() { return PNG; } };
const xlsxDeps: XlsxPictures = { box: () => ({ w: 60, h: 40 }), picture: async () => PNG };

/**
 * The drawing for one item: three bonded atoms, a helper shape and arrow off to the right, and the
 * object under test with the field set.
 */
function build(it: Item): Doc {
  const doc = new Doc();
  const s = outerSample(it);
  doc.bulk(() => {
    const L = doc.style.bondLength;
    const a1 = doc.addAtom(100, 100).id;
    const a2 = doc.addAtom(100 + L, 100 - 10).id;
    const a3 = doc.addAtom(100 + 2 * L, 100).id;
    const b1 = s.alone || it.sample.alone ? -1 : doc.addBond(a1, a2).id;
    const b2 = s.alone || it.sample.alone ? -1 : doc.addBond(a2, a3).id;
    const shape = doc.addShape({ kind: 'rect', x1: 400, y1: 300, x2: 440, y2: 330 }).id;
    const arrow = doc.addArrow({ ...ARROW, tail: { x: 400, y: 360 }, head: { x: 460, y: 360 } }).id;
    const ids: Ids = { a1, a2, a3, b1, b2, shape, arrow };
    s.setup?.(doc, ids);
    if (it.rootField === null) it.sample.setup?.(doc, ids);
    const patch = rootPatch(it, ids);
    const type = it.rootType;
    if (type === 'Atom') Object.assign(doc.atoms.get(a2)!, patch);
    else if (type === 'Bond') Object.assign(doc.bonds.get(b1)!, patch);
    else if (type === 'Caption' || type === 'TextRun') {
      const run = type === 'TextRun' ? { text: 'Sample text', ...patch, ...(it.field === 'text' ? { text: 'Sample text' } : {}) } : { text: 'Sample text' };
      const c = doc.addCaption({ x: 100, y: 160, runs: [run as TextRun], justify: 'left' });
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
async function roundTrip(docs: Doc[], format: Column): Promise<Contents[]> {
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
  if (format === 'docx-drawing') {
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
function findBack(type: string, c: Contents): { ids: Ids; obj: Record<string, unknown> | undefined } {
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

/** What came back for each item: the object holding its field, and the ids to work its value out with. */
interface Back { obj: Record<string, unknown> | undefined; ids: Ids }

async function tripDrawings(items: Item[], format: Column): Promise<Back[]> {
  const backs = await roundTrip(items.map(build), format);
  return items.map((it, i) => {
    const fb = backs[i] ? findBack(it.rootType, backs[i]) : { ids: NO_IDS, obj: undefined };
    return { ids: fb.ids, obj: reach(it, fb.obj) };
  });
}

/** A Word document with one paragraph for each item (marked #n#), saved and opened again. */
async function tripWord(items: Item[]): Promise<Back[]> {
  const base = newDocument();
  const n = runStyleOf(base.styles.Normal);
  const N = paraFromStyle(base.styles.Normal, {});
  const runs: TextRun[] = [], paras: DocText['paras'] = [];
  const objects: DocText['objects'] = {};
  items.forEach((it, i) => {
    const p = rootPatch(it, NO_IDS);
    if (it.rootType === 'TextRun') {
      const { text, ...rest } = p as { text?: string };
      runs.push({ ...n, ...rest, text: `${it.field === 'text' || !text ? 'Sample text' : text} #${i}#` });
      paras.push({ ...N });
    } else if (it.rootType === 'TableData') {
      // a marked paragraph, then the table in a paragraph of its own
      runs.push({ ...n, text: `Sample text #${i}#` }, { ...n, text: '\n' }, objectRun(1000 + i, n));
      paras.push({ ...N }, { ...N });
      objects[1000 + i] = { kind: 'table', table: { ...structuredClone(TABLE), ...p } as never };
    } else {
      runs.push({ ...n, text: `Sample text #${i}#` });
      paras.push({ ...N, ...p });
    }
    runs.push({ ...n, text: '\n' });
  });
  runs.pop();
  const t: DocText = { ...base, runs: rt.normalizeRuns(runs), paras, objects: { ...base.objects, ...objects } };
  const back = (await readDocx(await writeDocx(t, docxDeps))).doc;
  // the paragraphs that came back, each with its runs
  const got: TextRun[][] = [[]];
  for (const r of back.runs) {
    r.text.split('\n').forEach((part, k) => {
      if (k > 0) got.push([]);
      if (part) got[got.length - 1].push({ ...r, text: part });
    });
  }
  return items.map((it, i) => {
    const at = got.findIndex((ps) => ps.map((r) => r.text).join('').includes(`#${i}#`));
    if (at < 0) return { ids: NO_IDS, obj: undefined };
    let root: unknown;
    if (it.rootType === 'TextRun') root = got[at].find((r) => r.text.includes('Sample') || r.text.includes(`#${i}#`));
    else if (it.rootType === 'TableData') {
      const o = [...got[at], ...(got[at + 1] ?? [])].find((r) => r.obj !== undefined && back.objects[r.obj]?.kind === 'table');
      root = o ? (back.objects[o.obj!] as { table: unknown }).table : undefined;
    } else root = back.paras[at];
    return { ids: NO_IDS, obj: reach(it, root as Record<string, unknown> | undefined) };
  });
}

/** A workbook with one cell for each item, down column A, saved and opened again. */
async function tripExcel(items: Item[]): Promise<Back[]> {
  const wb = new Workbook(['Sheet1']);
  wb.build(() => items.forEach((it, i) => {
    const p = rootPatch(it, NO_IDS);
    wb.sheet.setCell(i, 0, (it.rootType === 'Cell' ? { input: 'Sample text', ...p } : { input: 'Sample text', style: p }) as Cell);
  }));
  const back = (await readXlsx(await writeXlsx(wb, xlsxDeps))).book;
  return items.map((it, i) => {
    const c = back.sheet.cell(i, 0) as Record<string, unknown> | undefined;
    return { ids: NO_IDS, obj: reach(it, it.rootType === 'Cell' ? c : c?.style as Record<string, unknown> | undefined) };
  });
}

/** A presentation with one slide for each item, saved and opened again. */
async function tripSlides(items: Item[]): Promise<Back[]> {
  const d = Deck.design(new Doc(), { w: 720, h: 405 });
  const slides = items.map((it) => ({ layout: 'blank', doc: new Doc(), notes: '', ...rootPatch(it, NO_IDS) }));
  const back = readPptx(await writePptx({ size: d.size, master: d.master, slides: slides as never }, pptxOpts));
  return items.map((it, i) => ({ ids: NO_IDS, obj: reach(it, back.slides[i] as unknown as Record<string, unknown>) }));
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
// The columns

const COLUMNS: { name: Column; decls: Decls; tops: string[]; trip: (items: Item[]) => Promise<Back[]> }[] = [
  { name: 'cdxml', decls: MODEL, tops: DRAWING_TYPES, trip: (x) => tripDrawings(x, 'cdxml') },
  { name: 'pptx', decls: MODEL, tops: DRAWING_TYPES, trip: (x) => tripDrawings(x, 'pptx') },
  { name: 'docx-drawing', decls: MODEL, tops: DRAWING_TYPES, trip: (x) => tripDrawings(x, 'docx-drawing') },
  { name: 'xlsx-drawing', decls: MODEL, tops: DRAWING_TYPES, trip: (x) => tripDrawings(x, 'xlsx-drawing') },
  { name: 'word', decls: MODEL, tops: WORD_TYPES, trip: tripWord },
  { name: 'excel', decls: SHEET, tops: EXCEL_TYPES, trip: tripExcel },
  { name: 'pptx-slide', decls: DECK, tops: SLIDE_TYPES, trip: tripSlides },
];

/**
 * What a column loses of `items`: one line each, "lost:", "fixed:" (a known gap that came back) or
 * "carried:" (a CANT_CARRY field that came back). A field inside one the lists name (a TableFloat's
 * `x` inside TableData.float) is excused with it; the outer entry is "fixed" once all of it comes back.
 */
async function check(column: Column, all: Item[], trip: (items: Item[]) => Promise<Back[]>): Promise<string[]> {
  const cant = CANT_CARRY[column] ?? {}, gaps = KNOWN_GAPS[column] ?? {};
  const items = all.filter((it) => !NOT_WALKED_IN[column]?.[it.key]);
  const errors: string[] = [];
  let backs: Back[] = [];
  try {
    backs = await trip(items);
  } catch (e) {
    // one field breaks the whole file: find which, one at a time
    for (const it of items) { try { await trip([it]); } catch (e1) { errors.push(`${it.key}: ${String(e1).slice(0, 160)}`); } }
    if (!errors.length) errors.push(String(e).slice(0, 300));
  }
  const lost: string[] = [], fixed: string[] = [], carried: string[] = [];
  const outer = new Map<string, boolean>();
  items.forEach((it, i) => {
    const b = backs[i];
    if (!b) return;
    const got = b.obj?.[it.field];
    const want = val(it.sample.v, b.ids);
    const ok = !!b.obj && (it.sample.cmp ? it.sample.cmp(want, got) : same(want, got, it.sample.label));
    const listed = (k: string) => !!(cant[k] || gaps[k]);
    // (a listed field's own value counts too: its parts can all come back while it, as a whole, does not)
    for (const k of [...it.chain, it.key]) if (listed(k)) outer.set(k, (outer.get(k) ?? true) && ok);
    if (!ok && !listed(it.key) && !it.chain.some(listed)) lost.push(`${it.key}: set ${JSON.stringify(want)?.slice(0, 120)}, came back ${b.obj ? JSON.stringify(got)?.slice(0, 120) ?? 'undefined' : '(object not found)'}`);
    if (ok && gaps[it.key]) fixed.push(`${it.key}: now kept; delete it from KNOWN_GAPS['${column}']`);
    if (ok && cant[it.key]) carried.push(`${it.key}: comes back, so the format can carry it; delete it from CANT_CARRY['${column}']`);
  });
  for (const [k, all] of outer) {
    if (!all) continue;
    if (gaps[k]) fixed.push(`${k}: everything in it now comes back; delete it from KNOWN_GAPS['${column}']`);
    else carried.push(`${k}: everything in it comes back, so the format can carry it; delete it from CANT_CARRY['${column}']`);
  }
  return [...errors.sort().map((x) => `threw: ${x}`), ...lost.sort().map((x) => `lost: ${x}`), ...fixed.sort().map((x) => `fixed: ${x}`), ...carried.sort().map((x) => `carried: ${x}`)];
}

describe('every model field round-trips every format (R3)', () => {
  it('reads the fields from the model', () => {
    for (const t of DRAWING_TYPES) expect(MODEL[t]?.length, t).toBeGreaterThan(5);
    for (const t of EXCEL_TYPES) expect(SHEET[t]?.length, t).toBeGreaterThan(5);
    expect(DECK.Slide?.length).toBeGreaterThan(5);
  });

  it('has a sample, or a reason it is not walked, for every field of every type it reaches', () => {
    const missing: string[] = [];
    for (const c of COLUMNS) {
      const w = walk(c.decls, c.tops);
      for (const type of w.types) {
        for (const f of c.decls[type] ?? []) {
          if (NOT_WALKED[type]?.[f.name]) continue;
          const s = SAMPLES[type]?.[f.name];
          if (s?.v === null) { missing.push(`${type}.${f.name}: v is null but NOT_WALKED gives no reason`); continue; }
          if (!s && autoSample(f.type, f.name) === null && !w.covered.has(`${type}.${f.name}`)) missing.push(`${type}.${f.name} (${f.type}): add a sample value to SAMPLES in tests/field-round-trip.test.ts`);
        }
      }
      for (const u of w.unhosted) missing.push(`${u}: say where it sits (placeIn) or add the type to NOT_WALKED_TYPES with the reason`);
    }
    expect([...new Set(missing)].sort().join('\n')).toBe('');
  });

  it('lists only fields and types that exist', () => {
    const known = new Set<string>();
    for (const c of COLUMNS) for (const t of walk(c.decls, c.tops).types) for (const f of c.decls[t] ?? []) known.add(`${t}.${f.name}`);
    const bad: string[] = [];
    for (const [t, fs] of Object.entries(NOT_WALKED)) for (const f of Object.keys(fs)) if (!known.has(`${t}.${f}`)) bad.push(`NOT_WALKED ${t}.${f}`);
    for (const [col, list] of [...Object.entries(CANT_CARRY).map(([c, l]) => [`CANT_CARRY['${c}']`, l] as const), ...Object.entries(KNOWN_GAPS).map(([c, l]) => [`KNOWN_GAPS['${c}']`, l] as const), ...Object.entries(NOT_WALKED_IN).map(([c, l]) => [`NOT_WALKED_IN['${c}']`, l] as const)])
      for (const k of Object.keys(list)) if (!known.has(k)) bad.push(`${col} ${k}`);
    for (const [t] of Object.entries(SAMPLES)) for (const f of Object.keys(SAMPLES[t])) if (!known.has(`${t}.${f}`)) bad.push(`SAMPLES ${t}.${f}`);
    for (const t of Object.keys(NOT_WALKED_TYPES)) if (![MODEL, SHEET, DECK].some((d) => d[t])) bad.push(`NOT_WALKED_TYPES ${t}`);
    expect(bad, 'entries naming a field or type that no longer exists: take them off').toEqual([]);
  });

  for (const c of COLUMNS) {
    it(`${c.name}: every field comes back, except what the format can't hold and the known gaps`, async () => {
      const report = await check(c.name, walk(c.decls, c.tops).items, c.trip);
      expect(report.join('\n'), `${c.name}: carry each lost field (or, only if the format truly can't, add it to CANT_CARRY['${c.name}'] with the reason)`).toBe('');
    }, 180_000);
  }

  it('reports a field planted in the model as lost (the check can fail)', async () => {
    const planted = MODEL_SRC
      .replace('export interface Atom {', 'export interface Atom {\n  plantedAtom?: string;')
      .replace('export interface TableCell {', 'export interface TableCell {\n  plantedCell?: string;')
      .replace('export interface TextRun {', 'export interface TextRun {\n  plantedRun?: string;');
    const items = (w: Walk) => w.items.filter((it) => it.field.startsWith('planted'));
    const drawing = items(walk(declsOf(planted), DRAWING_TYPES));
    expect(drawing.map((it) => it.key).sort()).toEqual(['Atom.plantedAtom', 'TableCell.plantedCell', 'TextRun.plantedRun']);
    const cdxml = (await check('cdxml', drawing, (x) => tripDrawings(x, 'cdxml'))).join('\n');
    for (const k of ['Atom.plantedAtom', 'TableCell.plantedCell', 'TextRun.plantedRun']) expect(cdxml, `cdxml misses ${k}`).toContain(`lost: ${k}`);
    // (PowerPoint: structures go as CDXML inside the file; a text box and a table also keep their whole data in a tag, so their made-up fields come back)
    const pptx = (await check('pptx', drawing, (x) => tripDrawings(x, 'pptx'))).join('\n');
    expect(pptx, 'pptx misses Atom.plantedAtom').toContain('lost: Atom.plantedAtom');
    // (a drawing inside Word keeps its data whole, so a made-up field comes back there: that column shows only that nothing is lost on the way)
    expect((await check('docx-drawing', drawing, (x) => tripDrawings(x, 'docx-drawing'))).join('\n')).toBe('');
    const word = items(walk(declsOf(planted), WORD_TYPES));
    const wordReport = (await check('word', word, tripWord)).join('\n');
    for (const k of ['TextRun.plantedRun', 'TableCell.plantedCell']) expect(wordReport, `word misses ${k}`).toContain(`lost: ${k}`);
  }, 120_000);
});
