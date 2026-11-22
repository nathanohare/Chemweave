// Problems in user-visible text that were in Chemweave when scripts/lint-ui-text.mjs was added
// (2026-11-22; widened the same day to every string with words in it). Each is a real problem
// against docs/ui-style.md, listed one by one (file, the word found, the whole string) so the
// check can run on every pull request while they are fixed. Fix the text and delete its line (or
// run node scripts/lint-ui-text.mjs --prune); the test fails while a fixed line is still here.
// Never add a line for new text: fix the text, or for a deliberate exception add it to ALLOWED in
// lint-ui-text.mjs with the reason. --write re-records the whole list; use it only after merging
// branches that each changed UI text, and check the diff adds nothing new. Every listed problem
// was fixed on 2026-11-22 and the list is empty: keep it so.
export const KNOWN_UI_TEXT = [
];
