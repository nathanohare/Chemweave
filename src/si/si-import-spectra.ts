// Import SI, spectra (SPEC §13u.8): which compound each spectrum of an imported SI belongs to and
// what it is (¹H, ¹³C, …), from a Word file's embedded MestReNova spectra or a PDF's spectrum
// pages (SI Assistant's si_import_spectra.py).
//
// * Word: an Mnova object is stored with the picture Word shows of it (an EMF, converted like a
//   pasted Mnova spectrum). Its compound is, in this order: the one whose peak report its printed
//   peak labels clearly fit; the one a header picture next to it names (Mnova's structure + ID +
//   title); the one whose ID labels a ChemDraw drawing grouped with it, else whose structure is
//   drawn there, else the compound whose text the group is in (not when its peaks contradict it).
// * PDF: each spectrum page is cut at its headers ("2a — ¹H NMR (500 MHz, CDCl₃)", "¹H NMR of 2"),
//   one picture per spectrum; the compound is the ID in the header, else the only compound label
//   on the page.
// * The nucleus comes from a header or title naming it, else from the ppm axis (its range).
//
// What can't be matched is listed (cid "") for the user to assign in the review window.

import { cdxToCdxml } from '../io/cdx';
import type { MolFacts } from './chem';
import { peaks as reportPeaks } from './nmr';
import { STEREO, type ImportedCompound, type ImportPlan } from './si-import';
import type { ImportedSpectrum } from './si-import-apply';
import { drawingLabels, drawingStructures, type StructureTools } from './si-import-structures';
import { linePlain, toLines, type DocObject } from './si-import-read';
import type { PdfPages } from './si-import-pdf';

// a nucleus or another spectrum type named in a header or title
const NUCLEUS_SRC = String.raw`(?<![\w{])(?<mass>\d{1,3})\s*(?<el>[A-Z][a-z]?)(?:\s*\{\s*\d{1,3}\s*[A-Z][a-z]?\s*\})?\s*-?\s*NMR\b`;
const TWO_D_SRC = String.raw`\b(?:2D\s+NMR|COSY|HSQC|HMBC|HMQC|NOESY|ROESY|TOCSY)\b`;
const HPLC_SRC = String.raw`\b(?:HPLC|SFC|chromatogram)\b`;
const IR_SRC = String.raw`\bIR\s+spectrum\b|\bFT-?IR\b`;
const NUCLEUS = new RegExp(NUCLEUS_SRC);
const TWO_D = new RegExp(TWO_D_SRC);
const HPLC = new RegExp(HPLC_SRC, 'i');
const IR = new RegExp(IR_SRC);
/** A spectrum's header line (any of the above). */
export const HEADER = new RegExp(`${NUCLEUS_SRC}|${TWO_D_SRC}|${HPLC_SRC}|${IR_SRC}`, 'i');
const OWN_TYPES = ['1H', '13C', '19F', '31P', '11B'];

export const newSpectrum = (kind: ImportedSpectrum['kind'], data: Uint8Array, type: string, extra: Partial<ImportedSpectrum> = {}): ImportedSpectrum =>
  ({ kind, data, type, cid: '', where: '', title: '', how: '', keep: true, shows_structure: false, ...extra });

/** The spectrum type a header or title names ('' if none). */
export function typeFromText(text: string): string {
  const m = NUCLEUS.exec(text);
  if (m) {
    const nucleus = `${m.groups!.mass}${m.groups!.el}`;
    return OWN_TYPES.includes(nucleus) ? nucleus : 'Other NMR';
  }
  if (TWO_D.test(text)) return '2D NMR';
  if (HPLC.test(text)) return 'HPLC/SFC';
  if (IR.test(text)) return 'IR';
  return '';
}

/** ¹H or ¹³C (or ¹⁹F) from the numbers on a ppm axis: their range. */
export function typeFromAxis(numbers: number[]): string {
  if (numbers.length < 3) return '';
  const lo = Math.min(...numbers), hi = Math.max(...numbers);
  if (lo >= -3 && hi <= 16) return '1H';
  if (lo >= -20 && hi >= 90 && hi <= 260) return '13C';
  if (lo <= -40 && hi <= 20) return '19F';
  return '';
}

