// Fixes from the code review of 2026-11-26 (batch 04, canvas drawing and editing) that live in the
// model and the geometry: Redo after a joined step, repainting a big arc, finding long bonds after
// an undo, the drawing's bounds with text of several lines, free space beside long text, the way
// round an elliptical arc arrow, connection points on a shape's own sides, a fishhook bent through
// straight, Distribute with a wide object, frames read from a file, guides past the 200th, the 3-D
// shape kept for a structure whose double bond was turned round, and a pinch that goes on after a
// third finger lifts. (No chemistry values are checked here: only geometry and undo.)

import { describe, it, expect } from 'vitest';
import { Doc, type Arrow, type Shape } from '../src/model';
import { arrowEllipseFrame, ellipseArrow, arrowPoints, gluePoint, dragArrowHandle, shapePorts } from '../src/objects';
import { freeSpace } from '../src/editor/free-space';
import { distributeOffsets, units, POINTS, type Unit } from '../src/editor/arrange';
import { withLabels } from '../src/editor/grid-arrange';
import { fillFrameMembers, frameMembers } from '../src/editor/frames';
import { parseGuides } from '../src/editor/guides';
import { structureKey, prepareTurn, type PerspectiveHost } from '../src/editor/perspective';
import { DEG } from '../src/geom';

const arrow = (extra: Partial<Arrow> = {}): Omit<Arrow, 'id'> => ({
  tail: { x: 0, y: 0 }, head: { x: 20, y: 0 }, headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'solid',
  noGo: false, equilibrium: false, sweep: 0, headLength: 4, headWidth: 1.5, ...extra,
} as Omit<Arrow, 'id'>);

describe('F518: a change joined to the last step after an undo', () => {
  it('leaves nothing to redo', () => {
    const doc = new Doc();
    let a = 0;
    doc.edit('Atom', () => { a = doc.addAtom(0, 0).id; });
    doc.edit('Bond', () => { const b = doc.addAtom(14, 0); doc.addBond(a, b.id); });
    expect(doc.undo()).toBe(true);
    expect(doc.canRedo()).toBe(true);
    // (as Paste and Expand Label do: their changes join the newest step)
    doc.amend('Paste', () => { doc.addAtom(50, 50); });
    expect(doc.canRedo()).toBe(false);
    expect(doc.redo()).toBe(false);
    expect(doc.bonds.size).toBe(0);
  });
});

describe('F519: moving an arc bent far round', () => {
  it('repaints every part of it', () => {
    const doc = new Doc();
    let id = 0;
    // 300°, the chord only 20 pt long: the arc reaches well past the chord's length from it
    doc.edit('Arrow', () => { id = doc.addArrow(arrow({ sweep: 300 * DEG })).id; });
    // (as after a repaint: only what changes is painted again)
    doc.allDirty = false;
    doc.dirtyRects.length = 0;
    const before = arrowPoints(doc.arrows.get(id)!, 48);
    doc.edit('Move', () => doc.updateArrow(id, { tail: { x: 100, y: 0 }, head: { x: 120, y: 0 } }));
    const after = arrowPoints(doc.arrows.get(id)!, 48);
    const covered = (p: { x: number; y: number }) => doc.dirtyRects.some((r) => p.x >= r.x1 && p.x <= r.x2 && p.y >= r.y1 && p.y <= r.y2);
    for (const p of [...before, ...after]) expect(covered(p)).toBe(true);
  });
});

describe('F520: an undo that makes a bond long again', () => {
  it('finds that bond near its middle', () => {
    const doc = new Doc();
    let far = 0, a = 0, b = 0;
    doc.edit('draw', () => {
      const p = doc.addAtom(0, 0), q = doc.addAtom(50, 0);
      doc.addBond(p.id, q.id);
      const r = doc.addAtom(0, 100), s = doc.addAtom(100, 100);
      doc.addBond(r.id, s.id);
      far = s.id; a = r.id; b = s.id;
    });
    // the 100 pt bond made 30 pt long: the longest is now 50
    doc.edit('Move', () => doc.updateAtom(far, { x: 30 }));
    expect(doc.maxBondLength).toBeCloseTo(50, 6);
    doc.undo();
    // back to 100 pt: a point at its middle, 50 pt from either atom, finds it
    const near = doc.bondsNear({ x: 50, y: 100 }, 3);
    expect(near.some((bd) => (bd.a1 === a && bd.a2 === b) || (bd.a1 === b && bd.a2 === a))).toBe(true);
  });
});

