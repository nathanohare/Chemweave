// Code review batch 10 (document engine): laying out table cells, headers with PAGEREF, an
// empty table of authorities, and the PDF's flipped words and links.

import { describe, it, expect } from 'vitest';
import { newDocument, objectRun, type DocObject, type DocText } from '../src/document/document';
import { DocLayouter } from '../src/document/doc-layout';
import { recordPages, turnItems } from '../src/document/doc-paint';
import { emptyToa } from '../src/document/index-toa';
import { documentMeasure } from '../src/text/font-measure';
import type { Item } from '../src/render/vector';
import type { TableData } from '../src/model';

const measure = documentMeasure((t: string, size: number) => t.length * size * 0.5);
const layouter = () => new DocLayouter({ measure, drawingSize: () => ({ w: 200, h: 100 }) });

describe('a table cell\'s paragraphs each in their own style (F495)', () => {
  it('lays body text after a heading in one run at the body text\'s size', () => {
    const d = newDocument();
    const h1 = d.styles.Heading1, N = d.styles.Normal;
    expect(h1.size).not.toBe(N.size);
    // one run over both paragraphs (the same look typed across Enter), no size of its own
    const tb: TableData = { cols: [300], rows: [[{ runs: [{ text: 'Results\nThe yield was high.' }], paras: [{ style: 'Heading1' }, {}] }]], head: 0 };
    const t: DocText = { ...d, runs: [objectRun(1, {})], paras: [{}], objects: { 1: { kind: 'table', table: tb } } };
    const lay = layouter().layout(t);
    const cell = lay.tables.get(1)!.cells[0][0]!;
    const sizes = cell.lines.map((l) => l.pieces.filter((g) => g.text.trim()).map((g) => g.size));
    expect(sizes[0].every((s) => s === h1.size)).toBe(true);
    expect(sizes[sizes.length - 1].every((s) => s === N.size)).toBe(true);
  });
});

describe('PAGEREF in a header (F503)', () => {
  it('shows the page of the bookmark, not the page the header is on', () => {
    const d = newDocument();
    const runs = [{ text: 'Page one\nPage two\nThe target' }];
    const t: DocText = {
      ...d, runs, paras: [{}, { pageBreak: true }, { pageBreak: true, marks: ['Target'] }],
      objects: { 9: { kind: 'field', code: 'pageref', target: 'Target' } as DocObject },
      hf: { ...d.hf, numbers: 'none', bodies: { header: { runs: [{ text: 'See page ' }, objectRun(9, {})], paras: [{}] } } },
    };
    const lay = layouter().layout(t);
    expect(lay.pages).toHaveLength(3);
    const shown = (page: number) => lay.hfs.find((h) => h.page === page && h.kind === 'header')!.texts.flatMap((x) => x.lines.flatMap((l) => l.pieces.map((g) => g.shown ?? g.text))).join('');
    expect(shown(0)).toContain('See page 3');
    expect(shown(1)).toContain('See page 3');
  });
});

describe('a table of authorities with nothing marked in its category (F504)', () => {
  it('shows the words on what to do, not a bare heading', () => {
    const d = newDocument();
    const t: DocText = { ...d, runs: [objectRun(1, {})], paras: [{}], objects: { 1: { kind: 'toa', cat: 1 } } };
    const lay = layouter().layout(t);
    const text = lay.text.lines.flatMap((l) => l.pieces.map((g) => g.text)).join(' ');
    expect(text.replace(/\s+/g, ' ')).toContain(emptyToa(1).split(' ').slice(0, 4).join(' '));
  });
});

describe('flipped words in the PDF (F496)', () => {
  const box = { x: 0, y: 0, w: 100, h: 50 };
  const word = (): Item => ({ kind: 'text', text: 'OH', x: 10, y: 20, size: 10, family: 'Arial', bold: false, italic: false, color: '#000', widths: [8, 7] });

  it('Flip Horizontal: the word reads from the far end of where the screen shows it', () => {
    const [it] = turnItems([word()], box, { rot: 0, flipH: true, flipV: false }) as Extract<Item, { kind: 'text' }>[];
    // mirrored about x = 50, the word covered x 10..25, so now 75..90
    expect(it.x).toBeCloseTo(75, 6);
    expect(it.y).toBeCloseTo(20, 6);
    expect(it.angle ?? 0).toBe(0);
  });

  it('Flip Vertical: the word stands on the far side of its line', () => {
    const [it] = turnItems([word()], box, { rot: 0, flipH: false, flipV: true }) as Extract<Item, { kind: 'text' }>[];
    // mirrored about y = 25, the baseline is at 30 and the letters hang below it
    expect(it.x).toBeCloseTo(10, 6);
    expect(it.y).toBeGreaterThan(30);
    expect(it.y).toBeLessThan(30 + 10);
  });

  it('a word at an angle, flipped across, turns the other way', () => {
    const [it] = turnItems([{ ...word(), angle: 30 }], box, { rot: 0, flipH: true, flipV: false }) as Extract<Item, { kind: 'text' }>[];
    expect(it.angle).toBeCloseTo(330, 6);
  });
});

describe('links in a PDF (F497)', () => {
  it('makes links in table cells and footnotes clickable', () => {
    const d = newDocument();
    const link = 'https://doi.org/10.1000/182';
    const tb: TableData = { cols: [300], rows: [[{ runs: [{ text: 'Cell link', link }] }]], head: 0 };
    const t: DocText = {
      ...d, runs: [{ text: 'Text' }, objectRun(2, {}), { text: '\n' }, objectRun(1, {})], paras: [{}, {}],
      objects: { 1: { kind: 'table', table: tb }, 2: { kind: 'note', runs: [{ text: 'Note link', link: 'https://example.org/' }], paras: [{}] } as DocObject },
    };
    const pages = recordPages(t, layouter().layout(t), () => null);
    const uris = pages.flatMap((p) => p.links ?? []).map((l) => l.uri);
    expect(uris).toContain(link);
    expect(uris).toContain('https://example.org/');
  });
});
