/**
 * A large CDXML file that samples everything the format can hold: every object of the CDX/CDXML
 * specification, every value of its listed properties (bond orders and displays, node types,
 * graphic, arrow, oval, orbital, bracket and symbol types, polymer brackets, TLC plates,
 * spectra…), and an assortment of fonts, faces, sizes, colors, turned, tiny, huge and
 * overlapping objects. Real drawings rarely hold the less common objects, so this file is the
 * one place they all meet.
 *
 * Built here in code, by hand, from the specification: CambridgeSoft, "CDX File Format
 * Specification" (CDX SDK), objects at https://chemapps.stolaf.edu/iupac/cdx/sdk/<Object>.htm and
 * properties under …/sdk/properties/. Newer objects not in that specification (the arrow object,
 * ColoredMolecularArea, annotation) follow how ChemDraw 25 writes them, as read in src/io/cdx.ts.
 * Element symbols and atomic numbers: IUPAC Periodic Table of the Elements (4 May 2022).
 *
 * tests/cdxml-sampler.test.ts checks that it covers the specification's lists and prints what
 * this program keeps through open and save. `SAMPLER_OUT=<file> npx vitest run
 * tests/cdxml-sampler.test.ts` writes it out to open in ChemDraw.
 */

type V = string | number | null | undefined;
type A = Record<string, V>;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const f = (n: number) => String(Math.round(n * 100) / 100);
const pt = (x: number, y: number) => `${f(x)} ${f(y)}`;
const pt3 = (x: number, y: number) => `${f(x)} ${f(y)} 0`;
const bbox = (x1: number, y1: number, x2: number, y2: number) => `${f(x1)} ${f(y1)} ${f(x2)} ${f(y2)}`;

function tag(name: string, a: A, kids: string | string[] = ''): string {
  const at = Object.entries(a).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => ` ${k}="${esc(String(v))}"`).join('');
  const body = Array.isArray(kids) ? kids.join('') : kids;
  return body ? `<${name}${at}>${body}</${name}>` : `<${name}${at}/>`;
}

/** Fonts (ids are their own numbering, apart from object ids). */
const FONT = { arial: 3, times: 4, courier: 5, symbol: 6, calibri: 7, helvetica: 8, segoe: 9, missing: 10 } as const;
const FONTS: [number, string, string][] = [
  [FONT.arial, 'iso-8859-1', 'Arial'], [FONT.times, 'iso-8859-1', 'Times New Roman'], [FONT.courier, 'iso-8859-1', 'Courier New'],
  [FONT.symbol, 'Symbol', 'Symbol'], [FONT.calibri, 'iso-8859-1', 'Calibri'], [FONT.helvetica, 'iso-8859-1', 'Helvetica'],
  [FONT.segoe, 'iso-8859-1', 'Segoe UI'], [FONT.missing, 'iso-8859-1', 'No Such Font Sans'],
];

/** Colors: 0 is black and 1 white by default; the table's entries are numbered from 2. */
const COLORS: [string, number, number, number][] = [
  ['white', 1, 1, 1], ['black', 0, 0, 0], ['red', 1, 0, 0], ['green', 0, 0.6, 0], ['blue', 0, 0, 1], ['cyan', 0, 1, 1],
  ['magenta', 1, 0, 1], ['yellow', 1, 1, 0], ['orange', 1, 0.5, 0], ['purple', 0.5, 0, 0.5], ['gray', 0.5, 0.5, 0.5],
  ['teal', 0, 0.5, 0.5], ['brown', 0.6, 0.3, 0.1], ['pink', 1, 0.75, 0.8], ['navy', 0, 0, 0.5], ['pale', 0.9, 0.95, 1],
];
const C = Object.fromEntries(COLORS.map(([n], i) => [n, i + 2])) as Record<string, number>;

/** Element symbols by atomic number (IUPAC Periodic Table of the Elements, 2022). */
export const ELEMENTS = ('H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr '
  + 'Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os '
  + 'Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc '
  + 'Lv Ts Og').split(' ');

/** The specification's values, by property (CDX SDK property pages). */
export const SPEC_VALUES: Record<string, string[]> = {
  Order: ['1', '2', '3', '4', '5', '6', '0.5', '1.5', '2.5', '3.5', '4.5', '5.5', 'dative', 'ionic', 'hydrogen', 'threecenter'],
  Display: ['Solid', 'Dash', 'Hash', 'WedgedHashBegin', 'WedgedHashEnd', 'Bold', 'WedgeBegin', 'WedgeEnd', 'Wavy', 'HollowWedgeBegin', 'HollowWedgeEnd', 'WavyWedgeBegin', 'WavyWedgeEnd', 'Dot', 'DashDot'],
  Display2: ['Solid', 'Dash', 'Hash', 'WedgedHashBegin', 'WedgedHashEnd', 'Bold', 'WedgeBegin', 'WedgeEnd', 'Wavy', 'HollowWedgeBegin', 'HollowWedgeEnd', 'WavyWedgeBegin', 'WavyWedgeEnd', 'Dot', 'DashDot'],
  DoublePosition: ['Center', 'Right', 'Left'],
  BS: ['U', 'N', 'E', 'Z'],
  Topology: ['Unspecified', 'Ring', 'Chain', 'RingOrChain'],
  RxnParticipation: ['Unspecified', 'ReactionCenter', 'MakeOrBreak', 'ChangeType', 'MakeAndChange', 'NotReactionCenter', 'NoChange', 'Unmapped'],
  NodeType: ['Unspecified', 'Element', 'ElementList', 'ElementListNickname', 'Nickname', 'Fragment', 'Formula', 'GenericNickname', 'AnonymousAlternativeGroup', 'NamedAlternativeGroup', 'MultiAttachment', 'VariableAttachment', 'ExternalConnectionPoint', 'LinkNode'],
  AS: ['U', 'N', 'R', 'S', 'r', 's', 'u'],
  Radical: ['None', 'Singlet', 'Doublet', 'Triplet'],
  EnhancedStereoType: ['Unspecified', 'None', 'Absolute', 'Or', 'And'],
  ExternalConnectionType: ['Unspecified', 'Diamond', 'Star', 'PolymerBead', 'Wavy'],
  Geometry: ['Unknown', '1', 'Linear', 'Bent', 'TrigonalPlanar', 'TrigonalPyramidal', 'SquarePlanar', 'Tetrahedral', 'TrigonalBipyramidal', 'SquarePyramidal', '5', 'Octahedral', '6', '7', '8', '9', '10'],
  IsotopicAbundance: ['Unspecified', 'Any', 'Natural', 'Enriched', 'Deficient', 'Nonnatural'],
  LabelDisplay: ['Auto', 'Left', 'Center', 'Right', 'Above', 'Below'],
  RingBondCount: ['Unspecified', 'NoRingBonds', 'AsDrawn', 'SimpleRing', 'Fusion', 'SpiroOrHigher'],
  RxnStereo: ['Unspecified', 'Inversion', 'Retention'],
  Translation: ['Equal', 'Broad', 'Narrow', 'Any'],
  UnsaturatedBonds: ['Unspecified', 'MustBeAbsent', 'MustBePresent'],
  GraphicType: ['Line', 'Arc', 'Rectangle', 'Oval', 'Orbital', 'Bracket', 'Symbol'],
  ArrowType: ['NoHead', 'HalfHead', 'FullHead', 'Resonance', 'Equilibrium', 'Hollow', 'RetroSynthetic', 'NoGo', 'Dipole'],
  BracketType: ['RoundPair', 'SquarePair', 'CurlyPair', 'Square', 'Curly', 'Round'],
  BracketUsage: ['Unspecified', 'SRU', 'Monomer', 'Mer', 'Copolymer', 'CopolymerAlternating', 'CopolymerRandom', 'CopolymerBlock', 'Crosslink', 'Graft', 'Modification', 'Component', 'MixtureUnordered', 'MixtureOrdered', 'MultipleGroup', 'Generic', 'Anypolymer'],
  LineType: ['Solid', 'Dashed', 'Bold', 'Wavy'],
  OrbitalType: ['s', 'oval', 'lobe', 'p', 'hybridPlus', 'hybridMinus', 'dz2Plus', 'dz2Minus', 'dxy', 'sShaded', 'ovalShaded', 'lobeShaded', 'pShaded', 'sFilled', 'ovalFilled', 'lobeFilled', 'pFilled', 'hybridPlusFilled', 'hybridMinusFilled', 'dz2PlusFilled', 'dz2MinusFilled', 'dxyFilled'],
  OvalType: ['Circle', 'Shaded', 'Filled', 'Dashed', 'Bold', 'Shadowed'],
  RectangleType: ['Plain', 'RoundEdge', 'Shadow', 'Shaded', 'Filled', 'Dashed', 'Bold'],
  SymbolType: ['LonePair', 'Electron', 'RadicalCation', 'RadicalAnion', 'CirclePlus', 'CircleMinus', 'Dagger', 'DoubleDagger', 'Plus', 'Minus', 'Racemic', 'Absolute', 'Relative'],
  PolymerRepeatPattern: ['HeadToTail', 'HeadToHead', 'EitherUnknown'],
  PolymerFlipType: ['Unspecified', 'NoFlip', 'Flip'],
  Justification: ['Right', 'Left', 'Center', 'Full', 'Above', 'Below', 'Auto', 'Best'],
  LabelJustification: ['Right', 'Left', 'Center', 'Full', 'Above', 'Below', 'Auto', 'Best'],
  CaptionJustification: ['Right', 'Left', 'Center', 'Full', 'Above', 'Below', 'Auto', 'Best'],
  LabelAlignment: ['Auto', 'Left', 'Center', 'Right', 'Above', 'Below', 'Best'],
  CurveType: ['1', '2', '4', '8', '16', '32', '64', '128', '256', '512'],
  Class: ['Unknown', 'Chromatogram', 'Infrared', 'UVVis', 'XRayDiffraction', 'MassSpectrum', 'NMR', 'Raman', 'Fluorescence', 'Atomic'],
  XType: ['Unknown', 'Wavenumbers', 'Microns', 'Hertz', 'MassUnits', 'PartsPerMillion', 'Other'],
  YType: ['Unknown', 'Absorbance', 'Transmittance', 'PercentTransmittance', 'Other', 'ArbitraryUnits'],
  PageDefinition: ['Undefined', 'Center', 'TL4', 'IDTerm', 'FlushLeft', 'FlushRight', 'Reaction1', 'Reaction2', 'MulticolumnTL4', 'MulticolumnNonTL4', 'UserDefined'],
  // ('Undefined' left out: a 3D feature or constraint of no kind is not one ChemDraw can draw)
  ConstraintType: ['Distance', 'Angle', 'ExclusionSphere'],
  GeometricFeature: ['PointFromPointPointDistance', 'PointFromPointPointPercentage', 'PointFromPointNormalDistance', 'LineFromPoints', 'PlaneFromPoints', 'PlaneFromPointLine', 'CentroidFromPoints', 'NormalFromPointPlane'],
  TagType: ['Unknown', 'Double', 'Long', 'String'],
  PositioningType: ['auto', 'angle', 'offset', 'absolute'],
  ChemicalPropertyType: ['Unspecified', 'ChemicalName'],
  Side: ['top', 'left', 'bottom', 'right'],
};