describe('F098: the drawing\'s bounds', () => {
  it('reach the last line of text of several lines', () => {
    const doc = new Doc();
    const lines = 8;
    doc.edit('Text', () => doc.addCaption({ x: 0, y: 0, runs: [{ text: Array.from({ length: lines }, (_, i) => `line ${i + 1}`).join('\n') }], justify: 'left' }));
    const b = doc.bounds()!;
    // eight lines at the caption size: at least seven line heights below the first line's baseline
    expect(b.y2).toBeGreaterThan(7 * doc.style.captionSize);
  });
});

describe('F041: free space beside a long caption', () => {
  it('is not found on top of the text past its first 40 pt', () => {
    const doc = new Doc();
    doc.edit('Text', () => doc.addCaption({ x: 0, y: 0, runs: [{ text: 'x'.repeat(100) }], justify: 'left' }));
    const ext = doc.captionExtent([...doc.captions.values()][0]);
    expect(ext.x2).toBeGreaterThan(200);
    // asked for a small box right on the caption's far half
    const near = { x: (ext.x1 + ext.x2) * 0.75, y: (ext.y1 + ext.y2) / 2 };
    const w = 20, h = 6;
    const c = freeSpace(doc, w, h, near, 4);
    const box = { x1: c.x - w / 2, y1: c.y - h / 2, x2: c.x + w / 2, y2: c.y + h / 2 };
    const overlaps = box.x1 < ext.x2 && box.x2 > ext.x1 && box.y1 < ext.y2 && box.y2 > ext.y1;
    expect(overlaps).toBe(false);
  });

  it('is not found across the middle of a long bond', () => {
    const doc = new Doc();
    doc.edit('draw', () => { const a = doc.addAtom(0, 0), b = doc.addAtom(200, 0); doc.addBond(a.id, b.id); });
    const c = freeSpace(doc, 6, 6, { x: 50, y: 0 }, 4);
    // a box that crosses the bond's line between its ends is not free
    const crosses = c.x + 3 > 0 && c.x - 3 < 200 && Math.abs(c.y) < 3;
    expect(crosses).toBe(false);
  });
});

describe('F099: the way round an elliptical arc arrow', () => {
  it('is read back as it was made, either way and from any start', () => {
    const c = { x: 50, y: 40 }, u = { x: 30, y: 0 }, v = { x: 0, y: 12 };
    for (const sign of [1, -1]) {
      for (const t0 of [0, 0.4, 1.3, 2.9, 4.1, 5.6]) {
        for (const deg of [60, 120, 200, 270]) {
          const made = ellipseArrow(c, u, v, t0, sign * deg * DEG);
          const f = arrowEllipseFrame({ ...made, sweep: made.sweep ?? 0 })!;
          expect(f).not.toBeNull();
          const again = ellipseArrow(f.c, f.u, f.v, f.t0, f.sweep);
          expect(again.head.x).toBeCloseTo(made.head.x, 3);
          expect(again.head.y).toBeCloseTo(made.head.y, 3);
          expect(again.tail.x).toBeCloseTo(made.tail.x, 3);
        }
      }
    }
  });
});

