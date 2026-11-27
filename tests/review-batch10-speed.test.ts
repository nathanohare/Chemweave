// Code review batch 10 (document engine): commands on long documents do their work in one pass
// over the text instead of once for every change, place or paragraph. Each test counts the
// whole-text operations a command makes (the costly part) and checks its result too.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const count = vi.hoisted(() => ({ sliceRuns: 0, replaceRange: 0, plainText: 0, decideEverywhere: 0, trackedReplace: 0, changeSlices: 0, layoutText: 0 }));

vi.mock('../src/richtext', async (orig) => {
  const m = await orig<typeof import('../src/richtext')>();
  return {
    ...m,
    sliceRuns: (...a: Parameters<typeof m.sliceRuns>) => { count.sliceRuns++; return m.sliceRuns(...a); },
    replaceRange: (...a: Parameters<typeof m.replaceRange>) => { count.replaceRange++; return m.replaceRange(...a); },
    plainText: (...a: Parameters<typeof m.plainText>) => { count.plainText++; return m.plainText(...a); },
  };
});

vi.mock('../src/document/revisions', async (orig) => {
  const m = await orig<typeof import('../src/document/revisions')>();
  return {
    ...m,
    decideEverywhere: (...a: Parameters<typeof m.decideEverywhere>) => { count.decideEverywhere++; return m.decideEverywhere(...a); },
    trackedReplace: (...a: Parameters<typeof m.trackedReplace>) => { count.trackedReplace++; return m.trackedReplace(...a); },
    changesIn: (...a: Parameters<typeof m.changesIn>) => {
      const got = m.changesIn(...a);
      const slice = got.slice.bind(got);
      return Object.assign(got, { slice: (...s: Parameters<typeof got.slice>) => { count.changeSlices++; return slice(...s); } });
    },
  };
});

vi.mock('../src/text/layout', async (orig) => {
  const m = await orig<typeof import('../src/text/layout')>();
  return { ...m, layoutText: (...a: Parameters<typeof m.layoutText>) => { count.layoutText++; return m.layoutText(...a); } };
});

import { decide, revText, trackFormatting } from '../src/document/revisions';
import { replaceRanges, trackedReplaceRanges, withoutDeleted } from '../src/document/find';
import { moveHeading } from '../src/document/navigation';
import { allowedEdit } from '../src/document/protect';
import { deleteStyle, newDocument, objectRun, paraFromStyle, runStyleOf, type DocText } from '../src/document/document';
import { changeLevel, newOutline } from '../src/document/doc-views';
import { sortOrder } from '../src/document/sort';
import { DocLayouter } from '../src/document/doc-layout';
import { documentMeasure } from '../src/text/font-measure';
import * as rt from '../src/richtext';
import type { ParaStyle, TextRun } from '../src/model';

const who = { author: 'A. Reviewer', date: '2026-11-27T10:00:00Z' };
const INS = revText({ kind: 'ins', ...who }), DEL = revText({ kind: 'del', ...who });
const reset = () => { for (const k of Object.keys(count) as (keyof typeof count)[]) count[k] = 0; };
beforeEach(reset);

/** n pieces: plain, inserted, plain, deleted… */
function trackedRuns(n: number): TextRun[] {
  const out: TextRun[] = [];
  for (let i = 0; i < n; i++) out.push({ text: `w${i} `, ...(i % 4 === 1 ? { rev: INS } : i % 4 === 3 ? { rev: DEL } : {}) });
  return out;
}

describe('deciding tracked changes (F093)', () => {
  it('accepts and rejects hundreds of changes in one pass', () => {
    const runs = trackedRuns(400);
    const t = { runs, paras: [{}] };
    reset();
    const acc = decide(t, true);
    expect(count.sliceRuns).toBeLessThan(5);
    expect(acc.runs.some((r) => r.rev)).toBe(false);
    expect(rt.plainText(acc.runs)).toBe(runs.filter((r) => r.rev !== DEL).map((r) => r.text).join(''));
    const rej = decide(t, false);
    expect(rt.plainText(rej.runs)).toBe(runs.filter((r) => r.rev !== INS).map((r) => r.text).join(''));
  });

  it('joins paragraphs whose break is taken away, the first one\'s style kept', () => {
    const t = { runs: [{ text: 'One' }, { text: '\n', rev: INS }, { text: 'Two\nThree' }], paras: [{ align: 'center' as const }, { align: 'right' as const }, {}] };
    const rej = decide(t, false);
    expect(rt.plainText(rej.runs)).toBe('OneTwo\nThree');
    expect(rej.paras).toEqual([{ align: 'center' }, {}]);
  });
});

