// Text typed or pasted as a structure: a molfile, or a SMILES string (one word, or a CXSMILES:
// the SMILES and its |…| extras). Anything else
// may be a name, which is read elsewhere (main.ts, nameToMolfile).

/** The molfile for a molfile or SMILES string, or null when the text is neither. */
export async function molfileOrSmiles(text: string, smilesToMol: (smiles: string) => Promise<string | null>): Promise<string | null> {
  // a molfile keeps its first lines (its name line may be blank), so it is not trimmed
  if (text.includes('M  END')) return text;
  const t = text.trim();
  // (a CXSMILES is the SMILES, a space and its |…| extras: enhanced stereo, coordinates)
  const cx = /^(\S+)\s+(\|[^|]*\|)$/.exec(t);
  if (cx) return smilesToMol(`${cx[1]} ${cx[2]}`).catch(() => null);
  if (!t || /\s/.test(t)) return null;
  return smilesToMol(t).catch(() => null);
}
