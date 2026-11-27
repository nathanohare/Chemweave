// @vitest-environment jsdom
// Code review batch 25 (text on the clipboard as HTML): style values written safely (F1141), a
// line after a <br> (F1145), tabs (F1142), list numbering types (F1143) and <pre> (F1144).
import { describe, it, expect } from 'vitest';
import { richToHtml, htmlToRich } from '../src/text/html';

const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html');
const text = (html: string, opts?: { keepFonts?: boolean }) => htmlToRich(html, opts)!.runs.map((r) => r.text).join('');

describe('style values in the HTML of copied text (F1141)', () => {
  it('keeps a font name with a quote inside its style attribute', () => {
    const html = richToHtml({ runs: [{ text: 'x', font: 'Foo" onmouseover="alert(1)' }], paras: [{}] });
    const dom = parse(html);
    expect(dom.querySelectorAll('[onmouseover]')).toHaveLength(0);
    const span = dom.querySelector('span[style]')!;
    expect(span.getAttribute('style')).toContain('onmouseover');
    expect(span.textContent).toBe('x');
  });
  it('keeps a font name with a single quote inside its CSS quotes, and a color with a quote in its attribute', () => {
    const html = richToHtml({ runs: [{ text: 'x', font: "Bob's Font", color: 'red" onclick="x' }], paras: [{}] });
    const dom = parse(html);
    expect(dom.querySelectorAll('[onclick]')).toHaveLength(0);
    expect(dom.querySelector('span[style]')!.getAttribute('style')).toContain("font-family:'Bob\\'s Font'");
  });
});

describe('pasting a line after a <br> (F1145)', () => {
  it('starts the line at its first letter, not at the source\'s own line break and indent', () => {
    const got = htmlToRich('<p>Line one<br>\n  Line two</p>')!;
    expect(got.runs.map((r) => r.text).join('')).toBe('Line one\nLine two');
    expect(got.paras).toHaveLength(2);
  });
  it('keeps a space that comes after text', () => {
    expect(text('<p>Line one<br>Line <b>two</b> three</p>')).toBe('Line one\nLine two three');
  });
});

describe('tabs in copied text (F1142)', () => {
  // Word writes a tab in its HTML as <span style='mso-tab-count:1'>, and reads it back as a tab;
  // a bare tab in HTML is only white space, which shows as one space.
  it('writes a tab as Word does, not as a bare tab character', () => {
    const html = richToHtml({ runs: [{ text: 'a\tb' }], paras: [{}] });
    const dom = parse(html);
    expect(html).toContain('mso-tab-count:1');
    expect(html).not.toContain('\t');
    expect(dom.querySelector('span[style*="mso-tab-count"]')).not.toBeNull();
  });
  it('reads Word\'s tab back as a tab', () => {
    expect(text("<p>a<span style='mso-tab-count:1'>&nbsp;&nbsp;&nbsp;&nbsp; </span>b</p>")).toBe('a\tb');
    // (two tabs in a row: Word writes the count)
    expect(text("<p>a<span style='mso-tab-count:2'>&nbsp;&nbsp;&nbsp;&nbsp; </span>b</p>")).toBe('a\t\tb');
  });
});

describe('the numbering of copied ordered lists (F1143)', () => {
  // The type attribute's values are 1, a, A, i and I (HTML Living Standard, the ol element); the
  // numbering types are DrawingML's a:buAutoNum (ECMA-376 Part 1, 20.1.10.61).
  const typeOf = (numType: string, startAt?: number) => {
    const html = richToHtml({ runs: [{ text: 'x\ny' }], paras: [{ list: 'number', numType, ...(startAt ? { startAt } : {}) }, { list: 'number', numType }] });
    return parse(html).querySelector('ol')!.getAttribute('type');
  };
  it('gives uppercase letters and roman numbers their type', () => {
    expect(typeOf('alphaUcPeriod')).toBe('A');
    expect(typeOf('romanUcPeriod')).toBe('I');
    expect(typeOf('romanLcPeriod')).toBe('i');
    expect(typeOf('alphaLcPeriod')).toBe('a');
  });
  it('gives labels in brackets their type, and decimal ones none', () => {
    expect(typeOf('alphaLcParenBoth')).toBe('a');
    expect(typeOf('alphaLcParenR')).toBe('a');
    expect(typeOf('alphaUcParenR')).toBe('A');
    expect(typeOf('arabicPeriod')).toBeNull();
  });
  it('takes a lone c or d as the letter it is, from the item\'s number', () => {
    expect(typeOf('alphaLcPeriod', 3)).toBe('a');
    expect(typeOf('romanLcPeriod', 3)).toBe('i');
  });
});

describe('pasting preformatted text (F1144)', () => {
  it('keeps the line breaks, indents and tabs of a <pre> block', () => {
    const got = htmlToRich('<pre>1H NMR\n  line 2\n\tline 3\n</pre>')!;
    expect(got.runs.map((r) => r.text).join('')).toBe('1H NMR\n  line 2\n\tline 3');
    expect(got.paras).toHaveLength(3);
  });
  it('keeps them for text styled white-space:pre, and collapses ordinary text still', () => {
    expect(text('<div style="white-space:pre">a  b\nc</div>')).toBe('a  b\nc');
    expect(text('<div>a  b\nc</div>')).toBe('a b c');
  });
  it('does not turn the source\'s own line breaks between blocks in such a container into empty paragraphs', () => {
    const got = htmlToRich('<div style="white-space: pre-wrap;">\n<p>one</p>\n<p>two</p>\n</div>')!;
    expect(got.runs.map((r) => r.text).join('')).toBe('one\ntwo');
    expect(got.paras).toHaveLength(2);
  });
});