describe('F521: connection points', () => {
  it('sit on the middles of the shape\'s own sides, not on its shadow', () => {
    const s = { id: 1, kind: 'rect', x1: 0, y1: 0, x2: 100, y2: 40, shadow: true, shadowSize: 2.4 } as unknown as Shape;
    const ps = shapePorts(s)!;
    // top, right, bottom, left
    expect(ps[0].x).toBeCloseTo(50, 6); expect(ps[0].y).toBeCloseTo(0, 6);
    expect(ps[1].x).toBeCloseTo(100, 6); expect(ps[1].y).toBeCloseTo(20, 6);
    expect(ps[2].x).toBeCloseTo(50, 6); expect(ps[2].y).toBeCloseTo(40, 6);
    expect(ps[3].x).toBeCloseTo(0, 6);
    expect(gluePoint(s, 1).x).toBeCloseTo(100, 6);
  });
});

describe('F523: a fishhook bent through straight to the other side', () => {
  it('keeps its barb on the outside of the curve', () => {
    let r = { id: 1, ...arrow({ headStyle: 'halfLeft', sweep: 30 * DEG }) } as Arrow;
    const mid = { x: 10, y: 0 };
    // dragged slowly across the tail-to-head line: through sweep 0 to the other side
    for (const y of [-3, -1, 0, 1, 3, 6]) {
      const patch = dragArrowHandle(r, 'mid', { x: mid.x, y }, false) as Partial<Arrow>;
      r = { ...r, ...patch };
    }
    expect(Math.sign(r.sweep)).toBe(-1);
    expect(r.headStyle).toBe('halfRight');
  });
});

describe('F352: Distribute with one object reaching further than the last by its center', () => {
  it('keeps the outermost edges where they are', () => {
    const unit = (x1: number, x2: number): Unit => ({ atoms: [], captions: [], arrows: [], shapes: [], box: { x1, y1: 0, x2, y2: 10 } });
    // A 0–10, D 20–70, B 60–62 (the review's example): D's right edge is the outermost
    const us = [unit(0, 10), unit(20, 70), unit(60, 62)];
    const off = distributeOffsets(us, 'h');
    expect(off[0].x).toBeCloseTo(0, 6);
    expect(off[1].x).toBeCloseTo(0, 6);
    // B goes between them, with equal gaps: (70 − 0 − 62) / 2 = 4
    expect(60 + off[2].x).toBeCloseTo(14, 6);
  });
});

describe('F371: a frame read from a file', () => {
  it('keeps following its structure after the atom it first took is deleted', () => {
    const doc = new Doc();
    const ids: number[] = [];
    let frame = 0;
    doc.edit('draw', () => {
      for (let i = 0; i < 4; i++) ids.push(doc.addAtom(20 + 14 * i, 20 + (i % 2) * 8).id);
      for (let i = 1; i < 4; i++) doc.addBond(ids[i - 1], ids[i]);
      // a frame as a file gives it: only its gap and that it follows
      frame = doc.addShape({ kind: 'rect', x1: 0, y1: 0, x2: 100, y2: 50, frame: { atoms: [], captions: [], arrows: [], shapes: [], padX: 6, padY: 6, fit: true } } as never).id;
    });
    doc.edit('fill', () => fillFrameMembers(doc, POINTS));
    const first = doc.shapes.get(frame)!.frame!.atoms[0];
    doc.edit('Delete', () => doc.removeAtom(first));
    const m = frameMembers(doc, doc.shapes.get(frame)!.frame!);
    expect(m.atoms.size).toBe(3);
  });
});

describe('F373: guides', () => {
  it('past the 200th are read back from the file', () => {
    const list = Array.from({ length: 250 }, (_, i) => ({ kind: i % 2 ? 'h' : 'v', x: i, y: i }));
    const g = parseGuides(JSON.stringify({ list }))!;
    expect(g.list.length).toBe(250);
  });
});

