// Main-thread side of the chemistry worker: sends requests and matches replies. Requests made
// while the engine loads wait for it. A watchdog notices a worker that died or hung (and the
// worker itself says when the engine broke on a request): what waits is then told so, the worker
// is restarted, the user is told in the status bar (onRestart), and the request that broke it is
// not sent again.

import type { ChemRequest, ChemResponse, FragmentResult } from '../worker/chem-worker';
import type { StereoTags } from './stereo';
import type { MolProps } from '../sheet/properties';
import type { MassFragment } from './props';
import type { NamerGraph } from './namer-graph';
import type { HammettResult } from './hammett-match';
import type { MolFacts } from '../si/chem';

/** How long the worker may be silent while a request waits before it is taken to have hung (long batches send `alive` meanwhile). */
export const WATCHDOG_MS = 45000;
/** Restarts allowed within RESTART_WINDOW_MS; after that the engine is left stopped (so a structure that keeps breaking it can't loop). */
const MAX_RESTARTS = 3;
const RESTART_WINDOW_MS = 5 * 60000;

/** What a request still waiting is told when the engine stops (callers show it, or fall back as for any failure). */
export const ENGINE_RESTARTED = 'The chemistry engine stopped and was restarted. Try again.';
/** What a request that broke the engine before is told when it is asked again (it is not sent, so the engine keeps working). */
export const ENGINE_SKIPPED = 'The chemistry engine stopped on this structure before, so it is not calculated again.';

/** Something that can stand in for a Web Worker (tests give a fake one). */
export interface WorkerLike {
  postMessage(m: unknown): void;
  terminate(): void;
  onmessage: ((e: MessageEvent) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
  onmessageerror: ((e: MessageEvent) => void) | null;
}

interface Pending { settle: (r: ChemResponse) => void; msg: ChemRequest }

export class ChemClient {
  ready = false;
  loadMs = 0;
  version = '';
  error = '';
  onReady: () => void = () => {};
  /** Called when the engine stopped (a crash, a hang) and was restarted, or was left stopped: a short message for the status bar. */
  onRestart: (message: string) => void = () => {};
  private worker: WorkerLike | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  /** Requests made before the engine is ready: sent once it is (or failed if it never loads). */
  private queued: { id: number; msg: ChemRequest }[] = [];
  /** Requests that broke the engine (as text without their id): not sent again. */
  private poisoned = new Set<string>();
  /**
   * Requests the engine went silent on once (a hang, or a worker that went away without a word):
   * the culprit is less certain than a crash it reported, so such a request is only kept back
   * when it happens again with it.
   */
  private suspects = new Set<string>();
  private restarts: number[] = [];
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private js = '';
  private wasm = '';

  constructor(base: string, private makeWorker: () => WorkerLike = defaultWorker) {
    this.js = new URL('RDKit_minimal.js', base).href;
    this.wasm = new URL('RDKit_minimal.wasm', base).href;
    this.start();
  }

  /** A new worker, loading the engine. */
  private start(): void {
    let w: WorkerLike;
    try {
      w = this.makeWorker();
    } catch (e) {
      this.error = 'Background worker could not start: ' + String(e);
      return;
    }
    this.worker = w;
    w.onmessage = (e: MessageEvent) => { if (this.worker === w) this.receive(e.data as ChemResponse); };
    w.onerror = (e: ErrorEvent) => {
      if (this.worker !== w) return;
      // (while loading: the engine can't load; once loaded: the worker died, so start a new one)
      if (this.ready) { this.restart('stopped'); return; }
      this.failLoad('Chemistry engine failed to load: ' + (e.message || 'unknown error'));
    };
    w.onmessageerror = () => { if (this.worker === w && this.ready) this.restart('stopped'); };
    w.postMessage({ type: 'init', js: this.js, wasm: this.wasm } satisfies ChemRequest);
  }

  private failLoad(message: string): void {
    this.error = message;
    for (const q of this.queued.splice(0)) this.pending.get(q.id)?.settle({ type: 'error', id: q.id, message });
    this.onReady();
  }

  private receive(m: ChemResponse): void {
    if (m.type === 'ready') {
      this.ready = true;
      this.error = '';
      this.loadMs = m.ms;
      this.version = m.version;
      for (const q of this.queued.splice(0)) this.worker?.postMessage(q.msg);
      this.arm();
      this.onReady();
      return;
    }
    if (m.type === 'alive') { this.arm(); return; }
    if (m.type === 'error' && m.id === undefined) {
      this.failLoad(m.message);
      return;
    }
    const id = (m as { id?: number }).id;
    if (id === undefined) return;
    const p = this.pending.get(id);
    if (m.type === 'error' && m.fatal) {
      // the engine broke on this request: it is not sent again, and a new engine starts
      if (p) this.poisoned.add(requestKey(p.msg));
      this.restart('broke');
      return;
    }
    if (p) { this.pending.delete(id); p.settle(m); }
    this.arm();
  }

