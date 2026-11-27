// Main-thread side of the chemistry worker: sends requests and matches replies. Requests made
// while the engine loads wait for it (for LOAD_MS at most). When the engine breaks on a request
// (it says so, or the worker dies) or takes too long on one, the worker is restarted, the user is
// told in the status bar (onRestart), the other requests waiting are sent again, and only the
// structure to blame is kept back: a batch is worked through one structure at a time to find it.

import type { ChemRequest, ChemResponse, FragmentResult } from '../worker/chem-worker';
import type { StereoTags } from './stereo';
import type { MolProps } from '../sheet/properties';
import type { MassFragment } from './props';
import type { NamerGraph } from './namer-graph';
import type { HammettResult } from './hammett-match';
import type { MolFacts } from '../si/chem';

/**
 * How long the worker may be silent while a batch waits before it is taken to have hung: a batch
 * says `alive` between its structures, so this is the time one structure of it may take.
 */
export const WATCHDOG_MS = 45000;
/** How long one structure on its own may take (no word comes while it works): longer, so a slow one isn't taken for a hang. */
export const SINGLE_MS = 120000;
/** How long the engine may take to load before what waits is told it didn't. */
export const LOAD_MS = 60000;
/** Restarts with no request to blame (the worker died while idle) allowed within RESTART_WINDOW_MS; after that it is left stopped. */
const MAX_RESTARTS = 3;
const RESTART_WINDOW_MS = 5 * 60000;

/** What a request waiting when the engine stopped is told, when it can't be sent again. */
export const ENGINE_RESTARTED = 'The chemistry engine stopped and was restarted. Try again.';
/** What the request the engine broke on is told: its structure is kept back from now on, so the engine keeps working. */
export const ENGINE_BROKE = 'The chemistry engine stopped on this structure, so it is left out (the engine was restarted and works for everything else).';
/** What a request the engine took too long over is told (the first time; the second time it is kept back). */
export const ENGINE_SLOW = 'The chemistry engine took too long on this structure and was stopped (it was restarted). Try again; if it happens again, the structure is left out.';
/** What a structure that broke the engine before is told when it is asked again (it is not sent). */
export const ENGINE_SKIPPED = 'The chemistry engine stopped on this structure before, so it is not calculated again.';
/** What waits when the engine doesn't load in time. */
export const ENGINE_LOAD_SLOW = 'The chemistry engine did not load within a minute, so formulas, names and other chemistry are not available. Restart Chemweave to try again (the web version needs its internet connection to load it).';

