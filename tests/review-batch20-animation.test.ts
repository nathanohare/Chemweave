// @vitest-environment jsdom
//
// Review batch 20, animation panes and Animate Reaction:
//  F148 changing a picked animation's effect keeps its trigger and by-paragraph setting;
//  F665 clearing the After box doesn't store a 0:00 advance time;
//  F666 the Animation Painter doesn't paint an object onto itself;
//  F667 the motion path markers work out what is picked once per redraw;
//  F663 Import Pairing is one Undo step;
//  F664 Animate Reaction doesn't say "Saved" when the file couldn't be written.
// The doc's own undo history and animation lists are the only things checked (no values from chemistry).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const files = vi.hoisted(() => ({
  openFileDialog: vi.fn(),
  saveFileDialog: vi.fn(),
  writeFile: vi.fn(),
  showError: vi.fn(async () => undefined),
}));
vi.mock('../src/io/files', async (orig) => ({ ...(await orig<typeof import('../src/io/files')>()), ...files }));
vi.mock('../src/morph/numbers', async (orig) => ({
  ...(await orig<typeof import('../src/morph/numbers')>()),
  readMapping: vi.fn(() => [{ pairs: [[1, 2]] }, { pairs: [[3, 4]] }, { pairs: [[5, 6]] }]),
  writeMapping: vi.fn(() => '{}'),
}));

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Doc } from '../src/model';
import { Deck } from '../src/deck/deck';
import { AnimationUI } from '../src/ui/animation-ui';
import { AnimateDialog } from '../src/ui/animate-dialog';
import { newAnim, slideParts, type Anim } from '../src/deck/animation';

const noSel = () => ({ atoms: new Set<number>(), bonds: new Set<number>(), captions: new Set<number>(), arrows: new Set<number>(), shapes: new Set<number>() });

describe('F148: changing a picked animation\'s effect', () => {
  const apply = (anims: Anim[], effect: 'wipe') => {
    let got: Anim[] = [];
    const fake = { picked: 0, anims: () => anims, hooks: { doc: () => new Doc(), selection: noSel, flash: () => undefined }, setAnims: (a: Anim[]) => { got = a; } };
    (AnimationUI.prototype as unknown as { applyEffect(e: string, x: boolean): void }).applyEffect.call(fake, effect, false);
    return got;
  };

  it('keeps the trigger (On Click of …)', () => {
    const a: Anim = { ...newAnim({ kind: 'shape', id: 1 }, 'fade'), trigger: { kind: 'shape', id: 9 } };
    const [got] = apply([a], 'wipe');
    expect(got.effect).toBe('wipe');
    expect(got.trigger).toEqual({ kind: 'shape', id: 9 });
  });

  it('keeps a text box animated a paragraph at a time, and does not give it to anything else', () => {
    const text: Anim = { ...newAnim({ kind: 'caption', id: 4 }, 'fade'), byPara: true };
    expect(apply([text], 'wipe')[0].byPara).toBe(true);
    const shape: Anim = { ...newAnim({ kind: 'shape', id: 4 }, 'fade'), byPara: true };
    expect(apply([shape], 'wipe')[0].byPara).toBeUndefined();
  });
});

describe('F665: the After box', () => {
  it('stores nothing, not 0 seconds, when it is emptied', () => {
    // the real ribbon of the app's page
    const page = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');
    document.body.innerHTML = /<body[^>]*>([\s\S]*)<\/body>/.exec(page)![1].replace(/<script[\s\S]*?<\/script>/g, '');
    const host = new Doc();
    const deck = Deck.blank(host);
    deck.attach();
    const noop = () => undefined;
    const ui = new AnimationUI(document.querySelector('#ribbon')!, document.querySelector('#anim-section')!, {
      deck: () => deck, doc: () => host, selection: noSel, select: noop, finishTyping: noop, flash: noop, repaint: noop, host: () => document.body, view: () => ({}) as never,
    } as never);
    void ui;
    deck.setTransition({ kind: 'fade', dur: 0.7 } as never);
    const on = document.querySelector<HTMLInputElement>('#tr-after-on')!, after = document.querySelector<HTMLInputElement>('#tr-after')!;
    on.checked = true;
    on.dispatchEvent(new Event('change'));
    expect(deck.current!.transition?.advanceAfter).toBe(5);
    after.value = '';
    after.dispatchEvent(new Event('change'));
    expect(deck.current!.transition?.advanceAfter).toBeUndefined();
    after.value = '7';
    after.dispatchEvent(new Event('change'));
    expect(deck.current!.transition?.advanceAfter).toBe(7);
  });
});

