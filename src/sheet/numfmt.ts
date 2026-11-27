// Number formats, written as Excel writes them ("0.00", "0.0%", "0.00E+00", "#,##0", "@"), so
// a sheet saved as .xlsx keeps them exactly. This turns a value and a format into the text a
// cell shows, and changes formats for the ribbon's buttons (more or fewer decimal places).

import { CellError, Value, isError } from './values';
import { roundTo } from './evaluate';
import { unitOfFormat } from './units';
import { serialParts } from './dates';

export interface Shown {
  text: string;
  /** A colour the format asks for ([Red]). */
  color?: string;
  /** Where the text sits when the cell doesn't say: numbers right, text left, TRUE/FALSE and errors centred. */
  align: 'left' | 'right' | 'center';
}

const COLORS: Record<string, string> = {
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#00a000', blue: '#0000ff', yellow: '#c0a000', magenta: '#ff00ff', cyan: '#00a0a0',
};

/** Excel's General format: up to about 11 characters, switching to powers of ten for very large or small numbers. */
export function generalNumber(n: number): string {
  if (!Number.isFinite(n)) return '#NUM!';
  if (n === 0) return '0';
  const abs = Math.abs(n);
  if (abs >= 1e11 || abs < 1e-6) {
    const [m, e] = n.toExponential(5).split('e');
    const mant = m.replace(/\.?0+$/, '');
    const exp = Number(e);
    return `${mant}E${exp < 0 ? '-' : '+'}${String(Math.abs(exp)).padStart(2, '0')}`;
  }
  // as many decimals as fit in about 11 characters
  const intDigits = Math.max(1, Math.floor(Math.log10(abs)) + 1);
  const dec = Math.max(0, 10 - intDigits);
  const r = roundTo(n, dec);
  let s = r.toFixed(dec);
  if (s.includes('.')) s = s.replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
}

/**
 * A number in the General format, shortened to fit its column as Excel does: fewer decimals
 * first, then a power of ten. Null when even that doesn't fit (the cell then shows ###).
 */
export function generalFitting(n: number, fits: (text: string) => boolean): string | null {
  const full = generalNumber(n);
  if (fits(full)) return full;
  if (!Number.isFinite(n)) return null;
  const abs = Math.abs(n);
  // a small number rounded to one significant figure, kept in case a power of ten doesn't fit either
  let coarse: string | null = null;
  if (abs >= 1e-6 && abs < 1e11) {
    const intDigits = Math.max(1, Math.floor(Math.log10(abs)) + 1);
    for (let dec = Math.max(0, 10 - intDigits) - 1; dec >= 0; dec--) {
      let t = roundTo(n, dec).toFixed(dec);
      if (t.includes('.')) t = t.replace(/\.?0+$/, '');
      // rounded away to nothing: a power of ten says more
      if (/^-?0$/.test(t)) break;
      if (!fits(t)) continue;
      if (abs < 0.1 && t.replace(/^-?[0.]+/, '').replace('.', '').length < 2 && Number(t) !== n) { coarse = t; break; }
      return t;
    }
  }
  for (let d = 5; d >= 0; d--) {
    const [m, e] = n.toExponential(d).split('e');
    const exp = Number(e);
    const t = `${m.replace(/\.?0+$/, '')}E${exp < 0 ? '-' : '+'}${String(Math.abs(exp)).padStart(2, '0')}`;
    if (fits(t)) return t;
  }
  return coarse;
}

interface Section {
  /** Literal text and placeholders, in order. */
  parts: Part[];
  color?: string;
  condition?: { op: string; value: number };
}

/** `gen`: the word General inside a longer format (General" mg", [Red]General), the number shown as General shows it. */
type Part = { k: 'lit'; s: string } | { k: 'code'; s: string } | { k: 'gen'; s: string };

