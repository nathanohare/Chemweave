// The structure reader's worker, when its picture encoder runs natively on the page: pictures go
// to the page and come back as keys and values, the page's answers bypass the one-at-a-time
// queue, and a native failure is marked so the page falls back (src/recognise/page-encode.ts,
// used by src/worker/recognise-worker.ts).

import { describe, it, expect } from 'vitest';
import { checkKeysValues, NativeEncodeError, pageEncoder, workerDispatch, type Encoded } from '../src/recognise/page-encode';

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('structure reader: encoding on the page', () => {
  it('sends the picture (transferred) and resolves with the page\'s keys and values', async () => {
    const sent: { m: { req: number; image: Float32Array }; transfer: Transferable[] }[] = [];
    const enc = pageEncoder((m, transfer) => sent.push({ m, transfer }));
    const img = new Float32Array(12);
    const p = enc.encode(img);
    expect(sent[0].transfer).toEqual([img.buffer]);
    enc.answer({ type: 'encoded', req: sent[0].m.req, ck: new Float32Array([1]), cv: new Float32Array([2]) });
    expect(await p).toEqual({ ck: new Float32Array([1]), cv: new Float32Array([2]) });
  });

  it('matches answers to their own pictures, in any order', async () => {
    const reqs: number[] = [];
    const enc = pageEncoder((m) => reqs.push(m.req));
    const a = enc.encode(new Float32Array(3)), b = enc.encode(new Float32Array(3));
    enc.answer({ type: 'encoded', req: reqs[1], ck: new Float32Array([2]), cv: new Float32Array([2]) });
    enc.answer({ type: 'encoded', req: reqs[0], ck: new Float32Array([1]), cv: new Float32Array([1]) });
    expect((await a).ck[0]).toBe(1);
    expect((await b).ck[0]).toBe(2);
    // an answer nobody waits for is ignored
    enc.answer({ type: 'encoded', req: 999, error: 'late' });
  });

  it('a failed answer is a native failure', async () => {
    const reqs: number[] = [];
    const enc = pageEncoder((m) => reqs.push(m.req));
    const p = enc.encode(new Float32Array(3));
    enc.answer({ type: 'encoded', req: reqs[0], error: 'ONNX Runtime could not be loaded' });
    await expect(p).rejects.toBeInstanceOf(NativeEncodeError);
    await expect(p).rejects.toThrow(/could not be loaded/);
  });

  it('checks the keys and values are the shape the decoder takes', () => {
    const v = { layers: 6, heads: 8, dk: 32 };
    const n = 6 * 8 * 144 * 32;
    expect(checkKeysValues(new Float32Array(n), new Float32Array(n), v)).toBe(144);
    expect(() => checkKeysValues(new Float32Array(n), new Float32Array(n - 32), v)).toThrow(NativeEncodeError);
    expect(() => checkKeysValues(new Float32Array(n + 1), new Float32Array(n + 1), v)).toThrow(NativeEncodeError);
    expect(() => checkKeysValues(new Float32Array(0), new Float32Array(0), v)).toThrow(NativeEncodeError);
  });
});

describe('structure reader: the worker\'s queue', () => {
  type Msg = { type: 'read'; id: number } | { type: 'init' };

  it('answers reach a waiting picture though it holds the queue; a native failure is marked; the next read still runs', async () => {
    const posted: { type: 'error'; id?: number; message: string; native?: boolean }[] = [];
    const reqs: number[] = [];
    const enc = pageEncoder((m) => reqs.push(m.req));
    const done: number[] = [];
    const dispatch = workerDispatch<Msg>(async (m) => {
      if (m.type === 'read') { await enc.encode(new Float32Array(3)); done.push(m.id); }
    }, enc.answer, (m) => posted.push(m));
    dispatch({ type: 'read', id: 1 });
    dispatch({ type: 'read', id: 2 });
    await tick();
    expect(reqs).toHaveLength(1); // the second read waits its turn
    dispatch({ type: 'encoded', req: reqs[0], error: 'out of memory' } satisfies Encoded);
    await tick(); await tick();
    expect(posted).toEqual([{ type: 'error', id: 1, message: 'out of memory', native: true }]);
    expect(reqs).toHaveLength(2); // the queue moved on
    dispatch({ type: 'encoded', req: reqs[1], ck: new Float32Array([1]), cv: new Float32Array([1]) });
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
