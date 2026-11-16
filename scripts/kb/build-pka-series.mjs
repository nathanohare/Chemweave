// Which series each pKa Values row belongs to (src/kb/pka-series.json): substituted benzoic acids
// under "Benzoic acids", substituted pyridines under "Pyridines", and so on, so the Knowledge Base
// can fold each series under one heading (Nate's pick A, 2026-11-16).
//
// A compound joins the first series below whose parent structure it contains with the hydrogen the
// value belongs to on the parent's first atom (from src/kb/pka-acidic.json): 4-nitrobenzoic acid's
// CO2H makes it a benzoic acid, while 4-aminobenzoic acid's 2.4 in water (its NH3+) makes it an
// aniline. More specific parents come first. A series is kept per solvent (benzoic acids in water
// and in DMSO are far apart) and only when it holds at least MIN rows; the rest stand alone.
//
// Run after the pKa data or the acidic hydrogens change: node scripts/kb/build-pka-series.mjs
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(ROOT, 'package.json'));
const RD = await require('@rdkit/rdkit')();
const KB = path.join(ROOT, 'src/kb/');
const MIN = 3;

/**
 * [series, SMARTS (its first atom carries the hydrogen), parent compound's SMILES for the heading's
 * drawing (drawn here), whole (1: the compound joins whichever hydrogen the value belongs to, as for nucleosides
 * and peptides, whose values belong to several groups)]. The first that fits wins.
 */
