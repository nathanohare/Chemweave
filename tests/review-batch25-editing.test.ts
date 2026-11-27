// Code review batch 25 (text editing and typing): Increase and Decrease Font Size on mixed sizes
// (F302), an input method typing over a selection (F1138), and the typing-time chemistry rules
// (F1154 to F1157).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { TextEditing } from '../src/text/editing';
import { applyFormat } from '../src/text/format';
import { afterTyping, finishWord, leftAsWritten, DEFAULT_TYPING } from '../src/text/typing';
import { alkylPrefs } from '../src/chem/labels';
import { rNumberPrefs } from '../src/chem/r-numbers';
import { arialWidth } from '../src/text-metrics';
import type { TextRun } from '../src/model';

const measure = (t: string, s: number) => arialWidth(t, s, false);
const editor = (runs: TextRun[], size = 10) => {
  const ed = new TextEditing({ runs, justify: 'left' }, { size }, measure, size);
  let clock = 0;
  ed.now = () => (clock += 1000);
  return ed;
};

describe('Increase and Decrease Font Size on a selection of mixed sizes (F302)', () => {
  // PowerPoint's steps for the two buttons: ..., 10, 10.5, 11, 12, ..., 32, 36, 40, 44, ...
  it('steps each run from its own size, and undoes in one step', () => {
    const ed = editor([{ text: 'aaa', size: 10 }, { text: 'bbb', size: 36 }], 12);
    ed.select(0, 6);
    applyFormat(ed, { kind: 'grow', by: 1 });
    expect(ed.t.runs.map((r) => [r.text, r.size])).toEqual([['aaa', 10.5], ['bbb', 40]]);
    applyFormat(ed, { kind: 'grow', by: -1 });
    expect(ed.t.runs.map((r) => [r.text, r.size])).toEqual([['aaa', 10], ['bbb', 36]]);
    ed.undo();
    expect(ed.t.runs.map((r) => [r.text, r.size])).toEqual([['aaa', 10.5], ['bbb', 40]]);
  });
  it('still steps a selection of one size, and the size typed next with nothing selected', () => {
    const ed = editor([{ text: 'aaa', size: 18 }], 12);
    ed.select(0, 3);
    applyFormat(ed, { kind: 'grow', by: 1 });
    expect(ed.t.runs[0].size).toBe(20);
    ed.setCaret(3);
    applyFormat(ed, { kind: 'grow', by: -1 });
    expect(ed.pending?.size).toBe(18);
  });
});

describe('typing over a selection with an input method (F1138)', () => {
  it('is one step of Undo, and the selection stays until the text is confirmed', () => {
    const ed = editor([{ text: 'hello world' }]);
    ed.select(0, 5);
    ed.compositionStart();
    expect(ed.text).toBe('hello world');
    ed.compositionUpdate('ni');
    expect(ed.frame().runs.map((r) => r.text).join('')).toBe('ni world');
    ed.compositionEnd('你');
    expect(ed.text).toBe('你 world');
    expect(ed.focus).toBe(1);
    ed.undo();
    expect(ed.text).toBe('hello world');
    expect(ed.canUndo).toBe(false);
  });
  it('leaves the selection as it was when the composition is cancelled', () => {
    const ed = editor([{ text: 'hello world' }]);
    ed.select(0, 5);
    ed.compositionStart();
    ed.compositionUpdate('ni');
    ed.compositionEnd('');
    expect(ed.text).toBe('hello world');
    expect([ed.start, ed.end]).toEqual([0, 5]);
    expect(ed.canUndo).toBe(false);
  });
  it('still types at a caret as before', () => {
    const ed = editor([{ text: 'ab' }]);
    ed.setCaret(1);
    ed.compositionStart();
    ed.compositionUpdate('é');
    expect(ed.caret().x).toBeGreaterThan(0);
    ed.compositionEnd('é');
    expect(ed.text).toBe('aéb');
  });
});

describe('typing-time chemistry formatting', () => {
  const typeAll = (ed: TextEditing, text: string, prefs = DEFAULT_TYPING) => {
    ed.onTyped = (t) => afterTyping(ed, t, prefs);
    for (const ch of text) ed.type(ch);
  };
  afterEach(() => { alkylPrefs.look = 'typed'; rNumberPrefs.plainText = false; leftAsWritten.clear(); });

  it('raises the R number after an alkyl dash was put in, which moves the word (F1154)', () => {
    alkylPrefs.look = 'dash';
    rNumberPrefs.plainText = true;
    const ed = editor([]);
    typeAll(ed, 'tBuCO2R1 ');
    expect(ed.text).toBe('t-BuCO2R1 ');
    expect(ed.t.runs.filter((r) => r.sup).map((r) => r.text)).toEqual(['1']);
  });

  it('looks back only a stretch of a paragraph that has no spaces in it (F1155)', () => {
    const ed = editor([{ text: 'x'.repeat(5000) }]);
    const spy = vi.spyOn(ed, 'looksBetween');
    typeAll(ed, ' ');
    expect(spy).toHaveBeenCalled();
    for (const [a, b] of spy.mock.calls) expect(b - a).toBeLessThanOrEqual(310);
  });

  it('leaves words in the dictionary or left as written alone (F1156)', () => {
    const own = editor([]);
    typeAll(own, 'CH2Cl2 ', { ...DEFAULT_TYPING, dictionary: ['CH2Cl2'] });
    expect(own.t.runs.some((r) => r.sub)).toBe(false);
    leftAsWritten.add('ch2cl2');
    const left = editor([]);
    typeAll(left, 'CH2Cl2 ');
    expect(left.t.runs.some((r) => r.sub)).toBe(false);
    leftAsWritten.clear();
    const plain = editor([]);
    typeAll(plain, 'CH2Cl2 ');
    expect(plain.t.runs.filter((r) => r.sub).map((r) => r.text)).toEqual(['2', '2']);
  });

  it('bolds a compound number when the word is finished with Tab, as with a space (F1157)', () => {
    const prefs = { ...DEFAULT_TYPING, boldNumbers: true };
    const tab = editor([]);
    typeAll(tab, 'see compound 4', prefs);
    finishWord(tab, prefs);
    expect(tab.t.runs.filter((r) => r.bold).map((r) => r.text)).toEqual(['4']);
    // (a text that came in some other way, such as pasted, and ends in a bracketed number)
    const bracket = editor([{ text: 'the ketone (4)' }]);
    finishWord(bracket, prefs);
    expect(bracket.t.runs.filter((r) => r.bold).map((r) => r.text)).toEqual(['4']);
  });
});
