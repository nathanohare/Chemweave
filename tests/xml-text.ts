// Plain-text lookups in saved Office XML for tests, by a name or id, without building a regular
// expression from it (tests/regex-from-data-lint.test.ts).

/** The whole <w:style> element with this styleId ('' if none), optionally only of this w:type. */
export function styleXml(xml: string, id: string, type?: string): string {
  const at = xml.indexOf(`w:styleId="${id}"`);
  if (at < 0) return '';
  const start = xml.lastIndexOf('<w:style ', at);
  const end = xml.indexOf('</w:style>', at);
  if (start < 0 || end < 0) return '';
  const el = xml.slice(start, end + '</w:style>'.length);
  if (type !== undefined && !el.slice(0, el.indexOf('>')).includes(`w:type="${type}"`)) return '';
  return el;
}

/** The w:val of the first <w:name w:val="..."> element. */
export function valOf(xml: string, name: string): string | undefined {
  const key = `<w:${name} w:val="`;
  const at = xml.indexOf(key);
  if (at < 0) return undefined;
  const s = at + key.length;
  return xml.slice(s, xml.indexOf('"', s));
}

/** The kern size of the first run whose own rPr has a kern and whose text is exactly this. */
export function kernOf(doc: string, text: string): string | undefined {
  for (let i = doc.indexOf('<w:r>'); i >= 0; i = doc.indexOf('<w:r>', i + 1)) {
    const run = doc.slice(i, doc.indexOf('</w:r>', i));
    if (!run.startsWith('<w:r><w:rPr>') || !run.includes(`>${text}</w:t>`)) continue;
    const kern = valOf(run.slice(0, run.indexOf('</w:rPr>')), 'kern');
    if (kern !== undefined) return kern;
  }
  return undefined;
}

/** The inside of the first <a:tcPr> after the cell text <a:t>text</a:t>. */
export function cellPrAfter(xml: string, text: string): string {
  const t = xml.indexOf(`<a:t>${text}</a:t>`);
  if (t < 0) throw new Error(`no cell text ${text}`);
  const open = xml.indexOf('<a:tcPr', t);
  const gt = xml.indexOf('>', open);
  const end = xml.indexOf('</a:tcPr>', gt);
  if (open < 0 || end < 0) throw new Error(`no tcPr after ${text}`);
  return xml.slice(gt + 1, end);
}
