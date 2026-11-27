// @vitest-environment jsdom
// Code review batch 07, Navigation pane.
//  F077 a caret move or a change that isn't to the text doesn't search again or build the rows again;
//  a common word lists a few hundred rows, not thousands. F476 a folded heading stays folded when
//  paragraphs are added above it, and not for another document. F477 new words start from the
//  first result. F478 Shift+Enter from the start goes to the last result.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DocNav, MOST_LISTED, type DocNavHost } from '../src/ui/doc-nav';
import { newDocument, type DocText } from '../src/document/document';
import type { NavHit } from '../src/document/navigation';

const doc = (paras: [string, string][]): DocText => {
  const n = newDocument();
  return { ...n, runs: [{ text: paras.map(([, s]) => s).join('\n') }], paras: paras.map(([style]) => ({ style })) } as DocText;
};

let t: DocText;
let file: object;
let caret = 0;
const went: NavHit[] = [];

function pane() {
  document.body.innerHTML = '';
  const el = document.createElement('div');
  document.body.append(el);
  const host: DocNavHost = {
    text: () => t, file: () => file, caretPara: () => caret, goToPara: () => {}, goToHit: (h) => { went.push(h); }, apply: () => {}, level: () => {}, deleteBlock: () => {},
    showFound: () => {}, resized: () => {}, focus: () => {},
  };
  const nav = new DocNav(el, host);
  nav.toggle(true);
  return { nav, el, box: el.querySelector<HTMLInputElement>('input[type="search"]')!, rows: () => [...el.querySelectorAll<HTMLElement>('.nav-item, .nav-hit')] };
}

beforeEach(() => {
  (globalThis as unknown as { requestAnimationFrame: (f: () => void) => number }).requestAnimationFrame = (f) => { f(); return 1; };
  file = {};
  caret = 0;
  went.length = 0;
});
afterEach(() => { document.body.innerHTML = ''; });

describe('Navigation pane search (F077)', () => {
  it('a caret move leaves the results as they are, and a change to the text searches again', () => {
    t = doc([['Normal', 'one cat'], ['Normal', 'two cat']]);
    const { nav, box, rows } = pane();
    box.value = 'cat';
    box.dispatchEvent(new Event('input'));
    const first = rows();
    expect(first).toHaveLength(2);
    // only the caret moved (the same text): the rows are the same elements
    caret = 1;
    nav.refresh();
    expect(rows()[0]).toBe(first[0]);
    // the text changed: searched again
    t = doc([['Normal', 'one cat'], ['Normal', 'two cat'], ['Normal', 'a third cat']]);
    nav.refresh();
    expect(rows()).toHaveLength(3);
  });

  it('a common word lists the first few hundred, and says so', () => {
    t = doc(Array.from({ length: MOST_LISTED + 50 }, () => ['Normal', 'the'] as [string, string]));
    const { box, rows, el } = pane();
    box.value = 'the';
    box.dispatchEvent(new Event('input'));
    expect(rows()).toHaveLength(MOST_LISTED);
    expect(el.querySelector('.nav-empty')!.textContent).toContain(String(MOST_LISTED + 50));
  });

  it('the heading the caret is under is marked without building the list again', () => {
    t = doc([['Heading1', 'First'], ['Normal', 'x'], ['Heading1', 'Second'], ['Normal', 'y']]);
    const { nav, rows } = pane();
    const before = rows();
    expect(before.map((r) => r.classList.contains('nav-here'))).toEqual([true, false]);
    caret = 3;
    nav.refresh();
    expect(rows()[0]).toBe(before[0]);
    expect(rows().map((r) => r.classList.contains('nav-here'))).toEqual([false, true]);
  });
});

describe('Folded headings (F476)', () => {
  const heads = (extra: [string, string][] = []) => doc([...extra, ['Heading1', 'Methods'], ['Heading2', 'Reagents'], ['Normal', 'x'], ['Heading1', 'Results']]);
  const labels = (rows: HTMLElement[]) => rows.map((r) => r.querySelector('.nav-label')!.textContent);

  it('stay folded when a paragraph is added above them', () => {
    t = heads();
    const { nav, rows } = pane();
    expect(labels(rows())).toEqual(['Methods', 'Reagents', 'Results']);
    rows()[0].querySelector<HTMLButtonElement>('.nav-fold')!.click();
    expect(labels(rows())).toEqual(['Methods', 'Results']);
    // a paragraph typed above: every paragraph number after it is one more
    t = heads([['Normal', 'Intro']]);
    nav.refresh();
    expect(labels(rows())).toEqual(['Methods', 'Results']);
  });

  it('are forgotten for another document', () => {
    t = heads();
    const { nav, rows } = pane();
    rows()[0].querySelector<HTMLButtonElement>('.nav-fold')!.click();
    expect(labels(rows())).toEqual(['Methods', 'Results']);
    file = {};
    t = heads();
    nav.refresh();
    expect(labels(rows())).toEqual(['Methods', 'Reagents', 'Results']);
  });
});

describe('Enter in the search box (F477, F478)', () => {
  const enter = (box: HTMLInputElement, shiftKey = false) => box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey, bubbles: true, cancelable: true }));

  it('new words start from the first result, however far the old ones had gone', () => {
    t = doc([['Normal', 'cat cat cat dog dog']]);
    const { box } = pane();
    box.value = 'cat';
    box.dispatchEvent(new Event('input'));
    enter(box); enter(box); enter(box);
    expect(went.map((h) => h.start)).toEqual([0, 4, 8]);
    went.length = 0;
    box.value = 'dog';
    box.dispatchEvent(new Event('input'));
    enter(box);
    expect(went.map((h) => h.start)).toEqual([12]);
  });

  it('Shift+Enter from the start goes to the last result', () => {
    t = doc([['Normal', 'cat cat cat']]);
    const { box } = pane();
    box.value = 'cat';
    box.dispatchEvent(new Event('input'));
    enter(box, true);
    expect(went.map((h) => h.start)).toEqual([8]);
    enter(box, true);
    expect(went.map((h) => h.start)).toEqual([8, 4]);
  });
});
