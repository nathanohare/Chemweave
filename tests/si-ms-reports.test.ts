// HRMS report files (SI Assistant SPEC §13n.3): each made-up file in fixtures/ms-reports is read
// as Chem SI Assistant reads it. The files and expected.json were made by SI Assistant's own test
// makers (tests/ms_samples.py) and its reader (core/ms_reports.py), so these are parity tests.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { aligned, chooseMatch, differsMessage, foundIsFromReport, headerColumns, listingFailed, parseReportText, peaksNear, readReport, reportListing, updateFound, xlsxRows, type ReportData } from '../src/si/ms-reports';
import type { Peak } from '../src/si/chem';
import { printKind } from '../src/si/spectra';

const DIR = join(__dirname, 'fixtures', 'ms-reports');
interface Expected { readable: boolean; kind: string; count: number; profile: boolean; scans: number; measured: number; calculated: number[]; message: string; match: { mz: number; ppm: number; measured: boolean; mono: boolean } | null; near: [number, number][] }
const EXPECTED = JSON.parse(readFileSync(join(DIR, 'expected.json'), 'utf8')) as { peaks: Peak[]; files: Record<string, Expected> };
const PEAKS = EXPECTED.peaks;
const read = (name: string): Promise<ReportData> => readReport(new Uint8Array(readFileSync(join(DIR, name))), name);

describe('reading report files as SI Assistant does', () => {
  for (const [name, want] of Object.entries(EXPECTED.files)) {
    it(name, async () => {
      const d = await read(name);
      expect(d.readable).toBe(want.readable);
      expect(d.kind).toBe(want.kind);
      expect(d.mz.length).toBe(want.count);
      expect(d.profile).toBe(want.profile);
      expect(d.scans).toBe(want.scans);
      expect(d.measured.size).toBe(want.measured);
      expect(d.calculated.map((v) => +v.toFixed(4))).toEqual(want.calculated.map((v) => +v.toFixed(4)));
      // (SI Assistant's messages call the app "this program"; Chemweave's say Chemweave, ui-style S70)
      expect(d.message).toBe(want.message.replace(/this program/g, 'Chemweave'));
      const m = chooseMatch([d], PEAKS, 5);
      if (!want.match) expect(m).toBeNull();
      else {
        expect(m).not.toBeNull();
        expect(m!.mz).toBeCloseTo(want.match.mz, 6);
        expect(m!.ppm).toBeCloseTo(want.match.ppm, 3);
        expect(m!.measured).toBe(want.match.measured);
        expect(m!.peak.mono).toBe(want.match.mono);
      }
      const near = want.readable ? peaksNear(d, PEAKS[0].mz) : [];
      expect(near.length).toBe(want.near.length);
      near.forEach(([mz, rel], i) => { expect(mz).toBeCloseTo(want.near[i][0], 6); expect(rel).toBeCloseTo(want.near[i][1], 3); });
    });
  }

  it('a missing file, a PDF without a text reader, and old formats say why', async () => {
    expect((await readReport(null, 'gone.pdf')).message).toMatch(/missing/);
    expect((await readReport(new TextEncoder().encode('%PDF-1.4 …'), 'r.pdf')).readable).toBe(false);
    expect((await readReport(new Uint8Array([1, 2]), 'old.xls')).message).toMatch(/\.xlsx or CSV/);
  });

  it('a PDF is read from the text its reader gives', async () => {
    const pdf = new TextEncoder().encode('%PDF-1.7\n…');
    const d = await readReport(pdf, 'report.pdf', async () => 'HRMS (ESI) m/z: [M+H]+ calcd for C12H16NO3 222.1125; found 222.1129.');
    expect(d.kind).toBe('PDF report');
    expect(d.calculated).toEqual([222.1125]);
    expect([...d.measured]).toEqual([222.1129]);
    const scanned = await readReport(pdf, 'scan.pdf', async () => '  ');
    expect(scanned.message).toMatch(/scanned picture/);
  });

  it('keywords and header columns', () => {
    const d = parseReportText('HRMS (ESI) m/z: [M+H]+ calcd for C12H16NO3 222.1125; found 222.1129.\nTheophylline 181.0720 (not a keyword)\nDate 2026.10.07 12:30:45.123, 98.765% purity');
    expect(d.calculated).toEqual([222.1125]);
    expect(d.measured.has(222.1129)).toBe(true);
    expect(d.mz).toContain(181.072);
    expect(d.mz.some((v) => Math.abs(v - 45.123) < 1e-6 || Math.abs(v - 98.765) < 1e-6)).toBe(false);
    expect(headerColumns('m/z  Abund  Formula  Calc m/z  Diff (ppm)')).toEqual(['meas', 'calc']);
    expect(headerColumns('Formula  Calc. m/z  Meas. m/z  Diff (ppm)')).toEqual(['calc', 'meas']);
    expect(headerColumns('Meas. m/z  #  Ion Formula  m/z  err [ppm]')).toEqual(['meas', 'calc']);
    expect(headerColumns('Mass  Calc. Mass  mDa  PPM  DBE  i-FIT  Formula')).toEqual(['meas', 'calc']);
    expect(headerColumns('High Resolution Mass Spectrum')).toBeNull();
    expect(headerColumns('Mass error 1.2 ppm at 222.1127')).toBeNull();
  });

  it('Excel cells are read as written', () => {
    const bytes = new Uint8Array(readFileSync(join(DIR, 'shared.xlsx')));
    expect(xlsxRows(bytes)[0][0]).toEqual(['Made-up peak list', '']);
  });
});

