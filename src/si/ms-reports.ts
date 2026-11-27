// HRMS report files: reading their m/z values, and picking the found m/z, as Chem SI Assistant
// does (its core/ms_reports.py, SPEC §13n.3). A compound's HRMS field keeps the instrument's
// report files in the compound folder (hrms/); these are read, with no vendor software:
//
// - open data formats: mzML (indexed or not; base64 arrays, zlib or none, 32/64-bit), mzXML,
//   mzData, MGF, JCAMP-DX (peak tables, and XYDATA in AFFN or ASDF compression), netCDF/ANDI-MS;
// - exports: CSV/TSV/TXT peak lists, Excel .xlsx (its XML), and the text of PDF reports;
// - pictures and vendor raw data (Thermo .raw, Agilent/Bruker .d, Waters .raw, SCIEX .wiff…)
//   are kept but not read, with a note on how to get a readable copy.
//
// Profile spectra are centroided (each local maximum: the top of a Gaussian through its three
// highest points), and the peaks of every MS1 scan merged (within 3 ppm). In text reports a
// table header or a nearby "calcd"/"found" says which numbers are measured and which
// calculated; calculated values are never used as the found m/z.
//
// The found m/z (chooseMatch): of every value within the HRMS tolerance of a calculated
// isotope peak, one marked measured beats an unmarked one, then the monoisotopic peak beats
// the others, then the nearest wins. The Found box is filled from the reports while it is
// empty or still holds the value filled before (hrms.found_from = {file, mz}); a value typed
// by hand is never changed, and a warning says when it differs from the reports'.

import { unzipSync, Inflate } from 'fflate';
import type { Peak } from './chem';
import { guarded, notAfter } from '../regex-behind';

export const HRMS_DIR = 'hrms';
export const REPORTS_KEY = 'reports';
export const FOUND_FROM_KEY = 'found_from';
export const PRINT_KEY = 'print_reports';

const MZ_RANGE: [number, number] = [40, 6000];
const MERGE_PPM = 3;
const MIN_REL_INTENSITY = 0.001;
const MAX_PEAKS_PER_SCAN = 3000;
const MAX_PEAKS = 50000;
export const MAX_FILE_BYTES = 400 * 1024 * 1024;
const MAX_ARRAY_BYTES = 256 * 1024 * 1024;
/** A sheet's XML (or the shared strings) unpacked, at most (a damaged or "zip bomb" workbook is not unpacked). */
const XLSX_MAX_PART_BYTES = 200 * 1024 * 1024;
const MAX_POINTS = 20_000_000;

const PICTURE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.tif', '.tiff', '.bmp', '.gif', '.svg'];
const JCAMP_EXTENSIONS = ['.jdx', '.dx', '.jcamp', '.jcm'];
const CDF_EXTENSIONS = ['.cdf', '.nc'];
const XLSX_EXTENSIONS = ['.xlsx', '.xlsm'];

export class ReportReadError extends Error {}

/** What was read from one report file. */
export interface ReportData {
  name: string;
  /** "mzML", "PDF report", "picture"… */
  kind: string;
  mz: number[];
  /** NaN: not known. */
  intensity: number[];
  /** Values (rounded to 6 decimals) the report marks as measured/found. */
  measured: Set<number>;
  /** Values marked calculated (never "found"). */
  calculated: number[];
  /** What happened, in plain words. */
  message: string;
  /** False: nothing can be read from it. */
  readable: boolean;
  profile: boolean;
  scans: number;
}

export const r6 = (v: number): number => Math.round(v * 1e6) / 1e6;

/** The largest finite value (-Infinity for none): a loop, as Math.max(...a) overflows the stack beyond about 100 000 values. */
export function maxOf(a: ArrayLike<number>): number {
  let top = -Infinity;
  for (let i = 0; i < a.length; i++) if (a[i] > top && Number.isFinite(a[i])) top = a[i];
  return top;
}

/** Append every value of `from` to `to` (push(...from) overflows the stack for a long list). */
function append(to: number[], from: ArrayLike<number>): void {
  for (let i = 0; i < from.length; i++) to.push(from[i]);
}

function data(kind: string, over: Partial<ReportData> = {}): ReportData {
  return { name: '', kind, mz: [], intensity: [], measured: new Set(), calculated: [], message: '', readable: true, profile: false, scans: 0, ...over };
}

export const isMeasured = (d: ReportData, mz: number): boolean => d.measured.has(r6(mz));

/** The value picked as the found m/z. */
export interface Match { mz: number; file: string; peak: Peak; ppm: number; measured: boolean }

// ---------------------------------------------------------------- what a file is

const VENDOR_FILES: Record<string, string> = {
  '.raw': 'Thermo .raw data', '.wiff': 'SCIEX .wiff data', '.wiff2': 'SCIEX .wiff2 data', '.lcd': 'Shimadzu .lcd data', '.qgd': 'Shimadzu .qgd data',
  '.baf': 'Bruker raw data (analysis.baf)', '.tdf': 'Bruker raw data (.tdf)', '.tdf_bin': 'Bruker raw data (.tdf_bin)', '.yep': 'Bruker raw data (.yep)',
  '.fid': 'Bruker raw data (fid)', '.ms': 'Agilent ChemStation .ms data', '.rec': 'raw instrument data',
};
const VENDOR_DIR_FILES = ['msscan.bin', 'msprofile.bin', 'mspeak.bin', 'analysis.baf', 'analysis.tdf', '_func001.dat', '_extern.inf'];

const extOf = (name: string): string => { const n = name.toLowerCase(); const i = n.lastIndexOf('.'); return i > 0 ? n.slice(i) : ''; };

/** What kind of instrument raw data a file is ("Thermo .raw data"…), or null. */
export function vendorRawKind(name: string): string | null {
  const lower = name.toLowerCase();
  if (lower.endsWith('.wiff.scan')) return 'SCIEX .wiff.scan data';
  if (VENDOR_DIR_FILES.includes(lower)) return 'a file of instrument raw data';
  return VENDOR_FILES[extOf(name)] ?? null;
}

export const rawDataMessage = (name: string, kind: string): string =>
  `${name} is ${kind}: the instrument's own format, which this program can't read. It is kept with the compound. To fill in the found m/z automatically, also add a report exported from the instrument software (PDF or CSV), or convert the data to mzML with ProteoWizard MSConvert (free) and add that.`;

export const pictureMessage = (name: string): string => `${name} is a picture: it is kept (and can be printed), but numbers can't be read from pictures. Type the found m/z yourself.`;

function kindName(name: string): string {
  const ext = extOf(name);
  return ({ '.pdf': 'PDF report', '.mzml': 'mzML', '.mzxml': 'mzXML', '.mgf': 'MGF', '.xlsx': 'Excel file', '.cdf': 'netCDF (ANDI-MS)', '.zip': 'zip archive' } as Record<string, string>)[ext] ?? (ext.slice(1) || 'file');
}

/** One line on what was read: "PDF report: 3 m/z values (1 marked measured)." */
export function summary(d: ReportData): string {
  if (!d.readable) return d.message;
  const n = d.mz.length;
  if (!n) return `${d.kind}: no m/z values found in it.`;
  let what = `${n} m/z value${n !== 1 ? 's' : ''}`;
  if (d.scans) {
    what = `${n} peak${n !== 1 ? 's' : ''} from ${d.scans} spectr${d.scans !== 1 ? 'a' : 'um'}`;
    if (d.profile) what += ' (profile data, centroided)';
  }
  if (d.measured.size) what += ` (${d.measured.size} marked measured)`;
  return `${d.kind}: ${what}.`;
}

/** The text of a PDF (its lines in reading order), for reading reports; given by the caller (pdf.js runs in the browser). */
export type PdfText = (bytes: Uint8Array) => Promise<string>;

/** What can be read from one report file. Never throws: a file that can't be read gives `readable: false` and a message saying why. */
/** Reads a report that isn't a PDF (e.g. in a background worker); see readReportBytes. */
export type ReportReader = (bytes: Uint8Array, name: string) => Promise<ReportData>;

/** What can be read from one report file. Never throws: a file that can't be read gives `readable: false` and a message saying why. `background` reads a file that isn't a PDF (off the page's thread); without it, it is read here. */
export async function readReport(bytes: Uint8Array | null, name: string, pdfText?: PdfText, background?: ReportReader): Promise<ReportData> {
  if (!bytes) return data('missing', { name, readable: false, message: `${name} is missing from the compound's folder.` });
  const known = reportWithoutReading(name, { size: bytes.length });
  if (known) return known;
  if (!isPdf(bytes)) return background ? background(bytes, name) : readReportBytes(bytes, name);
  let d: ReportData;
  try {
    let text: string;
    try { text = pdfText ? await pdfText(bytes) : ''; } catch { throw new ReportReadError(`${name} could not be opened as a PDF (it may be damaged).`); }
    if (!pdfText) throw new ReportReadError(`${name} is a PDF; its text can't be read here.`);
    if (!text.trim()) throw new ReportReadError('This PDF has no text in it (probably a scanned picture), so no m/z can be read from it. Type the found m/z yourself.');
    d = parseReportText(text, 'PDF report');
  } catch (e) {
    return failed(name, e);
  }
  d.name = name;
  if (!d.message) d.message = summary(d);
  return d;
}

