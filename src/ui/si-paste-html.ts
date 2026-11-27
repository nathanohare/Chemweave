// Text pasted into an SI text box from Word or MestReNova keeps its bold, italics, underline,
// sub- and superscripts (Chem SI Assistant's SPEC §5: "pasting preserves formatting"), and
// nothing else: fonts, colors, sizes, links and the like are left behind. Text copied from
// another SI text box keeps its mentions and citations (@2b, [3]) as the links they are.

import { CITE, MENTION, STRUCT } from '../si/markup';

const esc = (t: string): string => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

interface Look { b: boolean; i: boolean; u: boolean; pos: '' | 'sub' | 'sup' }
const attr = (t: string): string => esc(t).replace(/"/g, '&quot;');

/** Whether cleaned HTML holds anything plain text would lose (formatting, or a link). */
export const hasFormatting = (clean: string): boolean => /<(b|i|u|sub|sup)>|<span /.test(clean);

const BLOCKS = new Set(['P', 'DIV', 'LI', 'TR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6']);

/** What pasted HTML holds, in order: words in a look, line breaks, cell breaks, and SI links. */
type Piece = { k: 'text'; s: string; look: Look } | { k: 'br' } | { k: 'tab' } | { k: 'ref'; ref: string; cls: string; label: string; look: Look };

/**
 * The pasted HTML as pieces, keeping only bold, italic, underline, sub- and superscript (the one
 * walk both kinds of paste share). With `cells`, a table's cells are apart by tabs and its rows
 * by line breaks, as their text/plain has them.
 */
function pieces(html: string, cells: boolean): Piece[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out: Piece[] = [];
  const walk = (node: Node, look: Look): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      // (a non-breaking space, as in "400\u00a0MHz", is kept: only ordinary white space is folded)
      // (a bare U+FFFC, a picture or equation's place in the copied text, is left out)
      const t = (node.textContent ?? '').replace(/\uFFFC/g, '').replace(/[\r\n\t ]+/g, ' ');
      if (t) out.push({ k: 'text', s: t, look });
      return;
    }
    if (!(node instanceof Element)) return;
    const tag = node.tagName;
    if (tag === 'STYLE' || tag === 'SCRIPT' || tag === 'HEAD' || tag === 'TITLE') return;
    if (tag === 'BR') { out.push({ k: 'br' }); return; }
    // a mention, citation or inline structure copied from an SI text box: the link itself (its label is drawn again)
    const ref = (node as HTMLElement).dataset?.ref;
    if (ref && (ref.startsWith(MENTION) || ref.startsWith(CITE) || ref.startsWith(STRUCT))) {
      out.push({ k: 'ref', ref, cls: ref.startsWith(CITE) ? 'si-cite' : ref.startsWith(STRUCT) ? 'si-inline-struct' : 'si-mention', label: (node.textContent ?? '').trim() || '?', look });
      return;
    }
    const st = (node as HTMLElement).style;
    const next: Look = { ...look };
    if (tag === 'B' || tag === 'STRONG' || /^(bold|[6-9]00)$/.test(st?.fontWeight ?? '')) next.b = true;
    if (st?.fontWeight === 'normal' || st?.fontWeight === '400') next.b = false;
    if (tag === 'I' || tag === 'EM' || st?.fontStyle === 'italic') next.i = true;
    if (st?.fontStyle === 'normal') next.i = false;
    // (a link's own underline is its look, not the text's)
    const deco = `${st?.textDecoration ?? ''} ${st?.textDecorationLine ?? ''}`;
    if (tag === 'U' || (tag !== 'A' && /underline/.test(deco))) next.u = true;
    else if (/\bnone\b/.test(deco)) next.u = false;
    const va = st?.verticalAlign ?? '';
    if (tag === 'SUB' || va === 'sub') next.pos = 'sub';
    else if (tag === 'SUP' || va === 'super') next.pos = 'sup';
    else if (va === 'baseline') next.pos = '';
    if (cells && (tag === 'TD' || tag === 'TH') && node.previousElementSibling) out.push({ k: 'tab' });
    else if (BLOCKS.has(tag) && out.length > 0) out.push({ k: 'br' });
    for (const k of node.childNodes) walk(k, next);
  };
  walk(doc.body, { b: false, i: false, u: false, pos: '' });
  return out;
}

const wrap = (s: string, look: Look): string => {
  if (look.pos) s = `<${look.pos}>${s}</${look.pos}>`;
  if (look.u) s = `<u>${s}</u>`;
  if (look.i) s = `<i>${s}</i>`;
  if (look.b) s = `<b>${s}</b>`;
  return s;
};

/** The pasted HTML as plain text with only <b>, <i>, <u>, <sub>, <sup> and SI links (line breaks as <br> when `multiline`, else spaces). */
export function cleanPastedHtml(html: string, multiline: boolean): string {
  const out = pieces(html, false).map((p) => {
    switch (p.k) {
      case 'text': return wrap(esc(p.s), p.look);
      case 'ref': return wrap(`<span class="${p.cls}" contenteditable="false" data-ref="${attr(p.ref)}">${esc(p.label)}</span>`, p.look);
      default: return multiline ? '<br>' : ' ';
    }
  });
  return out.join('').replace(/^(\s|<br>)+|(\s|<br>)+$/g, '');
}

/** One stretch of pasted text with the looks it keeps (Keep Source Formatting in the Live Preview). */
export interface PastedLook { a: number; b: number; look: Partial<Record<'bold' | 'italic' | 'underline' | 'sub' | 'sup', true>> }

/**
 * Pasted HTML as its plain text (a table's cells apart by tabs, its rows and paragraphs by line
 * breaks, with no stray spaces at their edges) and the stretches of it that are bold, italic,
 * underlined, subscript or superscript (those alike next to each other joined), for the Live
 * Preview, which takes text and formats it as Home ▸ Font does.
 */
export function pastedLooks(html: string): { text: string; looks: PastedLook[] } {
  let text = '';
  const looks: PastedLook[] = [];
  /** Spaces before a break go (and what they formatted). */
  const trimEnd = (): void => {
    while (text.endsWith(' ')) text = text.slice(0, -1);
    for (const l of looks) l.b = Math.min(l.b, text.length);
    while (looks.length && looks[looks.length - 1].b <= looks[looks.length - 1].a) looks.pop();
  };
  const add = (t: string, look: Look): void => {
    // (spaces after a break, or at the start, go)
    if (!text || text.endsWith('\n') || text.endsWith('\t')) t = t.replace(/^ +/, '');
    if (!t) return;
    const a = text.length;
    text += t;
    const l: PastedLook['look'] = {};
    if (look.b) l.bold = true;
    if (look.i) l.italic = true;
    if (look.u) l.underline = true;
    if (look.pos === 'sub') l.sub = true;
    if (look.pos === 'sup') l.sup = true;
    if (!Object.keys(l).length) return;
    const last = looks[looks.length - 1];
    if (last && last.b === a && JSON.stringify(last.look) === JSON.stringify(l)) last.b = text.length;
    else looks.push({ a, b: text.length, look: l });
  };
  for (const p of pieces(html, true)) {
    if (p.k === 'text') add(p.s, p.look);
    else if (p.k === 'ref') add(p.label, p.look);
    else { trimEnd(); if (text) text += p.k === 'tab' ? '\t' : '\n'; }
  }
  trimEnd();
  // (no line breaks at the end)
  while (text.endsWith('\n')) { text = text.slice(0, -1); trimEnd(); }
  return { text, looks };
}
