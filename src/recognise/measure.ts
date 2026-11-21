// Measuring how a picture of a structure was drawn, for Make Editable's Match Original Style: the
// atoms' places (the reader gives them only roughly, on a 64-step grid, so each is moved onto
// the lines in the picture), the bond length, the line width and the label size. All in the
// picture's pixels; the caller turns them into points by how big the picture is shown.

import type { Pixels } from './picture';

/** How dark the picture is at (x, y), 0 (paper) to 1 (ink), between pixels too (bilinear). */
export function inkAt(p: Pixels, x: number, y: number): number {
  if (x < 0 || y < 0 || x > p.width - 1 || y > p.height - 1) return 0;
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(x0 + 1, p.width - 1), y1 = Math.min(y0 + 1, p.height - 1);
  const fx = x - x0, fy = y - y0;
  const d = (xx: number, yy: number) => {
    const i = (yy * p.width + xx) * 4, a = p.data[i + 3] / 255;
    // see-through is paper
    return a * (1 - (0.299 * p.data[i] + 0.587 * p.data[i + 1] + 0.114 * p.data[i + 2]) / 255);
  };
  return (d(x0, y0) * (1 - fx) + d(x1, y0) * fx) * (1 - fy) + (d(x0, y1) * (1 - fx) + d(x1, y1) * fx) * fy;
}

export interface MeasureBond { a: number; b: number; order: number; display: 'solid' | 'wedge' | 'hashWedge' }

