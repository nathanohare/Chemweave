// @vitest-environment jsdom
//
// Code review batch 10 (document engine): typing into a shape's text and into a header of a
// protected document.

import { describe, it, expect } from 'vitest';
import { DocFile } from '../src/document/doc-file';
import { newDocument, objectRun, type DocText } from '../src/document/document';
import { markComment } from '../src/document/comments';

describe('editing a shape\'s text (F082)', () => {
  it('lays the typing out in the middle of the shape, where its text is drawn', () => {
    const t = newDocument();
    const shape = { kind: 'textbox', geo: 'rect', runs: [{ text: 'Word' }], w: 120, h: 120, float: { wrap: 'front', x: 50, y: 50 } } as never;
    const f = new DocFile({ ...t, runs: [{ text: 'Text ' }, objectRun(1, {})], paras: [{}], objects: { 1: shape } } as DocText);
    const lay = f.layout();
    const at = lay.objects.find((o) => o.id === 1)!;
    const drawn = lay.boxes.get(1)!;
    const textH = drawn.box.y2 - drawn.box.y1;
    expect(at.h).toBeGreaterThan(3 * textH);
    const ed = f.editBox(1)!;
    const typed = ed.layout();
    // a shape's text sits in its middle (as the painter and PowerPoint put it), not at its top
    expect(typed.box.y1).toBeCloseTo(at.y + (at.h - textH) / 2, 3);
    expect(typed.lines[0].y - typed.box.y1).toBeCloseTo(drawn.lines[0].y - drawn.box.y1, 6);
  });
});

describe('a plain header in a protected document (F083)', () => {
  it('opens nothing and leaves the last step of Undo alone when the protection refuses it', () => {
    const t: DocText = { ...newDocument(), runs: [{ text: 'Some text.' }], paras: [{}] };
    t.hf = { ...t.hf, header: ['Left', '', 'Right'] };
    const f = new DocFile({ ...t, protect: { edit: 'comments' } });
    // the last step of Undo: a comment added (what such a document allows)
    f.ed.update({ ...f.t, runs: markComment(f.t.runs, 0, 4, 1), comments: { 1: { author: 'A. Reviewer', date: '2026-11-27T10:00:00Z', text: 'Which text?' } } }, 'New Comment');
    expect(f.t.comments?.[1]).toBeDefined();
    const before = f.t;
    expect(f.editHf(0, 'header')).toBeNull();
    expect(f.t).toBe(before);
    f.endBox();
    // Undo still takes the comment back
    f.ed.undo();
    expect(f.t.comments?.[1]).toBeUndefined();
  });
});