/** What a failure to read a report says (as SI Assistant says it). */
function failed(name: string, e: unknown): ReportData {
  if (e instanceof ReportReadError) return data(kindName(name), { name, readable: false, message: e.message });
  return data(kindName(name), { name, readable: false, message: `${name} could not be read (it may be damaged, or a variant this program doesn't know): ${e instanceof Error ? e.name : 'Error'}.` });
}

/**
 * A report that isn't a PDF, read from its bytes (in a background worker, or here). Never
 * throws: a file that can't be read gives `readable: false` and a message saying why.
 */
export function readReportBytes(bytes: Uint8Array, name: string): ReportData {
  const known = reportWithoutReading(name, { size: bytes.length });
  if (known) return known;
  let d: ReportData;
  try { d = readBytes(bytes, name); } catch (e) { return failed(name, e); }
  d.name = name;
  if (!d.message) d.message = summary(d);
  return d;
}

/** What is known of a report file without reading it: its size in bytes (null: not known), whether it is a folder, and the names inside it. */
export interface ReportFileInfo { size?: number | null; folder?: boolean; children?: string[] }

/**
 * A report that needn't (or can't) be read, from its name, size and whether it is a folder
 * alone, as SI Assistant decides before opening a file: instrument raw data (a file or a
 * folder), a folder, a picture, an old Excel file, a document, a file too large to read.
 * Null when its bytes are to be read.
 */
export function reportWithoutReading(name: string, info: ReportFileInfo = {}): ReportData | null {
  const fail = (kind: string, message: string): ReportData => data(kind, { name, readable: false, message });
  if (info.folder) {
    const ext = extOf(name);
    const inside = new Set((info.children ?? []).map((n) => n.toLowerCase()));
    let raw: string | null = null;
    if (ext === '.d') {
      raw = ['analysis.baf', 'analysis.tdf', 'analysis.yep'].some((n) => inside.has(n)) ? 'Bruker .d data folder'
        : inside.has('acqdata') || inside.has('msscan.bin') || inside.has('msprofile.bin') ? 'Agilent .d data folder' : 'Agilent or Bruker .d data folder';
    } else if (ext === '.raw') raw = 'Waters .raw data folder';
    else if (VENDOR_DIR_FILES.some((n) => inside.has(n))) raw = 'a folder of instrument raw data';
    if (raw) return fail(raw, rawDataMessage(name, raw));
    return fail('folder', `${name} is a folder: it is kept, but not read.`);
  }
  const raw = vendorRawKind(name);
  if (raw) return fail(raw, rawDataMessage(name, raw));
  const ext = extOf(name);
  if (PICTURE_EXTENSIONS.includes(ext)) return fail('picture', pictureMessage(name));
  if (ext === '.xls') return fail('old Excel file', `${name} is an old Excel file (.xls), which can't be read. Save it as .xlsx or CSV in Excel and add that.`);
  if (['.doc', '.docx', '.rtf', '.odt'].includes(ext)) return fail('document', `${name} can't be read. Save it as PDF and add that.`);
  const size = info.size ?? null;
  if (size !== null && size > MAX_FILE_BYTES) return fail('large file', `${name} is too large to read here (${Math.round(size / 1e6)} MB). Export a peak list or a PDF report of the spectrum and add that.`);
  return null;
}

/** A report file that is there but can't be opened just now (an online-only OneDrive file while offline, or one locked by another program): not remembered, so it is tried again next time. */
export function notOpened(name: string, why = 'Error'): ReportData {
  return data(kindName(name), { name, readable: false, message: notOpenedMessage(name, why) });
}

/** The message for a report that exists but can't be opened just now (it is tried again next time). */
export const notOpenedMessage = (name: string, why = 'Error'): string =>
  `${name} could not be opened just now (${why}): it may be an online-only OneDrive file while you are offline, or open in another program. It will be read again next time.`;

const isPdf = (b: Uint8Array): boolean => b.length > 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d;
const isZip = (b: Uint8Array): boolean => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && ((b[2] === 3 && b[3] === 4) || (b[2] === 5 && b[3] === 6));

