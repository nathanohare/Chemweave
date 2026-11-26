// The small text format Chem SI Assistant keeps formatted text in (core/markup.py), so a
// procedure typed here reads the same there, and the files stay readable in any editor:
//
//   # Heading 1   ## Heading 2          (a line starting so)
//   **bold**  *italic*  __underline__  ^{superscript}  _{subscript}
//   @{c-7f3a2c91}                      a mention: printed as the compound's ID (**3g**),
//                                      or a figure's, table's or scheme's label
//   @cite{r-1a2b3c,r-4d5e6f}           citations of references.json entries
//   @struct{s-1a2b3c}                  a small structure in a scheme's conditions
//   !figure{f-…} Caption   !table{t-…} Caption   !image{images/x.png} Caption
//   !align{center} …                   a paragraph's alignment, when not the default
//
// Characters that would be read as markers are escaped with a backslash: \* \^ \_ \} \# \\

export type VAlign = 'normal' | 'super' | 'sub';

export interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  valign?: VAlign;
  /** A link instead of text: "c:<id>" (mention), "cite:<id>,<id>" (citations) or "struct:<id>". */
  ref?: string;
  /** Compiling only: where the text links to in the compiled SI ("#si_…", a bookmark), as a document's links (links.ts). Never stored. */
  link?: string;
  /** Compiling only: where the text came from (source-map.ts), for the Live Preview. Never stored. */
  src?: string;
}

export interface Paragraph {
  runs: Run[];
  /** 0 = text, 1 or 2 = a heading. */
  heading?: number;
  /** A figure, table or (older) picture paragraph: its id or path (the runs are its caption). */
  figure?: string;
  table?: string;
  image?: string;
  /** '' = the default (text justified; figures and tables centered). */
  align?: string;
}

export const MENTION = 'c:';
export const CITE = 'cite:';
export const STRUCT = 'struct:';
const MAX_HEADING = 2;

const vOf = (r: Run): VAlign => r.valign ?? 'normal';
const sameFormat = (a: Run, b: Run): boolean => !a.ref && !b.ref && !!a.bold === !!b.bold && !!a.italic === !!b.italic && vOf(a) === vOf(b) && !!a.underline === !!b.underline;

const isObject = (p: Paragraph): boolean => !!(p.image || p.figure || p.table);

/** The alignment written for a paragraph ('' when it is the default for its kind). */
export function storedAlign(align: string | undefined, object: boolean): string {
  const ok = object ? ['left', 'center', 'right'] : ['left', 'center', 'right', 'justify'];
  const v = align && ok.includes(align) ? align : object ? 'center' : 'justify';
  return v === (object ? 'center' : 'justify') ? '' : v;
}

function append(runs: Run[], run: Run): void {
  if (!run.text && !run.ref) return;
  const last = runs[runs.length - 1];
  if (last && sameFormat(last, run)) runs[runs.length - 1] = { ...last, text: last.text + run.text };
  else runs.push(run);
}

const LINK = /@(cite|struct)?\{([^{}]*)\}/y;
const OBJECT = /^!(image|figure|table)\{([^{}]*)\}\s?/;
const ALIGN = /^!align\{\s*(left|center|centre|right|justify|justified)\s*\}\s?/i;
const OBJECT_STARTS = ['!image{', '!figure{', '!table{', '!align{'];

function parseLine(line: string): Paragraph {
  const p: Paragraph = { runs: [] };
  let m = ALIGN.exec(line);
  if (m) {
    const name = m[1].toLowerCase();
    p.align = name === 'centre' ? 'center' : name === 'justified' ? 'justify' : name;
    line = line.slice(m[0].length);
  }
  m = OBJECT.exec(line);
  if (m) {
    p[m[1] as 'image' | 'figure' | 'table'] = m[2].trim();
    line = line.slice(m[0].length);
  } else {
    for (let level = MAX_HEADING; level > 0; level--) {
      const prefix = '#'.repeat(level) + ' ';
      if (line.startsWith(prefix)) { p.heading = level; line = line.slice(prefix.length); break; }
    }
  }
  let buf = '';
  let bold = false, italic = false, underline = false;
  let valign: VAlign = 'normal';
  const fmt = (): Omit<Run, 'text'> => ({ ...(bold ? { bold } : {}), ...(italic ? { italic } : {}), ...(underline ? { underline } : {}), ...(valign !== 'normal' ? { valign } : {}) });
  const flush = (): void => { if (buf) { append(p.runs, { text: buf, ...fmt() }); buf = ''; } };
  const n = line.length;
  let i = 0;
  while (i < n) {
    const ch = line[i], nxt = line[i + 1] ?? '';
    if (ch === '\\' && nxt) { buf += nxt; i += 2; continue; }
    if (ch === '@') {
      LINK.lastIndex = i;
      const link = LINK.exec(line);
      if (link) {
        flush();
        let ref: string;
        if (link[1] === 'struct') ref = STRUCT + link[2].trim();
        else if (link[1]) ref = CITE + link[2].split(',').map((x) => x.trim()).filter(Boolean).join(',');
        else ref = MENTION + link[2].trim();
        p.runs.push({ text: '', ...fmt(), ref });
        i = LINK.lastIndex;
        continue;
      }
    }
    if (ch === '_' && nxt === '_') { flush(); underline = !underline; i += 2; }
    else if (ch === '*' && nxt === '*') { flush(); bold = !bold; i += 2; }
    else if (ch === '*') { flush(); italic = !italic; i += 1; }
    else if ((ch === '^' || ch === '_') && nxt === '{' && valign === 'normal') { flush(); valign = ch === '^' ? 'super' : 'sub'; i += 2; }
    else if (ch === '}' && valign !== 'normal') { flush(); valign = 'normal'; i += 1; }
    else { buf += ch; i += 1; }
  }
  flush();
  return p;
}

