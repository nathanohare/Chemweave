// @vitest-environment jsdom
//
// Code review 2026-11-26, batch 28 (Design mode diagrams, energy diagrams, Newman projections,
// MO diagrams and crystal drawings): F059, F060, F061, F062, F063, F064, F428, F430, F431, F432,
// F433, F434, F435, F437, F438, F439, F441.
//
// No chemistry value here comes from the code under test. The element numbers are the periodic
// table's (IUPAC): carbon 6, actinium 89. Acetyl is CH3C(=O)– and propyl CH3CH2CH2– (IUPAC
// Recommendations 2013, P-65.1.7.2.1 and P-29.6), groups on a carbon. The LiH-type MO diagram joins
// lithium's 2s (its only valence orbital with an electron) to the partner orbital and leaves its
// empty 2p as it is (Miessler, Fischer and Tarr, Inorganic Chemistry, 5th ed., section 5.4.1, LiH).

import { describe, expect, it } from 'vitest';
import { Doc, type Contents, type Shape } from '../src/model';
import { POINTS } from '../src/editor/arrange';
import { plainMeasure } from '../src/chem/reaction';
import { plainText } from '../src/richtext';
import {
  diagramParts, newDiagram, putDiagram, refitDiagramStructures, refitDiagrams, textFromShapes, parseOutline, movedLines,
} from '../src/design/diagrams';
import { fromRows, rowsOf } from '../src/design/diagram-rows';
import { ENERGY_DEFAULTS, putEnergy, type EnergyData, type EnergyPoint } from '../src/design/energy';
import { NEWMAN_LOOK, drawNewman, type NewmanData } from '../src/design/newman';
import type { NewmanGroup } from '../src/chem/newman';
import { newPlate, parseMarks, putPlate, spotRows, spotColorHex } from '../src/design/plates';
import { fromAtoms, sources } from '../src/design/mo';
import { ACS_1996 } from '../src/style';
import { crystalShapes, defaultView, shapesBounds, type CrystalSpec, type XShape } from '../src/design/xray';

const words = (s: Pick<Shape, 'text'>) => s.text?.runs.map((r) => r.text).join('') ?? '';

describe('F059: a line starting with [word] keeps its words outside the icon list', () => {
  it('keeps [Pd] and [M]-H as typed in a block list, and still reads icons in the icon list', () => {
    const shown = diagramParts(newDiagram('blocks', '[Pd] oxidative addition\n[M]-H complex')).shapes.map(words);
    expect(shown).toContain('[Pd] oxidative addition');
    expect(shown).toContain('[M]-H complex');
    expect(parseOutline('[flask] Synthesis')[0]).toMatchObject({ text: 'Synthesis', icon: 'icon:flask' });
    expect(parseOutline('[Pd] oxidative addition', false)[0]).toEqual(expect.objectContaining({ text: '[Pd] oxidative addition' }));
    expect(parseOutline('[Pd] oxidative addition', false)[0].icon).toBeUndefined();
  });

  it('keeps the bracket when the words are changed in the shape', () => {
    const doc = new Doc();
    const frame = doc.edit('d', () => putDiagram(doc, POINTS, newDiagram('process', '[Pd] oxidative addition\nB'), { x: 0, y: 0 }));
    const item = [...doc.shapes.values()].find((s) => s.name === 'Item 2')!;
    doc.edit('type', () => doc.updateShape(item.id, { text: { runs: [{ text: 'Transmetalation' }] } }));
    expect(textFromShapes(doc, doc.shapes.get(frame)!)).toBe('[Pd] oxidative addition\nTransmetalation');
    const first = [...doc.shapes.values()].find((s) => s.name === 'Item 1')!;
    doc.edit('type', () => doc.updateShape(first.id, { text: { runs: [{ text: '[Pd] reductive elimination' }] } }));
    expect(textFromShapes(doc, doc.shapes.get(frame)!).split('\n')[0]).toBe('[Pd] reductive elimination');
  });

  it('keeps the looks of a line starting with a bracket through the Diagram window', () => {
    const rich = { 1: [{ text: '[Pd] ' }, { text: 'cat', bold: true }] };
    const rows = rowsOf({ layout: 'blocks', text: '[Pd] cat', rich });
    expect(rows[0].rich).toBeDefined();
    expect(fromRows(rows, 'blocks').rich).toEqual(rich);
  });
});

