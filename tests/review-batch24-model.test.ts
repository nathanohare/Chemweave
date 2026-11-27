// @vitest-environment jsdom
//
// Code review batch 24 (drawing helpers): each test fails on the code before the fix.

import { describe, expect, it } from 'vitest';
import { Doc } from '../src/model';
import { paintObjects, pickObjectLook } from '../src/format-painter';
import { thickenLines } from '../src/preflight-fix';
import type { PreflightIssue } from '../src/preflight';
import { checkDrawing, groupIssues, setStructureAlt, type Issue } from '../src/accessibility';
import { shapeBez, shapeOf } from '../src/arrow-path';
import { presetLike, presetNamed, scaleStyle, sameLook, STYLE_PRESETS } from '../src/drawing-styles';

const none = () => ({ atoms: new Set<number>(), bonds: new Set<number>(), captions: new Set<number>(), arrows: new Set<number>(), shapes: new Set<number>() });
const arrow = (doc: Doc, tail: { x: number; y: number }, head: { x: number; y: number }, extra: object = {}) =>
  doc.addArrow({ tail, head, headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'solid', noGo: false, equilibrium: false, sweep: 0, headLength: 6, headWidth: 2, ...extra });

describe('Format Painter on a drawing takes the whole look, not only what the source has', () => {
  it('a plain rectangle painted over a red, dashed, shadowed one makes it plain', () => {
    const doc = new Doc();
    let plain = 0, styled = 0;
    doc.edit('draw', () => {
      plain = doc.addShape({ kind: 'rect', x1: 0, y1: 0, x2: 10, y2: 10 }).id;
      styled = doc.addShape({ kind: 'rect', x1: 20, y1: 0, x2: 30, y2: 10, color: '#c00000', fillColor: '#ff0000', filled: true, dashed: true, shadow: true, lineWidth: 3 }).id;
    });
    const from = none(); from.shapes.add(plain);
    const look = pickObjectLook(doc, from)!;
    const to = none(); to.shapes.add(styled);
    doc.edit('Format Painter', () => paintObjects(doc, to, look));
    const s = doc.shapes.get(styled)!;
    expect(s.filled).toBeFalsy();
    expect(s.fillColor).toBeUndefined();
    expect(s.dashed).toBeFalsy();
    expect(s.shadow).toBeFalsy();
    expect(s.color).toBeUndefined();
    expect(s.lineWidth).toBeUndefined();
    // the shape's own position and kind stay
    expect(s).toMatchObject({ kind: 'rect', x1: 20, x2: 30 });
    // one undo step puts it back
    doc.undo();
    expect(doc.shapes.get(styled)).toMatchObject({ filled: true, dashed: true, shadow: true, color: '#c00000' });
  });

  it('a default atom painted over a colored, highlighted one makes it default', () => {
    const doc = new Doc();
    let a1 = 0, a2 = 0;
    doc.edit('draw', () => {
      a1 = doc.addAtom(0, 0, 6).id;
      a2 = doc.addAtom(14, 0, 6, { color: '#0000ff', highlight: '#ffff00' }).id;
    });
    const from = none(); from.atoms.add(a1);
    const look = pickObjectLook(doc, from)!;
    const to = none(); to.atoms.add(a2);
    doc.edit('Format Painter', () => paintObjects(doc, to, look));
    expect(doc.atoms.get(a2)!.color).toBeUndefined();
    expect(doc.atoms.get(a2)!.highlight).toBeUndefined();
  });

  it('an arrow with the default width painted over a thick one takes the default width', () => {
    const doc = new Doc();
    let thin = 0, thick = 0;
    doc.edit('draw', () => {
      thin = arrow(doc, { x: 0, y: 0 }, { x: 10, y: 0 }).id;
      thick = arrow(doc, { x: 0, y: 20 }, { x: 10, y: 20 }, { lineWidth: 2, color: '#ff00ff', line: 'dashed' }).id;
    });
    const from = none(); from.arrows.add(thin);
    const look = pickObjectLook(doc, from)!;
    const to = none(); to.arrows.add(thick);
    doc.edit('Format Painter', () => paintObjects(doc, to, look));
    expect(doc.arrows.get(thick)!.lineWidth).toBeUndefined();
    expect(doc.arrows.get(thick)!.color).toBeUndefined();
    expect(doc.arrows.get(thick)!.line).toBe('solid');
  });
});