describe('F666: the Animation Painter', () => {
  it('does not paint the object the animations came from onto itself', () => {
    const doc = new Doc();
    const a = doc.edit('a', () => doc.addCaption({ x: 10, y: 10, runs: [{ text: 'A' }], justify: 'left' }));
    doc.edit('b', () => doc.addCaption({ x: 10, y: 80, runs: [{ text: 'B' }], justify: 'left' }));
    const from = slideParts(doc).find((p) => p.sel.captions.has(a.id))!;
    const own = newAnim({ kind: 'caption', id: a.id }, 'fade');
    const sel = noSel();
    sel.captions.add(a.id);
    const setAnims = vi.fn();
    const stopPainter = vi.fn();
    // (the painter's Part came from an earlier slideParts call; paint() makes its own)
    const fake = { painter: { anims: [own], from, sticky: false }, hooks: { doc: () => doc, selection: () => sel }, anims: () => [own], setAnims, stopPainter };
    const painted = (AnimationUI.prototype as unknown as { paint(): boolean }).paint.call(fake);
    expect(painted).toBe(false);
    expect(setAnims).not.toHaveBeenCalled();
    expect(stopPainter).not.toHaveBeenCalled();
  });

  it('still paints another object', () => {
    const doc = new Doc();
    const a = doc.edit('a', () => doc.addCaption({ x: 10, y: 10, runs: [{ text: 'A' }], justify: 'left' }));
    const b = doc.edit('b', () => doc.addCaption({ x: 10, y: 80, runs: [{ text: 'B' }], justify: 'left' }));
    const from = slideParts(doc).find((p) => p.sel.captions.has(a.id))!;
    const own = newAnim({ kind: 'caption', id: a.id }, 'fade');
    const sel = noSel();
    sel.captions.add(b.id);
    const setAnims = vi.fn();
    const fake = { painter: { anims: [own], from, sticky: true }, hooks: { doc: () => doc, selection: () => sel }, anims: () => [own], setAnims, stopPainter: vi.fn() };
    expect((AnimationUI.prototype as unknown as { paint(): boolean }).paint.call(fake)).toBe(true);
    const list = setAnims.mock.calls[0][0] as Anim[];
    expect(list.filter((x) => x.target.id === b.id)).toHaveLength(1);
  });
});

describe('F667: motion path markers', () => {
  it('work out which animations are picked once for the whole redraw', () => {
    const doc = new Doc();
    const shapes = [1, 2, 3].map((n) => doc.edit('s', () => doc.addShape({ kind: 'rect', x: n * 50, y: 10, w: 30, h: 30 } as never)));
    const anims: Anim[] = shapes.map((s) => ({ ...newAnim({ kind: 'shape', id: s.id }, 'path'), pathKind: 'down', path: 'M 0 0 L 0 0.1 E' }));
    const current = vi.fn(() => [1]);
    const ctx = new Proxy({}, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 10 }) : () => undefined), set: () => true }) as unknown as CanvasRenderingContext2D;
    const fake = { showsMarkers: true, anims: () => anims, current, hooks: { doc: () => doc, deck: () => null, selection: noSel } };
    (AnimationUI.prototype as unknown as { drawMarkers(c: CanvasRenderingContext2D, s: number): void }).drawMarkers.call(fake, ctx, 1);
    expect(current).toHaveBeenCalledTimes(1);
  });
});

/** A document with three arrows, and the host's way of setting a pairing (one Undo step each, as the app's). */
function dialogOn(doc: Doc, arrows: number[]) {
  const said: [string, boolean][] = [];
  const fake = {
    hooks: {
      doc: () => doc, name: () => 'scheme.cdxml',
      setMorph: (arrow: number, m: unknown) => doc.edit('Animation Pairing', () => doc.updateArrow(arrow, { morph: m as never })),
    },
    plan: { arrows }, steps: arrows.map(() => ({})), morphs: [] as unknown[],
    rebuild: () => undefined,
    say: (t: string, bad = false) => { said.push([t, bad]); },
    write: (AnimateDialog.prototype as unknown as { write: unknown }).write,
  };
  return { fake, said };
}
const arrowAt = (doc: Doc, y: number) => doc.edit('arrow', () => doc.addArrow({
  headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'solid', noGo: false, equilibrium: false, sweep: 0, headLength: 6, headWidth: 1.5,
  tail: { x: 0, y }, head: { x: 80, y },
})).id;

describe('F663: Import Pairing', () => {
  beforeEach(() => { files.openFileDialog.mockResolvedValue({ name: 'p.mapping.json', text: '{}' }); });

  it('is one Undo step for every arrow', async () => {
    const doc = new Doc();
    const arrows = [arrowAt(doc, 0), arrowAt(doc, 50), arrowAt(doc, 100)];
    const { fake } = dialogOn(doc, arrows);
    await (AnimateDialog.prototype as unknown as { importMapping(): Promise<void> }).importMapping.call(fake);
    expect(arrows.map((a) => doc.arrows.get(a)!.morph)).toEqual([{ pairs: [[1, 2]] }, { pairs: [[3, 4]] }, { pairs: [[5, 6]] }]);
    doc.undo();
    expect(arrows.map((a) => doc.arrows.get(a)!.morph)).toEqual([undefined, undefined, undefined]);
  });
});

describe('F664: saving from Animate Reaction', () => {
  beforeEach(() => { files.saveFileDialog.mockResolvedValue({ name: 'p.mapping.json', ref: { kind: 'handle' } }); files.showError.mockClear(); });

  it('says it saved when the file was written', async () => {
    files.writeFile.mockResolvedValue(undefined);
    const { fake, said } = dialogOn(new Doc(), []);
    await (AnimateDialog.prototype as unknown as { exportMapping(): Promise<void> }).exportMapping.call(fake);
    expect(said).toEqual([['Saved p.mapping.json.', false]]);
  });

  it('does not, and says so, when writing the file failed', async () => {
    files.writeFile.mockRejectedValue(new Error('disk full'));
    const { fake, said } = dialogOn(new Doc(), []);
    await (AnimateDialog.prototype as unknown as { exportMapping(): Promise<void> }).exportMapping.call(fake);
    expect(files.showError).toHaveBeenCalled();
    expect(said.some(([t]) => t.startsWith('Saved'))).toBe(false);
    expect(said[said.length - 1]).toEqual(['p.mapping.json was not saved.', true]);
  });
});
