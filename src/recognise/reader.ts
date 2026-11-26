// Reading structures from pictures, the one step File > Import > From PDF and From Picture share.
// Two readers: the one on this computer (MolScribe, in a worker; its model pack downloads once,
// in the desktop app), and the person's own AI model when they linked one (Edit > Settings > AI
// Model). Nothing leaves the computer unless they chose the AI model for this read.

import { invoke, isTauri } from '@tauri-apps/api/core';
import type { RecogniseRequest, RecogniseResponse } from '../worker/recognise-worker';
import type { ReadGraph, Vocab } from './molscribe';
import type { Pixels } from './picture';
import { aiAsk, type AiPrefs } from '../ai/link';

/** The release the model pack is published as (.github/workflows/recognition-model.yml). */
export const PACK = 'recognition-model-1';
/** About how much it downloads, to say before it does. */
export const PACK_MB = 140;

/** Whether this computer can read structures without an AI model (the desktop app). */
export const canReadHere = isTauri();

export async function packReady(): Promise<boolean> {
  return canReadHere && invoke<boolean>('pack_ready', { pack: PACK }).catch(() => false);
}

/** Download the pack, telling `progress` the share done (0 to 1). */
export async function downloadPack(progress: (share: number) => void): Promise<void> {
  const { listen } = await import('@tauri-apps/api/event');
  const stop = await listen<{ done: number; total: number }>('pack-progress', (e) => progress(e.payload.total ? e.payload.done / e.payload.total : 0));
  try {
    await invoke('pack_download', { pack: PACK });
  } finally {
    stop();
  }
}

/** Stop a download under way: downloadPack then fails with "Cancelled.". */
export async function cancelPack(): Promise<void> {
  await invoke('pack_cancel');
}

/** One structure read from a picture: the drawing's atoms and bonds, or SMILES (an AI model's answer). */
export type ReadResult =
  | { kind: 'graph'; graph: ReadGraph; w: number; h: number; ms: number; /** Of `ms`, the picture's encoder, and where it ran. */ encodeMs?: number; engine?: Engine }
  | { kind: 'smiles'; smiles: string; note: string; ms: number };

/** Where the picture's encoder runs: native ONNX Runtime in the desktop app, or WebAssembly in the worker. */
export type Engine = 'native' | 'wasm';

/** The native encoder failed: read again with the WebAssembly one. */
class NativeFailure extends Error {}

export class LocalReader {
  private worker: Worker | null = null;
  private loading: Promise<void> | null = null;
  private nextId = 1;
  private pending = new Map<number, { ok: (r: Extract<RecogniseResponse, { type: 'read' }>) => void; fail: (e: Error) => void }>();
  /** Whether to try the native encoder (src-tauri/src/recognise_native.rs) before the WebAssembly one. */
  private tryNative: boolean;
  /** Where the encoder runs once loaded. */
  engine: Engine | null = null;
  /** Why the native encoder isn't used, when it isn't. */
  nativeProblem = '';

  constructor(opts: { native?: boolean } = {}) {
    this.tryNative = opts.native ?? true;
  }

