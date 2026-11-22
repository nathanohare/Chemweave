// A field's name on screen with chemistry typography (S27; retrospective audit G5-20).

/** A field's name as shown on its page, with chemistry typography: Rf as R with a subscript f (Unicode has no subscript f). */
export function fieldLabelNodes(label: string): Node[] {
  const out: Node[] = [];
  let at = 0;
  for (const m of label.matchAll(/\bRf\b/g)) {
    if (m.index! > at) out.push(document.createTextNode(label.slice(at, m.index)));
    const sub = document.createElement('sub');
    sub.textContent = 'f';
    out.push(document.createTextNode('R'), sub);
    at = m.index! + 2;
  }
  if (at < label.length || !out.length) out.push(document.createTextNode(label.slice(at)));
  return out;
}
