// @vitest-environment jsdom
// Code review batch 07 (Make Editable).
//  - F069: a cropped picture drawn as a metafile or SVG is read at its own proportions (the whole
//    image was squeezed into the size of the part left, then cropped again).
//  - F459: a crop that rounds past the picture's edge, or reaches outward, takes the right pixels.
//  - F070: changing the style of a made-editable structure keeps what was changed by hand.
//  - F460: the alt text, size, tracing and names the structure has now are kept, cleared or not.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Pixels } from '../src/recognise/picture';
import { readPng } from './png-pixels';

vi.setConfig({ testTimeout: 60000 });
let decoded: Pixels | null = null;
vi.mock('../src/ui/import-structures', () => ({ decodePicture: vi.fn(async () => decoded) }));

import { madeFrom, pictureForReading, restyle } from '../src/ui/doc-make-editable';
import { readFrame } from '../src/recognise/editable';
import { ACS_1996 } from '../src/style';
import type { DocObject } from '../src/document/document';

type Picture = Extract<DocObject, { kind: 'picture' }>;
const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const SVG = 'data:image/svg+xml;base64,PHN2Zy8+';

describe('Cropped pictures as pixels (F459)', () => {
  // a 3 x 2 picture whose pixel (x, y) has red = 10 y + x
  const grid = (): Pixels => {
    const data = new Uint8ClampedArray(3 * 2 * 4);
    for (let y = 0; y < 2; y++) for (let x = 0; x < 3; x++) data.set([10 * y + x, 0, 0, 255], (y * 3 + x) * 4);
    return { width: 3, height: 2, data };
  };
  const reds = (p: Pixels) => Array.from({ length: p.width * p.height }, (_, i) => p.data[i * 4]);

  it('takes whole columns when left x width rounds up (0.5 pixel from the left of 3 is column 1 to the end)', async () => {
    decoded = grid();
    const got = await pictureForReading({ kind: 'picture', src: PNG, w: 30, h: 20, crop: { l: 0.5 / 3, t: 0, r: 0, b: 0 } });
    expect([got!.p.width, got!.p.height]).toEqual([2, 2]);
    // columns 1 and 2 of each row, not a pixel of the next row after them
    expect(reds(got!.p)).toEqual([1, 2, 11, 12]);
  });

  it('cropping outward (Word allows a negative crop) shows the picture inside white margins, at the frame\'s own scale', async () => {
    decoded = grid();
    // a frame 30 pt wide reaching 0.2 of the picture (0.6 of a pixel: one column) out to the left; the top is at the picture's edge
    const got = await pictureForReading({ kind: 'picture', src: PNG, w: 30, h: 20, crop: { l: -0.2, t: -0.1, r: 0, b: 0 } });
    expect([got!.p.width, got!.p.height]).toEqual([4, 2]);
    // (a white column first: nothing is there; then the picture's own columns)
    expect(reds(got!.p)).toEqual([255, 0, 1, 2, 255, 10, 11, 12]);
    // 30 pt over 4 pixels
    expect(got!.ptPerPx).toBeCloseTo(7.5, 6);
  });

  it('a crop that rounds past the bottom keeps the last rows', async () => {
    decoded = grid();
    // t = 0.25 of 2 rows rounds to row 1 (0.5 up); b = 0 leaves 1.5 rows, rounded to 2: one row too many
    const got = await pictureForReading({ kind: 'picture', src: PNG, w: 30, h: 20, crop: { l: 0, t: 0.25, r: 0, b: 0 } });
    expect([got!.p.width, got!.p.height]).toEqual([3, 1]);
    expect(reds(got!.p)).toEqual([10, 11, 12]);
  });
});

describe('A cropped drawn picture (F069)', () => {
  beforeEach(() => {
    // an image that decodes at once, and a canvas that keeps its size and gives a white page of it
    (globalThis as unknown as { Image: unknown }).Image = class { src = ''; naturalWidth = 200; naturalHeight = 200; async decode() {} };
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
      return { fillStyle: '', fillRect() {}, drawImage() {}, getImageData: (_x: number, _y: number, w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }) };
    } as never;
  });

  it('draws the whole image at its own proportions before cropping: half cut off a square leaves a tall half', async () => {
    // 50 x 100 pt is what is left of a 100 x 100 pt drawing after its left half is cropped away
    const o: Picture = { kind: 'picture', src: SVG, w: 50, h: 100, crop: { l: 0.5, t: 0, r: 0, b: 0 } };
    const got = await pictureForReading(o);
    // the part left is twice as tall as wide (not four times, as when the whole was squeezed to 50 x 100 first)
    expect(got!.p.height / got!.p.width).toBeCloseTo(2, 1);
    // and a point is the same number of pixels each way
    expect(got!.ptPerPx).toBeCloseTo(50 / got!.p.width, 6);
  });

  it('with no size on the page, the image\'s own size is the whole image (not stretched again by the crop)', async () => {
    // a square 200 x 200 image with half cut off its left side leaves a tall half
    const got = await pictureForReading({ kind: 'picture', src: SVG, w: 0, h: 0, crop: { l: 0.5, t: 0, r: 0, b: 0 } });
    expect(got!.p.height / got!.p.width).toBeCloseTo(2, 1);
  });

  it('an uncropped one is as it was', async () => {
    const got = await pictureForReading({ kind: 'picture', src: SVG, w: 50, h: 100 });
    expect(got!.p.height / got!.p.width).toBeCloseTo(2, 1);
  });
});

