// Code review 2026-11-26, batch 05 (SI builder): the manuscript checked against its SI. The SI
// here is made up in the test (no chemistry values: IDs, yields and ee as typed text).
import { describe, expect, it } from 'vitest';
import { DocBuilder } from '../src/io/doc-build';
import { checkAgainstSi, linkTypedIds, mentionCounts, useSiValue, type SiData, type SiView } from '../src/si/manuscript';
import type { SiTarget } from '../src/si/compile-doc';
import type { DocText } from '../src/document/document';

const target = (key: string, label: string): SiTarget => ({ key, kind: 'compound', label, caption: '', mark: '' });
function view(data: Record<string, SiData>, labels: Record<string, string>): SiView {
  return { title: 'SI', targets: Object.entries(labels).map(([k, l]) => target(k, l)), pages: new Map(), data: new Map(Object.entries(data)) };
}
const cell = (text: string, look = {}) => ({ runs: text ? [{ text, ...look }] : [] });
const bold = { bold: true };

/** A paragraph and a table with columns Entry, Product and `col`, one row per [id, value]. */
function table(col: string, rows: [string, string][]): DocText {
  const b = new DocBuilder();
  b.text('Table 1. Scope', {});
  b.endPara({});
  b.table({ kind: 'table', table: { cols: [60, 60, 60], head: 1, rows: [[cell('Entry'), cell('Product'), cell(col)], ...rows.map(([id, v], i) => [cell(String(i + 1)), cell(id, bold), cell(v)])] } }, {});
  return b.finish({});
}

describe('F215: table cells with no value', () => {
  const v = view({ k3a: { name: 'x' }, k3b: { name: 'y' } }, { k3a: '3a', k3b: '3b' });
  it('a dash, "n.d." or "trace" is not compared with an empty SI value', () => {
    expect(checkAgainstSi(table('ee (%)', [['3a', '–'], ['3b', 'n.d.']]), v).filter((f) => f.what === 'ee')).toEqual([]);
    expect(checkAgainstSi(table('yield (%)', [['3a', 'n.d.'], ['3b', 'trace']]), v).filter((f) => f.what === 'yield')).toEqual([]);
  });
  it('a number is still reported when the SI has none', () => {
    const found = checkAgainstSi(table('yield (%)', [['3a', '92']]), v).filter((f) => f.what === 'yield');
    expect(found).toMatchObject([{ level: 'problem', si: 'empty' }]);
  });
});

describe('F926: Use SI Value keeps one sign and one % sign', () => {
  const run = (cellText: string, si: string): string => {
    const t = table('yield', [['2a', cellText]]);
    const f = checkAgainstSi(t, view({ k2a: { yield: si } }, { k2a: '2a' })).find((x) => x.what === 'yield')!;
    const fixed = useSiValue(t, f)!;
    const o = Object.values(fixed.objects).find((x) => x.kind === 'table') as Extract<DocText['objects'][number], { kind: 'table' }>;
    return o.table.rows[1][2].runs.map((r) => r.text).join('');
  };
  it('">95" with the SI\'s ">99" becomes ">99"', () => { expect(run('>95', '>99')).toBe('>99'); });
  it('"95%" with the SI\'s "quant." becomes "quant."', () => { expect(run('95%', 'quant.')).toBe('quant.'); });
  it('"90%" with the SI\'s 85 keeps its % sign', () => { expect(run('90%', '85')).toBe('85%'); });
});

describe('F214: bold numbers in headings and the references are not compounds', () => {
  function withRefs(): DocText {
    const b = new DocBuilder();
    b.text('Results', {}); b.text(' ', {});
    b.endPara({});
    b.text('Ketone ', {}); b.text('2a', bold); b.text(' was reduced.', {});
    b.endPara({});
    b.text('2', bold); b.text(' Scope', {});
    b.endPara({ style: 'Heading2' });
    b.text('References', {});
    b.endPara({});
    // (an RSC-style entry: the volume in bold)
    b.text('J. Org. Chem., 2015, ', {}); b.text('80', bold); b.text(', 1234.', {});
    b.endPara({});
    return b.finish({});
  }
  const v = view({ k2a: { yield: '90' } }, { k2a: '2a' });
  it('gives no note for the volume or the heading number', () => {
    const found = checkAgainstSi(withRefs(), v);
    expect(found.filter((f) => f.id === '80' || f.id === '2')).toEqual([]);
  });
  it('does not count them as mentions', () => {
    const counts = mentionCounts(withRefs(), view({ k2a: {}, k80: {}, k2: {} }, { k2a: '2a', k80: '80', k2: '2' }));
    expect(counts.get('k80')).toBeUndefined();
    expect(counts.get('k2')).toBeUndefined();
    expect(counts.get('k2a')).toBe(1);
  });
});

describe('F925: a compound number linked to an SI compound that was deleted', () => {
  it('is reported as not in the SI', () => {
    const b = new DocBuilder();
    b.text('Alcohol ', {}); b.text('4a', bold); b.text(' was made.', {});
    b.endPara({});
    const { t } = linkTypedIds(b.finish({}), view({ k4a: {} }, { k4a: '4a' }));
    const found = checkAgainstSi(t, view({}, {}));
    expect(found.filter((f) => f.si === 'not in the SI').map((f) => f.id)).toEqual(['1a']);
  });
});