describe('Thicken Lines marks every thin place an arrow or shape covers', () => {
  it('two overlapping thin arrows over a structure leave the bonds alone', () => {
    const doc = new Doc();
    doc.edit('draw', () => {
      doc.setStyle({ ...doc.style, lineWidth: 0.6 });
      const a = doc.addAtom(0, 0, 6).id, b = doc.addAtom(14, 0, 6).id;
      doc.addBond(a, b, 1);
      arrow(doc, { x: 0, y: 0 }, { x: 10, y: 0 }, { lineWidth: 0.3 });
      arrow(doc, { x: 2, y: 0 }, { x: 12, y: 0 }, { lineWidth: 0.3 });
    });
    // what a check of the figure for ACS (0.5 pt least) finds: the two arrows' strokes, drawn 0.3 pt
    const issue = {
      rule: 'line-min', level: 'error', fix: 'lines', title: '', want: 0.51,
      where: [{ x1: -1, y1: -1, x2: 11, y2: 1 }, { x1: 1, y1: -1, x2: 13, y2: 1 }], sizes: [0.3, 0.3],
    } as PreflightIssue;
    const ctx = { captionBox: () => ({ x1: 0, y1: 0, x2: 0, y2: 0 }), shapeBox: () => ({ x1: 0, y1: 0, x2: 0, y2: 0 }) };
    expect(thickenLines(doc, issue, ctx)).toBe(true);
    expect([...doc.arrows.values()].map((a) => a.lineWidth)).toEqual([0.51, 0.51]);
    // the bonds were thick enough: the drawing's line width is not multiplied by 0.51 / 0.3
    expect(doc.style.lineWidth).toBe(0.6);
  });
});

describe('the accessibility checker', () => {
  it('sees alt text kept on a point of attachment, the first atom made', () => {
    const doc = new Doc();
    let first = 0;
    doc.edit('draw', () => {
      first = doc.addAtom(0, 0, 6, { attach: '*' }).id;
      const a = doc.addAtom(14, 0, 6).id, b = doc.addAtom(28, 0, 8).id;
      doc.addBond(first, a, 1);
      doc.addBond(a, b, 1);
    });
    expect(checkDrawing(doc).filter((i) => i.rule === 'alt-smiles')).toHaveLength(1);
    setStructureAlt(doc, first, 'A methoxy fragment');
    expect(doc.atoms.get(first)!.alt).toBe('A methoxy fragment');
    expect(checkDrawing(doc).filter((i) => i.rule === 'alt-smiles')).toHaveLength(0);
  });

  it('groups many issues without copying a growing array each time', () => {
    const list: Issue[] = [];
    for (let i = 0; i < 50_000; i++) list.push({ rule: 'merged-cells', where: `Merged ${i}`, place: { kind: 'cell', sheet: 0, row: i, col: 0 } } as unknown as Issue);
    const t = performance.now();
    const groups = groupIssues(list);
    const ms = performance.now() - t;
    expect(groups).toHaveLength(1);
    expect(groups[0].items).toHaveLength(50_000);
    // (the old way copied about 1.25 billion slots: many seconds)
    expect(ms).toBeLessThan(1500);
  });
});

describe('a one-curve arrow that is not a ready-made U-turn', () => {
  const ends = { tail: { x: 0, y: 0 }, head: { x: 100, y: 0 }, sweep: 0 };

  it('is a U-turn only as made', () => {
    expect(shapeOf({ ...ends, bez: shapeBez('u', 1) })).toBe('u');
    expect(shapeOf({ ...ends, bez: shapeBez('u', -1) })).toBe('u');
  });

  it('with a handle dragged is a path of its own, so U-turn can put it right again', () => {
    const bez = shapeBez('u', 1);
    bez[1] = { x: 0.8, y: 1.4 };
    expect(shapeOf({ ...ends, bez })).toBeNull();
  });

  it('an S stays an S where its bends differ from the ready-made ones', () => {
    expect(shapeOf({ ...ends, bez: [{ x: 0.3, y: 0.5 }, { x: 0.6, y: -0.9 }] })).toBe('s');
  });
});

describe('journal styles', () => {
  it('scaling a whole style scales the Results text size too', () => {
    const st = { ...STYLE_PRESETS[0].style, captionSize: 10, resultsTextSize: 8 };
    expect(scaleStyle(st, 2).resultsTextSize).toBe(16);
    // one that has none still has none
    const plain = { ...STYLE_PRESETS[0].style };
    delete plain.resultsTextSize;
    expect('resultsTextSize' in scaleStyle(plain, 2)).toBe(false);
  });

  it('a drawing in Elsevier\'s style is found as Elsevier, not as Wiley (they draw the same)', () => {
    const wiley = presetNamed('Wiley (Angewandte, Chemistry Europe)')!.style;
    const elsevier = presetNamed('Elsevier (Tetrahedron and others)')!.style;
    expect(sameLook(wiley, elsevier)).toBe(true);
    expect(presetLike(elsevier)!.style.name).toBe('Elsevier (Tetrahedron and others)');
    expect(presetLike(wiley)!.style.name).toBe('Wiley (Angewandte, Chemistry Europe)');
    // a style by another name that looks the same is the first that looks the same
    expect(presetLike({ ...elsevier, name: 'Mine' })!.style.name).toBe('Wiley (Angewandte, Chemistry Europe)');
    expect(presetLike({ ...elsevier, bondLength: 3 })).toBeUndefined();
  });
});