const utf16 = new TextDecoder('utf-16le');

/** Each EMF record: [type, offset, size]. */
function* records(data: Uint8Array): Generator<[number, number, number, DataView]> {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let pos = 0; pos + 8 <= data.length;) {
    const kind = v.getUint32(pos, true), size = v.getUint32(pos + 4, true);
    if (size < 8 || pos + size > data.length) return;
    yield [kind, pos, size, v];
    pos += size;
  }
}

/** The text of an EMR_EXTTEXTOUTW record (null if it holds none). */
function recordText(data: Uint8Array, v: DataView, pos: number, size: number): string | null {
  const chars = v.getUint32(pos + 44, true), off = v.getUint32(pos + 48, true);
  if (!(chars > 0 && chars < 4096 && off + 2 * chars <= size)) return null;
  return utf16.decode(data.subarray(pos + off, pos + off + 2 * chars));
}

/** The texts an EMF draws (its EMR_EXTTEXTOUTW records), in order. */
export function emfTexts(data: Uint8Array): string[] {
  const out: string[] = [];
  for (const [kind, pos, size, v] of records(data)) {
    if (kind === 84 && size >= 76) { const t = recordText(data, v, pos, size); if (t !== null) out.push(t); }
  }
  return out;
}

/**
 * The peak positions printed on a spectrum picture (EMF): Mnova and most NMR programs write them
 * above the peaks, turned by 90°, a character at a time. Characters standing one above the other
 * form one label ("39.52"), read upwards (or downwards for text turned the other way).
 */
export function emfPeaks(data: Uint8Array): number[] {
  const fonts = new Map<number, [number, number]>();
  let current: [number, number] = [0, 10];
  const chars: [number, number, number, string][] = [];
  for (const [kind, pos, size, v] of records(data)) {
    if (kind === 82 && size >= 32) {                 // EMR_EXTCREATEFONTINDIRECTW
      const handle = v.getUint32(pos + 8, true), height = v.getInt32(pos + 12, true), escapement = v.getInt32(pos + 20, true);
      fonts.set(handle, [escapement, Math.abs(height) || 10]);
    } else if (kind === 37 && size >= 12) {          // EMR_SELECTOBJECT
      const f = fonts.get(v.getUint32(pos + 8, true));
      if (f) current = f;
    } else if (kind === 84 && size >= 76 && (current[0] === 900 || current[0] === 2700)) {   // EMR_EXTTEXTOUTW
      const t = recordText(data, v, pos, size);
      if (t !== null) chars.push([v.getInt32(pos + 36, true), v.getInt32(pos + 40, true), current[0], t]);
    }
  }
  if (!chars.length) return [];
  const height = fonts.size ? Math.max(...[...fonts.values()].map((f) => f[1])) : 10;
  chars.sort((a, b) => a[0] - b[0]);
  const columns: (typeof chars)[] = [];
  for (const c of chars) {
    const last = columns[columns.length - 1];
    if (last && Math.abs(c[0] - last[last.length - 1][0]) <= height * 0.4) last.push(c);
    else columns.push([c]);
  }
  const out: number[] = [];
  for (const col of columns) {
    const upward = col[0][2] === 900;
    const text = [...col].sort((a, b) => (upward ? b[1] - a[1] : a[1] - b[1])).map((c) => c[3]).join('');
    const m = /^\s*(-?\d{1,3}\.\d{1,3})/.exec(text.replace(/−/g, '-'));
    if (m) out.push(Number(m[1]));
  }
  return out;
}

/**
 * How well a spectrum's peaks fit a peak report (0–1): mostly the share of the report's peaks
 * found in the spectrum (a range "7.38 – 7.29" counts if any peak is in it), a little the share
 * of the spectrum's peaks the report explains.
 */