/** A report from its bytes, by its name's extension (and its first bytes). Throws ReportReadError (or anything, for a damaged file). */
export function readBytes(content: Uint8Array, name = ''): ReportData {
  const lower = name.toLowerCase();
  const ext = extOf(name);
  if ((content[0] === 0x43 && content[1] === 0x44 && content[2] === 0x46) || CDF_EXTENSIONS.includes(ext)) return readNetcdf(content);
  if (XLSX_EXTENSIONS.includes(ext)) return readXlsx(content);
  if (isZip(content)) return readZip(content, name);
  const text = decode(content);
  const head = text.slice(0, 2048).trimStart();
  if (['.mzml', '.mzxml', '.mzdata'].includes(ext) || lower.endsWith('.mzdata.xml') || head.startsWith('<')) {
    const root = xmlRootName(text);
    // a file cut short (or not XML at all) is damaged, as an XML reader finds it
    if (['mzML', 'indexedmzML', 'mzXML', 'msRun', 'mzData'].includes(root) && !new RegExp(`</(?:[\\w.-]+:)?${root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*>\\s*$`).test(text)) throw new XmlParseError(`${root} is not closed`);
    if (root === 'mzML' || root === 'indexedmzML') return readMzml(text);
    if (root === 'mzXML' || root === 'msRun') return readMzxml(text);
    if (root === 'mzData') return readMzdata(text);
    if (['.mzml', '.mzxml', '.mzdata'].includes(ext)) throw new ReportReadError(`${name} is not a readable ${ext.slice(1)} file.`);
  }
  if (ext === '.mgf' || /^\s*BEGIN IONS/m.test(text)) return readMgf(text);
  if (JCAMP_EXTENSIONS.includes(ext) || /^\s*##TITLE=/.test(text)) return readJcamp(text);
  return readTableText(text);
}

function readZip(content: Uint8Array, name: string): ReportData {
  // (the names only: no entry is unpacked)
  let names: string[] = [];
  try { unzipSync(content, { filter: (f) => { names.push(f.name); return false; } }); } catch { names = []; }
  if (names.includes('xl/workbook.xml') || names.some((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))) return readXlsx(content);
  const shown = name || 'This file';
  for (const n of names) {
    const parts = n.replace(/\\/g, '/').toLowerCase().split('/').filter(Boolean);
    const last = parts[parts.length - 1] ?? '';
    if (parts.slice(0, -1).some((p) => p.endsWith('.d') || p.endsWith('.raw')) || VENDOR_DIR_FILES.includes(last) || last.endsWith('.wiff.scan') || extOf(last) in VENDOR_FILES) {
      return data('zip archive', { name, readable: false, message: rawDataMessage(shown, 'a zip archive of instrument raw data') });
    }
  }
  const message = ['', '.zip'].includes(extOf(name))
    ? `${shown} is a zip archive: it is kept, but not read. To fill in the found m/z automatically, unzip it and add the report inside (PDF, CSV or mzML).`
    : `${shown} can't be read. Save it as PDF, CSV or .xlsx and add that.`;
  return data('zip archive', { name, readable: false, message });
}

export function decode(content: Uint8Array): string {
  if (content[0] === 0xff && content[1] === 0xfe) return new TextDecoder('utf-16le').decode(content.subarray(2));
  if (content[0] === 0xfe && content[1] === 0xff) return new TextDecoder('utf-16be').decode(content.subarray(2));
  try { return new TextDecoder('utf-8', { fatal: true }).decode(content).replace(/^﻿/, ''); } catch { return new TextDecoder('latin1').decode(content); }
}

/** A file that isn't well-formed XML (named as Python's XML reader names it, for the message). */
class XmlParseError extends Error { override name = 'ParseError'; }

const localName = (tag: string): string => tag.slice(tag.lastIndexOf(':') + 1);

function xmlRootName(text: string): string {
  const re = /<([A-Za-z_][\w:.-]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const before = text[m.index + 1];
    if (before === '?' || before === '!') continue;
    return localName(m[1]);
  }
  return '';
}

// ---------------------------------------------------------------- peaks

function argsort(a: ArrayLike<number>): number[] { return Array.from(a, (_, i) => i).sort((i, j) => a[i] - a[j]); }
function median(a: number[]): number { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }

/** Whether a spectrum is profile data (many closely spaced points per peak), not a list of centroids. */
export function looksProfile(mz: number[], intensity: number[]): boolean {
  const n = mz.length;
  if (n < 30) return false;
  const order = argsort(mz);
  const x = order.map((i) => mz[i]), y = order.map((i) => intensity[i]);
  const ratios: number[] = [];
  for (let i = 1; i < n; i++) { const d = x[i] - x[i - 1]; if (d > 0 && x[i] > 0) ratios.push(d / x[i]); }
  if (!ratios.length) return false;
  const spacingPpm = median(ratios) * 1e6;
  let maxima = 0;
  for (let i = 1; i < n - 1; i++) if (y[i] > y[i - 1] && y[i] >= y[i + 1]) maxima++;
  return spacingPpm < 150 && maxima < 0.3 * n;
}

/** Profile data as peaks: each local maximum (above `minRel` of the largest) is one peak, at the top of a Gaussian through its three highest points. */
export function centroid(mz: number[], intensity: number[], minRel = MIN_REL_INTENSITY): [number[], number[]] {
  const order = argsort(mz);
  const x = order.map((i) => mz[i]), y = order.map((i) => intensity[i]);
  const n = x.length;
  const top = maxOf(y);
  if (n < 3 || !(top > 0)) return [[], []];
  let inner: number[] = [];
  for (let i = 1; i < n - 1; i++) if (y[i] > y[i - 1] && y[i] >= y[i + 1] && y[i] >= minRel * top) inner.push(i);
  if (inner.length > MAX_PEAKS_PER_SCAN) inner = inner.sort((a, b) => y[a] - y[b]).slice(-MAX_PEAKS_PER_SCAN).sort((a, b) => a - b);
  const spacing: number[] = [];
  for (let i = 1; i < n; i++) spacing.push(x[i] - x[i - 1]);
  const gap = spacing.length ? 8 * median(spacing) : 0;
  const ox: number[] = [], oy: number[] = [];
  for (const i of inner) {
    const half = y[i] / 2;
    let lo = i, hi = i;
    while (lo > 0 && y[lo - 1] >= half && y[lo - 1] <= y[lo] && x[lo] - x[lo - 1] <= gap) lo--;
    while (hi < n - 1 && y[hi + 1] >= half && y[hi + 1] <= y[hi] && x[hi + 1] - x[hi] <= gap) hi++;
    let sw = 0, sxw = 0;
    for (let k = lo; k <= hi; k++) { sw += y[k]; sxw += x[k] * y[k]; }
    let centre = sxw / sw;
    if (i > 0 && i < n - 1 && y[i - 1] > 0 && y[i + 1] > 0 && x[i] - x[i - 1] <= gap && x[i + 1] - x[i] <= gap) {
      const a = Math.log(y[i - 1]), b = Math.log(y[i]), c = Math.log(y[i + 1]);
      const h1 = x[i] - x[i - 1], h2 = x[i + 1] - x[i];
      const denom = h2 * (a - b) + h1 * (c - b);
      if (denom < 0) {
        const t = (h2 * h2 * (a - b) - h1 * h1 * (c - b)) / (2 * denom);
        if (t >= -h1 && t <= h2) centre = x[i] + t;
      }
    }
    ox.push(centre);
    oy.push(y[i]);
  }
  return [ox, oy];
}

/** One spectrum's peaks: centroided when it is profile data (null: decided by looking), small ones dropped. */
function scanPeaks(mzIn: ArrayLike<number>, intIn: ArrayLike<number>, profile: boolean | null): [number[], number[], boolean] {
  const n = Math.min(mzIn.length, intIn.length);
  let mz: number[] = [], inten: number[] = [];
  for (let i = 0; i < n; i++) if (Number.isFinite(mzIn[i]) && Number.isFinite(intIn[i]) && mzIn[i] > 0) { mz.push(mzIn[i]); inten.push(intIn[i]); }
  if (!mz.length) return [mz, inten, false];
  const isProfile = profile === null ? looksProfile(mz, inten) : profile;
  if (isProfile) [mz, inten] = centroid(mz, inten);
  else {
    const top = maxOf(inten);
    if (top > 0) {
      const keep = inten.map((v, i) => [v, i] as const).filter(([v]) => v >= MIN_REL_INTENSITY * top).map(([, i]) => i);
      mz = keep.map((i) => mz[i]); inten = keep.map((i) => inten[i]);
      if (mz.length > MAX_PEAKS_PER_SCAN) {
        const topIdx = argsort(inten).slice(-MAX_PEAKS_PER_SCAN);
        mz = topIdx.map((i) => mz[i]); inten = topIdx.map((i) => inten[i]);
      }
    }
  }
  return [mz, inten, isProfile];
}

/** The peaks of several scans as one list: peaks within `ppm` of their neighbor are one, at their intensity-weighted m/z, with the summed intensity. */
export function mergePeaks(scans: [number[], number[]][], ppm = MERGE_PPM): [number[], number[]] {
  const list = scans.filter(([m]) => m.length);
  if (!list.length) return [[], []];
  const mz = list.flatMap(([m]) => m), inten = list.flatMap(([, i]) => i);
  const order = argsort(mz);
  if (list.length === 1) return [order.map((i) => mz[i]), order.map((i) => inten[i])];
  const outM: number[] = [], outI: number[] = [];
  let w = 0, wx = 0, sum = 0, prev = -Infinity;
  const flush = (): void => { if (w > 0) { outM.push(wx / w); outI.push(sum); } w = wx = sum = 0; };
  for (const i of order) {
    const m = mz[i];
    if (outM.length + (w > 0 ? 1 : 0) > 0 && m - prev > m * ppm * 1e-6) flush();
    const weight = inten[i] > 0 ? inten[i] : 1e-12;
    w += weight; wx += m * weight; sum += inten[i];
    prev = m;
  }
  flush();
  if (outM.length > MAX_PEAKS) {
    const keep = argsort(outI).slice(-MAX_PEAKS).sort((a, b) => a - b);
    return [keep.map((i) => outM[i]), keep.map((i) => outI[i])];
  }
  return [outM, outI];
}

function spectraResult(kind: string, scans: [number[], number[]][], profiles: boolean[]): ReportData {
  const [mz, inten] = mergePeaks(scans);
  return data(kind, { mz, intensity: inten, scans: scans.length, profile: profiles.some(Boolean) });
}

function base64Bytes(text: string): Uint8Array {
  const clean = text.replace(/\s+/g, '');
  if (!clean) return new Uint8Array(0);
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** zlib-unpacked data, at most MAX_ARRAY_BYTES: unpacking stops as soon as it would be larger (ReportReadError). */
export function inflate(raw: Uint8Array, most = MAX_ARRAY_BYTES): Uint8Array {
  const body = raw.subarray(2); // (zlib: a 2-byte header before the deflate data)
  const chunks: Uint8Array[] = [];
  let total = 0;
  const inf = new Inflate((chunk) => {
    total += chunk.length;
    if (total > most) throw new ReportReadError('A data array in this file is too large to read here.');
    chunks.push(chunk);
  });
  // (in small pieces, so that a piece that unpacks to far too much is stopped early)
  const STEP = 64 * 1024;
  if (!body.length) inf.push(body, true);
  for (let i = 0; i < body.length; i += STEP) inf.push(body.subarray(i, i + STEP), i + STEP >= body.length);
  if (chunks.length === 1) return chunks[0];
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

function floats(raw: Uint8Array, size: 4 | 8, little: boolean): number[] {
  const v = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const n = Math.floor(raw.length / size);
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[i] = size === 4 ? v.getFloat32(i * size, little) : v.getFloat64(i * size, little);
  return out;
}

/** Every element `<tag …>…</tag>` (or `<tag …/>`) in `text`: its attributes and inner text. */
function* elements(text: string, tag: string): Generator<{ attrs: string; inner: string }> {
  const re = new RegExp(`<(?:[\\w.-]+:)?${tag}(\\s[^>]*?)?(/?)>`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m[2] === '/') { yield { attrs: m[1] ?? '', inner: '' }; continue; }
    const close = new RegExp(`</(?:[\\w.-]+:)?${tag}\\s*>`, 'g');
    close.lastIndex = re.lastIndex;
    const end = close.exec(text);
    if (!end) return;
    yield { attrs: m[1] ?? '', inner: text.slice(re.lastIndex, end.index) };
    re.lastIndex = close.lastIndex;
  }
}

const attr = (attrs: string, name: string): string | null => {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(attrs);
  return m ? (m[2] ?? m[3] ?? '') : null;
};
const accessions = (text: string): Set<string> => new Set([...text.matchAll(/accession\s*=\s*["']([^"']+)["']/g)].map((m) => m[1]));

// ---------------------------------------------------------------- mzML

const MZML = { f32: 'MS:1000521', f64: 'MS:1000523', zlib: 'MS:1000574', mz: 'MS:1000514', inten: 'MS:1000515', level: 'MS:1000511', centroid: 'MS:1000127', profile: 'MS:1000128' };
const NUMPRESS = ['MS:1002312', 'MS:1002313', 'MS:1002314', 'MS:1002746', 'MS:1002747', 'MS:1002748'];

export function readMzml(text: string): ReportData {
  const scans: [number[], number[]][] = [], flags: boolean[] = [], levels: (number | null)[] = [];
  for (const sp of elements(text, 'spectrum')) {
    const listAt = sp.inner.search(/<(?:[\w.-]+:)?binaryDataArrayList/);
    const own = listAt >= 0 ? sp.inner.slice(0, listAt) : sp.inner;
    let level: number | null = null, profile: boolean | null = null;
    for (const p of elements(own, 'cvParam')) {
      const acc = attr(p.attrs, 'accession');
      if (acc === MZML.level) level = Math.trunc(Number(attr(p.attrs, 'value') || 1));
      else if (acc === MZML.centroid) profile = false;
      else if (acc === MZML.profile) profile = true;
    }
    levels.push(level);
    if (level !== null && level !== 1) continue;
    const arrays: { mz?: number[]; i?: number[] } = {};
    for (const bda of elements(sp.inner, 'binaryDataArray')) {
      const accs = accessions(bda.inner);
      if (NUMPRESS.some((a) => accs.has(a))) throw new ReportReadError("This mzML file is compressed with MS-Numpress, which this program can't read. Convert it again with MSConvert with Numpress switched off.");
      const bin = /<(?:[\w.-]+:)?binary(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w.-]+:)?binary>/.exec(bda.inner);
      let raw = base64Bytes(bin ? bin[1] : '');
      if (accs.has(MZML.zlib) && raw.length) raw = inflate(raw);
      const values = floats(raw, accs.has(MZML.f32) ? 4 : 8, true);
      if (accs.has(MZML.mz)) arrays.mz = values; else if (accs.has(MZML.inten)) arrays.i = values;
    }
    if (arrays.mz && arrays.i) {
      const [m, i, prof] = scanPeaks(arrays.mz, arrays.i, profile);
      scans.push([m, i]);
      flags.push(prof);
    }
  }
  if (!scans.length && levels.some((l) => l !== null && l !== 1)) throw new ReportReadError('This mzML file has no MS1 spectra (only MS/MS), so no found m/z can be read from it.');
  return spectraResult('mzML', scans, flags);
}

// ---------------------------------------------------------------- mzXML

export function readMzxml(text: string): ReportData {
  const scans: [number[], number[]][] = [], flags: boolean[] = [];
  let levels = 0;
  // each <scan …> start and the <peaks> that follows it (a nested MS/MS scan has its own); an empty
  // scan's <peaks … /> closes itself
  const re = /<(?:[\w.-]+:)?scan(\s[^>]*)?>|<(?:[\w.-]+:)?peaks(?:\s[^>]*?)?\/>|<(?:[\w.-]+:)?peaks(\s[^>]*)?>([\s\S]*?)<\/(?:[\w.-]+:)?peaks>/g;
  let scan = '';
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m[3] === undefined && /^<(?:[\w.-]+:)?peaks/.test(m[0])) { levels++; continue; }   // (a scan with no peaks)
    if (m[3] === undefined) { scan = m[1] ?? ''; continue; }
    const pAttrs = m[2] ?? '';
    const level = Math.trunc(Number(attr(scan, 'msLevel') || 1)) || 1;
    levels++;
    if (level !== 1) continue;
    let raw = base64Bytes(m[3]);
    if ((attr(pAttrs, 'compressionType') || 'none').toLowerCase() === 'zlib' && raw.length) raw = inflate(raw);
    const precision = attr(pAttrs, 'precision') ?? '32';
    const order = (attr(pAttrs, 'byteOrder') || 'network').toLowerCase();
    const values = floats(raw, precision === '64' ? 8 : 4, !(order === 'network' || order === 'big'));
    const mz = values.filter((_, k) => k % 2 === 0), inten = values.filter((_, k) => k % 2 === 1);
    const cen = attr(scan, 'centroided');
    const [pm, pi, prof] = scanPeaks(mz, inten, cen === null ? null : !(cen === '1' || cen === 'true'));
    scans.push([pm, pi]);
    flags.push(prof);
  }
  if (!scans.length && levels) throw new ReportReadError('This mzXML file has no MS1 scans, so no found m/z can be read from it.');
  return spectraResult('mzXML', scans, flags);
}

