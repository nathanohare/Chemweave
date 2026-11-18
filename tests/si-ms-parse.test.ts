// The manuscript check's label and value parsing, against SI Assistant's own results on the same
// made-up inputs (tests/fixtures/manuscript/expected.json, written by a script that runs SI
// Assistant's core/ms_parse.py, ms_read.py and manuscript.py).

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as P from '../src/si/ms-parse';
import { dehyphenate, partName } from '../src/si/ms-read';
import { eeValue, sameDr, sameEe, sameName, sameYield } from '../src/si/ms-check';

const expected = JSON.parse(readFileSync(new URL('./fixtures/manuscript/expected.json', import.meta.url), 'utf8'));
type Case = { fn: string; args: any[]; out: any };
const cases: Case[] = expected.parse;

const q = (x: P.Quantity) => [x.kind, x.value, x.text];
const toQ = (a: any[]): P.Quantity => ({ kind: a[0], value: a[1], text: a[2] });
const plain = (v: unknown) => JSON.parse(JSON.stringify(v));
const linesOut = (lines: P.Line[]) => lines.map((L) => { const { block: _b, ...rest } = L as any; return rest; });

const RUN: Record<string, (...a: any[]) => unknown> = {
  annotateText: P.annotateText, parseValues: P.parseValues, findIds: P.findIds, erToEe: P.erToEe,
  idKey: P.idKey, idBase: P.idBase, idWithoutRac: P.idWithoutRac,
  namesWithIds: P.namesWithIds, sentenceRecords: P.sentenceRecords,
  mentionedIds: (t) => [...P.mentionedIds(t)].sort(), allTokens: (t) => [...P.allTokens(t)].sort(),
  quantities: (t) => P.quantities(t).map(q), quantitiesNoReagents: (t) => P.quantities(t, false).map(q),
  reagents: (t) => P.reagents(t).map(q), reactionPart: P.reactionPart,
  sameQuantity: (a, b) => P.sameQuantity(toQ(a), toQ(b)),
  linesAndFootnotes: (spans: P.Span[]) => {
    P.markScripts(spans);
    const lines = P.groupLines(spans);
    return { marked: spans, lines: linesOut(lines), entries: P.footnoteEntries(lines) };
  },
  labelRecords: (lines) => P.labelRecords(lines),
  assignToStructures: (boxes, blocks) => P.assignToStructures(boxes, blocks).map((g) => g.map((b) => b.text)),
  tables: (lines) => {
    const entries = P.footnoteEntries(lines);
    const tables = P.findTables(lines);
    return { entries, tables, records: tables.map(P.tableRecords), lines: linesOut(lines) };
  },
  tableRecords: (t) => P.tableRecords(t),
  footnoteEntries: (lines) => P.footnoteEntries(lines),
  footnotesFor: (entries, ys: number[]) => ys.map((y) => P.footnotesFor(entries, y)),
  dehyphenate, partName,
  sameYield, sameDr, sameName,
  eeValue: (t) => eeValue(t),
  sameEe: (a, b) => sameEe(eeValue(a)!, eeValue(b)!),
};

describe('manuscript parsing (parity with SI Assistant)', () => {
  for (const c of cases) {
    it(`${c.fn}(${JSON.stringify(c.args).slice(0, 80)})`, () => {
      const run = RUN[c.fn];
      expect(run, c.fn).toBeTypeOf('function');
      expect(plain(run(...plain(c.args)))).toEqual(c.out);
    });
  }
});