const SERIES = [
  ['Purines and nucleosides', '[#6]1~[#7]~[#6]~[#7]~[#6]2~[#6]~1~[#7]~[#6]~[#7]~2', 'c1ncc2[nH]cnc2n1', 1],
  ['Pyrimidine nucleosides', '[#7]1(C2OC(CO)CC2)~[#6]~[#7]~[#6]~[#6]~[#6]~1', 'Nc1ccn(C2CC(O)C(CO)O2)c(=O)n1', 1],
  ['Peptides', '[NX3,NX4+][CX4]C(=O)N[CX4]C(=O)[OX2H,OX1-]', 'NCC(=O)NCC(=O)O', 1],
  ['Amino acids', '[NX3,NX4+;!$(NC=O)][CX4]C(=O)[OX2H,OX1-]', 'NCC(=O)O', 1],
  // carbon acids (DMSO, mostly)
  ['Fluorenes', '[CX4;!H0]1c2ccccc2-c2ccccc21', 'C1c2ccccc2-c2ccccc21'],
  ['Phenylacetonitriles', '[CX4;!H0](C#N)c1ccccc1', 'N#CCc1ccccc1'],
  ['Benzyl sulfones', '[CX4;!H0](S(=O)=O)c1ccccc1', 'CS(=O)(=O)Cc1ccccc1'],
  ['Benzyl sulfides', '[CX4;!H0]([SX2])c1ccccc1', 'CSCc1ccccc1'],
  ['Acetophenones', '[CX4;!H0]C(=O)c1ccccc1', 'CC(=O)c1ccccc1'],
  ['Deoxybenzoins', '[CX4;!H0](c1ccccc1)C(=O)c1ccccc1', 'O=C(Cc1ccccc1)c1ccccc1'],
  ['Diphenylmethanes', '[CX4;!H0](c1ccccc1)c1ccccc1', 'c1ccc(Cc2ccccc2)cc1'],
  ['β-Dicarbonyls', '[CX4;!H0](C=O)C=O', 'CC(=O)CC(C)=O'],
  ['Phosphonium salts', '[CX4;!H0][P+]', 'C[P+](c1ccccc1)(c1ccccc1)c1ccccc1'],
  ['Nitroalkanes', '[CX4;!H0][N+](=O)[O-]', 'C[N+](=O)[O-]'],
  ['Sulfones', '[CX4;!H0]S(=O)(=O)', 'CS(C)(=O)=O'],
  ['Ketones', '[CX4;!H0]C(=O)[#6]', 'CC(C)=O'],
  ['Esters', '[CX4;!H0]C(=O)O[#6]', 'CC(=O)OC'],
  ['Nitriles', '[CX4;!H0]C#N', 'CC#N'],
  // N–H acids
  ['Benzenesulfonamides', '[NX3;!H0]S(=O)(=O)c1ccccc1', 'NS(=O)(=O)c1ccccc1'],
  ['Anilides', '[NX3;!H0](C=O)c1ccccc1', 'CC(=O)Nc1ccccc1'],
  ['Benzamides', '[NX3;!H0]C(=O)c1ccccc1', 'NC(=O)c1ccccc1'],
  ['Hydroxamic acids', '[OX2H]NC=O', 'CC(=O)NO'],
  ['Hydroxamic acids', '[NX3H](O)C=O', 'CC(=O)NO'],
  ['Amides', '[NX3;!H0]C(=O)[#6]', 'CC(N)=O'],
  // O–H acids
  ['Cinnamic acids', '[OX2H]C(=O)C=Cc1ccccc1', 'O=C(O)/C=C/c1ccccc1'],
  ['Phenoxyacetic acids', '[OX2H]C(=O)[CX4]Oc1ccccc1', 'O=C(O)COc1ccccc1'],
  ['3-Phenylpropanoic acids', '[OX2H]C(=O)[CX4][CX4]c1ccccc1', 'O=C(O)CCc1ccccc1'],
  ['Phenylacetic acids', '[OX2H]C(=O)[CX4]c1ccccc1', 'O=C(O)Cc1ccccc1'],
  ['Naphthoic acids', '[OX2H]C(=O)c1cccc2ccccc12', 'O=C(O)c1cccc2ccccc12'],
  ['Naphthoic acids', '[OX2H]C(=O)c1ccc2ccccc2c1', 'O=C(O)c1cccc2ccccc12'],
  ['Pyridinecarboxylic acids', '[OX2H]C(=O)c1ccncc1', 'O=C(O)c1cccnc1'],
  ['Pyridinecarboxylic acids', '[OX2H]C(=O)c1cccnc1', 'O=C(O)c1cccnc1'],
  ['Pyridinecarboxylic acids', '[OX2H]C(=O)c1ccccn1', 'O=C(O)c1cccnc1'],
  ['Benzoic acids', '[OX2H]C(=O)c1ccccc1', 'O=C(O)c1ccccc1'],
  ['Dicarboxylic acids', '[OX2H]C(=O)C(=O)[OX2H,OX1-]', 'O=C(O)CC(=O)O'],
  ['Dicarboxylic acids', '[OX2H]C(=O)[#6]C(=O)[OX2H,OX1-]', 'O=C(O)CC(=O)O'],
  ['Dicarboxylic acids', '[OX2H]C(=O)[#6]~[#6]C(=O)[OX2H,OX1-]', 'O=C(O)CC(=O)O'],
  ['Dicarboxylic acids', '[OX2H]C(=O)[#6]~[#6]~[#6]C(=O)[OX2H,OX1-]', 'O=C(O)CC(=O)O'],
  ['Dicarboxylic acids', '[OX2H]C(=O)[#6]~[#6]~[#6]~[#6]C(=O)[OX2H,OX1-]', 'O=C(O)CC(=O)O'],
  ['Haloacetic acids', '[OX2H]C(=O)[CX4][F,Cl,Br,I]', 'O=C(O)CCl'],
  ['Unsaturated carboxylic acids', '[OX2H]C(=O)C=C', 'C=CC(=O)O'],
  ['Aliphatic carboxylic acids', '[OX2H]C(=O)[CX4]', 'CC(=O)O'],
  ['Naphthols', '[OX2H]c1cccc2ccccc12', 'Oc1cccc2ccccc12'],
  ['Naphthols', '[OX2H]c1ccc2ccccc2c1', 'Oc1cccc2ccccc12'],
  ['Phenols', '[OX2H]c1ccccc1', 'Oc1ccccc1'],
  ['Thiophenols', '[SX2H]c1ccccc1', 'Sc1ccccc1'],
  ['Alkanethiols', '[SX2H][CX4]', 'CCS'],
  ['Oximes', '[OX2H]N=C', 'CC=NO'],
  ['Phosphonic acids', '[OX2H]P(=O)([OX2])[#6]', 'CP(=O)(O)O'],
  ['Phosphates', '[OX2H]P(=O)([OX2])[OX2]', 'O=P(O)(O)O'],
  ['Alcohols', '[OX2H][CX4]', 'CCO'],
  // bases (the value is the conjugate acid's) and N–H acids on the same frameworks
  ['Pyridine N-oxides', '[OX1-,OX2H][n+]1ccccc1', '[O-][n+]1ccccc1'],
  ['Acridines', '[nX2]1c2ccccc2cc2ccccc12', 'c1ccc2nc3ccccc3cc2c1'],
  ['Quinolines', '[nX2]1cccc2ccccc12', 'c1ccc2ncccc2c1'],
  ['Isoquinolines', '[nX2]1ccc2ccccc2c1', 'c1ccc2cnccc2c1'],
  ['Benzimidazoles', '[nX2]1c[nX3]c2ccccc12', 'c1ccc2[nH]cnc2c1'],
  ['Imidazoles', '[nX2]1cc[nX3]c1', 'c1c[nH]cn1'],
  ['Pyrimidines', '[nX2]1cnccc1', 'c1cncnc1'],
  ['Pyridines', '[nX2]1ccccc1', 'c1ccncc1'],
  ['Indoles and pyrroles', '[nX3H]1cccc1', 'c1cc[nH]c1'],
  ['N,N-Dimethylanilines', '[NX3H0;!$(NC=O)]([CH3])([CH3])c1ccccc1', 'CN(C)c1ccccc1'],
  ['N-Methylanilines', '[NX3H1;!$(NC=O)]([CH3])c1ccccc1', 'CNc1ccccc1'],
  ['Anilines', '[NX3;!$(NC=O);!$(NS=O)]c1ccccc1', 'Nc1ccccc1'],
  ['Benzylamines', '[NX3;!$(NC=O)][CH2]c1ccccc1', 'NCc1ccccc1'],
  ['Morpholines', '[NX3;!$(NC=O)]1CCOCC1', 'C1COCCN1'],
  ['Piperazines', '[NX3;!$(NC=O)]1CCNCC1', 'C1CNCCN1'],
  ['Piperidines', '[NX3;!$(NC=O)]1CCCCC1', 'C1CCNCC1'],
  ['Pyrrolidines', '[NX3;!$(NC=O)]1CCCC1', 'C1CCNC1'],
  ['1,2-Diamines', '[NX3;!$(NC=O)][CX4][CX4][NX3;!$(NC=O)]', 'NCCN'],
  ['2-Aminoalcohols', '[NX3;!$(NC=O)][CX4][CX4][OX2]', 'NCCO'],
  ['Tertiary amines', '[NX3H0;!$(NC=[O,N,S])]([CX4])([CX4])[CX4]', 'CN(C)C'],
  ['Secondary amines', '[NX3H1;!$(NC=[O,N,S])]([CX4])[CX4]', 'CNC'],
  ['Primary amines', '[NX3H2][CX4]', 'CN'],
];

