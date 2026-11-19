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

/** The pasted HTML as plain text with only <b>, <i>, <u>, <sub>, <sup> and SI links (line breaks as <br> when `multiline`, else spaces). */
export function cleanPastedHtml(html: string, multiline: boolean): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out: string[] = [];
  const walk = (node: Node, look: Look): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      // (a non-breaking space, as in "400\u00a0MHz", is kept: only ordinary white space is folded)
      const t = (node.textContent ?? '').replace(/[\r\n\t ]+/g, ' ');
      if (!t) return;
      let s = esc(t);
      if (look.pos) s = `<${look.pos}>${s}</${look.pos}>`;
      if (look.u) s = `<u>${s}</u>`;
      if (look.i) s = `<i>${s}</i>`;
      if (look.b) s = `<b>${s}</b>`;
      out.push(s);
      return;
    }
    if (!(node instanceof Element)) return;
    const tag = node.tagName;
    if (tag === 'STYLE' || tag === 'SCRIPT' || tag === 'HEAD' || tag === 'TITLE') return;
    if (tag === 'BR') { out.push(multiline ? '<br>' : ' '); return; }
    // a mention, citation or inline structure copied from an SI text box: the link itself (its label is drawn again)
    const ref = (node as HTMLElement).dataset?.ref;
    if (ref && (ref.startsWith(MENTION) || ref.startsWith(CITE) || ref.startsWith(STRUCT))) {
      const cls = ref.startsWith(CITE) ? 'si-cite' : ref.startsWith(STRUCT) ? 'si-inline-struct' : 'si-mention';
      let s = `<span class="${cls}" contenteditable="false" data-ref="${attr(ref)}">${esc((node.textContent ?? '').trim() || '?')}</span>`;
      if (look.pos) s = `<${look.pos}>${s}</${look.pos}>`;
      if (look.u) s = `<u>${s}</u>`;
      if (look.i) s = `<i>${s}</i>`;
      if (look.b) s = `<b>${s}</b>`;
      out.push(s);
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
    const block = BLOCKS.has(tag) && out.length > 0;
    if (block) out.push(multiline ? '<br>' : ' ');
    for (const k of node.childNodes) walk(k, next);
  };
  walk(doc.body, { b: false, i: false, u: false, pos: '' });
  return out.join('').replace(/^(\s|<br>)+|(\s|<br>)+$/g, '');
}