describe('the found m/z from the reports', () => {
  const match = { mz: 222.11293, file: 'r.csv', peak: PEAKS[0], ppm: 1.2, measured: true };

  it('fills an empty Found box, with where it came from, and follows the reports', () => {
    const v: Record<string, unknown> = { found: '' };
    expect(updateFound(v, match)).toBe('filled');
    expect(v.found).toBe('222.1129');
    expect(v.found_from).toEqual({ file: 'r.csv', mz: 222.11293 });
    expect(foundIsFromReport(v)).toBe(true);
    expect(updateFound(v, match)).toBe('');
    expect(updateFound(v, { ...match, mz: 222.1131 })).toBe('filled');
    expect(v.found).toBe('222.1131');
    expect(updateFound(v, null)).toBe('cleared');
    expect(v.found).toBe('');
    expect('found_from' in v).toBe(false);
  });

  it('never changes a typed value, and warns when it is far from the reports', () => {
    const v: Record<string, unknown> = { found: '222.1180', found_from: { file: 'r.csv', mz: 222.11293 } };
    expect(foundIsFromReport(v)).toBe(false);
    expect(updateFound(v, match)).toBe('');
    expect(v.found).toBe('222.1180');
    expect('found_from' in v).toBe(false);
    expect(differsMessage(v, match, 5)).toBe('The found m/z you typed (222.1180) is +22.8 ppm from the report\'s value (222.1129 in r.csv). Check which is right.');
    expect(differsMessage({ found: '222.1130' }, match, 5)).toBe('');
  });

  it('a measured value beats an unmarked one, the monoisotopic peak beats others', () => {
    const a = parseReportText(`${(PEAKS[0].mz * (1 + 0.5e-6)).toFixed(4)}`);
    const b = parseReportText(`found ${(PEAKS[0].mz * (1 + 3e-6)).toFixed(4)}`);
    const m = chooseMatch([a, b], PEAKS, 5)!;
    expect(m.measured).toBe(true);
    expect(m.ppm).toBeCloseTo(3, 0);
  });
});

describe('printing reports', () => {
  it('says how each kind prints', () => {
    expect(printKind('a.mzML')).toBe('peaks');
    expect(printKind('a.cdf')).toBe('peaks');
    expect(printKind('a.xlsx')).toBe('listing');
    expect(printKind('a.jdx')).toBe('listing');
    expect(printKind('a.raw')).toBe('none');
  });

  it('lists tables in aligned columns, cut with a count of what was left out', () => {
    expect(aligned([['Title'], ['m/z', 'Intensity'], ['222.1129', '1000']])).toEqual(['Title', 'm/z       Intensity', '222.1129  1000']);
    const [lines, left] = reportListing(new TextEncoder().encode('m/z,I\n' + Array.from({ length: 160 }, (_, i) => `${100 + i}.5,${i}`).join('\n')), 'p.csv');
    expect(lines.length).toBe(150);
    expect(left).toBe(11);
    expect(lines[0]).toBe('m/z    I');
    const [xl] = reportListing(new Uint8Array(readFileSync(join(DIR, 'shared.xlsx'))), 'shared.xlsx');
    expect(xl[0]).toBe('Made-up peak list');
    expect(xl[1]).toMatch(/^m\/z\s+Intensity$/);
    expect(listingFailed(reportListing(new Uint8Array([0x50, 0x4b, 3, 4, 9]), 'bad.xlsx')[0])).toBe(true);
  });
});