/** Every object of the specification, plus the newer ones ChemDraw 25 writes. */
export const SPEC_OBJECTS = [
  'CDXML', 'page', 'group', 'fragment', 'n', 'b', 't', 's', 'graphic', 'curve', 'embeddedobject', 'table', 'altgroup',
  'templategrid', 'regnum', 'scheme', 'step', 'spectrum', 'objecttag', 'sequence', 'crossreference', 'splitter',
  'bracketedgroup', 'bracketattachment', 'crossingbond', 'border', 'geometry', 'constraint', 'tlcplate', 'tlclane',
  'tlcspot', 'chemicalproperty', 'colortable', 'color', 'fonttable', 'font', 'represent',
  'arrow', 'ColoredMolecularArea', 'annotation',
];

// ---------------------------------------------------------------------------------------------
// building blocks

let next = 100;
const newId = () => next++;

interface Run { text: string; font?: number; size?: number; face?: number; color?: number }
const run = (r: Run) => tag('s', { font: r.font ?? FONT.arial, size: r.size ?? 10, color: r.color, face: r.face ?? 0 }, esc(r.text));

/** A text object: a caption on the page, or (with `label`) an atom's label. */
function text(x: number, y: number, runs: Run[] | string, a: A = {}, kids: string[] = []): string {
  const rs = typeof runs === 'string' ? [{ text: runs }] : runs;
  return tag('t', { id: newId(), p: pt(x, y), ...a }, [...rs.map(run), ...kids]);
}

interface NodeSpec { x: number; y: number; el?: number; label?: string | Run[]; a?: A; kids?: string[]; lab?: A }
interface BondSpec { b: number; e: number; a?: A; kids?: string[] }
interface Built { xml: string; nodes: number[]; bonds: number[]; id: number }

/** A structure: atoms, bonds, and other children of the fragment. Labels sit as ChemDraw places them. */
function frag(nodes: NodeSpec[], bonds: BondSpec[], a: A = {}, kids: string[] = [], mid?: (ids: { nodes: number[]; bonds: number[] }) => string[]): Built {
  const id = newId();
  const nIds = nodes.map(() => newId());
  const bIds = bonds.map(() => newId());
  const ns = nodes.map((n, i) => {
    const size = Number(n.lab?.size ?? 10);
    const lab = n.label === undefined ? []
      : [tag('t', { id: newId(), p: pt(n.x - 0.3 * size, n.y + 0.39 * size), LabelJustification: 'Left', ...(n.lab ?? {}), size: undefined },
        (typeof n.label === 'string' ? [{ text: n.label, face: 96, size }] : n.label).map(run))];
    return tag('n', { id: nIds[i], p: pt(n.x, n.y), Element: n.el && n.el !== 6 ? n.el : undefined, ...(n.a ?? {}) }, [...lab, ...(n.kids ?? [])]);
  });
  const bs = bonds.map((b, i) => tag('b', { id: bIds[i], B: nIds[b.b], E: nIds[b.e], ...(b.a ?? {}) }, b.kids ?? []));
  const extra = mid ? mid({ nodes: nIds, bonds: bIds }) : [];
  return { xml: tag('fragment', { id, ...a }, [...ns, ...bs, ...kids, ...extra]), nodes: nIds, bonds: bIds, id };
}

/** Points round a ring, the first at the top. */
function ringPts(cx: number, cy: number, n: number, r: number, turn = 0): { x: number; y: number }[] {
  return Array.from({ length: n }, (_, i) => {
    const t = turn + (2 * Math.PI * i) / n - Math.PI / 2;
    return { x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) };
  });
}
const ringBonds = (n: number, a: (i: number) => A = () => ({})): BondSpec[] => Array.from({ length: n }, (_, i) => ({ b: i, e: (i + 1) % n, a: a(i) }));
/** A zigzag chain of `n` atoms. */
const zig = (x: number, y: number, n: number, len = 14.4): NodeSpec[] =>
  Array.from({ length: n }, (_, i) => ({ x: x + i * len * 0.866, y: y + (i % 2 ? -len / 2 : 0) }));
const chainBonds = (n: number, a: (i: number) => A = () => ({})): BondSpec[] => Array.from({ length: n - 1 }, (_, i) => ({ b: i, e: i + 1, a: a(i) }));

/** Two carbons joined by one bond. */
const pair = (x: number, y: number, a: A, len = 30): Built => frag([{ x, y }, { x: x + len, y }], [{ b: 0, e: 1, a }]);

const caption = (x: number, y: number, s: string, size = 7) => text(x, y, [{ text: s, size, font: FONT.arial, color: C.gray }]);
const heading = (x: number, y: number, s: string) => text(x, y, [{ text: s, size: 14, face: 1, font: FONT.arial, color: C.navy }]);

function graphic(a: A, kids: string[] = []): string { return tag('graphic', { id: newId(), ...a }, kids); }
/** An oval-like graphic's middle and axes (ChemDraw keeps these for ovals, orbitals, arcs). */
const axes = (cx: number, cy: number, rx: number, ry: number) => ({
  Center3D: pt3(cx, cy), MajorAxisEnd3D: pt3(cx + rx, cy), MinorAxisEnd3D: pt3(cx, cy + ry), BoundingBox: bbox(cx - rx, cy - ry, cx + rx, cy + ry),
});

// ---------------------------------------------------------------------------------------------
// a tiny picture, written by hand to the PNG specification (W3C, 2003) and to the BMP format
// (Microsoft, "Bitmap Storage", BITMAPINFOHEADER)

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const crc32 = (b: number[]) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const adler32 = (b: number[]) => { let a = 1, s = 0; for (const x of b) { a = (a + x) % 65521; s = (s + a) % 65521; } return ((s << 16) | a) >>> 0; };
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le32 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
const le16 = (n: number) => [n & 255, (n >>> 8) & 255];
const hex = (b: number[]) => b.map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase();

/** An 8 × 8 checkerboard PNG (stored, uncompressed deflate). */
export function checkerPng(): number[] {
  const w = 8, h = 8, raw: number[] = [];
  for (let y = 0; y < h; y++) { raw.push(0); for (let x = 0; x < w; x++) raw.push(...((x + y) % 2 ? [0, 128, 128] : [255, 200, 0])); }
  const z = [0x78, 0x01, 1, ...le16(raw.length), ...le16(~raw.length & 0xffff), ...raw, ...be32(adler32(raw))];
  const chunk = (type: string, data: number[]) => { const td = [...type].map((c) => c.charCodeAt(0)).concat(data); return [...be32(data.length), ...td, ...be32(crc32(td))]; };
  return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunk('IHDR', [...be32(w), ...be32(h), 8, 2, 0, 0, 0]), ...chunk('IDAT', z), ...chunk('IEND', [])];
}

/** A 4 × 4 24-bit BMP with a diagonal stripe. */
export function stripeBmp(): number[] {
  const w = 4, h = 4, px: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px.push(...(x === y ? [255, 0, 0] : [255, 255, 255]));
  const size = 54 + px.length;
  return [0x42, 0x4d, ...le32(size), 0, 0, 0, 0, ...le32(54), ...le32(40), ...le32(w), ...le32(h), ...le16(1), ...le16(24), ...le32(0), ...le32(px.length), ...le32(2835), ...le32(2835), ...le32(0), ...le32(0), ...px];
}

// ---------------------------------------------------------------------------------------------
// the sections

type Section = (x: number, y: number) => string[];
const W = 520;

export const sections: [string, number, Section][] = [];
const section = (title: string, h: number, fn: Section) => sections.push([title, h, fn]);

section('Bond orders (every Order value)', 150, (x, y) => SPEC_VALUES.Order.flatMap((o, i) => {
  const cx = x + (i % 6) * 85, cy = y + 30 + Math.floor(i / 6) * 40;
  return [pair(cx, cy, { Order: o }).xml, caption(cx, cy + 14, `Order=${o}`)];
}).concat([pair(x + 425, y + 110, { Order: '1 2' }).xml, caption(x + 425, y + 124, 'Order="1 2" (query)')]));

section('Bond displays (every Display, and Display2 on double bonds)', 230, (x, y) => [
  ...SPEC_VALUES.Display.flatMap((d, i) => {
    const cx = x + (i % 6) * 85, cy = y + 30 + Math.floor(i / 6) * 32;
    return [pair(cx, cy, { Display: d }).xml, caption(cx, cy + 12, d)];
  }),
  ...SPEC_VALUES.Display2.flatMap((d, i) => {
    const cx = x + (i % 6) * 85, cy = y + 140 + Math.floor(i / 6) * 32;
    return [pair(cx, cy, { Order: 2, Display: i % 2 ? 'Dash' : 'Solid', Display2: d }).xml, caption(cx, cy + 12, `2: ${d}`)];
  }),
]);

section('Double bond positions, bond properties', 230, (x, y) => {
  const out: string[] = [];
  SPEC_VALUES.DoublePosition.forEach((p, i) => { out.push(pair(x + i * 85, y + 30, { Order: 2, DoublePosition: p }).xml, caption(x + i * 85, y + 42, `DoublePosition=${p}`)); });
  SPEC_VALUES.BS.forEach((bs, i) => {
    const cx = x + 255 + i * 65, cy = y + 30;
    out.push(frag([{ x: cx, y: cy + 10 }, { x: cx + 10, y: cy }, { x: cx + 24, y: cy }, { x: cx + 34, y: cy + (bs === 'Z' ? -10 : 10) }],
      [{ b: 0, e: 1 }, { b: 1, e: 2, a: { Order: 2, BS: bs } }, { b: 2, e: 3 }]).xml, caption(cx, cy + 24, `BS=${bs}`));
  });
  SPEC_VALUES.Topology.forEach((t, i) => { out.push(pair(x + i * 85, y + 75, { Topology: t }).xml, caption(x + i * 85, y + 87, `Topology=${t}`)); });
  SPEC_VALUES.RxnParticipation.forEach((r, i) => {
    const cx = x + (i % 4) * 130, cy = y + 115 + Math.floor(i / 4) * 30;
    out.push(pair(cx, cy, { RxnParticipation: r }).xml, caption(cx, cy + 11, r));
  });
  const looks: [string, A][] = [
    ['color red', { color: C.red }], ['LineWidth 2', { LineWidth: 2 }], ['BoldWidth 4, Bold', { Display: 'Bold', BoldWidth: 4 }],
    ['BondSpacing 30 (%)', { Order: 2, BondSpacing: 30 }], ['HashSpacing 4, Hash', { Display: 'Hash', HashSpacing: 4 }],
    ['MarginWidth 4', { MarginWidth: 4 }], ['bgcolor yellow', { bgcolor: C.yellow, color: C.blue }], ['Z 999', { Z: 999 }],
  ];
  looks.forEach(([s, a], i) => { const cx = x + (i % 4) * 130, cy = y + 180 + Math.floor(i / 4) * 25; out.push(pair(cx, cy, a).xml, caption(cx + 34, cy + 2, s)); });
  return out;
});

