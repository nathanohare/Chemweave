// Which atom of each pKa Values drawing carries the hydrogen that comes off (src/kb/pka-acidic.json),
// so the Knowledge Base can draw that hydrogen and pick it out in red.
//
// Every row names the kind of hydrogen (Acidic H: "O–H", "N–H", "C–H"…) and its measured value.
// Each atom of that element that could give up a hydrogen (an acid) or take one on (a base, whose
// conjugate acid the value belongs to) gets a rough textbook pKa from the first rule below that
// fits it; the atom whose rough value lies nearest the row's lowest measured value is the one. So
// imidazole's 6.95 in water is the protonated ring nitrogen (~7) and its 18.6 in DMSO the N–H
// (~18). The rough values only choose between atoms; they are never shown.
//
// Run after the pKa data changes: node scripts/kb/build-pka-acidic.mjs
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(ROOT, 'package.json'));
const RD = await require('@rdkit/rdkit')();
const KB = path.join(ROOT, 'src/kb/');

/**
 * [SMARTS (its first atom is the one), 'a' loses a hydrogen | 'b' takes one on, rough pKa in
 * water, rough pKa in DMSO, 'weak': a base only in strong acid (a carbonyl or ether oxygen) or an
 * anion's oxygen, never chosen when the molecule has a hydrogen of that element to lose]. The first
 * rule that fits an atom (in each of 'a' and 'b') counts.
 */