describe('F060: a held structure stays with its item when a line is added or removed above it', () => {
  it('follows item C to line 4 when a line is put in above it', () => {
    const doc = new Doc();
    const frame = doc.edit('d', () => putDiagram(doc, POINTS, newDiagram('process', 'A\nB\nC'), { x: 50, y: 40 }));
    doc.beforeCommit = (b) => { refitDiagrams(doc, b, POINTS); refitDiagramStructures(doc, b, POINTS); };
    const c = [...doc.shapes.values()].find((s) => s.name === 'Item 3')!;
    const mid = { x: (c.x1 + c.x2) / 2, y: (c.y1 + c.y2) / 2 };
    let first = 0;
    doc.edit('Draw', () => {
      first = doc.addAtom(mid.x - 10, mid.y, 6).id;
      doc.addBond(first, doc.addAtom(mid.x + 10, mid.y, 6).id, 1);
    });
    expect(Object.keys(doc.shapes.get(frame)!.diagram!.figs ?? {})).toEqual(['3']);
    const f = doc.shapes.get(frame)!;
    doc.edit('Diagram', () => putDiagram(doc, POINTS, { ...f.diagram!, text: 'A\nX\nB\nC' }, { x: Math.min(f.x1, f.x2), y: Math.min(f.y1, f.y2) }, frame));
    const now = doc.shapes.get(frame)!;
    expect(Object.keys(now.diagram!.figs ?? {})).toEqual(['4']);
    const holder = [...doc.shapes.values()].find((s) => s.name === 'Item 4')!;
    expect(words(holder)).toBe('C');
    const atoms = [...doc.fragmentOf(first)].map((id) => doc.atoms.get(id)!);
    const cx = (Math.min(...atoms.map((a) => a.x)) + Math.max(...atoms.map((a) => a.x))) / 2;
    expect(cx).toBeGreaterThan(Math.min(holder.x1, holder.x2));
    expect(cx).toBeLessThan(Math.max(holder.x1, holder.x2));
  });

  it('maps lines kept, lines with new words between kept ones, and lines taken out', () => {
    expect([...movedLines('A\nB\nC', 'A\nX\nB\nC')]).toEqual([[1, 1], [2, 3], [3, 4]]);
    expect([...movedLines('A\nB\nC', 'B\nC')]).toEqual([[2, 1], [3, 2]]);
    expect([...movedLines('A\nB\nC', 'A\nBee\nC')]).toEqual([[1, 1], [2, 2], [3, 3]]);
  });
});

describe('F428: an icon list drawn again before the icons load keeps its icons', () => {
  it('keeps an item\'s icon (matched from its words in an earlier session) instead of the plain circle', () => {
    const doc = new Doc();
    const frame = doc.edit('d', () => putDiagram(doc, POINTS, newDiagram('icon-list', 'Synthesis\nAnalysis'), { x: 0, y: 0 }));
    const icons = () => doc.shapes.get(frame)!.frame!.shapes.map((id) => doc.shapes.get(id)!).filter((s) => s.geo?.startsWith('icon:'));
    // as saved by a session that had the icon data: the icons matched to the words
    doc.edit('as saved', () => { const [a, b] = icons(); doc.updateShape(a.id, { geo: 'icon:flask' }); doc.updateShape(b.id, { geo: 'icon:microscope' }); });
    const f = doc.shapes.get(frame)!;
    doc.edit('Word', () => putDiagram(doc, POINTS, { ...f.diagram!, text: 'Synthesis\nAnalyses' }, { x: f.x1, y: f.y1 }, frame));
    expect(icons().map((s) => s.geo)).toEqual(['icon:flask', 'icon:microscope']);
  });
});

