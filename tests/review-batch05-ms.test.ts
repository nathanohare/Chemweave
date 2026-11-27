// Code review 2026-11-26, batch 05 (SI builder): the manuscript check, HRMS reports and the
// checks of the SI page. Files are made in the tests (mzXML as its schema, mzXML 3.2, defines
// it; an Excel sheet as ECMA-376 Part 1, §18.3, defines it).
import { describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { checkManuscript, compareStructures, type FactsOf } from '../src/si/ms-check';
import type { Source } from '../src/si/ms-read';
import { quantities } from '../src/si/ms-parse';
import { readMzxml, readReportBytes, reportListing } from '../src/si/ms-reports';
import { readReportFile } from '../src/si/report-files';
import { hrmsSpecies } from '../src/si/checks';
import * as chem from '../src/si/chem';
import { impurityMatch, defaultImpurityTable } from '../src/si/nmr';
import { MemoryFolder } from '../src/si/folder';
import { SiProject } from '../src/si/project';
import * as E from '../src/si/scheme-edit';

const ROOT = join(__dirname, 'fixtures', 'si-example');
function example(): MemoryFolder {
  const f = new MemoryFolder('si-example');
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name !== 'README.md') f.files.set(relative(ROOT, p).split('\\').join('/'), new Uint8Array(readFileSync(p)));
    }
  };
  walk(ROOT);
  return f;
}

describe('F927: a structure comparison the chemistry engine could not make', () => {
  it('is tried again next time', async () => {
    const mol = 'made-up-structure-F927';
    const broken: FactsOf = async () => { throw new Error('the chemistry engine restarted'); };
    expect((await compareStructures(broken, mol, mol))[0]).toBe('');
    const info = chem.infoFromCounts(chem.parseMFormulaAndCharge('C2H6O')[0], 0);
    const working: FactsOf = async (ms) => ms.map(() => ({ info, inchikey: 'AAAAAAAAAAAAAA-BBBBBBBBSA-N', pieces: [{ smiles: 'CCO', info, counterIon: false }] } as unknown as chem.MolFacts));
    expect((await compareStructures(working, mol, mol))[0]).toBe('same');
  });
});

describe('F928: manuscript data for a label on a scheme box with no compound page', () => {
  it('is reported as missing from the SI', async () => {
    const p = await SiProject.open(example());
    const k = p.schemes.find((x) => x.id === 'k-730d7f01')!;
    const box = await E.addBox(p, k, E.START);
    await E.setBoxValues(p, k, String(box.id), { label: '5' });
    const src = { file: 'ms.pdf', kind: 'pdf', records: [{ id: '5', yield: '92', where: 'Table 1' }], names: [], mentioned: [], tokens: [], notes: [], error: '', figure_text: true, pages: 1, transient: false } as unknown as Source;
    const r = await checkManuscript(p, [src], { files: 1 });
    expect(r.findings.find((x) => x.label === '5')?.kind).toBe('missing_si');
  });
});

describe('F929: "r.t." is room temperature', () => {
  it('as "rt" and "room temperature" are', () => {
    expect(quantities('Reaction run at r.t. for 48 h', false).some((q) => q.kind === 'temperature' && q.value === 'rt')).toBe(true);
    expect(quantities('stirred at r. t., then filtered', false).some((q) => q.kind === 'temperature')).toBe(true);
  });
});

/** An mzXML <peaks> payload: m/z and intensity pairs as 32-bit floats in network (big-endian) order, base64. */
function peaks(pairs: [number, number][]): string {
  const b = new Uint8Array(pairs.length * 8);
  const v = new DataView(b.buffer);
  pairs.forEach(([mz, i], k) => { v.setFloat32(8 * k, mz, false); v.setFloat32(8 * k + 4, i, false); });
  return Buffer.from(b).toString('base64');
}

