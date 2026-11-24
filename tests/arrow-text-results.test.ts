// @vitest-environment jsdom
//
// Reaction arrow text, round two (Nate's feature request I.1-I.4): each side's alignment set for
// one arrow, numbered lists of steps lined up on the left, the Results line (yield, ee) under the
// text below, and text guides only on plain reaction arrows unless turned on.

import { afterEach, describe, expect, it } from 'vitest';
import { Doc, type Arrow } from '../src/model';
import { arrowFrame, inFrame, interpretArrow, plainMeasure, schemeItems } from '../src/chem/reaction';
import { arrowTexts, guidesOn, helperBox, isNumberedList, lineUpText, plainReactionArrow, setSideText, sideAlign, splitStepRuns, splitStepsText, takesHelpers } from '../src/chem/arrow-text';
import { DEFAULT_SCHEME_PREFS, applySchemePlan, planCleanUp, setSchemePrefs, spacing } from '../src/chem/scheme-layout';
import { writeCdxml } from '../src/io/cdxml-write';
import { readCdxml } from '../src/io/cdxml';
import { plainText } from '../src/richtext';

const arrow = (doc: Doc, extra: Partial<Arrow> = {}, tail = { x: 100, y: 100 }, head = { x: 160, y: 100 }): Arrow =>
  doc.edit('arrow', () => doc.addArrow({ tail, head, headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'solid', noGo: false, equilibrium: false, sweep: 0, headLength: 6, headWidth: 1.5, ...extra }));

afterEach(() => setSchemePrefs(DEFAULT_SCHEME_PREFS));

describe('numbered lists of steps', () => {
  it('finds lists on lines of their own or on one line', () => {
    expect(isNumberedList('1. n-BuLi, THF\n2. PhCHO')).toBe(true);
    expect(isNumberedList('1) LDA\n2) MeI')).toBe(true);
    expect(isNumberedList('(i) NaH\n(ii) BnBr')).toBe(true);
    expect(isNumberedList('a) O3; b) PPh3')).toBe(true);
    expect(isNumberedList('1. n-BuLi; 2. PhCHO')).toBe(true);
    expect(isNumberedList('1. O3, CH2Cl2, −78 °C\n   then Me2S\n2. NaBH4')).toBe(true);
  });
  it('leaves ordinary conditions alone', () => {
    expect(isNumberedList('THF, −78 °C')).toBe(false);
    expect(isNumberedList('5.0 equiv NaH\nDMF')).toBe(false);
    expect(isNumberedList('1. LDA')).toBe(false);
    expect(isNumberedList('Pd(PPh3)4 (5 mol%)\nK2CO3, 80 °C')).toBe(false);
  });
  it('splits steps written on one line', () => {
    expect(splitStepsText('1. n-BuLi; 2. PhCHO')).toBe('1. n-BuLi\n2. PhCHO');
    const runs = splitStepRuns([{ text: '1. n-BuLi; ' }, { text: '2. PhCHO', italic: true }]);
    expect(runs && plainText(runs)).toBe('1. n-BuLi\n2. PhCHO');
    expect(splitStepRuns([{ text: 'THF; 0 °C' }])).toBeNull();
  });
  it('lines a list up on the left, unless the arrow says otherwise or the setting is off', () => {
    const doc = new Doc();
    const m = plainMeasure(doc);
    const r = arrow(doc);
    doc.edit('t', () => setSideText(doc, m, r, 'above', '1. n-BuLi, THF\n2. PhCHO'));
    let t = arrowTexts(doc, m, doc.arrows.get(r.id)!);
    expect(t.above[0].justify).toBe('left');
    expect(sideAlign(doc, doc.arrows.get(r.id)!, 'above', t.above)).toBe('left');
    doc.edit('own', () => doc.updateArrow(r.id, { textLook: { align: { above: 'right' } } }));
    expect(sideAlign(doc, doc.arrows.get(r.id)!, 'above', t.above)).toBe('right');
    doc.edit('back', () => doc.updateArrow(r.id, { textLook: undefined }));
    setSchemePrefs({ listLeft: false });
    t = arrowTexts(doc, m, doc.arrows.get(r.id)!);
    expect(sideAlign(doc, doc.arrows.get(r.id)!, 'above', t.above)).toBe('center');
  });
});

