// @vitest-environment jsdom
// Review fixes for HRMS report files and the Attachment page: long profile spectra, zip listings
// and size limits checked while unpacking, files judged before they are read (raw data, folders,
// size), what was read remembered until the file changes, and a long PDF's pages drawn lazily.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fflate from 'fflate';

const unzipCalls: { filter: boolean }[] = [];
vi.mock('fflate', async (orig) => {
  const real = await orig<typeof import('fflate')>();
  return { ...real, unzipSync: (d: Uint8Array, o?: { filter?: unknown }) => { unzipCalls.push({ filter: !!o?.filter }); return real.unzipSync(d, o as never); } };
});

import { inflate, readBytes, readReport, ReportReadError, reportWithoutReading } from '../src/si/ms-reports';
import { forgetReports, readReportFile } from '../src/si/report-files';
import { MemoryFolder, type FolderEntry } from '../src/si/folder';
import { SiAttachmentPage } from '../src/ui/si-attachment';
import type { PdfPageReader } from '../src/render/pdf-page';
import type { SiProject, SiSection } from '../src/si/project';

/** A profile scan: Gaussian peaks every 0.5 Da, `n` points 0.0005 Da apart from m/z 150. */
function profile(n: number): [number[], number[]] {
  const mz: number[] = [], inten: number[] = [];
  for (let k = 0; k < n; k++) { const x = 150 + k * 0.0005; mz.push(x); const d = ((x - 150) % 0.5) - 0.25; inten.push(1000 * Math.exp(-(d * d) / (2 * 0.002 * 0.002)) + 1); }
  return [mz, inten];
}

describe('long profile spectra', () => {
  it('reads an mzML profile scan of 200 000 points (zlib, 64-bit)', async () => {
    const [mz, inten] = profile(200_000);
    const b64 = (a: number[]): string => Buffer.from(fflate.zlibSync(new Uint8Array(new Float64Array(a).buffer))).toString('base64');
    const arr = (a: number[], acc: string): string => `<binaryDataArray><cvParam accession="MS:1000523"/><cvParam accession="MS:1000574"/><cvParam accession="${acc}"/><binary>${b64(a)}</binary></binaryDataArray>`;
    const mzml = `<?xml version="1.0"?><mzML><run><spectrumList><spectrum><cvParam accession="MS:1000511" value="1"/><cvParam accession="MS:1000128"/><binaryDataArrayList>${arr(mz, 'MS:1000514')}${arr(inten, 'MS:1000515')}</binaryDataArrayList></spectrum></spectrumList></run></mzML>`;
    const d = await readReport(new TextEncoder().encode(mzml), 'run.mzML');
    expect(d.readable).toBe(true);
    expect(d.profile).toBe(true);
    expect(d.mz.length).toBe(200);
  });

  it('reads a profile CSV export of 200 000 rows', async () => {
    const [mz, inten] = profile(200_000);
    const csv = 'm/z,Intensity\r\n' + mz.map((m, k) => `${m.toFixed(5)},${inten[k].toFixed(1)}`).join('\r\n');
    const d = await readReport(new TextEncoder().encode(csv), 'profile.csv');
    expect(d.readable).toBe(true);
    expect(d.mz.length).toBe(200);
  });
});

describe('unpacking within limits', () => {
  it('lists a zip without unpacking it', () => {
    const zip = fflate.zipSync({ 'sample.d/AcqData/MSScan.bin': new Uint8Array(1024 * 1024) });
    unzipCalls.length = 0;
    const d = readBytes(zip, 'sample.zip');
    expect(d.readable).toBe(false);
    expect(d.message).toMatch(/a zip archive of instrument raw data/);
    expect(unzipCalls).toEqual([{ filter: true }]);
  });

  it('stops unpacking a data array as soon as it is larger than the limit', () => {
    const packed = fflate.zlibSync(new Uint8Array(4 * 1024 * 1024));
    expect(() => inflate(packed, 1024 * 1024)).toThrow(ReportReadError);
    const small = new Uint8Array(300_000).map((_, i) => i % 251);
    expect(inflate(fflate.zlibSync(small))).toEqual(small);
    expect(inflate(fflate.zlibSync(new Uint8Array(0)))).toEqual(new Uint8Array(0));
  });

  it('does not unpack an Excel sheet stated to be larger than the limit', async () => {
    const zip = fflate.zipSync({ 'xl/workbook.xml': new TextEncoder().encode('<workbook/>'), 'xl/worksheets/sheet1.xml': new TextEncoder().encode('<worksheet><sheetData/></worksheet>') });
    // (the central directory's "uncompressed size" of the sheet set to 3.5 GB)
    const v = new DataView(zip.buffer);
    for (let i = 0; i + 46 < zip.length; i++) {
      if (v.getUint32(i, true) !== 0x02014b50) continue;
      const n = v.getUint16(i + 28, true);
      if (new TextDecoder().decode(zip.subarray(i + 46, i + 46 + n)) === 'xl/worksheets/sheet1.xml') v.setUint32(i + 24, 0xd0000000, true);
    }
    const d = await readReport(zip, 'peaks.xlsx');
    expect(d.readable).toBe(false);
    expect(d.message).toBe('This Excel file is too large to read here. Save the peak list as CSV and add that.');
  });
});

