// Structure from Name or SMILES (ui/structure-from-name.ts): the one window Document mode,
// Spreadsheet mode and SI projects ask it in, and what is done with the name reader's answer.

import { describe, expect, it, vi } from 'vitest';

const answers: ({ text: string } | null)[] = [];
vi.mock('../src/ui/ask', () => ({ ask: vi.fn(async () => answers.shift() ?? null) }));

const { askStructureFromName, STRUCTURE_FROM_NAME } = await import('../src/ui/structure-from-name');
const { ask } = await import('../src/ui/ask');

const contents = { atoms: [], bonds: [], arrows: [], captions: [], shapes: [] } as never;
const style = {} as never;

describe('askStructureFromName', () => {
  it('asks in the one window, and gives the structure the reader made', async () => {
    answers.push({ text: '  caffeine ' });
    const toStructure = vi.fn(async () => ({ contents, notes: [] }));
    const flash = vi.fn();
    expect(await askStructureFromName({ toStructure, style, flash, ok: 'Insert', where: 'It goes here.' })).toBe(contents);
    expect(toStructure).toHaveBeenCalledWith('caffeine', style);
    expect(vi.mocked(ask).mock.calls[0][0]).toBe(STRUCTURE_FROM_NAME);
    expect(flash).not.toHaveBeenCalled();
  });

  it('says why a name could not be read, and the reader’s notes', async () => {
    answers.push({ text: 'not a name' }, { text: 'benzene' });
    const flash = vi.fn();
    expect(await askStructureFromName({ toStructure: async () => ({ error: 'Not read.' }), style, flash, ok: 'Insert', where: '' })).toBeNull();
    expect(flash).toHaveBeenCalledWith('Not read.', 8000);
    await askStructureFromName({ toStructure: async () => ({ contents, notes: ['Read as a SMILES.'] }), style, flash, ok: 'Insert', where: '' });
    expect(flash).toHaveBeenLastCalledWith('Note from the name reader: Read as a SMILES.', 8000);
  });

  it('does nothing when cancelled, or when the file shown changed', async () => {
    const toStructure = vi.fn(async () => ({ contents, notes: [] }));
    answers.push(null);
    expect(await askStructureFromName({ toStructure, style, flash: () => {}, ok: 'Insert', where: '' })).toBeNull();
    answers.push({ text: 'benzene' });
    expect(await askStructureFromName({ toStructure, style, flash: () => {}, ok: 'Insert', where: '', closed: () => false })).toBeNull();
    expect(toStructure).not.toHaveBeenCalled();
  });
});
