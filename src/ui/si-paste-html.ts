// Text pasted into an SI text box from Word or MestReNova keeps its bold, italics, sub- and
// superscripts (Chem SI Assistant's SPEC §5: "pasting preserves formatting"), and nothing
// else: fonts, colors, sizes, links and the like are left behind.

const esc = (t: string): string => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

interface Look { b: boolean; i: boolean; pos: '' | 'sub' | 'sup' }

const BLOCKS = new Set(['P', 'DIV', 'LI', 'TR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6']);

/** The pasted HTML as plain text with only <b>, <i>, <sub> and <sup> (line breaks as "\n" when `multiline`, else spaces). */
export function cleanPastedHtml(html: string, multiline: boolean): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out: string[] = [];
  const walk = (node: Node, look: Look): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = (node.textContent ?? '').replace(/[\r\n\t ]+/g, ' ');
      if (!t) return;
      let s = esc(t);
      if (look.pos) s = `<${look.pos}>${s}</${look.pos}>`;
      if (look.i) s = `<i>${s}</i>`;
      if (look.b) s = `<b>${s}</b>`;
      out.push(s);
      return;
    }
    if (!(node instanceof Element)) return;
    const tag = node.tagName;
    if (tag === 'STYLE' || tag === 'SCRIPT' || tag === 'HEAD' || tag === 'TITLE') return;
    if (tag === 'BR') { out.push(multiline ? '<br>' : ' '); return; }
    const st = (node as HTMLElement).style;
    const next: Look = { ...look };
    if (tag === 'B' || tag === 'STRONG' || /^(bold|[6-9]00)$/.test(st?.fontWeight ?? '')) next.b = true;
    if (st?.fontWeight === 'normal' || st?.fontWeight === '400') next.b = false;
    if (tag === 'I' || tag === 'EM' || st?.fontStyle === 'italic') next.i = true;
    if (st?.fontStyle === 'normal') next.i = false;
    const va = st?.verticalAlign ?? '';
    if (tag === 'SUB' || va === 'sub') next.pos = 'sub';
    else if (tag === 'SUP' || va === 'super') next.pos = 'sup';
    else if (va === 'baseline') next.pos = '';
    const block = BLOCKS.has(tag) && out.length > 0;
    if (block) out.push(multiline ? '<br>' : ' ');
    for (const k of node.childNodes) walk(k, next);
  };
  walk(doc.body, { b: false, i: false, pos: '' });
  return out.join('').replace(/^(\s|<br>)+|(\s|<br>)+$/g, '');
}
