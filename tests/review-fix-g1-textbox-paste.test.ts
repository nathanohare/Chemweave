// @vitest-environment jsdom
//
// A text box pasted from a copy brings the objects inside it (here a PAGE field) as its own
// copies, its text pointing at them, not at whatever has the copied ids in this document.

import { describe, it, expect } from 'vitest';
import { docMode } from './doc-mode-harness';
import { objectRun, type DocObject } from '../src/document/document';

describe('pasting a text box', () => {
  it('its field comes with it and its text points at the pasted field', async () => {
    const PIC = 'data:image/png;base64,iVBORw0KGgo=';
    // this document already has objects 1 and 2 (pictures)
    const { dm, f } = await docMode({
      runs: [{ text: 'A ' }, objectRun(1, {}), objectRun(2, {}), { text: ' B' }],
      paras: [{}],
      objects: { 1: { kind: 'picture', src: PIC, w: 10, h: 10 }, 2: { kind: 'picture', src: PIC, w: 10, h: 10 } },
    } as never);
    f.ed.setCaret(0);
    const copied: Record<number, DocObject> = {
      1: { kind: 'textbox', runs: [{ text: 'Page ' }, objectRun(2, {})], w: 100, float: { wrap: 'square', x: 0, y: 0 } } as DocObject,
      2: { kind: 'field', code: 'page' },
    };
    (dm as unknown as { pasteOwn(o: unknown): void }).pasteOwn({ text: '', runs: [objectRun(1, {})], paras: [{}], objects: copied, references: [], from: 'another document' });
    const boxes = Object.values(f.t.objects).filter((o): o is Extract<DocObject, { kind: 'textbox' }> => o.kind === 'textbox');
    expect(boxes.length).toBe(1);
    const inner = boxes[0].runs.filter((r) => r.obj !== undefined).map((r) => f.t.objects[r.obj!]);
    expect(inner).toEqual([{ kind: 'field', code: 'page' }]);
  }, 60000);
});