const queries = SERIES.map(([name, s, parent, whole]) => {
  const q = RD.get_qmol(s);
  if (!q) throw new Error(`bad SMARTS ${s}`);
  const pm = RD.get_mol(parent);
  if (!pm) throw new Error(`bad SMILES ${parent}`);
  const canon = pm.get_smiles();
  pm.delete();
  return { name, q, parent: canon, whole: !!whole };
});

const r3 = (v) => Math.round(v * 1000) / 1000;

/** A parent compound's 2-D drawing for its series heading: atoms [x, y (bond lengths, y down), element, charge?], Kekulé bonds, laid out wider than tall. */
function drawing(smiles) {
  const mol = RD.get_mol(smiles);
  mol.set_new_coords?.(true);
  const lines = mol.get_molblock().split('\n');
  mol.delete();
  const [na, nb] = [Number(lines[3].slice(0, 3)), Number(lines[3].slice(3, 6))];
  const atoms = [], bonds = [];
  for (let i = 0; i < na; i++) {
    const l = lines[4 + i];
    atoms.push({ x: Number(l.slice(0, 10)), y: -Number(l.slice(10, 20)), el: l.slice(31, 34).trim(), charge: 0 });
  }
  for (let i = 0; i < nb; i++) {
    const l = lines[4 + na + i];
    bonds.push([Number(l.slice(0, 3)) - 1, Number(l.slice(3, 6)) - 1, Number(l.slice(6, 9))]);
  }
  for (const l of lines) {
    const m = /^M {2}CHG\s+(\d+)(.*)$/.exec(l);
    if (!m) continue;
    const v = m[2].trim().split(/\s+/).map(Number);
    for (let k = 0; k < v.length; k += 2) atoms[v[k] - 1].charge = v[k + 1];
  }
  const L = bonds.reduce((t, [a, b]) => t + Math.hypot(atoms[a].x - atoms[b].x, atoms[a].y - atoms[b].y), 0) / (bonds.length || 1) || 1;
  let sxx = 0, syy = 0, sxy = 0;
  const cx = atoms.reduce((t, a) => t + a.x, 0) / na, cy = atoms.reduce((t, a) => t + a.y, 0) / na;
  for (const a of atoms) { const x = a.x - cx, y = a.y - cy; sxx += x * x; syy += y * y; sxy += x * y; }
  const rot = -0.5 * Math.atan2(2 * sxy, sxx - syy), c = Math.cos(rot), sn = Math.sin(rot);
  return {
    atoms: atoms.map((a) => {
      const x = (a.x - cx) / L, y = (a.y - cy) / L;
      const t = [r3(x * c - y * sn), r3(x * sn + y * c), a.el];
      if (a.charge) t.push(a.charge);
      return t;
    }),
    bonds,
  };
}

