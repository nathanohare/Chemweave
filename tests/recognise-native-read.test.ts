// The structure reader's worker, when its model runs natively in the desktop app: pictures go to
// the page as pixels and come back as the decoder's tokens, scores and hidden states; the page's
// answers bypass the one-at-a-time queue; a native failure is marked so the page falls back
// (src/recognise/native-read.ts, used by src/worker/recognise-worker.ts and src/recognise/reader.ts).
// Also: the worker's reading of the tokens is the same whether they came from WebAssembly or natively.

import { describe, it, expect } from 'vitest';
import { checkDecoded, NativeReadError, pageDecoder, parseDecoded, workerDispatch, type DecodedMsg } from '../src/recognise/native-read';
import { decodeTokens, graphFrom, readStructure, type Runner, type T, type Vocab } from '../src/recognise/molscribe';

const tick = () => new Promise((r) => setTimeout(r, 0));
const ok = (req: number): DecodedMsg => ({ type: 'decoded', req, seq: new Int32Array([5, 2]), scores: new Float32Array([-0.5, -0.1]), hidden: new Float32Array([1, 2, 3, 4]), dim: 2 });

describe('structure reader: reading on the page', () => {
  it('sends the pixels (handed over) and resolves with the decoder\'s output', async () => {
    const sent: { m: { req: number; rgba: Uint8ClampedArray }; transfer: Transferable[] }[] = [];
    const dec = pageDecoder((m, transfer) => sent.push({ m, transfer }));
    const rgba = new Uint8ClampedArray(16);
    const p = dec.decode(rgba);
    expect(sent[0].transfer).toEqual([rgba.buffer]);
    dec.answer(ok(sent[0].m.req));
    expect(await p).toEqual({ seq: [5, 2], scores: [-0.5, expect.closeTo(-0.1, 6)], hidden: new Float32Array([1, 2, 3, 4]), dim: 2 });
  });

  it('matches answers to their own pictures, in any order; a stray answer is ignored', async () => {
    const reqs: number[] = [];
    const dec = pageDecoder((m) => reqs.push(m.req));
    const a = dec.decode(new Uint8ClampedArray(4)), b = dec.decode(new Uint8ClampedArray(4));
    dec.answer({ ...ok(reqs[1]), seq: new Int32Array([9, 2]) });
    dec.answer(ok(reqs[0]));
    expect((await a).seq).toEqual([5, 2]);
    expect((await b).seq).toEqual([9, 2]);
    dec.answer({ type: 'decoded', req: 999, error: 'late' });
  });

  it('a failed or misshapen answer is a native failure', async () => {
    const reqs: number[] = [];
    const dec = pageDecoder((m) => reqs.push(m.req));
    const p = dec.decode(new Uint8ClampedArray(4));
    dec.answer({ type: 'decoded', req: reqs[0], error: 'ONNX Runtime could not be loaded' });
    await expect(p).rejects.toBeInstanceOf(NativeReadError);
    const q = dec.decode(new Uint8ClampedArray(4));
    dec.answer({ ...ok(reqs[1]), hidden: new Float32Array(3) });
    await expect(q).rejects.toBeInstanceOf(NativeReadError);
  });

  it('checks the shape of what the decoder wrote', () => {
    expect(() => checkDecoded({ seq: [1], scores: [0], hidden: new Float32Array(4), dim: 4 })).not.toThrow();
    expect(() => checkDecoded({ seq: [], scores: [], hidden: new Float32Array(0), dim: 4 })).toThrow(NativeReadError);
    expect(() => checkDecoded({ seq: [1, 2], scores: [0], hidden: new Float32Array(8), dim: 4 })).toThrow(NativeReadError);
    expect(() => checkDecoded({ seq: [1], scores: [0], hidden: new Float32Array(4), dim: 0 })).toThrow(NativeReadError);
  });

  it('unpacks the desktop app\'s answer (the layout recognise_model.rs writes)', () => {
    const b = new DataView(new ArrayBuffer(8 + 8 * 2 + 4 * 2 * 3));
    b.setUint32(0, 2, true); b.setUint32(4, 3, true);
    b.setInt32(8, 40, true); b.setInt32(12, 2, true);
    b.setFloat32(16, -1.5, true); b.setFloat32(20, -0.5, true);
    for (let i = 0; i < 6; i++) b.setFloat32(24 + 4 * i, i + 0.5, true);
    const d = parseDecoded(b.buffer);
    expect([...d.seq]).toEqual([40, 2]);
    expect([...d.scores]).toEqual([-1.5, -0.5]);
    expect([...d.hidden]).toEqual([0.5, 1.5, 2.5, 3.5, 4.5, 5.5]);
    expect(d.dim).toBe(3);
    expect(() => parseDecoded(new ArrayBuffer(4))).toThrow(NativeReadError);
    expect(() => parseDecoded(b.buffer.slice(0, 30))).toThrow(NativeReadError);
  });
});