describe('a tracked formatting change over a long selection (F095)', () => {
  it('walks the runs once', () => {
    const before: TextRun[] = Array.from({ length: 400 }, (_, i) => ({ text: `w${i} `, ...(i % 2 ? { italic: true } : {}) }));
    const after = rt.applyStyle(before, 0, rt.plainText(before).length, { bold: true });
    reset();
    const out = trackFormatting(before, after, 0, rt.plainText(after).length, who);
    expect(count.sliceRuns).toBeLessThan(5);
    expect(out.every((r) => r.bold && r.fmt)).toBe(true);
    expect(JSON.parse(out[1].fmt!.split('|').slice(2).join('|'))).toEqual({ italic: true });
  });
});

describe('Replace All (F088)', () => {
  const runs: TextRun[] = Array.from({ length: 300 }, (_, i) => ({ text: 'the cat ', ...(i % 2 ? { italic: true } : {}) }));
  const text = rt.plainText(runs);
  const hits: [number, number][] = [];
  for (let i = text.indexOf('cat'); i >= 0; i = text.indexOf('cat', i + 1)) hits.push([i, i + 3]);

  it('puts every replacement in in one pass', () => {
    reset();
    const out = replaceRanges(runs, hits, 'dog', { bold: true });
    expect(count.replaceRange).toBe(0);
    expect(rt.plainText(out)).toBe(text.replace(/cat/g, 'dog'));
    // each takes the look of what it replaced, and the look asked for
    expect(rt.sliceRuns(out, 4, 7)[0]).toMatchObject({ text: 'dog', bold: true });
    expect(rt.sliceRuns(out, 12, 15)[0]).toMatchObject({ text: 'dog', bold: true, italic: true });
  });

  it('marks every one as tracked in one pass', () => {
    reset();
    const got = trackedReplaceRanges({ runs, paras: [{}] }, hits, 'dog', {}, {}, who);
    expect(count.trackedReplace).toBe(0);
    const accepted = decide(got.t, true), rejected = decide(got.t, false);
    expect(rt.plainText(accepted.runs)).toBe(text.replace(/cat/g, 'dog'));
    expect(rt.plainText(rejected.runs)).toBe(text);
    // the caret after the first replacement: "the cat" kept as deleted, then "dog"
    expect(got.caret).toBe(4 + 3 + 3);
  });

  it('leaves out places in deleted text, both lists walked once', () => {
    const del: TextRun[] = [{ text: 'cat ' }, { text: 'cat ', rev: DEL }, { text: 'cat' }];
    expect(withoutDeleted(del, [[0, 3], [4, 7], [8, 11]])).toEqual([[0, 3], [8, 11]]);
  });
});

describe('dragging a heading in the Navigation pane (F090)', () => {
  it('cuts the text into paragraphs once', () => {
    const d = newDocument();
    const lines = Array.from({ length: 300 }, (_, i) => (i % 10 === 0 ? `Heading ${i}` : `Body ${i}`));
    const t: DocText = { ...d, runs: [{ ...runStyleOf(d.styles.Normal), text: lines.join('\n') }], paras: lines.map((l) => paraFromStyle(l.startsWith('Heading') ? d.styles.Heading1 : d.styles.Normal, {})) };
    reset();
    const got = moveHeading(t, 0, 300)!;
    expect(count.sliceRuns).toBeLessThan(5);
    const out = rt.plainText(got.t.runs).split('\n');
    expect(out.slice(0, 10)).toEqual(lines.slice(10, 20));
    expect(out.slice(-10)).toEqual(lines.slice(0, 10));
    expect(got.para).toBe(290);
  });
});