export function matchScore(peaks: number[], report: string, kind: string): number {
  const reported = reportPeaks(report);
  if (peaks.length < 3 || !reported.length) return 0;
  const tol = kind === '13C' ? 0.06 : kind === '19F' ? 0.15 : 0.02;
  const spans = reported.map((p) => {
    const [lo, hi] = p.end !== null ? [p.shift, p.end] : [p.shift, p.shift];
    return [Math.min(lo, hi) - tol, Math.max(lo, hi) + tol] as const;
  });
  const found = spans.filter(([lo, hi]) => peaks.some((x) => lo <= x && x <= hi)).length;
  const explained = peaks.filter((x) => spans.some(([lo, hi]) => lo <= x && x <= hi)).length;
  return 0.75 * found / spans.length + 0.25 * explained / peaks.length;
}

const reportsOf = (c: ImportedCompound | undefined, kind: string): string[] =>
  ((c?.values.nmr ?? []) as { nucleus?: string; text?: string }[]).filter((r) => r.nucleus === kind).map((r) => r.text ?? '');

/** [the compound whose report of this nucleus the peaks fit clearly best, its score]; ['', 0] when none fits well or two fit about as well. */
export function bestByPeaks(peaks: number[], kind: string, compounds: ImportedCompound[]): [string, number] {
  const scored: [number, string][] = [];
  for (const c of compounds) {
    const reports = reportsOf(c, kind);
    if (reports.length) scored.push([Math.max(...reports.map((t) => matchScore(peaks, t, kind))), c.cid]);
  }
  scored.sort((a, b) => b[0] - a[0] || (a[1] < b[1] ? 1 : a[1] > b[1] ? -1 : 0));
  if (!scored.length || scored[0][0] < 0.6) return ['', 0];
  if (scored.length > 1 && scored[0][0] - scored[1][0] < 0.1) return ['', 0];
  return [scored[0][1], scored[0][0]];
}

function axisNumbers(texts: string[]): number[] {
  const out: number[] = [];
  for (let t of texts) {
    t = t.trim().replace(/−/g, '-');
    if (/^-?\d{1,3}(?:\.\d{1,2})?$/.test(t)) out.push(Number(t));
  }
  return out;
}

const AXIS_WORDS = new Set(['ppm', 'f1 (ppm)', 'δ (ppm)', 'min', 'time (min)']);

/** Whether a picture (EMF) is a spectrum: it has an axis (in ppm, or several numbers in a row along it, as a chromatogram's minutes). */
export function isSpectrumPicture(data: Uint8Array): boolean {
  const texts = emfTexts(data);
  if (texts.some((t) => AXIS_WORDS.has(t.trim().toLowerCase()))) return true;
  return axisNumbers(texts).length >= 5;
}

/** [type, title] of a MestReNova picture: a title naming the nucleus, else its axis. */
export function typeOfEmf(data: Uint8Array): [string, string] {
  const texts = emfTexts(data);
  for (const t of texts) {
    const found = typeFromText(t);
    if (found) return [found, t.trim()];
  }
  const found = typeFromText(texts.join(' '));
  if (found) return [found, ''];
  // the axis: the tick labels are the numbers printed before "ppm"
  const at = texts.indexOf('ppm');
  return [typeFromAxis(axisNumbers(at >= 0 ? texts.slice(0, at) : texts)) || 'Other NMR', ''];
}

// ---------------------------------------------------------------------- Word

/** What tells two structures apart: the InChIKey (also its first block, for a stereo-less drawing), else its pieces' SMILES. */
function structureKeys(f: MolFacts | null): string[] {
  if (!f) return [];
  if (f.inchikey) return [f.inchikey, f.inchikey.slice(0, 14)];
  const smiles = f.pieces.map((p) => p.smiles).sort().join('.');
  return smiles ? [smiles] : [];
}

