// The chemistry worker's answers (chem-worker.ts loads RDKit and passes requests here; tests call
// this with RDKit loaded in Node). Structures with a run of atoms too long for the engine's SMILES
// calls are kept away from them (engine-guard.ts).

/* eslint-disable @typescript-eslint/no-explicit-any */
import { formulaFromJson } from '../chem/formula';
import { stereoTags } from '../chem/stereo';
import { molProps, substructureMatches, structureLibrary, libraryMatches, panelProps, massFragments, type PanelProps, type StructureLibrary } from '../chem/props';
import { namerGraph } from '../chem/namer-graph';
import { hammettSites } from '../chem/hammett-match';
import { molFacts, unreadableFacts } from '../si/chem';
import { graphOf, hasMacrocycle, tooDeep, TOO_DEEP } from '../chem/engine-guard';
import type { ChemRequest, ChemResponse, FragmentResult } from './chem-worker';

/** Sets of structures kept for substructure searches, by name (see substructureIn). */
const libraries = new Map<string, StructureLibrary>();

function analyzeOne(RDKit: any, molblock: string): FragmentResult {
  const mol = RDKit.get_mol(molblock);
  if (!mol || !mol.is_valid()) {
    mol?.delete?.();
    return { formula: '', exact: 0, mw: 0, charge: 0, smiles: '', error: 'Could not read this structure (check valences).' };
  }
  try {
    const { formula, charge } = formulaFromJson(mol.get_json());
    const d = JSON.parse(mol.get_descriptors());
    let props: PanelProps | undefined;
    try {
      props = panelProps(RDKit, mol);
    } catch (e) {
      if (e instanceof WebAssembly.RuntimeError) throw e;
      props = undefined;
    }
    // (a run of atoms too long for SMILES: formula, masses and properties without it)
    return { formula, exact: d.exactmw, mw: d.amw, charge, smiles: tooDeep(molblock) ? '' : mol.get_smiles(), props };
  } finally {
    mol.delete();
  }
}

/**
 * The atoms two molecules share, by maximum common substructure (whole rings only, ring bonds
 * matching ring bonds, elements and bond orders alike), as pairs [ref atom, mol atom].
 */
function commonPart(RDKit: any, ref: string, other: string): [number, number][] | null {
  const a = RDKit.get_mol(ref), b = RDKit.get_mol(other);
  const list = new RDKit.MolList();
  let q: any = null;
  try {
    if (!a?.is_valid() || !b?.is_valid()) return null;
    list.append(a);
    list.append(b);
    const smarts: string = RDKit.get_mcs_as_smarts(list, JSON.stringify({ AtomCompare: 'Elements', BondCompare: 'Order', RingMatchesRingOnly: true, CompleteRingsOnly: true, Timeout: 2 }));
    if (!smarts) return null;
    q = RDKit.get_qmol(smarts);
    if (!q?.is_valid()) return null;
    const ma = JSON.parse(a.get_substruct_match(q)).atoms as number[] | undefined;
    const mb = JSON.parse(b.get_substruct_match(q)).atoms as number[] | undefined;
    if (!ma?.length || !mb || ma.length !== mb.length) return null;
    return ma.map((x, i) => [x, mb[i]]);
  } finally {
    q?.delete?.();
    list.delete?.();
    a?.delete?.();
    b?.delete?.();
  }
}

/** Whether the engine still answers: a trap inside RDKit (out of stack, out of memory) leaves the module broken, even where the error was caught. */
export function engineWorks(RDKit: any): boolean {
  try {
    const m = RDKit.get_mol('CC');
    const ok = !!m && m.is_valid() && m.get_smiles() === 'CC';
    m?.delete?.();
    return ok;
  } catch {
    return false;
  }
}

