// @vitest-environment jsdom
//
// Code review 2026-11-26, batch 28 round 2: the speed-ups in the reaction animation's GIF encoder
// (F648), its swap planning (F651) and its frame painter (F652), checked directly. The GIF is read
// back with a small decoder written here from the GIF89a specification (CompuServe, 1990: the
// logical screen descriptor, extension and image blocks, and variable-length LZW codes).

import { describe, expect, it, vi } from 'vitest';
import { encodeGif, type RgbaFrame } from '../src/morph/gif';
import { planSwaps, paintFrame } from '../src/morph/paint';
import { frame } from '../src/morph/frame';
import { MScene, type MBond, type MNode, type MStyle } from '../src/morph/scene';
import type { Mapping } from '../src/morph/mapping';

/** The frames of a GIF: each as palette colours (packed RGB) per pixel, and its delay in hundredths of a second. */
function decodeGif(b: Uint8Array): { w: number; h: number; frames: { px: number[]; delay: number }[] } {
  let o = 0;
  const u8 = () => b[o++];
  const u16 = () => { const v = b[o] | (b[o + 1] << 8); o += 2; return v; };
  expect(String.fromCharCode(...b.slice(0, 6))).toBe('GIF89a');
  o = 6;
  const w = u16(), h = u16(), packed = u8();
  o += 2;
  const pal: number[] = [];
  if (packed & 0x80) for (let i = 0; i < 1 << ((packed & 7) + 1); i++) { pal.push((b[o] << 16) | (b[o + 1] << 8) | b[o + 2]); o += 3; }
  const blocks = (): number[] => { const out: number[] = []; for (let n = u8(); n; n = u8()) { for (let i = 0; i < n; i++) out.push(u8()); } return out; };
  const frames: { px: number[]; delay: number }[] = [];
  let delay = 0;
  for (;;) {
    const t = u8();
    if (t === 0x3b) break;
    if (t === 0x21) {
      const label = u8();
      const data = blocks();
      if (label === 0xf9) delay = data[1] | (data[2] << 8);
      continue;
    }
    expect(t).toBe(0x2c);
    o += 8;
    expect(u8() & 0x80).toBe(0);
    const min = u8();
    const data = blocks();
    // LZW, least significant bit first
    const clear = 1 << min, eoi = clear + 1;
    let size = min + 1, dict: number[][] = [], prev: number[] | null = null, bit = 0;
    const reset = () => { dict = Array.from({ length: clear }, (_, i) => [i]); dict.push([], []); size = min + 1; prev = null; };
    reset();
    const out: number[] = [];
    for (;;) {
      let code = 0;
      for (let i = 0; i < size; i++, bit++) code |= ((data[bit >> 3] >> (bit & 7)) & 1) << i;
      if (code === clear) { reset(); continue; }
      if (code === eoi) break;
      const entry: number[] = code < dict.length ? dict[code] : [...prev!, prev![0]];
      out.push(...entry);
      if (prev) dict.push([...prev, entry[0]]);
      prev = entry;
      if (dict.length === 1 << size && size < 12) size++;
    }
    frames.push({ px: out.slice(0, w * h).map((i) => pal[i]), delay });
  }
  return { w, h, frames };
}

/** A frame of white with a black line across row `row` and a red dot at (x, 5). */
function drawn(w: number, h: number, row: number, x: number): RgbaFrame {
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  const put = (px: number, py: number, r: number, g: number, bl: number) => { const i = 4 * (py * w + px); data[i] = r; data[i + 1] = g; data[i + 2] = bl; };
  for (let px = 0; px < w; px++) put(px, row, 0, 0, 0);
  put(x, 5, 255, 0, 0);
  return { data, width: w, height: h };
}
const expected = (w: number, h: number, row: number, x: number) => {
  const px = new Array<number>(w * h).fill(0xffffff);
  for (let i = 0; i < w; i++) px[row * w + i] = 0;
  px[5 * w + x] = 0xff0000;
  return px;
};

describe('F648: GIF encoding', () => {
  it('writes every pixel\'s colour, merging repeated frames', async () => {
    const w = 64, h = 48;
    const frames = [drawn(w, h, 10, 3), drawn(w, h, 10, 3), drawn(w, h, 40, 60)];
    const gif = await encodeGif(frames.length, (i) => frames[i], 50);
    const got = decodeGif(gif);
    expect([got.w, got.h]).toEqual([w, h]);
    expect(got.frames.length).toBe(2);
    expect(got.frames[0].delay).toBe(10);
    expect(got.frames[0].px).toEqual(expected(w, h, 10, 3));
    expect(got.frames[1].px).toEqual(expected(w, h, 40, 60));
  });

  it('looks colours up once per run of one colour, not once per pixel', async () => {
    const w = 200, h = 150;
    const frames = [drawn(w, h, 20, 7), drawn(w, h, 90, 150)];
    const get = vi.spyOn(Map.prototype, 'get');
    try {
      await encodeGif(frames.length, (i) => frames[i], 40);
      // 30,000 pixels a frame, a few runs each
      expect(get.mock.calls.length).toBeLessThan(500);
    } finally {
      get.mockRestore();
    }
  });
});

