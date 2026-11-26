// Equations in the SI's own text (Insert ▸ Equation in the Live Preview): each an object
// character in the custom text with its LaTeX beside it, put back as an equation on each compile
// (so the Word file gets a Word equation), and read back from the preview's document.

import { describe, expect, it } from 'vitest';
import { customPiece, customShown, customTextJson, parseCustomText, placeCustomText, readCustomTextForCompile, type CustomText } from '../src/si/custom-text';
import { OBJECT_CHAR, type DocText } from '../src/document/document';
import * as rt from '../src/richtext';

const doc = (text: string): DocText => ({ runs: [{ text }], paras: [{}], objects: {} } as unknown as DocText);
// the Gibbs energy relation, as in any physical chemistry text (Atkins' Physical Chemistry, 11th ed., §3E)
const GIBBS = '\\Delta G = \\Delta H - T\\Delta S';

describe('equations in custom text', () => {
  const item: CustomText = { id: 'k-1', node: 'section:s1', after: 's:s1|text', gap: '', text: ` where ${OBJECT_CHAR} holds.`, math: [GIBBS] };

  it('are kept in the file (version 2) and read back', () => {
    const json = customTextJson([item]);
    expect(JSON.parse(json).version).toBe(2);
    expect(parseCustomText(json)).toEqual([item]);
    // (text without equations stays version 1, as before)
    expect(JSON.parse(customTextJson([{ ...item, text: 'plain', math: undefined }])).version).toBe(1);
    // (a newer file is never read, so never written over)
    expect(parseCustomText(JSON.stringify({ version: 3, items: [] }))).toBeNull();
  });

  it('are put in the compiled document as equations', () => {
    const d = doc('Text of the section.');
    const put = placeCustomText(d, [{ start: 0, end: 20, src: 's:s1|text' }], [{ start: 0, end: 20, node: 'section:s1' }], [item]);
    expect(rt.plainText(put.doc.runs)).toBe(`Text of the section. where ${OBJECT_CHAR} holds.`);
    const run = put.doc.runs.find((r) => r.obj !== undefined);
    expect(run && put.doc.objects[run.obj!]).toEqual({ kind: 'math', tex: GIBBS });
    expect(put.placed[0]).toMatchObject({ start: 20, end: 20 + item.text.length });
  });

  it('leave out an object character with no equation', () => {
    const put = placeCustomText(doc('A.'), [{ start: 0, end: 2, src: 'f' }], [{ start: 0, end: 2, node: 'section:s1' }], [{ ...item, after: 'f', text: ` x${OBJECT_CHAR}y`, math: [''] }]);
    expect(rt.plainText(put.doc.runs)).toBe('A. xy');
  });

  it('are read back from the document with their LaTeX', () => {
    const d = placeCustomText(doc('Text of the section.'), [{ start: 0, end: 20, src: 's:s1|text' }], [{ start: 0, end: 20, node: 'section:s1' }], [item]).doc;
    const got = customPiece(d, [[20, 20 + item.text.length]]);
    expect(got).toEqual({ text: item.text, math: [GIBBS] });
    expect(customPiece(doc('plain words'), [[0, 5]])).toEqual({ text: 'plain' });
  });

  it('show as their LaTeX in a list of the text', () => {
    expect(customShown(item)).toBe(` where [${GIBBS}] holds.`);
  });

  it('keep an entry for every object character, so a bare one (pasted as a letter) never moves an equation', () => {
    // the preview's text after an object character was pasted before the equation: " x￼ then ￼ end"
    const d = { runs: [{ text: ` x${OBJECT_CHAR} then ` }, { text: OBJECT_CHAR, obj: 1 }, { text: ' end' }], paras: [{}], objects: { 1: { kind: 'math', tex: 'E = mc^{2}' } } } as unknown as DocText;
    const got = customPiece(d, [[0, 14]]);
    expect(got.math).toEqual(['', 'E = mc^{2}']);
    // compiled: the bare one left out, the equation where it was
    const put = placeCustomText(doc('A.'), [{ start: 0, end: 2, src: 'f' }], [{ start: 0, end: 2, node: 'section:s1' }], [{ ...item, after: 'f', ...got }]);
    expect(rt.plainText(put.doc.runs)).toBe(`A. x then ${OBJECT_CHAR} end`);
    const run = put.doc.runs.find((r) => r.obj !== undefined);
    expect(run && put.doc.objects[run.obj!]).toEqual({ kind: 'math', tex: 'E = mc^{2}' });
  });

  it('keep keys a newer Chemweave added, and say when the file is newer than this one reads', async () => {
    const raw = JSON.stringify({ version: 2, items: [{ ...item, future: { a: 1 } }] });
    expect(parseCustomText(raw)?.[0]).toMatchObject({ future: { a: 1 } });
    expect(JSON.parse(customTextJson(parseCustomText(raw)!)).items[0].future).toEqual({ a: 1 });
    const folder = (text: string) => ({ readText: async () => text }) as never;
    expect(await readCustomTextForCompile(folder(JSON.stringify({ version: 3, items: [item] })))).toEqual({ items: [], newer: true });
    expect((await readCustomTextForCompile(folder(raw))).newer).toBe(false);
  });
});