/** Split a format into its sections (positive; negative; zero; text) and each into literal and code parts. */
function parseSections(code: string): Section[] {
  const sections: Section[] = [];
  let cur: Section = { parts: [] };
  const pushLit = (s: string) => {
    const last = cur.parts[cur.parts.length - 1];
    if (last?.k === 'lit') last.s += s;
    else cur.parts.push({ k: 'lit', s });
  };
  const pushCode = (s: string) => {
    const last = cur.parts[cur.parts.length - 1];
    if (last?.k === 'code') last.s += s;
    else cur.parts.push({ k: 'code', s });
  };
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (ch === ';') { sections.push(cur); cur = { parts: [] }; continue; }
    if (ch === '"') {
      const j = code.indexOf('"', i + 1);
      pushLit(code.slice(i + 1, j < 0 ? code.length : j));
      i = j < 0 ? code.length : j;
      continue;
    }
    if (ch === '\\') { pushLit(code[i + 1] ?? ''); i++; continue; }
    if (ch === '_') { pushLit(' '); i++; continue; } // space the width of the next character
    if (ch === '*') { i++; continue; } // repeat to fill the cell: left out
    if (ch === '[') {
      const j = code.indexOf(']', i);
      const inner = code.slice(i + 1, j < 0 ? code.length : j);
      i = j < 0 ? code.length : j;
      const c = COLORS[inner.toLowerCase()];
      if (c) cur.color = c;
      const cond = /^(<=|>=|<>|<|>|=)\s*(-?[\d.]+)$/.exec(inner);
      if (cond) cur.condition = { op: cond[1], value: Number(cond[2]) };
      const cur$ = /^\$([^-\]]*)/.exec(inner);
      if (cur$) pushLit(cur$[1]);
      if (/^(h+|m+|s+)$/i.test(inner)) pushCode(`[${inner}]`); // elapsed time
      continue;
    }
    // the word General (any case) in a longer format: the number as General shows it, the text round it kept
    if ((ch === 'G' || ch === 'g') && code.slice(i, i + 7).toLowerCase() === 'general') { cur.parts.push({ k: 'gen', s: 'General' }); i += 6; continue; }
    // a fraction's fixed denominator (# ?/16): its digits right after the /
    if (/[1-9]/.test(ch) && /[0#?]\/\d*$/.test(lastCode(cur)) && !isDateCode(lastCode(cur)) && cur.parts[cur.parts.length - 1]?.k === 'code') { pushCode(ch); continue; }
    if ('0#?.,%Ee+-@'.includes(ch) || /[ymdhsAP/:]/i.test(ch)) {
      // E+ / E- belong to the number; on their own + and - are text
      if ((ch === '+' || ch === '-') && !/[Ee]$/.test(lastCode(cur))) { pushLit(ch); continue; }
      if (ch === '/' || ch === ':') {
        if (isDateCode(lastCode(cur)) || /[hms]/i.test(code.slice(i + 1, i + 2))) { pushCode(ch); continue; }
        // (a fraction's: between its numerator's and denominator's digits)
        if (ch === '/' && /[0#?]\s*$/.test(code.slice(0, i)) && /^\s*[0-9#?]/.test(code.slice(i + 1))) { pushCode(ch); continue; }
        pushLit(ch);
        continue;
      }
      if ((ch === 'A' || ch === 'a') && /^AM\/PM/i.test(code.slice(i))) { pushCode('AM/PM'); i += 4; continue; }
      if ((ch === 'A' || ch === 'a') && /^A\/P/i.test(code.slice(i))) { pushCode('A/P'); i += 2; continue; }
      if (/[AaPp]/.test(ch)) { pushLit(ch); continue; }
      pushCode(ch);
      continue;
    }
    pushLit(ch);
  }
  sections.push(cur);
  return sections;
}

const lastCode = (s: Section): string => {
  for (let i = s.parts.length - 1; i >= 0; i--) if (s.parts[i].k === 'code') return s.parts[i].s;
  return '';
};

const isDateCode = (s: string): boolean => /[ymdhs]/i.test(s.replace(/E[+-]/gi, ''));

function sectionIsDate(sec: Section): boolean {
  // (the tenths and hundredths after seconds, mm:ss.0, are the time's own)
  return sec.parts.some((p) => p.k === 'code' && isDateCode(p.s) && !/[0#?]/.test(p.s.replace(/(s+\]?)\.0+/gi, '$1')));
}

/**
 * A fraction in a section (# ?/?, # ??/16, ?/?, 0 0/0): which code part is the fraction (its
 * numerator's and denominator's codes; a denominator of digits 1-9 first is a fixed one) and which
 * is the whole number's, if any; null when the section isn't one.
 */
interface Fraction { at: number; whole: number; num: string; den: string }
function fractionAt(sec: Section): Fraction | null {
  const at = sec.parts.findIndex((p) => p.k === 'code' && p.s.includes('/'));
  if (at < 0) return null;
  const m = /^([0#?]+)\/([0#?]+|[1-9]\d*)$/.exec(sec.parts[at].s);
  if (!m) return null;
  let whole = -1;
  for (let i = 0; i < sec.parts.length; i++) {
    const p = sec.parts[i];
    if (p.k !== 'code' || i === at) continue;
    // (a whole number before it, of digits and thousands commas only; nothing else that is a number)
    if (i < at && whole < 0 && /^[0#?,]+$/.test(p.s)) { whole = i; continue; }
    if (/[0#?.%Ee]/.test(p.s)) return null;
  }
  return { at, whole, num: m[1], den: m[2] };
}

/** The fraction nearest x (0 ≤ x) with a denominator under `limit`. */
function nearestFraction(x: number, limit: number): [number, number] {
  let best: [number, number] = [Math.round(x), 1], err = Math.abs(x - Math.round(x));
  for (let d = 2; d < limit && err > 0; d++) {
    const n = Math.round(x * d), e = Math.abs(x - n / d);
    if (e < err - 1e-12) { best = [n, d]; err = e; }
  }
  return best;
}

/**
 * A number as a fraction, as Excel shows it: the whole number in its own codes, then the fraction
 * (its room left blank for ? where there is none), the section's text round them in place. `signed`:
 * the section is a negative number's own (its text gives the sign), so no minus is added.
 */
function formatFraction(v: number, sec: Section, f: Fraction, signed: boolean): string {
  const a = Math.abs(v);
  const hasWhole = f.whole >= 0;
  let whole = hasWhole ? Math.trunc(a) : 0;
  const x = hasWhole ? a - whole : a;
  const fixed = /^[1-9]\d*$/.test(f.den);
  let n: number, d: number;
  if (fixed) { d = Number(f.den); n = Math.round(x * d); } else [n, d] = nearestFraction(x, Math.pow(10, f.den.length));
  if (hasWhole && n === d) { whole += 1; n = 0; }
  const zero = whole === 0 && n === 0;
  const pad = (t: string, code: string, end: 'start' | 'end') => {
    if (t.length >= code.length) return t;
    const fill = code.includes('0') ? '0' : code.includes('?') ? ' ' : '';
    return end === 'start' ? t.padStart(code.length, fill) : t.padEnd(code.length, fill);
  };
  const wholeNumber = hasWhole ? formatNumber(whole, { parts: [{ k: 'code', s: (sec.parts[f.whole] as { s: string }).s }] }) : '';
  const wholeText = hasWhole ? (zero ? wholeNumber || '0' : wholeNumber) : '';
  const fracText = hasWhole && n === 0
    ? (f.num.includes('0') ? `${pad('0', f.num, 'start')}/${fixed ? f.den : pad('1', f.den, f.den.includes('0') ? 'start' : 'end')}` : f.num.includes('?') ? ' '.repeat(f.num.length + 1 + f.den.length) : '')
    // (a denominator's 0s pad it in front, its ?s with spaces after)
    : `${pad(String(n), f.num, 'start')}/${fixed ? f.den : pad(String(d), f.den, f.den.includes('0') ? 'start' : 'end')}`;
  const out = sec.parts.map((p, i) => (p.k === 'lit' ? p.s : i === f.at ? fracText : i === f.whole ? wholeText : p.s.replace(/[0#?,]/g, ''))).join('');
  return (v < 0 && !signed && !zero ? '-' : '') + out;
}

/**
 * What a format shows a number as: a date (perhaps with a time), a time of day, an elapsed time
 * ([h]:mm), or none of these (null). Judged by its first section, the one for positive numbers.
 */
export function dateKind(code: string | undefined): 'date' | 'time' | 'elapsed' | null {
  if (!code || /^general$/i.test(code)) return null;
  const sec = parseSections(code)[0];
  if (!sec || !sectionIsDate(sec)) return null;
  const codes = sec.parts.filter((p) => p.k === 'code').map((p) => p.s).join('');
  const plain = codes.replace(/\[[^\]]*\]/g, '').replace(/AM\/PM|A\/P/gi, '');
  // m is a month unless hours or seconds are about (h:mm, mm:ss)
  if (/[yd]/i.test(plain) || (/m/i.test(plain) && !/[hs]/i.test(codes))) return 'date';
  return /\[[hms]+\]/i.test(codes) ? 'elapsed' : 'time';
}

/**
 * Days from Excel's count starting in 1900 to its count starting in 1904: a workbook counting from
 * 1904 (workbookPr date1904, the old Mac default; ECMA-376 Part 1, 18.17.4.1) holds each date this
 * much lower.
 */
export const DAYS_1900_TO_1904 = 1462;

/**
 * Is a number (by the 1900 count) in a cell of this format a date, which a workbook counting from
 * 1904 holds 1462 lower? A time of day (under one day) and an elapsed time ([h]:mm) are not.
 */
export function holdsDate(code: string | undefined, v: number): boolean {
  const k = dateKind(code);
  return k === 'date' || (k === 'time' && v >= DAYS_1900_TO_1904 + 1);
}

/** Show a value in a format. Undefined or "General" shows it as Excel's General does. */
export function formatValue(v: Value, code?: string): Shown {
  if (v === null) return { text: '', align: 'left' };
  if (isError(v)) return { text: (v as CellError).code === '#BUSY!' ? '…' : (v as CellError).code, align: 'center' };
  if (typeof v === 'boolean') return { text: v ? 'TRUE' : 'FALSE', align: 'center' };
  const fmt = code && code.toLowerCase() !== 'general' ? code : '';
  if (typeof v === 'string') {
    if (!fmt) return { text: v, align: 'left' };
    const secs = parseSections(fmt);
    const textSec = secs.length >= 4 ? secs[3] : secs.find((s) => s.parts.some((p) => p.k === 'code' && p.s.includes('@')));
    if (!textSec) return { text: v, align: 'left' };
    const text = textSec.parts.map((p) => (p.k === 'lit' ? p.s : p.k === 'gen' ? v : p.s.replace(/@/g, v))).join('');
    return { text, color: textSec.color, align: 'left' };
  }
  if (!fmt) return { text: generalNumber(v), align: 'right' };
  if (fmt === '@') return { text: generalNumber(v), align: 'left' };
  const secs = parseSections(fmt);
  let sec: Section;
  let abs = false;
  // a section left empty shows nothing ("0;;" hides negative numbers and zeros, ";;;" everything)
  if (secs.some((s) => s.condition)) {
    sec = secs.find((s) => s.condition && test(v, s.condition)) ?? secs.find((s) => !s.condition) ?? secs[0];
  } else if (v < 0 && secs.length >= 2) { sec = secs[1]; abs = true; }
  else if (v === 0 && secs.length >= 3) sec = secs[2];
  else sec = secs[0];
  if (sec.parts.some((p) => p.k === 'gen')) {
    const n = generalNumber(abs ? Math.abs(v) : v);
    const text = sec.parts.map((p) => (p.k === 'lit' ? p.s : p.k === 'gen' ? n : p.s.replace(/[0#?.,]/g, ''))).join('');
    return { text, color: sec.color, align: 'right' };
  }
  if (sectionIsDate(sec)) return { text: formatDate(v, sec), color: sec.color, align: 'right' };
  const frac = fractionAt(sec);
  if (frac) return { text: formatFraction(abs ? Math.abs(v) : v, sec, frac, abs), color: sec.color, align: 'right' };
  const text = formatNumber(abs ? Math.abs(v) : v, sec);
  return { text, color: sec.color, align: 'right' };
}

function test(v: number, c: { op: string; value: number }): boolean {
  switch (c.op) {
    case '<': return v < c.value;
    case '<=': return v <= c.value;
    case '>': return v > c.value;
    case '>=': return v >= c.value;
    case '=': return v === c.value;
    default: return v !== c.value;
  }
}

/** A number in one section of a format: placeholders 0 # ?, decimal point, thousands commas, % and E+00. */
function formatNumber(v: number, sec: Section): string {
  const code = sec.parts.filter((p) => p.k === 'code').map((p) => p.s).join('');
  if (!/[0#?]/.test(code)) {
    // only text: the number isn't shown (as in a "-" for zero)
    return (v < 0 ? '-' : '') + sec.parts.map((p) => (p.k === 'lit' ? p.s : p.s.replace(/[^@]/g, ''))).join('');
  }
  const pct = (code.match(/%/g) ?? []).length;
  let x = Math.abs(v) * Math.pow(100, pct);
  const sci = /E([+-])([0#]+)/i.exec(code);
  const mant = sci ? code.slice(0, sci.index) : code;
  const dot = mant.indexOf('.');
  const intCode = (dot < 0 ? mant : mant.slice(0, dot)).replace(/[^0#?,]/g, '');
  const fracRaw = dot < 0 ? '' : mant.slice(dot + 1).replace(/[^0#?,]/g, '');
  const fracCode = fracRaw.replace(/,/g, '');
  const intMin = (intCode.match(/0/g) ?? []).length;
  const group = /[0#?],[0#?]/.test(intCode);
  // commas right after the number's last digit placeholder divide it by 1000 each, before or after the
  // point: 0,  0.0,,  #,##0.0,  0,.0 (ECMA-376 Part 1, 18.8.31: "a comma that follows a digit placeholder
  // scales the number by 1,000")
  const scale = (/(,+)$/.exec(intCode)?.[1].length ?? 0) + (/(,+)$/.exec(fracRaw)?.[1].length ?? 0);
  if (scale) x /= Math.pow(1000, scale);
  let exp = 0;
  if (sci) {
    if (x !== 0) {
      exp = Math.floor(Math.log10(x));
      const step = Math.max(1, (intCode.match(/[0#?]/g) ?? []).length);
      // engineering formats (##0.0E+0) keep the power a multiple of the digits before the point
      if (step > 1) exp = Math.floor(exp / step) * step;
      x /= Math.pow(10, exp);
      if (roundTo(x, fracCode.length) >= Math.pow(10, step)) { x /= Math.pow(10, step); exp += step; }
    }
  }
  const r = roundTo(x, fracCode.length);
  let [ip, fp = ''] = r.toFixed(fracCode.length).split('.');
  // optional decimals (#) drop trailing zeros; ? leaves a space instead
  if (fracCode) {
    const chars = fp.split('');
    for (let i = fracCode.length - 1; i >= 0; i--) {
      if (fracCode[i] === '0' || chars[i] !== '0') break;
      chars[i] = fracCode[i] === '?' ? ' ' : '';
    }
    fp = chars.join('');
  }
  if (ip === '0' && intMin === 0) ip = '';
  ip = ip.padStart(intMin, '0');
  if (group) ip = ip.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  // Excel keeps the point even when no decimals follow ("0.##" shows 5 as "5.")
  let num = ip + (dot >= 0 ? '.' + fp : '');
  if (sci) {
    const ed = sci[2].length;
    num += `E${exp < 0 ? '-' : sci[1] === '+' ? '+' : ''}${String(Math.abs(exp)).padStart(ed, '0')}`;
  }
  // the whole number's digits split over code parts with text between them (000-0000, 000-00-0000):
  // filled from the right, each part its own placeholders' worth, the first taking what is left
  const intCounts: number[] = [];
  let pastPoint = false;
  for (const p of sec.parts) {
    if (p.k !== 'code') { intCounts.push(0); continue; }
    let n = 0;
    for (const ch of p.s) {
      if (pastPoint) break;
      if (ch === '.' || ch === 'E' || ch === 'e') pastPoint = true;
      else if (ch === '0' || ch === '#' || ch === '?') n++;
    }
    intCounts.push(n);
  }
  if (intCounts.filter((n) => n > 0).length >= 2) {
    let digits = r.toFixed(fracCode.length).split('.')[0];
    if (digits === '0') digits = '';
    const rest = num.slice(ip.length);
    const pieces: string[] = sec.parts.map(() => '');
    const first = intCounts.findIndex((n) => n > 0);
    for (let i = sec.parts.length - 1; i >= 0; i--) {
      const n = intCounts[i];
      if (!n) continue;
      const take = i === first ? digits : digits.slice(Math.max(0, digits.length - n));
      digits = digits.slice(0, digits.length - take.length);
      // placeholders left without a digit: 0 shows a zero, ? a space, # nothing
      const holders = (sec.parts[i].s.split(/[.Ee]/)[0].match(/[0#?]/g) ?? []);
      const pad = holders.slice(0, Math.max(0, n - take.length)).map((h) => (h === '0' ? '0' : h === '?' ? ' ' : '')).join('');
      pieces[i] = pad + take;
    }
    // the point, decimals and power of ten go with the part that holds the point (else the last digits)
    let restAt = sec.parts.findIndex((p) => p.k === 'code' && /[.Ee]/.test(p.s));
    if (restAt < 0) for (let i = intCounts.length - 1; i >= 0; i--) if (intCounts[i] > 0) { restAt = i; break; }
    let out = '';
    sec.parts.forEach((p, i) => {
      if (p.k !== 'code') { out += p.s; return; }
      out += pieces[i] + (i === restAt ? rest : '');
      if (p.s.includes('%')) out += '%'.repeat((p.s.match(/%/g) ?? []).length);
      out += p.s.replace(/[0#?.,%Ee+-]/g, '');
    });
    const neg = v < 0 && roundTo(Math.abs(v) * Math.pow(100, pct), fracCode.length + (sci ? 10 : 0)) !== 0;
    return (neg ? '-' : '') + out;
  }
  // put the number where its code was, literals around it
  let out = '';
  let placed = false;
  for (const p of sec.parts) {
    if (p.k === 'lit') out += p.s;
    else {
      const extra = p.s.replace(/[0#?.,%Ee+-]/g, '');
      if (!placed) { out += num; placed = true; }
      if (p.s.includes('%')) out += '%'.repeat((p.s.match(/%/g) ?? []).length);
      out += extra;
    }
  }
  const negative = v < 0 && roundTo(Math.abs(v) * Math.pow(100, pct), fracCode.length + (sci ? 10 : 0)) !== 0;
  return (negative ? '-' : '') + out;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];


function formatDate(v: number, sec: Section): string {
  if (v < 0 || v >= 2958466) return '#'.repeat(10);
  // (rounded to the tenths, hundredths or thousandths of a second shown, else the millisecond, so they carry)
  const k = Math.max(0, ...sec.parts.filter((p) => p.k === 'code').map((p) => (/\.(0+)/.exec(p.s)?.[1].length ?? 0)));
  if (k) v = Math.round(v * 86400 * Math.pow(10, k)) / (86400 * Math.pow(10, k));
  const ms = Math.round(v * 86400000) % 1000;
  const secs = Math.round(v * 86400000) / 1000;
  const p = serialParts(Math.round(v * 86400000) / 86400000 - ms / 86400000);
  const Y = p.y, M = p.m - 1, D = p.d, wd = p.weekday;
  const h = Math.floor(p.secs / 3600), mi = Math.floor(p.secs / 60) % 60, s = p.secs % 60;
  const ampm = sec.parts.some((p) => p.k === 'code' && /AM\/PM|A\/P/i.test(p.s));
  let out = '';
  for (const p of sec.parts) {
    if (p.k === 'lit') { out += p.s; continue; }
    const toks = p.s.match(/AM\/PM|A\/P|\[[hms]+\]|y+|m+|d+|h+|s+|\.0+|[^ymdhs]/gi) ?? [];
    toks.forEach((t, i) => {
      const low = t.toLowerCase();
      // (an elapsed [h] or [s] beside m makes it minutes too: [h]:mm)
      // (the letters of the code part before and after, an elapsed part's opening bracket left off)
      const prev = toks.slice(0, i).reverse().find((x) => /^\[?[a-z]/i.test(x))?.toLowerCase().replace(/^\[/, '') ?? '';
      const next = toks.slice(i + 1).find((x) => /^\[?[a-z]/i.test(x))?.toLowerCase().replace(/^\[/, '') ?? '';
      if (/^y+$/.test(low)) out += low.length <= 2 ? String(Y % 100).padStart(2, '0') : String(Y);
      else if (/^m+$/.test(low)) {
        const minutes = prev.startsWith('h') || next.startsWith('s');
        if (minutes) out += low.length >= 2 ? String(mi).padStart(2, '0') : String(mi);
        else out += low.length === 1 ? String(M + 1) : low.length === 2 ? String(M + 1).padStart(2, '0') : low.length === 3 ? MONTHS[M].slice(0, 3) : low.length === 5 ? MONTHS[M][0] : MONTHS[M];
      } else if (/^d+$/.test(low)) out += low.length === 1 ? String(D) : low.length === 2 ? String(D).padStart(2, '0') : low.length === 3 ? DAYS[wd].slice(0, 3) : DAYS[wd];
      else if (/^h+$/.test(low)) { const hh = ampm ? ((h + 11) % 12) + 1 : h; out += low.length >= 2 ? String(hh).padStart(2, '0') : String(hh); }
      else if (/^s+$/.test(low)) out += low.length >= 2 ? String(s).padStart(2, '0') : String(s);
      else if (/^\[h+\]$/.test(low)) out += String(Math.floor(secs / 3600));
      else if (/^\[m+\]$/.test(low)) out += String(Math.floor(secs / 60));
      else if (/^\[s+\]$/.test(low)) out += String(Math.floor(secs));
      else if (low === 'am/pm') out += h < 12 ? (t[0] === 'a' ? 'am' : 'AM') : (t[0] === 'a' ? 'pm' : 'PM');
      else if (low === 'a/p') out += h < 12 ? 'A' : 'P';
      else if (/^\.0+$/.test(low)) out += (ms / 1000).toFixed(low.length - 1).slice(1);
      else out += t;
    });
  }
  return out;
}

// ---------------------------------------------------------------- changing formats

/** The formats behind the ribbon's buttons and list. */
export const FORMATS = {
  general: 'General',
  number: '0.00',
  percent: '0%',
  scientific: '0.00E+00',
  text: '@',
  thousands: '#,##0',
};

/** One more or one fewer decimal place, as Excel's buttons do. `shown` is the cell's text, used when the format is General. */
export function changeDecimals(code: string | undefined, delta: 1 | -1, shown = ''): string {
  let fmt = code && code.toLowerCase() !== 'general' ? code : '';
  if (!fmt) {
    // from General: start from the decimals the cell shows now
    const dec = /\.(\d+)/.exec(shown)?.[1].length ?? 0;
    const e = /E[+-]\d+$/.test(shown);
    const n = Math.max(0, dec + delta);
    return e ? `0${n ? '.' + '0'.repeat(n) : ''}E+00` : `0${n ? '.' + '0'.repeat(n) : ''}`;
  }
  // change each section's number the same way
  return fmt.split(';').map((sec) => {
    const parsed = parseSections(sec)[0];
    if (parsed && (sectionIsDate(parsed) || fractionAt(parsed))) return sec;
    // (quoted text, [$€-407] [>=100] [Red] codes, \-escaped characters and the one after _ or * aren't the number)
    const masked = sec.replace(/"[^"]*"|\[[^\]]*\]|\\.|[_*]./g, (q) => '\u0000'.repeat(q.length));
    const m = /([0#?](?:[0#?,]*))(\.([0#?]*))?/.exec(masked);
    if (!m) return sec;
    const start = m.index, end = start + m[0].length;
    const ip = m[1], fp = m[3] ?? '';
    const nf = delta > 0 ? fp + '0' : fp.slice(0, -1);
    return sec.slice(0, start) + ip + (nf ? '.' + nf : '') + sec.slice(end);
  }).join(';');
}

/** Decimal places a format shows (for the side panel). */
export function decimalsOf(code: string | undefined): number | null {
  if (!code || code.toLowerCase() === 'general') return null;
  const m = /[0#?]\.([0#?]+)/.exec(code.split(';')[0]);
  return m ? m[1].length : 0;
}

/** A short description of a format, for the side panel and the ribbon's list. */
export function describeFormat(code: string | undefined): string {
  if (!code || code.toLowerCase() === 'general') return 'General';
  if (code === '@') return 'Text';
  const first = code.split(';')[0];
  const d = decimalsOf(code) ?? 0;
  const dp = `${d} decimal place${d === 1 ? '' : 's'}`;
  const unit = unitOfFormat(code);
  if (unit) return `${unit.name} (${unit.unit}), ${dp}`;
  if (/E[+-]/i.test(first)) return `Scientific, ${dp}`;
  if (first.includes('%')) return `Percentage, ${dp}`;
  if (dateKind(code)) return 'Date or time';
  if (fractionAt(parseSections(first)[0] ?? { parts: [] })) return 'Fraction';
  if (/[0#],[0#]/.test(first)) return `Number with thousands commas, ${dp}`;
  return `Number, ${dp}`;
}