// ---------------------------------------------------------------- mzData

export function readMzdata(text: string): ReportData {
  const scans: [number[], number[]][] = [], flags: boolean[] = [];
  for (const sp of elements(text, 'spectrum')) {
    let level = 1;
    for (const inst of elements(sp.inner, 'spectrumInstrument')) { const l = attr(inst.attrs, 'msLevel'); if (l) level = Math.trunc(Number(l)); }
    const arrays: Record<string, number[]> = {};
    for (const name of ['mzArrayBinary', 'intenArrayBinary']) {
      for (const holder of elements(sp.inner, name)) {
        const d = /<(?:[\w.-]+:)?data(\s[^>]*)?>([\s\S]*?)<\/(?:[\w.-]+:)?data>/.exec(holder.inner);
        if (!d) continue;
        const a = d[1] ?? '';
        arrays[name] = floats(base64Bytes(d[2]), attr(a, 'precision') === '64' ? 8 : 4, (attr(a, 'endian') || 'little').toLowerCase() === 'little');
      }
    }
    if (level === 1 && arrays.mzArrayBinary && arrays.intenArrayBinary) {
      const [m, i, prof] = scanPeaks(arrays.mzArrayBinary, arrays.intenArrayBinary, null);
      scans.push([m, i]);
      flags.push(prof);
    }
  }
  return spectraResult('mzData', scans, flags);
}

// ---------------------------------------------------------------- MGF

const NUMBER = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g;
const numbersIn = (s: string): number[] => (s.match(NUMBER) ?? []).map(Number);

export function readMgf(text: string): ReportData {
  const scans: [number[], number[]][] = [], flags: boolean[] = [], extra: number[] = [];
  let block: [number, number][] | null = null;
  for (const line of text.split(/\r\n?|\n/)) {
    const s = line.trim(), upper = s.toUpperCase();
    if (upper === 'BEGIN IONS') block = [];
    else if (upper === 'END IONS') {
      if (block?.length) { const [m, i, prof] = scanPeaks(block.map((b) => b[0]), block.map((b) => b[1]), null); scans.push([m, i]); flags.push(prof); }
      block = null;
    } else if (block && upper.startsWith('PEPMASS=')) {
      const n = numbersIn(s.slice(s.indexOf('=') + 1));
      if (n.length) extra.push(n[0]);
    } else if (block && s && (/\d/.test(s[0]) || s[0] === '.')) {
      const n = numbersIn(s);
      if (n.length >= 2) block.push([n[0], n[1]]);
    }
  }
  const d = spectraResult('MGF', scans, flags);
  append(d.mz, extra);
  append(d.intensity, extra.map(() => NaN));
  return d;
}

// ---------------------------------------------------------------- JCAMP-DX

const SQZ: Record<string, number> = {}, DIF: Record<string, number> = {}, DUP: Record<string, number> = {};
'@ABCDEFGHI'.split('').forEach((c, i) => { SQZ[c] = i; });
'abcdefghi'.split('').forEach((c, i) => { SQZ[c] = -(i + 1); });
'%JKLMNOPQR'.split('').forEach((c, i) => { DIF[c] = i; });
'jklmnopqr'.split('').forEach((c, i) => { DIF[c] = -(i + 1); });
'STUVWXYZs'.split('').forEach((c, i) => { DUP[c] = i + 1; });
const ASDF_TOKEN = /[@A-Ia-i%J-Rj-rS-Zs]\d*|[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g;
const ASDF_CHARS = /[@A-DF-Ia-df-i%J-Rj-rS-Zs]/;

const signed = (first: number, digits: string): number => Number(`${Math.abs(first)}${digits}`) * (first < 0 ? -1 : 1);

/** One line of JCAMP-DX XYDATA in AFFN or ASDF form: its numbers (X first), and whether it ended in DIF form (the next line's first Y is then a check value). */
export function decodeAsdfLine(line: string): [number[], boolean] {
  const values: number[] = [];
  let lastKind = '', lastDelta = 0;
  for (const tok of line.match(ASDF_TOKEN) ?? []) {
    const c = tok[0];
    if (c in SQZ) { values.push(signed(SQZ[c], tok.slice(1))); lastKind = 'sqz'; }
    else if (c in DIF) { const d = signed(DIF[c], tok.slice(1)); values.push((values.length ? values[values.length - 1] : 0) + d); lastKind = 'dif'; lastDelta = d; }
    else if (c in DUP) {
      const count = Number(`${DUP[c]}${tok.slice(1)}`);
      if (count > MAX_POINTS || values.length + count > MAX_POINTS) throw new ReportReadError('This JCAMP-DX file is damaged (a repeat count is far too large).');
      for (let k = 0; k < count - 1; k++) {
        if (lastKind === 'dif') values.push(values[values.length - 1] + lastDelta);
        else if (values.length) values.push(values[values.length - 1]);
      }
    } else { values.push(Number(tok)); lastKind = 'affn'; }
  }
  return [values, lastKind === 'dif'];
}

const firstNumber = (text: string | undefined, fallback: number | null = null): number | null => { const m = (text ?? '').match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/); return m ? Number(m[0]) : fallback; };

