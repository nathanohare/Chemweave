// Review > Compare: a text box only the original has is copied with the objects inside it, so its
// runs point at the copies rather than at unrelated objects of the revised document.

import { describe, it, expect } from 'vitest';
import { compareDocuments } from '../src/document/compare';
import { newDocument, OBJECT_CHAR, type DocText } from '../src/document/document';

const opts = { author: 'Reviewer', date: '2026-10-22T12:00:00Z' };
const float = { x: 0, y: 0, wrap: 'square' } as never;

describe('compare copies objects inside a text box', () => {
  it('remaps the text box runs to the copied objects', () => {
    const a: DocText = {
      ...newDocument(), runs: [{ text: 'Known' }, { text: OBJECT_CHAR, obj: 1 }, { text: '.' }], paras: [{}],
      objects: { 1: { kind: 'textbox', runs: [{ text: OBJECT_CHAR, obj: 2 }], w: 100, float }, 2: { kind: 'math', tex: 'a' } },
    };
    // The revised document uses id 2 for something unrelated.
    const b: DocText = { ...newDocument(), runs: [{ text: 'Known' }, { text: OBJECT_CHAR, obj: 2 }, { text: '.' }], paras: [{}], objects: { 2: { kind: 'math', tex: 'zzz' } } };
    const { doc: d } = compareDocuments(a, b, opts);
    const box = Object.values(d.objects).find((o) => o.kind === 'textbox');
    expect(box).toBeDefined();
    const inner = (box as { runs: { obj?: number }[] }).runs[0].obj!;
    expect(d.objects[inner]).toEqual({ kind: 'math', tex: 'a' });
  });
});