describe('F042: the 3-D shape kept for a structure', () => {
  it('is not taken for a double bond turned the other way round', () => {
    // but-2-ene drawn trans, then one end dragged across the double bond (cis)
    const doc = new Doc();
    const ids: number[] = [];
    doc.edit('draw', () => {
      for (const [x, y] of [[0, 0], [12, 7], [26, 7], [38, 14]]) ids.push(doc.addAtom(x, y).id);
      doc.addBond(ids[0], ids[1]); doc.addBond(ids[1], ids[2], 2); doc.addBond(ids[2], ids[3]);
    });
    const trans = structureKey(doc, ids);
    doc.edit('Move', () => doc.updateAtom(ids[3], { x: 38, y: 0 }));
    const cis = structureKey(doc, ids);
    expect(cis).not.toBe(trans);
    // a plain move of the whole structure keeps it
    doc.edit('Move', () => doc.moveAtoms(ids, 30, 10));
    expect(structureKey(doc, ids)).toBe(cis);
  });
});

describe('F376: a structure changed while its 3-D shape is being built', () => {
  // a 3-D builder that answers only when told to, with a zigzag of the molfile's atom count
  function slowBuilder() {
    const waits: (() => void)[] = [];
    let calls = 0;
    const host: PerspectiveHost = {
      pose: (mol: string) => {
        calls++;
        const n = Number(mol.split('\n')[3].slice(0, 3));
        return new Promise((res) => waits.push(() => res({ pose: {
          pts: Array.from({ length: n }, (_, k) => [1.3 * k, k % 2 ? 0.7 : 0, 0] as [number, number, number]),
          z: Array(n).fill(6), bonds: Array.from({ length: n - 1 }, (_, k) => [k, k + 1] as [number, number]), mirror: false,
        } })));
      },
      smiles: async () => null,
    };
    const answerAll = async () => { for (let i = 0; i < 20; i++) { await new Promise((r) => setTimeout(r, 2)); while (waits.length) waits.shift()!(); } };
    return { host, answerAll, calls: () => calls };
  }
  function twoChains() {
    const doc = new Doc();
    const L = doc.style.bondLength;
    const mk = (y: number, n: number) => {
      const ids: number[] = [];
      doc.edit('c', () => { let prev = -1; for (let k = 0; k < n; k++) { const a = doc.addAtom(L * k, y + (k % 2 ? 7 : 0)).id; if (prev >= 0) doc.addBond(prev, a, 1); prev = a; ids.push(a); } });
      return ids;
    };
    return { doc, A: mk(0, 3), B: mk(100, 4) };
  }
  const piecesOf = (prep: Awaited<ReturnType<typeof prepareTurn>>) => (prep.turn as unknown as { pieces: { ids: number[] }[] }).pieces;

  it('builds the shape again with the atom added to it', async () => {
    const { doc, B } = twoChains();
    const { host, answerAll, calls } = slowBuilder();
    const p = prepareTurn(doc, [B], true, host);
    let added = 0;
    doc.edit('Bond', () => { const n = doc.addAtom(200, 130); doc.addBond(B[3], n.id); added = n.id; });
    await answerAll();
    const pieces = piecesOf(await p);
    expect(pieces.some((x) => x.ids.includes(added))).toBe(true);
    expect(calls()).toBe(2);
  });

  it('does so for the second of two structures too', async () => {
    const { doc, A, B } = twoChains();
    const { host, answerAll } = slowBuilder();
    const p = prepareTurn(doc, [A, B], true, host);
    let added = 0;
    doc.edit('Bond', () => { const n = doc.addAtom(200, 130); doc.addBond(B[3], n.id); added = n.id; });
    await answerAll();
    const pieces = piecesOf(await p);
    expect(pieces.some((x) => x.ids.includes(added))).toBe(true);
  });

  it('turns two structures joined meanwhile as one, each atom once', async () => {
    const { doc, A, B } = twoChains();
    const { host, answerAll } = slowBuilder();
    const p = prepareTurn(doc, [A, B], true, host);
    doc.edit('Bond', () => doc.addBond(A[2], B[0]));
    await answerAll();
    const ids = piecesOf(await p).flatMap((x) => x.ids);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(A.length + B.length);
  });
});

