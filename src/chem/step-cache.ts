// The reaction steps of a drawing, worked out once per change of the drawing (Doc.version), so
// the greyed-or-not state of Stoichiometry Table and Check Balance (S15, S85; retrospective audit
// G5-28) costs nothing when nothing has changed, however big the drawing is.

import type { Doc } from '../model';
import type { Measure } from '../editor/arrange';
import { reactionSteps, schemeItems, type Item } from './reaction';

export interface DocSteps {
  /** The Doc.version these were worked out for. */
  version: number;
  m: Measure;
  items: Item[];
  steps: ReturnType<typeof reactionSteps>;
}

export class StepCache {
  private byDoc = new WeakMap<Doc, DocSteps>();
  /** How many times the steps were worked out (for the tests). */
  computed = 0;

  /** True when the steps of `doc` as it is now are already known. */
  fresh(doc: Doc): boolean {
    return this.byDoc.get(doc)?.version === doc.version;
  }

  /** The steps of `doc` as it is now: kept from last time unless the drawing changed since. */
  get(doc: Doc, measure: () => Measure): DocSteps {
    const had = this.byDoc.get(doc);
    if (had && had.version === doc.version) return had;
    const m = measure();
    const items = schemeItems(doc, m);
    const got: DocSteps = { version: doc.version, m, items, steps: reactionSteps(doc, items) };
    this.computed++;
    this.byDoc.set(doc, got);
    return got;
  }
}
