// Headers and footers as Word has them: a different first page (a title page's), different odd
// and even pages (the page number on the outside edge of a bound thesis), and headers with
// more than plain text: a logo, a table, formatted text and fields (from Word, or a picture
// added here). Plain headers stay three pieces of text (left, centre, right) and a page number;
// one with pictures or tables is kept as Word's paragraphs (a "body"), laid out and drawn on
// each page and saved back as it was.

import type { ParaStyle, TextRun } from '../model';
import * as rt from '../richtext';
import { fieldText, type FieldObj } from './fields';
import { styleOf, type DocObject, type DocText, type HeaderFooter, type HfBody, type HfKey, type HfZones, type NumberPlace } from './document';

export const HF_KEYS: HfKey[] = ['header', 'footer', 'firstHeader', 'firstFooter', 'evenHeader', 'evenFooter'];

const EMPTY: [string, string, string] = ['', '', ''];

/** Which header or footer a page shows: the first page's, an even page's, or the usual one. */
export function hfKeyFor(hf: HeaderFooter, kind: 'header' | 'footer', starts: boolean, n: number): HfKey {
  if (hf.firstPage && starts) return kind === 'header' ? 'firstHeader' : 'firstFooter';
  if (hf.oddEven && n % 2 === 0) return kind === 'header' ? 'evenHeader' : 'evenFooter';
  return kind;
}

/** Header or footer, whichever page it is for. */
export const kindOf = (key: HfKey): 'header' | 'footer' => (/footer/i.test(key) ? 'footer' : 'header');

/** The plain text (left, centre, right) of a header or footer. */
export function zonesFor(hf: HeaderFooter, key: HfKey): [string, string, string] {
  const kind = kindOf(key);
  const set: HfZones | undefined = key.startsWith('first') ? hf.first : key.startsWith('even') ? hf.even : undefined;
  if (key === kind) return hf[kind];
  return set?.[kind] ?? EMPTY;
}

/** Where the page number goes on a page with this header or footer: the usual place, or on the other side on even pages. */
export function numbersFor(hf: HeaderFooter, key: HfKey): NumberPlace {
  if (!key.startsWith('even') || hf.numbers === 'none') return hf.numbers;
  return hf.numbers.endsWith('left') ? hf.numbers.replace('left', 'right') as NumberPlace : hf.numbers.endsWith('right') ? hf.numbers.replace('right', 'left') as NumberPlace : hf.numbers;
}

/** Every header and footer of a document: its own and each section's. */
export function allHf(t: Pick<DocText, 'hf'> & Partial<Pick<DocText, 'paras'>>): HeaderFooter[] {
  const out = [t.hf];
  for (const p of t.paras ?? []) if (p?.section?.hf) out.push(p.section.hf);
  return out;
}

/** The objects (pictures, tables, fields) the headers and footers hold. */
export function hfObjectIds(hfs: (HeaderFooter | undefined)[], objects: Record<number, DocObject>): number[] {
  const out: number[] = [];
  const add = (runs: TextRun[]) => {
    for (const r of runs) {
      if (r.obj === undefined) continue;
      out.push(r.obj);
      const o = objects[r.obj];
      if (o?.kind === 'table') for (const row of o.table.rows) for (const c of row) add(c.runs);
    }
  };
  for (const hf of hfs) for (const b of Object.values(hf?.bodies ?? {})) if (b) add(b.runs);
  return out;
}

/**
 * What a field in a header or footer shows on a page: `num` is the page's number, `pages` how
 * many there are. `pageOf` gives the page a paragraph of the text is on (a bookmark's page, for
 * PAGEREF); `cache` holds what is worked out from the whole text, for every page of one layout.
 */
export function hfFieldText(o: FieldObj, t: Pick<DocText, 'runs' | 'paras' | 'props'>, num: string, pages: number, pageOf?: (para: number) => string, cache?: { marks?: Map<string, number>; texts?: string[] }): string {
  if (o.code === 'page') return num;
  if (o.code === 'numpages') return String(pages);
  return fieldText(o, { runs: t.runs, paras: t.paras, props: t.props }, 0, pageOf ?? (() => num), pages, cache);
}

/**
 * A plain header or footer as a body: one paragraph with its left, centre and right text at a
 * centre and a right tab stop, and the page number (a PAGE field after `prefix`) in its place.
 */
