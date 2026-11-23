// @vitest-environment jsdom
//
// Pasting into a Document: cells (an HTML table, or tab-separated text with no HTML) become a
// table in the text; text with a table among other things stays text.

import { describe, it, expect } from 'vitest';
import { onlyTable, tsvTable } from '../src/ui/doc-mode';

describe('cells pasted into a document', () => {
  it('takes an HTML table on its own as cells', () => {
    expect(onlyTable('<html><body><!--StartFragment--><table><tr><td>Phenol</td><td>95</td></tr></table><!--EndFragment--></body></html>')).toBe(true);
    expect(onlyTable('<p>Intro</p><table><tr><td>a</td><td>b</td></tr></table>')).toBe(false);
    expect(onlyTable('<p>No table</p>')).toBe(false);
  });
  it('takes tab-separated rows of the same length as cells, and other text with tabs as text', () => {
    expect(tsvTable('Phenol\t95\tC[C@H](O)c1ccccc1\r\n')?.[0].map((c) => c.runs.map((r) => r.text).join(''))).toEqual(['Phenol', '95', 'C[C@H](O)c1ccccc1']);
    expect(tsvTable('Name\tYield\nX\t95\n')?.length).toBe(2);
    expect(tsvTable('•\tfirst item\nsecond line')).toBeNull();
    expect(tsvTable('no tabs here')).toBeNull();
  });
});

// review R06: Paste ▾ ▸ Keep Text Only pastes the words even when a structure was copied with
// them, and in a text box Paste ▾ reads the clipboard (there is no paste event to read)
describe('Paste ▾ in a document', () => {
  const withClipboard = (dm: unknown, got: object) => {
    const d = dm as { host: object };
    const was = d.host;
    d.host = new Proxy({}, { get: (_t, k) => (k === 'readPaste' ? async () => got : (was as Record<string | symbol, unknown>)[k]) });
  };

  it('Keep Text Only puts in the text, not the structure copied with it', async () => {
    const { docMode } = await import('./doc-mode-harness');
    const { dm, f } = await docMode({ runs: [{ text: 'Made ' }], paras: [{}] });
    withClipboard(dm, { text: 'CCO', drawing: { atoms: [], bonds: [] } });
    f.ed.setCaret(5);
    (dm as unknown as { plainPaste: boolean }).plainPaste = true;
    await dm.paste(null);
    expect(f.ed.text).toBe('Made CCO');
    expect(Object.keys(f.t.objects ?? {})).toHaveLength(0);
  }, 60000);

  it('in a text box, the menu\'s paste reads the clipboard', async () => {
    const { docMode } = await import('./doc-mode-harness');
    const { objectRun } = await import('../src/document/document');
    const rt = await import('../src/richtext');
    const { dm, f } = await docMode({ runs: [{ text: 'A ' }], paras: [{}], objects: { 1: { kind: 'textbox', runs: [{ text: 'Box' }], w: 100 } } as never });
    f.ed.update({ ...f.t, runs: [...f.t.runs, objectRun(1, {})] }, 'Insert');
    (dm as unknown as { startBox(id: number): boolean }).startBox(1);
    withClipboard(dm, { text: ' and more' });
    f.box!.ed.setCaret(3);
    await dm.paste(null);
    expect(rt.plainText((f.t.objects[1] as { runs: never }).runs)).toBe('Box and more');
  }, 60000);
});
