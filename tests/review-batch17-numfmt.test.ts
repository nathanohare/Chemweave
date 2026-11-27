// Review batch 17: number formats. Expected texts are what Excel shows for each format, from
// Microsoft's "Number format codes" article (support.microsoft.com, "Review guidelines for
// customizing a number format": thousands separator scaling, digit placeholders, and the Special
// category's Phone Number 000-0000 and Social Security Number 000-00-0000 formats) and ECMA-376
// Part 1, 18.8.31 (numFmts).
import { describe, expect, it } from 'vitest';
import { changeDecimals, formatValue } from '../src/sheet/numfmt';

describe('thousands scaling with a decimal point (F278)', () => {
  it('scales by commas after the decimals', () => {
    // Microsoft: 0.0,, shows 12,200,000 as 12.2
    expect(formatValue(12200000, '0.0,,').text).toBe('12.2');
    expect(formatValue(1234567, '0.0,,"M"').text).toBe('1.2M');
    expect(formatValue(12200, '#,##0.0,').text).toBe('12.2');
  });
  it('scales by commas before the point', () => {
    expect(formatValue(12200, '0,.0').text).toBe('12.2');
  });
  it('still scales with no point', () => {
    // Microsoft: #, shows 12,000 as 12
    expect(formatValue(12000, '#,').text).toBe('12');
  });
});

describe('Increase and Decrease Decimal leave bracketed codes alone (F279)', () => {
  it('changes the number, not the locale code', () => {
    expect(changeDecimals('[$€-407] #,##0.00', 1)).toBe('[$€-407] #,##0.000');
    expect(changeDecimals('[$-409]0.00', -1)).toBe('[$-409]0.0');
    expect(changeDecimals('[>=100]0;0.0', 1)).toBe('[>=100]0.0;0.00');
  });
  it('skips escaped and padding characters', () => {
    expect(changeDecimals('\\0 0.0', 1)).toBe('\\0 0.00');
    expect(changeDecimals('0_0', 1)).toBe('0.0_0');
  });
});

describe('the word General in a longer format (F1116)', () => {
  it('shows the number with the text round it', () => {
    expect(formatValue(5, 'General" mg"').text).toBe('5 mg');
    expect(formatValue(5, '[Red]General').text).toBe('5');
    expect(formatValue(5, '[Red]General').color).toBe('#ff0000');
    // the negative section shows no minus of its own
    expect(formatValue(-2.5, '0;General').text).toBe('2.5');
  });
});

describe('digits split over parts with text between them (F1117)', () => {
  it('fills the phone and Social Security formats from the right', () => {
    expect(formatValue(5551234, '000-0000').text).toBe('555-1234');
    expect(formatValue(123456789, '000-00-0000').text).toBe('123-45-6789');
  });
  it('pads with zeros and puts extra digits in the first part', () => {
    expect(formatValue(1234, '000-0000').text).toBe('000-1234');
    expect(formatValue(123456789, '00-0000').text).toBe('12345-6789');
  });
  it('keeps the decimals with the part that holds the point', () => {
    expect(formatValue(1234.5, '0 000.0').text).toBe('1 234.5');
  });
});
