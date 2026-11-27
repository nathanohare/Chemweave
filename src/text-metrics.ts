// Character widths of Arial (the same as Helvetica), in thousandths of the font size, for
// printable ASCII and a few common symbols. ChemDraw measures labels with these, so files we
// write place text the same way on any computer, whether or not Arial is installed. Pictures
// for Word and PowerPoint use them too, since those programs draw the text in Arial.

const W = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, // space ! " # $ % & ' ( ) * + , - . /
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, // 0-9 : ; < = > ?
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, // @ A-O
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, // P-Z [ \ ] ^ _
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, // ` a-o
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584, // p-z { | } ~
];

// Arial Bold (Helvetica-Bold)
const B = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

// Symbols outside ASCII: [regular, bold]
const EXTRA: Record<string, [number, number]> = {
  '°': [400, 400], '±': [584, 584], '×': [584, 584], '·': [278, 278], '•': [350, 350], '−': [584, 584],
  '–': [556, 556], '—': [1000, 1000], '‘': [222, 278], '’': [222, 278], '“': [333, 500], '”': [333, 500],
  'µ': [556, 611], 'μ': [556, 611], '…': [1000, 1000], '‰': [1000, 1000],
  '\u2002': [500, 500],
  // the symbols of the text bar (Insert Symbol row) and the other spaces: widths as Liberation Sans, which has
  // Arial's metrics for these (its hmtx table, regular and bold), checked against Adobe's Symbol font metrics
  // for the maths signs (549 for ≤ ≥ ≠ ≈ ÷, 713 for ∞); a no-break space is a space
  '\u00A0': [278, 278], '\u2000': [500, 500], '\u2001': [1000, 1000], '\u2003': [1000, 1000], '\u2004': [333, 333],
  '\u2005': [250, 250], '\u2006': [167, 167], '\u2007': [556, 556], '\u2008': [278, 278], '\u2009': [200, 200],
  '\u200A': [83, 83], '\u202F': [200, 200],
  '′': [188, 240], '″': [354, 479], '→': [1000, 1000], '←': [1000, 1000], '↔': [1000, 1000], '↑': [500, 500], '↓': [500, 500],
  '≤': [549, 549], '≥': [549, 549], '≠': [549, 549], '≈': [549, 549], '≡': [583, 583], '∞': [713, 713], '÷': [549, 549],
  '†': [556, 556], '‡': [556, 556],
  // Greek letters (Liberation Sans, as above)
  'Α': [667, 722], 'Β': [667, 722], 'Γ': [551, 601], 'Δ': [668, 719], 'Ε': [667, 667], 'Ζ': [611, 611],
  'Η': [722, 722], 'Θ': [778, 778], 'Ι': [278, 278], 'Κ': [667, 722], 'Λ': [668, 667], 'Μ': [833, 833],
  'Ν': [722, 722], 'Ξ': [650, 644], 'Ο': [778, 778], 'Π': [722, 722], 'Ρ': [667, 667], 'Σ': [618, 600],
  'Τ': [611, 611], 'Υ': [667, 667], 'Φ': [798, 821], 'Χ': [667, 667], 'Ψ': [835, 809], 'Ω': [748, 802],
  'α': [578, 615], 'β': [575, 610], 'γ': [500, 556], 'δ': [557, 606], 'ε': [446, 475], 'ζ': [441, 460],
  'η': [556, 611], 'θ': [556, 541], 'ι': [222, 278], 'κ': [500, 558], 'λ': [500, 556],
  'ν': [500, 556], 'ξ': [448, 445], 'ο': [556, 611], 'π': [690, 766], 'ρ': [569, 619], 'ς': [482, 520],
  'σ': [617, 684], 'τ': [395, 446], 'υ': [547, 582], 'φ': [648, 715], 'χ': [525, 576], 'ψ': [713, 753],
  'ω': [781, 845],
};

// Marks and characters with no width of their own: combining marks (a decomposed é is e and U+0301),
// zero-width and other format characters (zero-width space and joiners, the soft hyphen, the byte order
// mark) and control characters (tab, line breaks)
const NO_WIDTH = /^[\p{M}\p{Cf}\p{Cc}]$/u;

function charWidth(ch: string, bold: boolean): number {
  const t = bold ? B : W;
  const c = ch.codePointAt(0)! - 32;
  if (c >= 0 && c < t.length) return t[c];
  const e = EXTRA[ch];
  if (e) return e[bold ? 1 : 0];
  if (NO_WIDTH.test(ch)) return 0;
  // accented letters are as wide as the plain letter (é as e)
  const base = ch.normalize('NFD').codePointAt(0)! - 32;
  if (base >= 0 && base < t.length) return t[base];
  return bold ? 611 : 556;
}

/** Width of `text` in Arial at `size` points. Unknown characters count as an average letter. */
export function arialWidth(text: string, size: number, bold = false): number {
  let w = 0;
  for (const ch of text) w += charWidth(ch, bold);
  return (w / 1000) * size;
}
