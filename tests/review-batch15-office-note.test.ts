// @vitest-environment jsdom
// Review batch 15 (F530): after saving a Word or PowerPoint file the message says the structures are
// pictures there. With Settings ▸ General ▸ Save structures in Word / PowerPoint files as ChemDraw
// objects, that is not true, so the message is left out.
import { describe, it, expect } from 'vitest';
import { Doc } from '../src/model';
import { Workspace, type Tab, type WorkspaceHooks } from '../src/workspace';

function workspace(objects: { Word: boolean; PowerPoint: boolean }): Workspace {
  const hooks = {
    leave: () => {}, enter: () => {}, changed: () => {}, flash: () => {},
    pptx: {}, measure: () => 0, sheets: {}, documents: {},
    chemdrawObjects: (program: 'Word' | 'PowerPoint') => objects[program],
  } as unknown as WorkspaceHooks;
  return new Workspace(new Doc(), hooks);
}

/** A presentation with a structure on its first slide (the note only looks at the atom count). */
const deckTab = (): Tab => ({ mode: 'slides', deck: { slides: [0], docOf: () => ({ atoms: { size: 3 } }) } }) as unknown as Tab;
const noteFor = (ws: Workspace, tab: Tab, name: string): string => (ws as unknown as { officeNoteFor(t: Tab, n: string): string }).officeNoteFor(tab, name);

describe('the Word / PowerPoint save note', () => {
  it('says the structures are pictures when they are saved as pictures', () => {
    expect(noteFor(workspace({ Word: false, PowerPoint: false }), deckTab(), 'a.pptx')).toContain('In PowerPoint the structures are pictures');
  });
  it('is left out when PowerPoint files hold them as ChemDraw objects', () => {
    expect(noteFor(workspace({ Word: false, PowerPoint: true }), deckTab(), 'a.pptx')).toBe('');
  });
  it('a Word setting does not silence the PowerPoint note', () => {
    expect(noteFor(workspace({ Word: true, PowerPoint: false }), deckTab(), 'a.pptx')).toContain('pictures');
  });
});
