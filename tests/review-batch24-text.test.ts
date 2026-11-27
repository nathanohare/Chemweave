// Code review batch 24 (text measuring, Change Case, links): each test fails on the code before the fix.
//
// Widths are Arial's in thousandths of the font size. Sources: the symbols and spaces come from the
// hmtx table of Liberation Sans 2.x (SIL Open Font License), which is metric-compatible with Arial
// (read with a small table parser, not by running arialWidth); the maths signs also from Adobe's
// published Symbol font metrics (AFM): lessequal, greaterequal, notequal, approxequal, divide 549,
// infinity 713. A combining mark, a zero-width space and a control character advance nothing
// (Unicode Standard, chapter 3: combining marks and format characters are not spacing characters).

import { describe, expect, it } from 'vitest';
import { arialWidth } from '../src/text-metrics';
import { changeCase } from '../src/richtext';
import type { TextRun } from '../src/model';
import { cellLink, cellOfLink } from '../src/links';

const em = (text: string, bold = false) => arialWidth(text, 1000, bold);

describe('Arial widths of the symbols the text bar offers', () => {
  it('measures primes, arrows, maths signs and daggers, not an average letter', () => {
    expect(em('′')).toBeCloseTo(188, 0);
    expect(em('″')).toBeCloseTo(354, 0);
    expect(em('→')).toBeCloseTo(1000, 0);
    expect(em('←')).toBeCloseTo(1000, 0);
    expect(em('↔')).toBeCloseTo(1000, 0);
    expect(em('↑')).toBeCloseTo(500, 0);
    expect(em('↓')).toBeCloseTo(500, 0);
    for (const ch of '≤≥≠≈÷') expect(em(ch)).toBeCloseTo(549, 0);
    expect(em('∞')).toBeCloseTo(713, 0);
    expect(em('†')).toBeCloseTo(556, 0);
    expect(em('‡')).toBeCloseTo(556, 0);
  });

  it('measures Greek letters', () => {
    expect(em('α')).toBeCloseTo(578, 0);
    expect(em('π')).toBeCloseTo(690, 0);
    expect(em('ω')).toBeCloseTo(781, 0);
    expect(em('Δ')).toBeCloseTo(668, 0);
    expect(em('Ω')).toBeCloseTo(748, 0);
  });

  it('measures the spaces chemists put between a number and its unit', () => {
    expect(em(' ')).toBe(278); // no-break space is a space's width
    expect(em(' ')).toBe(200); // thin space
    expect(em(' ')).toBe(200); // narrow no-break space
    expect(em('25 °C')).toBeCloseTo(556 * 2 + 278 + 400 + 722, 0);
  });

  it('measures bold primes wider, as the bold face is', () => {
    expect(em('′', true)).toBeCloseTo(240, 0);
    expect(em('″', true)).toBeCloseTo(479, 0);
  });
});

describe('characters with no width', () => {
  it('a combining mark adds nothing: decomposed é is as wide as é', () => {
    expect(em('é')).toBe(em('é'));
    expect(em('Müller')).toBe(em('Müller'));
  });

  it('zero-width and control characters add nothing', () => {
    expect(em('​')).toBe(0); // zero-width space
    expect(em('‍')).toBe(0); // zero-width joiner
    expect(em('﻿')).toBe(0); // byte order mark
    expect(em('­')).toBe(0); // soft hyphen
    expect(em('\t')).toBe(0);
    expect(em('\n')).toBe(0);
    expect(em('Buchwald​-Hartwig')).toBe(em('Buchwald-Hartwig'));
  });

  it('other characters are measured as before', () => {
    // (Helvetica AFM: H 722, e 556, l 222, o 556)
    expect(em('Hello')).toBe(722 + 556 + 222 + 222 + 556);
    expect(em('A')).toBe(667);
    expect(em('é')).toBe(556);
    expect(em('漢')).toBe(556); // unknown: an average letter
  });
});

describe('Change Case after a straight quote', () => {
  const run = (text: string, mode: Parameters<typeof changeCase>[3]) => changeCase([{ text } as TextRun], 0, text.length, mode).map((r) => r.text).join('');

  it('Capitalize Each Word starts a word that follows an opening quote', () => {
    expect(run("'hello world' said the author.", 'title')).toBe("'Hello World' Said The Author.");
  });

  it('keeps an apostrophe inside a word', () => {
    expect(run("don't stop o'clock", 'title')).toBe("Don't Stop O'clock");
    expect(run('don’t', 'title')).toBe('Don’t');
  });

  it('Sentence case capitalizes the first word after an opening straight quote and lowers the rest', () => {
    expect(run("'hello World. next", 'sentence')).toBe("'Hello world. Next");
    expect(run("'HELLO'", 'sentence')).toBe("'Hello'");
  });
});

describe('a place in a workbook as Excel writes it', () => {
  it('quotes a sheet name that looks like a cell or a row and column', () => {
    expect(cellLink('S1', 'B4')).toBe("#'S1'!B4");
    expect(cellLink('Q1', 'A1')).toBe("#'Q1'!A1");
    expect(cellLink('FY2024', 'A1')).toBe("#'FY2024'!A1");
    expect(cellLink('R1C1', 'A1')).toBe("#'R1C1'!A1");
    expect(cellLink('RC', 'A1')).toBe("#'RC'!A1");
    expect(cellLink('TRUE', 'A1')).toBe("#'TRUE'!A1");
    expect(cellLink('false', 'A1')).toBe("#'false'!A1");
  });

  it('leaves ordinary names bare and reads the quoted link back', () => {
    expect(cellLink('Data', 'B4')).toBe('#Data!B4');
    expect(cellLink('Sheet1', 'B4')).toBe('#Sheet1!B4');
    expect(cellLink('Results_2', 'B4')).toBe('#Results_2!B4');
    expect(cellOfLink(cellLink('S1', 'B4'))).toEqual({ sheet: 'S1', cell: 'B4' });
  });
});
