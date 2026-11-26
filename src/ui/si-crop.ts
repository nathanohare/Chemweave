// Picture Format ▸ Crop on an SI figure: the whole picture (turned as it is shown) with the part
// kept in a frame. Drag a handle to cut a side or a corner, drag inside to move the frame, or type
// each side's cut; Crop to Proportions fits a frame of those proportions. Nothing changes until
// Crop; the picture saved is made again from the original, so a crop can be undone or changed later.

import { cleanCrop, cropRect, editSvg, NO_CROP, orientation, svgSize, type Crop, type PictureEdit } from '../si/picture-edit';
import { pictureDpi } from '../si/compile-doc';
import { PICTURE_MIME } from './si-picture';
import { ASPECTS, aspectCrop } from './picture-dialog';
import { addInfo } from './info-tip';

const PREVIEW_W = 480, PREVIEW_H = 340;
/** How near a handle a press takes it, in pixels. */
const GRAB = 9;

type Side = 'l' | 't' | 'r' | 'b';
type Grip = Side[] | 'move';

/** The crop chosen for `url` (the picture as it shows, `w` × `h` pixels); null when cancelled. */
export function askCrop(url: string, w: number, h: number, start: Crop): Promise<Crop | null> {
  return new Promise((resolve) => {
    let crop: Crop = { ...start };
    const d = document.createElement('dialog');
    d.className = 'master-dialog si-crop-dialog';
    const form = document.createElement('form');
    // (the sides are checked here, not by the browser: a dragged crop is any fraction of a percent)
    form.noValidate = true;
    d.append(form);
    const head = document.createElement('h2');
    head.textContent = 'Crop';
    addInfo(head, 'Drag the handles to cut the sides, or drag inside the frame to move it. SI Assistant shows pictures without Chemweave’s crop, so the cropped picture is saved as a copy beside the original (named “(edited)”) and the figure uses it; Reset Picture goes back to the original.');
    const canvas = document.createElement('canvas');
    canvas.className = 'si-crop-canvas';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'The picture, with the part kept framed: drag the handles to crop it');
    const k = Math.min(PREVIEW_W / w, PREVIEW_H / h, 4);
    const cw = Math.max(1, Math.round(w * k)), ch = Math.max(1, Math.round(h * k));
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    canvas.style.width = `${cw}px`;
    canvas.style.height = `${ch}px`;
    form.append(head, canvas);

    // each side's cut, in percent (typed: every value can be set by hand)
    const sides = document.createElement('div');
    sides.className = 'si-crop-sides';
    const boxes = {} as Record<Side, HTMLInputElement>;
    for (const [s, label] of [['l', 'Left'], ['t', 'Top'], ['r', 'Right'], ['b', 'Bottom']] as [Side, string][]) {
      const l = document.createElement('label');
      const n = document.createElement('input');
      n.type = 'number';
      n.min = '0';
      n.max = '99';
      n.step = 'any';
      n.className = 'md-num';
      n.addEventListener('change', () => {
        // (a side typed past the one across from it stops short of it, and the box says where it stopped)
        const opp = ({ l: 'r', r: 'l', t: 'b', b: 't' } as Record<Side, Side>)[s];
        const v = Math.max(0, Math.min(0.99 - crop[opp], (Number(n.value) || 0) / 100));
        crop = cleanCrop({ ...crop, [s]: v });
        n.value = String(Math.round(crop[s] * 1000) / 10);
        ratio.value = '';
        show();
      });
      boxes[s] = n;
      l.append(label, n, '%');
      sides.append(l);
    }
    const ratio = document.createElement('select');
    for (const [v, label] of ASPECTS) ratio.add(new Option(label, v));
    ratio.title = 'Crop to proportions (centered)';
    ratio.addEventListener('change', () => {
      if (!ratio.value) return;
      crop = ratio.value === 'own' ? { ...NO_CROP } : aspectCrop(w, h, Number(ratio.value));
      show();
    });
    const rl = document.createElement('label');
    rl.append('Proportions', ratio);
    sides.append(rl);
    form.append(sides);

    const buttons = document.createElement('p');
    buttons.className = 'ask-buttons bg-buttons';
    const btn = (text: string, title: string, f: () => void): HTMLButtonElement => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = text;
      b.title = title;
      b.addEventListener('click', f);
      return b;
    };
    const reset = btn('No Crop', 'The whole picture', () => { crop = { ...NO_CROP }; ratio.value = ''; show(); });
    const spacer = document.createElement('span');
    spacer.className = 'bg-spacer';
    const cancel = btn('Cancel', 'Close without changing anything', () => done(null));
    const ok = document.createElement('button');
    ok.type = 'submit';
    ok.className = 'primary';
    ok.textContent = 'Crop';
    buttons.append(reset, spacer, cancel, ok);
    form.append(buttons);

    const img = new Image();
    img.onload = () => show();
    img.src = url;

    const rect = (c: Crop) => ({ x: c.l * cw, y: c.t * ch, w: (1 - c.l - c.r) * cw, h: (1 - c.t - c.b) * ch });
    function show(): void {
      for (const s of ['l', 't', 'r', 'b'] as Side[]) if (document.activeElement !== boxes[s]) boxes[s].value = String(Math.round(crop[s] * 1000) / 10);
      const g = canvas.getContext('2d')!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, cw, ch);
      if (img.complete && img.naturalWidth) g.drawImage(img, 0, 0, cw, ch);
      const r = rect(crop);
      // (what is cut off, dimmed; the part kept framed, with its handles)
      g.fillStyle = 'rgba(0, 0, 0, 0.5)';
      g.beginPath();
      g.rect(0, 0, cw, ch);
      g.rect(r.x, r.y, r.w, r.h);
      g.fill('evenodd');
      g.strokeStyle = '#fff';
      g.lineWidth = 1;
      g.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
      g.fillStyle = '#111';
      for (const [hx, hy] of handles(r)) { g.fillRect(hx - 4, hy - 4, 8, 8); g.strokeRect(hx - 3.5, hy - 3.5, 7, 7); }
    }
    const handles = (r: ReturnType<typeof rect>): [number, number, Grip][] => {
      const mx = r.x + r.w / 2, my = r.y + r.h / 2, x2 = r.x + r.w, y2 = r.y + r.h;
      return [[r.x, r.y, ['l', 't']], [mx, r.y, ['t']], [x2, r.y, ['r', 't']], [x2, my, ['r']], [x2, y2, ['r', 'b']], [mx, y2, ['b']], [r.x, y2, ['l', 'b']], [r.x, my, ['l']]];
    };
    const at = (e: PointerEvent): [number, number] => { const b = canvas.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; };
    const gripAt = (x: number, y: number): Grip | null => {
      const r = rect(crop);
      for (const [hx, hy, g] of handles(r)) if (Math.abs(x - hx) <= GRAB && Math.abs(y - hy) <= GRAB) return g;
      return x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h ? 'move' : null;
    };
    const CURSORS: Record<string, string> = { lt: 'nwse-resize', rb: 'nwse-resize', rt: 'nesw-resize', lb: 'nesw-resize', l: 'ew-resize', r: 'ew-resize', t: 'ns-resize', b: 'ns-resize', move: 'move' };
    let drag: { grip: Grip; x: number; y: number; from: Crop } | null = null;
    canvas.addEventListener('pointerdown', (e) => {
      const [x, y] = at(e);
      const grip = gripAt(x, y);
      if (!grip) return;
      drag = { grip, x, y, from: { ...crop } };
      canvas.setPointerCapture(e.pointerId);
      ratio.value = '';
    });
    canvas.addEventListener('pointermove', (e) => {
      const [x, y] = at(e);
      if (!drag) { const g = gripAt(x, y); canvas.style.cursor = g ? CURSORS[g === 'move' ? 'move' : g.join('')] : ''; return; }
      const dx = (x - drag.x) / cw, dy = (y - drag.y) / ch, f = drag.from;
      if (drag.grip === 'move') {
        const mx = Math.max(-f.l, Math.min(f.r, dx)), my = Math.max(-f.t, Math.min(f.b, dy));
        crop = { l: f.l + mx, r: f.r - mx, t: f.t + my, b: f.b - my };
      } else {
        // (the side dragged stops short of the one across from it, which stays where it is)
        const next = { ...f };
        const across: Record<Side, Side> = { l: 'r', r: 'l', t: 'b', b: 't' };
        for (const s of drag.grip) next[s] = Math.max(0, Math.min(0.99 - f[across[s]], s === 'l' ? f.l + dx : s === 'r' ? f.r - dx : s === 't' ? f.t + dy : f.b - dy));
        crop = cleanCrop(next);
      }
      show();
    });
    const end = (): void => { drag = null; };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);

    let finished = false;
    const done = (v: Crop | null): void => {
      if (finished) return;
      finished = true;
      if (d.open) d.close();
      d.remove();
      resolve(v);
    };
    form.addEventListener('submit', (e) => { e.preventDefault(); done(cleanCrop(crop)); });
    d.addEventListener('close', () => done(null));
    document.body.append(d);
    d.showModal();
    show();
  });
}

