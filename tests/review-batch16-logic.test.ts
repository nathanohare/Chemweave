// @vitest-environment jsdom
//
// Review batch 16 (UI wording sweep, Office modes): the wording and small logic fixes that can be
// checked by running the code. Names come from Microsoft's own documentation, quoted in the
// comments; none of the expected text is copied from the program's old answer.

import { describe, it, expect } from 'vitest';
import { fitEquation, FIT_NAMES, type Fit } from '../src/sheet/fit';
import { PRESET_LOOKS } from '../src/sheet/conditional';
import { functionHelp } from '../src/sheet/fn-help';
import { flashFill } from '../src/sheet/flash-fill';
import { groupsOf } from '../src/sheet/analysis-tools';
import { Workbook } from '../src/sheet/workbook';
import { CellError } from '../src/sheet/values';
import { tintPieces } from '../src/ui/sheet-view';
import { chartTip } from '../src/ui/chart-gallery';
import { CHART_NAMES } from '../src/sheet/chart';
import { Doc } from '../src/model';
import { partName } from '../src/deck/animation';
import { slideDifferences, type SlideView } from '../src/deck/compare';
import { Deck } from '../src/deck/deck';
import { viewsOf } from '../src/ui/slide-compare';

describe('F1108: a line through the origin has no "+ 0"', () => {
  // Microsoft Support, "Add a trendline": with the intercept set to zero Excel shows y = 2x.
  const line = (coef: number[]): Fit => ({ kind: 'linear', coef, r2: 1, n: 3 }) as Fit;
  it('leaves the zero constant out', () => expect(fitEquation(line([0, 2]))).toBe('y = 2x'));
  it('keeps a constant that is not zero', () => {
    expect(fitEquation(line([1.5, 2]))).toBe('y = 2x + 1.5');
    expect(fitEquation(line([-1.5, 2]))).toBe('y = 2x − 1.5');
  });
  it('leaves a zero x² term and constant out of a polynomial', () => {
    expect(fitEquation({ kind: 'poly2', coef: [0, 0, 3], r2: 1, n: 3 } as Fit)).toBe('y = 3x²');
  });
  it('still writes a lone zero', () => expect(fitEquation(line([0, 0]))).toBe('y = 0'));
});

describe('F1105: fitted-line names are Excel\'s, in Title Case', () => {
  // Excel's trendline types: Exponential, Linear, Logarithmic, Polynomial, Power (Microsoft Support, "Add a trendline").
  it('calls the straight line Linear', () => expect(FIT_NAMES.linear).toBe('Linear'));
  it('writes the others in Title Case', () => {
    expect(FIT_NAMES.order1).toBe('First-Order Decay');
    expect(FIT_NAMES.order2).toBe('Second-Order Decay');
    expect(FIT_NAMES.arrhenius).toBe('Arrhenius (k Against T)');
    expect(FIT_NAMES.eyring).toBe('Eyring (k Against T)');
    expect(FIT_NAMES.hammett).toBe('Hammett (Against σ)');
  });
});

describe('F1086: highlight formats use Excel\'s names', () => {
  // Microsoft Support, "Use conditional formatting to highlight information": the "Format with" list.
  it('lists them in Title Case and has no invented entry', () => {
    expect(PRESET_LOOKS.map((p) => p.name)).toEqual([
      'Light Red Fill with Dark Red Text', 'Yellow Fill with Dark Yellow Text', 'Green Fill with Dark Green Text', 'Light Red Fill', 'Red Text',
    ]);
  });
});

describe('F1115: XMATCH help describes its match modes as XLOOKUP does', () => {
  // Microsoft Support, "XMATCH function": 0 exact; -1 exact or next smaller; 1 exact or next larger; 2 wildcard.
  const args = functionHelp().get('XMATCH')!.args.map((a) => `${a.name}: ${a.help}`).join(' | ');
  it('says −1 and 1 are next smaller and next larger, not wildcards', () => {
    expect(args).toContain('0 exact, −1 or next smaller, 1 or next larger, 2 wildcards');
  });
  it('explains the search modes', () => {
    expect(args).toContain('1 first to last, −1 last to first, 2 or −2 halving through sorted data');
  });
});

describe('F1110: Flash Fill speaks American English', () => {
  it('says capitalized, not capitalised', () => {
    const got = flashFill([{ row: ['john smith'], out: 'John Smith' }], [['john smith'], ['mary jones']]);
    expect(got).not.toBeNull();
    expect(got!.describe).not.toMatch(/capitalis/);
    expect(got!.describe).toMatch(/capitalized/);
  });
});