describe('Changing the style of a made-editable structure (F070, F460)', () => {
  // the picture and reading of tests/fixtures/make-editable/acs-300dpi (a drawing at 300 dpi)
  const DIR = join(__dirname, 'fixtures', 'make-editable');
  const f = JSON.parse(readFileSync(join(DIR, 'acs-300dpi.json'), 'utf8')) as { symbols: string[]; truth: [number, number][]; edges: number[][] };
  const px = readPng(new Uint8Array(readFileSync(join(DIR, 'acs-300dpi.png'))));
  const frame = readFrame(px);
  const q = (v: number) => Math.round(v * 63) / 63;
  const parts = [{
    graph: { symbols: f.symbols, edges: f.edges, confidence: 0.95, coords: f.truth.map(([x, y]) => [q((x - frame.x) / frame.w), q((y - frame.y) / frame.h)] as [number, number]) },
    frame,
  }];
  const ptPerPx = 72 / 300;
  const pic: Picture = { kind: 'picture', src: PNG, w: px.width * ptPerPx, h: px.height * ptPerPx, alt: 'a ring' };
  const made = (choice: 'match' | 'default') => madeFrom(pic, { p: px, ptPerPx, parts, problems: [] }, choice, ACS_1996).drawing;

  it('a structure still as it was read is drawn again in the other style, keeping its size, tracing and the alt text it has now', async () => {
    const d0 = made('default');
    const d = { ...d0, scale: 0.8, rot: 90, alt: undefined, fromPicture: { ...d0.fromPicture!, trace: { on: true, opacity: 0.5, tint: 'blue' as const } } };
    delete (d as { alt?: string }).alt;
    decoded = px;
    const got = await restyle(d, 'match', ACS_1996);
    expect(got).not.toBeNull();
    expect(got!.fromPicture!.style).toBe('match');
    // the other style: the atoms are where the picture had them (not the document's bond length)
    expect(got!.contents.atoms.length).toBe(d.contents.atoms.length);
    expect(got!.contents).not.toEqual(d.contents);
    // what the structure has as an object stays
    expect(got!.scale).toBe(0.8);
    expect(got!.rot).toBe(90);
    expect(got!.fromPicture!.trace).toEqual({ on: true, opacity: 0.5, tint: 'blue' });
    // the alt text was cleared: it is not brought back from the picture
    expect(got!.alt).toBeUndefined();
  });

  // the same drawing read as if it were at 150 dpi: its bonds are 28.8 pt long as read, twice the 14.4 pt of the ACS Document 1996 style
  const at150 = 72 / 150;
  const pic150: Picture = { kind: 'picture', src: PNG, w: px.width * at150, h: px.height * at150 };
  const made150 = (choice: 'match' | 'default') => madeFrom(pic150, { p: px, ptPerPx: at150, parts, problems: [] }, choice, ACS_1996).drawing;
  const bondLen = (c: { atoms: { id: number; x: number; y: number }[]; bonds: { a1: number; a2: number }[] }, skip: number) => {
    const at = (id: number) => c.atoms.find((a) => a.id === id)!;
    const b = c.bonds.find((x) => x.a1 !== skip && x.a2 !== skip)!;
    return Math.hypot(at(b.a1).x - at(b.a2).x, at(b.a1).y - at(b.a2).y);
  };

  it('a structure put right by hand is drawn at the other style\'s bond length (not left at the first one)', async () => {
    const d0 = made150('match');
    expect(bondLen(d0.contents, d0.contents.atoms[0].id)).toBeGreaterThan(25);
    const atoms = d0.contents.atoms.map((a, i) => (i === 0 ? { ...a, x: a.x + 5 } : a));
    decoded = px;
    const got = await restyle({ ...d0, contents: { ...d0.contents, atoms } }, 'default', ACS_1996);
    expect(got).not.toBeNull();
    // (ACS Document 1996: a fixed bond length of 14.4 pt)
    expect(bondLen(got!.contents, got!.contents.atoms[0].id)).toBeCloseTo(14.4, 0);
  });

  it('colors, bond colors and the rest put on by hand stay too', async () => {
    const d0 = made('default');
    const atoms = d0.contents.atoms.map((a, i) => (i === 1 ? { ...a, color: '#ff0000' } : a));
    const bonds = d0.contents.bonds.map((b, i) => (i === 0 ? { ...b, color: '#00aa00' } : b));
    decoded = px;
    const got = await restyle({ ...d0, contents: { ...d0.contents, atoms, bonds } }, 'match', ACS_1996);
    expect(got).not.toBeNull();
    expect(got!.contents.atoms[1].color).toBe('#ff0000');
    expect(got!.contents.bonds[0].color).toBe('#00aa00');
  });

  it('what was put right by hand after Make Editable stays when the style is changed', async () => {
    const d0 = made('default');
    // an atom moved, a label added
    const atoms = d0.contents.atoms.map((a, i) => (i === 0 ? { ...a, x: a.x + 7, y: a.y - 3 } : a));
    const d = { ...d0, contents: { ...d0.contents, atoms } };
    decoded = px;
    const got = await restyle(d, 'match', ACS_1996);
    expect(got).not.toBeNull();
    // the atom moved by hand is still where it was put, to the others: all the structure is drawn at the other style's size
    const k = bondLen(got!.contents, atoms[0].id) / bondLen(d.contents, atoms[0].id);
    expect(got!.contents.atoms[0].x - got!.contents.atoms[1].x).toBeCloseTo(k * (atoms[0].x - atoms[1].x), 4);
    expect(got!.contents.atoms[0].y - got!.contents.atoms[1].y).toBeCloseTo(k * (atoms[0].y - atoms[1].y), 4);
    expect(got!.contents.atoms.length).toBe(atoms.length);
    expect(got!.contents.bonds.length).toBe(d.contents.bonds.length);
    expect(got!.fromPicture!.style).toBe('match');
    // (the picture and what was read are kept to go back to)
    expect(got!.fromPicture!.parts).toEqual(d.fromPicture!.parts);
  });
});
