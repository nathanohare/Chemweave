// Review batch 17: old Excel workbooks (.xls, BIFF8), built here record by record as [MS-XLS]
// lays them out: BOUNDSHEET (2.4.28, dt 2 is a chart sheet), SUPBOOK (2.4.271, cch 0x0401 marks
// the workbook's own), EXTERNSHEET's XTI (2.5.300: iSupBook, itabFirst, itabLast counting every
// BOUNDSHEET), NAME (2.4.150, itab counting BOUNDSHEETs from 1), FORMULA (2.4.127), SHRFMLA
// (2.4.260), SST and CONTINUE (2.4.265, 2.4.58), PtgRef3d (2.5.198.85) and PtgExp (2.5.198.58).
import { describe, expect, it } from 'vitest';
import { readXls } from '../src/io/xls';
import { writeCfb } from '../src/io/cfb';

const rec = (id: number, data: number[]): number[] => [id & 0xff, id >> 8, data.length & 0xff, data.length >> 8, ...data];
const u16 = (v: number) => [v & 0xff, (v >> 8) & 0xff];
const u32 = (v: number) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff];
const f64 = (v: number) => { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, v, true); return [...b]; };
const latin = (t: string) => [...t].map((c) => c.charCodeAt(0));

const BOF = (type: number) => rec(0x0809, [...u16(0x0600), ...u16(type), ...u16(0), ...u16(0), ...u32(0), ...u32(0)]);
const EOF = rec(0x000a, []);
const NUMBER = (r: number, c: number, v: number) => rec(0x0203, [...u16(r), ...u16(c), ...u16(0), ...f64(v)]);
const BOUNDSHEET = (at: number, name: string, type = 0) => rec(0x0085, [...u32(at), 0, type, name.length, 0, ...latin(name)]);
const SUPBOOK_SELF = rec(0x01ae, [...u16(3), ...u16(0x0401)]);
// another workbook's SUPBOOK: its path and one sheet name
const SUPBOOK_OTHER = rec(0x01ae, [...u16(1), ...u16(5), 0, ...latin('o.xls'), ...u16(4), 0, ...latin('Data')]);
const EXTERNSHEET = (xti: [number, number, number][]) => rec(0x0017, [...u16(xti.length), ...xti.flatMap(([b, f, l]) => [...u16(b), ...u16(f), ...u16(l)])]);
/** A formula cell: its cached number, then its tokens. */
const FORMULA = (r: number, c: number, cached: number, rgce: number[]) => rec(0x0006, [...u16(r), ...u16(c), ...u16(0), ...f64(cached), ...u16(0), ...u32(0), ...u16(rgce.length), ...rgce]);
/** PtgRef3d to a cell, absolute. */
const REF3D = (ixti: number, r: number, c: number) => [0x3a, ...u16(ixti), ...u16(r), ...u16(c)];
/** A sheet-scoped name (itab from 1) standing for a formula. */
const NAME = (name: string, itab: number, rgce: number[]) => rec(0x0018, [...u16(0), 0, name.length, ...u16(rgce.length), ...u16(0), ...u16(itab), 0, 0, 0, 0, 0, ...latin(name), ...rgce]);

/** Globals then sheets, the BOUNDSHEET offsets worked out from the globals' own length. */
function workbook(globals: (offsets: number[]) => number[], sheets: number[][]): Uint8Array {
  const first = globals(sheets.map(() => 0)).length;
  const offsets: number[] = [];
  let at = first;
  for (const s of sheets) { offsets.push(at); at += s.length; }
  return writeCfb([['Workbook', new Uint8Array([...globals(offsets), ...sheets.flat()])]]);
}

describe('chart sheets and other workbooks in .xls references (F131)', () => {
  // tabs: Chart1 (a chart sheet), Data, Summary; Summary!A1 is =Data!A1, Summary!A2 a reference
  // into another workbook, and a name on Summary stands for Data!$A$1
  const file = () => workbook((at) => [
    ...BOF(0x0005),
    ...BOUNDSHEET(0, 'Chart1', 2), ...BOUNDSHEET(at[0], 'Data'), ...BOUNDSHEET(at[1], 'Summary'),
    ...SUPBOOK_SELF, ...SUPBOOK_OTHER,
    ...EXTERNSHEET([[0, 1, 1], [1, 0, 0]]),
    ...NAME('Total', 3, REF3D(0, 0, 0)),
    ...EOF,
  ], [
    [...BOF(0x0010), ...NUMBER(0, 0, 7), ...EOF],
    [...BOF(0x0010), ...FORMULA(0, 0, 7, REF3D(0, 0, 0)), ...FORMULA(1, 0, 9, REF3D(1, 0, 0)), ...EOF],
  ]);

  it('points a cross-sheet reference at the right worksheet', () => {
    const { book } = readXls(file());
    expect(book.sheets.map((s) => s.name)).toEqual(['Data', 'Summary']);
    expect(book.sheets[1].cell(0, 0)?.input).toBe('=Data!$A$1');
  });
  it('keeps the value of a reference into another workbook', () => {
    const { book } = readXls(file());
    expect(book.sheets[1].cell(1, 0)?.input).toBe('9');
  });
  it('puts a sheet-scoped name on its own sheet', () => {
    const { book } = readXls(file());
    const n = book.names.find((x) => x.name === 'Total');
    expect(n?.sheet?.name).toBe('Summary');
    expect(n?.formula).toBe('=Data!$A$1');
  });
});

describe('shared strings over many CONTINUE records (F605, F606)', () => {
  it('reads every string, including ones split across a CONTINUE', () => {
    // 3000 strings "s0".."s2999", 8-bit, the SST split into CONTINUE records of 100 bytes; a
    // string cut by a break carries on after the CONTINUE's own flags byte
    // 3000 strings "s0".."s2999", 8-bit, the SST split into CONTINUE records of about 100 bytes
    // between strings, and once inside s1500's characters (that CONTINUE starts with its own flags byte)
    const strings = Array.from({ length: 3000 }, (_, i) => `s${i}`);
    const parts: number[][] = [[...u32(strings.length), ...u32(strings.length)]];
    strings.forEach((t, i) => {
      const cur = parts[parts.length - 1];
      if (i === 1500) {
        cur.push(...u16(t.length), 0, ...latin(t.slice(0, 2)));
        parts.push([0, ...latin(t.slice(2))]);
        return;
      }
      if (cur.length > 100) parts.push([]);
      parts[parts.length - 1].push(...u16(t.length), 0, ...latin(t));
    });
    const recs = parts.flatMap((p, i) => rec(i ? 0x003c : 0x00fc, p));
    // a cell for the first, a middle and the last string
    const LABELSST = (r: number, i: number) => rec(0x00fd, [...u16(r), ...u16(0), ...u16(0), ...u32(i)]);
    const bytes = workbook((o) => [...BOF(0x0005), ...BOUNDSHEET(o[0], 'Data'), ...recs, ...EOF], [
      [...BOF(0x0010), ...LABELSST(0, 0), ...LABELSST(1, 1500), ...LABELSST(2, 2999), ...EOF],
    ]);
    const s = readXls(bytes).book.sheets[0];
    expect(s.cell(0, 0)?.input).toBe('s0');
    expect(s.cell(1, 0)?.input).toBe('s1500');
    expect(s.cell(2, 0)?.input).toBe('s2999');
  });
});