const L = 14.4;
const STYLE: MStyle = { lineWidth: 0.6, boldWidth: 2, marginWidth: 1.6, hashSpacing: 2.5, bondLength: L, gap: 2.6, wedge: 4.5, labelSize: 10, font: 'Arial' };
/** A scene of carbons (keys as given) and single bonds (keys "1", "2"…, each at its own depth `z`). */
function scene(atoms: [string, number, number][], bonds: [string, string, number][]): MScene {
  const sc = new MScene(STYLE);
  for (const [key, x, y] of atoms) sc.nodes.set(key, { key, atom: Number(key), p: { x, y }, label: null, charge: null, color: [0, 0, 0], frag: key, el: '6' } as MNode);
  bonds.forEach(([b, e, z], i) => {
    const key = String(i + 1);
    sc.bonds.set(key, { key, id: i + 1, b, e, order: 1, aromatic: false, display: 'solid', dpos: 'center', z, color: [0, 0, 0], w: 0.6, s: 1, rungs: 0 } as unknown as MBond);
  });
  return sc;
}
const identity = (A: MScene, B: MScene): Mapping => ({
  nmap: new Map([...A.nodes.keys()].map((k) => [k, k])), bmap: new Map([...A.bonds.keys()].filter((k) => B.bonds.has(k)).map((k) => [k, k])), shifts: new Map(), slides: [],
});
const ts = Array.from({ length: 25 }, (_, k) => k / 24);

describe('F651: swaps are planned for bonds that cross, and only for them', () => {
  it('plans a swap for two bonds that change places over each other, and none for one far away', () => {
    // bond 1 across, bond 2 sliding down through it; both swap depth from start to end. Bond 3, far
    // off, swaps depth with them too but never comes near.
    const atoms = (dy: number): [string, number, number][] => [['1', 0, 0], ['2', 40, 0], ['3', 20, -30 + dy], ['4', 20, -10 + dy], ['5', 500, 500], ['6', 540, 500]];
    const A = scene(atoms(0), [['1', '2', 0], ['3', '4', 1], ['5', '6', 2]]);
    const B = scene(atoms(40), [['1', '2', 2], ['3', '4', 1], ['5', '6', 0]]);
    const sw = planSwaps(A, B, identity(A, B), ts, {});
    expect(sw.size).toBe(1);
    const [[key, [, first, last]]] = [...sw];
    expect(key.split('\u0000').sort()).toEqual(['A1', 'A2']);
    expect(first).not.toBe(last);
  });
});

describe('F652: painting a frame tests only bonds whose boxes meet', () => {
  it('looks up no swap for bonds far apart, and cuts a crossing bond', () => {
    // a zigzag chain (no two of its bonds cross) and, apart, two crossing bonds
    const chainAtoms: [string, number, number][] = Array.from({ length: 30 }, (_, i) => [String(100 + i), i * L * 0.866, i % 2 ? -L / 2 : 0]);
    const chainBonds: [string, string, number][] = Array.from({ length: 29 }, (_, i) => [String(100 + i), String(101 + i), 0]);
    const cross: [string, number, number][] = [['1', 0, 200], ['2', 40, 200], ['3', 20, 180], ['4', 20, 220]];
    const A = scene([...chainAtoms, ...cross], [...chainBonds, ['1', '2', 0], ['3', '4', 1]]);
    const F = frame(A, A, identity(A, A), 0.5, {});
    const swaps = new Map([['nothing\u0000here', [0.5, 'x', 'y']]]) as Map<string, [number, string, string]>;
    const get = vi.spyOn(swaps, 'get');
    const strokes: [number, number, number, number][] = [];
    let from: [number, number] = [0, 0];
    const ctx = new Proxy({}, {
      get: (_t, k) => (k === 'moveTo' ? (x: number, y: number) => { from = [x, y]; } : k === 'lineTo' ? (x: number, y: number) => { strokes.push([...from, x, y]); } : k === 'measureText' ? () => ({ width: 5 }) : () => {}),
      set: () => true,
    }) as unknown as CanvasRenderingContext2D;
    paintFrame(ctx, F, STYLE, 0.5, swaps);
    // only the crossing pair (its boxes meet) is looked up
    expect(get.mock.calls.length).toBe(1);
    // the bond behind (1–2, along y = 200) is drawn in two pieces, cut where the other crosses it
    const along = strokes.filter(([, y0, , y1]) => Math.abs(y0 - 200) < 1e-6 && Math.abs(y1 - 200) < 1e-6);
    expect(along.length).toBe(2);
  });
});
