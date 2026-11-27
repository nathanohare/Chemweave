// @vitest-environment jsdom
//
// The Header & Footer tab's commands work on the header being typed into: they don't close it
// first (which made Previous, Next and Link to Previous do nothing, and made Different First Page
// change the section the body's caret is in).

import { describe, it, expect } from 'vitest';
import { docMode } from './doc-mode-harness';
import { newDocument, paraFromStyle, runStyleOf, type DocText } from '../src/document/document';
import { newBreak, sectionsOf } from '../src/document/sections';
import type { DocumentMode } from '../src/ui/doc-mode';
import type { DocFile } from '../src/document/doc-file';

/** Three pages; the third starts a second section (linked to the first, as a new break is). */
function twoSections(): Partial<DocText> {
  const d = newDocument();
  const s = d.styles.Normal;
  const runs = [{ ...runStyleOf(s), text: 'page 1\npage 2\npage 3' }];
  const paras = [0, 1, 2].map((i) => ({ ...paraFromStyle(s, {}), ...(i === 1 ? { pageBreak: true } : {}) }));
  const t = { ...d, runs, paras, hf: { ...d.hf, header: ['One', '', ''] as [string, string, string] } };
  paras[2] = { ...paras[2], section: newBreak(sectionsOf(t)[0], 'nextPage') };
  return { runs, paras, hf: t.hf };
}

async function inSecondSectionHeader(): Promise<{ dm: DocumentMode; f: DocFile; page: number; before: string }> {
  const { dm, f } = await docMode(twoSections());
  f.ed.setCaret(0); // the body's caret in section 1
  const page = f.layout().pages.findIndex((p) => p.section === 1);
  expect(page).toBeGreaterThan(0);
  const before = JSON.stringify(f.t);
  (dm as unknown as { startHf(p: number, k: string): boolean }).startHf(page, 'header');
  expect(f.box?.hf?.page).toBe(page);
  return { dm, f, page, before };
}

describe('Header & Footer commands while a header is typed into', () => {
  it('Previous goes to the header before, still editing headers', async () => {
    const { dm, f, page } = await inSecondSectionHeader();
    dm.run('hf-prev');
    expect(f.box?.hf).toBeTruthy();
    expect(f.box!.hf!.page).toBeLessThan(page);
  }, 60000);

  it('Link to Previous unlinks the section being edited, in one undo step, and keeps editing', async () => {
    const { dm, f, page, before } = await inSecondSectionHeader();
    expect(sectionsOf(f.t)[1].linked).toBe(true);
    dm.run('hf-link');
    expect(sectionsOf(f.t)[1].linked).toBe(false);
    expect(f.box?.hf?.page).toBe(page);
    dm.run('hf-close');
    dm.run('undo');
    expect(JSON.stringify(f.t)).toBe(before);
  }, 60000);

  it('Different First Page changes the section being edited, not the body caret\'s', async () => {
    const { dm, f } = await inSecondSectionHeader();
    const first0 = !!sectionsOf(f.t)[0].hf.firstPage;
    const first1 = !!sectionsOf(f.t)[1].hf.firstPage;
    dm.run('hf-first');
    expect(!!sectionsOf(f.t)[1].hf.firstPage).toBe(!first1);
    expect(!!sectionsOf(f.t)[0].hf.firstPage).toBe(first0);
    expect(f.box?.hf).toBeTruthy();
  }, 60000);

  it('Go to Footer opens the footer of the page being edited', async () => {
    const { dm, f, page } = await inSecondSectionHeader();
    dm.run('hf-goto-footer');
    expect(f.box?.hf?.kind).toBe('footer');
    expect(f.box?.hf?.page).toBe(page);
  }, 60000);
});