describe('a document protected for tracked changes (F091)', () => {
  it('works out the text before a keystroke once (it is the text after the one before)', () => {
    const d = newDocument();
    const t0: DocText = { ...d, track: true, protect: { edit: 'trackedChanges' }, runs: [{ text: 'Dry over MgSO4.' }], paras: [{}] };
    const t1 = { ...t0, runs: [...t0.runs, { text: 'a', rev: INS }] };
    const t2 = { ...t1, runs: [...t0.runs, { text: 'ab', rev: INS }] };
    expect(allowedEdit(t0, t1)).toBe(true);
    reset();
    expect(allowedEdit(t1, t2)).toBe(true);
    expect(count.decideEverywhere).toBe(1);
  });
});

describe('change bars (F084)', () => {
  it('finds the lines with changes without copying the list of changes', () => {
    const d = newDocument();
    const t: DocText = { ...d, runs: [...trackedRuns(200), { text: '\nEnd' }], paras: [{}, {}] };
    const lay = new DocLayouter({ measure: documentMeasure((s: string, size: number) => s.length * size * 0.5), drawingSize: () => ({ w: 1, h: 1 }) }).layout(t);
    expect(lay.changeBars.length).toBeGreaterThan(0);
    expect(count.changeSlices).toBe(0);
  });
});

describe('restyling many paragraphs (F499, F500)', () => {
  const many = (): DocText => {
    const d = newDocument();
    const styles = { ...d.styles, Exp: { ...d.styles.Normal, id: 'Exp', name: 'Experimental', custom: true, size: 9 } };
    const ps: ParaStyle[] = Array.from({ length: 200 }, () => paraFromStyle(styles.Exp, {}));
    return { ...d, styles, runs: [{ size: 9, text: Array.from({ length: 200 }, (_, i) => `Para ${i}`).join('\n') }], paras: ps };
  };

  it('Delete Style restyles all its paragraphs in one pass', () => {
    const t = many();
    reset();
    const out = deleteStyle(t, 'Exp');
    expect(count.plainText).toBeLessThan(10);
    expect(out.paras.every((p) => !p.style)).toBe(true);
  });

  it('Promote to Heading 1 over many paragraphs in one pass', () => {
    const t = many();
    reset();
    const out = changeLevel(t, newOutline(), 0, 199, 'heading1');
    expect(count.plainText).toBeLessThan(10);
    expect(out.paras.every((p) => p.style === 'Heading1')).toBe(true);
  });
});

describe('Sort (F511)', () => {
  it('compares with one collator, not a new one for each comparison', () => {
    const spy = vi.spyOn(String.prototype, 'localeCompare');
    try {
      const texts = Array.from({ length: 500 }, (_, i) => `item ${(i * 7919) % 500}`);
      const order = sortOrder(texts, { keys: [{ type: 'text' }] });
      expect(spy).not.toHaveBeenCalled();
      expect(order.map((i) => texts[i]).slice(0, 3)).toEqual(['item 0', 'item 1', 'item 10']);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('rich headers (F494)', () => {
  it('lays a header out once, not again for every page and every layout', () => {
    const d = newDocument();
    const lines = Array.from({ length: 6 }, (_, i) => `Page ${i}`);
    const t: DocText = {
      ...d, runs: [{ text: lines.join('\n') }], paras: lines.map((_, i) => (i ? { pageBreak: true } : {})),
      objects: { 9: { kind: 'field', code: 'title' } },
      hf: { ...d.hf, numbers: 'none', bodies: { header: { runs: [{ text: 'Report ', bold: true }, objectRun(9, {})], paras: [{}] } } },
    };
    const L = new DocLayouter({ measure: documentMeasure((s: string, size: number) => s.length * size * 0.5), drawingSize: () => ({ w: 1, h: 1 }) });
    const first = L.layout(t);
    expect(first.hfs).toHaveLength(6);
    reset();
    L.layout({ ...t });
    expect(count.layoutText).toBe(0);
  });
});