const RULES = [
  // O–H acids
  ['[OX2H]S(=O)(=O)', 'a', -2, 1.6],
  ['[OX2H]S(=O)', 'a', 2, 7],
  ['[OX2H][Cl,Br,I,Mn,Re](=O)(=O)=O', 'a', -10, -2],
  ['[OX2H][Cl,Br,I](=O)=O', 'a', -1, 5],
  ['[OX2H][N+](=O)[O-]', 'a', -1.4, 5],
  ['[OX2H][N,n;+0]=O', 'a', 3.3, 8],
  ['[OX2H]P', 'a', 2, 8],
  ['[OX2H][As,Se,Te,Cr,B,Si]', 'a', 4, 10],
  ['[OX2H]C(=O)[OX2H]', 'a', 6.4, 12],
  ['[OX2H]C(=[O,S])', 'a', 4.5, 12],
  ['[OX2H]OC=O', 'a', 8.2, 15],
  ['[OX2H]O', 'a', 11.6, 22],
  ['[OX2H]N(C=O)', 'a', 9, 17],
  ['[OX2H]N=*', 'a', 11, 20],
  ['[OX2H][N,n]', 'a', 9, 17],
  ['[OX2H]c1ccccc1', 'a', 10, 18],
  ['[OX2H]c', 'a', 9, 16],
  ['[OX2H]C=C', 'a', 9, 15],
  ['[OX2H]C=[N,n]', 'a', 9, 15],
  ['[OX2H][CX4]C(F)(F)F', 'a', 12.4, 23.5],
  ['[OX2H][CX4]', 'a', 16, 29],
  ['[OH2]', 'a', 15.7, 31.4],
  ['[OX2H]', 'a', 12, 20],
  ['[OX1H0-;!$([O-][#7+;!$([#7+]=O)])]', 'b', 10, 18, 'weak'],
  // S, Se, Te and the halogen acids
  ['[SX2H]c', 'a', 6.6, 10.3],
  ['[SX2H]C=O', 'a', 3.5, 8],
  ['[SX2H]', 'a', 10.5, 17],
  ['[SH2]', 'a', 7, 15],
  ['[SeH,TeH,GeH,SiH]', 'a', 4, 15],
  ['[F,Cl,Br,I;H1]', 'a', -7, 2],
  // N–H acids
  ['[NX3H](S(=O)=O)C=O', 'a', 2, 5],
  ['[NX3H]([#6,#16]=O)[#6,#16]=O', 'a', 9.6, 13.4],
  ['[NX3H]([N+](=O)[O-])', 'a', 3.3, 7],
  ['[NX3H](S(=O)(=O))[c,n]', 'a', 7.5, 12],
  ['[NX3;H1,H2]S(=O)(=O)', 'a', 10, 16],
  ['[NX3;H1,H2]C(=O)C(F)(F)F', 'a', 13, 17],
  ['[nH]1nnnc1', 'a', 4.9, 8.2],
  ['[nH]1nncc1', 'a', 9.3, 14.8],
  ['[nH]1cnnc1', 'a', 10, 14.8],
  ['[nH]c=O', 'a', 9.5, 13],
  ['[nH][c,n]=O', 'a', 9.5, 13],
  ['[nH]c=[S,N]', 'a', 9.5, 13],
  ['[NX3;H1,H2;+0]C(=O)', 'a', 15.5, 23.5],
  ['[NX3;H1,H2;+0]C(=S)', 'a', 13, 18],
  ['[NX3;H1,H2;+0]C(=N)', 'a', 16, 26],
  ['[NX3;H1,H2;+0]N', 'a', 20, 25],
  ['[NX3;H1,H2;+0]O', 'a', 15, 22],
  ['[nH]1ccnc1', 'a', 14.5, 18.6],
  ['[nH]', 'a', 17, 21],
  ['[NX3;H1,H2;+0]c', 'a', 28, 30.6],
  ['[NX2H]=*', 'a', 30, 31],
  ['[NX3;H1,H2,H3;+0]', 'a', 36, 41],
  ['[N+;H1,H2,H3,H4]', 'a', 9.5, 9.5],
  ['[n+;H1]', 'a', 5, 3.5],
  // bases (the value is their conjugate acid's)
  ['[NX3;H0,H1,H2;+0]C=[NX2;+0]', 'b', 12.5, 13.5],
  ['[NX2;+0]=C[NX3;+0]', 'b', 12.5, 13.5],
  ['[NX3;H0,H1,H2;+0;!$(N[a]);!$(N[#6,#7,#16,#15]=[#7,#8,#16]);!$(N[#7,#8]);!$(N#*);!$(N=*);!$(NC#N)]', 'b', 10.5, 9.5],
  ['[nX2;+0;r6;!$(n:c=O);$(n~*~*~*=O),$(n~*~*=O)]', 'b', 1, 0],
  ['[nX2;+0;r6]:c-[NX3;H2,H1;!$(NC=O)]', 'b', 7.5, 6.5],
  ['[nX2;+0;r5;$(n1cnc2c1nc[n,c]c2),$(n1cnc2c1cncn2),$(n1cnc2c1c(=O)[nH]cn2),$(n1cnc2c1:*:*:*:2)]', 'b', 3, 2],
  ['[nX2;+0]1c[nX3]cc1', 'b', 7, 6],
  ['[nX2;+0]1cc[nX3]c1', 'b', 2.5, 1],
  ['[nX2;+0;r6]', 'b', 5.2, 3.4],
  ['[nX2;+0]', 'b', 3, 1],
  ['[NX3;H0,H1,H2;+0;!$(N[C,S,N,P]=[O,S,N]);!$(N[N+](=O)[O-]);!$(Nc:n);!$(Nc:c:n);!$(Nc:c:c:n);!$(Nc:c:c:c:n)]c', 'b', 4.6, 3.6],
  ['[NX3;H0,H1,H2;+0;!$(N[C,S,N,P]=[O,S,N]);!$(N[N+](=O)[O-])]N', 'b', 8, 7],
  ['[NX3;H0,H1,H2;+0;!$(N[C,S,N,P]=[O,S,N]);!$(N[N+](=O)[O-])]O', 'b', 6, 5],
  ['[NX2;+0]=[#6]', 'b', 7, 6],
  ['[NX3;H0,H1,H2;+0;!$(N[C,S,P]=[O,S]);!$(N[a])]', 'b', 1, 0],
  ['[OX1;+0]=[#6][NX3]', 'b', -0.5, -1, 'weak'],
  ['[OX1;+0]=[#6]', 'b', -6, -6, 'weak'],
  ['[OX1-][#7+;!$([#7+]=O)]', 'b', 0.8, 0.5],
  ['[OX1;+0]=[S,P]', 'b', -2, -2, 'weak'],
  ['[OX2;+0]', 'b', -3, -3, 'weak'],
  ['[PX3;+0]', 'b', 8, 8],
  ['[SX2;+0]', 'b', -7, -7, 'weak'],
  ['[SX1;+0]=[#6]', 'b', -1, -1, 'weak'],
  // C–H acids, most acidic kinds first
  ['[CX4;!H0]([$(C=O),$(S(=O)=O),$(C#N),$([N+](=O)[O-])])[$(C=O),$(S(=O)=O),$(C#N),$([N+](=O)[O-])]', 'a', 9, 13],
  ['[CX4;!H0][N+](=O)[O-]', 'a', 10.2, 17.2],
  ['[CH]#N', 'a', 9.2, 12.9],
  ['[CX4;!H0]1(-[N+,P+,S+,As+,$(C#N),$([N+]#[C-]),$(C=O),$(S=O)])c2ccccc2-c2ccccc12', 'a', 12, 12],
  ['[CX4;!H0]([N+,P+,S+,As+])[SX2,$(C=O),$(C#N),$(S=O),c]', 'a', 22, 24],
  ['[CX4;!H0]c([n+])[s,o]', 'a', 12, 14],
  ['[CX4;!H0]1C=CC=C1', 'a', 16, 18],
  ['[CX4;!H0]1c2ccccc2-c2ccccc12', 'a', 22, 22.6],
  ['[CX4;!H0][CX3H1]=O', 'a', 17, 24],
  ['[CX4;!H0]C(=O)[#6]', 'a', 19.3, 26.5],
  ['[CX4;!H0][P+,As+,S+]', 'a', 20, 22],
  ['[CX4;!H0][N+]', 'a', 30, 30],
  ['[cH,CH;+1]', 'a', 21, 22],
  ['[cH]1[n+]ccn1', 'a', 21, 22],
  ['[CX4;!H0]C(=O)[O,N]', 'a', 25, 29],
  ['[CX4;!H0]S(=O)(=O)', 'a', 29, 29],
  ['[CX4;!H0]C#N', 'a', 29, 31.3],
  ['[CX4;!H0]S(=O)', 'a', 33, 35],
  ['[CX4;!H0]P=O', 'a', 30, 30],
  ['[CH]#C', 'a', 25, 28.8],
  ['[CX4;!H0](c)c', 'a', 32, 32.2],
  ['[CX4;!H0]([SX2,SeX2])[SX2,SeX2]', 'a', 31, 31],
  ['[CX4;!H0]([SX2,SeX2])', 'a', 35, 35],
  ['[CX4;!H0][PX3,PX4]', 'a', 30, 30],
  ['[CX4;!H0]c(:n):[s,o]', 'a', 29, 30],
  ['[CX4;!H0]c:n', 'a', 33, 34],
  ['[CX4;!H0]C=C', 'a', 38, 40],
  ['[CX4;!H0]c', 'a', 40, 43],
  ['[cH]1occ[n,s,o]1', 'a', 30, 31],
  ['[cH]1scc[n,s]1', 'a', 30, 31],
  ['[cH]', 'a', 43, 44],
  ['[#6;!H0]', 'a', 48, 50],
];
const ELEMENT = { 1: 'H', 5: 'B', 6: 'C', 7: 'N', 8: 'O', 9: 'F', 14: 'Si', 15: 'P', 16: 'S', 17: 'Cl', 32: 'Ge', 33: 'As', 34: 'Se', 35: 'Br', 52: 'Te', 53: 'I' };