/** The MestReNova spectra of a Word SI (the plan's objects), each with its compound if it could be told. */
export async function wordSpectra(plan: ImportPlan, tools: StructureTools): Promise<ImportedSpectrum[]> {
  const objects = plan.objects;
  const known = new Set(plan.compounds.map((c) => c.cid));
  const owner = new Map<DocObject, string>();
  plan.compounds.forEach((c, k) => { for (const o of plan.own_objects[k] ?? []) owner.set(o, c.cid); });
  const withStructure = plan.compounds.filter((c) => c.structure);
  const compoundFacts = withStructure.length ? await tools.facts(withStructure.map((c) => c.structure)) : [];
  const byStructure = new Map<string, Set<string>>();
  withStructure.forEach((c, i) => { for (const k of structureKeys(compoundFacts[i] ?? null)) { if (!byStructure.has(k)) byStructure.set(k, new Set()); byStructure.get(k)!.add(c.cid); } });
  const headers = pairedHeaders(objects, known);
  const groups = new Map<number | DocObject, DocObject[]>();
  for (const o of objects) {
    const key = o.group ?? o;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(o);
  }
  const out: ImportedSpectrum[] = [];
  let number = 0;
  for (const members of groups.values()) {
    number++;
    // (an Mnova page can hold just a molecule: without an axis it is no spectrum)
    const spectra = members.filter((o) => o.kind === 'mnova' && o.picture && isSpectrumPicture(o.picture));
    if (!spectra.length) continue;
    let cid = '', how = '';
    const labels = new Set<string>();
    const mols: string[] = [];
    for (const d of members) {
      if (d.kind !== 'chemdraw' || !d.cdx) continue;
      let cdxml: string;
      try { cdxml = cdxToCdxml(d.cdx); } catch { continue; }
      for (const l of drawingLabels(cdxml)) if (known.has(l)) labels.add(l);
      for (const s of drawingStructures(cdxml, tools)) if (s.atoms > 1) mols.push(s.molblock);
    }
    const drawnKeys = new Set<string>();
    if (mols.length) (await tools.facts(mols)).forEach((f) => { for (const k of structureKeys(f ?? null)) drawnKeys.add(k); });
    const types = spectra.map((o) => typeOfEmf(o.picture!)[0]);
    const unambiguous = types.length === new Set(types).size;       // (at most one spectrum per nucleus)
    const labelled = labels.size === 1 && unambiguous;
    if (labelled) {
      [cid, how] = [[...labels][0], 'by the ID under the structure next to it'];
    } else {
      const matches = new Set<string>();
      for (const k of drawnKeys) for (const c of byStructure.get(k) ?? []) matches.add(c);
      if (matches.size === 1) [cid, how] = [[...matches][0], 'by the structure drawn next to it'];
      else {
        const owners = new Set(members.filter((o) => owner.has(o)).map((o) => owner.get(o)!));
        if (owners.size === 1) [cid, how] = [[...owners][0], 'it is in the compound’s text'];
      }
    }
    for (const o of spectra) {
      let [kind, title] = typeOfEmf(o.picture!);
      // The peaks decide when they clearly fit one compound's report; the drawing next to it
      // only when they can't tell (no peaks printed, no such report).
      const peaks = emfPeaks(o.picture!);
      const [byPeaks, score] = bestByPeaks(peaks, kind, plan.compounds);
      let head = headers.get(o) ?? null;
      if (head && !head.sameGroup && cid && labelled && head.cid !== cid) head = null;   // (the ID in its own group beats a neighbor's header)
      if (head && !title) title = head.title;
      let ownCid: string, ownHow: string;
      if (byPeaks) {
        ownCid = byPeaks;
        ownHow = `its peaks fit the ${kind} NMR report of ${byPeaks} (${Math.round(score * 100)}%)`;
        if (head && head.cid !== byPeaks) ownHow += `; the header next to it says ${head.cid}: check it`;
      } else if (head) {
        [ownCid, ownHow] = [head.cid, `by the header next to it (${head.cid})`];
      } else {
        [ownCid, ownHow] = [cid, how];
        // A drawing next to it is weaker evidence than peaks: not when its compound has a
        // report of this nucleus that the peaks don't fit.
        const reports = reportsOf(plan.compounds.find((c) => c.cid === cid), kind);
        if (cid && peaks.length >= 3 && reports.length && Math.max(...reports.map((t) => matchScore(peaks, t, kind))) < 0.5) [ownCid, ownHow] = ['', ''];
      }
      if (!kind) kind = 'Other NMR';
      out.push(newSpectrum('emf', o.picture!, kind, { cid: ownCid, where: `spectrum group ${number}`, title, how: ownHow }));
    }
  }
  settle(out);
  return out;
}

