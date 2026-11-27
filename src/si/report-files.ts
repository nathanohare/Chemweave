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
/** Files to read, one at a time: the first is with the worker, the others still here (so a worker that stops takes only its own file with it). */
const waiting: { id: number; name: string; bytes: Uint8Array; resolve: (d: ReportData) => void }[] = [];
let active = false;

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
      const w = waiting[0];
      if (!active || !w || w.id !== e.data.id) return;
      waiting.shift();
      active = false;
      w.resolve(e.data.data);
      pump();
    };
    // (out of memory, say: the file being read says so, and the files after it are read by a new worker)
    worker.onerror = () => {
      worker?.terminate();
      worker = undefined;
      if (active) { const w = waiting.shift(); active = false; w?.resolve(stopped(w.name)); }
      pump();
    };
  } catch {
    worker = null;
  }
  return worker;
}

/** Hand the next file to the worker (read here when no worker can run any more). */
function pump(): void {
  while (!active && waiting.length) {
    const w = waiting[0];
    const wk = start();
    if (!wk) { waiting.shift(); w.resolve(readReportBytes(w.bytes, w.name)); continue; }
    active = true;
    try {
      wk.postMessage({ id: w.id, bytes: w.bytes, name: w.name } satisfies ReportRequest, [w.bytes.buffer as ArrayBuffer]);
    } catch {
      active = false;
      waiting.shift();
      w.resolve(stopped(w.name));
    }
  }
}

/** A report that isn't a PDF, read in the background worker (here when no worker can run). The bytes are handed over to the worker: don't use them after. */
export function readInBackground(bytes: Uint8Array, name: string): Promise<ReportData> {
  if (!start()) return Promise.resolve(readReportBytes(bytes, name));
  const own = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength && bytes.buffer instanceof ArrayBuffer ? bytes : bytes.slice();
  return new Promise((resolve) => {
    waiting.push({ id: next++, name, bytes: own, resolve });
    pump();
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
  const listing = await folder.entries(dir).catch(() => []);
  const entry = listing.find((e) => e.name === name) ?? listing.find((e) => e.name.toLowerCase() === name.toLowerCase());
  // (the file as the folder names it: found whatever its case, it is read by that name)
  const path = dir ? `${dir}/${entry?.name ?? name}` : entry?.name ?? name;
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
  // (a copy goes to the worker: the folder may hold these very bytes, as the in-memory one does)
  const d = await readReport(bytes, name, pdfText, (b, n) => readInBackground(b.slice(), n));
  return bytes ? remember(key, d) : d;
}

function remember(key: string | null, d: ReportData): ReportData {
  if (key === null) return d;
  cache.set(key, d);
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  return d;
}