/** Energy diagram data with these pathways (made-up energies, kcal/mol). */
const energy = (paths: EnergyData['paths'], more: Partial<EnergyData> = {}): EnergyData => ({ ...ENERGY_DEFAULTS, quantity: 'ΔG', unit: 'kcal/mol', w: 240, h: 160, paths, ...more });
const pts = (list: [string, number | null][]): EnergyPoint[] => list.map(([label, g]) => ({ label, g }));
/** A structure of two separate molecules: bromomethane (C–Br) and a hydroxide ion (O, charge −1). */
const twoPieces = (dx = 0): Contents => {
  const t = new Doc();
  t.edit('d', () => {
    const c = t.addAtom(dx, 0, 6), br = t.addAtom(dx + 26, 0, 35);
    t.addBond(c.id, br.id, 1);
    t.addAtom(dx + 70, 0, 8, { charge: -1 });
  });
  return t.contents();
};
const captions = (doc: Doc) => [...doc.captions.values()].map((c) => ({ c, t: plainText(c.runs) }));

describe('F062: a species\' structure of two molecules is not added again on each redraw', () => {
  it('keeps one copy of each molecule through redraws', () => {
    const doc = new Doc();
    const m = plainMeasure(doc);
    const d = energy([{ name: '', color: '#000000', points: [{ label: 'SM', g: 0, drawn: twoPieces() }, { label: 'TS', g: 20 }, { label: 'P', g: -5 }] }]);
    const frame = doc.edit('e', () => putEnergy(doc, m, d, { x: 100, y: 100 }));
    expect(doc.atoms.size).toBe(3);
    for (let i = 0; i < 3; i++) doc.edit('re', () => putEnergy(doc, m, doc.shapes.get(frame)!.energy!, { x: 100, y: 100 }, frame));
    expect(doc.atoms.size).toBe(3);
  });
});

describe('F061: two pathways\' species in one column each get their structure', () => {
  it('draws both structures when the energies differ', () => {
    const doc = new Doc();
    const m = plainMeasure(doc);
    const one = (dx: number): Contents => { const t = new Doc(); t.edit('d', () => { t.addAtom(dx, 0, 8); }); return t.contents(); };
    const d = energy([
      { name: 'uncatalyzed', color: '#c00000', points: [{ label: 'SM', g: 0 }, { label: 'TS', g: 30, drawn: one(0) }, { label: 'P', g: -10 }] },
      { name: 'catalyzed', color: '#000000', points: [{ label: 'SM', g: 0 }, { label: 'TS1', g: 15, drawn: one(0) }, { label: 'P', g: -10 }] },
    ]);
    doc.edit('e', () => putEnergy(doc, m, d, { x: 100, y: 100 }));
    expect(doc.atoms.size).toBe(2);
  });
});

describe('F430: two species at the same position keep their levels', () => {
  it('draws every level with a length', () => {
    const doc = new Doc();
    const m = plainMeasure(doc);
    doc.edit('e', () => putEnergy(doc, m, energy([{ name: '', color: '#000000', points: pts([['A', 0], ['B', 10], ['C', 5]]) }], { xs: [0, 0, 2] }), { x: 100, y: 100 }));
    const levels = [...doc.shapes.values()].filter((s) => s.kind === 'line' && s.bold);
    expect(levels.length).toBe(3);
    for (const l of levels) expect(Math.abs(l.x2 - l.x1)).toBeGreaterThan(1);
  });
});

describe('F431 and F432: names in a column pathways share', () => {
  it('writes a later pathway\'s own name for a species at the same energy (F431)', () => {
    const doc = new Doc();
    const m = plainMeasure(doc);
    doc.edit('e', () => putEnergy(doc, m, energy([
      { name: 'a', color: '#000000', points: pts([['SM', 0], ['TS', 20], ['P', -5]]) },
      { name: 'b', color: '#c00000', points: pts([['SM + cat', 0], ['TS2', 12], ['P', -5]]) },
    ]), { x: 100, y: 100 }));
    const t = captions(doc).map((x) => x.t);
    expect(t).toContain('SM');
    expect(t).toContain('SM + cat');
    // the shared product is still written once
    expect(t.filter((x) => x === 'P').length).toBe(1);
    const sm = captions(doc).find((x) => x.t === 'SM')!.c, cat = captions(doc).find((x) => x.t === 'SM + cat')!.c;
    const a = m.captionBox(sm), b = m.captionBox(cat);
    // one under the other, not on top of it
    expect(b.y1).toBeGreaterThanOrEqual(a.y2 - 0.5);
  });

  it('puts a name both pathways give a column under the lower level (F432)', () => {
    const doc = new Doc();
    const m = plainMeasure(doc);
    doc.edit('e', () => putEnergy(doc, m, energy([
      { name: 'a', color: '#000000', points: pts([['SM', 0], ['TS', 30], ['P', -5]]) },
      { name: 'b', color: '#c00000', points: pts([['SM', 0], ['TS', 20], ['P', -5]]) },
    ], { values: false }), { x: 100, y: 100 }));
    const ts = captions(doc).filter((x) => x.t === 'TS');
    expect(ts.length).toBe(1);
    const levels = [...doc.shapes.values()].filter((s) => s.kind === 'line' && s.bold);
    const mid = (l: Shape) => (l.x1 + l.x2) / 2;
    const box = m.captionBox(ts[0].c);
    const cx = (box.x1 + box.x2) / 2;
    const column = levels.filter((l) => Math.abs(mid(l) - cx) < 1).sort((p, q) => p.y1 - q.y1);
    expect(column.length).toBe(2);
    // under the lower level (the larger y on the page), not between the two
    expect(box.y1).toBeGreaterThan(column[1].y1);
  });
});

