// @vitest-environment jsdom
//
// Knowledge Base polish from Nate's review: formulas with subscripts and nuclei with superscripts
// (shown only: the data stays plain text), the NMR solvent the spectrum was taken in (for imported
// tables), ⓘ notes on rated columns, and pictures of the Hammett groups.

import { describe, expect, it } from 'vitest';
import { prettyChem } from '../src/kb/pretty';
import { HAMMETT } from '../src/kb/hammett';
import { HAMMETT_TABLE, groupPicture } from '../src/kb/hammett-table';
import { SOLVENTS_TABLE } from '../src/kb/solvents';
import { REAGENT_SAFETY } from '../src/kb/safety-tables';
import { findRows, tableTsv } from '../src/kb/tables';
import { matchSolvent } from '../src/ui/knowledge-base';
import { templateIcon } from '../src/ui/template-icons';
import { svgNode } from '../src/ui/svg-node';

describe('chemistry written properly', () => {
  it('subscripts the counts in formulas', () => {
    expect(prettyChem('CDCl3')).toBe('CDCl₃');
    expect(prettyChem('H2O and C5D5N')).toBe('H₂O and C₅D₅N');
    expect(prettyChem('(CD3)2SO')).toBe('(CD₃)₂SO');
    expect(prettyChem('Pd(PPh3)4')).toBe('Pd(PPh₃)₄');
    expect(prettyChem('dry over CaH2, then N2')).toBe('dry over CaH₂, then N₂');
    expect(prettyChem('DMSO-d6, THF-d8')).toBe('DMSO-d₆, THF-d₈');
    expect(prettyChem('oral LD50')).toBe('oral LD₅₀');
  });

  it('leaves labels, hazard codes and mechanisms alone', () => {
    for (const s of ['H225', 'C2a', 'H3', 'SN2', 'E1', 'Class 2', 'Table 1', '2,6-lutidine', 'pH 7']) expect(prettyChem(s)).toBe(s);
  });

  it('superscripts a nucleus before NMR, and anywhere in a heading', () => {
    expect(prettyChem('1H NMR and 13C NMR')).toBe('¹H NMR and ¹³C NMR');
    expect(prettyChem('2H')).toBe('2H');
    expect(prettyChem('1H (ppm)', true)).toBe('¹H (ppm)');
    expect(prettyChem('13C', true)).toBe('¹³C');
    expect(prettyChem('2H', true)).toBe('²H');
  });
});

describe('the solvent the NMR was taken in', () => {
  it('matches a solvent under its other names', () => {
    const values = ['Acetone-d6', 'CD3CN', 'CDCl3', 'DMSO-d6', 'CD3OD', 'THF-d8', 'Toluene-d8', 'D2O'];
    expect(matchSolvent(values, 'Chloroform-d')).toBe('CDCl3');
    expect(matchSolvent(values, 'cdcl3')).toBe('CDCl3');
    expect(matchSolvent(values, 'Methanol-d4')).toBe('CD3OD');
    expect(matchSolvent(values, 'Dimethyl sulfoxide-d6')).toBe('DMSO-d6');
    expect(matchSolvent(values, 'Benzene-d6')).toBe(null);
  });
});

describe('ⓘ notes on rated columns', () => {
  it('says what each rating means and that it is not a green ranking', () => {
    const ich = SOLVENTS_TABLE.columns.find((c) => c.key === 'ich')!;
    expect(ich.info).toMatch(/residual-solvent/);
    expect(ich.info).toMatch(/not a green/);
    const tier = REAGENT_SAFETY.columns.find((c) => c.key === 'tier')!;
    expect(tier.info).toMatch(/not how green/i);
    expect(HAMMETT_TABLE.columns.filter((c) => c.info).length).toBeGreaterThanOrEqual(2);
  });
});

