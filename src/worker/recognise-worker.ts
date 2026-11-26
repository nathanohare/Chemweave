// The structure reader, off the main thread: the model pack's three parts in ONNX Runtime's
// WebAssembly build, and readStructure's decoding (src/recognise/molscribe.ts). Pictures come in
// as pixels; what was read goes back as atoms, places and bonds.
//
// In the desktop app the picture's encoder (the slow part) runs in native ONNX Runtime instead
// (src-tauri/src/recognise_native.rs), which only the page can reach: the worker is then started
// without the encoder, sends each picture to the page ('encode') and waits for the keys and values
// ('encoded'). The decoder's steps and the bond reader stay here either way.

import '../old-webkit';
import * as ort from 'onnxruntime-web/wasm';
import { imageTensor, readStructure, type ReadGraph, type Runner, type T, type Vocab } from '../recognise/molscribe';
import { cropWhite, resize, type Pixels } from '../recognise/picture';

export type RecogniseRequest =
  | { type: 'init'; /** null: the page encodes pictures natively. */ encoder: ArrayBuffer | null; step: ArrayBuffer; edges: ArrayBuffer; wasm: ArrayBuffer; vocab: Vocab; /** The runtime's loader, beside the app (public/). */ loader: string }
  | { type: 'read'; id: number; pixels: Pixels }
  /** The page's answer to 'encode': the encoder's keys and values, or why it failed. */
  | { type: 'encoded'; req: number; ck?: Float32Array; cv?: Float32Array; error?: string };

export type RecogniseResponse =
  | { type: 'ready'; ms: number }
  | { type: 'read'; id: number; graph: ReadGraph; w: number; h: number; ms: number; /** Of `ms`, the encoder's share. */ encodeMs: number }
  | { type: 'error'; id?: number; message: string; /** The native encoder failed (the page then falls back to WebAssembly). */ native?: boolean }
  /** Asks the page to encode a picture natively (3 × size × size, as the encoder takes it). */
  | { type: 'encode'; req: number; image: Float32Array };

const post = (m: RecogniseResponse, transfer: Transferable[] = []) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m, transfer);

/** The native encoder failed: the page reads the picture again with the WebAssembly encoder. */
export class NativeEncodeError extends Error {}

let runner: Runner | null = null;
let vocab: Vocab | null = null;
let encodeMs = 0;
// one picture at a time: the reader is busy for seconds, and the runtime isn't re-entrant
let queue: Promise<void> = Promise.resolve();
// pictures sent to the page to encode, waiting for its answer
let nextReq = 1;
const waiting = new Map<number, { ok: (r: { ck: Float32Array; cv: Float32Array }) => void; fail: (e: Error) => void }>();

/** The encoder's keys and values from the page (native ONNX Runtime). */
function encodeOnPage(img: Float32Array): Promise<{ ck: Float32Array; cv: Float32Array }> {
  return new Promise((ok, fail) => {
    const req = nextReq++;
    waiting.set(req, { ok, fail });
    post({ type: 'encode', req, image: img }, [img.buffer]);
  });
}

async function init(m: Extract<RecogniseRequest, { type: 'init' }>): Promise<void> {
  const t0 = performance.now();
  ort.env.wasm.wasmBinary = m.wasm;
  ort.env.wasm.wasmPaths = { mjs: m.loader };
  ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
  const opts: ort.InferenceSession.SessionOptions = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' };
  const E = m.encoder ? await ort.InferenceSession.create(new Uint8Array(m.encoder), opts) : null;
  const [S, G] = [await ort.InferenceSession.create(new Uint8Array(m.step), opts), await ort.InferenceSession.create(new Uint8Array(m.edges), opts)];
  const v = m.vocab;
  const i64 = (n: number, dims: number[]) => new ort.Tensor('int64', BigInt64Array.from([BigInt(n)]), dims);
  const kv = (data: Float32Array) => new ort.Tensor('float32', data, [v.layers, 1, v.heads, data.length / (v.layers * v.heads * v.dk), v.dk]) as unknown as T;
  runner = {
    async encode(img) {
      const e0 = performance.now();
      try {
        if (E) {
          const r = await E.run({ image: new ort.Tensor('float32', img, [1, 3, v.size, v.size]) });
          return { ck: r.ck as unknown as T, cv: r.cv as unknown as T };
        }
        const { ck, cv } = await encodeOnPage(img);
        if (ck.length !== cv.length || !ck.length || ck.length % (v.layers * v.heads * v.dk)) throw new NativeEncodeError('The native encoder gave an answer of the wrong size.');
        return { ck: kv(ck), cv: kv(cv) };
      } finally {
        encodeMs = performance.now() - e0;
      }
    },
    async step(token, pos, pk, pv, ck, cv) {
      const r = await S.run({ token: i64(token, [1]), pos: i64(pos, []), pk: pk as unknown as ort.Tensor, pv: pv as unknown as ort.Tensor, ck: ck as unknown as ort.Tensor, cv: cv as unknown as ort.Tensor });
      return { logp: r.logp.data as Float32Array, hidden: r.hidden.data as Float32Array, nk: r.nk as unknown as T, nv: r.nv as unknown as T };
    },
    async edges(h, k) {
      const r = await G.run({ hidden: new ort.Tensor('float32', h, [k, h.length / k]) });
      return r.probs.data as Float32Array;
    },
    empty() {
      return new ort.Tensor('float32', new Float32Array(0), [v.layers, 1, v.heads, 0, v.dk]) as unknown as T;
    },
  };
  vocab = v;
  post({ type: 'ready', ms: Math.round(performance.now() - t0) });
}

async function read(m: Extract<RecogniseRequest, { type: 'read' }>): Promise<void> {
  if (!runner || !vocab) throw new Error('The structure reader is not loaded yet.');
  const t0 = performance.now();
  const cropped = cropWhite(m.pixels, 5);
  const square = resize(cropped, vocab.size, vocab.size);
  const graph = await readStructure(runner, vocab, imageTensor(square.data, vocab.size));
  post({ type: 'read', id: m.id, graph, w: cropped.width, h: cropped.height, ms: Math.round(performance.now() - t0), encodeMs: Math.round(encodeMs) });
}

self.onmessage = (e: MessageEvent<RecogniseRequest>) => {
  const m = e.data;
  // the page's answers go straight to the picture waiting for them (it holds the queue)
  if (m.type === 'encoded') {
    const w = waiting.get(m.req);
    waiting.delete(m.req);
    if (!w) return;
    if (m.ck && m.cv) w.ok({ ck: m.ck, cv: m.cv });
    else w.fail(new NativeEncodeError(m.error || 'The native encoder failed.'));
    return;
  }
  queue = queue.then(() => (m.type === 'init' ? init(m) : read(m))).catch((err) => {
    post({ type: 'error', id: m.type === 'read' ? m.id : undefined, message: err instanceof Error ? err.message : String(err), native: err instanceof NativeEncodeError || undefined });
  });
};
