// Fast walks over a parsed XML tree. Live DOM collections (getElementsByTagName, children)
// can be slow on large files in some XML engines, so these build plain arrays once.

/** Element children of `e`, in order. */
export function kids(e: Element): Element[] {
  const out: Element[] = [];
  for (let c = e.firstElementChild; c; c = c.nextElementSibling) out.push(c);
  return out;
}

/** Every element below `root`, in document order (the same order as getElementsByTagName('*')). */
export function descendants(root: Element): Element[] {
  const out: Element[] = [];
  const visit = (e: Element) => {
    for (let c = e.firstElementChild; c; c = c.nextElementSibling) {
      out.push(c);
      visit(c);
    }
  };
  visit(root);
  return out;
}

/** Text with each lone half of a surrogate pair (left when text is cut inside an emoji, or pasted
 * from some PDFs) made U+FFFD: XML can't hold one, and the desktop app's JSON reader refuses one. */
export function wellFormed(text: string): string {
  return text.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]/g, (c) => (c.length === 2 ? c : '\uFFFD'));
}

/**
 * XML text without its DOCTYPE, internal subset included, so a file can neither fetch a DTD
 * nor declare entities that swell into a huge text. A DOCTYPE that can't be cut out cleanly
 * (so might still declare something) is refused.
 */
export function withoutDoctype(text: string): string {
  const refuse = () => new Error('This file declares XML entities, which are not allowed.');
  // A scan by hand, each character looked at once: a regular expression for the internal subset
  // backtracked over the rest of the text at every unclosed "<!DOCTYPE[", so a crafted file froze
  // the app before it was refused (review F626).
  const lower = text.toLowerCase();
  const parts: string[] = [];
  let from = 0;
  for (let at = lower.indexOf('<!doctype'); at >= 0; at = lower.indexOf('<!doctype', from)) {
    parts.push(text.slice(from, at));
    let i = at + 9, inSubset = false, end = -1;
    while (i < text.length) {
      const c = text[i];
      if (inSubset) {
        if (c === ']') inSubset = false;
        else if (c === '"' || c === "'") { const q = text.indexOf(c, i + 1); if (q < 0) throw refuse(); i = q; }
      } else if (c === '[') inSubset = true;
      else if (c === '>') { end = i; break; }
      i++;
    }
    if (end < 0) throw refuse();
    from = end + 1;
  }
  parts.push(text.slice(from));
  const out = parts.join('');
  if (/<!(?:DOCTYPE|ENTITY)/i.test(out)) throw refuse();
  return out;
}