describe('F042: the 3-D shape kept for a wedged stereocenter', () => {
  it('is built again after the drawing is flipped (the other hand), and kept otherwise', async () => {
    const doc = new Doc();
    const L = doc.style.bondLength;
    const ids: number[] = [];
    doc.edit('draw', () => {
      const c = doc.addAtom(0, 0);
      ids.push(c.id);
      for (const [x, y] of [[0, -L], [-0.87 * L, 0.5 * L], [0.87 * L, 0.5 * L]]) { const n = doc.addAtom(x, y); ids.push(n.id); doc.addBond(c.id, n.id); }
      const w = doc.addAtom(0.5 * L, -0.87 * L);
      ids.push(w.id);
      doc.addBond(c.id, w.id, 1, 'wedge');
    });
    // a builder whose shape is the drawing with the wedged atom raised toward the reader (the hand drawn)
    let calls = 0;
    const host: PerspectiveHost = {
      pose: async (_mol, cues, len) => {
        calls++;
        const lift = new Map(cues.wedges.map((w) => [w.b, (w.toward ? 1 : -1) * len * 0.5]));
        const pts = cues.xy.map((p, i) => [p![0], -p![1], lift.get(i) ?? 0] as [number, number, number]);
        const bonds = cues.xy.slice(1).map((_, k) => [0, k + 1] as [number, number]);
        return { pose: { pts, z: pts.map(() => 6), bonds, mirror: false } };
      },
      smiles: async () => null,
    };
    await prepareTurn(doc, [ids], true, host);
    expect(calls).toBe(1);
    await prepareTurn(doc, [ids], true, host);
    expect(calls).toBe(1);
    // Flip Horizontal without keeping the configuration: the wedge now shows the other hand
    doc.edit('Flip', () => { for (const id of ids) { const a = doc.atoms.get(id)!; doc.updateAtom(id, { x: -a.x }); } });
    await prepareTurn(doc, [ids], true, host);
    expect(calls).toBe(2);
  });
});

describe('F352: Distribute with one object round the rest', () => {
  it('leaves that object where it is', () => {
    const unit = (x1: number, x2: number): Unit => ({ atoms: [], captions: [], arrows: [], shapes: [], box: { x1, y1: 0, x2, y2: 10 } });
    // A 0–100 holds both outermost edges; B 40–45 and C 50–55 sit inside it
    const off = distributeOffsets([unit(0, 100), unit(40, 45), unit(50, 55)], 'h');
    expect(off[0].x).toBe(0);
  });
});

describe('F372: compound numbers go with their structures', () => {
  it('each number with the structure it is under, a caption away from any left alone', () => {
    const doc = new Doc();
    const L = doc.style.bondLength;
    const sel = { atoms: new Set<number>(), bonds: new Set<number>(), captions: new Set<number>(), arrows: new Set<number>(), shapes: new Set<number>() };
    const nums: number[] = [], firsts: number[] = [];
    let loose = 0;
    doc.edit('draw', () => {
      for (let k = 0; k < 4; k++) {
        const a = doc.addAtom(k * 100, 0), b = doc.addAtom(k * 100 + L, L / 2);
        doc.addBond(a.id, b.id);
        firsts.push(a.id);
        sel.atoms.add(a.id); sel.atoms.add(b.id);
        const c = doc.addCaption({ x: k * 100 + L / 2 - 2, y: L / 2 + 14, runs: [{ text: String(k + 1) }], justify: 'left' });
        nums.push(c.id); sel.captions.add(c.id);
      }
      loose = doc.addCaption({ x: 1000, y: 500, runs: [{ text: 'far away' }], justify: 'left' }).id;
      sel.captions.add(loose);
    });
    const us = withLabels(doc, units(doc, sel, POINTS), L);
    expect(us.length).toBe(5);
    for (let k = 0; k < 4; k++) {
      const u = us.find((x) => x.atoms.includes(firsts[k]))!;
      expect(u.captions).toEqual([nums[k]]);
    }
    expect(us.some((u) => !u.atoms.length && u.captions.length === 1 && u.captions[0] === loose)).toBe(true);
  });
});
