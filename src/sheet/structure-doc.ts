// A structure in a cell as a drawing of its own: for drawing its picture, editing it, and
// writing it as a molfile for the chemistry engine.

import { Doc, Contents } from '../model';
import type { DocStyle } from '../style';
import { toMolfile } from '../chem/molfile';

/** A document holding a cell's drawing (new things drawn in it get ids of their own). */
export function structureDoc(contents: Contents, style: DocStyle): Doc {
  const d = new Doc();
  d.style = { ...style };
  d.restoreContents(contents);
  let max = 0;
  for (const list of [contents.atoms, contents.bonds, contents.captions, contents.arrows, contents.shapes]) {
    for (const x of list) if (x.id > max) max = x.id;
  }
  d.reserveIds(max);
  return d;
}

/**
 * A fingerprint of a cell's drawing: everything in it, places rounded to 0.01. The same drawing
 * gives the same text; any change to its chemistry, layout or marks gives another.
 */
export function structurePrint(c: Contents): string {
  // every field of every atom, bond, caption, arrow and shape (numbers to 0.01, keys in order), so
  // no change the molfile writer would carry (a map number, an attachment, a chiral flag) can pass
  // as "unchanged" and lose the edit (review F1-R05)
  const tidy = (v: unknown): unknown => {
    if (typeof v === 'number') return Math.round(v * 100) / 100;
    if (Array.isArray(v)) return v.map(tidy);
    if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined).map((k) => [k, tidy((v as Record<string, unknown>)[k])]));
    return v;
  };
  return JSON.stringify(tidy([c.atoms, c.bonds, c.captions, c.arrows, c.shapes]));
}

/** Nothing drawn at all. */
export function isBlankDrawing(c: Contents): boolean {
  return !c.atoms.length && !c.captions.length && !c.arrows.length && !c.shapes.length;
}

/** A cell's drawing as one molfile (all its molecules together), or why it can't be. */
export function structureMolfile(contents: Contents, style: DocStyle, opts: { attachKinds?: boolean } = {}): { molblock: string | null; problem?: string } {
  if (!contents.atoms.length) return { molblock: null, problem: 'There is no structure in this cell' };
  const d = structureDoc(contents, style);
  const m = toMolfile(d, d.atoms.keys(), '', opts.attachKinds ? { attachKinds: true } : {});
  if (m.unknownLabels.length) return { molblock: null, problem: `Can't read the label${m.unknownLabels.length > 1 ? 's' : ''} ${m.unknownLabels.join(', ')}` };
  return { molblock: m.molblock };
}