section('Rings: Kekulé, aromatic circle, fused, spiro, bridged, macrocycle', 160, (x, y) => {
  const out: string[] = [];
  const hex1 = ringPts(x + 30, y + 50, 6, 14.4);
  out.push(frag(hex1, ringBonds(6, (i) => (i % 2 ? {} : { Order: 2 }))).xml, caption(x + 10, y + 80, 'benzene (Kekulé)'));
  const hex2 = ringPts(x + 110, y + 50, 6, 14.4);
  out.push(frag(hex2, ringBonds(6, () => ({ Order: 1.5 })), {}, [graphic({ GraphicType: 'Orbital', OrbitalType: 's', ...axes(x + 110, y + 50, 9, 9) })]).xml, caption(x + 85, y + 80, 'Order 1.5 + circle'));
  const hex3 = ringPts(x + 190, y + 50, 6, 14.4);
  out.push(frag(hex3, ringBonds(6, () => ({ Order: 1.5 }))).xml, caption(x + 170, y + 80, 'Order 1.5, no circle'));
  // naphthalene: two rings sharing a bond
  const a = ringPts(x + 270, y + 50, 6, 14.4, Math.PI / 6);
  const b = ringPts(x + 270 + 24.94, y + 50, 6, 14.4, Math.PI / 6);
  const nodes = [...a, b[0], b[1], b[2], b[3]];
  out.push(frag(nodes, [...ringBonds(6, (i) => (i % 2 ? { Order: 2 } : {})), { b: 0, e: 6 }, { b: 6, e: 7, a: { Order: 2 } }, { b: 7, e: 8 }, { b: 8, e: 9, a: { Order: 2 } }, { b: 9, e: 2 }]).xml, caption(x + 250, y + 80, 'fused'));
  // spiro[4.4]nonane
  const s1 = ringPts(x + 370, y + 50, 5, 12, Math.PI / 2), s2 = ringPts(x + 370 + 24, y + 50, 5, 12, -Math.PI / 2);
  const sp = [...s1, s2[1], s2[2], s2[3], s2[4]];
  out.push(frag(sp, [...ringBonds(5), { b: 4, e: 5 }, { b: 5, e: 6 }, { b: 6, e: 7 }, { b: 7, e: 8 }, { b: 8, e: 4 }]).xml, caption(x + 355, y + 80, 'spiro'));
  // norbornane drawn with a bridge crossing in front (Z)
  const nb = [{ x: x + 450, y: y + 40 }, { x: x + 470, y: y + 30 }, { x: x + 490, y: y + 40 }, { x: x + 490, y: y + 62 }, { x: x + 470, y: y + 72 }, { x: x + 450, y: y + 62 }, { x: x + 470, y: y + 52 }];
  out.push(frag(nb, [...ringBonds(6), { b: 0, e: 6, a: { Z: 50, Display: 'Bold' } }, { b: 6, e: 3, a: { Z: 50, Display: 'Bold' } }]).xml, caption(x + 445, y + 80, 'bridged'));
  // an 18-membered ring
  const mac = ringPts(x + 60, y + 125, 18, 30);
  out.push(frag(mac, ringBonds(18, (i) => (i % 3 === 0 ? { Order: 2 } : {}))).xml, caption(x + 100, y + 125, '18-membered ring'));
  // cyclopropane, cyclobutane, cyclooctatetraene, cubane-like square
  out.push(frag(ringPts(x + 200, y + 125, 3, 9), ringBonds(3)).xml, frag(ringPts(x + 240, y + 125, 4, 11), ringBonds(4)).xml,
    frag(ringPts(x + 300, y + 125, 8, 20), ringBonds(8, (i) => (i % 2 ? {} : { Order: 2 }))).xml);
  return out;
});

section('Every element (atomic numbers 1 to 118)', 150, (x, y) => ELEMENTS.flatMap((sym, i) => {
  const cx = x + 8 + (i % 18) * 28.5, cy = y + 25 + Math.floor(i / 18) * 18;
  return [frag([{ x: cx, y: cy, el: i + 1, label: sym, a: { NumHydrogens: 0 } }], []).xml];
}));

section('Atom properties: charge, radical, isotope, hydrogens, stereo, query', 320, (x, y) => {
  const out: string[] = [];
  const one = (cx: number, cy: number, n: NodeSpec, note: string) => {
    out.push(frag([{ x: cx - 14, y: cy }, { ...n, x: cx, y: cy }], [{ b: 0, e: 1 }]).xml, caption(cx - 14, cy + 13, note, 6));
  };
  const items: [NodeSpec, string][] = [
    [{ x: 0, y: 0, el: 7, label: 'N+', a: { Charge: 1 } }, 'Charge 1'],
    [{ x: 0, y: 0, el: 8, label: 'O−', a: { Charge: -1 } }, 'Charge −1'],
    [{ x: 0, y: 0, el: 26, label: 'Fe3+', a: { Charge: 3 } }, 'Charge 3'],
    [{ x: 0, y: 0, el: 16, label: 'S2−', a: { Charge: -2 } }, 'Charge −2'],
    ...SPEC_VALUES.Radical.map((r) => [{ x: 0, y: 0, a: { Radical: r } }, `Radical ${r}`] as [NodeSpec, string]),
    [{ x: 0, y: 0, label: [{ text: '13', face: 64, size: 10 }, { text: 'C', face: 0 }], a: { Isotope: 13 } }, 'Isotope 13'],
    [{ x: 0, y: 0, el: 1, label: 'D', a: { Isotope: 2 } }, 'Isotope 2 (D)'],
    [{ x: 0, y: 0, el: 7, label: 'NH2', a: { NumHydrogens: 2 } }, 'NumHydrogens 2'],
    [{ x: 0, y: 0, el: 15, label: 'P', a: { AbnormalValence: 'yes', NumHydrogens: 0 } }, 'AbnormalValence'],
    [{ x: 0, y: 0, a: { HDot: 'yes' } }, 'HDot'], [{ x: 0, y: 0, a: { HDash: 'yes' } }, 'HDash'],
    [{ x: 0, y: 0, a: { ImplicitHydrogens: 'no' } }, 'ImplicitHydrogens no'],
    [{ x: 0, y: 0, a: { FreeSites: 2 } }, 'FreeSites 2'],
    [{ x: 0, y: 0, a: { SubstituentsUpTo: 2 } }, 'SubstituentsUpTo 2'],
    [{ x: 0, y: 0, a: { SubstituentsExactly: 1 } }, 'SubstituentsExactly 1'],
    [{ x: 0, y: 0, a: { RxnChange: 'yes' } }, 'RxnChange'],
    [{ x: 0, y: 0, a: { AtomNumber: 7, ShowAtomNumber: 'yes' } }, 'AtomNumber 7'],
    [{ x: 0, y: 0, el: 7, label: 'N', a: { color: C.blue, LabelDisplay: 'Left' } }, 'colored label'],
    [{ x: 0, y: 0, el: 8, label: [{ text: 'OH', font: FONT.times, size: 14, face: 1, color: C.red }], lab: { size: 14 } }, 'Times 14 bold'],
    [{ x: 0, y: 0, a: { xyz: '0 0 1.5' } }, 'xyz'],
    [{ x: 0, y: 0, a: { Warning: 'test warning', IgnoreWarnings: 'yes' } }, 'warning ignored'],
    [{ x: 0, y: 0, a: { Visible: 'no' } }, 'Visible no'],
  ];
  SPEC_VALUES.LabelJustification.forEach((j) => items.push([{ x: 0, y: 0, el: 7, label: 'NHBoc', lab: { LabelJustification: j } }, `LabelJustification=${j}`]));
  items.forEach(([n, s], i) => one(x + 20 + (i % 8) * 64, y + 25 + Math.floor(i / 8) * 30, n, s));
  const groups: [string, string[]][] = [
    ['AS', SPEC_VALUES.AS], ['RingBondCount', SPEC_VALUES.RingBondCount], ['UnsaturatedBonds', SPEC_VALUES.UnsaturatedBonds],
    ['RxnStereo', SPEC_VALUES.RxnStereo], ['Translation', SPEC_VALUES.Translation], ['IsotopicAbundance', SPEC_VALUES.IsotopicAbundance],
    ['LabelDisplay', SPEC_VALUES.LabelDisplay], ['EnhancedStereoType', SPEC_VALUES.EnhancedStereoType],
  ];
  let k = 0;
  for (const [prop, vals] of groups) for (const v of vals) {
    const extra: A = prop === 'EnhancedStereoType' ? { EnhancedStereoGroupNum: v === 'Or' || v === 'And' ? 1 : undefined } : {};
    const n: NodeSpec = prop === 'LabelDisplay' ? { x: 0, y: 0, el: 7, label: 'NMe', a: { LabelDisplay: v, NumHydrogens: 0 } } : { x: 0, y: 0, a: { [prop]: v, ...extra } };
    one(x + 20 + (k % 8) * 64, y + 180 + Math.floor(k / 8) * 26, n, `${prop}=${v}`);
    k++;
  }
  return out;
});