/** A MemoryFolder whose listing gives sizes and times (as the desktop app's does), counting reads. */
class TimedFolder extends MemoryFolder {
  reads: string[] = [];
  times = new Map<string, number>();
  sizes = new Map<string, number>();
  override async readBytes(rel: string): Promise<Uint8Array | null> { this.reads.push(rel); return super.readBytes(rel); }
  override async entries(rel: string): Promise<FolderEntry[]> {
    return (await super.entries(rel)).map((e) => ({ ...e, size: this.sizes.get(`${rel}/${e.name}`) ?? e.size, modified: this.times.get(`${rel}/${e.name}`) ?? 1000 }));
  }
}

describe('report files judged before they are read, and remembered', () => {
  afterEach(() => forgetReports());

  it('keeps a raw-data folder as raw data, not as a missing file', async () => {
    const f = new TimedFolder('x');
    f.files.set('c/hrms/sample.d/AcqData/MSScan.bin', new Uint8Array(10));
    const d = await readReportFile(f, 'c/hrms', 'sample.d');
    expect(d.kind).toBe('Agilent .d data folder');
    expect(d.message).toMatch(/^sample\.d is Agilent \.d data folder: the instrument's own format/);
    expect(f.reads).toEqual([]);
    expect(reportWithoutReading('notes', { folder: true })!.message).toBe('notes is a folder: it is kept, but not read.');
  });

  it('never reads instrument raw data or a file too large to read', async () => {
    const f = new TimedFolder('x');
    f.files.set('c/hrms/run.raw', new Uint8Array(10));
    f.files.set('c/hrms/huge.mzML', new Uint8Array(10));
    f.sizes.set('c/hrms/huge.mzML', 500 * 1024 * 1024);
    expect((await readReportFile(f, 'c/hrms', 'run.raw')).kind).toBe('Thermo .raw data');
    expect((await readReportFile(f, 'c/hrms', 'huge.mzML')).message).toBe('huge.mzML is too large to read here (524 MB). Export a peak list or a PDF report of the spectrum and add that.');
    expect(f.reads).toEqual([]);
  });

  it('reads a file once until it changes', async () => {
    const f = new TimedFolder('x');
    f.files.set('c/hrms/peaks.csv', new TextEncoder().encode('m/z,Intensity\n179.0233,100\n180.0266,10\n'));
    expect((await readReportFile(f, 'c/hrms', 'peaks.csv')).mz).toEqual([179.0233, 180.0266]);
    expect((await readReportFile(f, 'c/hrms', 'peaks.csv')).mz).toEqual([179.0233, 180.0266]);
    expect(f.reads.length).toBe(1);
    f.files.set('c/hrms/peaks.csv', new TextEncoder().encode('m/z,Intensity\n179.0234,100\n'));
    f.times.set('c/hrms/peaks.csv', 2000);
    expect((await readReportFile(f, 'c/hrms', 'peaks.csv')).mz).toEqual([179.0234]);
    expect(f.reads.length).toBe(2);
  });

  it('says a missing file is missing', async () => {
    const d = await readReportFile(new TimedFolder('x'), 'c/hrms', 'gone.csv');
    expect(d.message).toBe("gone.csv is missing from the compound's folder.");
  });
});

describe('an Attachment section’s PDF', () => {
  it('draws pages only when scrolled near, stops when the page goes, and shows drawn pages again at once', async () => {
    const observed: Element[] = [];
    let notify: ((seen: { isIntersecting: boolean; target: Element }[]) => void) | null = null;
    vi.stubGlobal('IntersectionObserver', class { constructor(cb: typeof notify) { notify = cb; } observe(e: Element): void { observed.push(e); } disconnect(): void { notify = null; } });
    let n = 0;
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => `blob:${++n}`, revokeObjectURL: () => {} }));
    const drawn: number[] = [];
    let closed = 0;
    const reader = (): PdfPageReader => ({ count: 120, size: async () => ({ w: 612, h: 792 }), picture: async (p) => { drawn.push(p); return new Blob(['x']); }, close: () => { closed++; } });
    const s = { id: 's-1', folder: 'sections/s-1', name: 'Crystal report', data: { file: 'report.pdf' } } as unknown as SiSection;
    const project = { readOnly: false, readSectionFile: async () => new Uint8Array(1000) } as unknown as SiProject;
    const host = { project, section: s, flash: () => {}, pickFiles: async () => [], pdfPages: async () => { throw new Error('every page drawn'); }, openPdf: async () => reader(), redraw: () => {} };
    const settle = async (): Promise<void> => { for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0)); };
    const page = new SiAttachmentPage(host);
    await settle();
    expect(page.el.querySelectorAll('img').length).toBe(120);
    expect(drawn).toEqual([]);
    notify!(observed.slice(0, 2).map((target) => ({ isIntersecting: true, target })));
    await settle();
    expect(drawn).toEqual([1, 2]);
    page.dispose();
    expect(closed).toBe(1);
    notify?.(observed.slice(2, 4).map((target) => ({ isIntersecting: true, target })));
    await settle();
    expect(drawn).toEqual([1, 2]);
    // shown again: pages 1 and 2 at once, nothing drawn again
    observed.length = 0;
    const again = new SiAttachmentPage(host);
    await settle();
    const imgs = [...again.el.querySelectorAll('img')];
    expect(imgs[0].getAttribute('src')).toBe('blob:1');
    expect(imgs[1].getAttribute('src')).toBe('blob:2');
    expect(imgs[2].getAttribute('src')).toBeNull();
    expect(drawn).toEqual([1, 2]);
    again.dispose();
    vi.unstubAllGlobals();
  });
});
