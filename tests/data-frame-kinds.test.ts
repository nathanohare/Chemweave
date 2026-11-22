// @vitest-environment jsdom
//
// One list of the drawings kept as data on an invisible frame (energy diagram, SmartArt-style
// diagram, plate, Smart Scheme, Newman projection, torsion chart), used by every place that
// treats such a frame apart from an ordinary rectangle: Format Painter, the Style panel and
// Action Settings (G3-13, G3-14, G3-15).

import { describe, expect, it } from 'vitest';
import { DATA_FRAME_KINDS, Doc, dataFrameKind, isDataFrame, type Shape } from '../src/model';
import { paintObjects, pickObjectLook } from '../src/format-painter';
import { StylePanel } from '../src/ui/style-panel';
import { readFileSync } from 'node:fs';

const empty = () => ({ atoms: new Set<number>(), bonds: new Set<number>(), captions: new Set<number>(), arrows: new Set<number>(), shapes: new Set<number>() });
/** An invisible frame of each kind (the data is a stand-in: only its presence counts here). */
const frameOf = (doc: Doc, kind: (typeof DATA_FRAME_KINDS)[number]): Shape =>
  doc.addShape({ kind: 'geo', geo: 'rect', x1: 0, y1: 0, x2: 100, y2: 60, filled: false, lineWidth: 0, color: '#000000', frame: { atoms: [], captions: [], arrows: [], shapes: [], padX: 0, padY: 0, fit: true }, [kind]: {} } as Omit<Shape, 'id'>);

describe('frames of drawings kept as data', () => {
  it('are known by one list, every kind of them', () => {
    expect([...DATA_FRAME_KINDS].sort()).toEqual(['diagram', 'energy', 'newman', 'plate', 'smart', 'torsion']);
    const doc = new Doc();
    doc.edit('add', () => {
      for (const k of DATA_FRAME_KINDS) {
        const s = frameOf(doc, k);
        expect(dataFrameKind(s)).toBe(k);
        expect(isDataFrame(s)).toBe(true);
      }
      const rect = doc.addShape({ kind: 'rect', x1: 0, y1: 0, x2: 10, y2: 10 });
      expect(isDataFrame(rect)).toBe(false);
    });
  });

  it('Format Painter neither takes the look of one nor paints a box round it, whatever its kind', () => {
    for (const k of DATA_FRAME_KINDS) {
      const doc = new Doc();
      let frame = 0, rect = 0;
      doc.edit('add', () => {
        frame = frameOf(doc, k).id;
        rect = doc.addShape({ kind: 'rect', x1: 200, y1: 0, x2: 260, y2: 40, filled: true, fillColor: '#ffcc00', lineWidth: 1.5 }).id;
      });
      // picked from the frame: nothing of a shape's look to take (the target box stays as it is)
      expect(pickObjectLook(doc, { ...empty(), shapes: new Set([frame]) })?.shape, k).toBeUndefined();
      // painted onto the frame: it stays invisible
      const look = pickObjectLook(doc, { ...empty(), shapes: new Set([rect]) })!;
      doc.edit('paint', () => paintObjects(doc, { ...empty(), shapes: new Set([frame]) }, look));
      const f = doc.shapes.get(frame)!;
      expect(f.filled, k).toBe(false);
      expect(f.lineWidth, k).toBe(0);
    }
  });

  it('the Style panel shows no rectangle fill and outline for one, whatever its kind', () => {
    // (a plain rectangle's rows, for comparison: Shape, Fill, Outline)
    for (const k of DATA_FRAME_KINDS) {
      const doc = new Doc();
      let frame = 0;
      doc.edit('add', () => { frame = frameOf(doc, k).id; });
      if (k === 'energy' || k === 'plate' || k === 'newman' || k === 'diagram') continue; // their own sections need full data (tested with them)
      const section = document.createElement('section'), body = document.createElement('div');
      const panel = new StylePanel(section, body, doc, () => ({ ...empty(), shapes: new Set([frame]) }), () => {});
      panel.refresh(true);
      const labels = [...body.querySelectorAll('.style-row')].map((r) => r.firstElementChild?.textContent ?? '');
      expect(labels.filter((t) => /^(Shape|Fill|Outline)/.test(t)), k).toEqual([]);
    }
  });

  it('no place in the app lists the kinds by hand (they ask isDataFrame)', () => {
    // the three places the audit found listing only some kinds
    const painter = readFileSync('src/format-painter.ts', 'utf8');
    const panel = readFileSync('src/ui/style-panel.ts', 'utf8');
    const main = readFileSync('src/main.ts', 'utf8');
    expect(painter).toMatch(/paintableShape = \(s: Shape\) => LOOK_KINDS\.has\(s\.kind\) && !isDataFrame\(s\)/);
    expect(panel).toMatch(/all\.length === 1 && isDataFrame\(all\[0\]\)/);
    expect(main).toMatch(/async function actionSettings[\s\S]{0,200}!isDataFrame\(s\)/);
  });
});
