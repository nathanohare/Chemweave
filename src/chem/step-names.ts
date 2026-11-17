// The names of a catalytic cycle's steps, in full and in their usual short forms.

/** Common step names, offered while typing one. */
export const STEP_NAMES = [
  'oxidative addition', 'reductive elimination', 'transmetalation', 'migratory insertion', 'β-hydride elimination',
  'ligand exchange', 'ligand dissociation', 'alkene coordination', 'deprotonation', 'protonation', 'single-electron transfer',
  'C–H activation (CMD)', '[2+2] cycloaddition', 'retro-[2+2]', 'σ-bond metathesis', 'hydroxypalladation', 'excitation',
];

const SHORT: Record<string, string> = {
  'oxidative addition': 'OA', 'reductive elimination': 'RE', transmetalation: 'TM', 'migratory insertion': 'MI',
  'β-hydride elimination': 'β-H', 'single-electron transfer': 'SET', 'ligand exchange': 'LE',
};
/** The usual short form of a step's name (OA for oxidative addition), or the name itself. */
export function shortName(name: string): string {
  return SHORT[name.trim().toLowerCase()] ?? name;
}


const FULL: Record<string, string> = Object.fromEntries(Object.entries(SHORT).map(([full, short]) => [short, full]));
/** The name a short form stands for (oxidative addition for OA), or the text itself. */
export function fullName(short: string): string {
  return FULL[short.trim()] ?? short;
}
