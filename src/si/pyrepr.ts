// Fingerprints of warnings, worked out exactly as Chem SI Assistant works them out (SHA-1 of
// Python's repr() of the data, first 12 hex digits), so a warning dismissed there stays
// dismissed here, and the other way round.
//
// Python's repr is copied for what fingerprints hold: text, whole numbers and decimals, None,
// True/False, lists, tuples and dicts (in their order). A number read from a project file keeps
// whether it was written as a decimal (pyjson.ts); `pyF` marks one worked out here as a decimal.

import { sha } from '../sha';
import { isFloat, pyFloat } from './pyjson';

/** A decimal (Python float), even when it is whole: 400 → "400.0". */
export class PyFloat { constructor(readonly v: number) {} }
export const pyF = (v: number): PyFloat => new PyFloat(v);
/** A tuple (Python writes "(a,)" for one item). */
export class PyTuple { constructor(readonly items: unknown[]) {} }

// Python's str.isprintable(): not "Other" or "Separator" characters, but a plain space is
const UNPRINTABLE = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Zs}]/u;

/** A string as Python's repr writes it. */
export function pyStr(s: string): string {
  const q = s.includes("'") && !s.includes('"') ? '"' : "'";
  let out = q;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (ch === '\\') out += '\\\\';
    else if (ch === q) out += '\\' + q;
    else if (ch === '\t') out += '\\t';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch !== ' ' && UNPRINTABLE.test(ch)) {
      out += c < 0x100 ? '\\x' + c.toString(16).padStart(2, '0') : c < 0x10000 ? '\\u' + c.toString(16).padStart(4, '0') : '\\U' + c.toString(16).padStart(8, '0');
    } else out += ch;
  }
  return out + q;
}

function num(v: number, float: boolean): string {
  if (Number.isNaN(v)) return 'nan';
  if (!Number.isFinite(v)) return v > 0 ? 'inf' : '-inf';
  return float || !Number.isInteger(v) ? pyFloat(v) : String(v);
}

/** Python's repr of a value (`holder`/`key`: where it was read from, for decimals written as "5.0"). */
export function pyRepr(v: unknown, holder: object | null = null, key: string | number = ''): string {
  if (v === null || v === undefined) return 'None';
  if (v === true) return 'True';
  if (v === false) return 'False';
  if (v instanceof PyFloat) return num(v.v, true);
  if (typeof v === 'number') return num(v, !!holder && isFloat(holder, key));
  if (typeof v === 'string') return pyStr(v);
  if (v instanceof PyTuple) {
    const parts = v.items.map((x) => pyRepr(x));
    return parts.length === 1 ? `(${parts[0]},)` : `(${parts.join(', ')})`;
  }
  if (Array.isArray(v)) return `[${v.map((x, i) => pyRepr(x, v, i)).join(', ')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).map((k) => `${pyStr(k)}: ${pyRepr(o[k], o, k)}`).join(', ')}}`;
}

/** checks._fp(*parts): the first 12 hex digits of the SHA-1 of repr(parts). */
export function fp(...parts: unknown[]): string {
  const bytes = sha('SHA-1', new TextEncoder().encode(pyRepr(new PyTuple(parts))));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 12);
}

/** checks._sorted_fp: sets (given as Set) sorted first; '' when a set mixes text and None (Python can't sort it). */
export function sortedFp(...parts: unknown[]): string {
  const out: unknown[] = [];
  for (const p of parts) {
    if (!(p instanceof Set)) { out.push(p); continue; }
    const items = [...p];
    if (items.some((x) => typeof x !== 'string') && items.some((x) => typeof x === 'string')) return '';
    out.push(items.sort((a, b) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0)));
  }
  return fp(...out);
}

/** Python's "%g" (format spec "g"): 6 significant digits, trailing zeros dropped. */
export function pyG(x: number): string {
  if (!Number.isFinite(x)) return Number.isNaN(x) ? 'nan' : x > 0 ? 'inf' : '-inf';
  if (x === 0) return Object.is(x, -0) ? '-0' : '0';
  const exp = Number(x.toExponential(5).split('e')[1]);
  if (exp < -4 || exp >= 6) {
    const [m, e] = x.toExponential(5).split('e');
    const mant = m.includes('.') ? m.replace(/0+$/, '').replace(/\.$/, '') : m;
    const n = Number(e);
    return `${mant}e${n < 0 ? '-' : '+'}${String(Math.abs(n)).padStart(2, '0')}`;
  }
  const s = x.toFixed(Math.max(0, 5 - exp));
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}

/** Python's "{:+.1f}". */
export const pySigned1 = (x: number): string => (x >= 0 && !Object.is(x, -0) ? '+' : '') + x.toFixed(1);
