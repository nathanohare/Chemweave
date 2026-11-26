// The structure reader, off the main thread: the model pack's three parts in ONNX Runtime's
// WebAssembly build, and readStructure's decoding (src/recognise/molscribe.ts). Pictures come in
// as pixels; what was read goes back as atoms, places and bonds.
//
// In the desktop app the encoder and the decoder's steps run in native ONNX Runtime instead
// (src-tauri/src/recognise_native.rs), which only the page can reach: the worker is then started
// with only the bond reader, sends each picture's pixels to the page ('decode') and waits for the
// decoder's tokens, scores and hidden states ('decoded'). Reading the tokens and the bond reader
// stay here either way (graphFrom).

import '../old-webkit';
import * as ort from 'onnxruntime-web/wasm';
import { decodeTokens, graphFrom, imageTensor, type ReadGraph, type Runner, type T, type Vocab } from '../recognise/molscribe';
import { cropWhite, resize, type Pixels } from '../recognise/picture';
import { pageDecoder, workerDispatch, type DecodedMsg } from '../recognise/native-read';

export type RecogniseRequest =
  | {
    type: 'init';
    /** null (with step): the page reads pictures natively and only the bond reader runs here. */
    encoder: ArrayBuffer | null;
    step: ArrayBuffer | null;
    edges: ArrayBuffer;
    wasm: ArrayBuffer;
    vocab: Vocab;
    /** The runtime's loader, beside the app (public/). */
    loader: string;
  }
  | { type: 'read'; id: number; pixels: Pixels }
  /** The page's answer to 'decode': what the decoder wrote, or why it failed. */
  | DecodedMsg;

export type RecogniseResponse =
  | { type: 'ready'; ms: number }
  | { type: 'read'; id: number; graph: ReadGraph; w: number; h: number; ms: number; /** Of `ms`, the model's share: encoder and decoder natively, the encoder in WebAssembly. */ modelMs: number }
  | { type: 'error'; id?: number; message: string; /** The native reader failed (the page then falls back to WebAssembly). */ native?: boolean }
  /** Asks the page to read a picture natively: its pixels, already the model's square (RGBA). */
  | { type: 'decode'; req: number; rgba: Uint8ClampedArray };

const post = (m: RecogniseResponse, transfer: Transferable[] = []) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m, transfer);

let runner: Runner | null = null;
let vocab: Vocab | null = null;
let native = false;
let encodeMs = 0;
// pictures sent to the page to read natively, waiting for its answer
const onPage = pageDecoder((m, transfer) => post(m, transfer));

async function init(m: Extract<RecogniseRequest, { type: 'init' }>): Promise<void> {
  const t0 = performance.now();
  ort.env.wasm.wasmBinary = m.wasm;
  ort.env.wasm.wasmPaths = { mjs: m.loader };
  ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
  const opts: ort.InferenceSession.SessionOptions = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' };
  native = !m.encoder || !m.step;
  const E = native ? null : await ort.InferenceSession.create(new Uint8Array(m.encoder!), opts);
  const S = native ? null : await ort.InferenceSession.create(new Uint8Array(m.step!), opts);
  const G = await ort.InferenceSession.create(new Uint8Array(m.edges), opts);
  const v = m.vocab;
  const i64 = (n: number, dims: number[]) => new ort.Tensor('int64', BigInt64Array.from([BigInt(n)]), dims);
  const notHere = () => { throw new Error('The structure reader reads natively here.'); };
  runner = {
    async encode(img) {
      if (!E) return notHere();
      const e0 = performance.now();
      const r = await E.run({ image: new ort.Tensor('float32', img, [1, 3, v.size, v.size]) });
      encodeMs = performance.now() - e0;
      return { ck: r.ck as unknown as T, cv: r.cv as unknown as T };
    },
    async step(token, pos, pk, pv, ck, cv) {
      if (!S) return notHere();
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
  let modelMs: number;
  let decoded;
  if (native) {
    const d0 = performance.now();
    decoded = await onPage.decode(square.data);
    modelMs = performance.now() - d0;
  } else {
    decoded = await decodeTokens(runner, vocab, imageTensor(square.data, vocab.size));
    modelMs = encodeMs;
  }
  const graph = await graphFrom(runner, vocab, decoded);
  post({ type: 'read', id: m.id, graph, w: cropped.width, h: cropped.height, ms: Math.round(performance.now() - t0), modelMs: Math.round(modelMs) });
}

const dispatch = workerDispatch<Exclude<RecogniseRequest, DecodedMsg>>((m) => (m.type === 'init' ? init(m) : read(m)), onPage.answer, post);
self.onmessage = (e: MessageEvent<RecogniseRequest>) => dispatch(e.data);
