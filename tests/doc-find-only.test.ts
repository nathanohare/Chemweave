// @vitest-environment jsdom
//
// Find without Replace (SI mode's Live Preview): no Replace row, and Ctrl+H or Enter can't change
// the text (a change there would go past the preview's typing guard, into many fields at once).

import { describe, it, expect } from 'vitest';
import { DocFile } from '../src/document/doc-file';
import { newDocument, type DocText } from '../src/document/document';
import { DocFind } from '../src/ui/doc-find';

describe('Find only', () => {
  it('has no Replace row and Ctrl+H does nothing', () => {
    const f = new DocFile({ ...newDocument(), runs: [{ text: 'Dry over MgSO4, then MgSO4 again.' }], paras: [{}] } as DocText);
    const parent = document.createElement('div');
    document.body.append(parent);
    const find = new DocFind(parent, { file: () => f, focus: () => {}, flash: () => {}, redraw: () => {} }, { findOnly: true });
    find.show(true);
    expect(parent.querySelector('.df-replace')).toBeNull();
    expect(parent.querySelector('.df-toggle')).toBeNull();
    const box = parent.querySelector('.df-find') as HTMLInputElement;
    box.value = 'MgSO4';
    find.refresh();
    expect(find.hits.length).toBe(2);
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', ctrlKey: true, bubbles: true }));
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
    expect(f.ed.text).toBe('Dry over MgSO4, then MgSO4 again.');
    expect(find.hits.length).toBe(2);
  });
});