/** The answer to one request (the engine is loaded). */
export function respond(RDKit: any, m: Exclude<ChemRequest, { type: 'init' }>, beat: () => void = () => {}): ChemResponse {
  /** `list.map(f)`, telling the client now and then that work goes on. */
  const mapBeating = <T, U>(list: T[], f: (x: T) => U): U[] => list.map((x) => { beat(); return f(x); });
  const deep = (x: string): boolean => tooDeep(x);
  if (m.type === 'analyze') {
    const t0 = performance.now();
    const results = mapBeating(m.mols, (x) => analyzeOne(RDKit, x.molblock));
    return { type: 'analyze', id: m.id, results, ms: performance.now() - t0 };
  } else if (m.type === 'stereo') {
    const t0 = performance.now();
    const results = mapBeating(m.mols, (x) => stereoTags(RDKit, x.molblock, x.skip, undefined, x.generic));
    return { type: 'stereo', id: m.id, results, ms: performance.now() - t0 };
  } else if (m.type === 'smilesToMol') {
    if (deep(m.smiles)) return { type: 'error', id: m.id, message: TOO_DEEP };
    const mol = RDKit.get_mol(m.smiles);
    if (!mol || !mol.is_valid()) { mol?.delete?.(); return { type: 'smilesToMol', id: m.id, molblock: null }; }
    mol.set_new_coords(true);
    const mb = mol.get_molblock();
    mol.delete();
    return { type: 'smilesToMol', id: m.id, molblock: mb };
  } else if (m.type === 'layouts') {
    // the engine's own 2-D layouts (its classic one and CoordGen's), for Clean Up to start from
    const coords: [number, number][][] = [];
    // (none for a long run of atoms, which breaks the engine; no CoordGen with a big ring, which it
    // can take minutes over: Clean Up manages without either)
    if (deep(m.molblock)) return { type: 'layouts', id: m.id, coords };
    const g = graphOf(m.molblock);
    const ways = g && hasMacrocycle(g) ? [false] : [false, true];
    const mol = RDKit.get_mol(m.molblock, JSON.stringify({ sanitize: false, removeHs: false }));
    if (mol && mol.is_valid()) {
      for (const coordGen of ways) {
        try {
          mol.set_new_coords(coordGen);
          const lines = mol.get_molblock().split(/\r?\n/);
          const n = parseInt(lines[3].slice(0, 3), 10);
          coords.push(Array.from({ length: n }, (_, i) => [parseFloat(lines[4 + i].slice(0, 10)), -parseFloat(lines[4 + i].slice(10, 20))] as [number, number]));
        } catch (e) { if (e instanceof WebAssembly.RuntimeError) throw e; /* that layout failed: use the other */ }
      }
    }
    mol?.delete();
    return { type: 'layouts', id: m.id, coords };
  } else if (m.type === 'molToSmiles') {
    if (deep(m.molblock)) return { type: 'error', id: m.id, message: TOO_DEEP };
    const mol = m.loose ? RDKit.get_mol(m.molblock, JSON.stringify({ sanitize: false })) : RDKit.get_mol(m.molblock);
    const smiles = mol && mol.is_valid() ? mol.get_smiles() : null;
    mol?.delete();
    return { type: 'molToSmiles', id: m.id, smiles };
  } else if (m.type === 'namerGraph') {
    if (deep(m.molblock)) return { type: 'error', id: m.id, message: TOO_DEEP };
    const mol = RDKit.get_mol(m.molblock);
    const ok = mol && mol.is_valid();
    const answer: ChemResponse = { type: 'namerGraph', id: m.id, graph: ok ? namerGraph(mol) : null, smiles: ok ? mol.get_smiles() : null };
    mol?.delete();
    return answer;
  } else if (m.type === 'canonical') {
    if (deep(m.smiles)) return { type: 'canonical', id: m.id, smiles: null };
    const mol = RDKit.get_mol(m.smiles);
    const answer: ChemResponse = { type: 'canonical', id: m.id, smiles: mol && mol.is_valid() ? mol.get_smiles() : null };
    mol?.delete();
    return answer;
  } else if (m.type === 'props') {
    return { type: 'props', id: m.id, results: mapBeating(m.mols, (x) => (deep(x) ? { error: TOO_DEEP } : molProps(RDKit, x))) };
  } else if (m.type === 'substructure') {
    if (deep(m.query)) return { type: 'substructure', id: m.id, results: m.mols.map(() => null), error: TOO_DEEP };
    // (the query is written as SMILES; the molecules searched are only read)
    return { type: 'substructure', id: m.id, ...substructureMatches(RDKit, m.query, m.mols) };
  } else if (m.type === 'substructureIn') {
    if (m.mols) { libraries.get(m.name)?.lib.delete?.(); libraries.set(m.name, structureLibrary(RDKit, m.mols.map((x) => (deep(x) ? '' : x)))); }
    const L = libraries.get(m.name);
    if (L && deep(m.query)) return { type: 'substructureIn', id: m.id, results: [], error: TOO_DEEP };
    return L ? { type: 'substructureIn', id: m.id, ...libraryMatches(RDKit, L, m.query) } : { type: 'substructureIn', id: m.id, results: [], missing: true };
  } else if (m.type === 'hammett') {
    if (deep(m.core)) return { type: 'hammett', id: m.id, results: m.mols.map(() => ({ error: TOO_DEEP })) };
    return { type: 'hammett', id: m.id, results: mapBeating(m.mols, (x) => (deep(x) ? { error: TOO_DEEP } : hammettSites(RDKit, x, m.core))) };
  } else if (m.type === 'fragments') {
    return { type: 'fragments', id: m.id, results: deep(m.molblock) ? { error: TOO_DEEP } : massFragments(RDKit, m.molblock, m.cuts) };
  } else if (m.type === 'siFacts') {
    // (no structure: null; one RDKit can't read: facts that say so, shown where its formula would be;
    // molFacts keeps a run of atoms too long for SMILES away from the SMILES calls itself)
    return {
      type: 'siFacts', id: m.id, results: mapBeating(m.mols, (x) => {
        if (!x.trim()) return null;
        try { return molFacts(RDKit, x) ?? unreadableFacts(); } catch (e) { if (e instanceof WebAssembly.RuntimeError) throw e; return unreadableFacts(); }
      }),
    };
  } else {
    const ref = m.ref;
    return { type: 'common', id: m.id, results: mapBeating(m.mols, (x) => (deep(ref) || deep(x) ? null : commonPart(RDKit, ref, x))) };
  }
}
