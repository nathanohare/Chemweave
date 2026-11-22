// The header line every molfile written here carries (kept apart so 3-D and quantum-chemistry
// molfiles can use it without the whole molfile writer).

/** The program line (line 2) of a molfile written here: the program name, then the dimension code in columns 21–22. */
export function molProgramLine(dim: '2D' | '3D' = '2D'): string {
  // BIOVIA CTfile Formats (2020), header block line 2: IIPPPPPPPPMMDDYYHHmmddSS…, user's initials (2),
  // program name (8), date and time (10), dimensional code (2). "Chemweave" is nine letters, so its last
  // letter sits in the date's first column, as "ChemIllus" did; readers take only the dimension code
  // (RDKit, Open Babel and CDK read columns 21–22), which stays where the format puts it.
  return `  Chemweave         ${dim}`;
}
