// Font group parity, first part (retrospective audit G5-26, S17): the formula-style button has the
// same picture and tip in every mode, and sits before Strikethrough in Document and Presentation alike.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = (f: string) => readFileSync(join(__dirname, '..', f), 'utf8');

describe('Font group parity (G5-26)', () => {
  const html = src('index.html');
  it('one picture and one tip for formula style', () => {
    expect(src('src/ui/text-bar.ts')).toContain("button(g, 'formula', 'C₉H₈', 'Formula style: numbers lowered (CH₂Cl₂), charges raised',");
    for (const a of ['data-doc="doc-formula"', 'data-sl-fmt="formula"', 'data-sh="format-chem"']) {
      const at = html.indexOf(a);
      expect(html.slice(at, html.indexOf('</button>', at)), a).toMatch(/>C₉H₈$/);
    }
  });
  it('formula style before Strikethrough in Document and Presentation', () => {
    expect(html.indexOf('data-doc="doc-formula"')).toBeLessThan(html.indexOf('data-doc="doc-strike"'));
    expect(html.indexOf('data-sl-fmt="formula"')).toBeLessThan(html.indexOf('data-sl-fmt="strike"'));
  });
});
