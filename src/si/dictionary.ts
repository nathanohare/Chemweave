// The project's dictionary: dictionary.txt in the project folder, one word per line, shared
// with co-authors and with Chem SI Assistant (its core/spelling.py reads and writes it the same
// way). Its words are spelled right in the project's text boxes, and are printed as written:
// the formatting check, and compiling, leave them alone ("Leave “CDK2” as written").
// Lines starting with "#" are comments, kept when a word is added; capitals don't matter.

import type { SiFolder } from './folder';

export const DICTIONARY_FILE = 'dictionary.txt';

const isWord = (line: string): boolean => !!line.trim() && !line.trimStart().startsWith('#');
const lines = (text: string): string[] => text.replace(/\r\n?/g, '\n').split('\n');

/** The file's words, as written (a missing or unreadable file has none: it never stops anything). */
export async function dictionaryWords(folder: SiFolder): Promise<string[]> {
  const text = await folder.readText(DICTIONARY_FILE).catch(() => null);
  return text ? lines(text).filter(isWord).map((l) => l.trim()) : [];
}

/** The text of the file with `word` added in alphabetical order among the words (null when it is there already, in any capitals). */
export function withWord(text: string, word: string): string | null {
  const w = word.trim();
  const ls = lines(text).map((l) => l.trimEnd());
  while (ls.length && !ls[ls.length - 1]) ls.pop();
  if (!w || ls.some((l) => isWord(l) && l.trim().toLowerCase() === w.toLowerCase())) return null;
  const fold = w.toLowerCase();
  let at = ls.findIndex((l) => isWord(l) && l.trim().toLowerCase() > fold);
  if (at < 0) at = ls.length;
  ls.splice(at, 0, w);
  return ls.join('\n') + '\n';
}

/** Add a word to the project's dictionary; false when it was there already. */
export async function addDictionaryWord(folder: SiFolder, word: string): Promise<boolean> {
  // (a file that is there but can't be read is never written over)
  const text = (await folder.exists(DICTIONARY_FILE)) ? await folder.readText(DICTIONARY_FILE) : '';
  if (text === null) throw new Error(`${DICTIONARY_FILE} could not be read.`);
  const next = withWord(text, word);
  if (next === null) return false;
  await folder.writeText(DICTIONARY_FILE, next);
  return true;
}
