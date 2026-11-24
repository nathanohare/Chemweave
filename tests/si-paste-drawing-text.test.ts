// @vitest-environment jsdom
//
// A drawing copied here or in ChemDraw also carries its structure as SMILES text. Ctrl+V of it into
// an SI Custom section's text makes a figure (as Insert ▸ Paste Picture does), not the SMILES text
// (Nate, 2026-11-23); plain text, a word from Word and a SMILES typed elsewhere stay text.
// Benzene's SMILES c1ccccc1 (PubChem CID 241).
import { describe, expect, it } from 'vitest';
import { pasteHoldsDrawing } from '../src/io/clipboard';
import { SiRichBox } from '../src/ui/si-rich';

const paste = (data: Record<string, string>, picture: boolean): ClipboardEvent => {
  const e = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
  const files = picture ? [new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'image.png', { type: 'image/png' })] : [];
  Object.defineProperty(e, 'clipboardData', { value: { getData: (t: string) => data[t] ?? '', files, types: [...Object.keys(data), ...(picture ? ['Files'] : [])] } });
  return e;
};

describe('a paste whose text is a drawing’s SMILES', () => {
  it('is a drawing with a picture and no formatted text (a ChemDraw copy)', () => {
    expect(pasteHoldsDrawing(paste({ 'text/plain': 'c1ccccc1' }, true))).toBe(true);
  });
  it('is text without a picture, with formatted text, or when it is not chemistry', () => {
    expect(pasteHoldsDrawing(paste({ 'text/plain': 'c1ccccc1' }, false))).toBe(false);
    expect(pasteHoldsDrawing(paste({ 'text/plain': 'c1ccccc1', 'text/html': '<p>c1ccccc1</p>' }, true))).toBe(false);
    expect(pasteHoldsDrawing(paste({ 'text/plain': 'Isolated in 85% yield.' }, true))).toBe(false);
    expect(pasteHoldsDrawing(paste({}, true))).toBe(false);
  });
  it('goes to the text box’s host as an object when the host says so', () => {
    let placed = '';
    const b = new SiRichBox('Text', {
      label: (r) => r, changed: () => {},
      holdsObject: (e) => pasteHoldsDrawing(e),
      pasteObject: (_e, place) => { placed = place({ figure: 'f-1', runs: [{ text: 'Caption of the figure' }] }); },
    });
    document.body.append(b.el);
    b.el.dispatchEvent(paste({ 'text/plain': 'c1ccccc1' }, true));
    expect(placed).toBe('Text\n!figure{f-1} Caption of the figure');
  });
});