  /** (Re)start the watchdog: a request waiting with no word from the worker for WATCHDOG_MS means it hung. */
  private arm(): void {
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = null;
    if (!this.ready || this.pending.size === this.queued.length) return;
    this.watchdog = setTimeout(() => {
      // (the worker answers in order, so the oldest request still waiting is the one it hung on)
      const first = [...this.pending.values()].find((p) => !this.queued.some((q) => q.msg === p.msg));
      if (first) {
        const k = requestKey(first.msg);
        if (this.suspects.has(k)) this.poisoned.add(k); else this.suspects.add(k);
      }
      this.restart('hung');
    }, WATCHDOG_MS);
  }

  /** Stop the worker, fail what waits, and start a new one (unless it stopped too often lately). */
  private restart(why: 'stopped' | 'broke' | 'hung'): void {
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = null;
    try { this.worker?.terminate(); } catch { /* (already gone) */ }
    this.worker = null;
    this.ready = false;
    this.queued = [];
    const waiting = [...this.pending.entries()];
    this.pending.clear();
    for (const [id, p] of waiting) p.settle({ type: 'error', id, message: ENGINE_RESTARTED });
    const now = Date.now();
    this.restarts = this.restarts.filter((t) => now - t < RESTART_WINDOW_MS);
    const what = why === 'hung' ? 'stopped responding' : 'stopped';
    if (this.restarts.length >= MAX_RESTARTS) {
      this.error = `The chemistry engine ${what} again, so it was not restarted. Save your work and restart Chemweave to use it again.`;
      this.onRestart(this.error);
      this.onReady();
      return;
    }
    this.restarts.push(now);
    this.onRestart(`The chemistry engine ${what} and was restarted.`);
    this.start();
  }

  private request<T extends ChemResponse>(build: (id: number) => ChemRequest): Promise<T> {
    const id = this.nextId++;
    const msg = build(id);
    return new Promise<T>((resolve, reject) => {
      if (this.poisoned.size && this.poisoned.has(requestKey(msg))) { reject(new Error(ENGINE_SKIPPED)); return; }
      // (an engine that couldn't load, or was left stopped: no answer will come)
      if (this.error && !this.ready) { reject(new Error(this.error)); return; }
      this.pending.set(id, { msg, settle: (r) => { this.pending.delete(id); if (r.type === 'error') reject(new Error(r.message)); else resolve(r as T); } });
      if (this.ready) { this.worker?.postMessage(msg); if (!this.watchdog) this.arm(); }
      else this.queued.push({ id, msg });
    });
  }

  analyze(mols: { molblock: string; map: number[] }[]): Promise<{ results: FragmentResult[]; ms: number }> {
    return this.request<Extract<ChemResponse, { type: 'analyze' }>>((id) => ({ type: 'analyze', id, mols }));
  }

  /** R/S and E/Z labels for some molfiles (see stereoTags). */
  async stereo(mols: { molblock: string; skip: number[]; generic: [number, string][] }[]): Promise<StereoTags[]> {
    const r = await this.request<Extract<ChemResponse, { type: 'stereo' }>>((id) => ({ type: 'stereo', id, mols }));
    return r.results;
  }

  async smilesToMol(smiles: string): Promise<string | null> {
    const r = await this.request<Extract<ChemResponse, { type: 'smilesToMol' }>>((id) => ({ type: 'smilesToMol', id, smiles }));
    return r.molblock;
  }

  /** The engine's own 2-D layouts of a molfile (atoms in the same order; y down, in bond lengths). */
  async layouts(molblock: string): Promise<[number, number][][]> {
    const r = await this.request<Extract<ChemResponse, { type: 'layouts' }>>((id) => ({ type: 'layouts', id, molblock }));
    return r.coords;
  }

  /** SMILES for a molfile; `loose` writes it as drawn, without checking valences. */
  async molToSmiles(molblock: string, loose = false): Promise<string | null> {
    const r = await this.request<Extract<ChemResponse, { type: 'molToSmiles' }>>((id) => ({ type: 'molToSmiles', id, molblock, ...(loose ? { loose } : {}) }));
    return r.smiles;
  }