interface Header { cid: string; type: string; title: string; sameGroup: boolean }

/**
 * {spectrum object: its header} from the header pictures next to the spectra: a picture that is
 * no spectrum but writes a compound's ID (and usually a title, "¹H NMR (CDCl3, 500 MHz)"), e.g.
 * an Mnova page holding the structure, the ID and the title above the spectrum. Each header goes
 * to the nearest spectrum of its type within three objects of it (in the same group first), each
 * spectrum to one header.
 */
function pairedHeaders(objects: DocObject[], known: Set<string>): Map<DocObject, Header> {
  const spectraAt: number[] = [];
  const heads: [number, string, string, string][] = [];
  objects.forEach((o, i) => {
    if ((o.kind !== 'mnova' && o.kind !== 'other') || !o.picture) return;
    if (isSpectrumPicture(o.picture)) { spectraAt.push(i); return; }
    const raw = emfTexts(o.picture);
    const texts = raw.map((t) => t.trim());
    const ids = texts.filter((t) => known.has(t));
    if (new Set(ids).size !== 1) return;
    heads.push([i, ids[0], typeFromText(texts.join(' ').replace(/(\d)\s+([A-Z])/g, '$1$2')), titleOf(raw)]);
  });
  const pairs: [boolean, number, number, number, string, string, string][] = [];
  for (const [hi, cid, kind, title] of heads) {
    for (const si of spectraAt) {
      if (Math.abs(si - hi) > 3) continue;
      const skind = typeOfEmf(objects[si].picture!)[0];
      if (kind && skind && kind !== skind) continue;
      pairs.push([objects[si].group !== objects[hi].group, Math.abs(si - hi), hi, si, cid, kind, title]);
    }
  }
  pairs.sort((a, b) => Number(a[0]) - Number(b[0]) || a[1] - b[1] || a[2] - b[2] || a[3] - b[3]);
  const out = new Map<DocObject, Header>();
  const usedH = new Set<number>(), usedS = new Set<number>();
  for (const [otherGroup, , hi, si, cid, kind, title] of pairs) {
    if (usedH.has(hi) || usedS.has(si)) continue;
    usedH.add(hi);
    usedS.add(si);
    out.set(objects[si], { cid, type: kind, title, sameGroup: !otherGroup });
  }
  return out;
}

/** "1H NMR (CDCl3, 500 MHz)" from a header's pieces of text (as drawn: their own spaces kept). */
function titleOf(texts: string[]): string {
  const m = /\d{1,3}\s*[A-Z][a-z]?(?:\{[^}]*\})?\s*NMR\s*\([^)]*\)/.exec(texts.join(''));
  return m ? m[0].replace(/\s+/g, ' ').trim() : '';
}

/**
 * A compound that has a spectrum matched by its peaks for a nucleus doesn't also get one of that
 * nucleus by a drawing next to it only (that one is someone else's). Two matched by their peaks
 * are both kept, with a note (the SI may hold it twice).
 */
function settle(spectra: ImportedSpectrum[]): void {
  const byPeaks = new Set(spectra.filter((s) => s.cid && (s.how ?? '').startsWith('its peaks')).map((s) => `${s.cid}\n${s.type}`));
  for (const s of spectra) if (s.cid && !(s.how ?? '').startsWith('its peaks') && byPeaks.has(`${s.cid}\n${s.type}`)) { s.cid = ''; s.how = ''; }
  const count = new Map<string, number>();
  for (const s of spectra) if (s.cid) count.set(`${s.cid}\n${s.type}`, (count.get(`${s.cid}\n${s.type}`) ?? 0) + 1);
  for (const s of spectra) {
    const n = s.cid ? count.get(`${s.cid}\n${s.type}`)! : 0;
    if (n > 1) s.how += ` (${s.cid} has ${n} ${s.type} spectra: untick the ones you don't want)`;
  }
}