/** Something that can stand in for a Web Worker (tests give a fake one). */
export interface WorkerLike {
  postMessage(m: unknown): void;
  terminate(): void;
  onmessage: ((e: MessageEvent) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
  onmessageerror: ((e: MessageEvent) => void) | null;
}

interface Pending { settle: (r: ChemResponse) => void; msg: ChemRequest }

type Batch = Extract<ChemRequest, { mols: unknown[] }>;
/** Requests over a list of structures, each answered in `results` in order, and what stands in for a structure left out. */
const STAND_IN: Partial<Record<ChemRequest['type'], (message: string) => unknown>> = {
  analyze: (message) => ({ formula: '', exact: 0, mw: 0, charge: 0, smiles: '', error: message }),
  stereo: () => ({ ok: false, atoms: [], bonds: [] }),
  props: (message) => ({ error: message }),
  siFacts: (message) => ({ info: null, generic: [], pieces: [], uniqueCarbons: 0, hTotal: 0, hExch: 0, error: message }),
  hammett: (message) => ({ error: message }),
  common: () => null,
  substructure: () => null,
};
const isBatch = (m: ChemRequest): m is Batch => m.type in STAND_IN && Array.isArray((m as Batch).mols);

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
  /** Requests sent or waiting to be, in the order made (a Map keeps it): the worker answers in order. */
  private pending = new Map<number, Pending>();
  /** Requests made before the engine is ready: sent once it is (or failed if it never loads). */
  private queued: { id: number; msg: ChemRequest }[] = [];
  /** Structures (one-structure requests, as text without their id) that broke the engine: not sent again. */
  private poisoned = new Set<string>();
  /** One-structure requests the engine took too long over once: kept back the second time. */
  private suspects = new Set<string>();
  private restarts: number[] = [];
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private loading: ReturnType<typeof setTimeout> | null = null;
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
      // (requests waiting from before a restart are answered with the error, not left waiting)
      this.failLoad('Background worker could not start: ' + String(e));
      return;
    }
    this.worker = w;
    w.onmessage = (e: MessageEvent) => { if (this.worker === w) this.receive(e.data as ChemResponse); };
    w.onerror = (e: ErrorEvent) => {
      if (this.worker !== w) return;
      // (while loading: the engine can't load; once loaded: the worker died on the request it was working on)
      if (this.ready) { this.restart('broke'); return; }
      this.failLoad('Chemistry engine failed to load: ' + (e.message || 'unknown error'));
    };
    w.onmessageerror = () => { if (this.worker === w && this.ready) this.restart('broke'); };
    // (an engine that never arrives, on a stalled connection, must not leave everything waiting)
    if (this.loading) clearTimeout(this.loading);
    this.loading = setTimeout(() => {
      this.loading = null;
      if (this.worker !== w || this.ready) return;
      try { w.terminate(); } catch { /* (already gone) */ }
      this.worker = null;
      this.failLoad(ENGINE_LOAD_SLOW);
      this.onRestart(ENGINE_LOAD_SLOW);
    }, LOAD_MS);
    w.postMessage({ type: 'init', js: this.js, wasm: this.wasm } satisfies ChemRequest);
  }

  private failLoad(message: string): void {
    if (this.loading) { clearTimeout(this.loading); this.loading = null; }
    this.error = message;
    for (const q of this.queued.splice(0)) this.pending.get(q.id)?.settle({ type: 'error', id: q.id, message });
    this.onReady();
  }

  private receive(m: ChemResponse): void {
    if (m.type === 'ready') {
      if (this.loading) { clearTimeout(this.loading); this.loading = null; }
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
    if (m.type === 'error' && m.fatal) { this.restart('broke'); return; }
    if (p) { this.pending.delete(id); p.settle(m); }
    this.arm();
  }

  /** The request the worker is working on: the oldest sent one still waiting. */
  private current(): [number, Pending] | null {
    for (const [id, p] of this.pending) if (!this.queued.some((q) => q.id === id)) return [id, p];
    return null;
  }

  /**
   * (Re)start the watchdog for the request being worked on: a batch may be silent WATCHDOG_MS
   * (it says `alive` between structures), one structure SINGLE_MS. A timer that fires far later
   * than set (the computer slept) starts again instead.
   */
  private arm(): void {
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = null;
    if (!this.ready) return;
    const cur = this.current();
    if (!cur) return;
    const limit = isBatch(cur[1].msg) && cur[1].msg.mols.length > 1 ? WATCHDOG_MS : SINGLE_MS;
    const set = Date.now();
    this.watchdog = setTimeout(() => {
      this.watchdog = null;
      if (Date.now() - set > limit + 15000) { this.arm(); return; }
      this.restart('slow');
    }, limit);
  }

  /**
   * Stop the worker and start a new one. The request it was working on is to blame: a batch is
   * worked through again one structure at a time; one structure that broke it is kept back (one
   * it was slow on, the second time). The other requests waiting are sent again to the new worker.
   */
  private restart(why: 'broke' | 'slow'): void {
    // (the new worker holds no sets)
    this.sets.clear();
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = null;
    try { this.worker?.terminate(); } catch { /* (already gone) */ }
    this.worker = null;
    this.ready = false;
    const cur = this.current();
    // everything else waiting goes again, in order, once the new engine is ready
    this.queued = [...this.pending].filter(([id]) => id !== cur?.[0]).map(([id, p]) => ({ id, msg: p.msg }));
    const what = why === 'slow' ? 'took too long' : 'stopped';
    if (cur) {
      const [id, p] = cur;
      this.pending.delete(id);
      if (isBatch(p.msg) && p.msg.mols.length > 1) {
        // (the culprit is one of its structures: each asked on its own finds it)
        void this.oneByOne(p.msg).then(p.settle, (e: unknown) => p.settle({ type: 'error', id, message: e instanceof Error ? e.message : String(e) }));
      } else {
        const k = requestKey(p.msg);
        let message = ENGINE_BROKE;
        if (why === 'slow' && !this.suspects.has(k)) { this.suspects.add(k); message = ENGINE_SLOW; }
        else this.poisoned.add(k);
        const stand = STAND_IN[p.msg.type];
        p.settle(stand ? ({ type: p.msg.type, id, results: [stand(message)], ms: 0 } as unknown as ChemResponse) : { type: 'error', id, message });
      }
      this.onRestart(`The chemistry engine ${what} on a structure and was restarted.`);
      this.start();
      return;
    }
    // (no request to blame: the worker died on its own; a few times at most)
    const now = Date.now();
    this.restarts = this.restarts.filter((t) => now - t < RESTART_WINDOW_MS);
    if (this.restarts.length >= MAX_RESTARTS) {
      this.error = 'The chemistry engine stopped again, so it was not restarted. Save your work and restart Chemweave to use it again.';
      for (const [qid, q] of [...this.pending]) { this.pending.delete(qid); q.settle({ type: 'error', id: qid, message: this.error }); }
      this.queued = [];
      this.onRestart(this.error);
      this.onReady();
      return;
    }
    this.restarts.push(now);
    this.onRestart('The chemistry engine stopped and was restarted.');
    this.start();
  }

  /** A batch asked one structure at a time, the answers put back together (a structure kept back gets its stand-in). */
  private async oneByOne(msg: Batch): Promise<ChemResponse> {
    const stand = STAND_IN[msg.type]!;
    const results: unknown[] = [];
    for (const item of msg.mols) {
      const r = await this.request<ChemResponse & { results: unknown[] }>((id) => ({ ...msg, id, mols: [item] }) as ChemRequest)
        .then((x) => x.results[0], (e: unknown) => stand(e instanceof Error ? e.message : String(e)));
      results.push(r);
    }
    return { type: msg.type, id: msg.id, results, ms: 0 } as unknown as ChemResponse;
  }

  private request<T extends ChemResponse>(build: (id: number) => ChemRequest): Promise<T> {
    const id = this.nextId++;
    const msg = build(id);
    // a batch with a structure kept back: the others asked, the kept one given its stand-in
    if (isBatch(msg) && this.poisoned.size && msg.mols.length > 1) {
      const kept = msg.mols.map((item) => this.poisoned.has(requestKey({ ...msg, mols: [item] } as ChemRequest)));
      if (kept.some(Boolean)) {
        const rest = msg.mols.filter((_, i) => !kept[i]);
        const stand = STAND_IN[msg.type]!;
        const asked = rest.length ? this.request<T & { results: unknown[] }>((i) => ({ ...msg, id: i, mols: rest }) as ChemRequest) : Promise.resolve({ results: [] as unknown[] } as T & { results: unknown[] });
        return asked.then((r) => {
          let k = 0;
          return { ...r, type: msg.type, id, results: msg.mols.map((_, i) => (kept[i] ? stand(ENGINE_SKIPPED) : r.results[k++])) } as unknown as T;
        });
      }
    }
    return new Promise<T>((resolve, reject) => {
      if (this.poisoned.size && this.poisoned.has(requestKey(msg))) {
        const stand = STAND_IN[msg.type];
        if (stand) resolve({ type: msg.type, id, results: [stand(ENGINE_SKIPPED)], ms: 0 } as unknown as T);
        else reject(new Error(ENGINE_SKIPPED));
        return;
      }
      // (an engine that couldn't load, or was left stopped: no answer will come)
      if (this.error && !this.ready) { reject(new Error(this.error)); return; }
      this.pending.set(id, { msg, settle: (r) => { this.pending.delete(id); if (r.type === 'error') reject(new Error(r.message)); else resolve(r as T); } });
      if (this.ready && this.worker) { this.worker.postMessage(msg); if (!this.watchdog) this.arm(); }
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
    let h = 0x811c9dc5;
    for (const s of mols) for (let i = 0; i <= s.length; i++) h = Math.imul(h ^ (i < s.length ? s.charCodeAt(i) : 10), 0x01000193);
    const version = `${mols.length}:${h >>> 0}`;
    // the version is noted as the request is made: the worker takes requests in that order, so a
    // search made while another set is on its way sends its own set again
    const ask = (send: boolean) => {
      if (send) this.sets.set(name, version);
      return this.request<Extract<ChemResponse, { type: 'substructureIn' }>>((id) => ({ type: 'substructureIn', id, name, query, ...(send ? { mols } : {}) }));
    };
    let r = await ask(this.sets.get(name) !== version);
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
