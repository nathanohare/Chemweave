// The Diagram window's text as rows of rich text boxes (one item each, with its level), as
// SmartArt's text pane has them, and back to the diagram's text and the looks of its items
// (DiagramData.rich), keyed by the item's line number and kept only while they spell its words.

import { chemRuns } from '../text/chemtext';
import { labelFromParts, labelParts, type LabelPart } from './energy';
import { lineParts, type DiagramData } from './diagrams';

/** One row of the window: how far down the outline it is, its words (an icon in [ ] in front kept as typed), and their pieces when they hold looks. */
export interface DiagramRow { level: number; label: string; rich?: LabelPart[] }

const plain = (ps: { text: string }[]) => ps.map((p) => p.text).join('');

/** Pieces from character `a` to `b` of their text. */
export function sliceParts(parts: LabelPart[], a: number, b: number): LabelPart[] {
  const out: LabelPart[] = [];
  let at = 0;
  for (const p of parts) {
    const s = Math.max(a, at), e = Math.min(b, at + p.text.length);
    if (e > s) out.push({ ...p, text: p.text.slice(s - at, e - at) });
    at += p.text.length;
  }
  return out;
}

/** Where an item's words sit in its row's shown text (after an icon or bullet typed in front). */
function wordsAt(rowLabel: string): { from: number; to: number } | null {
  const words = lineParts(rowLabel).text;
  if (!words) return null;
  const shown = plain(chemRuns(rowLabel)), w = plain(chemRuns(words));
  const from = shown.lastIndexOf(w);
  return from < 0 ? null : { from, to: from + w.length };
}

/** The rows for a diagram's text and its items' looks. */
export function rowsOf(d: Pick<DiagramData, 'text' | 'rich'>): DiagramRow[] {
  const rows: DiagramRow[] = [];
  let n = 0;
  for (const line of d.text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    n++;
    const lead = /^[\t ]*/.exec(line)![0];
    let level = 0;
    for (const ch of lead) level += ch === '\t' ? 1 : 0.5;
    const label = line.slice(lead.length);
    const row: DiagramRow = { level: Math.floor(level + 1e-9), label };
    const r = d.rich?.[String(n)];
    const at = r?.length ? wordsAt(label) : null;
    if (r && at) {
      const all = chemRuns(label) as LabelPart[];
      const words = lineParts(label).text;
      if (labelParts(words, r) === r) {
        const parts = [...sliceParts(all, 0, at.from), ...r, ...sliceParts(all, at.to, plain(all).length)];
        if (labelParts(label, parts) === parts) row.rich = parts;
      }
    }
    rows.push(row);
  }
  return rows;
}

/** The diagram's text and its items' looks, from the rows. */
export function fromRows(rows: DiagramRow[]): { text: string; rich?: DiagramData['rich'] } {
  const lines: string[] = [];
  const rich: NonNullable<DiagramData['rich']> = {};
  let n = 0;
  for (const row of rows) {
    const line = '\t'.repeat(Math.max(0, row.level)) + row.label;
    if (!line.trim()) continue;
    lines.push(line);
    n++;
    if (!row.rich) continue;
    const at = wordsAt(row.label);
    if (!at) continue;
    const parts = sliceParts(row.rich, at.from, at.to);
    // the item's words alone, as the diagram reads them, with their pieces
    const words = lineParts(row.label).text;
    if (labelParts(words, parts) === parts && labelFromParts(parts).rich) rich[String(n)] = parts;
  }
  return { text: lines.join('\n'), ...(Object.keys(rich).length ? { rich } : {}) };
}