/** What a picture's file is, for Crop and Rotate: an SVG drawing, a bitmap, or neither (a PDF). */
export function editableKind(rel: string): 'svg' | 'bitmap' | null {
  const ext = rel.slice(rel.lastIndexOf('.') + 1).toLowerCase();
  return ext === 'svg' ? 'svg' : ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'].includes(ext) ? 'bitmap' : null;
}

/** An SVG file's text, read in the encoding it says it is in, its declaration saying UTF-8 (as it is written back). */
function svgText(bytes: Uint8Array): string {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 200));
  const declared = /<\?xml[^>]*encoding\s*=\s*["']([^"']+)["']/i.exec(head)?.[1];
  const utf16 = (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff);
  let text: string;
  try { text = new TextDecoder(utf16 ? 'utf-16' : declared || 'utf-8').decode(bytes); } catch { text = new TextDecoder().decode(bytes); }
  return text.replace(/^(\uFEFF?<\?xml[^>]*encoding\s*=\s*)(["'])[^"']*\2/i, '$1$2UTF-8$2');
}

/** The original picture's size as it is drawn (a photo the way up its camera marked), or null when it can't be read. */
export async function sourceSize(rel: string, bytes: Uint8Array): Promise<{ w: number; h: number } | null> {
  const kind = editableKind(rel);
  if (kind === 'svg') return svgSize(svgText(bytes));
  if (kind !== 'bitmap') return null;
  const ext = rel.slice(rel.lastIndexOf('.') + 1).toLowerCase();
  try {
    const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: PICTURE_MIME[ext] ?? `image/${ext}` }), { imageOrientation: 'from-image' });
    const size = { w: bmp.width, h: bmp.height };
    bmp.close();
    return size.w > 0 && size.h > 0 ? size : null;
  } catch { return null; }
}

