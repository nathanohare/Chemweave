// @vitest-environment jsdom
// Commands that cannot run are greyed with the reason in the tooltip (style guide S15, S85;
// retrospective audit G5-28; review of F5, R03 and R08: behavior, not source text).
import { describe, it, expect } from 'vitest';
import { paintCanRun, clearCanRun, cantRun } from '../src/ui/can-run';
import { whyNot, NEEDS, WHY, type Picked } from '../src/editor/can-run';
import { dataTableRef } from '../src/sheet/what-if';

const button = (cmd: string, title?: string) => {
  const b = document.createElement('button');
  b.dataset.cmd = cmd;
  if (title) b.title = title;
  document.body.append(b);
  return b;
};

describe('paintCanRun', () => {
  it('greys a command that cannot run, the reason before its own tip, and gives it back after', () => {
    const b = button('scale', 'Scale the selection');
    let reason: string | null = 'Select something to scale.';
    paintCanRun([b], 'cmd', () => reason);
    expect(b.getAttribute('aria-disabled')).toBe('true');
    expect(b.disabled).toBe(false); // still takes focus, so the arrow keys reach it and its reason is read
    expect(cantRun(b)).toBe(true);
    expect(b.title).toBe('Select something to scale.\n\nScale the selection');
    paintCanRun([b], 'cmd', () => reason); // twice does not stack the reason
    expect(b.title).toBe('Select something to scale.\n\nScale the selection');
    reason = null;
    paintCanRun([b], 'cmd', () => reason);
    expect(b.hasAttribute('aria-disabled')).toBe(false);
    expect(cantRun(b)).toBe(false);
    expect(b.title).toBe('Scale the selection');
  });
  it('leaves alone commands without a check and items greyed for other reasons', () => {
    const undo = button('undo');
    undo.disabled = true;
    paintCanRun([undo], 'cmd', () => null);
    expect(undo.disabled).toBe(true);
    const other = button('bold');
    paintCanRun([other], 'cmd', () => undefined);
    expect(other.disabled).toBe(false);
  });
  it('a button without a tip gets the reason alone, and clearCanRun gives back every greyed one', () => {
    const b = button('turn-3d');
    paintCanRun([b], 'cmd', () => 'Select a structure to rotate in 3-D.');
    expect(b.title).toBe('Select a structure to rotate in 3-D.');
    b.focus();
    expect(document.activeElement).toBe(b);
    clearCanRun(document.body);
    expect(b.hasAttribute('aria-disabled')).toBe(false);
    expect(b.hasAttribute('title')).toBe(false);
  });
});

const nothing: Picked = { any: false, count: 0, atoms: 0, bonds: 0, captions: 0, arrows: 0, structure: false, curved: false, geo: false, pictures: 0, plainPictures: 0, brackets: false, orbitals: false, empty: true, drawnAtoms: 0, drawnArrows: 0 };
const plenty: Picked = { any: true, count: 12, atoms: 6, bonds: 4, captions: 1, arrows: 2, structure: true, curved: true, geo: true, pictures: 1, plainPictures: 1, brackets: true, orbitals: true, empty: false, drawnAtoms: 30, drawnArrows: 2 };

describe('the drawing checks (G5-28, R03)', () => {
  it('on an empty drawing every listed command gives its reason, and with enough picked none does', () => {
    const cmds = Object.keys(NEEDS);
    expect(cmds.length).toBeGreaterThan(80);
    for (const c of cmds) {
      expect(whyNot(c, nothing), c).toBe(WHY[NEEDS[c][1]]);
      expect(whyNot(c, plenty), c).toBeNull();
    }
  });
  it('covers the commands the review found still toasting on an empty canvas', () => {
    for (const c of ['expand-label', 'group', 'ungroup', 'flip-h', 'flip-v', 'shape-front', 'shape-back', 'add-frame', 'rotate-cw', 'align-left', 'distribute-h', 'join', 'cut', 'zoom-selection', 'turn-3d', 'scale']) {
      expect(typeof whyNot(c, nothing), c).toBe('string');
    }
  });
  it('counts what each command needs', () => {
    const one = { ...plenty, count: 1, atoms: 1, bonds: 0 };
    expect(whyNot('align-left', one)).toBe(WHY.align);
    expect(whyNot('align-left', { ...one, count: 2 })).toBeNull();
    expect(whyNot('distribute-h', { ...one, count: 2 })).toBe(WHY.distribute);
    expect(whyNot('distribute-h-focal', { ...one, count: 2 })).toBe(WHY.distributeFocal);
    expect(whyNot('join', one)).toBe(WHY.join);
    expect(whyNot('crop', { ...plenty, pictures: 2 })).toBe(WHY.cropOne);
    // Copy and Arrange work on the whole drawing when nothing is selected
    expect(whyNot('copy', { ...nothing, empty: false })).toBeNull();
    expect(whyNot('arrange-grid', { ...nothing, empty: false })).toBeNull();
    expect(whyNot('arrange-grid', { ...plenty, count: 1 })).toBe(WHY.grid);
    // a command with no check here
    expect(whyNot('bold', nothing)).toBeUndefined();
  });
  it('keeps each reason once: every reason in the table is used, and none says turn for rotate (S26)', () => {
    const used = new Set(Object.values(NEEDS).map((n) => n[1]));
    for (const k of Object.keys(WHY)) expect(used.has(k as keyof typeof WHY), k).toBe(true);
    for (const t of Object.values(WHY)) expect(t).not.toMatch(/\bturn(ed|s)?\b/i);
  });
  it('a data table needs more than one cell', () => {
    expect(typeof dataTableRef({ r1: 0, c1: 0, r2: 0, c2: 0 })).toBe('string');
    expect(dataTableRef({ r1: 0, c1: 0, r2: 1, c2: 1 })).toEqual({ r1: 1, c1: 1, r2: 1, c2: 1 });
  });
});