const queries = RULES.map(([s, mode, w, d, weak]) => {
  const q = RD.get_qmol(s);
  if (!q) throw new Error(`bad SMARTS ${s}`);
  return { q, mode, w, d, weak: weak === 'weak' };
});

/** The atom whose hydrogen comes off, and whether it takes one on first (a base): [atom, 1|0], or null. */
function acidicAtom(smiles, site, solvent, pka) {
  const mol = RD.get_mol(smiles);
  if (!mol) return null;
  try {
    const atoms = JSON.parse(mol.get_json()).molecules[0].atoms.map((a) => ({ z: a.z ?? 6, h: a.impHs ?? 0, chg: a.chg ?? 0 }));
    // "N–H, O–H", "N–H or O–H": either element
    const want = new Set(site.split(/,| or /).map((s) => s.trim().split('–')[0]));
    const values = (String(pka).match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
    if (!values.length) return null;
    const target = Math.min(...values);
    const dmso = solvent === 'DMSO';
    const best = new Map(); // `${atom}${mode}` -> rough pKa (first rule wins)
    const weakAt = new Set();
    for (const { q, mode, w, d, weak } of queries) {
      const got = JSON.parse(mol.get_substruct_matches(q) || '[]');
      for (const m of Array.isArray(got) ? got : [got]) {
        const i = m.atoms?.[0];
        if (i === undefined || best.has(`${i}${mode}`)) continue;
        const a = atoms[i];
        if (!want.has(ELEMENT[a.z])) continue;
        if (mode === 'a' && !a.h) continue;
        best.set(`${i}${mode}`, dmso ? d : w);
        if (weak) weakAt.add(`${i}${mode}`);
      }
    }
    // sulfuric, perchloric or trifluoroacetic acid's very low value is its O–H's, not a protonated oxygen's;
    // dihydrogen phosphate's 7.2 is its O–H's, not its O−'s
    for (const k of weakAt) {
      const z = atoms[Number(k.slice(0, -1))].z;
      if ([...best.keys()].some((o) => o.endsWith('a') && atoms[Number(o.slice(0, -1))].z === z)) best.delete(k);
    }
    // an element with no rule that fits (a lone halide, a metal oxide) and hydrogens to give
    if (!best.size) atoms.forEach((a, i) => { if (want.has(ELEMENT[a.z]) && a.h) best.set(`${i}a`, 20); });
    // the kind of hydrogen (which element, coming off or going on) whose rough value is nearest the
    // measured one; then of that kind the most acidic hydrogen, or the base whose rough value is
    // nearest (histamine's 6.0 is its ring nitrogen, not its amine)
    let kind = null, gap = Infinity;
    for (const [k, v] of best) {
      const g = Math.abs(v - target) + (k.endsWith('b') ? 0.01 : 0);
      if (g < gap) { gap = g; kind = `${atoms[Number(k.slice(0, -1))].z}${k.slice(-1)}`; }
    }
    if (!kind) return null;
    let pick = null, top = 0;
    for (const [k, v] of best) {
      const i = Number(k.slice(0, -1)), mode = k.slice(-1);
      if (`${atoms[i].z}${mode}` !== kind) continue;
      const score = mode === 'b' ? -Math.abs(v - target) : -v;
      if (pick === null || score > top) { pick = [i, mode === 'b' ? 1 : 0]; top = score; }
    }
    return pick;
  } finally {
    mol.delete();
  }
}

const D = JSON.parse(fs.readFileSync(KB + 'pka-dmso.json', 'utf8'));
const W = JSON.parse(fs.readFileSync(KB + 'pka-water.json', 'utf8'));
const rows = [
  ...D.rows.map(([, smiles, pka, , site]) => ({ smiles, pka, site, solvent: 'DMSO' })),
  ...W.rows.map(([, smiles, pka, site, , solvent]) => ({ smiles, pka, site, solvent })),
];
const out = {};
let missed = 0;
for (const r of rows) {
  // "~20": the key is the number (the table marks a DMSO approximation with ~ itself)
  const key = `${r.smiles}|${r.site}|${r.solvent === 'DMSO' ? 'DMSO' : 'W'}|${String(r.pka).replace(/^~/, '')}`;
  if (key in out) continue;
  const at = acidicAtom(r.smiles, r.site, r.solvent, r.pka);
  if (at) out[key] = at; else { missed++; if (process.env.VERBOSE) console.warn('no site', key); }
}
fs.writeFileSync(KB + 'pka-acidic.json', JSON.stringify(out) + '\n');
console.log('sites', Object.keys(out).length, 'missed', missed);