section('Node types', 170, (x, y) => {
  const out: string[] = [];
  const cell = (i: number) => ({ cx: x + 20 + (i % 5) * 100, cy: y + 30 + Math.floor(i / 5) * 45 });
  let i = 0;
  const put = (nodes: NodeSpec[], bonds: BondSpec[], note: string, kids: string[] = []) => {
    const { cx, cy } = cell(i++);
    out.push(frag(nodes.map((n) => ({ ...n, x: n.x + cx, y: n.y + cy })), bonds, {}, kids).xml, caption(cx, cy + 16, note, 6));
  };
  put([{ x: 0, y: 0 }, { x: 14, y: 0, a: { NodeType: 'Unspecified' } }], [{ b: 0, e: 1 }], 'Unspecified');
  put([{ x: 0, y: 0 }, { x: 14, y: 0, el: 17, label: 'Cl', a: { NodeType: 'Element' } }], [{ b: 0, e: 1 }], 'Element');
  put([{ x: 0, y: 0 }, { x: 14, y: 0, label: '[N,O,S]', a: { NodeType: 'ElementList', ElementList: '7 8 16' } }], [{ b: 0, e: 1 }], 'ElementList');
  put([{ x: 0, y: 0 }, { x: 14, y: 0, label: 'Hal', a: { NodeType: 'ElementListNickname', ElementList: '9 17 35 53' } }], [{ b: 0, e: 1 }], 'ElementListNickname');
  // a nickname holds its own structure (Ph): a fragment inside the node, joined at an external connection point
  // (a nickname's own structure sits where the label is, its connection point on the atom it is bonded to)
  const c4 = cell(4), c5 = cell(5);
  const ph = ringPts(c4.cx + 28.4, c4.cy, 6, 14.4, -Math.PI / 2);
  const inner = frag([...ph, { x: c4.cx, y: c4.cy, a: { NodeType: 'ExternalConnectionPoint' } }],
    [...ringBonds(6, (j) => (j % 2 ? {} : { Order: 2 })), { b: 0, e: 6 }]);
  put([{ x: 0, y: 0 }, { x: 14, y: 0, label: 'Ph', a: { NodeType: 'Nickname' }, kids: [inner.xml] }], [{ b: 0, e: 1 }], 'Nickname (Ph)');
  const bx = c5.cx + 14, by = c5.cy;
  const boc = frag([{ x: bx, y: by }, { x: bx, y: by - 14.4, el: 8, label: 'O' }, { x: bx + 12, y: by + 7, el: 8, label: 'O' }, { x: bx + 24, y: by }, { x: bx + 36, y: by + 7 }, { x: bx + 24, y: by - 14 }, { x: bx + 34, y: by - 10 }, { x: c5.cx, y: c5.cy, a: { NodeType: 'ExternalConnectionPoint' } }],
    [{ b: 0, e: 1, a: { Order: 2 } }, { b: 0, e: 2 }, { b: 2, e: 3 }, { b: 3, e: 4 }, { b: 3, e: 5 }, { b: 3, e: 6 }, { b: 0, e: 7 }]);
  put([{ x: 0, y: 0, el: 7, label: 'N' }, { x: 14, y: 0, label: 'Boc', a: { NodeType: 'Fragment' }, kids: [boc.xml] }], [{ b: 0, e: 1 }], 'Fragment (Boc)');
  put([{ x: 0, y: 0 }, { x: 14, y: 0, label: 'CH2CH3', a: { NodeType: 'Formula' } }], [{ b: 0, e: 1 }], 'Formula');
  put([{ x: 0, y: 0 }, { x: 14, y: 0, label: 'R', a: { NodeType: 'GenericNickname', GenericNickname: 'R' } }], [{ b: 0, e: 1 }], 'GenericNickname R');
  put([{ x: 0, y: 0 }, { x: 14, y: 0, label: 'Ar', a: { NodeType: 'GenericNickname', GenericNickname: 'Ar' } }], [{ b: 0, e: 1 }], 'GenericNickname Ar');
  put([{ x: 0, y: 0 }, { x: 14, y: 0, label: 'A', a: { NodeType: 'AnonymousAlternativeGroup' } }], [{ b: 0, e: 1 }], 'AnonymousAlternativeGroup');
  // NamedAlternativeGroup: R1, whose choices are in the alternative group section (AltGroupID set there)
  put([{ x: 0, y: 0 }, { x: 14, y: 0, label: [{ text: 'R', face: 0 }, { text: '1', face: 32 }], a: { NodeType: 'NamedAlternativeGroup', AltGroupID: 'ALTGROUP' } }], [{ b: 0, e: 1 }], 'NamedAlternativeGroup R1');
  // LinkNode: a repeated CH2, 1 to 4 times
  put([{ x: 0, y: 0 }, { x: 14, y: 0, a: { NodeType: 'LinkNode', LinkCountLow: 1, LinkCountHigh: 4 } }, { x: 28, y: 0 }], [{ b: 0, e: 1 }, { b: 1, e: 2 }], 'LinkNode 1-4');
  // ExternalConnectionPoint of each type
  SPEC_VALUES.ExternalConnectionType.forEach((t) => put([{ x: 0, y: 0 }, { x: 14, y: 0, a: { NodeType: 'ExternalConnectionPoint', ExternalConnectionType: t } }], [{ b: 0, e: 1 }], `ExternalConnection ${t}`));
  return out;
});

section('Multi-center and variable attachment (ferrocene, η6 arene, positional variation)', 120, (x, y) => {
  const out: string[] = [];
  // ferrocene: two Cp rings, each joined to Fe through a MultiAttachment node with Attachments
  const top = ringPts(x + 50, y + 30, 5, 12), bot = ringPts(x + 50, y + 90, 5, 12, Math.PI / 5);
  const nodes: NodeSpec[] = [...top, ...bot, { x: x + 50, y: y + 60, el: 26, label: 'Fe' }, { x: x + 50, y: y + 32 }, { x: x + 50, y: y + 88 }];
  const fe = frag(nodes, [...ringBonds(5), ...ringBonds(5).map((b) => ({ b: b.b + 5, e: b.e + 5 })), { b: 10, e: 11 }, { b: 10, e: 12 }], {}, []);
  // set the attachment lists once the node ids are known
  out.push(fe.xml.replace(`id="${fe.nodes[11]}"`, `id="${fe.nodes[11]}" NodeType="MultiAttachment" Attachments="${fe.nodes.slice(0, 5).join(' ')}"`)
    .replace(`id="${fe.nodes[12]}"`, `id="${fe.nodes[12]}" NodeType="MultiAttachment" Attachments="${fe.nodes.slice(5, 10).join(' ')}"`), caption(x + 25, y + 112, 'MultiAttachment (η5)'));
  // a variable attachment: Br on any of four ring positions
  const ar = ringPts(x + 200, y + 55, 6, 14.4);
  const v = frag([...ar, { x: x + 222, y: y + 55 }, { x: x + 245, y: y + 55, el: 35, label: 'Br' }], [...ringBonds(6, (j) => (j % 2 ? {} : { Order: 2 })), { b: 6, e: 7 }]);
  out.push(v.xml.replace(`id="${v.nodes[6]}"`, `id="${v.nodes[6]}" NodeType="VariableAttachment" Attachments="${v.nodes.slice(1, 5).join(' ')}"`), caption(x + 180, y + 112, 'VariableAttachment'));
  // η6 arene–Cr(CO)3
  const cr = ringPts(x + 350, y + 40, 6, 14.4);
  const crf = frag([...cr, { x: x + 350, y: y + 40 }, { x: x + 350, y: y + 75, el: 24, label: 'Cr(CO)3' }], [...ringBonds(6, (j) => (j % 2 ? {} : { Order: 2 })), { b: 6, e: 7, a: { Order: 'dative' } }]);
  out.push(crf.xml.replace(`id="${crf.nodes[6]}"`, `id="${crf.nodes[6]}" NodeType="MultiAttachment" Attachments="${crf.nodes.slice(0, 6).join(' ')}"`), caption(x + 330, y + 112, 'η6, dative bond'));
  // hydrogen bond and ionic bond drawn between two partners
  out.push(frag([{ x: x + 430, y: y + 30, el: 8, label: 'O' }, { x: x + 470, y: y + 30, el: 1, label: 'H' }, { x: x + 485, y: y + 30, el: 7, label: 'N' }],
    [{ b: 0, e: 1, a: { Order: 'hydrogen' } }, { b: 1, e: 2 }]).xml,
  frag([{ x: x + 430, y: y + 70, el: 11, label: 'Na' }, { x: x + 470, y: y + 70, el: 17, label: 'Cl' }], [{ b: 0, e: 1, a: { Order: 'ionic' } }]).xml);
  return out;
});

section('Geometry and enhanced stereo at metal centers', 90, (x, y) => SPEC_VALUES.Geometry.flatMap((g, i) => {
  const cx = x + 20 + (i % 9) * 56, cy = y + 30 + Math.floor(i / 9) * 35;
  return [frag([{ x: cx, y: cy, el: 78, label: 'Pt', a: { Geometry: g } }, { x: cx + 16, y: cy, el: 17, label: 'Cl' }], [{ b: 0, e: 1 }]).xml, caption(cx - 6, cy + 13, `Geometry=${g}`, 6)];
}));

section('Text: fonts, faces, sizes, colors', 300, (x, y) => {
  const out: string[] = [];
  FONTS.forEach(([id, , name], i) => out.push(text(x, y + 25 + i * 15, [{ text: `${name}: The quick brown fox, αβγ 0123 CH3CO2H`, font: id, size: 10 }])));
  const faces: [number, string][] = [[0, 'plain'], [1, 'bold'], [2, 'italic'], [4, 'underline'], [8, 'outline'], [16, 'shadow'], [32, 'subscript'], [64, 'superscript'], [96, 'formula C6H12O6'], [3, 'bold italic'], [7, 'bold italic underline']];
  out.push(text(x, y + 150, faces.map(([face, s]) => ({ text: `${s}  `, face }))));
  [5, 6, 8, 10, 12, 14, 18, 24, 36].forEach((size, i) => out.push(text(x + i * 40 + (i > 5 ? (i - 5) * 20 : 0), y + 190, [{ text: 'Aa', size }])));
  out.push(text(x, y + 215, COLORS.map(([n], i) => ({ text: `${n} `, color: i + 2 }))));
  out.push(text(x, y + 235, [{ text: 'Mixed: ' }, { text: 'Et', face: 1 }, { text: '3', face: 33 }, { text: 'N, ' }, { text: 'n', face: 2 }, { text: '-BuLi, ' }, { text: 'tert', face: 2 }, { text: '-Bu, ' }, { text: '1', face: 64 }, { text: 'H NMR, [α]' }, { text: 'D', face: 32 }, { text: '20', face: 64 }, { text: ' = +12.3°, ' }, { text: 'J', face: 2 }, { text: ' = 7.2 Hz, ±, ≤, Å, µL, →, ⇌, ‡' }]));
  out.push(text(x, y + 255, [{ text: 'Symbol font Greek: ', size: 10 }, { text: 'abgdp', font: FONT.symbol, size: 10 }]));
  out.push(text(x, y + 275, [{ text: 'Unicode: 日本語 ✓ 🧪 ', size: 10 }, { text: 'ʹʺ ‰ ℃ ½ ¼', size: 10 }]));
  return out;
});

