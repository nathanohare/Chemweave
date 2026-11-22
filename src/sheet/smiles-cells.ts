// SMILES typed or pasted into a spreadsheet cell is drawn there as the structure (its SMILES
// shows in the formula bar, as for a structure drawn in the cell). Settings ▸ Preferences ▸
// Spreadsheets turns it off; Undo straight after puts the text back.

import { looksLikeSmiles } from '../kb/tables';

/** The choice in Settings ▸ Preferences (set by the program when settings load or change). */
export const smilesPrefs: { draw: boolean } = { draw: true };

/**
 * Is this cell text worth reading as SMILES? Only text with ring numbers, bonds or brackets
 * (COc1ccccc1, C=O, OB(O)c1ccccc1); words, numbers, formulas such as K2CO3 and compound codes
 * such as 1a pass this test only when they are also valid SMILES, which is checked after.
 */
export function smilesCandidate(text: string): boolean {
  const t = text.trim();
  return smilesPrefs.draw && t.length > 1 && !t.startsWith('=') && !t.startsWith("'") && looksLikeSmiles(t);
}
