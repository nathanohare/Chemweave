// @vitest-environment jsdom
//
// Navigation pane: Enter in the search box goes to each result in turn. Going to a result
// selected it and moved the keys to the page, so the second Enter replaced the found word with
// a paragraph break instead of going to the next result.

import { describe, it, expect, afterEach } from 'vitest';
import { DocNav, type DocNavHost } from '../src/ui/doc-nav';
import { newDocument, type DocText } from '../src/document/document';
import type { NavHit } from '../src/document/navigation';

afterEach(() => { document.body.innerHTML = ''; });

describe('Navigation pane search', () => {
  it('Enter twice goes to the first and then the second result, the keys staying in the search box', () => {
    const t: DocText = { ...newDocument(), runs: [{ text: 'one cat, two cat' }], paras: [{}] } as DocText;
    // the page's hidden caret field, which going to a hit focuses (as the document does)
    const caret = document.createElement('textarea');
    const pageKeys: string[] = [];
    caret.addEventListener('keydown', (e) => pageKeys.push(e.key));
    const pane = document.createElement('div');
    document.body.append(pane, caret);
    const went: NavHit[] = [];
    const host: DocNavHost = {
      text: () => t,
      caretPara: () => 0,
      goToPara: () => {},
      goToHit: (h) => { went.push(h); caret.focus(); },
      apply: () => {},
      level: () => {},
      deleteBlock: () => {},
      showFound: () => {},
      resized: () => {},
      focus: () => caret.focus(),
    };
    const nav = new DocNav(pane, host);
    nav.toggle(true, true);
    const box = pane.querySelector<HTMLInputElement>('input[type="search"]')!;
    box.value = 'cat';
    box.dispatchEvent(new Event('input'));
    const enter = () => (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    enter();
    expect(document.activeElement).toBe(box);
    enter();
    expect(pageKeys).toEqual([]);
    expect(went.map((h) => h.start)).toEqual([4, 13]);
  });
});
