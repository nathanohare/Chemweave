// Project Settings ▸ Styles: the compiled SI's styles as changed, kept in chemweave-styles.json and
// put on the styles each time the SI is compiled.

import { describe, expect, it } from 'vitest';
import { applyStyleLooks, listedStyleOf, parseStyleLooks, styleDefault, styleLooksJson } from '../src/si/si-styles';
import { defaultStyles } from '../src/document/document';

describe('SI styles', () => {
  it('reads back what it writes, leaving out what is out of range', () => {
    const looks = { Normal: { font: 'Arial', size: 12 }, Heading1: { color: '#1f3864', align: 'center' as const } };
    expect(parseStyleLooks(styleLooksJson(looks))).toEqual(looks);
    expect(parseStyleLooks('{"styles":{"Normal":{"size":9999,"line":1.5,"color":"red"}}}')).toEqual({ Normal: { line: 1.5 } });
    expect(parseStyleLooks('nope')).toBeNull();
  });

  it('the numbered compound titles and SI headings follow their listed style', () => {
    expect(listedStyleOf('SICompound3')).toBe('SICompound');
    expect(listedStyleOf('SIHeading2')).toBe('Heading2');
    const styles = { ...defaultStyles(), SICompound2: { ...styleDefault('SICompound'), id: 'SICompound2' }, SIHeading1: { ...defaultStyles().Heading1, id: 'SIHeading1' } };
    applyStyleLooks(styles, { SICompound: { size: 12 }, Heading1: { italic: true } });
    expect(styles.SICompound2.size).toBe(12);
    expect(styles.SICompound2.bold).toBe(true);
    expect(styles.SIHeading1.italic).toBe(true);
    expect(styles.Heading1.italic).toBe(true);
  });
});

describe('styles made from Normal', () => {
  it('Compound Title starts from Normal as set, with its own size and bold', () => {
    const d = styleDefault('SICompound', { italic: true, font: 'Arial' });
    expect(d.italic).toBe(true);
    expect(d.font).toBe('Arial');
    expect(d.bold).toBe(true);
    expect(d.size).toBe(11);
  });
});
