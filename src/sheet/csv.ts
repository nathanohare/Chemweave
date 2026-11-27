// Tables as text: CSV files, and the tab-separated text Excel puts on the clipboard. Quoting
// follows RFC 4180 as Excel writes it: a field with a separator, a quote or a line break in it
// is put in double quotes, with its quotes doubled.

/** Split text into rows of fields. `sep` 'auto' looks at the first lines to choose tab, comma or semicolon. */
export function parseDelimited(text: string, sep: ',' | '\t' | ';' | 'auto' = 'auto'): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const s = sep === 'auto' ? detectSeparator(text) : sep;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field === '') { quoted = true; i++; continue; }
    if (ch === s) { row.push(field); field = ''; i++; continue; }
    if (ch === '\r' || ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += ch === '\r' && text[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    field += ch;
    i++;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/**
 * The separator a table of text most likely uses: tab, then semicolon or comma. Semicolon wins when
 * every line has the same number of them (outside quotes), as in a European file whose numbers use
 * decimal commas (1,5;2,5), where commas can outnumber the semicolons; otherwise the more common one.
 */
export function detectSeparator(text: string): ',' | '\t' | ';' {
  const head = text.slice(0, 20000);
  let tabs = 0, commas = 0, semis = 0, quoted = false;
  // Semicolons on each line, outside quotes; a line cut off at the end of the head is left out.
  const perLine: number[] = [];
  let lineSemis = 0, lineHasText = false;
  for (const ch of head) {
    if (ch === '"') { quoted = !quoted; lineHasText = true; }
    else if (!quoted && (ch === '\n' || ch === '\r')) {
      if (lineHasText) perLine.push(lineSemis);
      lineSemis = 0;
      lineHasText = false;
    } else {
      lineHasText = true;
      if (!quoted) {
        if (ch === '\t') tabs++;
        else if (ch === ',') commas++;
        else if (ch === ';') { semis++; lineSemis++; }
      }
    }
  }
  if (lineHasText && head.length === text.length) perLine.push(lineSemis);
  if (tabs) return '\t';
  if (perLine.length >= 2 && perLine[0] > 0 && perLine.every((n) => n === perLine[0])) return ';';
  return semis > commas ? ';' : ',';
}

/** Rows of fields as text, quoting where needed; lines end with CR LF, as Excel's do. */
export function toDelimited(rows: string[][], sep: ',' | '\t' | ';' = ','): string {
  const quote = (f: string) => (f.includes(sep) || f.includes('"') || f.includes('\n') || f.includes('\r') || (sep !== '\t' && /^\s|\s$/.test(f)) ? `"${f.replace(/"/g, '""')}"` : f);
  return rows.map((r) => r.map(quote).join(sep)).join('\r\n') + (rows.length ? '\r\n' : '');
}
