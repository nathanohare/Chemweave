// @vitest-environment jsdom
// Import SI's reading and recognising, against SI Assistant's own results on the same made-up
// inputs (tests/fixtures/si-import/expected.json, recorded while SI Assistant's import tests ran).

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as I from '../src/si/si-import';
import * as Rd from '../src/si/si-import-read';
import * as T from '../src/si/si-import-text';
import * as F from '../src/si/si-import-refs';
import type { Run } from '../src/si/markup';

const DIR = join(__dirname, 'fixtures', 'si-import');
const expected = JSON.parse(readFileSync(join(DIR, 'expected.json'), 'utf8'));
type Case = { fn: string; args: any[]; out: any };
/**
 * SI Assistant's messages in Chemweave's UI wording (S26, S29, S70; retrospective audit G5-21):
 * the recorded results keep SI Assistant's own words, and Chemweave's port writes "Chemweave",
 * American spelling and "check", so the expected messages are reworded the same way here.
 */
const REWORD: [RegExp, string][] = [
  [/The program makes its own/g, 'Chemweave makes its own'], [/The program prints the spectra/g, 'Chemweave prints the spectra'],
  [/recognised/g, 'recognized'], [/labelled/g, 'labeled'], [/\(tick it to import/g, '(check it to import'], [/untick the ones/g, 'uncheck the ones'],
];
const reword = (v: any): any => (typeof v === 'string' ? REWORD.reduce((t, [re, to]) => t.replace(re, to), v)
  : Array.isArray(v) ? v.map(reword) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, reword(x)])) : v);
const cases: Case[] = expected.cases.map((c: Case) => ({ ...c, out: reword(c.out) }));
const file = (name: string): Uint8Array => new Uint8Array(readFileSync(join(DIR, 'files', name)));

type RunJ = [string, boolean, boolean, string, boolean];
const toRuns = (rs: RunJ[]): Run[] => rs.map(([t, b, i, v, u]) => Rd.R(t, b, i, v as Run['valign'], u));
const runsJ = (rs: Run[]): RunJ[] => rs.map((r) => [r.text, !!r.bold, !!r.italic, r.valign ?? 'normal', !!r.underline]);
const toObject = (o: any): Rd.DocObject => ({ ...o, picture: o.picture === null ? null : new Uint8Array(o.picture) });
const toPara = (d: any): Rd.Para => Rd.newPara(toRuns(d.runs), { page: d.page, heading: d.heading, size: d.size, table: d.table, top: d.top, bottom: d.bottom, cell: d.cell, left: d.left, right: d.right, columnar: d.columnar, objects: (d.objects ?? []).map(toObject) });
const r3 = (x: number): number => Math.round(x * 1000) / 1000;
const paraJ = (p: Rd.Para): any => {
  const d: any = { runs: runsJ(p.runs), page: p.page, heading: p.heading, size: r3(p.size), table: p.table, top: r3(p.top), bottom: r3(p.bottom), cell: p.cell, left: r3(p.left), right: r3(p.right), columnar: p.columnar };
  if (p.objects.length) d.objects = p.objects.map((o) => ({ kind: o.kind, prog: o.prog, name: o.name, picture: o.picture ? o.picture.length : null, picture_name: o.picture_name, group: o.group, width_in: o.width_in }));
  return d;
};
/** NMR report ids are random: compared by shape only. */
const noIds = (v: any): any => JSON.parse(JSON.stringify(v, (k, x) => (k === 'id' && typeof x === 'string' && /^r-[0-9a-f]{8}$/.test(x) ? 'r-id' : x)));
const compJ = (c: I.ImportedCompound): any => noIds({
  cid: c.cid, name: c.name, procedure: c.procedure, values: c.values, unrecognised: c.unrecognised, original: c.original, page: c.page, gp_key: c.gp_key,
  gp_values: c.gp_values, gp_sentence: c.gp_sentence, cites: c.cites, hrms_calcd: c.hrms_calcd, warnings: c.warnings, keep: c.keep, geometry: c.geometry, end: c.end,
});
const compFrom = (d: any): I.ImportedCompound => I.newCompound(d.cid, d.name, { ...JSON.parse(JSON.stringify(d)) });
const planJ = (p: I.ImportPlan): any => ({
  gps: p.gps.map((g) => ({ key: g.key, name: g.name, title: g.title, text: g.text, label: g.label, sentence: g.sentence, original: g.original, keep: g.keep, end: g.end })),
  compounds: p.compounds.map(compJ), other: p.other.map(Rd.paraMarkup), section_name: p.section_name, warnings: p.warnings,
  sequence: p.sequence.map(([k, x]) => [k, k === 'para' ? Rd.paraMarkup(x as Rd.Para) : k === 'gp' ? (x as I.ImportedGP).key : (x as I.ImportedCompound).cid]),
  body_size: p.body_size,
  sections: (p.sections as T.ImportedSection[]).map(sectionJ), references: (p.references as F.ImportedReference[]).map(refJ),
  cover: coverJ(p.cover), headings: p.headings.map(Rd.paraMarkup),
  levels: p.sequence.flatMap(([k, o], i) => (k === 'para' && p.levels.has(o as Rd.Para) ? [[i, p.levels.get(o as Rd.Para)]] : [])),
});
const figJ = (f: T.ImportedFigure): any => ({
  key: f.key, kind: f.kind, data: f.data ? f.data.length : null, ext: f.ext, caption: f.caption, label: f.label, table: f.table, page: f.page,
  top: r3(f.top), bottom: r3(f.bottom), is_table: f.is_table, keep: f.keep, width_cm: f.width_cm, below: f.below ? f.below.map(r3) : null,
  below_labels: f.below_labels, cut_below: f.cut_below,
});
const sectionJ = (s: T.ImportedSection): any => ({
  key: s.key, kind: s.kind, name: s.name, heading: s.heading, parent: s.parent, text: s.text, figures: Object.fromEntries([...s.figures].map(([k, f]) => [k, figJ(f)])),
  compounds: s.compounds.map((c) => c.cid), gps: s.gps.map((g) => g.key), keep: s.keep, note: s.note,
});
const noId = (r: any): any => { const { id: _i, ...rest } = r; return rest; };
const refJ = (r: F.ImportedReference): any => ({ number: r.number, text: r.text, ref: noId(r.ref), keep: r.keep });
const coverJ = (c: T.ImportedCover | null): any => (c ? { title: c.title, authors: c.authors, affiliations: c.affiliations, lines: c.lines, keep: c.keep } : null);
/** Group numbers count on across files in SI Assistant: compared relative to the file's first. */
const groupsRelative = (paras: any[]): any[] => {
  let first: number | null = null;
  return paras.map((p) => (p.objects ? { ...p, objects: p.objects.map((o: any) => { first ??= o.group; return { ...o, group: o.group - first! }; }) } : p));
};

