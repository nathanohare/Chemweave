// Code review batch 25 (chemistry in names, grammar, spelling and symbols): a locant is not a
// compound number (F1136), a label A is not an article (F1140),
// a curly apostrophe in the personal dictionary (F1151), a failed word-list load (F1152) and the
// symbol search's case (F1153).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { TextEditing } from '../src/text/editing';
import { afterTyping, DEFAULT_TYPING } from '../src/text/typing';
import { arialWidth } from '../src/text-metrics';
import { grammarIssues } from '../src/text/grammar';
import { Speller, loadSpeller } from '../src/text/spelling';
import { searchSymbols } from '../src/text/symbols';

const on = { stereo: true, numbers: true };

describe('compound numbers while typing a name (F1136)', () => {
  // typed a key at a time, as the editor does
  const typed = (text: string) => {
    const ed = new TextEditing({ runs: [], justify: 'left' }, { size: 10 }, (t, s) => arialWidth(t, s, false), 10);
    const prefs = { ...DEFAULT_TYPING, boldNumbers: true };
    ed.onTyped = (t) => afterTyping(ed, t, prefs);
    for (const ch of text) ed.type(ch);
    return ed.t.runs.filter((r) => r.bold).map((r) => r.text);
  };
  it('does not bold the locant of a name that goes on after "compound"', () => {
    expect(typed('the compound 4-nitrophenol ')).toEqual([]);
    expect(typed('the compound 4–nitrophenol ')).toEqual([]);
    expect(typed('compounds 2/3 ')).toEqual([]);
    expect(typed('compound 2.5 mg ')).toEqual([]);
  });
  it('still bolds a number a sentence or phrase ends on', () => {
    expect(typed('the compound 4 ')).toEqual(['4']);
    expect(typed('the compound 4, ')).toEqual(['4']);
    expect(typed('compound 4. Next')).toEqual(['4']);
    expect(typed('compound 4a. ')).toEqual(['4a']);
  });
});

describe('the "a" or "an" check on a label (F1140)', () => {
  const at = (t: string) => grammarIssues(t).map((g) => t.slice(g.start, g.end));
  it('leaves a capital A that labels something alone', () => {
    expect(at('Figure 1A illustrates the route')).toEqual([]);
    expect(at('Compound A is a white solid')).toEqual([]);
    expect(at('Ring A of the steroid')).toEqual([]);
    expect(at('See (4)A analog')).toEqual([]);
  });
  it('still finds the wrong article', () => {
    expect(at('This is a example')).toEqual(['a']);
    expect(at('It was done. A apple fell')).toEqual(['A']);
    expect(at('A example is shown')).toEqual(['A']);
  });
});

describe('the personal dictionary and ignored words with a curly apostrophe (F1151)', () => {
  const lists = () => ({ english: 'ask\nthe\n', chemistry: '', lab: '' });
  it('matches a word added with a curly apostrophe, however it is typed', () => {
    const sp = new Speller(lists());
    expect(sp.accepts('O’Neil')).toBe(false);
    sp.setPersonal(['O’Neil']);
    expect(sp.accepts('O’Neil')).toBe(true);
    expect(sp.accepts("O'Neil")).toBe(true);
    expect(sp.misspelled('ask O’Neil')).toEqual([]);
  });
  it('does the same for an ignored word, and for apostrophes at its ends', () => {
    const sp = new Speller(lists());
    sp.ignore('D’Arcy');
    expect(sp.accepts("D'Arcy")).toBe(true);
    const quoted = new Speller(lists());
    quoted.setPersonal(["'Zork'"]);
    expect(quoted.accepts('Zork')).toBe(true);
  });
});

describe('the word lists that failed to load (F1152)', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  it('are asked for again the next time', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const lists = (f: string) => readFileSync(new URL(`../public/dict/${f}`, import.meta.url), 'utf8');
    let down = true;
    vi.stubGlobal('fetch', async (url: string) => (down ? { ok: false, status: 503 } : { ok: true, status: 200, text: async () => lists(url.slice(url.lastIndexOf('/') + 1)) }));
    expect(await loadSpeller()).toBeNull();
    down = false;
    const got = await loadSpeller();
    expect(got).not.toBeNull();
    expect(got!.accepts('hello')).toBe(true);
    // and once read it is kept, not read again
    const same = await loadSpeller();
    expect(same).toBe(got);
  });
});

describe('searching symbols by a typed character (F1153)', () => {
  it('offers a capital that is not listed as it was typed, not its small letter', () => {
    const got = searchSymbols('Ж').map((s) => s.ch);
    expect(got).toContain('Ж');
    expect(got).not.toContain('ж');
  });
  it('offers an unlisted Latin capital as typed too', () => {
    expect(searchSymbols('Q')[0].ch).toBe('Q');
    expect(searchSymbols('q')[0].ch).toBe('q');
  });
  it('still finds a listed character in either case', () => {
    expect(searchSymbols('α').map((s) => s.ch)).toContain('α');
    expect(searchSymbols('Α').map((s) => s.ch)).toContain('Α');
  });
});