const median = (v: number[]): number | null => {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/** The median bond length (pixels). */
export function bondLengthPx(pts: [number, number][], bonds: MeasureBond[]): number | null {
  return median(bonds.map((b) => Math.hypot(pts[b.a][0] - pts[b.b][0], pts[b.a][1] - pts[b.b][1])).filter((l) => l > 0));
}

/** How much ink lies along the line from a (an atom being placed) to b, short of b (which may be a label): 0 to 1. */
function lineInk(p: Pixels, a: [number, number], b: [number, number], multiple = false): number {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n = Math.max(4, Math.round(len / 1.5));
  // a double bond's two lines lie either side of the atoms' line, or one on it and one inside a
  // ring (18% of the bond apart): the arrangement with the most ink
  const nx = len ? -(b[1] - a[1]) / len : 0, ny = len ? (b[0] - a[0]) / len : 0;
  const pairs = multiple ? [[-0.09, 0.09], [0, 0.18], [0, -0.18]] : [[0, 0]];
  let best = 0;
  for (const [o1, o2] of pairs) {
    let s = 0;
    for (let i = 0; i <= n; i++) {
      const t = (0.85 * i) / n, x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
      s += (inkAt(p, x + nx * o1 * len, y + ny * o1 * len) + inkAt(p, x + nx * o2 * len, y + ny * o2 * len)) / 2;
    }
    best = Math.max(best, s / (n + 1));
  }
  return best;
}

/**
 * The atoms moved onto the picture's lines: each unlabelled atom is tried within `reach` pixels of
 * where the reader put it, and kept where its bonds run along the most ink. Labelled atoms (O, N,
 * OMe) are moved to the middle of their letters instead. A few rounds, as one atom's move changes
 * its neighbours' best places.
 */
export function refineAtoms(p: Pixels, start: [number, number][], bonds: MeasureBond[], labelled: boolean[], reach: number): [number, number][] {
  const pts = start.map(([x, y]) => [x, y] as [number, number]);
  const nb: number[][] = pts.map(() => []);
  const multiple = new Set<string>();
  for (const b of bonds) { nb[b.a].push(b.b); nb[b.b].push(b.a); if (b.order > 1) { multiple.add(`${b.a},${b.b}`); multiple.add(`${b.b},${b.a}`); } }
  const bond = bondLengthPx(start, bonds) ?? reach * 8;
  // labels: the middle of the letter under (or nearest) the atom
  labelled.forEach((on, i) => {
    if (!on) return;
    const g = glyphAt(p, pts[i], Math.max(reach * 1.5, bond * 0.2), bond);
    if (g) pts[i] = [g.x + g.w / 2, g.y + g.h / 2];
  });
  const step = Math.max(0.5, reach / 8);
  for (let round = 0; round < 3; round++) {
    let moved = false;
    for (let i = 0; i < pts.length; i++) {
      if (labelled[i] || !nb[i].length) continue;
      // a chain's end: where its line stops, so ink just beyond it counts against
      const end = nb[i].length === 1 ? nb[i][0] : -1;
      const score = (x: number, y: number) => {
        let s = nb[i].reduce((t, j) => t + lineInk(p, [x, y], pts[j], multiple.has(`${i},${j}`)), 0) + 0.5 * inkAt(p, x, y);
        if (end >= 0) {
          const dx = x - pts[end][0], dy = y - pts[end][1], l = Math.hypot(dx, dy) || 1;
          const off = Math.max(1, reach * 0.6);
          s -= inkAt(p, x + (dx / l) * off, y + (dy / l) * off);
        }
        return s;
      };
      let best = score(pts[i][0], pts[i][1]), bx = pts[i][0], by = pts[i][1];
      for (let dy = -reach; dy <= reach; dy += step) {
        for (let dx = -reach; dx <= reach; dx += step) {
          const x = start[i][0] + dx, y = start[i][1] + dy, s = score(x, y);
          if (s > best + 1e-6) { best = s; bx = x; by = y; }
        }
      }
      if (bx !== pts[i][0] || by !== pts[i][1]) { pts[i] = [bx, by]; moved = true; }
    }
    if (!moved) break;
  }
  // a chain's end where its line stops: along the line from its neighbour, the last of the ink
  for (let i = 0; i < pts.length; i++) {
    if (labelled[i] || nb[i].length !== 1 || multiple.has(`${i},${nb[i][0]}`)) continue;
    const o = pts[nb[i][0]], dx = pts[i][0] - o[0], dy = pts[i][1] - o[1], l = Math.hypot(dx, dy);
    if (l < 4) continue;
    const ux = dx / l, uy = dy / l;
    // half as dark as the line is (a thin line, smoothed, is never fully dark)
    let peak = 0;
    for (let q = -1.5; q <= 1.5; q += 0.25) peak = Math.max(peak, inkAt(p, o[0] + ux * l * 0.6 - uy * q, o[1] + uy * l * 0.6 + ux * q));
    if (peak < 0.2) continue;
    let last = -1;
    for (let d = l * 0.6; d <= l * 1.4; d += 0.25) {
      if (inkAt(p, o[0] + ux * d, o[1] + uy * d) >= peak / 2) last = d;
      else break;
    }
    if (last > l * 0.8) pts[i] = [o[0] + ux * last, o[1] + uy * last];
  }
  return pts;
}

/**
 * The width of the lines (pixels): across the middle of each plain single bond, the ink summed
 * along a line square to it (so a line 0.8 pixels wide, drawn smoothed over two, still measures
 * 0.8). The middle of the bond is found first, as the atoms may still be a pixel off.
 */
export function lineWidthPx(p: Pixels, pts: [number, number][], bonds: MeasureBond[]): number | null {
  const out: number[] = [];
  for (const b of bonds) {
    if (b.order !== 1 || b.display !== 'solid') continue;
    const [ax, ay] = pts[b.a], [bx, by] = pts[b.b];
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 6) continue;
    const ux = (bx - ax) / len, uy = (by - ay) / len, nx = -uy, ny = ux;
    const along: number[] = [];
    for (const t of [0.4, 0.5, 0.6]) {
      const cx = ax + (bx - ax) * t, cy = ay + (by - ay) * t;
      const half = Math.max(3, len * 0.2), h = 0.25;
      const prof: number[] = [];
      for (let s = -half; s <= half + 1e-9; s += h) prof.push(inkAt(p, cx + nx * s, cy + ny * s));
      // the darkest point near the middle, and the ink joined to it
      const mid = prof.length >> 1, near = Math.round(Math.max(2, len * 0.1) / h);
      let peak = mid;
      for (let k = Math.max(0, mid - near); k <= Math.min(prof.length - 1, mid + near); k++) if (prof[k] > prof[peak]) peak = k;
      if (prof[peak] < 0.25) continue;
      let lo = peak, hi = peak;
      while (lo > 0 && prof[lo - 1] > 0.02 && prof[lo - 1] <= prof[lo] + 0.05) lo--;
      while (hi < prof.length - 1 && prof[hi + 1] > 0.02 && prof[hi + 1] <= prof[hi] + 0.05) hi++;
      let sum = 0;
      for (let k = lo; k <= hi; k++) sum += prof[k];
      along.push(sum * h);
    }
    const m = median(along);
    if (m !== null) out.push(m);
  }
  return median(out);
}

