// The choices under Paste ▾ on the Canvas, Presentation and Design Home tabs, as Office's paste
// options (Document and Spreadsheet have their own, in doc-mode.ts and sheet-mode.ts).
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