export function readJcamp(text: string): ReportData {
  const scans: [number[], number[]][] = [], flags: boolean[] = [];
  let labels: Record<string, string> = {};
  let mode = '', rows: number[] = [], xy: number[] = [], xsFirst: number[] = [], checkNext = false;
  const finish = (): void => {
    let xf = firstNumber(labels.XFACTOR, 1) || 1, yf = firstNumber(labels.YFACTOR, 1) || 1;
    const factors = numbersIn(labels.FACTOR ?? '');
    if (mode === 'pairs' && rows.length) {
      if (factors.length >= 2 && !('XFACTOR' in labels)) [xf, yf] = factors;
      const n = Math.floor(rows.length / 2);
      const [m, i, prof] = scanPeaks(Array.from({ length: n }, (_, k) => rows[2 * k] * xf), Array.from({ length: n }, (_, k) => rows[2 * k + 1] * yf), null);
      scans.push([m, i]); flags.push(prof);
    } else if (mode === 'xydata' && xy.length) {
      const first = firstNumber(labels.FIRSTX), last = firstNumber(labels.LASTX), np = firstNumber(labels.NPOINTS);
      const n = xy.length;
      let x: number[];
      if (first !== null && last !== null && n > 1) {
        const count = np && Math.trunc(np) === n ? Math.trunc(np) : n;
        x = Array.from({ length: count }, (_, k) => first + ((last - first) * k) / (count - 1));
      } else if (xsFirst.length) {
        const delta = firstNumber(labels.DELTAX, 1) ?? 1;
        x = Array.from({ length: n }, (_, k) => xsFirst[0] * xf + k * delta);
      } else x = Array.from({ length: n }, (_, k) => k);
      const [m, i, prof] = scanPeaks(x.slice(0, n), xy.map((v) => v * yf), true);
      scans.push([m, i]); flags.push(prof);
    }
    mode = ''; rows = []; xy = []; xsFirst = [];
  };
  for (const line of text.split(/\r\n?|\n/)) {
    const s = line.trim();
    if (s.startsWith('$$')) continue;
    if (s.startsWith('##')) {
      const eq = s.indexOf('=');
      const label = (eq >= 0 ? s.slice(2, eq) : s.slice(2)).trim().toUpperCase();
      const value = (eq >= 0 ? s.slice(eq + 1) : '').split('$$')[0].trim();
      if (['PEAK TABLE', 'XYPOINTS', 'DATA TABLE', 'XYDATA', 'END', 'PAGE', 'TITLE'].includes(label)) finish();
      const compact = value.toUpperCase().replace(/ /g, '');
      if (label === 'PEAK TABLE' || label === 'XYPOINTS' || (label === 'DATA TABLE' && compact.includes('XY..XY'))) mode = 'pairs';
      else if ((label === 'XYDATA' || label === 'DATA TABLE') && compact.includes('Y..Y')) { mode = 'xydata'; checkNext = false; }
      else if (label === 'TITLE') labels = {};
      labels[label] = value;
      continue;
    }
    if (mode === 'pairs') append(rows, numbersIn(s));
    else if (mode === 'xydata' && s) {
      const [values, endsDif] = ASDF_CHARS.test(s) ? decodeAsdfLine(s) : [numbersIn(s), false];
      if (!values.length) continue;
      xsFirst.push(values[0]);
      let ys = values.slice(1);
      if (checkNext && ys.length) ys = ys.slice(1);
      append(xy, ys);
      if (xy.length > MAX_POINTS) throw new ReportReadError('This JCAMP-DX file has too many points to read here.');
      checkNext = endsDif;
    }
  }
  finish();
  if (!scans.length) throw new ReportReadError('No mass spectrum (peak table or XYDATA) was found in this JCAMP-DX file.');
  return spectraResult('JCAMP-DX', scans, flags);
}

// ---------------------------------------------------------------- netCDF (ANDI-MS)

const NC_TYPES: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 4, 6: 8 };
const STREAMING = 0xffffffff;

/** A classic (or 64-bit offset) netCDF file's global attributes and numeric variables (just what ANDI-MS files need). */
export function readNetcdfVariables(content: Uint8Array): [Record<string, unknown>, Map<string, [number[], Record<string, unknown>]>] {
  if (!(content[0] === 0x43 && content[1] === 0x44 && content[2] === 0x46) || ![1, 2].includes(content[3])) {
    throw new ReportReadError('This .cdf file is not a classic netCDF file (netCDF-4/HDF5 files can’t be read). Export it again as ANDI-MS (netCDF 3).');
  }
  const v = new DataView(content.buffer, content.byteOffset, content.byteLength);
  const offset64 = content[3] === 2;
  let pos = 4;
  const u32 = (): number => { const x = v.getUint32(pos, false); pos += 4; return x; };
  const off = (): number => { if (offset64) { const hi = v.getUint32(pos, false), lo = v.getUint32(pos + 4, false); pos += 8; return hi * 2 ** 32 + lo; } return u32(); };
  const name = (): string => { const n = u32(); const t = new TextDecoder().decode(content.subarray(pos, pos + n)); pos += Math.ceil(n / 4) * 4; return t; };
  const read = (type: number, n: number, at: number): number[] => {
    const out: number[] = [];
    const size = NC_TYPES[type];
    for (let k = 0; k < n; k++) {
      const p = at + k * size;
      out.push(type === 1 ? v.getInt8(p) : type === 3 ? v.getInt16(p, false) : type === 4 ? v.getInt32(p, false) : type === 5 ? v.getFloat32(p, false) : v.getFloat64(p, false));
    }
    return out;
  };
  const values = (type: number, n: number): unknown => {
    const size = NC_TYPES[type];
    if (!size) throw new ReportReadError('This netCDF file is damaged (an attribute has an unknown type).');
    let got: unknown;
    if (type === 2) got = new TextDecoder().decode(content.subarray(pos, pos + n)).replace(/\0+$/, '');
    else got = read(type, n, pos);
    pos += Math.ceil((n * size) / 4) * 4;
    return got;
  };
  const attributes = (): Record<string, unknown> => {
    const tag = u32(), n = u32();
    const out: Record<string, unknown> = {};
    if (tag === 0 && n === 0) return out;
    for (let k = 0; k < n; k++) { const nm = name(); const type = u32(), count = u32(); out[nm] = values(type, count); }
    return out;
  };
  let numrecs = u32();
  let tag = u32(), n = u32();
  const dims: [string, number][] = [];
  for (let k = 0; k < (tag ? n : 0); k++) dims.push([name(), u32()]);
  const gatts = attributes();
  tag = u32(); n = u32();
  const specs: { name: string; dimids: number[]; atts: Record<string, unknown>; type: number; vsize: number; begin: number }[] = [];
  for (let k = 0; k < (tag ? n : 0); k++) {
    const nm = name();
    const nd = u32();
    const dimids = Array.from({ length: nd }, () => u32());
    const atts = attributes();
    const type = u32(), vsize = u32(), begin = off();
    specs.push({ name: nm, dimids, atts, type, vsize, begin });
  }
  for (const s of specs) if (!NC_TYPES[s.type] || s.dimids.some((d) => d < 0 || d >= dims.length)) throw new ReportReadError('This netCDF file is damaged (a variable has an unknown type or dimension).');
  const recordVars = specs.filter((s) => s.dimids.length && dims[s.dimids[0]][1] === 0);
  let recsize = recordVars.reduce((a, s) => a + s.vsize, 0);
  if (recordVars.length === 1) recsize = NC_TYPES[recordVars[0].type] * recordVars[0].dimids.slice(1).reduce((a, d) => a * dims[d][1], 1);
  if (recordVars.length) {
    const first = recordVars.reduce((a, s) => Math.min(a, s.begin), Infinity);
    const fit = recsize > 0 && first < content.length ? Math.floor((content.length - first) / recsize) : 0;
    numrecs = numrecs === STREAMING ? fit : Math.min(numrecs, Math.max(0, fit));
  }
  const out = new Map<string, [number[], Record<string, unknown>]>();
  for (const s of specs) {
    if (s.type === 2) continue;
    const size = NC_TYPES[s.type];
    const shape = s.dimids.map((d) => dims[d][1]);
    let arr: number[];
    if (shape.length && shape[0] === 0) {
      const per = shape.slice(1).reduce((a, b) => a * b, 1);
      if (numrecs && (per * size > recsize || s.begin + (numrecs - 1) * recsize + per * size > content.length)) throw new ReportReadError('This netCDF file is damaged (its records don’t fit).');
      arr = [];
      for (let k = 0; k < numrecs; k++) append(arr, read(s.type, per, s.begin + k * recsize));
    } else {
      const count = shape.reduce((a, b) => a * b, 1);
      if (s.begin + count * size > content.length) throw new ReportReadError('This netCDF file is damaged (a variable is cut off).');
      arr = read(s.type, count, s.begin);
    }
    out.set(s.name, [arr, s.atts]);
  }
  return [gatts, out];
}

