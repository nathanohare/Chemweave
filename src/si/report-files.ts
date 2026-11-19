// Reading a compound's HRMS report files (hrms/), as SI Assistant reads them: what a file is is
// decided from its name, size and whether it is a folder before anything is read (instrument raw
// data, often gigabytes, is never read; a raw-data folder is kept, not "missing"); a data file is
// read in a background worker; and what was read is remembered until the file changes (its size
// or time), so the SI page and the compiled SI read each file once.

import type { SiFolder } from './folder';
import { notOpened, readReport, readReportBytes, reportWithoutReading, type PdfText, type ReportData, type ReportFileInfo } from './ms-reports';
import type { ReportRequest, ReportResponse } from '../worker/ms-report-worker';

// ---------------------------------------------------------------- the background worker

let worker: Worker | null | undefined;
let next = 1;
const waiting = new Map<number, { name: string; resolve: (d: ReportData) => void }>();

const stopped = (name: string): ReportData => ({
  name, kind: 'file', mz: [], intensity: [], measured: new Set(), calculated: [], readable: false, profile: false, scans: 0,
  message: `${name} could not be read (it may be damaged, or too large to read here): the reading stopped. Export a peak list or a PDF report of the spectrum and add that.`,
});

function start(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    if (typeof Worker === 'undefined') return (worker = null);
    worker = import.meta.env.DEV
      ? new Worker(new URL('../worker/ms-report-worker.ts', import.meta.url), { type: 'module' })
      : new Worker(new URL('../worker/ms-report-worker.ts', import.meta.url));
    worker.onmessage = (e: MessageEvent<ReportResponse>) => {
      const w = waiting.get(e.data.id);
      if (!w) return;
      waiting.delete(e.data.id);
      w.resolve(e.data.data);
    };
    // (out of memory, say: each file waiting says so, and the next file starts a new worker)
    worker.onerror = () => {
      for (const w of waiting.values()) w.resolve(stopped(w.name));
      waiting.clear();
      worker?.terminate();
      worker = undefined;
    };
  } catch {
    worker = null;
  }
  return worker;
}

/** A report that isn't a PDF, read in the background worker (here when no worker can run). The bytes are handed over to the worker: don't use them after. */
export function readInBackground(bytes: Uint8Array, name: string): Promise<ReportData> {
  const w = start();
  if (!w) return Promise.resolve(readReportBytes(bytes, name));
  const id = next++;
  const own = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength && bytes.buffer instanceof ArrayBuffer ? bytes : bytes.slice();
  return new Promise((resolve) => {
    waiting.set(id, { name, resolve });
    w.postMessage({ id, bytes: own, name } satisfies ReportRequest, [own.buffer as ArrayBuffer]);
  });
}

// ---------------------------------------------------------------- remembered

const CACHE_MAX = 64;
const cache = new Map<string, ReportData>();

/** Forget every report read (tests; a project closed). */
export function forgetReports(): void { cache.clear(); }

/**
 * What can be read from the report file `name` in the folder `dir` of the project (a compound's
 * hrms/). Never throws. Remembered while the file's size and time are unchanged (when the folder
 * gives them); a file that can't be opened just now is tried again next time.
 */
export async function readReportFile(folder: SiFolder, dir: string, name: string, pdfText?: PdfText): Promise<ReportData> {
  const path = dir ? `${dir}/${name}` : name;
  const listing = await folder.entries(dir).catch(() => []);
  const entry = listing.find((e) => e.name === name) ?? listing.find((e) => e.name.toLowerCase() === name.toLowerCase());
  let key: string | null = null;
  if (entry) {
    if (entry.modified) key = [folder.where, path, entry.size ?? '', entry.modified, entry.folder ? 'folder' : 'file'].join('\0');
    const hit = key !== null ? cache.get(key) : undefined;
    if (hit) { cache.delete(key!); cache.set(key!, hit); return hit; }
    const info: ReportFileInfo = { size: entry.size ?? null, folder: entry.folder };
    if (entry.folder) info.children = (await folder.entries(path).catch(() => [])).map((e) => e.name);
    const known = reportWithoutReading(name, info);
    if (known) return remember(key, known);
  }
  let bytes: Uint8Array | null;
  try { bytes = await folder.readBytes(path); } catch (e) { return notOpened(name, e instanceof Error ? e.name : 'Error'); }
  if (!bytes && entry) return notOpened(name);
  const d = await readReport(bytes, name, pdfText, readInBackground);
  return bytes ? remember(key, d) : d;
}

function remember(key: string | null, d: ReportData): ReportData {
  if (key === null) return d;
  cache.set(key, d);
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  return d;
}
