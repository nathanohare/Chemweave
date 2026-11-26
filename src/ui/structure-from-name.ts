// Structure from Name or SMILES, as Document mode, Spreadsheet mode and SI projects ask for it:
// one window for a name, SMILES or CAS RN, read by the app's name reader (OPSIN on this computer;
// CAS RNs, trade names and abbreviations looked up on PubChem when Edit ▸ Settings allows), and
// the structure made from it in the drawing style given. What each mode does with the structure
// (in the text at the cursor, in a cell, as an SI figure or a compound's structure) is its own.

import type { Contents } from '../model';
import type { DocStyle } from '../style';
import { ask } from './ask';

/** The app's name reader: a structure for a name, SMILES or CAS RN, with the reader's notes, or why it couldn't be read. */
export type ToStructure = (text: string, style: DocStyle) => Promise<{ contents: Contents; notes: string[] } | { error: string }>;

export const STRUCTURE_FROM_NAME = 'Structure from Name or SMILES';

/**
 * Ask for a name, SMILES or CAS RN and make it a structure. `where` says where it goes (a
 * sentence); `closed`, called when the window closes, says whether to go on (the file shown is
 * still the one asked for). Null when cancelled, or when the text couldn't be read (said, with
 * `flash`, for `ms`: 8 s unless given). The reader's notes on what it read come with the
 * structure, for the caller to say once the structure is in (never when putting it in failed).
 */
export async function askStructureFromName(o: {
  toStructure: ToStructure;
  style: DocStyle;
  flash(msg: string, ms?: number): void;
  ok: string;
  where: string;
  closed?: () => boolean;
  ms?: number;
}): Promise<{ contents: Contents; notes: string[] } | null> {
  const got = await ask(STRUCTURE_FROM_NAME, [{ name: 'text', label: 'Name, SMILES or CAS RN', value: '' }], {
    ok: o.ok, note: `A systematic or common name (ethyl acetate, 4-bromoanisole), a SMILES string or a CAS RN (50-78-2). ${o.where}`,
  });
  if (o.closed && !o.closed()) return null;
  const text = got?.text.trim();
  if (!text) return null;
  const r = await o.toStructure(text, o.style);
  if ('error' in r) { o.flash(r.error, o.ms ?? 8000); return null; }
  return r;
}