section('Text: justification, turned, line height, wrapping, line starts', 230, (x, y) => {
  const out: string[] = [];
  SPEC_VALUES.Justification.forEach((j, i) => {
    out.push(text(x + 60 + (i % 4) * 120, y + 30 + Math.floor(i / 4) * 38, `Justification=${j}\nsecond line`, { Justification: j, LineHeight: 'auto' }));
  });
  SPEC_VALUES.CaptionJustification.forEach((j, i) => out.push(text(x + (i % 8) * 64, y + 110, `C:${j}`, { CaptionJustification: j })));
  SPEC_VALUES.LabelAlignment.forEach((j, i) => out.push(text(x + (i % 7) * 72, y + 125, `L:${j}`, { LabelAlignment: j })));
  [15, 45, 90, 180, 270, 330].forEach((deg, i) => out.push(text(x + 30 + i * 80, y + 170, `turned ${deg}°`, { RotationAngle: Math.round(deg * 65536) })));
  out.push(text(x, y + 205, 'LineHeight 20: one\ntwo\nthree', { LineHeight: 20 }));
  out.push(text(x + 140, y + 205, 'A long caption wrapped at 90 points by WordWrapWidth so it spans several lines', { WordWrapWidth: 90 }));
  out.push(text(x + 260, y + 205, 'line one\n\nline three after a blank line', { LineStarts: '9 10 39' }));
  out.push(text(x + 400, y + 205, 'CH3CO2H as chemistry', { InterpretChemically: 'yes' }));
  return out;
});

section('Graphics: lines with every ArrowType and LineType, arcs', 210, (x, y) => {
  const out: string[] = [];
  SPEC_VALUES.ArrowType.forEach((t, i) => {
    const cx = x + (i % 5) * 104, cy = y + 30 + Math.floor(i / 5) * 32;
    out.push(graphic({ BoundingBox: bbox(cx + 70, cy, cx, cy), GraphicType: 'Line', ArrowType: t, HeadSize: 1000 }), caption(cx, cy + 12, t));
  });
  SPEC_VALUES.LineType.forEach((t, i) => { const cx = x + i * 104, cy = y + 105; out.push(graphic({ BoundingBox: bbox(cx + 70, cy, cx, cy), GraphicType: 'Line', LineType: t, ArrowType: 'FullHead' }), caption(cx, cy + 12, `LineType=${t}`)); });
  out.push(graphic({ BoundingBox: bbox(x + 480, y + 90, x + 420, y + 120), GraphicType: 'Line', LineType: 'Dashed Bold', color: C.red }), caption(x + 420, y + 125, 'Dashed Bold, red, slanted'));
  [90, 180, 270, -120].forEach((ang, i) => {
    const cx = x + 40 + i * 110, cy = y + 165;
    out.push(graphic({ GraphicType: 'Arc', ArrowType: i % 2 ? 'HalfHead' : 'FullHead', AngularSize: ang, HeadSize: 1000, ...axes(cx, cy, 25, 25) }), caption(cx - 20, cy + 32, `Arc ${ang}°`));
  });
  return out;
});

section('Graphics: rectangles, ovals, orbitals', 260, (x, y) => {
  const out: string[] = [];
  SPEC_VALUES.RectangleType.forEach((t, i) => {
    const cx = x + i * 72, cy = y + 25;
    out.push(graphic({ BoundingBox: bbox(cx, cy, cx + 55, cy + 30), GraphicType: 'Rectangle', RectangleType: t, CornerRadius: t === 'RoundEdge' ? 500 : undefined, ShadowSize: t === 'Shadow' ? 300 : undefined, bgcolor: t === 'Filled' ? C.pale : undefined }), caption(cx, cy + 40, t));
  });
  out.push(graphic({ BoundingBox: bbox(x + 0, y + 75, x + 70, y + 100), GraphicType: 'Rectangle', RectangleType: 'RoundEdge Shadow Bold', color: C.teal, LineWidth: 2 }), caption(x, y + 108, 'RoundEdge Shadow Bold'));
  SPEC_VALUES.OvalType.forEach((t, i) => {
    const cx = x + 110 + i * 70, cy = y + 90;
    out.push(graphic({ GraphicType: 'Oval', OvalType: t, ShadowSize: t === 'Shadowed' ? 300 : undefined, ...axes(cx, cy, 22, i % 2 ? 14 : 22) }), caption(cx - 20, cy + 26, t));
  });
  // a turned ellipse
  out.push(graphic({ GraphicType: 'Oval', OvalType: 'Circle', Center3D: pt3(x + 480, y + 150), MajorAxisEnd3D: pt3(x + 495, y + 135), MinorAxisEnd3D: pt3(x + 487, y + 157), BoundingBox: bbox(x + 460, y + 130, x + 500, y + 170) }), caption(x + 460, y + 175, 'turned oval'));
  SPEC_VALUES.OrbitalType.forEach((t, i) => {
    const cx = x + 20 + (i % 11) * 40, cy = y + 150 + Math.floor(i / 11) * 55;
    out.push(graphic({ GraphicType: 'Orbital', OrbitalType: t, ...axes(cx, cy, 10, 16) }), caption(cx - 15, cy + 25, t, 5));
  });
  return out;
});

section('Graphics: brackets and symbols', 140, (x, y) => {
  const out: string[] = [];
  SPEC_VALUES.BracketType.forEach((t, i) => {
    const cx = x + i * 85, cy = y + 25;
    out.push(graphic({ BoundingBox: bbox(cx, cy, cx + 50, cy + 40), GraphicType: 'Bracket', BracketType: t, LipSize: 400 }), caption(cx, cy + 48, t));
  });
  SPEC_VALUES.SymbolType.forEach((t, i) => {
    const cx = x + 10 + i * 38, cy = y + 110;
    const flag = ['Racemic', 'Absolute', 'Relative'].includes(t);
    const kids = flag ? [text(cx - 10, cy, t, {})] : [];
    out.push(graphic({ BoundingBox: bbox(cx, cy, cx + 6, cy), GraphicType: 'Symbol', SymbolType: t }, kids), caption(cx - 6, cy + 16, t, 5));
  });
  return out;
});

section('Arrow objects (ChemDraw 7 and later): heads, types, curved, equilibrium, no-go, dipole', 270, (x, y) => {
  const out: string[] = [];
  const arrow = (tx: number, ty: number, hx: number, hy: number, a: A) => tag('arrow', {
    id: newId(), BoundingBox: bbox(Math.min(tx, hx) - 4, Math.min(ty, hy) - 4, Math.max(tx, hx) + 4, Math.max(ty, hy) + 4),
    FillType: 'None', ArrowheadHead: 'Full', ArrowheadType: 'Solid', HeadSize: 1000, ArrowheadCenterSize: 875, ArrowheadWidth: 250,
    Head3D: pt3(hx, hy), Tail3D: pt3(tx, ty), Center3D: pt3((hx + tx) / 2, (hy + ty) / 2), MajorAxisEnd3D: pt3((hx + tx) / 2 + 80, (hy + ty) / 2), MinorAxisEnd3D: pt3((hx + tx) / 2, (hy + ty) / 2 + 80), ...a,
  });
  const kinds: [string, A][] = [
    ['Full', {}], ['HalfLeft', { ArrowheadHead: 'HalfLeft' }], ['HalfRight', { ArrowheadHead: 'HalfRight' }],
    ['both ends', { ArrowheadTail: 'Full' }], ['Hollow', { ArrowheadType: 'Hollow', ArrowheadCenterSize: 1000 }], ['Angle (open)', { ArrowheadType: 'Angle' }],
    ['no head', { ArrowheadHead: null }], ['equilibrium', { ArrowheadHead: 'HalfLeft', ArrowheadTail: 'HalfLeft', ArrowShaftSpacing: 300 }],
    ['retrosynthetic', { ArrowheadType: 'Angle', ArrowShaftSpacing: 600, FillType: 'None' }], ['NoGo Cross', { NoGo: 'Cross' }], ['NoGo Hash', { NoGo: 'Hash' }],
    ['Dipole', { Dipole: 'yes' }], ['Dashed', { LineType: 'Dashed' }], ['Bold', { LineType: 'Bold', BoldWidth: 3 }], ['Wavy', { LineType: 'Wavy' }],
    ['red, LineWidth 2', { color: C.red, LineWidth: 2 }], ['big head', { HeadSize: 2500, ArrowheadWidth: 700, ArrowheadCenterSize: 2000 }],
    ['FillType Shaded', { FillType: 'Shaded', ArrowheadType: 'Hollow' }], ['resonance', { ArrowheadTail: 'Full' }],
  ];
  kinds.forEach(([s, a], i) => {
    const cx = x + (i % 5) * 104, cy = y + 25 + Math.floor(i / 5) * 32;
    out.push(arrow(cx, cy, cx + 75, cy, a), caption(cx, cy + 12, s));
  });
  // turned and curved arrows
  out.push(arrow(x + 20, y + 230, x + 70, y + 180, {}), caption(x + 20, y + 240, '45° up'));
  out.push(arrow(x + 120, y + 180, x + 120, y + 240, { ArrowheadHead: 'HalfRight' }), caption(x + 125, y + 245, 'down'));
  [90, 180, -90, 270].forEach((ang, i) => {
    const cx = x + 210 + i * 80, cy = y + 210, r = 25;
    out.push(tag('arrow', { id: newId(), BoundingBox: bbox(cx - r, cy - r, cx + r, cy + r), FillType: 'None', ArrowheadHead: i === 2 ? 'HalfLeft' : 'Full', ArrowheadType: 'Solid', HeadSize: 1000, ArrowheadCenterSize: 875, ArrowheadWidth: 250,
      Head3D: pt3(cx + r * Math.cos((ang * Math.PI) / 180), cy - r * Math.sin((ang * Math.PI) / 180)), Tail3D: pt3(cx + r, cy), Center3D: pt3(cx, cy), MajorAxisEnd3D: pt3(cx + r, cy), MinorAxisEnd3D: pt3(cx, cy + r), AngularSize: ang }), caption(cx - 20, cy + 32, `curved ${ang}°`));
  });
  return out;
});

