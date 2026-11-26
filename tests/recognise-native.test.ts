// @vitest-environment jsdom
//
// The structure reader's picture encoder runs natively in the desktop app when it can
// (src-tauri/src/recognise_native.rs), and the reader falls back to the WebAssembly encoder when
// the native one isn't there or fails, without losing the picture being read. The desktop
// commands and the worker are stood in for here.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls: { cmd: string; args: unknown; opts?: unknown }[] = [];
let nativeReady = true;
let nativeEncodeFails = false;

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: async (cmd: string, args: unknown, opts?: unknown) => {
    calls.push({ cmd, args, opts });
    if (cmd === 'recognise_native_ready') {
      if (!nativeReady) throw 'This copy of the app has no onnxruntime.dll.';
      return null;
    }
    if (cmd === 'recognise_encode') {
      if (nativeEncodeFails) throw 'The encoder failed: out of memory';
      // keys then values: 2 × (layers 1 × heads 1 × 1 token × dk 2)
      return new Float32Array([1, 2, 3, 4]).buffer;
    }
    if (cmd === 'pack_read') {
      const name = (args as { name: string }).name;
      if (name === 'vocab.json') return new TextEncoder().encode(JSON.stringify({ layers: 1, heads: 1, dk: 2, size: 384 })).buffer;
      return new ArrayBuffer(8);
    }
    throw new Error('unexpected ' + cmd);
  },
}));

/** The worker, as far as the page sees it: native when started without the encoder. */
class FakeWorker {
  static started: FakeWorker[] = [];
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: { message: string }) => void) | null = null;
  native = false;
  terminated = false;
  encodedFromPage: unknown[] = [];
  private waiting: ((m: { ck?: Float32Array; error?: string }) => void) | null = null;
  constructor() { FakeWorker.started.push(this); }
  private send(data: unknown) { setTimeout(() => { if (!this.terminated) this.onmessage?.({ data }); }, 0); }
  postMessage(m: { type: string; id?: number; encoder?: ArrayBuffer | null; req?: number; ck?: Float32Array; error?: string }) {
    if (m.type === 'init') { this.native = !m.encoder; this.send({ type: 'ready', ms: 1 }); return; }
    if (m.type === 'encoded') { this.encodedFromPage.push(m); this.waiting?.(m); return; }
    if (m.type === 'read') {
      const id = m.id!;
      const done = (smiles: string) => this.send({ type: 'read', id, graph: { smiles, symbols: [], coords: [], edges: [], atomScores: [], confidence: 1 }, w: 10, h: 10, ms: 50, encodeMs: 20 });
      if (!this.native) { done('wasm'); return; }
      this.waiting = (a) => (a.ck ? done('native') : this.send({ type: 'error', id, message: a.error, native: true }));
      this.send({ type: 'encode', req: 1, image: new Float32Array(3 * 2 * 2) });
    }
  }
  terminate() { this.terminated = true; }
}
vi.stubGlobal('Worker', FakeWorker);

const { LocalReader } = await import('../src/recognise/reader');
const pixels = { width: 2, height: 2, data: new Uint8ClampedArray(16).fill(255) };
const asked = (cmd: string) => calls.filter((c) => c.cmd === cmd);
const readFiles = () => asked('pack_read').map((c) => (c.args as { name: string }).name);

beforeEach(() => {
  calls.length = 0;
  FakeWorker.started.length = 0;
  nativeReady = true;
  nativeEncodeFails = false;
});

describe('structure reader: native encoder', () => {
  it('encodes natively, sending the picture as bytes, and never reads the encoder into the worker', async () => {
    const r = new LocalReader();
    const got = await r.read(pixels);
    expect(got).toMatchObject({ kind: 'graph', engine: 'native', encodeMs: 20 });
    expect(got.kind === 'graph' && got.graph.smiles).toBe('native');
    expect(r.engine).toBe('native');
    expect(readFiles()).not.toContain('encoder.onnx');
    const enc = asked('recognise_encode')[0];
    expect(enc.args).toBeInstanceOf(Uint8Array);
    expect((enc.args as Uint8Array).byteLength).toBe(3 * 2 * 2 * 4);
    expect(enc.opts).toEqual({ headers: { pack: 'recognition-model-1' } });
    // keys and values split in half for the worker
    const back = FakeWorker.started[0].encodedFromPage[0] as { ck: Float32Array; cv: Float32Array };
    expect([...back.ck]).toEqual([1, 2]);
    expect([...back.cv]).toEqual([3, 4]);
  });

  it('uses the WebAssembly encoder when the native one is not there', async () => {
    nativeReady = false;
    const r = new LocalReader();
    const got = await r.read(pixels);
    expect(got.kind === 'graph' && got.graph.smiles).toBe('wasm');
    expect(r.engine).toBe('wasm');
    expect(r.nativeProblem).toMatch(/no onnxruntime\.dll/);
    expect(readFiles()).toContain('encoder.onnx');
    expect(asked('recognise_encode')).toHaveLength(0);
  });

  it('reads the picture again with the WebAssembly encoder when the native one fails', async () => {
    nativeEncodeFails = true;
    const r = new LocalReader();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const got = await r.read(pixels);
    warn.mockRestore();
    expect(got.kind === 'graph' && got.graph.smiles).toBe('wasm');
    expect(r.engine).toBe('wasm');
    expect(r.nativeProblem).toMatch(/out of memory/);
    expect(FakeWorker.started).toHaveLength(2);
    expect(FakeWorker.started[0].terminated).toBe(true);
    // and the next picture goes straight to the WebAssembly encoder
    calls.length = 0;
    const again = await r.read(pixels);
    expect(again.kind === 'graph' && again.graph.smiles).toBe('wasm');
    expect(asked('recognise_encode')).toHaveLength(0);
    expect(asked('recognise_native_ready')).toHaveLength(0);
  });

  it('pictures waiting when the native encoder fails are all read', async () => {
    nativeEncodeFails = true;
    const r = new LocalReader();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const got = await Promise.all([r.read(pixels), r.read(pixels), r.read(pixels)]);
    warn.mockRestore();
    expect(got.map((g) => g.kind === 'graph' && g.graph.smiles)).toEqual(['wasm', 'wasm', 'wasm']);
  });

  it('a reader told not to use the native encoder never asks for it', async () => {
    const r = new LocalReader({ native: false });
    await r.read(pixels);
    expect(asked('recognise_native_ready')).toHaveLength(0);
    expect(r.engine).toBe('wasm');
  });
});
