// @vitest-environment jsdom
// Code review batch 07 (Document mode: Insert and References dialogs).
//  - F068: Insert > Quick Parts > Field > Time, left as offered, is a time (it was given the date
//    format the box started with, so it showed today's date).
//  - F458: Cross-reference lists a caption with its own number even when a picture comes first
//    in its paragraph.
import { describe, expect, it, vi } from 'vitest';

type Field = { name: string; value?: string; options?: { value: string; label: string }[] };
const asked: { title: string; fields: Field[] }[] = [];
let answers: Record<string, string> = {};
vi.mock('../src/ui/ask', () => ({
  // the dialog as left alone: every box as it was offered, but for what the test types
  ask: vi.fn(async (title: string, fields: Field[]) => { asked.push({ title, fields }); return { ...Object.fromEntries(fields.map((f) => [f.name, f.value ?? ''])), ...answers }; }),
}));

import { DocInsertUI, captionLine, type DocInsertHost } from '../src/ui/doc-insert-ui';
import { DocFile } from '../src/document/doc-file';
import { OBJECT_CHAR, newDocument, objectRun, type DocObject, type DocText } from '../src/document/document';
import { defaultPicture } from '../src/document/fields';

function setup(t: Partial<DocText> = {}) {
  const f = new DocFile({ ...newDocument(), ...t } as DocText);
  const inserted: DocObject[] = [];
  const host = {
    file: () => f, ed: () => f.ed, insertObject: (o: DocObject) => { inserted.push(o); return 1; }, stopBox: () => {}, flash: () => {}, focus: () => {},
    quickParts: () => [], setQuickParts: () => {}, author: () => 'A',
  } as unknown as DocInsertHost;
  return { f, inserted, ui: new DocInsertUI(host) };
}

describe('Field dialog (F068)', () => {
  it('a Time field left as offered has no date format, so it shows the time', async () => {
    answers = { code: 'time' };
    const { ui, inserted } = setup();
    await ui.field();
    expect(inserted).toEqual([{ kind: 'field', code: 'time' }]);
    // (and a field with no format of its own takes Word's own for it)
    expect(defaultPicture('time')).toBe('h:mm am/pm');
  });

  it('a format typed is kept', async () => {
    answers = { code: 'date', format: 'd MMMM yyyy' };
    const { ui, inserted } = setup();
    await ui.field();
    expect(inserted).toEqual([{ kind: 'field', code: 'date', format: 'd MMMM yyyy' }]);
  });
});

describe('Cross-reference list (F458)', () => {
  it('replaces each object character by what that object shows, nothing for one that shows nothing', () => {
    // a picture, then "Figure ", the caption's number (object 2) and its words
    const text = `${OBJECT_CHAR}Figure ${OBJECT_CHAR}. A scheme`;
    const shownAt = (o: number) => (o === text.indexOf(OBJECT_CHAR, 1) ? '1' : undefined);
    expect(captionLine(text, 0, text.length, shownAt)).toBe('Figure 1. A scheme');
    // a number with a `$` in it is not taken for a pattern
    expect(captionLine('S ' + OBJECT_CHAR, 0, 3, () => '$&1')).toBe('S $&1');
  });

  it('lists a caption that follows a picture in its paragraph with its own number', async () => {
    answers = {};
    const n = newDocument();
    const runs = [objectRun(1, {}), { text: 'Figure ' }, objectRun(2, {}), { text: '. A scheme' }];
    const { ui, f } = setup({
      runs: runs as never, paras: [{}],
      objects: { 1: { kind: 'drawing', contents: { atoms: [], bonds: [], captions: [], arrows: [], shapes: [] } }, 2: { kind: 'seq', name: 'Figure' } } as never,
      styles: n.styles,
    });
    expect(f.t.runs.length).toBe(4);
    asked.length = 0;
    await ui.crossReference();
    const targets = asked[0].fields[0].options!;
    expect(targets.map((x) => x.label)).toEqual(['Caption: Figure 1. A scheme']);
  });
});