section('Curves: open, closed, filled, with heads (mechanism arrows), every CurveType', 195, (x, y) => {
  const out: string[] = [];
  // a Bézier chain P0 C C P1 C C P2…, written as ChemDraw keeps it: each point with its handle in
  // before it and its handle out after it (the ends' outer handles on the point itself, or, for a
  // closed curve, the handles that wrap round)
  const curve = (bez: [number, number][], a: A) => {
    const n = (bez.length - 1) / 3, closed = a.Closed === 'yes';
    const out: [number, number][] = [];
    for (let k = 0; k <= n; k++) {
      if (closed && k === n) break;
      const p = bez[3 * k];
      const hin = k > 0 ? bez[3 * k - 1] : closed ? bez[3 * n - 1] : p;
      const hout = k < n ? bez[3 * k + 1] : p;
      out.push(hin, p, hout);
    }
    return tag('curve', { id: newId(), CurvePoints: out.map(([px, py]) => pt(px, py)).join(' '), ...a });
  };
  const s = (cx: number, cy: number): [number, number][] => [[cx, cy], [cx + 10, cy - 30], [cx + 40, cy - 30], [cx + 50, cy]];
  const s2 = (cx: number, cy: number): [number, number][] => [[cx, cy], [cx + 15, cy - 25], [cx + 35, cy - 25], [cx + 50, cy], [cx + 65, cy + 25], [cx + 85, cy + 25], [cx + 100, cy]];
  const items: [string, [number, number][], A][] = [
    ['open', s(0, 0), {}], ['ArrowheadHead Full', s(0, 0), { ArrowheadHead: 'Full', ArrowheadType: 'Solid', HeadSize: 1000, ArrowheadCenterSize: 875, ArrowheadWidth: 250 }],
    ['half head (one electron)', s(0, 0), { ArrowheadHead: 'HalfLeft', ArrowheadType: 'Solid', HeadSize: 1000, ArrowheadCenterSize: 875, ArrowheadWidth: 250 }],
    ['both ends', s(0, 0), { ArrowheadHead: 'Full', ArrowheadTail: 'Full', ArrowheadType: 'Solid', HeadSize: 1000 }],
    ['dashed (CurveType 2)', s(0, 0), { CurveType: 2 }], ['bold (CurveType 4)', s(0, 0), { CurveType: 4 }],
    ['closed, filled', [[0, 0], [15, -25], [45, -25], [60, 0], [45, 25], [15, 25], [0, 0]], { Closed: 'yes', CurveType: 129, FillType: 'Solid', bgcolor: C.pink, color: C.purple }],
    ['closed, shaded', [[0, 0], [15, -25], [45, -25], [60, 0], [45, 25], [15, 25], [0, 0]], { Closed: 'yes', CurveType: 257, FillType: 'Shaded' }],
    ['S curve', s2(0, 0), { color: C.blue }],
  ];
  items.forEach(([n, p, a], i) => {
    const cx = x + (i % 5) * 104, cy = y + 50 + Math.floor(i / 5) * 60;
    out.push(curve(p.map(([px, py]) => [px + cx, py + cy]), a), caption(cx, cy + 12, n));
  });
  // every CurveType bit on its own
  SPEC_VALUES.CurveType.forEach((t, i) => {
    const cx = x + i * 52, cy = y + 175;
    out.push(curve(s(0, 0).map(([px, py]) => [px * 0.8 + cx, py * 0.6 + cy]), { CurveType: t, bgcolor: C.pale }), caption(cx, cy + 10, `CurveType ${t}`, 5));
  });
  return out;
});

section('Polymer and repeat brackets (bracketedgroup)', 130, (x, y) => {
  const out: string[] = [];
  const usages: [string, A][] = [
    ['SRU n', { BracketUsage: 'SRU', SRULabel: 'n', PolymerRepeatPattern: 'HeadToTail', PolymerFlipType: 'NoFlip' }],
    ['MultipleGroup ×3', { BracketUsage: 'MultipleGroup', RepeatCount: 3 }],
    ['Copolymer', { BracketUsage: 'Copolymer', PolymerRepeatPattern: 'HeadToHead', PolymerFlipType: 'Unspecified' }],
    ['CopolymerAlternating', { BracketUsage: 'CopolymerAlternating', PolymerRepeatPattern: 'EitherUnknown', PolymerFlipType: 'Flip' }],
  ];
  usages.forEach(([s, a], i) => {
    const cx = x + 10 + i * 130, cy = y + 50;
    const f1 = frag([{ x: cx, y: cy }, { x: cx + 25, y: cy }, { x: cx + 45, y: cy - 10 }, { x: cx + 70, y: cy }], [{ b: 0, e: 1 }, { b: 1, e: 2 }, { b: 2, e: 3 }]);
    const g1 = newId(), g2 = newId();
    out.push(f1.xml,
      tag('graphic', { id: g1, BoundingBox: bbox(cx + 15, cy - 25, cx + 15, cy + 15), GraphicType: 'Bracket', BracketType: 'Square', BracketUsage: a.BracketUsage }),
      tag('graphic', { id: g2, BoundingBox: bbox(cx + 55, cy + 15, cx + 55, cy - 25), GraphicType: 'Bracket', BracketType: 'Square', BracketUsage: a.BracketUsage },
        [text(cx + 58, cy + 20, String(a.SRULabel ?? a.RepeatCount ?? 'co'), {})]),
      tag('bracketedgroup', { id: newId(), BracketedObjectIDs: `${f1.nodes[1]} ${f1.nodes[2]}`, ...a }, [
        tag('bracketattachment', { id: newId(), GraphicID: g1 }, [tag('crossingbond', { id: newId(), BondID: f1.bonds[0], InnerAtomID: f1.nodes[1] })]),
        tag('bracketattachment', { id: newId(), GraphicID: g2 }, [tag('crossingbond', { id: newId(), BondID: f1.bonds[2], InnerAtomID: f1.nodes[2] })]),
      ]),
      caption(cx, cy + 35, s));
  });
  // the rest of the usages, listed on plain bracket graphics
  SPEC_VALUES.BracketUsage.filter((u) => !usages.some(([, a]) => a.BracketUsage === u)).forEach((u, i) => {
    const cx = x + (i % 7) * 74, cy = y + 100;
    out.push(graphic({ BoundingBox: bbox(cx, cy - 8, cx + 30, cy + 8), GraphicType: 'Bracket', BracketType: 'RoundPair', BracketUsage: u }), caption(cx, cy + 16, u, 5));
  });
  return out;
});

section('A two-step scheme (scheme, step, text above and below, atom map, plus)', 130, (x, y) => {
  const cy = y + 55;
  const a = frag([{ x: x + 10, y: cy }, { x: x + 22, y: cy - 7 }, { x: x + 34, y: cy, el: 8, label: 'OH' }], [{ b: 0, e: 1 }, { b: 1, e: 2 }]);
  const plus = text(x + 55, cy + 4, [{ text: '+', size: 14 }]);
  const b = frag([{ x: x + 75, y: cy, el: 35, label: 'Br' }, { x: x + 90, y: cy }], [{ b: 0, e: 1 }]);
  const arr1 = newId();
  const above = text(x + 120, cy - 8, 'NaH, THF', { Justification: 'Center' });
  const below = text(x + 120, cy + 16, [{ text: '0 °C, 2 h, ' }, { text: '85%', face: 1 }], { Justification: 'Center' });
  const c = frag([{ x: x + 165, y: cy }, { x: x + 177, y: cy - 7 }, { x: x + 189, y: cy, el: 8, label: 'O' }, { x: x + 201, y: cy - 7 }], [{ b: 0, e: 1 }, { b: 1, e: 2, a: { RxnParticipation: 'MakeOrBreak' } }, { b: 2, e: 3 }]);
  const arr2 = newId();
  const d = frag(ringPts(x + 320, cy, 6, 14.4), ringBonds(6, (i) => (i % 2 ? {} : { Order: 2 })));
  const above2 = text(x + 265, cy - 8, [{ text: 'Pd(PPh' }, { text: '3', face: 32 }, { text: ')' }, { text: '4', face: 32 }], { Justification: 'Center' });
  const arrowAt = (id: number, tx: number, hx: number) => tag('arrow', { id, BoundingBox: bbox(tx, cy - 4, hx, cy + 4), FillType: 'None', ArrowheadHead: 'Full', ArrowheadType: 'Solid', HeadSize: 1000, ArrowheadCenterSize: 875, ArrowheadWidth: 250, Head3D: pt3(hx, cy), Tail3D: pt3(tx, cy) });
  const plusId = /id="(\d+)"/.exec(plus)![1], aboveId = /id="(\d+)"/.exec(above)![1], belowId = /id="(\d+)"/.exec(below)![1], above2Id = /id="(\d+)"/.exec(above2)![1];
  return [a.xml, plus, b.xml, arrowAt(arr1, x + 100, x + 150), above, below, c.xml, arrowAt(arr2, x + 225, x + 290), above2, d.xml,
    tag('scheme', { id: newId() }, [
      tag('step', { id: newId(), ReactionStepReactants: `${a.id} ${b.id}`, ReactionStepProducts: String(c.id), ReactionStepArrows: String(arr1), ReactionStepPlusses: plusId, ReactionStepObjectsAboveArrow: aboveId, ReactionStepObjectsBelowArrow: belowId, ReactionStepAtomMap: `${a.nodes[2]} ${c.nodes[2]} ${a.nodes[1]} ${c.nodes[1]}`, ReactionStepAtomMapManual: `${a.nodes[2]} ${c.nodes[2]}` }),
      tag('step', { id: newId(), ReactionStepReactants: String(c.id), ReactionStepProducts: String(d.id), ReactionStepArrows: String(arr2), ReactionStepObjectsAboveArrow: above2Id }),
    ]),
    caption(x, y + 105, 'scheme with two steps; reactant atoms mapped to product atoms')];
});

section('Table (one page per cell, borders of each side and line type)', 140, (x, y) => {
  const cells: string[] = [];
  const cw = 110, ch = 30;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) {
    const x1 = x + c * cw, y1 = y + 25 + r * ch;
    // (a border needs a width to be drawn: ChemDraw reads a missing one as no line)
    const kids: string[] = SPEC_VALUES.Side.map((side, i) => tag('border', { id: newId(), Side: side, LineType: i === (r + c) % 4 ? (r ? 'Dashed' : 'Bold') : 'Solid', LineWidth: i === 3 && c === 3 ? 2 : c === 0 && i === 1 ? 0 : 0.6, color: r === 2 && c === 0 ? C.red : undefined }));
    // what is in a cell is placed from the cell's top left corner
    if (r === 0) kids.push(text(5, 18, [{ text: ['Compound', 'Yield', 'ee', 'Structure'][c], face: 1 }]));
    else if (c === 3) kids.push(frag([{ x: 20, y: 15 }, { x: 35, y: 8 }, { x: 50, y: 15, el: 8, label: 'OH' }], [{ b: 0, e: 1 }, { b: 1, e: 2 }]).xml);
    else kids.push(text(5, 18, [[`${r}a`, '91%', '96:4'][c], [`${r}b`, '78%', '88:12'][c]][r - 1]));
    cells.push(tag('page', { id: newId(), BoundingBox: bbox(x1, y1, x1 + cw, y1 + ch), bgcolor: r === 0 ? C.pale : undefined }, kids));
  }
  return [tag('table', { id: newId(), BoundingBox: bbox(x, y + 25, x + 4 * cw, y + 25 + 3 * ch) }, cells)];
});

