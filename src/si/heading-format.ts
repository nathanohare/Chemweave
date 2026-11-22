// How the compiled SI numbers its headings (Project Settings ▸ Headings). SI Assistant keeps one
// choice, "heading_numbers": as the journal style does (not stored), "outline" (1, A, a, i),
// "decimal" (1, 1.1, 1.1.1) or "none". Chemweave offers many more, kept in its own key
// "heading_format" (which SI Assistant keeps without reading); "heading_numbers" is then set to
// the nearest of SI Assistant's, so the project still numbers sensibly there.
//
//   "heading_format": {"levels": ["1", "A", "a", "i"], "chain": false, "end": ".", "text": true}
//
// levels: how each level counts (1, A, a, I, i; the last repeats for deeper levels);
// chain: a heading shows its parents' numbers too (1.2.3) rather than only its own (c);
// end: what follows the number (".", ")", ":" or nothing); text: headings typed in a section's
// text and the General Information heading are numbered too.

import type { Json } from './project';

export type CountStyle = '1' | 'A' | 'a' | 'I' | 'i';
export interface HeadingFormat { levels: CountStyle[]; chain: boolean; end: string; text: boolean }

const COUNTS: CountStyle[] = ['1', 'A', 'a', 'I', 'i'];
export const COUNT_NAMES: Record<CountStyle, string> = { '1': '1, 2, 3', A: 'A, B, C', a: 'a, b, c', I: 'I, II, III', i: 'i, ii, iii' };
export const ENDS: Record<string, string> = { '.': 'A period (1.)', ')': 'A parenthesis (1))', ':': 'A colon (1:)', '': 'Nothing (1)' };

/** The ready-made formats offered, by name. `si` is SI Assistant's own value for it, when it has one. */
export const HEADING_PRESETS: { id: string; label: string; si?: string; format: HeadingFormat | null }[] = [
  { id: 'style', label: 'As the journal style does', format: null },
  { id: 'decimal', label: '1. / 1.1. / 1.1.1.', si: 'decimal', format: { levels: ['1'], chain: true, end: '.', text: true } },
  { id: 'decimal-plain', label: '1 / 1.1 / 1.1.1', format: { levels: ['1'], chain: true, end: '', text: true } },
  { id: 'outline', label: 'Outline: 1. / A. / a. / i.', si: 'outline', format: { levels: ['1', 'A', 'a', 'i'], chain: false, end: '.', text: true } },
  { id: 'classic', label: 'Outline: I. / A. / 1. / a.', format: { levels: ['I', 'A', '1', 'a'], chain: false, end: '.', text: true } },
  { id: 'parens', label: '1) / a) / i)', format: { levels: ['1', 'a', 'i'], chain: false, end: ')', text: true } },
  { id: 'letters', label: 'A. / A.1. / A.1.1.', format: { levels: ['A', '1'], chain: true, end: '.', text: true } },
  { id: 'none', label: 'None', si: 'none', format: null },
  { id: 'custom', label: 'Custom…', format: null },
];

const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);

function roman(n: number): string {
  const table: [number, string][] = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  for (const [v, s] of table) while (n >= v) { out += s; n -= v; }
  return out;
}
function alpha(n: number): string {
  let out = '';
  while (n > 0) { const rest = (n - 1) % 26; n = Math.floor((n - 1) / 26); out = String.fromCharCode(97 + rest) + out; }
  return out;
}
export function countText(n: number, style: CountStyle): string {
  return style === 'A' ? alpha(n).toUpperCase() : style === 'a' ? alpha(n) : style === 'I' ? roman(n) : style === 'i' ? roman(n).toLowerCase() : String(n);
}

/** The stored format, made sensible; null when none is stored. */
export function storedFormat(settings: Json): HeadingFormat | null {
  const raw = settings.heading_format;
  if (!isObj(raw)) return null;
  const levels = (Array.isArray(raw.levels) ? raw.levels : []).map(String).filter((x): x is CountStyle => COUNTS.includes(x as CountStyle)).slice(0, 9);
  return {
    levels: levels.length ? levels : ['1'],
    chain: raw.chain !== false,
    end: typeof raw.end === 'string' && raw.end.length <= 3 ? raw.end : '.',
    text: raw.text !== false,
  };
}

/** The format in effect: Chemweave's own, else SI Assistant's choice; null: headings aren't numbered. `textToo` aside, a journal style's numbers only number section headings. */
export function headingFormat(settings: Json): HeadingFormat | null {
  const own = storedFormat(settings);
  const chosen = String(settings.heading_numbers ?? '');
  if (chosen === 'none') return null;
  if (own) return own;
  if (chosen === 'decimal') return HEADING_PRESETS[1].format;
  if (chosen === 'outline') return HEADING_PRESETS[3].format;
  // as the journal style does: Wiley 1., 1.1.; RSC 1, 1.1; ACS none (section headings only)
  const style = String(settings.journal_style ?? 'ACS');
  if (style === 'Wiley') return { levels: ['1'], chain: true, end: '.', text: false };
  if (style === 'RSC') return { levels: ['1'], chain: true, end: '', text: false };
  return null;
}

/** Which preset the settings are (custom when Chemweave's own format matches none). */
export function presetOf(settings: Json): string {
  const own = storedFormat(settings);
  const chosen = String(settings.heading_numbers ?? '');
  if (chosen === 'none') return 'none';
  if (!own) return chosen === 'decimal' || chosen === 'outline' ? chosen : 'style';
  const same = HEADING_PRESETS.find((p) => p.format && JSON.stringify(p.format) === JSON.stringify(own));
  return same?.id ?? 'custom';
}

/**
 * Keep a choice: a preset by id, or (`custom`) a format of one's own. SI Assistant's own
 * choices are stored as it stores them; the rest in Chemweave's key, with the nearest of SI
 * Assistant's beside it.
 */
export function storeHeadingFormat(settings: Json, preset: string, custom?: HeadingFormat): void {
  const p = HEADING_PRESETS.find((x) => x.id === preset);
  delete settings.heading_format;
  if (preset === 'style' || !p) { delete settings.heading_numbers; return; }
  if (p.si) { settings.heading_numbers = p.si; return; }
  const f = preset === 'custom' ? custom : p.format;
  if (!f) { delete settings.heading_numbers; return; }
  settings.heading_format = { levels: [...f.levels], chain: f.chain, end: f.end, text: f.text };
  settings.heading_numbers = f.chain ? 'decimal' : 'outline';
}

/** A heading's number from the counts of its level and those above it ("1.2. "), with the space after it. */
export function headingNumber(f: HeadingFormat, counts: number[]): string {
  const style = (lv: number): CountStyle => f.levels[Math.min(lv, f.levels.length - 1)];
  const own = (lv: number): string => countText(counts[lv], style(lv));
  const text = f.chain ? counts.map((_, lv) => own(lv)).join('.') : own(counts.length - 1);
  return text + f.end + ' ';
}

/** An example of a format, three levels deep: "1. Synthesis · 1.1. Ketones · 1.1.1. Reduction". */
export function headingExample(f: HeadingFormat | null): string {
  if (!f) return 'Synthesis · Ketones · Reduction (not numbered)';
  return [[1], [1, 1], [1, 1, 2]].map((c, i) => headingNumber(f, c) + ['Synthesis', 'Ketones', 'Reduction'][i]).join(' · ');
}
