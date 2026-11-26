// The structure reader's worker and its page, when the model runs natively in the desktop app
// (src-tauri/src/recognise_native.rs): the worker can't reach the desktop app, so it sends each
// picture's pixels to the page ('decode') and waits for the decoder's tokens, scores and hidden
// states ('decoded'), then reads the tokens and runs the small bond reader itself. Kept apart from
// the worker (which loads ONNX Runtime's WebAssembly) so the message handling can be tested.

import type { Decoded } from './molscribe';

/** The native reader failed: the page reads the picture again with the WebAssembly one. */
export class NativeReadError extends Error {}

/** The page's answer to a 'decode': what the decoder wrote, or why it failed. */
export interface DecodedMsg { type: 'decoded'; req: number; seq?: Int32Array; scores?: Float32Array; hidden?: Float32Array; dim?: number; error?: string }

/** Sends pictures to the page to read natively and matches its answers to them. */
export function pageDecoder(post: (m: { type: 'decode'; req: number; rgba: Uint8ClampedArray }, transfer: Transferable[]) => void) {
  let next = 1;
  const waiting = new Map<number, { ok: (d: Decoded) => void; fail: (e: Error) => void }>();
  return {
    /** The decoder's output for a picture's pixels (RGBA, already the model's square); the pixels are handed over. */
    decode(rgba: Uint8ClampedArray): Promise<Decoded> {
      return new Promise((ok, fail) => {
        const req = next++;
        waiting.set(req, { ok, fail });
        post({ type: 'decode', req, rgba }, [rgba.buffer]);
      });
    },
    answer(m: DecodedMsg): void {
      const w = waiting.get(m.req);
      waiting.delete(m.req);
      if (!w) return;
      if (m.seq && m.scores && m.hidden && m.dim) {
        try {
          w.ok(checkDecoded({ seq: [...m.seq], scores: [...m.scores], hidden: m.hidden, dim: m.dim }));
        } catch (e) {
          w.fail(e as Error);
        }
      } else w.fail(new NativeReadError(m.error || 'The native reader failed.'));
    },
  };
}

/** The decoder's output, unless it is the wrong shape. */
export function checkDecoded(d: Decoded): Decoded {
  if (!d.seq.length || d.seq.length !== d.scores.length || d.dim <= 0 || d.hidden.length !== d.seq.length * d.dim) {
    throw new NativeReadError('The native reader gave an answer of the wrong size.');
  }
  return d;
}

/**
 * The desktop app's answer (recognise_model::Decoded::to_bytes): token count and hidden size
 * (u32), then the tokens (i32), the scores (f32) and the hidden states (f32), little-endian.
 */
export function parseDecoded(buf: ArrayBuffer): { seq: Int32Array; scores: Float32Array; hidden: Float32Array; dim: number } {
  if (buf.byteLength < 8) throw new NativeReadError('The native reader gave no answer.');
  const dv = new DataView(buf);
  const n = dv.getUint32(0, true), dim = dv.getUint32(4, true);
  if (buf.byteLength !== 8 + 8 * n + 4 * n * dim) throw new NativeReadError('The native reader gave an answer of the wrong size.');
  const seq = new Int32Array(n), scores = new Float32Array(n), hidden = new Float32Array(n * dim);
  let at = 8;
  for (let i = 0; i < n; i++, at += 4) seq[i] = dv.getInt32(at, true);
  for (let i = 0; i < n; i++, at += 4) scores[i] = dv.getFloat32(at, true);
  for (let i = 0; i < n * dim; i++, at += 4) hidden[i] = dv.getFloat32(at, true);
  return { seq, scores, hidden, dim };
}

/**
 * The worker's message handling: init and read one at a time (the runtime isn't re-entrant),
 * while the page's 'decoded' answers go straight to the picture waiting for them (it holds the
 * queue). A failure is posted as an error; a native one is marked so the page can fall back.
 */
export function workerDispatch<M extends { type: string; id?: number }>(
  run: (m: M) => Promise<void>,
  answer: (m: DecodedMsg) => void,
  post: (m: { type: 'error'; id?: number; message: string; native?: boolean }) => void,
): (m: M | DecodedMsg) => void {
  let queue: Promise<void> = Promise.resolve();
  return (m) => {
    if (m.type === 'decoded') { answer(m as DecodedMsg); return; }
    const msg = m as M;
    queue = queue.then(() => run(msg)).catch((err) => {
      post({ type: 'error', id: msg.type === 'read' ? msg.id : undefined, message: err instanceof Error ? err.message : String(err), native: err instanceof NativeReadError || undefined });
    });
  };
}