describe('F433 and F434: the Format settings reach every part', () => {
  it('gives dotted curve joins the join line width (F433)', () => {
    const doc = new Doc();
    const m = plainMeasure(doc);
    doc.edit('e', () => putEnergy(doc, m, energy([{ name: '', color: '#000000', dash: 'dotted', points: pts([['A', 0], ['B', 10]]) }], { style: 'curve', look: { joinWidth: 3 } }), { x: 100, y: 100 }));
    const dots = [...doc.shapes.values()].filter((s) => s.kind === 'line' && s.dotted);
    expect(dots.length).toBeGreaterThan(0);
    expect(dots.every((s) => s.lineWidth === 3)).toBe(true);
  });

  it('writes the level of theory in the diagram\'s font (F434)', () => {
    const doc = new Doc();
    const m = plainMeasure(doc);
    doc.edit('e', () => putEnergy(doc, m, energy([{ name: '', color: '#000000', points: pts([['A', 0], ['B', 10]]) }], { theory: 'B3LYP/6-31G(d)', look: { font: 'Times New Roman' } }), { x: 100, y: 100 }));
    const theory = captions(doc).find((x) => x.t === 'B3LYP/6-31G(d)')!.c;
    expect(theory.runs.every((r) => r.font === 'Times New Roman')).toBe(true);
  });
});

describe('F063 and F437: sawhorse group labels', () => {
  const group = (labels: string[], base: number, at: number): NewmanGroup[] => labels.map((label, i) => ({ atom: base + i, angle: (at + 120 * i) % 360, label, size: 3 - i }));
  const sawhorse = (front: string[], back: string[], look = structuredClone(NEWMAN_LOOK)): Doc => {
    const doc = new Doc();
    const d: NewmanData = { kind: 'sawhorse', front: group(front, 2, 0), back: group(back, 5, 60), turn: 0, conformer: 0, source: 'angle', look: { ...look, ideal: false } };
    doc.bulk(() => { drawNewman(doc, plainMeasure, d, { x: 100, y: 100 }); });
    return doc;
  };

  it('draws Ac and Pr as groups on a carbon, not actinium and praseodymium (F063)', () => {
    const doc = sawhorse(['Ac', 'H', 'Br'], ['Pr', 'H', 'Cl']);
    const at = (label: string) => [...doc.atoms.values()].find((a) => a.label === label);
    expect(at('Ac')?.z).toBe(6);
    expect(at('Pr')?.z).toBe(6);
    expect([...doc.atoms.values()].some((a) => a.z === 89 || a.z === 59)).toBe(false);
    // a real element written alone is still that element (bromine, 35)
    expect([...doc.atoms.values()].some((a) => a.z === 35 && !a.label)).toBe(true);
  });

  it('writes a group italic when Settings ▸ Newman Projections says so (F437)', () => {
    const look = structuredClone(NEWMAN_LOOK);
    look.text = { ...(look.text ?? {}), italic: true } as typeof look.text;
    const doc = sawhorse(['OMe', 'H', 'Br'], ['CN', 'H', 'Cl'], look);
    const ome = [...doc.atoms.values()].find((a) => a.label === 'OMe')!;
    expect((ome.face ?? 0) & 2).toBe(2);
  });
});