// ---------------------------------------------------------------------- PDF

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A stereo prefix (STEREO, not optional here). */
const STEREO_PREFIX = STEREO.replace(/\?$/, '');

/** The first compound ID in a header ("2a — 1H NMR…", "1H NMR of 2", "9a13C NMR"). */
export function findId(text: string, ids: string[]): string {
  let best: [number, string] | null = null;
  for (const cid of ids) {
    if (!cid) continue;
    // (the ID on its own, or after its stereo prefix: "(±)-3", "(S)-2a", "rac-5", which is not part of the ID)
    const re = new RegExp(`(?:(?<![\\w-])|(?<=(?<![\\w-])${STEREO_PREFIX}))${escapeRe(cid)}(?=$|[^\\w-]|\\d{1,3}[A-Z])`, 'g');
    for (const m of text.matchAll(re)) {
      const end = m.index + m[0].length;
      // not the nucleus itself ("1H", "13C": an ID "1" or "13" must not match there)
      if (/^[A-Z][a-z]?\b/.test(text.slice(end)) && /^\d+$/.test(cid)) continue;
      if (!best || m.index < best[0] || (m.index === best[0] && cid.length > best[1].length)) best = [m.index, cid];
    }
  }
  return best ? best[1] : '';
}

/** The spectra on a PDF SI's spectrum pages: each page cut at its headers (one picture per spectrum, trimmed to its ink), with the compound the header names. */
export async function pdfSpectra(pdf: PdfPages, plan: ImportPlan, pages: number[], progress?: (done: number, total: number) => boolean | void): Promise<ImportedSpectrum[]> {
  const ids = plan.compounds.map((c) => c.cid).sort((a, b) => b.length - a.length);
  const out: ImportedSpectrum[] = [];
  for (let k = 0; k < pages.length; k++) {
    const n = pages[k];
    if (progress?.(k, pages.length) === false) return out;      // (stopped)
    let spans, size;
    try { spans = await pdf.spans(n); size = await pdf.size(n); } catch { continue; }
    const [width, height] = size;
    const lines = toLines(spans);
    const headers = lines.filter((L) => { const t = linePlain(L); return HEADER.test(t) && t.length < 160; });
    const pageIds = new Set(lines.map((L) => linePlain(L)).filter((t) => /^[\w′'\-\s()±+−,]{1,40}$/.test(t)).map((t) => findId(t, ids)).filter(Boolean));
    const left = spans.length ? Math.min(...spans.map((s) => s.x0)) : 36;
    const right = spans.length ? Math.max(...spans.map((s) => s.x1)) : 576;
    const bottomText = lines.filter((L) => L.base > 0.9 * height);    // (page numbers, footers)
    const pageBottom = bottomText.length ? Math.min(...bottomText.map((L) => L.base - L.size)) : height - 20;
    const heads = headers.length ? headers : [null];
    for (let h = 0; h < heads.length; h++) {
      const head = heads[h];
      const title = head ? linePlain(head).replace(/\s*([—–])\s*/g, ' $1 ') : '';   // ("2a — ¹H NMR": a superscript's space is easily lost)
      const top = head ? head.base + 0.3 * head.size : 20;
      const next = heads[h + 1];
      const end = next ? next.base - next.size - 2 : pageBottom - 2;
      if (end - top < 60) continue;
      let cut = null;
      try { cut = await pdf.cut(n, [Math.max(0, left - 6), top, Math.min(width, right + 6), end]); } catch { cut = null; }
      if (!cut) continue;
      let cid = title ? findId(title, ids) : '';
      let how = cid ? 'by the ID in its header' : '';
      if (!cid && pageIds.size === 1) [cid, how] = [[...pageIds][0], 'by the compound label on its page'];
      out.push(newSpectrum('pdf', cut.data, typeFromText(title) || 'Other NMR', { cid, where: `page ${n}`, title, how, shows_structure: true, ext: cut.ext }));
    }
  }
  progress?.(pages.length, pages.length);
  return out;
}