const RUN: Record<string, (...a: any[]) => unknown> = {
  looks_like_name: I.looksLikeName, compound_heading: I.compoundHeading, gp_heading: I.gpHeading, nucleus_of: I.nucleusOf, adduct_text: I.adductText,
  parse_hrms: I.parseHrms, m_formula: I.mFormula, parse_ir: I.parseIr, parse_rf: I.parseRf, parse_yield: I.parseYield, parse_mp: I.parseMp,
  parse_rotation: I.parseRotation, parse_ea: I.parseEa, parse_dr: I.parseDr, parse_ee: I.parseEe, parse_ccdc: I.parseCcdc, _citations: I.citations,
  _item_spans: I.itemSpans, _is_data: I.isData, data_start: I.dataStart, sentences: I.sentences, tokens: I.tokens, _common_prefix: I.commonPrefix,
  is_id_label: I.isIdLabel, clean_space: Rd.cleanSpace,
  induce_template: (texts: string[]) => I.induceTemplate(texts),
  split_runs: (rs: RunJ[], k: number) => I.splitRuns(toRuns(rs), k).map(runsJ),
  merge_runs: (rs: RunJ[]) => runsJ(Rd.mergeRuns(toRuns(rs))),
  parse_data: (text: string, before: any) => { const c = compFrom(before); I.parseData(text, c); return compJ(c); },
  parse_compound: (cid: string, name: string, paras: any[]) => compJ(I.parseCompound(cid, name, paras.map(toPara))),
  analyse: (paras: any[]) => planJ(I.analyse(paras.map(toPara))),
  _split_run_in: (p: any) => { const [k, h, rs, rest] = I.splitRunIn(toPara(p)); return [k, h, runsJ(rs), rest ? paraJ(rest) : null]; },
  is_section_heading: (p: any, body: number) => I.isSectionHeading(toPara(p), body),
  _join_across_pages: (ps: any[]) => Rd.joinAcrossPages(ps.map(toPara)).map(paraJ),
  strip_number: T.stripNumber, _num_level: T.numLevel, _norm: T.norm, _caption_text: T.captionText, _is_table_label: T.isTableLabel,
  split_entries: F.splitEntries, _numbers: F.numbersOf, _tidy: F.tidy,
  parse_reference: (t: string) => noId(F.parseReference(t)),
  link_citations: (markup: string, numbers: Record<string, string[]>) => F.linkCitations(markup, new Map(Object.entries(numbers))),
  citation_map: (found: [string, string][], ids: Record<string, string>) => Object.fromEntries(F.citationMap(found.map(([number, text]) => ({ number, text, ref: null as any, keep: true, looked_up: '' })), new Map(Object.entries(ids).map(([k, v]) => [Number(k), v])))),
  heading_levels: (paras: any[], body: number) => { const ps = paras.map(toPara); const out = T.headingLevels(ps, body); return ps.flatMap((p, i) => (out.has(p) ? [[i, out.get(p)]] : [])); },
  _table: (cells: any[]) => T.tableOf(cells.map(toPara)),
  read_cover: (paras: any[], levels: number[]) => { const ps = paras.map(toPara); return coverJ(T.readCover(ps, new Map(levels.map((i) => [ps[i], 1])))); },
  read_docx: (f: string, name: string) => {
    const r = Rd.readSiDocx(name, file(f));
    return { error: r.error, paras: groupsRelative(r.paras.map(paraJ)), notes: r.notes };
  },
};
const OUT_FIX: Record<string, (o: any) => any> = {
  parse_data: noIds, parse_compound: noIds,
  analyse: (o) => ({ ...o, compounds: o.compounds.map(noIds) }),
  read_docx: (o) => ({ ...o, paras: groupsRelative(o.paras) }),
};

describe('Import SI: reading and recognising (parity with SI Assistant)', () => {
  for (const c of cases) {
    it(`${c.fn}(${JSON.stringify(c.args).slice(0, 90)})`, () => {
      const run = RUN[c.fn];
      expect(run, c.fn).toBeTypeOf('function');
      const want = (OUT_FIX[c.fn] ?? ((x: any) => x))(c.out);
      expect(JSON.parse(JSON.stringify(run(...JSON.parse(JSON.stringify(c.args)))))).toEqual(want);
    });
  }
});