describe('F064: an MO diagram drawn again with orbital pictures has one set of lobes', () => {
  it('replaces the p-orbital lobes rather than adding to them', () => {
    const doc = new Doc();
    doc.style = { ...ACS_1996 };
    const plate = newPlate('mo', doc.style.bondLength);
    const nn = { ...plate, mo: { ...fromAtoms('N', 'N')!, pictures: true } };
    let id = 0;
    doc.edit('MO', () => { id = putPlate(doc, POINTS, nn, { x: 0, y: 0 }); });
    const lobes = () => [...doc.shapes.values()].filter((s) => s.kind === 'geo' && s.geo === 'orbLobe').length;
    const once = lobes();
    expect(once).toBeGreaterThan(0);
    for (let i = 0; i < 2; i++) doc.edit('again', () => putPlate(doc, POINTS, { ...nn, w: nn.w + 10 * (i + 1) }, { x: 0, y: 0 }, id));
    expect(lobes()).toBe(once);
  });
});

describe('F435: a LiH-type diagram beside a 2p orbital', () => {
  it('joins the bonding and antibonding orbitals to Li 2s and the 2p orbital only', () => {
    const spec = fromAtoms('Li', '2p')!;
    const mids = spec.levels.filter((l) => l.column === 'middle' && l.from?.includes(','));
    expect(mids.length).toBe(2);
    for (const mo of mids) {
      const from = sources(spec.levels, mo).map((l) => `${l.column} ${l.label}`).sort();
      expect(from).toEqual(['left 2s', 'right 2p']);
    }
  });
});

describe('F438: spot colors are only the color words', () => {
  it('reads constructor and valueOf as no color', () => {
    expect(spotColorHex('constructor')).toBeUndefined();
    expect(spotRows('0.5 constructor')[0].color).toBe('');
    expect(parseMarks('0.5 valueof, 0.3 tostring')[0].color).toBeUndefined();
    expect(parseMarks('0.5 blue')[0].color).toBe(spotColorHex('blue'));
  });
});

describe('F439 and F441: crystal drawings', () => {
  /** Two carbon atoms 1.54 Å apart (a C–C single bond, CRC Handbook) with made-up thermal motion. */
  const spec = (): CrystalSpec => {
    const u: [number, number, number, number, number, number] = [0.03, 0.02, 0.025, 0.002, 0.001, 0.003];
    const atoms = [
      { label: 'C1', el: 'C', xyz: [0, 0, 0] as [number, number, number], u, aniso: true, mol: 0 },
      { label: 'C2', el: 'C', xyz: [1.54, 0, 0] as [number, number, number], u, aniso: true, mol: 0 },
    ];
    const view = { ...defaultView(), colour: false, labels: false, fadedAtoms: [0] };
    return { name: 'x', atoms, bonds: [[0, 1]], view };
  };

  it('fades a faded atom\'s ellipsoid in ORTEP style (F439)', () => {
    const c = spec();
    const items = crystalShapes(c, c.view);
    const ellipses = items.filter((s) => s.kind === 'ellipse');
    expect(ellipses.length).toBe(2);
    expect(ellipses.filter((s) => s.faded).map((s) => s.atom)).toEqual([0]);
    // its principal ellipses too
    const arcs = items.filter((s) => s.kind === 'polyline' && s.points!.length > 2);
    expect(arcs.length).toBeGreaterThan(0);
    expect(arcs.filter((s) => s.atom === 0).every((s) => s.faded)).toBe(true);
    expect(arcs.filter((s) => s.atom === 1).some((s) => s.faded)).toBe(false);
  });

  it('measures a drawing of more points than Math.min takes at once (F441)', () => {
    const points: [number, number][] = Array.from({ length: 300_000 }, (_, i) => [i % 1000, Math.floor(i / 1000) - 299]);
    const line: XShape = { kind: 'polyline', depth: 0, points, fill: 'none', stroke: '#000000', width: 0.5 };
    expect(shapesBounds([line])).toEqual([0, -299, 999, 0]);
    expect(shapesBounds([])).toEqual([0, 0, 1, 1]);
  });
});