describe('alignment set for one arrow', () => {
  it('moves the shorter line to the left or right end of the text block', () => {
    setSchemePrefs({ fit: true });
    const doc = new Doc();
    const m = plainMeasure(doc);
    const r = arrow(doc);
    doc.edit('t', () => { setSideText(doc, m, r, 'above', 'Pd2(dba)3, XPhos, Cs2CO3'); setSideText(doc, m, doc.arrows.get(r.id)!, 'below', 'THF'); });
    const startOf = () => { const now = doc.arrows.get(r.id)!; return inFrame(arrowFrame(now), m.captionBox(arrowTexts(doc, m, now).below[0])); };
    const above = () => { const now = doc.arrows.get(r.id)!; return inFrame(arrowFrame(now), m.captionBox(arrowTexts(doc, m, now).above[0])); };
    // centered by default
    expect((startOf().t1 + startOf().t2) / 2).toBeCloseTo((above().t1 + above().t2) / 2, 1);
    doc.edit('left', () => { doc.updateArrow(r.id, { textLook: { align: { below: 'left' } } }); lineUpText(doc, m, doc.arrows.get(r.id)!); });
    expect(startOf().t1).toBeCloseTo(above().t1, 1);
    doc.edit('right', () => { doc.updateArrow(r.id, { textLook: { align: { below: 'right' } } }); lineUpText(doc, m, doc.arrows.get(r.id)!); });
    expect(startOf().t2).toBeCloseTo(above().t2, 1);
    expect(arrowTexts(doc, m, doc.arrows.get(r.id)!).below[0].justify).toBe('right');
  });
});

