// @vitest-environment jsdom
// Code review batch 07, Review > Proofing.
//  F078 the Spelling pane works out suggestions only for the problem it shows (it did it for every
//  misspelled word at every step); F079 Change at stale offsets after the text is edited or
//  another document is shown; F485 the Thesaurus looks up the word in the table cell or text box
//  being typed in; F486 a synonym replaces the word, not the spaces round a selection.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocProofingUI, proofProblems, type DocProofingHost } from '../src/ui/doc-proofing-ui';
import { DocFile } from '../src/document/doc-file';
import { newDocument, type DocText } from '../src/document/document';
import type { Speller } from '../src/text/spelling';

afterEach(() => { document.body.innerHTML = ''; vi.unstubAllGlobals(); });

const speller = () => {
  const suggestions = vi.fn((w: string) => [w.toUpperCase()]);
  return { speller: { suggestions } as unknown as Speller, suggestions };
};

describe('Suggestions only for the problem shown (F078)', () => {
  it('none are worked out for a list of misspelled words until one is asked for', () => {
    const { speller: sp, suggestions } = speller();
    const text = 'aaa bbb ccc';
    const all = proofProblems(text, [[0, 3], [4, 7], [8, 11]], [], sp, false);
    expect(all).toHaveLength(3);
    expect(suggestions).not.toHaveBeenCalled();
    expect(all[1].choices).toEqual(['BBB']);
    expect(all[1].choices).toEqual(['BBB']);
    // (once, however often they are looked at)
    expect(suggestions).toHaveBeenCalledTimes(1);
  });

  it('the pane steps through problems without working out the suggestions of the others', () => {
    const f = new DocFile({ ...newDocument(), runs: [{ text: 'aaa bbb ccc' }], paras: [{}] } as DocText);
    const { speller: sp, suggestions } = speller();
    const host = { file: () => f, speller: () => sp, checks: () => ({ spell: [[0, 3], [4, 7], [8, 11]] as [number, number][], issues: [] }), addWord() {}, ignoreWord() {}, show() {}, flash() {}, focus() {} } as DocProofingHost;
    const ui = new DocProofingUI(host);
    ui.grammar = false;
    ui.spelling();
    // the first problem is shown: only its suggestions
    expect(suggestions.mock.calls.map((c) => c[0])).toEqual(['aaa']);
    document.querySelectorAll<HTMLButtonElement>('.proof-pane button').forEach((b) => { if (b.textContent === 'Ignore Once') b.click(); });
    expect(suggestions.mock.calls.map((c) => c[0])).toEqual(['aaa', 'bbb']);
  });
});

describe('Change after the text moved on (F079)', () => {
  it('does not change anything at the old place when the words there are not the ones found', () => {
    const f = new DocFile({ ...newDocument(), runs: [{ text: 'Say teh word' }], paras: [{}] } as DocText);
    const { speller: sp } = speller();
    const host = { file: () => f, speller: () => sp, checks: () => ({ spell: [[4, 7]] as [number, number][], issues: [] }), addWord() {}, ignoreWord() {}, show() {}, flash() {}, focus() {} } as DocProofingHost;
    const ui = new DocProofingUI(host);
    ui.grammar = false;
    ui.spelling();
    // typed in above it: the word is no longer at 4 to 7
    f.ed.replace(0, 0, [{ text: 'Well, ' }], undefined, 'type');
    expect(f.ed.text).toBe('Well, Say teh word');
    const change = [...document.querySelectorAll<HTMLButtonElement>('.proof-pane button')].find((b) => b.textContent === 'Change')!;
    change.click();
    // nothing was replaced at the old place
    expect(f.ed.text).toBe('Well, Say teh word');
  });

  it('does not change a one-character slip at the old place when the same character lies there after an edit', () => {
    const f = new DocFile({ ...newDocument(), runs: [{ text: 'a b , c' }], paras: [{}] } as DocText);
    const { speller: sp } = speller();
    const host = { file: () => f, speller: () => sp, checks: () => ({ spell: [] as [number, number][], issues: [] }), addWord() {}, ignoreWord() {}, show() {}, flash() {}, focus() {} } as DocProofingHost;
    const ui = new DocProofingUI(host);
    ui.spelling();
    // the pane stops at the space before the comma (a single space: offset 3)
    expect(document.querySelector('.proof-pane')?.textContent).toMatch(/Space before/);
    // the first two characters are deleted: the text is "b , c", and offset 3 is now the space after the comma
    f.ed.replace(0, 2, [], undefined, 'type');
    expect(f.ed.text).toBe('b , c');
    [...document.querySelectorAll<HTMLButtonElement>('.proof-pane button')].find((b) => b.textContent === 'Change')!.click();
    // (the space after the comma is not taken out in its place)
    expect(f.ed.text).not.toBe('b ,c');
  });

  it('changes the word when it is still there', () => {
    const f = new DocFile({ ...newDocument(), runs: [{ text: 'Say teh word' }], paras: [{}] } as DocText);
    const { speller: sp } = speller();
    const host = { file: () => f, speller: () => sp, checks: () => ({ spell: [[4, 7]] as [number, number][], issues: [] }), addWord() {}, ignoreWord() {}, show() {}, flash() {}, focus() {} } as DocProofingHost;
    const ui = new DocProofingUI(host);
    ui.grammar = false;
    ui.spelling();
    [...document.querySelectorAll<HTMLButtonElement>('.proof-pane button')].find((b) => b.textContent === 'Change')!.click();
    expect(f.ed.text).toBe('Say TEH word');
  });
});

describe('Thesaurus (F485, F486)', () => {
  const thesaurus = (f: Pick<DocFile, 'textEd' | 'ed'>) => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{ word: 'glad' }] })));
    const host = { file: () => f as DocFile, flash: vi.fn(), focus() {} } as unknown as DocProofingHost;
    return { ui: new DocProofingUI(host), flash: host.flash as ReturnType<typeof vi.fn> };
  };
  const synonym = async () => { await vi.waitFor(() => expect(document.querySelector('.thesaurus .th-list button')).not.toBeNull()); document.querySelector<HTMLButtonElement>('.thesaurus .th-list button')!.click(); };

  it('looks up the word in the table cell or text box typed in, and puts the synonym there', async () => {
    const f = new DocFile({ ...newDocument(), runs: [{ text: 'Body text' }], paras: [{}] } as DocText);
    const box = new DocFile({ ...newDocument(), runs: [{ text: 'a happy cell' }], paras: [{}] } as DocText).ed;
    box.setCaret(4);
    const { ui } = thesaurus({ ed: f.ed, textEd: box } as never);
    await ui.lookUp();
    await synonym();
    expect(box.text).toBe('a glad cell');
    expect(f.ed.text).toBe('Body text');
  });

  it('a selection with a space after the word keeps the space', async () => {
    const f = new DocFile({ ...newDocument(), runs: [{ text: 'a happy word' }], paras: [{}] } as DocText);
    f.ed.select(2, 8);
    expect(f.ed.text.slice(2, 8)).toBe('happy ');
    const { ui } = thesaurus(f);
    await ui.lookUp();
    await synonym();
    expect(f.ed.text).toBe('a glad word');
  });
});
