// The choices under Paste ▾ on the Canvas, Presentation and Design Home tabs, as Office's paste
// options (Document and the SI's Live Preview have Word's, wordPasteChoices below; Spreadsheet its own, in sheet-mode.ts).
// Presentation's are PowerPoint's as far as they apply here: Use Destination Theme (Paste until
// slides are copied) and Keep Source Formatting (slides copied keep their own background, fonts and colors) and Keep Text Only, then
// Paste SMILES. PowerPoint's Picture and Paste Special have no counterpart here yet.

/** One choice: its name, the command it runs ('paste-text-only': the words alone, as a text box), and whether it can run now. */
export interface PasteChoice { label: string; cmd: string; enabled: boolean }

/** The choices for a kind of tab; null is a separator. `slides`: slides have been copied. */
export function pasteChoices(mode: 'drawing' | 'slides' | 'design', slides = false): (PasteChoice | null)[] {
  const text: PasteChoice = { label: 'Keep Text Only', cmd: 'paste-text-only', enabled: true };
  const smiles: PasteChoice = { label: 'Paste SMILES', cmd: 'paste-smiles', enabled: true };
  if (mode === 'slides') {
    return [
      // (with no slides copied it is the plain Paste, and named so)
      slides ? { label: 'Use Destination Theme', cmd: 'paste-slides', enabled: true } : { label: 'Paste', cmd: 'paste', enabled: true },
      { label: 'Keep Source Formatting', cmd: 'paste-slides-keep', enabled: slides },
      text, null, smiles,
    ];
  }
  return [{ label: 'Paste', cmd: 'paste', enabled: true }, text, null, smiles];
}

/**
 * Word's paste options, for Document mode's Paste ▾ and the SI Project's: Keep Source Formatting,
 * Keep Text Only (Ctrl+Shift+V), then what else the place pasted into takes: an embedded object
 * (`object`: one is on the clipboard) and SMILES in a document; in an SI, Paste as Picture (a
 * figure from a copied picture or drawing; it says so when there is none, as the menu opens at
 * once without reading the clipboard).
 */
export function wordPasteChoices(mode: 'document' | 'si', has: { object?: boolean } = {}): (PasteChoice | null)[] {
  const keep: PasteChoice = { label: 'Keep Source Formatting', cmd: 'paste-keep', enabled: true };
  const text: PasteChoice = { label: 'Keep Text Only (Ctrl+Shift+V)', cmd: 'paste-text-only', enabled: true };
  if (mode === 'si') return [keep, text, null, { label: 'Paste as Picture', cmd: 'paste-picture', enabled: true }];
  return [keep, text, null, { label: 'Paste as Object', cmd: 'paste-object', enabled: !!has.object }, { label: 'Paste SMILES', cmd: 'paste-smiles', enabled: true }];
}
