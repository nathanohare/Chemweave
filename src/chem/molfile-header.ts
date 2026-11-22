// The header line every molfile written here carries (kept apart so 3-D and quantum-chemistry
// molfiles can use it without the whole molfile writer).

/** The program line (line 2) of a molfile written here: the program name, then the dimension code in columns 21–22. */
export function molProgramLine(dim: '2D' | '3D' = '2D'): string {
  // BIOVIA CTfile Formats (2020), header block line 2: IIPPPPPPPPMMDDYYHHmmddSS…, user's initials (2),
  // program name (8), date and time (10), dimensional code (2). The program name field holds eight
  // characters, so "Chemweave" is written as "Chemweav": every field stays in its own columns (a
  // reader that parses the date strictly finds blanks there, not a letter).
  return `  Chemweav          ${dim}`;
}
