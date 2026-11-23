// The Document's Picture Format tab (as Word's): Corrections, Color and Transparency presets and
// Crop to proportions or a shape, each one change to a picture's settings. The picture's own data
// is never changed (PictureFx says how it is shown), so Reset Picture takes everything off again.

import type { PictureFx, Recolor } from '../model';
import { tidyFx } from '../render/picture-fx';

/** Word's Corrections presets: −40 % to +40 % in steps of 20, and sharpen or soften 25 % and 50 %. */
export const BRIGHTNESS_STEPS = [-0.4, -0.2, 0, 0.2, 0.4];
export const CONTRAST_STEPS = [-0.4, -0.2, 0, 0.2, 0.4];
export const SHARPEN_STEPS = [-0.5, -0.25, 0, 0.25, 0.5];
/** Word's Transparency presets. */
export const TRANSPARENCY_STEPS = [0, 0.15, 0.3, 0.5, 0.65, 0.8, 0.95];
/** Color: Word's Recolor choices that need no color of one's own. */
export const RECOLOR_PRESETS: [string, Recolor | undefined][] = [
  ['No Recolor', undefined], ['Grayscale', { kind: 'grey' }], ['Sepia', { kind: 'sepia' }], ['Washout', { kind: 'washout' }], ['Black and White', { kind: 'bw' }],
];

/** A percentage as the menus show it, with a real minus sign: "−20%", "0%", "+40%". */
export function pct(v: number): string {
  const n = Math.round(v * 100);
  return n > 0 ? `+${n}%` : n < 0 ? `−${-n}%` : '0%';
}

/** The settings with some of them changed (undefined takes one off), tidied: undefined when nothing is left. */
export function withFx(fx: PictureFx | undefined, patch: Partial<PictureFx>): PictureFx | undefined {
  const next: PictureFx = { ...fx };
  for (const [k, v] of Object.entries(patch) as [keyof PictureFx, unknown][]) {
    if (v === undefined) delete next[k];
    else (next as Record<string, unknown>)[k] = v;
  }
  return tidyFx(next);
}

/** Proportions offered by Crop ▾ (width over height), as Word's Aspect Ratio list. */
export const CROP_ASPECTS: [string, number][] = [
  ['1:1', 1], ['2:3', 2 / 3], ['3:2', 3 / 2], ['3:4', 3 / 4], ['4:3', 4 / 3], ['4:5', 4 / 5], ['5:4', 5 / 4], ['9:16', 9 / 16], ['16:9', 16 / 9],
];
