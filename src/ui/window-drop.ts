// Files dropped and clipboards pasted on the window: what the window's own listeners do with them,
// once the parts of the page that take drops and pastes themselves have had theirs.

/** Drops whose files a part of the page took (the SI Project's report boxes, manuscript and attachments). */
const taken = new WeakSet<Event>();

/**
 * A drop zone that used the files of this drop says so, so the window doesn't open or place them
 * as well. (Not `preventDefault()` alone: many parts of the page cancel every drop on them, files
 * or not, and the window must still take those files.)
 */
export function markFilesTaken(e: Event): void {
  taken.add(e);
}

/** Did a drop zone take this drop's files? */
export const filesTaken = (e: Event): boolean => taken.has(e);

/** Files that open in a tab of their own, whatever is in them (never placed as a picture). */
const OPENS_AS_FILE = /\.(cdxml|cdx|cds|mol|mdl|rxn|mrv|ket|cml|json|pptx|xlsx|xlsm|xls|ods|docx|csv|tsv|txt|sdf?)$/i;

/** Could this file be placed as a picture (going by its name; its bytes decide after)? */
export const mayBePicture = (name: string): boolean => !OPENS_AS_FILE.test(name);

/** What shows where a file is dropped. */
export type DropPlace = 'sheet' | 'document' | 'si' | 'drawing';

/**
 * What the window does with one dropped file: a crystal structure goes to the crystal window, a
 * picture on the drawing, slide or page (not in a cell yet, and not on the drawing hidden behind
 * the SI Project), anything else opens in a tab.
 */
export function fileDropAction(name: string, picture: boolean, where: DropPlace): 'crystal' | 'open' | 'picture' | 'doc-picture' | 'no-cell-picture' | 'not-in-si' {
  if (/\.cif$/i.test(name) && where !== 'sheet' && where !== 'document') return where === 'si' ? 'not-in-si' : 'crystal';
  if (!picture) return 'open';
  if (where === 'sheet') return 'no-cell-picture';
  if (where === 'document') return 'doc-picture';
  if (where === 'si') return 'not-in-si';
  return 'picture';
}

/**
 * Who a paste on the window is for: nobody when it went into a text box or a window, or a part
 * of the page (the SI Project's boxes) pasted it already, or the SI Project is showing (it pastes
 * for itself, never into the drawing behind it); else the spreadsheet, the document or the drawing.
 */
export function pasteTarget(o: { typing: boolean; inDialog: boolean; taken: boolean; si: boolean; sheet: boolean; document: boolean }): 'none' | 'sheet' | 'document' | 'drawing' {
  if (o.typing || o.inDialog || o.taken || o.si) return 'none';
  return o.sheet ? 'sheet' : o.document ? 'document' : 'drawing';
}
