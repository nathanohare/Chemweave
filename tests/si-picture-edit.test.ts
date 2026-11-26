// Picture Format ▸ Crop and Rotate on SI figures: the edit kept with the figure, turns that keep
// the same part cropped, and an SVG picture turned and cropped as SVG.
import { describe, expect, it } from 'vitest';
import { cleanCrop, editRecord, editSvg, editedName, isPlain, orientation, pictureEditOf, turned, type PictureEdit } from '../src/si/picture-edit';

const plain: PictureEdit = { original: 'images/a.png', rotate: 0, flip: false, crop: { l: 0, t: 0, r: 0, b: 0 } };
const apply = (m: number[], x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

describe('turning', () => {
  it('maps the corners where a turn or a flip puts them', () => {
    // a 4 × 2 picture turned right: 2 wide, 4 tall; its top left corner goes to the top right
    const r = orientation(4, 2, 1, false);
    expect([r.w, r.h]).toEqual([2, 4]);
    expect(apply(r.m, 0, 0)).toEqual([2, 0]);
    expect(apply(r.m, 4, 2)).toEqual([0, 4]);
    const f = orientation(4, 2, 0, true);
    expect(apply(f.m, 0, 0)).toEqual([4, 0]);
    const half = orientation(4, 2, 2, false);
    expect(apply(half.m, 0, 0)).toEqual([4, 2]);
  });

  it('four turns, or two flips, are the original again, crop and all', () => {
    const e = { ...plain, crop: { l: 0.1, t: 0.2, r: 0.3, b: 0 } };
    let x = e;
    for (let i = 0; i < 4; i++) x = turned(x, 'right');
    expect(x).toEqual(e);
    expect(turned(turned(e, 'right'), 'left')).toEqual(e);
    expect(turned(turned(e, 'flipH'), 'flipH')).toEqual(e);
    expect(turned(turned(e, 'flipV'), 'flipV')).toEqual(e);
  });

  it('a turn as shown is the same as the original turned and flipped as recorded', () => {
    // the shown picture's corners, after each kind of turn, match orientation() of the record
    const w = 4, h = 2;
    const shown = (e: PictureEdit, x: number, y: number) => apply(orientation(w, h, e.rotate, e.flip).m, x, y);
    for (const start of [plain, { ...plain, rotate: 1 as const }, { ...plain, flip: true }, { ...plain, rotate: 3 as const, flip: true }]) {
      const o = orientation(w, h, start.rotate, start.flip);
      const right = turned(start, 'right');
      const [px, py] = shown(start, 0, 0);
      // turning the shown picture right moves (px, py) to (H - py, px)
      expect(shown(right, 0, 0)).toEqual([o.h - py, px]);
      const fh = turned(start, 'flipH');
      expect(shown(fh, 0, 0)).toEqual([o.w - px, py]);
      const fv = turned(start, 'flipV');
      expect(shown(fv, 0, 0)).toEqual([px, o.h - py]);
    }
  });

  it('the crop keeps the same part through a turn', () => {
    // 10% off the left, turned right: 10% off the top
    expect(turned({ ...plain, crop: { l: 0.1, t: 0, r: 0, b: 0 } }, 'right').crop).toEqual({ l: 0, t: 0.1, r: 0, b: 0 });
    expect(turned({ ...plain, crop: { l: 0.1, t: 0, r: 0, b: 0 } }, 'flipH').crop).toEqual({ l: 0, t: 0, r: 0.1, b: 0 });
  });
});

describe('the record', () => {
  it('reads safely, keeps only what differs, and never crops everything away', () => {
    expect(pictureEditOf({ file: 'x.png' })).toBeNull();
    expect(pictureEditOf({ chemweave_picture: { original: 'images/a.png', rotate: 5, crop: { l: 'x', r: 0.2 } } })).toEqual({ original: 'images/a.png', rotate: 1, flip: false, crop: { l: 0, t: 0, r: 0.2, b: 0 } });
    expect(editRecord(plain)).toEqual({ original: 'images/a.png' });
    expect(isPlain(plain)).toBe(true);
    const c = cleanCrop({ l: 0.8, t: 0, r: 0.8, b: 0 });
    expect(c.l + c.r).toBeLessThanOrEqual(0.99);
    expect(editedName('images/TLC plate.jpg', false)).toBe('TLC plate (edited).png');
  });
});

describe('an SVG picture', () => {
  const svg = '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="40pt" height="20pt" viewBox="10 5 40 20"><rect x="10" y="5" width="40" height="20"/></svg>';
  it('turned right: half as wide, the drawing in a turned group, the size in the same units', () => {
    const got = editSvg(svg, { ...plain, rotate: 1 })!;
    expect(got).toContain('width="20pt"');
    expect(got).toContain('height="40pt"');
    expect(got).toContain('viewBox="0 0 20 40"');
    // the original's top left (10, 5) goes to the turned picture's top right (20, 0)
    const m = /matrix\(([^)]*)\)/.exec(got)![1].split(' ').map(Number);
    expect(apply(m, 10, 5)).toEqual([20, 0]);
    expect(got.startsWith('<?xml')).toBe(true);
    expect(got.endsWith('</g></svg>')).toBe(true);
  });
  it('cropped: the view box is the part kept, and the size follows', () => {
    const got = editSvg(svg, { ...plain, crop: { l: 0.25, t: 0, r: 0.25, b: 0.5 } })!;
    expect(got).toContain('viewBox="10 0 20 10"');
    expect(got).toContain('width="20pt"');
    expect(got).toContain('height="10pt"');
  });
  it('a picture whose size can’t be read is left as it is', () => {
    expect(editSvg('<svg xmlns="http://www.w3.org/2000/svg"><g/></svg>', plain)).toBeNull();
    expect(editSvg('not a picture', plain)).toBeNull();
  });
});