describe('Hammett group pictures', () => {
  it('draws every group with a structure, attached by a wavy line', () => {
    // ferrocenyl (a sandwich RDKit can't lay out flat) and the two salts are written with dots: no drawing
    const missing = HAMMETT.filter((x) => x.smiles && !x.smiles.includes('.') && !groupPicture(x.group)).map((x) => x.group);
    expect(missing).toEqual([]);
    const cf3 = groupPicture('CF3')!;
    expect(cf3.atoms.filter((a) => a[2] === 'F')).toHaveLength(3);
    expect(cf3.stubs).toHaveLength(1);
    const svg = templateIcon(cf3, 48, 14);
    expect(svg).toContain('<svg');
    expect(svg).toMatch(/<path[^>]*d="M/);
    // built with DOM calls in the window (no innerHTML): the wavy line and the F labels survive
    const node = svgNode(svg)!;
    expect(node.querySelector('path')?.getAttribute('d')).toMatch(/^M/);
    expect([...node.querySelectorAll('text')].map((t) => t.textContent)).toContain('F');
  });

  it('shows the picture first, and leaves it out of a copied table', () => {
    expect(HAMMETT_TABLE.columns[0].picture).toBe(true);
    expect(HAMMETT_TABLE.picture?.(HAMMETT_TABLE.rows[0])).not.toBeNull();
    expect(tableTsv(HAMMETT_TABLE, []).split('\t')[0]).toBe('Group');
  });
});

// ---- review F7a: charges raised, every shown text checked by the wording lint, search across subscripts
import { BUILT_IN_TABLES, LATER_ROWS, LATER_TABLES } from '../src/kb/data';
import { KnowledgeBaseWindow, type KnowledgeBaseHost } from '../src/ui/knowledge-base';
// @ts-expect-error: a plain JavaScript script, no types
import { flatFormulas } from '../scripts/lint-ui-text.mjs';

describe('charges and the rest of a formula', () => {
  it('raises a charge written flat after a formula or a common ion', () => {
    expect(prettyChem('The NH3+ of the zwitterion')).toBe('The NH₃⁺ of the zwitterion');
    expect(prettyChem('Na+ and SO4- ions')).toBe('Na⁺ and SO₄⁻ ions');
    expect(prettyChem('DBU-H+')).toBe('DBU-H⁺');
    expect(prettyChem('Conjugate acid (Me3N+–OH)')).toBe('Conjugate acid (Me₃N⁺–OH)');
    expect(prettyChem('C18H31O3-')).toBe('C₁₈H₃₁O₃⁻');
  });

  it('leaves hyphens, locants and hazard codes alone', () => {
    for (const s of ['C-H', 'N-methyl', 'C- or N-terminal', 'H360FD', 'H360Df', 'O1-ethyl', 'N2-acetylguanine']) expect(prettyChem(s)).toBe(s);
    expect(prettyChem('O1-ethyl O3-(2-methylpropyl) ester')).toBe('O1-ethyl O3-(2-methylpropyl) ester');
  });

  it('writes big formulas, group counts and Boc₂O with subscripts', () => {
    expect(prettyChem('C95H142O28')).toBe('C₉₅H₁₄₂O₂₈');
    expect(prettyChem('2,4,6-Ph3-pyridinium')).toBe('2,4,6-Ph₃-pyridinium');
    expect(prettyChem('Boc2O')).toBe('Boc₂O');
  });
});

describe('Knowledge Base text as shown', { timeout: 60000 }, () => {
  it('has no formula written flat anywhere (titles, notes, headings, sources and every shown cell)', async () => {
    const tables = [...BUILT_IN_TABLES, ...(await Promise.all(LATER_TABLES.map((f) => f())))];
    const extra = await Promise.all(LATER_ROWS.map(async (l) => ({ table: l.table, rows: await l.rows() })));
    const flat: string[] = [];
    const check = (where: string, s: unknown) => {
      if (typeof s === 'string' && s) for (const f of flatFormulas(prettyChem(s)) as string[]) flat.push(`${where}: ${f} in "${s.slice(0, 80)}"`);
    };
    for (const t of tables) {
      check(`${t.id} title`, t.title);
      check(`${t.id} about`, t.about);
      for (const c of t.columns) { check(`${t.id} heading`, c.label); check(`${t.id} note`, c.info); }
      for (const s of t.sources) check(`${t.id} source`, s.label);
      // what each row shows: its visible columns (atom labels such as H2 are not formulas)
      const shown = t.columns.filter((c) => !c.hidden && !c.picture && c.key !== 'atom');
      for (const r of [...t.rows, ...extra.filter((e) => e.table === t.id).flatMap((e) => e.rows)]) {
        for (const c of shown) { const v = r[c.key]; check(`${t.id} ${c.key}`, typeof v === 'object' && v && 'text' in v ? v.text : v); }
      }
    }
    expect(flat).toEqual([]);
    // the check finds a flat formula that is shown without prettyChem (a planted NO2), and not once it is shown through it
    expect(flatFormulas('Search by group (NO2, OMe)')).toEqual(['NO2']);
    expect(flatFormulas(prettyChem('Search by group (NO2, OMe)'))).toEqual([]);
  });

  it('finds a row whether the search or the cell has the subscripts', () => {
    const heavy = (q: string) => findRows(SOLVENTS_TABLE, q).map((m) => m.row.name);
    expect(heavy('D2O')).toContain('Deuterium oxide');
    expect(heavy('D₂O')).toContain('Deuterium oxide');
    expect(findRows(SOLVENTS_TABLE, 'CDCl₃').length).toBe(findRows(SOLVENTS_TABLE, 'CDCl3').length);
  });

  it('writes the formulas in the table list, the table tooltips and the sort tooltips', async () => {
    if (!HTMLDialogElement.prototype.show) HTMLDialogElement.prototype.show = function () { this.open = true; };
    if (!HTMLDialogElement.prototype.close) HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new Event('close')); };
    const host: KnowledgeBaseHost = {
      flash: () => {}, readImported: async () => null, writeImported: async () => {}, pickTable: async () => null, copyText: async () => {}, openUrl: () => {},
      canonical: async () => null, layout: { get: () => undefined, set: () => {} },
    };
    await new KnowledgeBaseWindow(host).open();
    const tab = [...document.querySelectorAll<HTMLElement>('.kb-tab')].find((b) => b.textContent?.startsWith('Hammett'))!;
    expect(tab.title).toContain('NO₂');
    expect(tab.title).not.toMatch(/NO2/);
    const text = [...document.querySelectorAll<HTMLElement>('.kb-window [title]')].map((e) => e.title).join('\n');
    expect(flatFormulas(text)).toEqual([]);
    document.body.replaceChildren();
  });
});