export function readNetcdf(content: Uint8Array): ReportData {
  const [gatts, vars] = readNetcdfVariables(content);
  for (const key of ['mass_values', 'intensity_values', 'scan_index']) if (!vars.has(key)) throw new ReportReadError(`This netCDF file is not an ANDI-MS mass spectrum (it has no ${key}).`);
  const scaled = (key: string): number[] => {
    const [arr, atts] = vars.get(key)!;
    const sf = atts.scale_factor;
    const f = Array.isArray(sf) && sf.length ? Number(sf[0]) : null;
    return f !== null ? arr.map((x) => x * f) : arr;
  };
  const mz = scaled('mass_values'), inten = scaled('intensity_values');
  const index = vars.get('scan_index')![0].map(Math.trunc);
  const counts = vars.has('point_count') ? vars.get('point_count')![0].map(Math.trunc) : index.map((s, k) => (k + 1 < index.length ? index[k + 1] : mz.length) - s);
  const kind = String(gatts.experiment_type ?? '').toLowerCase();
  const profile = kind.includes('continuum') || kind.includes('profile') ? true : kind.includes('centroid') ? false : null;
  const scans: [number[], number[]][] = [], flags: boolean[] = [];
  index.forEach((start, k) => {
    const [m, i, prof] = scanPeaks(mz.slice(start, start + counts[k]), inten.slice(start, start + counts[k]), profile);
    scans.push([m, i]); flags.push(prof);
  });
  return spectraResult('netCDF (ANDI-MS)', scans, flags);
}

// ---------------------------------------------------------------- text reports

const MZ_TEXT = notAfter(/(\d{2,4}\.\d{3,7})(?!\d|\.\d|\s*%)/g, /[\w.,:/+-]/);
const CALC_WORDS = String.raw`(?:calc(?:ulated|d)?\.?|theor(?:etical|\.)?|theo\.?|expected|exact\s+mass|required|requires|target)(?![A-Za-z])`;
const FOUND_WORDS = String.raw`(?:found|meas(?:ured|\.)?|observed|obsd\.?|obs\.?|experimental|exptl\.?|detected|accurate\s+mass)(?![A-Za-z])`;
// (a keyword does not start inside a word, nor "m/z" or "mass" after a slash)
const KEYWORD = notAfter(new RegExp(`(?<calc>${CALC_WORDS})|(?<found>${FOUND_WORDS})`, 'gi'), /[A-Za-z]/);
const HEADER_MASS = guarded(new RegExp(
  `(?<calc>${CALC_WORDS}\\s*(?:ion\\s+)?(?:m/z|mass|m\\.z\\.)?)|(?<meas>${FOUND_WORDS}\\s*(?:ion\\s+)?(?:m/z|mass)?)|` +
  String.raw`(?<plain>(?:m/z|mass|m\.z\.)(?![\w/])(?!\s*(?:error|accuracy|diff|defect|range|spectr|tolerance|window|resolution|shift|delta)))`, 'gi'), (m, s) => m.index === 0 || !(m.groups!.plain === undefined ? /[A-Za-z]/ : /[\w/]/).test(s[m.index - 1]));
const COLUMN_WORDS = /abund|intens|\bint\.?\b|formula|ppm|mda|\bdiff|error|\berr\b|\bdbe\b|\brdb|score|composition|\bion\b|height|area|delta|i-fit|relative|\brel\b|%|\bres\b|charge|adduct|species|\bz\b/i;

const inRange = (v: number): boolean => v >= MZ_RANGE[0] && v <= MZ_RANGE[1];
const groupOf = (m: RegExpMatchArray): string => Object.entries(m.groups ?? {}).find(([, x]) => x !== undefined)?.[0] ?? '';

/** The mass columns of a table header, in order ("calc" or "meas"); null when `line` is not a header. */
export function headerColumns(line: string): string[] | null {
  MZ_TEXT.lastIndex = 0;
  if (MZ_TEXT.test(line)) { MZ_TEXT.lastIndex = 0; return null; }
  MZ_TEXT.lastIndex = 0;
  const found = [...line.matchAll(HEADER_MASS)].map(groupOf);
  if (!found.length) return null;
  const rest = line.replace(HEADER_MASS, ' ');
  if (!COLUMN_WORDS.test(rest) && found.length < 2) return null;
  const hasMeas = found.includes('meas');
  return found.map((k) => (k === 'plain' ? (hasMeas ? 'calc' : 'meas') : k));
}

/** For each number of a line of running text: "calc" or "found" after the nearest such word before it, else "". */
function labeled(line: string, numbers: [number, number][]): string[] {
  const words = [...line.matchAll(KEYWORD)];
  return numbers.map(([pos]) => { const before = words.filter((w) => (w.index ?? 0) + w[0].length <= pos); return before.length ? groupOf(before[before.length - 1]) : ''; });
}

function textResult(kind: string, measured: number[], calculated: number[], plain: number[], intensity?: Map<number, number>): ReportData {
  const calcKeys = new Set(calculated.map((v) => Math.round(v * 1e4)));
  const values = [...new Set([...measured, ...plain.filter((v) => !calcKeys.has(Math.round(v * 1e4)))])];
  return data(kind, { mz: values, intensity: values.map((v) => intensity?.get(v) ?? NaN), measured: new Set(measured.map(r6)), calculated: [...new Set(calculated)] });
}

/** The m/z values in a report's text: table rows by their header's columns, labeled numbers in running text, and other plausible m/z values. */
export function parseReportText(text: string, kind = 'text report'): ReportData {
  const measured: number[] = [], calculated: number[] = [], plain: number[] = [];
  let columns: string[] | null = null;
  let idle = 0;
  for (const line of text.split(/\r\n?|\n/)) {
    const head = headerColumns(line);
    if (head) { columns = head; idle = 0; continue; }
    const numbers = [...line.matchAll(MZ_TEXT)].map((m): [number, number] => [m.index ?? 0, Number(m[1])]).filter(([, v]) => inRange(v));
    if (!numbers.length) { if (line.trim() && ++idle > 3) columns = null; continue; }
    idle = 0;
    const labels = labeled(line, numbers);
    if (columns && numbers.length >= columns.length && !labels.some(Boolean)) {
      numbers.slice(0, columns.length).forEach(([, v], k) => (columns![k] === 'calc' ? calculated : measured).push(v));
      plain.push(...numbers.slice(columns.length).map(([, v]) => v));
      continue;
    }
    if (columns && numbers.length === 1 && columns.every((c) => c === 'meas') && !labels[0]) { measured.push(numbers[0][1]); continue; }
    numbers.forEach(([, v], k) => (labels[k] === 'calc' ? calculated : labels[k] === 'found' ? measured : plain).push(v));
  }
  return textResult(kind, measured, calculated, plain);
}

// ---------------------------------------------------------------- tables (CSV, XLSX)

const INTENSITY_HEADER = /intens|abund|\bint\b|\bint\.|counts|height|area|\by\b|relative|\brel\b|%/i;

function cellNumber(text: string, comma: boolean): number | null {
  let s = String(text).trim().replace(/^"|"$/g, '').replace(/−/g, '-');
  if (!s) return null;
  if (comma) { if ((s.match(/,/g) ?? []).length === 1) s = s.replace(/\./g, '').replace(',', '.'); }
  else if (/^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s) && !/^[+-]?(inf|infinity|nan)$/i.test(s)) return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

const decimals = (text: string): number => { const m = /[.,](\d+)\s*$/.exec(String(text).trim()); return m ? m[1].length : 0; };