describe('the Results line', () => {
  it('goes under the text below the arrow, and is still text below it in the step', () => {
    const doc = new Doc();
    const m = plainMeasure(doc);
    const r = arrow(doc);
    doc.edit('t', () => {
      setSideText(doc, m, r, 'above', 'NaH');
      setSideText(doc, m, doc.arrows.get(r.id)!, 'below', 'DMF, 0 °C');
      setSideText(doc, m, doc.arrows.get(r.id)!, 'results', '85%, 92% ee');
    });
    const now = doc.arrows.get(r.id)!;
    const t = arrowTexts(doc, m, now);
    expect(t.below.map((c) => plainText(c.runs))).toEqual(['DMF, 0 °C']);
    expect(t.results.map((c) => plainText(c.runs))).toEqual(['85%, 92% ee']);
    expect(t.results[0].results).toBe(true);
    const f = arrowFrame(now);
    const below = inFrame(f, m.captionBox(t.below[0])), res = inFrame(f, m.captionBox(t.results[0]));
    const sp = spacing(doc.style.bondLength);
    // its top is the Results gap under the text below
    expect(below.s1 - res.s2).toBeCloseTo(sp.results, 3);
    // a reaction step (and ChemDraw) sees it as text below the arrow
    const roles = interpretArrow(now, schemeItems(doc, m), doc.style.bondLength);
    expect(roles.below).toContain('c' + t.results[0].id);
  });
  it('keeps its place under the text below through Clean Up Reaction', () => {
    const doc = new Doc();
    const m = plainMeasure(doc);
    const r = arrow(doc);
    doc.edit('structures', () => {
      const a = doc.addAtom(70, 100), b = doc.addAtom(82, 100); doc.addBond(a.id, b.id);
      const c = doc.addAtom(190, 100), d = doc.addAtom(202, 100); doc.addBond(c.id, d.id);
    });
    doc.edit('t', () => {
      setSideText(doc, m, r, 'below', 'DMF\n0 °C to rt');
      setSideText(doc, m, doc.arrows.get(r.id)!, 'results', '85%');
    });
    const plan = planCleanUp(doc, m);
    if (plan) applySchemePlan(doc, m, plan);
    const now = doc.arrows.get(r.id)!;
    const t = arrowTexts(doc, m, now);
    const f = arrowFrame(now);
    const below = inFrame(f, m.captionBox(t.below[0])), res = inFrame(f, m.captionBox(t.results[0]));
    expect(below.s1 - res.s2).toBeCloseTo(spacing(doc.style.bondLength).results, 3);
  });
  it('offers its guide only once there is text below', () => {
    const doc = new Doc();
    const m = plainMeasure(doc);
    const r = arrow(doc);
    const empty = helperBox(doc, r, 'results', m);
    doc.edit('t', () => setSideText(doc, m, r, 'below', 'THF\n−78 °C'));
    const now = doc.arrows.get(r.id)!;
    const under = helperBox(doc, now, 'results', m);
    const lowest = Math.max(...arrowTexts(doc, m, now).below.map((c) => m.captionBox(c).y2));
    expect(under.y1).toBeGreaterThan(lowest);
    expect(under.y1).toBeGreaterThan(empty.y1);
  });
  it('is saved in CDXML and opened again as the Results line, with the arrow\'s own alignment', () => {
    const doc = new Doc();
    const m = plainMeasure(doc);
    const r = arrow(doc, { textLook: { align: { results: 'right' }, guides: false } });
    doc.edit('t', () => {
      setSideText(doc, m, r, 'below', 'DMF');
      setSideText(doc, m, doc.arrows.get(r.id)!, 'results', '91% yield');
    });
    doc.edit('style', () => { doc.style = { ...doc.style, resultsTextSize: 8, resultsTextFont: 'Times New Roman', scheme: { resultsGap: 4, textAlignResults: 'left', listLeft: false } }; });
    const back = readCdxml(writeCdxml(doc)).doc;
    const ra = [...back.arrows.values()][0];
    expect(ra.textLook).toEqual({ align: { results: 'right' }, guides: false });
    const caps = [...back.captions.values()];
    expect(caps.find((c) => plainText(c.runs) === '91% yield')?.results).toBe(true);
    expect(caps.find((c) => plainText(c.runs) === 'DMF')?.results).toBeUndefined();
    expect(back.style.resultsTextSize).toBe(8);
    expect(back.style.resultsTextFont).toBe('Times New Roman');
    expect(back.style.scheme).toMatchObject({ resultsGap: 4, textAlignResults: 'left', listLeft: false });
    // ChemDraw sees ordinary text: no Results tag shows
    expect(writeCdxml(doc)).toMatch(/Chem Illustrator results[^>]*Visible="no"/);
  });
});

