// @vitest-environment jsdom
//
// Review batch 19, Format Picture:
//   F758: a crop to proportions chosen before the picture had loaded was dropped on Apply.
//   F759: Reset Picture left the Remove background tolerance where it was, so turning Remove
//         background on again used the old tolerance.

import { describe, expect, it, vi } from 'vitest';

let loaded!: (img: { naturalWidth: number; naturalHeight: number }) => void;
vi.mock('../src/render/images', () => ({
  loadImage: () => new Promise((r) => { loaded = r as typeof loaded; }),
}));

// (the picture's effects are drawn with a canvas, which jsdom lacks; what is drawn is not looked at here)
vi.mock('../src/render/picture-fx', async (orig) => ({ ...(await orig<typeof import('../src/render/picture-fx')>()), makeFxCanvas: (c: HTMLCanvasElement) => c }));

import { pictureFormat } from '../src/ui/picture-dialog';

(HTMLDialogElement.prototype as unknown as { showModal: () => void }).showModal = function (this: HTMLDialogElement) { this.open = true; };
(HTMLDialogElement.prototype as unknown as { close: () => void }).close = function (this: HTMLDialogElement) { this.open = false; };
// jsdom has no canvas: every drawing call does nothing
HTMLCanvasElement.prototype.getContext = (() => new Proxy({}, { get: () => () => undefined, set: () => true })) as never;

const tick = () => new Promise((r) => setTimeout(r, 0));
function open() {
  document.body.replaceChildren();
  const got = pictureFormat({ src: 'picture.png', w: 200, h: 100 });
  const d = document.querySelector<HTMLDialogElement>('dialog')!;
  const row = (label: string) => [...d.querySelectorAll<HTMLElement>('label.md-row, .md-row')].find((r) => r.textContent!.startsWith(label))!;
  const apply = () => d.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  const button = (label: string) => [...d.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === label)!;
  return { got, d, row, apply, button };
}

describe('F758: proportions picked before the picture loads', () => {
  it('are applied when the picture arrives', async () => {
    const { got, row, apply } = open();
    const ratio = row('Crop to proportions').querySelector('select')!;
    ratio.value = '1'; // Square (1:1)
    ratio.dispatchEvent(new Event('change', { bubbles: true }));
    // the picture (200 × 100 pixels) arrives now
    loaded({ naturalWidth: 200, naturalHeight: 100 });
    await tick();
    apply();
    const r = (await got)!;
    // the largest centred square of a 2:1 picture is half its width: a quarter cut from each side
    expect(r.crop!.l).toBeCloseTo(0.25, 6);
    expect(r.crop!.r).toBeCloseTo(0.25, 6);
    expect(r.crop!.t).toBe(0);
    expect(r.aspect).toBe(1);
  });
});

describe('F759: Reset Picture and the background tolerance', () => {
  it('uses the usual tolerance again after a reset', async () => {
    const { got, d, row, apply, button } = open();
    loaded({ naturalWidth: 200, naturalHeight: 100 });
    await tick();
    const on = row('Remove background').querySelector<HTMLInputElement>('input[type=checkbox]')!;
    const tolRange = row('How near counts').querySelector<HTMLInputElement>('input[type=range]')!;
    on.checked = true;
    on.dispatchEvent(new Event('change', { bubbles: true }));
    tolRange.value = '40';
    tolRange.dispatchEvent(new Event('input', { bubbles: true }));
    button('Reset Picture').click();
    expect(tolRange.value).toBe('12'); // the usual tolerance, 12%
    on.checked = true;
    on.dispatchEvent(new Event('change', { bubbles: true }));
    apply();
    const r = (await got)!;
    expect(r.fx?.bg?.tol).toBeUndefined(); // the usual one is left unwritten
    expect(d.isConnected).toBe(false);
  });
});
