// Make Editable: the boxes drawn round structures in a picture (ChemDraw's frames, often rounded
// and with a shadow, as in a talk's schemes). Each is found from its shape (a mark that is only
// the four sides of a box), taken out of the picture before the structures are read (a box read
// as part of a structure becomes bonds, and boxes touching arrows join a whole scheme into one
// part), and made a box of its own: its line width, rounded corners and shadow as drawn.

import type { Pixels } from './picture';
import { marksOf, rubOut, type Mark } from './scheme-extras';

/** A box found: its sides through the middle of its lines (pixels), line width, corners and shadow. */
export interface FoundFrame {
  x1: number; y1: number; x2: number; y2: number;
  lineWidth: number;
  /** Corner radius (pixels) when its corners are rounded. */
  radius: number;
  shadow: boolean;
  marks: Mark[];
}

/** How dark pixel `i` is, 0 (paper) to 1 (ink). */
function dark(p: Pixels, i: number): number {
  const d = p.data, a = d[i * 4 + 3] / 255;
  return a * (1 - (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) / 255);
}
const INK = 0.2;

/** The boxes in the picture. */
export function findFrames(p: Pixels): FoundFrame[] {
  const W = p.width, H = p.height;
  const least = Math.max(24, Math.round(Math.min(W, H) * 0.06));
  const out: FoundFrame[] = [];
  const ink = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && dark(p, y * W + x) > INK;
  for (const m of marksOf(p, least * 2)) {
    const w = m.x2 - m.x1 + 1, h = m.y2 - m.y1 + 1;
    if (w < least || h < least) continue;
    const own = new Set(m.pixels);
    const mine = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && own.has(y * W + x);
    // how thick each side is, through its middle (a shadow makes the right and bottom thicker,
    // and may start lower down than the box, so the side is looked for in from the edge)
    const side = (x: number, y: number, dx: number, dy: number, most: number) => {
      let at = 0;
      while (at < most && !mine(x + dx * at, y + dy * at)) at++;
      let n = 0;
      while (n < 60 && mine(x + dx * (at + n), y + dy * (at + n))) n++;
      return { at, n };
    };
    const cx = Math.round((m.x1 + m.x2) / 2), cy = Math.round((m.y1 + m.y2) / 2);
    const inW = Math.round(w * 0.1), inH = Math.round(h * 0.1);
    const T = side(cx, m.y1, 0, 1, inH), B = side(cx, m.y2, 0, -1, inH), Lf = side(m.x1, cy, 1, 0, inW), Rt = side(m.x2, cy, -1, 0, inW);
    const tTop = T.at + T.n, tBottom = B.at + B.n, tLeft = Lf.at + Lf.n, tRight = Rt.at + Rt.n;
    if (!T.n || !B.n || !Lf.n || !Rt.n) continue;
    const lw = Math.min(T.n, Lf.n, B.n, Rt.n);
    if (Math.max(tTop, tLeft, tBottom, tRight) > 6 * lw + 6 || lw > 0.08 * Math.min(w, h)) continue;
    // all of it on the sides (rounded corners may come in from them)
    const R = Math.round(Math.min(w, h) * 0.22);
    let onSides = 0;
    for (const k of m.pixels) {
      const x = k % W, y = (k - x) / W;
      const side = x - m.x1 < tLeft + 2 || m.x2 - x < tRight + 2 || y - m.y1 < tTop + 2 || m.y2 - y < tBottom + 2;
      const corner = (x - m.x1 < R || m.x2 - x < R) && (y - m.y1 < R || m.y2 - y < R);
      if (side || corner) onSides++;
    }
    if (onSides < 0.98 * m.pixels.length) continue;
    // and all four sides drawn (away from the corners)
    const along = (n: number, at: (i: number) => boolean) => { let c = 0, t = 0; for (let i = 0; i < n; i++) { t++; if (at(i)) c++; } return t ? c / t : 0; };
    const sides = [
      along(w - 2 * R, (i) => mine(m.x1 + R + i, m.y1 + Math.floor(tTop / 2))),
      along(w - 2 * R, (i) => mine(m.x1 + R + i, m.y2 - Math.floor(tBottom / 2))),
      along(h - 2 * R, (i) => mine(m.x1 + Math.floor(tLeft / 2), m.y1 + R + i)),
      along(h - 2 * R, (i) => mine(m.x2 - Math.floor(tRight / 2), m.y1 + R + i)),
    ];
    if (Math.min(...sides) < 0.9) continue;
    // a shadow: right and bottom sides clearly thicker than the others
    const shadow = tRight > 1.6 * tLeft && tBottom > 1.6 * tTop;
    const sx = shadow ? tRight - tLeft : 0, sy = shadow ? tBottom - tTop : 0;
    // rounded: the corner itself is paper; the radius is where the top side starts
    let radius = 0;
    if (!ink(m.x1, m.y1) && !ink(m.x1 + 1, m.y1 + 1)) {
      let x = m.x1;
      while (x < cx && !mine(x, m.y1 + Math.floor(tTop / 2))) x++;
      radius = x - m.x1;
    }
    out.push({ x1: m.x1 + lw / 2, y1: m.y1 + lw / 2, x2: m.x2 - sx - lw / 2, y2: m.y2 - sy - lw / 2, lineWidth: lw, radius, shadow, marks: [m] });
  }
  return out;
}

/** The picture with its boxes taken out, and the boxes. */
export function withoutFrames(p: Pixels): { p: Pixels; frames: FoundFrame[] } {
  const frames = findFrames(p);
  return { p: frames.length ? rubOut(p, frames.flatMap((f) => f.marks)) : p, frames };
}
