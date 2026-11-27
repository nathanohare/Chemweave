// @vitest-environment jsdom
//
// Code review batch 14 (small things): F675, F710, F726, F727.
//   F675: the Animate Steps offer was kept when only the selected atoms or captions, or what an
//         animation is of, changed.
//   F710: undoing a fade also showed the hidden atoms of the same molecule.
//   F726: a drawing that could not be made (engine not ready) was remembered for the session.
//   F727: a multi-digit charge in a formula was shown as a subscript.
// Formula and charge notation: IUPAC, Nomenclature of Inorganic Chemistry (Red Book, 2005), which
// writes a charge as a superscript number then the sign, [Cu(NH3)4]2+ being the
// tetraamminecopper(II) ion, and ammonium as NH4+ (the 4 a count of hydrogens, the charge 1+).

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Doc } from '../src/model';

vi.mock('../src/deck/auto-steps', async (orig) => ({ ...(await orig<typeof import('../src/deck/auto-steps')>()), stepPieces: () => null }));
import { BuildHint, type BuildHintHooks } from '../src/ui/build-hint';
import { pickAtoms } from '../src/ui/geom-view-dialog';
import { formulaHtml, LabelTooltip } from '../src/ui/label-tooltip';

afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });

describe('F675: the Animate Steps offer follows the atoms, captions and animations in scope', () => {
  const setup = () => {
    let scope = { arrows: new Set([5]), shapes: new Set<number>(), atoms: new Set<number>(), captions: new Set<number>() };
    let anims: { target: { kind: string; id: number } }[] = [];
    const measure = vi.fn(() => ({}));
    const hooks = {
      onSlide: () => true, doc: () => ({ version: 1 }) as unknown as Doc, measure: measure as unknown as BuildHintHooks['measure'],
      scope: () => ({ scope, smart: false }), anims: () => anims as never,
      screenRect: (r: never) => r, area: () => ({ x1: 0, y1: 0, x2: 100, y2: 100 }), run: vi.fn(),
    } satisfies BuildHintHooks;
    const hint = new BuildHint(hooks);
    return { hint, measure, setScope: (s: Partial<typeof scope>) => { scope = { ...scope, ...s }; }, setAnims: (a: typeof anims) => { anims = a; } };
  };

  it('works the offer out again when atoms are added to the selection with the same arrows', () => {
    const t = setup();
    t.hint.refresh();
    expect(t.measure).toHaveBeenCalledTimes(1);
    t.hint.refresh();
    expect(t.measure).toHaveBeenCalledTimes(1); // nothing changed
    t.setScope({ atoms: new Set([1, 2]) });
    t.hint.refresh();
    expect(t.measure).toHaveBeenCalledTimes(2);
  });

  it('works it out again when a caption is added', () => {
    const t = setup();
    t.hint.refresh();
    t.setScope({ captions: new Set([9]) });
    t.hint.refresh();
    expect(t.measure).toHaveBeenCalledTimes(2);
  });

  it('works it out again when an animation is of something else (same number of them)', () => {
    const t = setup();
    t.setAnims([{ target: { kind: 'arrow', id: 1 } }]);
    t.hint.refresh();
    t.setAnims([{ target: { kind: 'arrow', id: 2 } }]);
    t.hint.refresh();
    expect(t.measure).toHaveBeenCalledTimes(2);
  });
});

describe('F710: undoing a fade keeps the hidden atoms hidden', () => {
  it('a click on a faded atom with Its Whole Molecule only takes the fade back', () => {
    // atoms 0-3 are one molecule; atom 1 is hidden, atoms 2 and 3 are faded
    const r = pickAtoms({ hidden: [1], faded: [2, 3] }, 'fade', 2, [0, 1, 2, 3]);
    expect(r.hidden).toEqual([1]);
    expect(r.faded).toEqual([]);
  });

  it('a click on a hidden atom with the Hide tool shows it again, and leaves the faded ones faded', () => {
    const r = pickAtoms({ hidden: [1, 4], faded: [2] }, 'hide', 1, [1]);
    expect(r.hidden).toEqual([4]);
    expect(r.faded).toEqual([2]);
  });

  it('fading a shown atom fades its molecule, and Show brings back all of it', () => {
    const faded = pickAtoms({ hidden: [], faded: [] }, 'fade', 0, [0, 1]);
    expect([...faded.faded].sort()).toEqual([0, 1]);
    const shown = pickAtoms({ hidden: [1], faded: [0] }, 'show', 0, [0, 1]);
    expect(shown).toEqual({ hidden: [], faded: [] });
  });
});

describe('F726: a drawing that could not be made is tried again', () => {
  it('asks again the next time the pointer rests on the label', async () => {
    vi.useFakeTimers();
    const canvas = document.createElement('canvas');
    canvas.toDataURL = () => 'data:image/png;base64,AA==';
    const draw = vi.fn().mockResolvedValueOnce(null).mockResolvedValue(canvas);
    const tip = new LabelTooltip(draw);
    const target = { label: 'OTBS', ext: [1], x: 10, y: 10 };
    tip.over(target);
    await vi.advanceTimersByTimeAsync(600);
    expect(draw).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.label-tip img')).toBeNull();
    tip.hide();
    tip.over(target);
    await vi.advanceTimersByTimeAsync(600);
    expect(draw).toHaveBeenCalledTimes(2);
    expect(document.querySelector('.label-tip img')).not.toBeNull();
  });

  it('keeps a drawing that was made', async () => {
    vi.useFakeTimers();
    const canvas = document.createElement('canvas');
    canvas.toDataURL = () => 'data:image/png;base64,AA==';
    const draw = vi.fn().mockResolvedValue(canvas);
    const tip = new LabelTooltip(draw);
    const target = { label: 'OTBS', ext: [1], x: 10, y: 10 };
    tip.over(target);
    await vi.advanceTimersByTimeAsync(600);
    tip.hide();
    tip.over(target);
    await vi.advanceTimersByTimeAsync(600);
    expect(draw).toHaveBeenCalledTimes(1);
  });
});

describe('F727: a charge of more than one is a superscript, not a subscript', () => {
  it('writes [Cu(NH3)4]2+ with the 2+ raised and the counts lowered', () => {
    expect(formulaHtml('[Cu(NH3)4]2+')).toBe('[Cu(NH<sub>3</sub>)<sub>4</sub>]<sup>2+</sup>');
  });
  it('writes a charge after a space raised', () => {
    expect(formulaHtml('C4H12N2 2+')).toBe('C<sub>4</sub>H<sub>12</sub>N<sub>2</sub><sup>2+</sup>');
  });
  it('writes the charge of a bare metal ion raised: Ca2+, Fe3+', () => {
    expect(formulaHtml('Ca2+')).toBe('Ca<sup>2+</sup>');
    expect(formulaHtml('Fe3+')).toBe('Fe<sup>3+</sup>');
  });
  it('keeps a count that is a count: O2 with a charge, N2', () => {
    expect(formulaHtml('O2−')).toBe('O<sub>2</sub><sup>−</sup>');
    expect(formulaHtml('N2')).toBe('N<sub>2</sub>');
  });
  it('keeps a single charge and plain counts as before', () => {
    expect(formulaHtml('NH4+')).toBe('NH<sub>4</sub><sup>+</sup>');
    expect(formulaHtml('C2H6O')).toBe('C<sub>2</sub>H<sub>6</sub>O');
    expect(formulaHtml('Cl−')).toBe('Cl<sup>−</sup>');
  });
});