section('TLC plate (lanes, spots of each shape, Rf shown)', 190, (x, y) => {
  const lanes = [0, 1, 2, 3].map((l) => tag('tlclane', { id: newId() }, [0, 1, 2].map((s) => tag('tlcspot', {
    id: newId(), Rf: f(0.15 + 0.3 * s + 0.05 * l), Width: 8 + s * 2, Height: 4 + s, CurveType: [0, 1, 2, 4][(l + s) % 4], Tail: s === 2 ? 12 : 0, ShowRf: l === 0 ? 'yes' : 'no',
  }))));
  return [tag('tlcplate', { id: newId(), BoundingBox: bbox(x + 20, y + 20, x + 200, y + 180), TopLeft: pt(x + 20, y + 20), TopRight: pt(x + 200, y + 20), BottomRight: pt(x + 200, y + 180), BottomLeft: pt(x + 20, y + 180), OriginFraction: 0.1, SolventFrontFraction: 0.1, ShowOrigin: 'yes', ShowSolventFront: 'yes', ShowBorders: 'yes' }, lanes),
    tag('tlcplate', { id: newId(), BoundingBox: bbox(x + 260, y + 30, x + 380, y + 170), TopLeft: pt(x + 270, y + 30), TopRight: pt(x + 380, y + 40), BottomRight: pt(x + 370, y + 170), BottomLeft: pt(x + 260, y + 160), OriginFraction: 0.15, SolventFrontFraction: 0.05, ShowOrigin: 'no', ShowSolventFront: 'no', ShowBorders: 'no' },
      [tag('tlclane', { id: newId() }, [tag('tlcspot', { id: newId(), Rf: 0.5, Width: 10, Height: 6, ShowRf: 'yes' })])]),
    caption(x + 260, y + 185, 'a turned plate, origin and front hidden')];
});

section('Spectra (every Class, XType and YType)', 180, (x, y) => {
  const out: string[] = [];
  SPEC_VALUES.Class.forEach((cls, i) => {
    const cx = x + (i % 5) * 104, cy = y + 25 + Math.floor(i / 5) * 75;
    const data = Array.from({ length: 64 }, (_, k) => f(Math.exp(-(((k - 20 - i) / 3) ** 2)) + 0.5 * Math.exp(-(((k - 44) / 2) ** 2))));
    out.push(tag('spectrum', { id: newId(), BoundingBox: bbox(cx, cy, cx + 95, cy + 55), Class: cls, XType: SPEC_VALUES.XType[i % 7], YType: SPEC_VALUES.YType[i % 6], XLow: 0, XSpacing: 0.5, YLow: 0, YScale: 1, XAxisLabel: 'x', YAxisLabel: 'y' }, data.join(' ')),
      caption(cx, cy + 65, cls));
  });
  return out;
});

section('Pictures (embedded PNG and BMP; turned; Z order)', 110, (x, y) => [
  tag('embeddedobject', { id: newId(), BoundingBox: bbox(x + 10, y + 25, x + 74, y + 89), PNG: hex(checkerPng()) }), caption(x + 10, y + 100, 'PNG 8×8'),
  tag('embeddedobject', { id: newId(), BoundingBox: bbox(x + 110, y + 25, x + 174, y + 89), RotationAngle: 30 * 65536, PNG: hex(checkerPng()) }), caption(x + 110, y + 100, 'PNG turned 30°'),
  tag('embeddedobject', { id: newId(), BoundingBox: bbox(x + 210, y + 25, x + 274, y + 89), BMP: hex(stripeBmp()) }), caption(x + 210, y + 100, 'BMP 4×4'),
  tag('embeddedobject', { id: newId(), Z: 1, BoundingBox: bbox(x + 310, y + 25, x + 374, y + 89), PNG: hex(checkerPng()) }),
  graphic({ Z: 2, BoundingBox: bbox(x + 340, y + 50, x + 420, y + 80), GraphicType: 'Rectangle', RectangleType: 'Filled', bgcolor: C.cyan }),
  caption(x + 310, y + 100, 'picture behind a filled box'),
]);

section('Groups, alternative group, tags, property, constraint, geometry, sequence', 230, (x, y) => {
  const out: string[] = [];
  // a group within a group, and an integral group
  const g1 = frag(zig(x + 10, y + 40, 4), chainBonds(4));
  const g2 = frag(zig(x + 10, y + 70, 4), chainBonds(4));
  out.push(tag('group', { id: newId() }, [tag('group', { id: newId() }, [g1.xml, text(x + 60, y + 44, 'in a group in a group')]), g2.xml]));
  out.push(tag('group', { id: newId(), Integral: 'yes' }, [frag(zig(x + 10, y + 100, 3), chainBonds(3)).xml, text(x + 45, y + 104, 'Integral group')]));
  // the named alternative group R1 = Me, Et, Ph, each joined at an external connection point
  const choice = (cx: number, n: number) => frag([...zig(cx, y + 160, n), { x: cx - 12, y: y + 167, a: { NodeType: 'ExternalConnectionPoint' } }], [...chainBonds(n), { b: 0, e: n }]);
  const alt = newId();
  out.push(tag('altgroup', { id: alt, BoundingBox: bbox(x + 150, y + 130, x + 330, y + 180), TextFrame: bbox(x + 152, y + 132, x + 180, y + 148), GroupFrame: bbox(x + 150, y + 130, x + 330, y + 180), Valence: 1 },
    [text(x + 155, y + 145, [{ text: 'R' }, { text: '1', face: 32 }, { text: ' =' }]), choice(x + 200, 1).xml, choice(x + 240, 2).xml, choice(x + 290, 3).xml]));
  // tags of every type and positioning, on a fragment, with a registration number
  const tagged = frag(zig(x + 10, y + 145, 3), chainBonds(3), {}, [
    ...SPEC_VALUES.TagType.map((t, i) => tag('objecttag', { id: newId(), Name: `sampler-${t}`, TagType: t, Value: t === 'Double' ? '3.25' : t === 'Long' ? '42' : t === 'String' ? 'hello' : '', Tracking: 'yes', Persistent: 'yes',
      PositioningType: SPEC_VALUES.PositioningType[i], PositioningAngle: i === 1 ? 45 * 65536 : undefined, PositioningOffset: i === 2 ? '10 -10' : i === 3 ? pt(x + 60, y + 180) : undefined }, [text(x + 10 + i * 30, y + 195, t)])),
    tag('regnum', { id: newId(), RegistryNumber: 'SAMPLER-0001', RegistryAuthority: 'Chemweave test' }),
  ]);
  out.push(tagged.xml);
  // a chemical name property shown by a caption
  const named = frag(zig(x + 380, y + 40, 3), chainBonds(3));
  const nameText = text(x + 380, y + 62, 'propane');
  out.push(named.xml, nameText, tag('chemicalproperty', { id: newId(), Name: 'Name', BasisObjects: String(named.id), ChemicalPropertyType: 'ChemicalName', ChemicalPropertyDisplayID: /id="(\d+)"/.exec(nameText)![1], ChemicalPropertyIsActive: 'yes', PositioningType: 'offset', PositioningOffset: '0 22' }));
  out.push(tag('chemicalproperty', { id: newId(), Name: 'Unspecified property', BasisObjects: String(named.id), ChemicalPropertyType: 'Unspecified', ChemicalPropertyIsActive: 'no' }));
  // 3D query features: a geometry of each kind on a ring, and constraints of each type
  const ring = frag(ringPts(x + 420, y + 120, 6, 14.4), ringBonds(6));
  out.push(ring.xml);
  // each feature built on the objects its kind needs (atoms, or the points, lines and planes above
  // it): ChemDraw 25 closes when a feature's basis is the wrong kind of object
  const r = ring.nodes;
  const geo = (g: string, basis: (number | string)[], a: A = {}) => { const id = newId(); out.push(tag('geometry', { id, GeometricFeature: g, BasisObjects: basis.join(' '), ...a })); return id; };
  const centroid = geo('CentroidFromPoints', r);
  geo('PointFromPointPointDistance', [r[0], r[1]], { RelationValue: 1.5, PointIsDirected: 'yes' });
  geo('PointFromPointPointPercentage', [r[2], r[3]], { RelationValue: 50 });
  const line = geo('LineFromPoints', [r[0], r[3]]);
  const plane = geo('PlaneFromPoints', [r[0], r[2], r[4]]);
  geo('PlaneFromPointLine', [r[1], line]);
  const normal = geo('NormalFromPointPlane', [centroid, plane]);
  geo('PointFromPointNormalDistance', [centroid, normal], { RelationValue: 2 });
  out.push(tag('constraint', { id: newId(), Name: 'Distance', BasisObjects: `${r[0]} ${r[3]}`, ConstraintType: 'Distance', ConstraintMin: 2.5, ConstraintMax: 3.0 }));
  out.push(tag('constraint', { id: newId(), Name: 'Angle', BasisObjects: `${r[0]} ${r[1]} ${r[2]}`, ConstraintType: 'Angle', ConstraintMin: 110, ConstraintMax: 130, DihedralIsChiral: 'no' }));
  out.push(tag('constraint', { id: newId(), Name: 'ExclusionSphere', BasisObjects: String(centroid), ConstraintType: 'ExclusionSphere', ConstraintMin: 0, ConstraintMax: 1.5, IgnoreUnconnectedAtoms: 'yes' }));
  out.push(tag('sequence', { id: newId(), SequenceIdentifier: 'SEQ-1' }));
  out.push(tag('crossreference', { id: newId(), CrossReferenceContainer: 'sampler', CrossReferenceDocument: 'other.cdxml', CrossReferenceIdentifier: 'ref-1', CrossReferenceSequence: 'SEQ-1' }));
  out.push(caption(x + 380, y + 150, 'geometry, constraints, sequence, cross reference'));
  return out;
});

