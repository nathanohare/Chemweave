// Accessibility problems the check in scripts/a11y-check.mjs (standing rule R10) found when it was
// added, not fixed yet: the exact lines it prints. It fails only on a problem not listed here. Take
// a line off when it is fixed (the check lists the ones that no longer happen). Rewrite the whole
// list only with `A11Y_URL=… node scripts/a11y-check.mjs --write`, and only to drop fixed lines or
// to take in lines that changed name with a merge, never to let a new problem through. Every line
// listed when the check was added was fixed on 2026-11-22, and the list is empty: keep it so.
export const KNOWN_A11Y = [
];
