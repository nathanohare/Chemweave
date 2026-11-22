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

// A picture of a scheme: two structures, an arrow with conditions over and under it, and compound
// numbers. Truth for each structure (its atoms in the picture), and the text that should be left.
const SCHEME = { name: 'scheme-150dpi', rxn: 'CC(=O)N[C@@H](Cc1ccc(O)cc1)C(=O)OC>>CC(=O)N[C@@H](Cc1ccc(O)cc1)C(=O)O', dpi: 150 };
{
  const browser2 = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const page = await browser2.newPage({ viewport: { width: 1200, height: 800 } });
  await page.goto('http://localhost:5173/');
  await page.waitForFunction(() => window.__app?.chem?.ready, null, { timeout: 60000 });
  const got = await page.evaluate(async (c) => {
    const a = window.__app;
    await a.pasteChemistry(c.rxn);
    const ar = [...a.doc.arrows.values()][0];
    const mid = (ar.tail.x + ar.head.x) / 2, y = ar.tail.y;
    const runs = (text, more = {}) => [{ text, size: 10, font: 'Arial', ...more }];
    // a centred caption's x is the left of its line, so measure it and put its middle at cx
    const centred = (cx, cy, r) => {
      const c = a.doc.addCaption({ x: cx, y: cy, runs: r, justify: 'center' });
      const b = a.renderer.captionBox(c);
      a.doc.removeCaption(c.id);
      a.doc.addCaption({ x: cx - (b.x2 - b.x1) / 2, y: cy, runs: r, justify: 'center' });
    };
    a.doc.edit('Scheme', () => {
      centred(mid, y - 5, runs('LiOH'));
      centred(mid, y + 13, runs('THF, 23 °C'));
    });
    // the two structures (atoms joined by bonds)
    const atoms = [...a.doc.atoms.values()];
    const group = new Map(atoms.map((x) => [x.id, x.id]));
    const find = (i) => (group.get(i) === i ? i : find(group.get(i)));
    for (const b of a.doc.bonds.values()) group.set(find(b.a1), find(b.a2));
    const sets = [...new Set(atoms.map((x) => find(x.id)))].map((r) => atoms.filter((x) => find(x.id) === r));
    sets.sort((s, t) => Math.min(...s.map((x) => x.x)) - Math.min(...t.map((x) => x.x)));
    a.doc.edit('Numbers', () => {
      sets.forEach((s, i) => {
        const xs = s.map((x) => x.x), ys = s.map((x) => x.y);
        centred((Math.min(...xs) + Math.max(...xs)) / 2, Math.max(...ys) + 22, runs(String(i + 1), { bold: true }));
      });
    });
    const p = a.picture(c.dpi);
    const k = p.dpi / 72;
    const SYM = { 6: 'C', 7: 'N', 8: 'O' };
    const structures = sets.map((s) => {
      const index = new Map(s.map((x, i) => [x.id, i]));
      const edges = s.map(() => s.map(() => 0));
      for (const b of a.doc.bonds.values()) {
        if (!index.has(b.a1)) continue;
        const i = index.get(b.a1), j = index.get(b.a2);
        const t = b.display === 'wedge' ? 5 : b.display === 'hashWedge' ? 6 : b.order;
        edges[i][j] = t; edges[j][i] = t;
      }
      return { symbols: s.map((x) => SYM[x.z] ?? 'C'), truth: s.map((x) => [Math.round((x.x - p.box.x1) * k * 100) / 100, Math.round((x.y - p.box.y1) * k * 100) / 100]), edges };
    });
    return { png: p.url, dpi: p.dpi, style: { ...a.doc.style }, structures, arrow: { x1: (ar.tail.x - p.box.x1) * k, x2: (ar.head.x - p.box.x1) * k, y: (y - p.box.y1) * k } };
  }, SCHEME);
  writeFileSync(`${out}${SCHEME.name}.png`, Buffer.from(got.png.split(',')[1], 'base64'));
  const { png, ...rest } = got;
  writeFileSync(`${out}${SCHEME.name}.json`, JSON.stringify(rest));
  console.log(SCHEME.name, got.dpi);
  await browser2.close();
}
