// A spreadsheet cell's text as HTML, for copying cells to Word, PowerPoint, Excel or Document mode
// and for printing: what the grid shows, with the formatting on part of the text (a bold word,
// issue #503), the chemistry look (the numbers of CH2Cl2 lowered, charges raised, the n of n-BuLi
// in italics) and a whole cell raised, lowered or struck through as Excel's Format Cells has it.
// The pieces go through the same run writer as other copied text (text/html.ts runsHtml).

import type { TextRun as ModelRun } from '../model';
import type { CellStyle } from './workbook';
import { type TextRun, looksOf, lookPieces } from './rich-text';
import { runsHtml } from '../text/html';

/**
 * The cell's text as HTML when it needs more than the cell's own look (null: the text as it is,
 * with the look on the cell's <td>). `runs` are the cell's runs (when they still fit its text);
 * `chem` whether it shows as chemistry. When it isn't null, the <td> must not carry an underline
 * or strikethrough of its own (a line drawn on a cell runs under every piece, whatever the piece
 * says): each piece carries its own.
 */
export function cellTextHtml(text: string, st: CellStyle | undefined, runs: TextRun[] | undefined, chem: boolean): string | null {
  if (!text) return null;
  const whole = st?.excel?.vertAlign === 'superscript' ? 'sup' : st?.excel?.vertAlign === 'subscript' ? 'sub' : undefined;
  const pieces = lookPieces(text, { ...st, chem }, looksOf(text, runs));
  if (pieces.length === 1 && !pieces[0].look.pos && !whole && !runs) return null;
  const out: ModelRun[] = pieces.map(({ text: t, look }) => {
    const pos = look.pos ?? whole;
    const r: ModelRun = { text: t };
    // bold, italic, colour, font and size: only where they differ from the cell's (false turns the cell's off)
    if (!!look.bold !== !!st?.bold) r.bold = !!look.bold;
    if (!!look.italic !== !!st?.italic) r.italic = !!look.italic;
    if ((look.color ?? '') !== (st?.color ?? '')) r.color = look.color ?? '#000000';
    if (look.font && look.font !== st?.font) r.font = look.font;
    if (look.size && look.size !== st?.size) r.size = look.size;
    if (look.underline) r.underline = true;
    if (look.strike || st?.excel?.strike) r.strike = true;
    if (pos === 'sub') r.sub = true;
    else if (pos === 'sup') r.sup = true;
    return r;
  });
  return runsHtml(out, { font: null, defaultSize: null });
}