  /** Load the model (it must be downloaded already). */
  load(): Promise<void> {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const native = this.tryNative && (await invoke('recognise_native_ready', { pack: PACK }).then(() => true, (e) => { this.nativeProblem = String(e); return false; }));
      const file = async (name: string) => invoke<ArrayBuffer>('pack_read', { pack: PACK, name });
      // the encoder is most of the pack (124 MB): not read into the worker when it runs natively
      const [encoder, step, edges, wasm, vocabBytes] = await Promise.all([native ? null : 'encoder.onnx', 'step.onnx', 'edges.onnx', 'ort-wasm-simd-threaded.wasm', 'vocab.json'].map((n) => (n ? file(n) : null)));
      const vocab = JSON.parse(new TextDecoder().decode(vocabBytes!)) as Vocab;
      // Vite's development server can only serve workers that use `import` as modules
      const w = import.meta.env.DEV
        ? new Worker(new URL('../worker/recognise-worker.ts', import.meta.url), { type: 'module' })
        : new Worker(new URL('../worker/recognise-worker.ts', import.meta.url));
      this.worker = w;
      await new Promise<void>((resolve, reject) => {
        w.onmessage = (e: MessageEvent<RecogniseResponse>) => {
          const m = e.data;
          if (m.type === 'ready') { w.onmessage = (ev) => this.receive(w, ev.data); resolve(); }
          else if (m.type === 'error') reject(new Error(m.message));
        };
        w.onerror = (e) => reject(new Error('The structure reader could not start: ' + (e.message || 'unknown error')));
        const msg: RecogniseRequest = { type: 'init', encoder, step: step!, edges: edges!, wasm: wasm!, vocab, loader: new URL('ort-wasm-simd-threaded.mjs', document.baseURI).href };
        w.postMessage(msg, [encoder, step!, edges!, wasm!].filter((b): b is ArrayBuffer => !!b));
      });
      this.engine = native ? 'native' : 'wasm';
    })();
    this.loading.catch(() => { this.loading = null; this.worker?.terminate(); this.worker = null; });
    return this.loading;
  }

  private receive(w: Worker, m: RecogniseResponse): void {
    if (m.type === 'encode') { void this.encodeNatively(w, m.req, m.image); return; }
    if (m.type === 'ready' || m.id === undefined) return;
    const p = this.pending.get(m.id);
    if (!p) return;
    this.pending.delete(m.id);
    if (m.type === 'read') p.ok(m);
    else p.fail(m.native ? new NativeFailure(m.message) : new Error(m.message));
  }

  /** A picture the worker sent to encode natively: its keys and values go back to it, or why not. */
  private async encodeNatively(w: Worker, req: number, image: Float32Array): Promise<void> {
    let answer: RecogniseRequest;
    try {
      const out = new Float32Array(await invoke<ArrayBuffer>('recognise_encode', new Uint8Array(image.buffer, image.byteOffset, image.byteLength), { headers: { pack: PACK } }));
      const half = out.length / 2;
      answer = { type: 'encoded', req, ck: out.slice(0, half), cv: out.slice(half) };
    } catch (e) {
      answer = { type: 'encoded', req, error: String(e) };
    }
    w.postMessage(answer, answer.ck && answer.cv ? [answer.ck.buffer, answer.cv.buffer] : []);
  }

  /** Give up on the native encoder for this session: the worker starts again with the WebAssembly one. */
  private useWasm(why: string): void {
    this.tryNative = false;
    this.nativeProblem = why;
    this.engine = null;
    this.worker?.terminate();
    this.worker = null;
    this.loading = null;
    // pictures waiting in the old worker are read again by the new one
    const waiting = [...this.pending.values()];
    this.pending.clear();
    for (const p of waiting) p.fail(new NativeFailure(why));
  }

  async read(pixels: Pixels): Promise<ReadResult> {
    await this.load();
    const engine = this.engine ?? undefined;
    const id = this.nextId++;
    try {
      const r = await new Promise<Extract<RecogniseResponse, { type: 'read' }>>((ok, fail) => {
        this.pending.set(id, { ok, fail });
        const msg: RecogniseRequest = { type: 'read', id, pixels };
        this.worker!.postMessage(msg);
      });
      return { kind: 'graph', graph: r.graph, w: r.w, h: r.h, ms: r.ms, encodeMs: r.encodeMs, engine };
    } catch (e) {
      if (!(e instanceof NativeFailure)) throw e;
      if (this.tryNative) {
        console.warn('The native structure reader failed; using the WebAssembly one.', e.message);
        this.useWasm(e.message);
      }
      return this.read(pixels);
    }
  }
}

export const localReader = new LocalReader();

const AI_SYSTEM = 'You are an expert synthetic organic chemist transcribing chemical structure drawings exactly as drawn. '
  + 'Work atom by atom: count ring sizes and chain carbons, place every heteroatom, charge and multiple bond, and keep the stereochemistry the wedges and hashes show. '
  + 'Expand abbreviations (Ph, OMe, Boc, Ts, TBS, CO2Et) into atoms. Hand drawings may be messy: read what the chemist meant.';

const AI_ASK = 'Give the structure in this picture as one SMILES string. Answer with JSON only: {"smiles": "...", "note": "anything unclear, or empty"}. '
  + 'If there are several separate molecules, join them with a dot. If there is no chemical structure, give "smiles": "".';

/** Ask the linked AI model for the SMILES of the structure in a picture (a PNG, as base64). */
export async function readWithAi(prefs: AiPrefs, png: string): Promise<ReadResult> {
  const t0 = performance.now();
  const text = await aiAsk(prefs, { system: AI_SYSTEM, text: AI_ASK, images: [{ mime: 'image/png', data: png }], maxTokens: 2000 });
  const { smiles, note } = parseAiAnswer(text);
  return { kind: 'smiles', smiles, note, ms: Math.round(performance.now() - t0) };
}

/** The SMILES and note in a model's answer (JSON, perhaps in a code block or with words round it). */
export function parseAiAnswer(text: string): { smiles: string; note: string } {
  const json = /\{[\s\S]*\}/.exec(text)?.[0];
  if (json) {
    try {
      const o = JSON.parse(json) as { smiles?: unknown; note?: unknown };
      return { smiles: typeof o.smiles === 'string' ? o.smiles.trim() : '', note: typeof o.note === 'string' ? o.note.trim() : '' };
    } catch { /* not JSON after all */ }
  }
  const line = text.trim().split(/\s+/).find((w) => /^[A-Za-z0-9@+\-[\]()=#$/\\%.:*]+$/.test(w) && /[A-Z]/i.test(w));
  return { smiles: line ?? '', note: '' };
}
