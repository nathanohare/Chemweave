// Review fix (group g2), F012: a worksheet in an old Excel workbook (.xls) with an embedded chart.
// In BIFF8 the chart is a substream nested in the worksheet's (its own BOF ... EOF, [MS-XLS]
// 2.1.7.20.6), before the sheet's MERGECELLS. The workbook is built here, record by record.

import { describe, it, expect } from 'vitest';
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
const LABEL = (r: number, c: number, t: string) => rec(0x0204, [...u16(r), ...u16(c), ...u16(0), ...u16(t.length), 0, ...latin(t)]);
const MERGECELLS = (r1: number, r2: number, c1: number, c2: number) => rec(0x00e5, [...u16(1), ...u16(r1), ...u16(r2), ...u16(c1), ...u16(c2)]);
const BOUNDSHEET = (at: number, name: string) => rec(0x0085, [...u32(at), 0, 0, name.length, 0, ...latin(name)]);

/** A workbook of one sheet: a header, a value, a merged title, and a chart of the data in between. */
function workbook(): Uint8Array {
  const sheet = [
    ...BOF(0x0010),
    ...LABEL(0, 0, 'Mass'), ...LABEL(0, 1, 'Yield'),
    ...NUMBER(1, 0, 12.5), ...NUMBER(1, 1, 87),
    ...LABEL(3, 0, 'Title'),
    // the embedded chart: its series cache is written as cells, row = point, column = series
    ...BOF(0x0020), ...NUMBER(0, 0, 999), ...LABEL(0, 1, 'cache'), ...NUMBER(1, 0, 555), ...EOF,
    ...MERGECELLS(3, 3, 0, 2),
    ...NUMBER(5, 0, 42),
    ...EOF,
  ];
  const head = (at: number) => [...BOF(0x0005), ...BOUNDSHEET(at, 'Data'), ...EOF];
  const globals = head(head(0).length);
  return writeCfb([['Workbook', new Uint8Array([...globals, ...sheet])]]);
}

describe("F012: an embedded chart's substream inside a worksheet", () => {
  it("is skipped: the sheet's cells keep their values and reading goes on after the chart", () => {
    const { book } = readXls(workbook());
    const s = book.sheet;
    expect(s.cell(0, 0)?.input).toBe('Mass');
    expect(s.cell(0, 1)?.input).toBe('Yield');
    expect(s.cell(1, 0)?.input).toBe('12.5');
    expect(s.cell(1, 1)?.input).toBe('87');
    // what comes after the chart is read
    expect(s.merges).toEqual([{ r1: 3, c1: 0, r2: 3, c2: 2 }]);
    expect(s.cell(5, 0)?.input).toBe('42');
  });
});