  /** Sheet properties for molecules given as molfiles or SMILES. */
  async props(mols: string[]): Promise<(MolProps | { error: string })[]> {
    const r = await this.request<Extract<ChemResponse, { type: 'props' }>>((id) => ({ type: 'props', id, mols }));
    return r.results;
  }

  /** Which molecules contain the query structure (null where a molecule can't be read). */
  async substructure(query: string, mols: string[]): Promise<{ results: (boolean | null)[]; error?: string }> {
    const r = await this.request<Extract<ChemResponse, { type: 'substructure' }>>((id) => ({ type: 'substructure', id, query, mols }));
    return { results: r.results, error: r.error };
  }

  /** Which version of each named set the worker has (see substructureIn): its size and a hash of its SMILES. */
  private sets = new Map<string, string>();

  /**
   * Which of a set of SMILES (the Knowledge Base's) contain the query: their indexes. The worker
   * keeps the set ready between searches; it is sent again only when it changes.
   */
  async substructureIn(name: string, mols: string[], query: string): Promise<{ results: number[]; error?: string }> {
    const ask = (send: boolean) => this.request<Extract<ChemResponse, { type: 'substructureIn' }>>((id) => ({ type: 'substructureIn', id, name, query, ...(send ? { mols } : {}) }));
    let h = 0x811c9dc5;
    for (const s of mols) for (let i = 0; i <= s.length; i++) h = Math.imul(h ^ (i < s.length ? s.charCodeAt(i) : 10), 0x01000193);
    const version = `${mols.length}:${h >>> 0}`;
    let r = await ask(this.sets.get(name) !== version);
    this.sets.set(name, version);
    if (r.missing) r = await ask(true);
    return { results: r.results, error: r.error };
  }

  /** The Hammett groups at a core's marked positions in each molecule (SMILES or molfiles). */
  async hammett(core: string, mols: string[]): Promise<HammettResult[]> {
    const r = await this.request<Extract<ChemResponse, { type: 'hammett' }>>((id) => ({ type: 'hammett', id, core, mols }));
    return r.results;
  }

  /** For each molfile, the atoms it shares with `ref` (largest common substructure) as [ref atom, its atom] pairs, or null. */
  async common(ref: string, mols: string[]): Promise<([number, number][] | null)[]> {
    const r = await this.request<Extract<ChemResponse, { type: 'common' }>>((id) => ({ type: 'common', id, ref, mols }));
    return r.results;
  }

  /** Pieces of a structure (a molfile) when bonds between molfile atoms are broken. */
  async fragments(molblock: string, cuts: [number, number][]): Promise<MassFragment[] | { error: string }> {
    const r = await this.request<Extract<ChemResponse, { type: 'fragments' }>>((id) => ({ type: 'fragments', id, molblock, cuts }));
    return r.results;
  }

  /** A molfile as the systematic namer reads it, and its SMILES; nulls when RDKit can't read it. */
  async namerGraph(molblock: string): Promise<{ graph: NamerGraph | null; smiles: string | null }> {
    const r = await this.request<Extract<ChemResponse, { type: 'namerGraph' }>>((id) => ({ type: 'namerGraph', id, molblock }));
    return { graph: r.graph, smiles: r.smiles };
  }

  /** RDKit's own SMILES for a SMILES string, so two can be compared; null when it can't be read. */
  async canonical(smiles: string): Promise<string | null> {
    const r = await this.request<Extract<ChemResponse, { type: 'canonical' }>>((id) => ({ type: 'canonical', id, smiles }));
    return r.smiles;
  }

  /** Formula, pieces, symmetry-distinct carbons and H counts of SI compounds' structures (molfiles), for the SI checks. */
  async siFacts(mols: string[]): Promise<(MolFacts | null)[]> {
    const r = await this.request<Extract<ChemResponse, { type: 'siFacts' }>>((id) => ({ type: 'siFacts', id, mols }));
    return r.results;
  }
}

function defaultWorker(): WorkerLike {
  // Vite's development server can only serve workers that use `import` as modules.
  return (import.meta.env.DEV
    ? new Worker(new URL('../worker/chem-worker.ts', import.meta.url), { type: 'module' })
    : new Worker(new URL('../worker/chem-worker.ts', import.meta.url))) as unknown as WorkerLike;
}

/** A request as text without its id, to know it again. */
function requestKey(msg: ChemRequest): string {
  const { id: _id, ...rest } = msg as ChemRequest & { id?: number };
  return JSON.stringify(rest);
}