export function bodyFromZones(zones: [string, string, string], numberAt: number, prefix: string, look: rt.RunStyle, width: number, pageField: () => number): HfBody {
  const runs: TextRun[] = [];
  for (let i = 0; i < 3; i++) {
    if (i > 0) runs.push({ ...look, text: '\t' });
    if (zones[i]) runs.push({ ...look, text: zones[i] });
    if (i === numberAt) {
      const lead = (zones[i] ? ' ' : '') + prefix;
      if (lead) runs.push({ ...look, text: lead });
      runs.push({ ...look, obj: pageField(), text: '￼' });
    }
  }
  const ps: ParaStyle = { spaceBefore: 0, spaceAfter: 0, tabs: [{ pos: width / 2, kind: 'center' }, { pos: width, kind: 'right' }] };
  return { runs: rt.normalizeRuns(runs.length ? runs : [{ ...look, text: '' }]), paras: [ps] };
}

/** Is there anything in a body (text, a picture, a table)? */
export const bodyEmpty = (b: HfBody | undefined): boolean => !b || !b.runs.some((r) => r.obj !== undefined || r.text.trim());

/**
 * A body with a run (a picture) put in at the start of its first line's left, centre or right
 * part (the text after its first or second tab), adding tabs to reach it.
 */
export function insertInZone(body: HfBody, zone: number, run: TextRun): HfBody {
  let runs = body.runs;
  let text = rt.plainText(runs);
  let end = text.indexOf('\n');
  if (end < 0) end = text.length;
  const tabs = [...text.slice(0, end)].filter((c) => c === '\t').length;
  if (tabs < zone) {
    const look = runs.length ? rt.styleOf(runs[runs.length - 1]) : {};
    runs = [...rt.sliceRuns(runs, 0, end), { ...look, text: '\t'.repeat(zone - tabs) }, ...rt.sliceRuns(runs, end, text.length)];
    text = rt.plainText(runs);
  }
  let at = 0;
  for (let k = 0; k < zone; k++) at = text.indexOf('\t', at) + 1;
  return { ...body, runs: rt.normalizeRuns([...rt.sliceRuns(runs, 0, at), run, ...rt.sliceRuns(runs, at, text.length)]) };
}

/** The look of a plain header or footer's text: the Normal style's font, at most 10 pt (as drawHeaderFooter draws it). */
export function plainLook(t: Pick<DocText, 'styles'>): rt.RunStyle {
  const N = styleOf(t, undefined);
  return { font: N.font, size: Math.min(10, N.size) };
}

/** Where a plain header or footer puts the page number (0 left, 1 centre, 2 right), or -1 when it shows none. */
export function numberZone(hf: HeaderFooter, key: HfKey): number {
  const kind = kindOf(key);
  const numbers = numbersFor(hf, key);
  if (numbers === 'none' || !numbers.startsWith(kind)) return -1;
  // a first page of its own shows its number only when the first page is numbered
  if (key.startsWith('first') && !hf.onFirst) return -1;
  return ['left', 'center', 'right'].indexOf(numbers.split('-')[1]);
}

/**
 * A plain header or footer as Word's paragraphs, to type into on the page: its left, centre and
 * right text at the tab stops and its page number (a PAGE field `newField` makes) in its place.
 */
export function zonesAsBody(t: Pick<DocText, 'styles'>, hf: HeaderFooter, key: HfKey, textW: number, newField: () => number): HfBody {
  return bodyFromZones(zonesFor(hf, key), numberZone(hf, key), hf.prefix ?? '', plainLook(t), textW, newField);
}

/**
 * A header or footer typed into on the page, back as plain text (left, centre and right, and the
 * page number's place) when that is all it is: one line in the plain look, at most two tabs, and
 * at most one page number, at the end of its part after the page numbers' prefix. Null when it
 * holds more (formatting, pictures, more lines) and stays as Word's paragraphs.
 */
