// The Newman projection's layout: every label sits at the end of its own bond and no two labels
// (or a label and another group's bond) touch, for staggered, eclipsed, skew and crowded cases.
import { describe, expect, it } from 'vitest';
import { idealGroups, type NewmanGroup } from '../src/chem/newman';
import { layoutNewman, newmanTextSize, NEWMAN_LOOK } from '../src/design/newman';

const g = (label: string, angle: number, size = 1, atom = 0): NewmanGroup => ({ atom, angle, label, size });
const measure = (text: string, _rank: number, scale: number) => ({ w: text.length * 5 * scale, h: 10 * scale });
const L = 30, c = { x: 0, y: 0 };
const lay = (front: NewmanGroup[], back: NewmanGroup[], turn = 0) => layoutNewman({ front, back, turn, look: structuredClone(NEWMAN_LOOK) }, c, L, measure);
const touch = (a: { x1: number; y1: number; x2: number; y2: number }, b: typeof a) => a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;

const small = [g('Ph', 0, 2.8), g('Cl', 118, 0.4), g('H', 243, 0)];
const smallBack = (t: number) => [g('Br', 180 + t, 0.4, 10), g('CH3', 300 + t, 1.7, 11), g('H', 60 + t, 0, 12)];
const long = [g('CO2Me', 0, 1.3), g('NMe2', 118, 2.1), g('CH2CH3', 241, 1.8)];
const longBack = (t: number) => [g('OTBS', 60 + t, 1, 10), g('CH2OH', 180 + t, 1.8, 11), g('tBu', 300 + t, 4.9, 12)];

describe('idealGroups', () => {
  it('puts three groups 120° apart and staggers the back set at 60°', () => {
    const { front, back } = idealGroups(small, smallBack(-7));
    const fa = front.map((x) => x.angle).sort((p, q) => p - q);
    expect(fa[1] - fa[0]).toBeCloseTo(120);
    expect(fa[2] - fa[1]).toBeCloseTo(120);
    for (const b of back) expect(Math.abs((((b.angle - front[0].angle) % 60) + 60) % 60)).toBeLessThan(1e-6);
    // staggered: no back group behind a front one
    for (const b of back) for (const f of front) expect(Math.abs(((b.angle - f.angle + 540) % 360) - 180)).toBeGreaterThan(50);
  });
  it('snaps a nearly eclipsed back set onto the front one', () => {
    const { front, back } = idealGroups(small, smallBack(-57));
    expect(back.some((b) => front.some((f) => Math.abs(((b.angle - f.angle + 540) % 360) - 180) < 1))).toBe(true);
  });
});

describe('layoutNewman', () => {
  const cases: [string, NewmanGroup[], NewmanGroup[], number][] = [
    ['gauche', small, smallBack(-7), 0], ['eclipsed', small, smallBack(-57), 0], ['skew, turned 45°', small, smallBack(-7), 45],
    ['long labels, gauche', long, longBack(3), 0], ['long labels, eclipsed', long, longBack(-58), 0], ['long labels, turned 40°', long, longBack(0), 40],
  ];
  for (const [name, front, back, turn] of cases) {
    it(`keeps labels apart and on their bonds: ${name}`, () => {
      const { places, scale, R } = lay(front, back, turn);
      expect(scale).toBeGreaterThanOrEqual(0.7 - 1e-9);
      const boxes = places.filter((p) => p.box);
      for (let i = 0; i < boxes.length; i++) for (let k = i + 1; k < boxes.length; k++) expect(touch(boxes[i].box!, boxes[k].box!), `${boxes[i].text} / ${boxes[k].text}`).toBe(false);
      for (const p of boxes) {
        // the label starts within a small gap of its bond's end
        const b = p.box!, dx = Math.max(b.x1 - p.tip.x, 0, p.tip.x - b.x2), dy = Math.max(b.y1 - p.tip.y, 0, p.tip.y - b.y2);
        expect(Math.hypot(dx, dy), p.text).toBeLessThan(0.2 * L);
        // front bonds start at the middle, back bonds at the circle's edge; none is stretched past 4 radii
        expect(Math.hypot(p.from.x, p.from.y)).toBeCloseTo(p.back ? R : 0, 5);
        expect(Math.hypot(p.tip.x, p.tip.y)).toBeLessThanOrEqual(4.8 * R);
      }
    });
  }
  it('keeps a skew projection compact: its bonds are not stretched to make room', () => {
    const { places, R } = lay(small, smallBack(-7), 45);
    for (const p of places) expect(Math.hypot(p.tip.x, p.tip.y)).toBeLessThanOrEqual(R * (1 + NEWMAN_LOOK.reach) + 1.4 * R + 1e-6);
  });
});

describe('newmanTextSize', () => {
  it('is 2 points under the caption text unless a size is chosen', () => {
    expect(newmanTextSize(NEWMAN_LOOK, 10)).toBe(8);
    expect(newmanTextSize({ ...NEWMAN_LOOK, text: { auto: true, size: 12 } }, 10)).toBe(12);
    expect(newmanTextSize(NEWMAN_LOOK, 6)).toBe(5);
  });
});
