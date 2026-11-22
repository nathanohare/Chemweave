// @vitest-environment jsdom
//
// What the undo audit (standing rule R7, scripts/undo-audit.mjs) found taking two steps or
// changing the file with none: fields compared whatever order they were set in (a caption's
// runs handed back by the text editor, a layout read back from Slide Master view), a step taken
// back as if never made (a text box Add Caption made, left empty), a header opened for typing and
// never typed into (Undo takes back the opening, Redo opens it again), and a section break (one
// step). Documents are built here in code.

import { describe, it, expect } from 'vitest';
import { Doc, sameData } from '../src/model';
import { DocFile } from '../src/document/doc-file';
import { newDocument, paraFromStyle, runStyleOf, type DocText } from '../src/document/document';
import { builtinLayout } from '../src/deck/deck';

describe('sameData', () => {
  it('does not mind the order fields were set in, or a field set to undefined', () => {
    expect(sameData([{ text: '1', bold: true }], [{ bold: true, text: '1' }])).toBe(true);
    expect(sameData({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    const def = builtinLayout('title');
    const { boxes, ...rest } = def;
    expect(sameData({ ...rest, titleLook: true, boxes }, def)).toBe(true);
  });
  it('tells different data apart', () => {
    expect(sameData([{ text: '1' }], [{ text: '2' }])).toBe(false);
    expect(sameData({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
    expect(sameData({ a: 1 }, { a: 1, b: 0 })).toBe(false);
    expect(sameData([], {})).toBe(false);
  });
});

describe('a step taken back as if never made (Doc.dropStep)', () => {
  it('goes with what it did, leaving nothing to redo', () => {
    const d = new Doc();
    d.edit('Atom', () => d.addAtom(0, 0));
    const c = d.edit('Add caption', () => d.addCaption({ x: 0, y: 20, runs: [], justify: 'left' }));
    let dropped = 0;
    d.onDrop = () => { dropped++; };
    expect(d.dropStep(d.topStep)).toBe(true);
    expect(d.captions.has(c.id)).toBe(false);
    expect(d.undoLabel).toBe('Atom');
    expect(d.canRedo()).toBe(false);
    expect(dropped).toBe(1);
  });
  it('is turned down for a step that is not the newest', () => {
    const d = new Doc();
    d.edit('Atom', () => d.addAtom(0, 0));
    const first = d.topStep;
    d.edit('Atom', () => d.addAtom(10, 0));
    expect(d.dropStep(first)).toBe(false);
    expect(d.atoms.size).toBe(2);
  });
});

function twoPages(): DocText {
  const d = newDocument();
  const s = d.styles.Normal;
  return { ...d, runs: [{ ...runStyleOf(s), text: 'page 1\npage 2' }], paras: [paraFromStyle(s, {}), { ...paraFromStyle(s, {}), pageBreak: true }], hf: { ...d.hf, header: ['Left', '', 'Right'] } };
}

describe('a header opened for typing and never typed into', () => {
  it('stopped for Undo, leaves the document as it was, with Redo bringing the opening back', () => {
    const f = new DocFile(twoPages());
    const before = f.t;
    f.editHf(0, 'header');
    expect(f.t).not.toBe(before);
    f.endBox(true);
    expect(f.t.hf).toEqual(before.hf);
    expect(f.ed.canRedo).toBe(true);
    f.ed.redo();
    expect(f.t.hf.bodies).toBeDefined();
  });
  it('closed any other way, leaves nothing to redo', () => {
    const f = new DocFile(twoPages());
    const before = f.t;
    f.editHf(0, 'header');
    f.endBox();
    expect(f.t.hf).toEqual(before.hf);
    expect(f.ed.canRedo).toBe(false);
  });
});