/** Rows of a delimited text, whether it uses decimal commas, and whether it has a delimiter (tab, semicolon, comma) rather than spaces. */
export function splitRows(text: string): [string[][], boolean, boolean] {
  const lines = text.split(/\r\n?|\n/).filter((l) => l.trim());
  const sample = lines.slice(0, 200);
  let best: string | null = null, bestScore = 0;
  for (const d of ['\t', ';', ',']) {
    const counts = sample.map((l) => l.split(d).length - 1);
    const tally = new Map<number, number>();
    for (const c of counts) tally.set(c, (tally.get(c) ?? 0) + 1);
    let common = 0, most = -1;
    for (const [c, k] of tally) if (k > most || (k === most && c > common)) { common = c; most = k; }
    const score = counts.filter((c) => c === common && c > 0).length;
    if (common && score > bestScore) { best = d; bestScore = score; }
  }
  let rows: string[][];
  if (best === null || bestScore < Math.max(2, Math.floor(sample.length / 3))) { rows = lines.map((l) => l.trim().split(/\s+/)); best = null; }
  else rows = lines.map((l) => l.split(best!).map((c) => c.trim()));
  const head = rows.slice(0, 200).flat();
  const comma = (best === '\t' || best === ';' || best === null) && head.filter((c) => /^\s*[+-]?\d+,\d+\s*$/.test(c)).length > head.filter((c) => /^\s*[+-]?\d+\.\d+\s*$/.test(c)).length;
  return [rows, comma, best !== null];
}

/** m/z values from a table: its header says which columns are m/z (measured or calculated) and intensity; without one, the shape of the numbers. Null when it is no table of m/z values. */
export function tableValues(rows: string[][], comma = false, kind = 'peak list'): ReportData | null {
  let headerAt: number | null = null, massCols: [number, string][] = [], intenCol: number | null = null;
  for (let r = 0; r < Math.min(50, rows.length); r++) {
    const row = rows[r];
    const kinds = row.map((cell) => {
      if (cellNumber(cell, comma) !== null) return null;
      const found = [...String(cell).matchAll(HEADER_MASS)].map(groupOf);
      return found.length === 1 ? found[0] : null;
    });
    if (kinds.some(Boolean)) {
      const hasMeas = kinds.includes('meas');
      massCols = kinds.map((k, c) => [c, k] as [number, string | null]).filter((x): x is [number, string] => !!x[1]).map(([c, k]) => [c, k === 'plain' ? (hasMeas ? 'calc' : 'meas') : k]);
      const ic = row.findIndex((cell, c) => kinds[c] === null && INTENSITY_HEADER.test(String(cell)));
      intenCol = ic >= 0 ? ic : null;
      headerAt = r;
      break;
    }
  }
  const measured: number[] = [], calculated: number[] = [], plain: number[] = [];
  const intensity = new Map<number, number>();
  const paired = massCols.some(([, k]) => k === 'calc');
  if (headerAt !== null) {
    for (const row of rows.slice(headerAt + 1)) {
      const inten = intenCol !== null && intenCol < row.length ? cellNumber(row[intenCol], comma) : null;
      for (const [c, k] of massCols) {
        if (c >= row.length) continue;
        const v = cellNumber(row[c], comma);
        if (v === null || v <= 0) continue;
        if (k === 'calc') calculated.push(v);
        else { (paired ? measured : plain).push(v); if (inten !== null) intensity.set(v, inten); }
      }
    }
    return measured.length || calculated.length || plain.length ? tableResult(kind, measured, calculated, plain, intensity) : null;
  }
  const numeric: [number, number][][] = [];
  for (const row of rows) {
    const nums = row.map((c): [number | null, number] => [cellNumber(c, comma), decimals(c)]);
    if (nums.length && nums.every(([n]) => n !== null)) numeric.push(nums as [number, number][]);
  }
  if (numeric.length < 3) return null;
  const widths = new Map<number, number>();
  for (const r of numeric) widths.set(r.length, (widths.get(r.length) ?? 0) + 1);
  const width = [...widths].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
  const same = numeric.filter((r) => r.length === width);
  let mzCol: number | null = null;
  for (let c = 0; c < width; c++) if (same.filter((r) => inRange(r[c][0]) && r[c][1] >= 3).length >= 0.8 * same.length) { mzCol = c; break; }
  if (mzCol === null) return null;
  const ic = mzCol + 1 < width ? mzCol + 1 : null;
  for (const r of same) { const v = r[mzCol][0]; plain.push(v); if (ic !== null) intensity.set(v, r[ic][0]); }
  return tableResult(kind, [], [], plain, intensity);
}

function tableResult(kind: string, measured: number[], calculated: number[], plain: number[], intensity: Map<number, number>): ReportData {
  const values = [...measured, ...plain];
  const inten = values.map((v) => intensity.get(v) ?? NaN);
  if (values.length >= 30 && inten.every(Number.isFinite)) {
    const [mz, i, prof] = scanPeaks(values, inten, null);
    if (prof) {
      const d = textResult(kind, [], calculated, mz, new Map(mz.map((m, k) => [m, i[k]])));
      d.profile = true; d.scans = 1;
      return d;
    }
  }
  return textResult(kind, measured, calculated, plain, intensity);
}

/** A CSV/TSV/TXT file: a peak list (a table), or else a text report. */
export function readTableText(text: string): ReportData {
  const [rows, comma, delimited] = splitRows(text);
  const numeric = rows.filter((r) => r.length && r.every((c) => cellNumber(c, comma) !== null)).length;
  if (delimited || (numeric >= 3 && numeric >= 0.5 * rows.length)) {
    const d = tableValues(rows, comma, 'peak list');
    if (d && d.mz.length) return d;
  }
  return parseReportText(text, 'text report');
}

// ---------------------------------------------------------------- Excel .xlsx

const XLSX_MAX_COLUMN = 16384, XLSX_MAX_COLUMNS = 256, XLSX_MAX_CELLS = 1_000_000;

const xmlText = (s: string): string => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&');

function columnIndex(ref: string): number {
  const m = /^[A-Z]{1,8}/.exec(ref.toUpperCase());
  if (!m) return -1;
  let n = 0;
  for (const ch of m[0]) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

function excelNumber(text: string): string {
  const v = Number(text);
  if (!Number.isFinite(v)) return text;
  return v !== Math.trunc(v) || text.includes('.') ? v.toFixed(8).replace(/0+$/, '').replace(/\.$/, '') : String(Math.trunc(v));
}

/** Every sheet of an .xlsx workbook as rows of cell texts (shared and inline strings resolved). */
export function xlsxRows(content: Uint8Array, maxRows = 100000, rowCounts?: number[]): string[][][] {
  const files = unzipSync(content, {
    filter: (f) => {
      const wanted = f.name === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(f.name);
      // (fflate unpacks an entry into a buffer of its stated size, so a larger one stops there)
      if (wanted && f.originalSize > XLSX_MAX_PART_BYTES) throw new ReportReadError('This Excel file is too large to read here. Save the peak list as CSV and add that.');
      return wanted;
    },
  });
  const dec = new TextDecoder();
  const shared: string[] = [];
  if (files['xl/sharedStrings.xml']) {
    for (const si of elements(dec.decode(files['xl/sharedStrings.xml']), 'si')) shared.push([...si.inner.matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g)].map((m) => xmlText(m[1])).join(''));
  }
  const sheets = Object.keys(files).filter((n) => n.startsWith('xl/worksheets/')).sort((a, b) => Number(/(\d+)\.xml$/.exec(a)![1]) - Number(/(\d+)\.xml$/.exec(b)![1]));
  const out: string[][][] = [];
  let budget = XLSX_MAX_CELLS;
  for (const name of sheets) {
    const sparse: Map<number, string>[] = [];
    let read = 0, rowsThere = 0;
    for (const row of elements(dec.decode(files[name]), 'row')) {
      if (sparse.length >= maxRows || read >= budget) {
        // (past the rows read: only counted, for how many are left out)
        if (!rowCounts) break;
        if (/<(?:\w+:)?c[\s/>]/.test(row.inner)) rowsThere++;
        continue;
      }
      const cells = new Map<number, string>();
      for (const c of elements(row.inner, 'c')) {
        const ref = attr(c.attrs, 'r') ?? '';
        const col = ref ? columnIndex(ref) : cells.size ? maxOf([...cells.keys()]) + 1 : 0;
        if (col < 0 || col >= XLSX_MAX_COLUMN) continue;
        const t = attr(c.attrs, 't') ?? '';
        const vm = /<(?:\w+:)?v(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?v>/.exec(c.inner);
        let text: string;
        if (t === 's' && vm) { const k = Number(vm[1].trim()); text = Number.isInteger(k) && k >= 0 && k < shared.length ? shared[k] : ''; }
        else if (t === 'inlineStr') text = [...c.inner.matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g)].map((m) => xmlText(m[1])).join('');
        else { text = vm ? xmlText(vm[1]) : ''; if (!['str', 'b', 'e'].includes(t) && text) text = excelNumber(text); }
        cells.set(col, text);
      }
      if (!cells.size) continue;
      sparse.push(cells);
      rowsThere++;
      read += cells.size;
    }
    rowCounts?.push(rowsThere);
    const used = [...new Set(sparse.flatMap((c) => [...c.keys()]))].sort((a, b) => a - b).slice(0, XLSX_MAX_COLUMNS);
    const keep = used.length ? sparse.slice(0, Math.max(1, Math.floor(budget / used.length))) : sparse;
    const rows = keep.map((c) => used.map((col) => c.get(col) ?? ''));
    budget = Math.max(0, budget - rows.length * used.length);
    out.push(rows);
  }
  return out;
}