section('Charges, radicals and lone pairs as symbols (represent)', 70, (x, y) => {
  const out: string[] = [];
  const n = frag([{ x: x + 20, y: y + 40 }, { x: x + 34, y: y + 40, el: 8, label: 'O' }], [{ b: 0, e: 1 }]);
  out.push(n.xml.replace('</fragment>', [
    graphic({ BoundingBox: bbox(x + 40, y + 32, x + 46, y + 32), GraphicType: 'Symbol', SymbolType: 'CircleMinus' }, [tag('represent', { attribute: 'Charge', object: n.nodes[1] })]),
    graphic({ BoundingBox: bbox(x + 30, y + 30, x + 38, y + 30), GraphicType: 'Symbol', SymbolType: 'LonePair' }),
  ].join('') + '</fragment>').replace(`id="${n.nodes[1]}"`, `id="${n.nodes[1]}" Charge="-1"`));
  const r = frag([{ x: x + 100, y: y + 40 }, { x: x + 114, y: y + 40, a: { Radical: 'Doublet' } }], [{ b: 0, e: 1 }]);
  out.push(r.xml.replace('</fragment>', graphic({ BoundingBox: bbox(x + 118, y + 34, x + 120, y + 34), GraphicType: 'Symbol', SymbolType: 'Electron' }, [tag('represent', { attribute: 'Radical', object: r.nodes[1] })]) + '</fragment>'));
  // a chiral flag inside its structure, and fragment-wide stereo flags
  const s = frag([{ x: x + 200, y: y + 40 }, { x: x + 214, y: y + 32, a: { AS: 'R' } }, { x: x + 228, y: y + 40 }, { x: x + 214, y: y + 18, el: 8, label: 'OH' }],
    [{ b: 0, e: 1 }, { b: 1, e: 2 }, { b: 1, e: 3, a: { Display: 'WedgeBegin' } }], { Absolute: 'yes' },
    [graphic({ BoundingBox: bbox(x + 240, y + 55, x + 250, y + 55), GraphicType: 'Symbol', SymbolType: 'Absolute' }, [text(x + 235, y + 55, 'Chiral')])]);
  out.push(s.xml, frag(zig(x + 300, y + 40, 3), chainBonds(3), { Racemic: 'yes' }).xml, frag(zig(x + 360, y + 40, 3), chainBonds(3), { Relative: 'yes' }).xml);
  out.push(frag(zig(x + 420, y + 40, 3), chainBonds(3), { Formula: 'C3H8', Weight: 44.1, ConnectionOrder: '1 2 3' }).xml);
  return out;
});

section('Highlight behind a structure (ColoredMolecularArea), annotation', 80, (x, y) => {
  const hex6 = ringPts(x + 40, y + 45, 6, 14.4);
  const ids = { b: [] as number[] };
  const f1 = frag(hex6, ringBonds(6, (i) => (i % 2 ? {} : { Order: 2 })), {}, [], ({ bonds }) => { ids.b = bonds; return [tag('ColoredMolecularArea', { id: newId(), bgcolor: C.yellow, BasisObjects: bonds.slice(0, 3).join(' ') })]; });
  return [f1.xml, tag('annotation', { id: newId(), Keyword: 'sampler', Content: 'a note about the document' }), caption(x + 80, y + 45, 'three bonds highlighted; an annotation (nothing drawn)')];
});

section('Arrangements: turned, tiny, huge, overlapping, crowded', 330, (x, y) => {
  const out: string[] = [];
  // the same structure turned in 30° steps
  for (let k = 0; k < 6; k++) {
    const t = (k * Math.PI) / 6, cx = x + 30 + k * 60, cy = y + 40;
    const p = [0, 1, 2, 3].map((i) => ({ x: cx + Math.cos(t) * (i * 12 - 18) - Math.sin(t) * (i % 2 ? -6 : 0), y: cy + Math.sin(t) * (i * 12 - 18) + Math.cos(t) * (i % 2 ? -6 : 0) }));
    out.push(frag([...p, { x: p[3].x + Math.cos(t) * 12, y: p[3].y + Math.sin(t) * 12, el: 8, label: 'OH' }], [...chainBonds(4), { b: 3, e: 4 }]).xml);
  }
  // tiny and huge
  out.push(frag(ringPts(x + 400, y + 40, 6, 3), ringBonds(6, (i) => (i % 2 ? {} : { Order: 2 })), {}, []).xml, caption(x + 390, y + 52, 'bond 3 pt'));
  out.push(frag(ringPts(x + 100, y + 180, 6, 70), ringBonds(6, (i) => (i % 2 ? {} : { Order: 2, BondSpacing: 12 }))).xml);
  out.push(text(x + 70, y + 185, [{ text: 'huge', size: 36, font: FONT.times, face: 1 }]));
  // overlapping: a filled oval over a structure over a filled box, set by Z
  out.push(graphic({ Z: 10, BoundingBox: bbox(x + 250, y + 120, x + 330, y + 180), GraphicType: 'Rectangle', RectangleType: 'Filled', bgcolor: C.pale }));
  out.push(frag(ringPts(x + 290, y + 150, 6, 14.4).map((p) => ({ ...p, a: { Z: 20 } })), ringBonds(6, () => ({ Z: 20 }))).xml);
  out.push(graphic({ Z: 30, GraphicType: 'Oval', OvalType: 'Filled', bgcolor: C.orange, ...axes(x + 310, y + 165, 12, 12) }));
  out.push(text(x + 255, y + 195, 'box < structure < oval by Z'));
  // a crowded cluster of labels and bonds
  const hub = { x: x + 420, y: y + 160 };
  const spokes = Array.from({ length: 8 }, (_, i) => ({ x: hub.x + 22 * Math.cos((i * Math.PI) / 4), y: hub.y + 22 * Math.sin((i * Math.PI) / 4), el: [7, 8, 9, 15, 16, 17, 35, 53][i], label: ['NH2', 'OMe', 'F', 'PPh2', 'SMe', 'Cl', 'Br', 'I'][i] }));
  out.push(frag([{ ...hub, el: 14, label: 'Si' }, ...spokes], spokes.map((_, i) => ({ b: 0, e: i + 1, a: { Display: i % 2 ? 'WedgeBegin' : 'WedgedHashBegin' } }))).xml);
  out.push(caption(x + 390, y + 195, 'crowded labels'));
  // long chain with many stereo bonds
  const chain = zig(x + 10, y + 290, 30, 12);
  out.push(frag(chain, chainBonds(30, (i) => ({ Display: SPEC_VALUES.Display[i % SPEC_VALUES.Display.length] }))).xml);
  return out;
});

// ---------------------------------------------------------------------------------------------

/** Lays the sections out in columns of a poster page, and returns the whole file. */
export function samplerCdxml(only?: (title: string, i: number) => boolean): string {
  next = 100;
  const colW = W + 40, maxH = 1500, top = 60;
  let cx = 30, cy = top, pageW = 0, pageH = 0;
  const body: string[] = [];
  for (const [i, [title, h, fn]] of sections.entries()) {
    if (only && !only(title, i)) continue;
    if (cy + h > maxH && cy > top) { cx += colW; cy = top; }
    body.push(heading(cx, cy, title));
    body.push(...fn(cx, cy));
    cy += h + 30;
    pageW = Math.max(pageW, cx + colW);
    pageH = Math.max(pageH, cy);
  }
  // objects at the page's very edges
  body.push(text(2, 10, [{ text: 'top-left corner', size: 6 }]), text(pageW - 60, pageH - 4, [{ text: 'bottom-right corner', size: 6 }]));
  body.push(text(30, 35, [{ text: 'Chemweave CDXML sampler: every object and listed value of the CDX/CDXML format', size: 20, face: 1, font: FONT.calibri, color: C.teal }]));
  const widthPages = Math.ceil(pageW / 540), heightPages = Math.ceil(pageH / 720);
  const page = tag('page', {
    id: newId(), BoundingBox: bbox(0, 0, widthPages * 540, heightPages * 720), HeaderPosition: 36, FooterPosition: 36, PrintTrimMarks: 'yes',
    WidthPages: widthPages, HeightPages: heightPages, Width: widthPages * 540, Height: heightPages * 720, DrawingSpace: 'poster', Header: 'Sampler header', Footer: 'Sampler footer', PageDefinition: 'UserDefined', bgcolor: C.white,
  }, [
    ...body,
    // page splitters, one for each page layout
    ...SPEC_VALUES.PageDefinition.map((d, i) => tag('splitter', { id: newId(), p: pt(0, 720 * (i + 1)), PageDefinition: d })),
    tag('objecttag', { id: newId(), Name: 'sampler page tag', TagType: 'String', Value: 'page', Visible: 'no' }),
  ]);
  // fill in the R1 node's alternative group id
  const altId = /<altgroup id="(\d+)"/.exec(page)?.[1];
  const pageXml = page.replace(/ AltGroupID="ALTGROUP"/g, altId ? ` AltGroupID="${altId}"` : '');
  return '<?xml version="1.0" encoding="UTF-8" ?>\n<!DOCTYPE CDXML SYSTEM "http://www.cambridgesoft.com/xml/cdxml.dtd" >\n' + tag('CDXML', {
    CreationProgram: 'Chemweave CDXML sampler', Name: 'cdxml-sampler.cdxml', BoundingBox: bbox(0, 0, widthPages * 540, heightPages * 720),
    WindowPosition: '0 0', WindowSize: '0 0', FractionalWidths: 'yes', InterpretChemically: 'yes', ShowAtomQuery: 'yes', ShowAtomStereo: 'yes', ShowAtomEnhancedStereo: 'yes',
    ShowAtomNumber: 'no', ShowBondQuery: 'yes', ShowBondRxn: 'yes', ShowBondStereo: 'yes', ShowTerminalCarbonLabels: 'no', ShowNonTerminalCarbonLabels: 'no', HideImplicitHydrogens: 'no',
    LabelFont: FONT.arial, LabelSize: 10, LabelFace: 96, CaptionFont: FONT.arial, CaptionSize: 10, HashSpacing: 2.5, MarginWidth: 1.6, LineWidth: 0.6, BoldWidth: 2, BondLength: 14.4, BondSpacing: 18, ChainAngle: 120,
    LabelJustification: 'Auto', CaptionJustification: 'Left', AminoAcidTermini: 'HOH', ShowSequenceTermini: 'yes', ShowSequenceBonds: 'yes', ShowSequenceUnlinkedBranches: 'no', ResidueWrapCount: 40, ResidueBlockCount: 10,
    ResidueZigZag: 'yes', NumberResidueBlocks: 'no', PrintMargins: '36 36 36 36', MacPrintInfo: null, color: 0, bgcolor: 1,
  }, [
    tag('colortable', {}, COLORS.map(([, r, g, b]) => tag('color', { r, g, b }))),
    tag('fonttable', {}, FONTS.map(([id, charset, name]) => tag('font', { id, charset, name }))),
    pageXml,
    tag('templategrid', { extent: '540 720', PaneHeight: 200, NumRows: 3, NumColumns: 4 }),
  ]) + '\n';
}