describe('in a project', () => {
  it('finds a figure’s text, saves its entry, and writes the edited copy over its own only', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const { join, relative } = await import('node:path');
    const { MemoryFolder } = await import('../src/si/folder');
    const { SiProject } = await import('../src/si/project');
    const root = join(__dirname, 'fixtures', 'si-example');
    const f = new MemoryFolder('si-example');
    const walk = (d: string): void => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (n !== 'README.md') f.files.set(relative(root, p).split('\\').join('/'), new Uint8Array(readFileSync(p))); } };
    walk(root);
    const p = await SiProject.open(f);
    const s = p.sections.find((x) => x.type !== 'data' && x.type !== 'spectra')!;
    const id = await p.addTextFigure(s, new Uint8Array([1, 2, 3]), 'png', { stem: 'photo' });
    const got = await p.figureOwnerOf(id);
    expect(got?.owner).toBe(s);
    expect(got?.entry.file).toBe('images/photo.png');
    const rel = await p.writeEditedPicture(s.folder, editedName('images/photo.png', false), new Uint8Array([4]), 'images/photo.png');
    expect(rel).toBe('images/photo (edited).png');
    // (made again: written over its own copy)
    expect(await p.writeEditedPicture(s.folder, editedName('images/photo.png', false), new Uint8Array([5]), rel)).toBe(rel);
    // (another figure of the same picture: a name of its own, the first copy left alone)
    expect(await p.writeEditedPicture(s.folder, editedName('images/photo.png', false), new Uint8Array([6]), 'images/photo.png')).toBe('images/photo (edited) (2).png');
    expect([...(f.files.get(`${s.folder}/images/photo (edited).png`) ?? [])]).toEqual([5]);
    await p.setFigureEntry(s, id, { ...got!.entry, file: rel, chemweave_picture: editRecord({ ...plain, original: 'images/photo.png', rotate: 2 }) });
    const again = await SiProject.open(f);
    expect(pictureEditOf((await again.figureOwnerOf(id))!.entry)?.rotate).toBe(2);
  });
});