export function readXlsx(content: Uint8Array): ReportData {
  let sheets: string[][][];
  try { sheets = xlsxRows(content); } catch (e) { if (e instanceof ReportReadError) throw e; throw new ReportReadError('This Excel file could not be read (it may be damaged).'); }
  let best: ReportData | null = null;
  for (const rows of sheets) {
    const d = tableValues(rows, false, 'Excel file');
    if (d && d.mz.length && (!best || d.mz.length > best.mz.length)) best = d;
  }
  if (best) return best;
  return parseReportText(sheets.flatMap((rows) => rows.map((r) => r.join('  '))).join('\n'), 'Excel file');
}

// ---------------------------------------------------------------- picking the found m/z

/** The report value used as the found m/z (see the top of this file); null when none is close enough. */
export function chooseMatch(reports: ReportData[], peaks: Peak[], tolerance: number): Match | null {
  let bestKey: [number, number, number] | null = null, best: Match | null = null;
  for (const rep of reports) {
    if (!rep.readable || !rep.mz.length) continue;
    for (const peak of peaks) {
      const window = peak.mz * tolerance * 1e-6;
      for (const value of rep.mz) {
        if (Math.abs(value - peak.mz) > window + 1e-12) continue;
        const ppm = ((value - peak.mz) / peak.mz) * 1e6;
        const measured = isMeasured(rep, value);
        const key: [number, number, number] = [measured ? 0 : 1, peak.mono ? 0 : 1, Math.abs(ppm)];
        if (!bestKey || key[0] < bestKey[0] || (key[0] === bestKey[0] && (key[1] < bestKey[1] || (key[1] === bestKey[1] && key[2] < bestKey[2])))) {
          bestKey = key;
          best = { mz: value, file: rep.name, peak, ppm, measured };
        }
      }
    }
  }
  return best;
}

/** How a found m/z from a report is written in the Found box (four decimals). */
export const formatMz = (mz: number): string => mz.toFixed(4);

/** Whether the Found box still holds the value filled from a report. */
export function foundIsFromReport(value: Record<string, unknown>): boolean {
  const source = value[FOUND_FROM_KEY];
  const found = String(value.found ?? '').trim();
  if (!source || typeof source !== 'object' || Array.isArray(source) || !found) return false;
  const mz = Number((source as Record<string, unknown>).mz);
  return Number.isFinite(mz) && found === formatMz(mz);
}

/**
 * Fill the Found box from the reports' match (in `value`; nothing saved) when it is empty or
 * still holds the value filled from a report before. A typed value is never changed (its
 * found_from goes). "filled", "cleared" (the report value no longer fits) or "".
 */
export function updateFound(value: Record<string, unknown>, match: Match | null): 'filled' | 'cleared' | '' {
  const fromReport = foundIsFromReport(value);
  const found = String(value.found ?? '').trim();
  if (!fromReport) {
    delete value[FOUND_FROM_KEY];
    if (found) return '';
  }
  if (!match) {
    if (fromReport) { value.found = ''; delete value[FOUND_FROM_KEY]; return 'cleared'; }
    return '';
  }
  const next = formatMz(match.mz);
  const source = { file: match.file, mz: r6(match.mz) };
  const old = value[FOUND_FROM_KEY] as Record<string, unknown> | undefined;
  if (fromReport && found === next && old && old.file === source.file && Number(old.mz) === source.mz) return '';
  value.found = next;
  value[FOUND_FROM_KEY] = source;
  return 'filled';
}

/** When the found m/z was typed and differs from the reports' value by more than the tolerance: the warning ('' otherwise). */
export function differsMessage(value: Record<string, unknown>, match: Match | null, tolerance: number): string {
  if (foundIsFromReport(value) || !match) return '';
  const found = Number(String(value.found ?? '').trim().replace(',', '.'));
  if (!Number.isFinite(found) || found <= 0 || !String(value.found ?? '').trim()) return '';
  const ppm = ((found - match.mz) / match.mz) * 1e6;
  if (Math.abs(ppm) <= tolerance) return '';
  return `The found m/z you typed (${found.toFixed(4)}) is ${ppm >= 0 ? '+' : '-'}${Math.abs(ppm).toFixed(1)} ppm from the report's value (${match.mz.toFixed(4)} in ${match.file}). Check which is right.`;
}

/** The largest peaks of a data file near the expected m/z (from `below` under to `above` over it; all without one): [m/z, % of the largest], by m/z. */
export function peaksNear(d: ReportData, centre: number | null, below = 2, above = 6, count = 10): [number, number][] {
  let idx = d.mz.map((_, i) => i);
  if (centre !== null) idx = idx.filter((i) => d.mz[i] >= centre - below && d.mz[i] <= centre + above);
  if (!idx.length) return [];
  const inten = (i: number): number => (Number.isFinite(d.intensity[i]) ? d.intensity[i] : 0);
  const top = [...idx].sort((a, b) => inten(a) - inten(b)).slice(-count);
  const base = maxOf(idx.map(inten)) || 1;
  return top.map((i): [number, number] => [d.mz[i], (inten(i) / base) * 100]).sort((a, b) => a[0] - b[0]);
}

// ---------------------------------------------------------------- printed listings

const LISTING_LINES = 150, LISTING_WIDTH = 110;

/** Table rows as lines in aligned columns (cells cut at `cellMax`); a row with one filled cell (a title) as it is. */
export function aligned(rows: string[][], cellMax = 18): string[] {
  const widths = new Map<number, number>();
  for (const row of rows.slice(0, 2000)) {
    if (row.filter((c) => String(c).trim()).length < 2) continue;
    row.forEach((c, i) => widths.set(i, Math.min(cellMax, Math.max(widths.get(i) ?? 0, String(c).trim().length))));
  }
  return rows.map((row) => {
    const filled = row.map((c) => String(c).trim()).filter(Boolean);
    if (filled.length < 2) return filled[0] ?? '';
    return row.map((cell, i) => {
      let c = String(cell).trim();
      if (c.length > cellMax) c = c.slice(0, cellMax - 1) + '…';
      return c.padEnd(widths.get(i) ?? 0);
    }).join('  ').trimEnd();
  });
}

const trimmed = (lines: string[]): string[] => { const out = [...lines]; while (out.length && !out[out.length - 1].trim()) out.pop(); return out; };

/**
 * A text-like report as lines to print in a monospaced listing: delimited tables and Excel
 * sheets in aligned columns, other text as it is (tabs expanded); long lines cut at `width`.
 * [lines, how many were left out]. Never throws: a file that can't be read gives one line saying so.
 */
export function reportListing(bytes: Uint8Array, name: string, most = LISTING_LINES, width = LISTING_WIDTH): [string[], number] {
  const ext = extOf(name);
  try {
    let lines: string[], total: number;
    if (ext === '.xlsx' || ext === '.xlsm') {
      const counts: number[] = [];
      const sheets = xlsxRows(bytes, most + 1000, counts);
      lines = trimmed(aligned(sheets.flatMap((s) => [...s, []])));
      // (the rows of each sheet past those read count too)
      total = lines.length + sheets.reduce((n, s, i) => n + Math.max(0, (counts[i] ?? s.length) - s.length), 0);
    } else {
      if (bytes.length > MAX_FILE_BYTES) throw new ReportReadError('too large');
      const text = decode(bytes);
      if (['.csv', '.tsv', '.tab'].includes(ext)) {
        lines = trimmed(aligned(splitRows(text)[0]));
        total = lines.length;
      } else {
        const raw = text.split(/\r\n?|\n/);
        total = raw.length;
        while (total && !raw[total - 1].trim()) total--;
        lines = raw.slice(0, Math.min(total, most)).map((l) => {
          let out = '';
          for (const ch of l) out += ch === '\t' ? ' '.repeat(8 - (out.length % 8)) : ch;
          return out.trimEnd();
        });
      }
    }
    return [lines.slice(0, most).map((l) => (l.length <= width ? l : l.slice(0, width - 1) + '…')), Math.max(0, total - most)];
  } catch {
    return [[`(could not be read: this ${ext === '.xlsx' || ext === '.xlsm' ? 'Excel file' : 'file'} may be damaged)`], 0];
  }
}

/** True for the one line reportListing gives for a file it could not read. */
export const listingFailed = (lines: string[]): boolean => lines.length === 1 && lines[0].startsWith('(could not be read');
