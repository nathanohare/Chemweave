// Chemistry engine running off the main thread so drawing never waits for it.
// Loads RDKit (WebAssembly) and answers requests (chem-respond.ts): formula and masses, R/S and
// E/Z labels, SMILES in and out, and the properties and substructure searches of Sheet mode.

/// <reference lib="webworker" />
import type { StereoTags } from '../chem/stereo';
import type { PanelProps, MassFragment } from '../chem/props';
import type { MolProps } from '../sheet/properties';
import type { NamerGraph } from '../chem/namer-graph';
import type { HammettResult } from '../chem/hammett-match';
import type { MolFacts } from '../si/chem';
import { respond, engineWorks } from './chem-respond';
type InitRDKit = (opts: { locateFile: () => string }) => Promise<any>;

export type ChemRequest =
  | { type: 'init'; js: string; wasm: string }
  | { type: 'analyze'; id: number; mols: { molblock: string; map: number[] }[] }
  | { type: 'stereo'; id: number; mols: { molblock: string; skip: number[]; generic: [number, string][] }[] }
  | { type: 'smilesToMol'; id: number; smiles: string }
  | { type: 'layouts'; id: number; molblock: string }
  | { type: 'molToSmiles'; id: number; molblock: string; loose?: boolean }
  /** Sheet properties of molecules, each given as a molfile or a SMILES string. */
  | { type: 'props'; id: number; mols: string[] }
  /** Which molecules (molfiles or SMILES) contain the query (a molfile): its atoms and bonds, with anything else attached. */
  | { type: 'substructure'; id: number; query: string; mols: string[] }
  /**
   * The same over a named set of SMILES kept here between searches (the Knowledge Base's): `mols`
   * is sent the first time and whenever the set changes, and left out after.
   */
  | { type: 'substructureIn'; id: number; name: string; mols?: string[]; query: string }
  /** The Hammett groups at a core's marked (*) positions in each molecule (see src/chem/hammett-match.ts). */
  | { type: 'hammett'; id: number; core: string; mols: string[] }
  /** The pieces a molfile falls into when bonds (pairs of molfile atoms, 0-based) are broken. */
  | { type: 'fragments'; id: number; molblock: string; cuts: [number, number][] }
  /** The largest part `mol` shares with `ref` (both molfiles): pairs of matching atoms, [ref atom, mol atom], 0-based. */
  | { type: 'common'; id: number; ref: string; mols: string[] }
  /** A molfile as the systematic namer reads it, with its SMILES to check the name against. */
  | { type: 'namerGraph'; id: number; molblock: string }
  /** A SMILES string written the one way RDKit writes that structure, to compare two. */
  | { type: 'canonical'; id: number; smiles: string }
  /** What an SI project's checks need from compounds' structures (src/si/chem.ts), molfiles in, null for an unreadable one. */
  | { type: 'siFacts'; id: number; mols: string[] };

export interface FragmentResult {
  formula: string;
  exact: number;
  mw: number;
  charge: number;
  smiles: string;
  /** Properties, elemental analysis and estimates for the Analysis panel. */
  props?: PanelProps;
  error?: string;
}

export type ChemResponse =
  | { type: 'ready'; ms: number; version: string }
  /** `fatal`: the engine broke while answering (its WebAssembly module no longer works): the worker must be restarted. */
  | { type: 'error'; id?: number; message: string; fatal?: boolean }
  /** Still working on a long request (so the client's watchdog doesn't take it for a hang). */
  | { type: 'alive' }
  | { type: 'analyze'; id: number; results: FragmentResult[]; ms: number }
  | { type: 'stereo'; id: number; results: StereoTags[]; ms: number }
  | { type: 'smilesToMol'; id: number; molblock: string | null }
  | { type: 'layouts'; id: number; coords: [number, number][][] }
  | { type: 'molToSmiles'; id: number; smiles: string | null }
  | { type: 'props'; id: number; results: (MolProps | { error: string })[] }
  | { type: 'substructure'; id: number; results: (boolean | null)[]; error?: string }
  /** The indexes of the set's structures containing the query; `missing`: the set must be sent again. */
  | { type: 'substructureIn'; id: number; results: number[]; error?: string; missing?: boolean }
  | { type: 'hammett'; id: number; results: HammettResult[] }
  | { type: 'fragments'; id: number; results: MassFragment[] | { error: string } }
  | { type: 'common'; id: number; results: ([number, number][] | null)[] }
  | { type: 'namerGraph'; id: number; graph: NamerGraph | null; smiles: string | null }
  | { type: 'canonical'; id: number; smiles: string | null }
  | { type: 'siFacts'; id: number; results: (MolFacts | null)[] };

let RDKit: any = null;
const post = (m: ChemResponse) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);

// The built app runs this worker as a classic script, where importScripts loads RDKit.
// The development server runs it as a module, where importScripts is not allowed, so
// RDKit's loader is imported instead and its CommonJS export caught on a stand-in `module`.
async function loadRDKitScript(url: string): Promise<InitRDKit> {
  const g = self as any;
  try {
    g.importScripts(url);
    return g.initRDKitModule;
  } catch (e) {
    if (!(e instanceof TypeError)) throw e;
    g.module = { exports: {} };
    g.exports = g.module.exports;
    try {
      await import(/* @vite-ignore */ url);
      return g.module.exports;
    } finally {
      delete g.module;
      delete g.exports;
    }
  }
}

/** For long batches: tell the client now and then that work goes on (see client.ts's watchdog). */
let lastBeat = 0;
function beat(): void {
  const now = performance.now();
  if (now - lastBeat > 1000) { lastBeat = now; post({ type: 'alive' }); }
}

self.onmessage = async (e: MessageEvent<ChemRequest>) => {
  const m = e.data;
  if (m.type === 'init') {
    try {
      const t0 = performance.now();
      const initRDKitModule = await loadRDKitScript(m.js);
      RDKit = await initRDKitModule({ locateFile: () => m.wasm });
      post({ type: 'ready', ms: performance.now() - t0, version: RDKit.version() });
    } catch (err) {
      post({ type: 'error', message: String(err) });
    }
    return;
  }
  const id = m.id;
  if (!RDKit) { post({ type: 'error', id, message: 'Chemistry engine not loaded yet' }); return; }
  lastBeat = performance.now();
  // (the answer is held until the engine is known to still work: if it broke, the client is told
  // so instead, and restarts the worker)
  let answer: ChemResponse;
  try {
    answer = respond(RDKit, m, beat);
  } catch (err) {
    answer = { type: 'error', id, message: String(err), ...(err instanceof WebAssembly.RuntimeError ? { fatal: true } : {}) };
  }
  if (!(answer.type === 'error' && answer.fatal) && !engineWorks(RDKit)) answer = { type: 'error', id, message: 'The chemistry engine broke while working on this.', fatal: true };
  post(answer);
};