describe('the Results line with no text below the arrow', () => {
  // Nate's report (2026-11-24): a yield with no conditions under the arrow sat on the arrow. It
  // keeps at least one line of the text below the arrow clear of it (single spacing, 1.15 times
  // the size), or the distance set in Settings > Schemes or the drawing style.
  const lowered = (doc: Doc, m = plainMeasure(doc)) => {
    const now = [...doc.arrows.values()][0];
    const res = arrowTexts(doc, m, now).results[0];
    return inFrame(arrowFrame(now), m.captionBox(res)).s2;
  };
  it('sits one line of text below the arrow when typed', () => {
    const doc = new Doc();
    const m = plainMeasure(doc);
    const r = arrow(doc);
    doc.edit('t', () => { setSideText(doc, m, r, 'above', 'Reagents'); setSideText(doc, m, doc.arrows.get(r.id)!, 'results', '58%'); });
    const line = (doc.style.arrowTextSize ?? doc.style.captionSize) * 1.15;
    expect(-lowered(doc, m)).toBeCloseTo(line, 3);
    // and it is still text below the arrow in the step
    const roles = interpretArrow(doc.arrows.get(r.id)!, schemeItems(doc, m), doc.style.bondLength);
    expect(roles.below).toHaveLength(1);
  });
  it('keeps that distance through Clean Up Reaction, and its guide starts there', () => {
    const doc = new Doc();
    const m = plainMeasure(doc);
    const r = arrow(doc);
    const guide = helperBox(doc, r, 'results', m);
    const line = (doc.style.arrowTextSize ?? doc.style.captionSize) * 1.15;
    expect(guide.y1 - r.tail.y).toBeCloseTo(line, 3);
    doc.edit('structures', () => {
      const a = doc.addAtom(70, 100), b = doc.addAtom(82, 100); doc.addBond(a.id, b.id);
      const c = doc.addAtom(190, 100), d = doc.addAtom(202, 100); doc.addBond(c.id, d.id);
    });
    doc.edit('t', () => setSideText(doc, m, doc.arrows.get(r.id)!, 'results', '85%'));
    // knocked onto the arrow, then tidied
    const res = arrowTexts(doc, m, doc.arrows.get(r.id)!).results[0];
    doc.edit('nudge', () => doc.updateCaption(res.id, { y: res.y - 6 }));
    const plan = planCleanUp(doc, m);
    if (plan) applySchemePlan(doc, m, plan);
    expect(-lowered(doc, m)).toBeCloseTo(line, 3);
  });
  it('follows the distance set in Settings > Schemes, and the drawing style\'s before it', () => {
    setSchemePrefs({ resultsMin: 20 });
    const doc = new Doc();
    const m = plainMeasure(doc);
    const r = arrow(doc);
    doc.edit('t', () => setSideText(doc, m, r, 'results', '58%'));
    expect(-lowered(doc, m)).toBeCloseTo(20, 3);
    doc.edit('style', () => { doc.style = { ...doc.style, scheme: { resultsMin: 30 } }; });
    doc.edit('again', () => lineUpText(doc, m, doc.arrows.get(r.id)!));
    expect(-lowered(doc, m)).toBeCloseTo(30, 3);
    // far out, it is still this arrow's text below
    const roles = interpretArrow(doc.arrows.get(r.id)!, schemeItems(doc, m), doc.style.bondLength);
    expect(roles.below).toHaveLength(1);
    // and the drawing style's distance is saved with the drawing
    expect(readCdxml(writeCdxml(doc)).doc.style.scheme).toMatchObject({ resultsMin: 30 });
  });
  it('is only a least distance: with text below, the Results gap goes under that text', () => {
    const doc = new Doc();
    const m = plainMeasure(doc);
    const r = arrow(doc);
    doc.edit('t', () => { setSideText(doc, m, r, 'below', 'THF\n−78 °C\n2 h'); setSideText(doc, m, doc.arrows.get(r.id)!, 'results', '85%'); });
    const now = doc.arrows.get(r.id)!;
    const t = arrowTexts(doc, m, now);
    const f = arrowFrame(now);
    const below = inFrame(f, m.captionBox(t.below[0])), res = inFrame(f, m.captionBox(t.results[0]));
    expect(below.s1 - res.s2).toBeCloseTo(spacing(doc.style.bondLength).results, 3);
  });
});

describe('text guides', () => {
  it('show only on plain reaction arrows unless turned on', () => {
    const doc = new Doc();
    expect(takesHelpers(arrow(doc))).toBe(true);
    for (const look of [{ line: 'dashed' as const }, { headType: 'hollow' as const }, { equilibrium: true, headStyle: 'halfLeft' as const, tailStyle: 'halfLeft' as const }, { noGo: true }, { shaftSpacing: 4, headType: 'angle' as const }, { dipole: true }, { tailStyle: 'full' as const }]) {
      const r = arrow(doc, look);
      expect(plainReactionArrow(r)).toBe(false);
      expect(takesHelpers(r)).toBe(false);
      expect(takesHelpers({ ...r, textLook: { guides: true } })).toBe(true);
    }
    // turned off on a plain one
    expect(guidesOn({ ...arrow(doc), textLook: { guides: false } })).toBe(false);
    // curved arrows never show them
    expect(takesHelpers(arrow(doc, { sweep: 1, textLook: { guides: true } }))).toBe(false);
  });
});