describe('F931: an mzXML file with an empty scan', () => {
  it('still gives the other scans’ peaks', () => {
    const attrs = 'precision="32" byteOrder="network" contentType="m/z-int" compressionType="none"';
    const xml = '<?xml version="1.0"?><mzXML><msRun scanCount="2">'
      + `<scan num="1" msLevel="1" peaksCount="0" centroided="1"><peaks ${attrs} compressedLen="0"/></scan>`
      + `<scan num="2" msLevel="1" peaksCount="2" centroided="1"><peaks ${attrs} compressedLen="0">${peaks([[150.25, 1000], [151.25, 100]])}</peaks></scan>`
      + '</msRun></mzXML>';
    const d = readMzxml(xml);
    expect(d.readable).not.toBe(false);
    expect(d.mz.some((m) => Math.abs(m - 150.25) < 1e-3)).toBe(true);
  });
});

describe('F932: an Excel listing too long to print', () => {
  it('counts every row left out', () => {
    const rows = Array.from({ length: 5000 }, (_, i) => `<row r="${i + 1}"><c r="A${i + 1}"><v>${100 + i / 10}</v></c><c r="B${i + 1}"><v>${i}</v></c></row>`).join('');
    const xlsx = zipSync({
      'xl/worksheets/sheet1.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`),
    });
    const [lines, left] = reportListing(xlsx, 'peaks.xlsx', 150);
    expect(lines).toHaveLength(150);
    expect(left).toBe(4850);
  });
});

describe('F946 and F947: reading an HRMS report file', () => {
  const csv = 'm/z,intensity\n150.25,1000\n151.25,100\n';
  it('found whatever the case of its name', async () => {
    const f = new MemoryFolder('r');
    f.files.set('c/hrms/spectrum.csv', strToU8(csv));
    const d = await readReportFile(f, 'c/hrms', 'Spectrum.csv');
    expect(d.readable).toBe(true);
  });

  it('read in the background, leaves the folder’s own bytes as they were', async () => {
    // (a stand-in for the browser's worker: the bytes posted are transferred, as postMessage transfers them)
    class FakeWorker {
      onmessage: ((e: { data: unknown }) => void) | null = null;
      onerror: (() => void) | null = null;
      postMessage(msg: { id: number; bytes: Uint8Array; name: string }, transfer: Transferable[]): void {
        const got = structuredClone(msg, { transfer });
        setTimeout(() => this.onmessage?.({ data: { id: got.id, data: readReportBytes(got.bytes, got.name) } }), 0);
      }
      terminate(): void {}
    }
    vi.stubGlobal('Worker', FakeWorker);
    try {
      const f = new MemoryFolder('r');
      f.files.set('c/hrms/peaks.csv', strToU8(csv));
      expect((await readReportFile(f, 'c/hrms', 'peaks.csv')).readable).toBe(true);
      expect(f.files.get('c/hrms/peaks.csv')!.length).toBe(csv.length);
      expect((await readReportFile(f, 'c/hrms', 'peaks.csv')).readable).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('F917: the pieces of a structure too large for SMILES', () => {
  it('can each be chosen as M', () => {
    const a = chem.infoFromCounts(chem.parseMFormulaAndCharge('C40H30N')[0], 1);
    const b = chem.infoFromCounts(chem.parseMFormulaAndCharge('Br')[0], -1);
    const whole = chem.infoFromCounts(chem.parseMFormulaAndCharge('C40H30BrN')[0], 0);
    const facts = { info: whole, generic: [], pieces: [{ smiles: '', info: a, counterIon: false, copies: 1, drawn: 0 }, { smiles: '', info: b, counterIon: false, copies: 1, drawn: 1 }] } as unknown as chem.MolFacts;
    const sp = hrmsSpecies(facts, {})!;
    expect(new Set(sp.choices!.map((c) => c[0])).size).toBe(3);
    const second = sp.choices![2][0];
    expect(hrmsSpecies(facts, { species: second })!.info).toBe(b);
  });
});

describe('F934: residual CHCl₃ in CD₃OD', () => {
  // (H. E. Gottlieb, V. Kotlyar, A. Nudelman, J. Org. Chem. 1997, 62, 7512, Table 1, and
  // G. R. Fulmer et al., Organometallics 2010, 29, 2176, Table 1: chloroform CH in CD3OD, δ 7.90)
  it('is at 7.90', () => {
    expect(impurityMatch('CD3OD', '1H', 7.90, true, defaultImpurityTable())).toMatch(/chloroform/);
  });
});