/**
 * The original picture rotated and cropped as `e` says: an SVG stays SVG; a photo stays JPEG
 * (other bitmaps become PNG), at the original's resolution so it prints at the same size. With
 * `maxSide`, a bitmap is made no bigger than that (a preview). Null when it can't be read.
 */
export async function renderEdited(rel: string, bytes: Uint8Array, e: PictureEdit, maxSide = 0): Promise<{ bytes: Uint8Array; svg: boolean; mime: string } | null> {
  const kind = editableKind(rel);
  if (kind === 'svg') {
    const got = editSvg(svgText(bytes), e);
    if (!got) return null;
    // (a picture that isn't well-formed after the change is not saved)
    if (typeof DOMParser !== 'undefined' && new DOMParser().parseFromString(got, 'image/svg+xml').getElementsByTagName('parsererror').length) return null;
    return { bytes: new TextEncoder().encode(got), svg: true, mime: 'image/svg+xml' };
  }
  if (kind !== 'bitmap') return null;
  const ext = rel.slice(rel.lastIndexOf('.') + 1).toLowerCase();
  const mime = PICTURE_MIME[ext] ?? `image/${ext}`;
  let bmp: ImageBitmap;
  // (a photo's own orientation, as a camera marks it, is the picture's way up, as everywhere else)
  try { bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: mime }), { imageOrientation: 'from-image' }); } catch { return null; }
  const o = orientation(bmp.width, bmp.height, e.rotate, e.flip);
  const r = cropRect(o.w, o.h, cleanCrop(e.crop));
  const x = Math.round(r.x), y = Math.round(r.y);
  const w = Math.max(1, Math.min(o.w - x, Math.round(r.w))), h = Math.max(1, Math.min(o.h - y, Math.round(r.h)));
  const k = maxSide > 0 ? Math.min(1, maxSide / Math.max(w, h)) : 1;
  // (one canvas the size of the part kept: the original drawn into it rotated and moved)
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(w * k));
  out.height = Math.max(1, Math.round(h * k));
  const g = out.getContext('2d');
  if (!g) { bmp.close(); return null; }
  const [a, b, c, d, tx, ty] = o.m;
  g.setTransform(a * k, b * k, c * k, d * k, (tx - x) * k, (ty - y) * k);
  g.drawImage(bmp, 0, 0);
  bmp.close();
  const jpeg = mime === 'image/jpeg' && !maxSide;
  const blob = await new Promise<Blob | null>((ok) => out.toBlob(ok, jpeg ? 'image/jpeg' : 'image/png', jpeg ? 0.95 : undefined));
  if (!blob) return null;
  const made = new Uint8Array(await blob.arrayBuffer());
  const dpi = maxSide ? null : pictureDpi(bytes, mime);
  if (!dpi) return { bytes: made, svg: false, mime: jpeg ? 'image/jpeg' : 'image/png' };
  if (jpeg) return { bytes: jfifWithDpi(made, dpi), svg: false, mime: 'image/jpeg' };
  const { pngWithDpi } = await import('../render/emf-read');
  return { bytes: pngWithDpi(made, dpi), svg: false, mime: 'image/png' };
}

/** A JPEG marked with its resolution in its JFIF header (as the original was), when it has one. */
export function jfifWithDpi(jpg: Uint8Array, dpi: number): Uint8Array {
  if (jpg.length < 18 || jpg[0] !== 0xff || jpg[1] !== 0xd8 || jpg[2] !== 0xff || jpg[3] !== 0xe0 || String.fromCharCode(jpg[6], jpg[7], jpg[8], jpg[9]) !== 'JFIF') return jpg;
  const out = jpg.slice();
  const v = Math.max(1, Math.min(65535, Math.round(dpi)));
  out[13] = 1;
  out[14] = v >> 8; out[15] = v & 0xff;
  out[16] = v >> 8; out[17] = v & 0xff;
  return out;
}