describe('structure reader: the worker\'s queue', () => {
  type Msg = { type: 'read'; id: number } | { type: 'init' };

  it('answers reach a waiting picture though it holds the queue; a native failure is marked; the next read still runs', async () => {
    const posted: { type: 'error'; id?: number; message: string; native?: boolean }[] = [];
    const reqs: number[] = [];
    const dec = pageDecoder((m) => reqs.push(m.req));
    const done: number[] = [];
    const dispatch = workerDispatch<Msg>(async (m) => {
      if (m.type === 'read') { await dec.decode(new Uint8ClampedArray(4)); done.push(m.id); }
    }, dec.answer, (m) => posted.push(m));
    dispatch({ type: 'read', id: 1 });
    dispatch({ type: 'read', id: 2 });
    await tick();
    expect(reqs).toHaveLength(1); // the second read waits its turn
    dispatch({ type: 'decoded', req: reqs[0], error: 'out of memory' });
    await tick(); await tick();
    expect(posted).toEqual([{ type: 'error', id: 1, message: 'out of memory', native: true }]);
    expect(reqs).toHaveLength(2); // the queue moved on
    dispatch(ok(reqs[1]));
    await tick(); await tick();
    expect(done).toEqual([2]);
  });

  it('other failures are not marked native', async () => {
    const posted: { native?: boolean; id?: number }[] = [];
    const dispatch = workerDispatch<Msg>(async () => { throw new Error('The structure reader is not loaded yet.'); }, () => {}, (m) => posted.push(m));
    dispatch({ type: 'read', id: 7 });
    dispatch({ type: 'init' });
    await tick(); await tick();
    expect(posted.map((p) => [p.id, p.native])).toEqual([[7, undefined], [undefined, undefined]]);
  });
});

describe('structure reader: decoding, split in two', () => {
  // a tiny made-up model: 6 words (C, N, ...), then 4 x places, 4 y places; it writes C, x, y, N, x, y, end
  const v: Vocab = { itos: ['<pad>', '<sos>', '<eos>', '<unk>', 'C', 'N'], offset: 6, maxx: 4, maxy: 4, special: 4, layers: 1, heads: 1, dk: 1, maxLen: 20, size: 1 };
  const script = [4, 7, 12, 5, 9, 11, 2];
  const tensor = (n: number) => ({ data: new Float32Array(n), dims: [n] }) as T;
  const runner = (): Runner => ({
    encode: async () => ({ ck: tensor(1), cv: tensor(1) }),
    step: async (_tok, pos) => {
      const logp = new Float32Array(14).fill(-9);
      logp[script[pos]] = -0.1 * (pos + 1);
      return { logp, hidden: new Float32Array([pos, pos + 0.5]), nk: tensor(1), nv: tensor(1) };
    },
    edges: async (_h, k) => { const p = new Float32Array(k * k * 7); for (let i = 0; i < k * k; i++) p[i * 7 + (i % (k + 1) === 0 ? 0 : 1)] = 1; return p; },
    empty: () => tensor(0),
  });

  it('decodeTokens + graphFrom read the same as readStructure, so native tokens give the same structure', async () => {
    const whole = await readStructure(runner(), v, new Float32Array(1));
    const d = await decodeTokens(runner(), v, new Float32Array(1));
    expect(d.seq).toEqual(script);
    expect(d.dim).toBe(2);
    expect(d.hidden.length).toBe(script.length * 2);
    expect(await graphFrom(runner(), v, d)).toEqual(whole);
    expect(whole.smiles).toBe('CN');
    expect(whole.edges[0][1]).toBe(1);
  });
});
