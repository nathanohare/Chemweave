// Formula style on the selected SI text (review of F5, F5b-R04): the numbers of CH2Cl2 lowered and
// the charge of PF6- raised, as the other modes do, by wrapping only those characters in <sub> or
// <sup> where they are. Bold, italic and underline round the text stay as they were.

import { chemPieces, type Piece } from '../sheet/cell-text';

type Look = Pick<Piece, 'pos' | 'italic'>;

/** The selected part of each text node in `range`, in order. */
function selectedText(range: Range): { node: Text; from: number; to: number }[] {
  const root = range.commonAncestorContainer;
  const doc = root.ownerDocument ?? (root as Document);
  const out: { node: Text; from: number; to: number }[] = [];
  if (root instanceof Text) return [{ node: root, from: range.startOffset, to: range.endOffset }];
  const walk = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode() as Text | null; n; n = walk.nextNode() as Text | null) {
    if (!range.intersectsNode(n)) continue;
    const from = n === range.startContainer ? range.startOffset : 0;
    const to = n === range.endContainer ? range.endOffset : n.length;
    if (to > from) out.push({ node: n, from, to });
  }
  return out;
}

/**
 * Give the text in `range` formula style. Returns false when nothing in it changes (it has no
 * numbers or charges to move, or they are lowered and raised already).
 */
export function formulaStyleRange(range: Range): boolean {
  const parts = selectedText(range);
  const text = parts.map((p) => p.node.data.slice(p.from, p.to)).join('');
  // each character's look, from the same rules as a cell's Chemistry look and typing in a caption
  const looks: Look[] = chemPieces(text).flatMap((p) => Array.from({ length: p.text.length }, () => ({ pos: p.pos, italic: p.italic })));
  let at = 0, changed = false;
  // where the selection starts and ends once the text is rewrapped: a place in a text node, or beside a new piece
  let start: (() => void) | null = null, end: (() => void) | null = null;
  for (const { node, from, to } of parts) {
    const mine = looks.slice(at, at + to - from);
    at += to - from;
    const doc = node.ownerDocument;
    const inside = node.parentElement;
    // (text already lowered or raised stays as it is, and so does text already in italics)
    if (inside?.closest('sub, sup') || mine.every((l) => l.pos === 'base' && !l.italic)) {
      start ??= () => range.setStart(node, from);
      end = () => range.setEnd(node, to);
      continue;
    }
    const italicAlready = !!inside?.closest('i, em');
    const out = doc.createDocumentFragment();
    if (from) out.append(node.data.slice(0, from));
    for (let i = 0; i < mine.length;) {
      let j = i + 1;
      while (j < mine.length && mine[j].pos === mine[i].pos && !!mine[j].italic === !!mine[i].italic) j++;
      let piece: Node = doc.createTextNode(node.data.slice(from + i, from + j));
      if (mine[i].pos !== 'base') { const w = doc.createElement(mine[i].pos); w.append(piece); piece = w; }
      if (mine[i].italic && !italicAlready) { const w = doc.createElement('i'); w.append(piece); piece = w; }
      out.append(piece);
      const p = piece;
      if (!i) start ??= () => range.setStartBefore(p);
      end = () => range.setEndAfter(p);
      i = j;
    }
    if (to < node.length) out.append(node.data.slice(to));
    node.replaceWith(out);
    changed = true;
  }
  start?.();
  end?.();
  return changed;
}
