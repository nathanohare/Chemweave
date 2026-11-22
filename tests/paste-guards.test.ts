import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// main.ts runs only in the browser, so these read its source: each command named here must keep the
// guards the review found missing (review F4-R07, F4-R08).
const main = readFileSync('src/main.ts', 'utf8').replace(/\r\n/g, '\n');
const body = (name: string): string => {
  const at = main.indexOf(`function ${name}(`);
  expect(at, name).toBeGreaterThan(0);
  return main.slice(at, main.indexOf('\n}\n', at));
};

describe('paste and 3-D Model keep to their drawing and say what the engine said', () => {
  it('a structure pasted into a species box checks the drawing after the engine and says an engine failure', () => {
    const b = body('pasteIntoSpeciesBox');
    const wait = b.indexOf('await molfileOrSmiles');
    expect(wait).toBeGreaterThan(0);
    expect(b.slice(0, wait)).toContain("sameDrawing('The structure')");
    const after = b.slice(wait);
    expect(after).toMatch(/chemistry engine/); // the engine's own message is shown, not "no structure"
    expect(after.indexOf('here.left()')).toBeLessThan(after.indexOf('editor.fillSpeciesBox'));
  });

  it('3-D Model: the check after a placed view never throws when the engine stopped', () => {
    const b = body('show3dModel');
    const after = b.slice(b.indexOf('const after = await chem.molToSmiles'));
    expect(after.split('\n')[0]).toContain('.catch(');
  });

  it('a SMILES-like paste while the engine loads becomes text at once instead of waiting', () => {
    const b = body('pasteText');
    expect(b).toMatch(/if \(chem\.ready\) \{ if \(await pasteChemistry\(text, true\)\) return; \}/);
    expect(b).toContain('Pasted as text: the chemistry engine is still loading.');
  });
});
