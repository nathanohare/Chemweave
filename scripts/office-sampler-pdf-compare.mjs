// Compares the Office samplers' PDFs page by page, by the item ids on each page (docs/developers.md,
// "The Office samplers"): node scripts/office-sampler-pdf-compare.mjs <folder>
// For each sampler it compares Office's PDF of the sampler (pdf/office/<name>.pdf) with
//   reads:      Chemweave's PDF of the sampler (pdf/chemweave/<name>.pdf)
//   writes:     Office's PDF of Chemweave's save (pdf/office/chemweave-saved/<name>.pdf)
//   roundtrip:  Office's PDF of Chemweave's save of Office's copy (pdf/office/office-then-chemweave/<name>.pdf)
// and lists, per comparison, the page counts and every item id that is missing, added, or on a
// different page. Writes <folder>/pdf-compare.json and prints a summary. Only reads the PDFs.
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const folder = process.argv[2];
if (!folder || !existsSync(join(folder, 'pdf', 'office'))) { console.error('Usage: node scripts/office-sampler-pdf-compare.mjs <folder> (after scripts/office-sampler-compare.ps1)'); process.exit(2); }

const ID = /\b[WPX]-[A-Z0-9]{2,4}-\d{2,3}\b/g;
/** Each page's item ids and text. */
async function pages(file) {
  const d = await getDocument({ data: new Uint8Array(readFileSync(file)), verbosity: 0 }).promise;
  const out = [];
  for (let p = 1; p <= d.numPages; p++) {
    const text = (await (await d.getPage(p)).getTextContent()).items.map((i) => i.str).join(' ');
    out.push({ ids: [...new Set(text.match(ID) ?? [])], words: text.split(/\s+/).filter(Boolean).length });
  }
  return out;
}
function compare(a, b) {
  const where = (ps) => { const m = new Map(); ps.forEach((p, i) => p.ids.forEach((id) => { if (!m.has(id)) m.set(id, i + 1); })); return m; };
  const wa = where(a), wb = where(b);
  return {
    pages: [a.length, b.length],
    words: [a.reduce((s, p) => s + p.words, 0), b.reduce((s, p) => s + p.words, 0)],
    missing: [...wa.keys()].filter((id) => !wb.has(id)).sort(),
    added: [...wb.keys()].filter((id) => !wa.has(id)).sort(),
    moved: [...wa.keys()].filter((id) => wb.has(id) && wb.get(id) !== wa.get(id)).map((id) => `${id} p${wa.get(id)}→p${wb.get(id)}`),
  };
}

const KINDS = { reads: ['pdf', 'chemweave'], writes: ['pdf', 'office', 'chemweave-saved'], roundtrip: ['pdf', 'office', 'office-then-chemweave'] };
const result = {};
for (const f of readdirSync(join(folder, 'pdf', 'office')).filter((n) => n.endsWith('.pdf')).sort()) {
  const ref = await pages(join(folder, 'pdf', 'office', f));
  result[f] = { office: { pages: ref.length } };
  for (const [kind, dir] of Object.entries(KINDS)) {
    const other = join(folder, ...dir, f);
    if (!existsSync(other)) { result[f][kind] = null; continue; }
    try { result[f][kind] = compare(ref, await pages(other)); } catch (e) { result[f][kind] = { error: String(e) }; }
  }
  const line = Object.entries(KINDS).map(([k]) => { const r = result[f][k]; return !r ? `${k}: -` : r.error ? `${k}: ${r.error}` : `${k}: pages ${r.pages.join('/')}, missing ${r.missing.length}, added ${r.added.length}, moved ${r.moved.length}`; }).join('; ');
  console.log(`- ${f}: ${line}`);
}
writeFileSync(join(folder, 'pdf-compare.json'), JSON.stringify(result, null, 1));