describe('F1079: the Labels hint has a space before its bracket', () => {
  it('reads "needed (if its first row..."', () => {
    const msg = groupsOf([['Pd', 'Ni'], [1, 2]], true, false);
    expect(typeof msg).toBe('string');
    expect(msg).toContain('where a number is needed (if its first row or column is labels, check Labels).');
    expect(msg).not.toContain('needed(');
  });
});

describe('F1098: a name error talks about Chemweave and uses ▸', () => {
  const detail = (formula: string): string => {
    const wb = new Workbook();
    wb.edit('t', () => wb.sheet.setInput(0, 0, formula));
    const v = wb.sheet.value(0, 0);
    return v instanceof CellError ? v.detail ?? '' : '';
  };
  it('for an unknown name', () => {
    const d = detail('=foo');
    expect(d).toContain('Chemweave knows');
    expect(d).toContain('Formulas ▸ Name Manager');
    expect(d).not.toMatch(/this program|Formulas >/);
  });
  it('for an unknown function', () => {
    const d = detail('=FOO(1)');
    expect(d).toContain('is not a function Chemweave knows');
    expect(d).not.toContain('this program');
  });
});

describe('F1072: the active cell is left out of a multi-cell tint', () => {
  const area = (bs: { w: number; h: number }[]) => bs.reduce((s, b) => s + b.w * b.h, 0);
  const outer = { x: 10, y: 20, w: 300, h: 80 }; // A1:C4 at 100 x 20 px a cell
  it('covers the range except the active cell, with no overlap', () => {
    const hole = { x: 10, y: 20, w: 100, h: 20 }; // A1
    const pieces = tintPieces(outer, hole);
    expect(area(pieces)).toBe(outer.w * outer.h - hole.w * hole.h);
    for (const p of pieces) {
      const overlaps = p.x < hole.x + hole.w && hole.x < p.x + p.w && p.y < hole.y + hole.h && hole.y < p.y + p.h;
      expect(overlaps).toBe(false);
    }
  });
  it('works for a cell in the middle', () => {
    const hole = { x: 110, y: 40, w: 100, h: 20 };
    const pieces = tintPieces(outer, hole);
    expect(pieces).toHaveLength(4);
    expect(area(pieces)).toBe(outer.w * outer.h - hole.w * hole.h);
  });
  it('is the whole range when the cell is elsewhere, and empty when the cell fills it', () => {
    expect(tintPieces(outer, { x: 900, y: 900, w: 10, h: 10 })).toEqual([outer]);
    expect(tintPieces(outer, outer)).toEqual([]);
  });
});

describe('F681: chart gallery tooltips', () => {
  it('has no article to get wrong and keeps each name\'s capitals', () => {
    expect(chartTip('area')).toBe(`Insert Chart: ${CHART_NAMES.area}`);
    expect(chartTip('area')).not.toContain('a area');
    expect(chartTip('sankey')).toContain('Sankey');
  });
});

describe('F844: highlight names say gray, as American English does', () => {
  it('names a #BEBEBE highlight gray in the Animation pane', () => {
    const doc = new Doc();
    let id = 0;
    doc.edit('atom', () => { const a = doc.addAtom(10, 10); a.highlight = '#bebebe'; id = a.id; });
    const a = { id };
    const sel = { atoms: new Set([a.id]), bonds: new Set<number>(), captions: new Set<number>(), arrows: new Set<number>(), shapes: new Set<number>() };
    expect(partName(doc, { kind: 'highlight', sel })).toBe('Highlight (gray)');
  });
});

describe('F851: added and removed text read the same way whatever the text holds', () => {
  const deckWith = (texts: string[]): SlideView => {
    const d = Deck.blank(new Doc());
    d.editSlides('Fill', [0], (doc) => { texts.forEach((t, i) => doc.addCaption({ x: 100, y: 100 + i * 40, runs: [{ text: t }], justify: 'left' })); });
    return viewsOf(d)[0];
  };
  it('puts the text after "added:" even when it holds a double quote', () => {
    const lines = slideDifferences(deckWith([]), deckWith(['12" ruler', 'plain']));
    expect(lines).toContain('Text added: "12" ruler"');
    expect(lines).toContain('Text added: "plain"');
    expect(lines.some((l) => / added$/.test(l))).toBe(false);
  });
  it('does the same for removed text', () => {
    const lines = slideDifferences(deckWith(['12" ruler']), deckWith([]));
    expect(lines).toContain('Text removed: "12" ruler"');
  });
});