export interface Glyph { x: number; y: number; w: number; h: number }

/** The blob of ink (a letter) under the point, or the nearest within `r` pixels; null if none, if it's a line, or if it grows beyond `most` pixels. */
export function glyphAt(p: Pixels, at: [number, number], r: number, most = r * 2.5): Glyph | null {
  const W = p.width, H = p.height;
  const dark = (x: number, y: number) => inkAt(p, x, y) > 0.45;
  // the nearest dark pixel
  let sx = -1, sy = -1, bestD = Infinity;
  const x1 = Math.max(0, Math.floor(at[0] - r)), x2 = Math.min(W - 1, Math.ceil(at[0] + r));
  const y1 = Math.max(0, Math.floor(at[1] - r)), y2 = Math.min(H - 1, Math.ceil(at[1] + r));
  for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) {
    if (!dark(x, y)) continue;
    const d = Math.hypot(x - at[0], y - at[1]);
    if (d < bestD && d <= r) { bestD = d; sx = x; sy = y; }
  }
  if (sx < 0) return null;
  // the blob it is part of (8-connected), given up on when it grows beyond a letter's size
  const seen = new Set<number>([sy * W + sx]);
  const todo = [sy * W + sx];
  let gx1 = sx, gx2 = sx, gy1 = sy, gy2 = sy;
  while (todo.length) {
    const k = todo.pop()!, x = k % W, y = (k - x) / W;
    if (x < gx1) gx1 = x; if (x > gx2) gx2 = x; if (y < gy1) gy1 = y; if (y > gy2) gy2 = y;
    if (gx2 - gx1 > most || gy2 - gy1 > most) return null;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if ((dx || dy) && xx >= 0 && yy >= 0 && xx < W && yy < H && !seen.has(yy * W + xx) && dark(xx, yy)) { seen.add(yy * W + xx); todo.push(yy * W + xx); }
    }
  }
  const g = { x: gx1, y: gy1, w: gx2 - gx1 + 1, h: gy2 - gy1 + 1 };
  // a stroke rather than a letter (a bond running on from the label): long and thin
  if (Math.max(g.w, g.h) > 3 * Math.min(g.w, g.h)) return null;
  return g;
}

/**
 * Capital letters' height as a share of the font size, as measured here: Arial's and Helvetica's
 * capitals are 0.72 of it, less the smoothed edge the dark-pixel test leaves off (test pictures from
 * 96 to 300 dpi).
 */
export const CAP_HEIGHT = 0.7;

/** The label size (pixels, as a font size) from the letters at the labelled atoms. */
export function labelSizePx(p: Pixels, pts: [number, number][], labelled: boolean[], bondPx: number): number | null {
  const hs: number[] = [];
  labelled.forEach((on, i) => {
    if (!on) return;
    const g = glyphAt(p, pts[i], bondPx * 0.35, bondPx);
    // one letter is about as wide as tall; two run together (OH touching) are wider, still the right height
    if (g && g.h >= 4 && g.h < bondPx) hs.push(g.h);
  });
  const h = median(hs);
  return h === null ? null : h / CAP_HEIGHT;
}

/**
 * The width of the lines when there are no atoms' places (an AI model's reading gives only SMILES):
 * ink summed across each row and each column of every stroke, the smaller of the two for each
 * inked spot; lines at any angle measure between their width and 1.4 times it, so a low share is taken.
 */
export function strokeWidthPx(p: Pixels): number | null {
  const W = p.width, H = p.height;
  const runs = (get: (i: number, j: number) => number, n: number, m: number): number[] => {
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      let s = 0, len = 0;
      for (let j = 0; j <= m; j++) {
        const d = j < m ? get(i, j) : 0;
        if (d > 0.03) { s += d; len++; } else if (len) { if (s > 0.3 && len < 40) out.push(s); s = 0; len = 0; }
      }
    }
    return out;
  };
  const px = (x: number, y: number) => inkAt(p, x, y);
  const all = [...runs((y, x) => px(x, y), H, W), ...runs((x, y) => px(x, y), W, H)].sort((a, b) => a - b);
  if (all.length < 10) return null;
  return all[Math.floor(all.length * 0.3)];
}