/** The series a compound belongs to, by the atom its hydrogen comes off (or goes on). */
function seriesOf(smiles, atom) {
  const mol = RD.get_mol(smiles);
  if (!mol) return null;
  try {
    for (const s of queries) {
      const got = JSON.parse(mol.get_substruct_matches(s.q) || '[]');
      for (const m of Array.isArray(got) ? got : [got]) if (m.atoms && (s.whole || m.atoms[0] === atom)) return s;
    }
    return null;
  } finally {
    mol.delete();
  }
}

const D = JSON.parse(fs.readFileSync(KB + 'pka-dmso.json', 'utf8'));
const W = JSON.parse(fs.readFileSync(KB + 'pka-water.json', 'utf8'));
const ACIDIC = JSON.parse(fs.readFileSync(KB + 'pka-acidic.json', 'utf8'));
const rows = [
  ...D.rows.map(([, smiles, pka, , site]) => ({ smiles, pka, site, solvent: 'DMSO' })),
  ...W.rows.map(([, smiles, pka, site, , solvent]) => ({ smiles, pka, site, solvent })),
];
// the same key as src/kb/pka.ts acidicSite (plus the solvent itself: a series is per solvent)
const keyOf = (r) => `${r.smiles}|${r.site}|${r.solvent === 'DMSO' ? 'DMSO' : 'W'}|${String(r.pka).replace(/^~/, '')}`;
const found = new Map(); // row key + solvent -> series
for (const r of rows) {
  const at = ACIDIC[keyOf(r)];
  if (!at) continue;
  const s = seriesOf(r.smiles, at[0]);
  if (s) found.set(`${keyOf(r)}|${r.solvent}`, s);
}
// a series counts in a solvent with at least MIN rows there
const size = new Map();
for (const [k, s] of found) { const g = `${s.name}|${k.split('|').at(-1)}`; size.set(g, (size.get(g) ?? 0) + 1); }
const names = [...new Set(SERIES.map(([n]) => n))];
const out = { series: names.map((n) => [n, drawing(queries.find((q) => q.name === n).parent)]), rows: {} };
for (const [k, s] of found) if (size.get(`${s.name}|${k.split('|').at(-1)}`) >= MIN) out.rows[k] = names.indexOf(s.name);
fs.writeFileSync(KB + 'pka-series.json', JSON.stringify(out) + '\n');
const kept = [...size].filter(([, n]) => n >= MIN).sort((a, b) => b[1] - a[1]);
console.log('rows in a series', Object.keys(out.rows).length, 'of', rows.length, '; series', kept.length);
if (process.env.VERBOSE) for (const [g, n] of kept) console.log(n, g);
