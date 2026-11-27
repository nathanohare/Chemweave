// @vitest-environment jsdom
//
// Review batch 19, the built-in User Guide: emptying the search box keeps the cursor in it (F156),
// links to files above docs/ open the right GitHub address (F712), a `#` comment line in a code
// block is not a search result (F714), and a jump within the open page is not a Back step (F713).

import { describe, it, expect } from 'vitest';
import { GuideWindow, resolveLink } from '../src/ui/guide-window';

(Element.prototype as { scrollIntoView?: () => void }).scrollIntoView ??= () => {};
const tick = () => new Promise((r) => setTimeout(r, 0));
async function opened(page = 'README.md', anchor = '') {
  document.body.replaceChildren();
  // jsdom has no CSS.escape; the ids used here need none
  (globalThis as { CSS?: unknown }).CSS ??= { escape: (s: string) => s };
  const opens: string[] = [];
  const g = new GuideWindow((u) => opens.push(u));
  await g.open(page, anchor);
  const el = document.querySelector<HTMLElement>('.guide-window')!;
  return { g, opens, el, search: el.querySelector<HTMLInputElement>('.gw-search')!, article: el.querySelector<HTMLElement>('.gw-page')!, back: el.querySelector<HTMLButtonElement>('.gw-back')! };
}
const typeIn = (search: HTMLInputElement, v: string) => { search.focus(); search.value = v; search.dispatchEvent(new Event('input')); };

describe('F156: the search box keeps the cursor when it is emptied', () => {
  it('leaves focus in the box after the last letter is deleted', async () => {
    const { search, article } = await opened();
    typeIn(search, 'bond');
    await tick();
    expect(document.activeElement).toBe(search);
    typeIn(search, '');
    await tick(); await tick();
    expect(document.activeElement).toBe(search);
    expect(article.querySelector('.gw-hits')).toBeNull(); // the page is back
  });
});

describe('F712: links above docs/ go to the right place on GitHub', () => {
  it('says where in the repository a link out of docs/ points', () => {
    expect(resolveLink('developers.md', '../TECH-DECISION.md')).toEqual({ page: 'TECH-DECISION.md', anchor: '', outside: 'TECH-DECISION.md' });
    expect(resolveLink('developers.md', '../CONTRIBUTING.md#what-not-to-contribute')).toEqual({ page: 'CONTRIBUTING.md', anchor: 'what-not-to-contribute', outside: 'CONTRIBUTING.md' });
    expect(resolveLink('guide/drawing.md', '../../changes/README.md')).toEqual({ page: 'changes/README.md', anchor: '', outside: 'changes/README.md' });
    // a link that stays inside docs/ is unchanged
    expect(resolveLink('guide/slides.md', '../README.md')).toEqual({ page: 'README.md', anchor: '' });
  });
  it('opens the file at the top of the repository when it is clicked', async () => {
    const { opens, article } = await opened('developers.md');
    const a = [...article.querySelectorAll('a')].find((x) => x.getAttribute('href')?.startsWith('../CONTRIBUTING.md'))!;
    expect(a).toBeTruthy();
    a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(opens).toHaveLength(1);
    expect(opens[0]).toMatch(/\/blob\/main\/CONTRIBUTING\.md#what-not-to-contribute$/);
    expect(opens[0]).not.toContain('/docs/');
  });
});

describe('F714: a comment line in a code block is not a heading in the search', () => {
  it('finds no section called PowerShell (it is a comment in a code block of developers.md)', async () => {
    const { search, article } = await opened();
    typeIn(search, 'powershell');
    await tick();
    const found = [...article.querySelectorAll('.gw-hits a')].map((a) => a.textContent);
    expect(found).not.toContain('PowerShell');
  });
});

describe('F713: a jump to a heading on the same page is not a Back step', () => {
  it('goes back to the page before, not to the same page again', async () => {
    const { article, back } = await opened('README.md');
    // open a second page from the contents list, then jump to one of its own headings
    const list = document.querySelector<HTMLElement>('.gw-list')!;
    list.querySelector<HTMLButtonElement>('button[data-page="guide/drawing.md"]')!.click();
    await tick(); await tick();
    expect(back.disabled).toBe(false);
    const h = article.querySelector('h2')!;
    const a = document.createElement('a');
    a.setAttribute('href', `#${h.id}`);
    a.textContent = 'here';
    article.append(a);
    a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await tick(); await tick();
    back.click();
    await tick(); await tick();
    expect(document.querySelector('.gw-list button.on')!.getAttribute('data-page')).toBe('README.md');
    expect(back.disabled).toBe(true);
  });
});