/** Stored text as paragraphs, one per line. */
export function parseMarkup(text: string): Paragraph[] {
  return text.replace(/\r\n/g, '\n').split('\n').map(parseLine);
}

/** Text with the characters that would be read as markers escaped (as typed into a field, to keep as it reads). */
export function escapeMarkup(text: string): string {
  return escape(text);
}

/**
 * escapeMarkup for text that may start paragraphs: a "#" (a heading) or "!image{" and the like
 * (an object) at the start of a paragraph is escaped too, as writeMarkup does, so it stays text.
 * `atStart`: the text goes at the start of a paragraph (each line after a "\n" in it always does).
 */
export function escapeMarkupLines(text: string, atStart: boolean): string {
  return escape(text).split('\n').map((line, i) => ((i > 0 || atStart) && startsMarker(line) ? '\\' + line : line)).join('\n');
}

/** Whether a paragraph's stored text starts with a heading's or an object's marker. */
export function startsMarker(line: string): boolean {
  return line.startsWith('#') || OBJECT_STARTS.some((s) => line.startsWith(s));
}

function escape(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if ('\\*^_}'.includes(ch) || (ch === '@' && (text.startsWith('{', i + 1) || text.startsWith('cite{', i + 1) || text.startsWith('struct{', i + 1)))) out += '\\';
    out += ch;
  }
  return out;
}

const mentionOf = (r: Run): string => (r.ref?.startsWith(MENTION) ? r.ref.slice(MENTION.length) : '');
const structOf = (r: Run): string => (r.ref?.startsWith(STRUCT) ? r.ref.slice(STRUCT.length) : '');
/** The reference ids a run cites. */
export const citationsOf = (r: Run): string[] => (r.ref?.startsWith(CITE) ? r.ref.slice(CITE.length).split(',').map((x) => x.trim()).filter(Boolean) : []);

function linkText(r: Run): string {
  const m = mentionOf(r);
  if (m) return `@{${m}}`;
  const s = structOf(r);
  if (s) return `@struct{${s}}`;
  return `@cite{${citationsOf(r).join(',')}}`;
}

function writeParagraph(p: Paragraph): string {
  const merged: Run[] = [];
  for (const r of p.runs) append(merged, r);
  const out: string[] = [];
  const obj = isObject(p);
  const align = storedAlign(p.align, obj);
  if (align) out.push(`!align{${align}}` + (merged.length || obj || p.heading ? ' ' : ''));
  const kind = (['figure', 'table', 'image'] as const).find((k) => p[k]);
  if (kind) out.push(`!${kind}{` + p[kind]!.replace(/[{}]/g, '') + (merged.length ? '} ' : '}'));
  else if (p.heading) out.push('#'.repeat(Math.min(p.heading, MAX_HEADING)) + ' ');
  let bold = false, italic = false, underline = false;
  let valign: VAlign = 'normal';
  merged.forEach((r, k) => {
    let text = r.ref ? linkText(r) : escape(r.text);
    if (k === 0 && !p.heading && !obj && !r.ref && (text.startsWith('#') || OBJECT_STARTS.some((s) => text.startsWith(s)))) text = '\\' + text;
    // close a superscript or subscript first (braces nest), then bold and italic
    if (valign !== vOf(r) && valign !== 'normal') { out.push('}'); valign = 'normal'; }
    if (bold !== !!r.bold) { out.push('**'); bold = !!r.bold; }
    if (italic !== !!r.italic) { out.push('*'); italic = !!r.italic; }
    if (underline !== !!r.underline) { out.push('__'); underline = !!r.underline; }
    if (valign !== vOf(r)) { out.push(vOf(r) === 'super' ? '^{' : '_{'); valign = vOf(r); }
    out.push(text);
  });
  if (valign !== 'normal') out.push('}');
  if (underline) out.push('__');
  if (italic) out.push('*');
  if (bold) out.push('**');
  return out.join('');
}

/** Paragraphs as stored text. */
export function writeMarkup(paragraphs: readonly Paragraph[]): string {
  return paragraphs.map(writeParagraph).join('\n');
}

/** Every mentioned id, in order (repeats included). */
export const mentionsIn = (ps: readonly Paragraph[]): string[] => ps.flatMap((p) => p.runs.map(mentionOf).filter(Boolean));

/** Every cited reference id, in order. */
export const citationsIn = (ps: readonly Paragraph[]): string[] => ps.flatMap((p) => p.runs.flatMap(citationsOf));

/** The text with the markers taken out (mentions and citations as given by `label`). */
export function plainMarkup(text: string, label: (ref: string) => string = () => ''): string {
  return parseMarkup(text).map((p) => p.runs.map((r) => (r.ref ? label(r.ref) : r.text)).join('')).join('\n');
}
