// The structure reader's worker and its page, when the picture's encoder runs natively: the
// worker can't reach the desktop app, so it sends each picture to the page ('encode') and waits
// for the keys and values ('encoded'). Kept apart from the worker (which loads ONNX Runtime's
// WebAssembly) so the message handling can be tested on its own.

/** The native encoder failed: the page reads the picture again with the WebAssembly encoder. */
export class NativeEncodeError extends Error {}

/** The page's answer to an 'encode': the keys and values, or why it failed. */
export interface Encoded { type: 'encoded'; req: number; ck?: Float32Array; cv?: Float32Array; error?: string }

/** Sends pictures to the page to encode and matches its answers to them. */
export function pageEncoder(post: (m: { type: 'encode'; req: number; image: Float32Array }, transfer: Transferable[]) => void) {
  let next = 1;
  const waiting = new Map<number, { ok: (r: { ck: Float32Array; cv: Float32Array }) => void; fail: (e: Error) => void }>();
  return {
    encode(image: Float32Array): Promise<{ ck: Float32Array; cv: Float32Array }> {
      return new Promise((ok, fail) => {
        const req = next++;
        waiting.set(req, { ok, fail });
        post({ type: 'encode', req, image }, [image.buffer]);
      });
    },
    answer(m: Encoded): void {
      const w = waiting.get(m.req);
      waiting.delete(m.req);
      if (!w) return;
      if (m.ck && m.cv) w.ok({ ck: m.ck, cv: m.cv });
      else w.fail(new NativeEncodeError(m.error || 'The native encoder failed.'));
    },
  };
}

/** Throws unless the keys and values are the shape the decoder takes ([layers, 1, heads, tokens, dk] each). */
export function checkKeysValues(ck: Float32Array, cv: Float32Array, v: { layers: number; heads: number; dk: number }): number {
  const per = v.layers * v.heads * v.dk;
  if (ck.length !== cv.length || !ck.length || ck.length % per) throw new NativeEncodeError('The native encoder gave an answer of the wrong size.');
  return ck.length / per;
}

/**
 * The worker's message handling: init and read one at a time (the runtime isn't re-entrant),
 * while the page's 'encoded' answers go straight to the picture waiting for them (it holds the
 * queue). A failure is posted as an error; a native one is marked so the page can fall back.
 */
export function workerDispatch<M extends { type: string; id?: number }>(
  run: (m: M) => Promise<void>,
  answer: (m: Encoded) => void,
  post: (m: { type: 'error'; id?: number; message: string; native?: boolean }) => void,
): (m: M | Encoded) => void {
  let queue: Promise<void> = Promise.resolve();
  return (m) => {
    if (m.type === 'encoded') { answer(m as Encoded); return; }
    const msg = m as M;
    queue = queue.then(() => run(msg)).catch((err) => {
      post({ type: 'error', id: msg.type === 'read' ? msg.id : undefined, message: err instanceof Error ? err.message : String(err), native: err instanceof NativeEncodeError || undefined });
    });
  };
}
