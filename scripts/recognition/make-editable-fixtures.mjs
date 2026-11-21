// Test pictures for Make Editable (tests/make-editable.test.ts): structures drawn by the app in
// known styles and saved as PNGs, with where each atom is in the picture and what a reader would
// read (elements, bonds), so the measuring can be checked against the truth.
// Run with the development server going (npm run dev): node scripts/recognition/make-editable-fixtures.mjs

import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const out = new URL('../../tests/fixtures/make-editable/', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const CASES = [
  { name: 'acs-300dpi', smiles: 'CC(=O)N[C@@H](Cc1ccc(O)cc1)C(=O)OC', dpi: 300, style: {} },
  { name: 'acs-96dpi', smiles: 'CC(=O)N[C@@H](Cc1ccc(O)cc1)C(=O)OC', dpi: 96, style: {} },
  { name: 'heavy-150dpi', smiles: 'O=C1CCC(N1)C(=O)NCc1ccccc1', dpi: 150, style: { bondLength: 20, lineWidth: 1.1, boldWidth: 3, hashSpacing: 3, marginWidth: 2.4, labelSize: 14, labelFont: 'Helvetica' } },
];

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
for (const c of CASES) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  await page.goto('http://localhost:5173/');
  await page.waitForFunction(() => window.__app?.chem?.ready, null, { timeout: 60000 });
  const got = await page.evaluate(async (c) => {
    const a = window.__app;
    Object.assign(a.doc.style, c.style);
    await a.pasteChemistry(c.smiles);
    const p = a.picture(c.dpi);
    const k = p.dpi / 72;
    const atoms = [...a.doc.atoms.values()];
    const index = new Map(atoms.map((x, i) => [x.id, i]));
    const SYM = { 6: 'C', 7: 'N', 8: 'O', 9: 'F', 16: 'S', 17: 'Cl', 35: 'Br' };
    const edges = atoms.map(() => atoms.map(() => 0));
    for (const b of a.doc.bonds.values()) {
      const i = index.get(b.a1), j = index.get(b.a2);
      const t = b.display === 'wedge' ? 5 : b.display === 'hashWedge' ? 6 : b.order;
      edges[i][j] = t; edges[j][i] = t === 5 || t === 6 ? t : t;
    }
    return {
      png: p.url, dpi: p.dpi, style: { ...a.doc.style },
      symbols: atoms.map((x) => (x.charge ? `[${SYM[x.z]}${x.charge > 0 ? '+' : '-'}]` : SYM[x.z] ?? 'C')),
      truth: atoms.map((x) => [(x.x - p.box.x1) * k, (x.y - p.box.y1) * k]),
      edges,
    };
  }, c);
  writeFileSync(`${out}${c.name}.png`, Buffer.from(got.png.split(',')[1], 'base64'));
  const { png, ...rest } = got;
  writeFileSync(`${out}${c.name}.json`, JSON.stringify({ ...rest, truth: rest.truth.map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]) }));
  console.log(c.name, got.dpi);
  await page.close();
}
await browser.close();