export function bodyAsZones(body: HfBody, t: Pick<DocText, 'styles' | 'objects'>, hf: HeaderFooter, key: HfKey, textW: number): HeaderFooter | null {
  const look = plainLook(t);
  const text = rt.plainText(body.runs);
  if (text.includes('\n')) return null;
  // the paragraph as a plain one is: no spacing, a centre and a right tab stop
  const plain = bodyFromZones(['', '', ''], -1, '', look, textW, () => 0).paras?.[0];
  // (tabs without the plain header's tab stops line up elsewhere)
  if (!body.paras?.length && text.includes('\t')) return null;
  if (body.paras?.length) {
    const { tabs, spaceBefore, spaceAfter, ...rest } = body.paras[0];
    if (spaceBefore || spaceAfter || Object.values(rest).some((v) => v !== undefined)) return null;
    if (JSON.stringify(tabs ?? []) !== JSON.stringify(plain?.tabs ?? [])) return null;
  }
  for (const r of body.runs) {
    const { text: _x, obj: _o, ...style } = r;
    if (JSON.stringify(Object.entries(style).filter(([, v]) => v !== undefined).sort()) !== JSON.stringify(Object.entries(look).sort())) return null;
  }
  const parts: string[] = ['', '', ''];
  let zone = 0, field = -1;
  for (const r of body.runs) {
    if (r.obj !== undefined) {
      const o = t.objects[r.obj];
      if (o?.kind !== 'field' || o.code !== 'page' || field >= 0) return null;
      field = zone;
      continue;
    }
    for (const ch of r.text) {
      if (ch === '\t') { zone++; if (zone > 2) return null; continue; }
      // text after the page number in its part
      if (field === zone) return null;
      parts[zone] += ch;
    }
  }
  const prefix = hf.prefix ?? '';
  if (field >= 0) {
    const p = parts[field];
    if (!p.endsWith(prefix)) return null;
    const before = p.slice(0, p.length - prefix.length);
    // "Title S" + page: the part's own text, a space, then the prefix
    if (before && !before.endsWith(' ')) return null;
    parts[field] = before.replace(/ $/, '');
  }
  const kind = kindOf(key);
  const zones = parts as [string, string, string];
  const out: HeaderFooter = { ...hf };
  if (key === kind) {
    out[kind] = zones;
    if (field !== numberZone(hf, key)) {
      // the page number moved, came or went: only where the other part (header or footer) doesn't show it
      if (field >= 0) {
        if (hf.numbers !== 'none' && !hf.numbers.startsWith(kind)) return null;
        out.numbers = `${kind}-${['left', 'center', 'right'][field]}` as NumberPlace;
      } else out.numbers = 'none';
    }
  } else {
    if (field !== numberZone(hf, key)) return null;
    const set = key.startsWith('first') ? 'first' : 'even';
    const z: HfZones = hf[set] ?? { header: ['', '', ''], footer: ['', '', ''] };
    out[set] = { ...z, [kind]: zones };
  }
  const bodies = { ...hf.bodies };
  delete bodies[key];
  if (Object.keys(bodies).length) out.bodies = bodies; else delete out.bodies;
  return out;
}

/** A ready-made header or footer (Header ▾ and Footer ▾): its left, centre and right text ({title} and {author} from Insert ▸ Quick Parts ▸ Document Properties…) and where the page number goes (-1: none). */
export interface HfPreset { kind: 'header' | 'footer'; name: string; zones: [string, string, string]; number: number; prefix?: string }

export const HF_PRESETS: HfPreset[] = [
  { kind: 'header', name: 'Blank', zones: ['', '', ''], number: -1 },
  { kind: 'header', name: 'Three Columns', zones: ['[Type here]', '[Type here]', '[Type here]'], number: -1 },
  { kind: 'header', name: 'Title and Author', zones: ['{title}', '', '{author}'], number: -1 },
  { kind: 'header', name: 'Title and Page Number', zones: ['{title}', '', ''], number: 2 },
  { kind: 'header', name: 'Supporting Information', zones: ['{author}', '', 'Supporting Information'], number: -1 },
  { kind: 'footer', name: 'Blank', zones: ['', '', ''], number: -1 },
  { kind: 'footer', name: 'Three Columns', zones: ['[Type here]', '[Type here]', '[Type here]'], number: -1 },
  { kind: 'footer', name: 'Page Number', zones: ['', '', ''], number: 1, prefix: '' },
  { kind: 'footer', name: 'Page Number, Right', zones: ['', '', ''], number: 2, prefix: '' },
  { kind: 'footer', name: 'Supporting Information Pages (S1, S2…)', zones: ['', '', ''], number: 1, prefix: 'S' },
];

/** A small picture of a ready-made header or footer for its menu: a page's top or bottom, with grey bars where its text goes and the number in the accent color. */
export function hfPresetPicture(pr: HfPreset): string {
  const W = 46, H = 20, y = pr.kind === 'header' ? 5 : 14;
  const bars = pr.zones.map((z, i) => {
    const num = pr.number === i;
    if (!z && !num) return '';
    const w = num ? (pr.prefix ? 7 : 4) : z.startsWith('[') ? 9 : 11;
    const x = i === 0 ? 5 : i === 1 ? W / 2 - w / 2 : W - 5 - w;
    return `<rect x="${x}" y="${y - 1.25}" width="${w}" height="2.5" rx="1" fill="${num ? 'currentColor' : '#9aa0aa'}"/>`;
  }).join('');
  const page = pr.kind === 'header' ? `<path d="M1.5 ${H} V2.5 a1 1 0 0 1 1-1 H${W - 2.5} a1 1 0 0 1 1 1 V${H}" fill="#fff" stroke="#9aa0aa"/>` : `<path d="M1.5 0 V${H - 2.5} a1 1 0 0 0 1 1 H${W - 2.5} a1 1 0 0 0 1-1 V0" fill="#fff" stroke="#9aa0aa"/>`;
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true">${page}${bars}</svg>`;
}
