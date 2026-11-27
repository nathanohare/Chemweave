// Review batch 08, F388 and F389: requests waiting when a restarted worker can't be made are
// answered with the error (not left waiting), and a Knowledge Base search sends its set again
// when another set went to the worker after it. A fake worker stands in.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChemClient, type WorkerLike } from '../src/chem/client';
import type { ChemRequest, ChemResponse } from '../src/worker/chem-worker';

class FakeWorker implements WorkerLike {
  sent: ChemRequest[] = [];
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  onmessageerror: ((e: MessageEvent) => void) | null = null;
  postMessage(m: unknown): void { this.sent.push(m as ChemRequest); }
  terminate(): void { /* gone */ }
  reply(m: ChemResponse): void { this.onmessage?.({ data: m } as MessageEvent); }
  ready(): void { this.reply({ type: 'ready', ms: 1, version: 'test' }); }
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('ChemClient', () => {
  it('answers the waiting requests when the new worker can\'t start', async () => {
    const workers: FakeWorker[] = [];
    const chem = new ChemClient('http://localhost/', () => {
      if (workers.length) throw new Error('Worker refused');
      const w = new FakeWorker(); workers.push(w); return w;
    });
    workers[0].ready();
    const first = chem.molToSmiles('a');
    const second = chem.molToSmiles('b');
    const settled = Promise.allSettled([first, second]);
    // the worker dies on the first; the second waits for the new worker, which can't be made
    workers[0].onerror?.({ message: 'died' } as ErrorEvent);
    vi.advanceTimersByTime(1000);
    const [, s] = await settled;
    expect(s.status).toBe('rejected');
    expect(String((s as PromiseRejectedResult).reason)).toContain('Background worker could not start');
  });

  it('sends a set again when a different set went to the worker after it', async () => {
    const w = new FakeWorker();
    const chem = new ChemClient('http://localhost/', () => w);
    w.ready();
    type In = ChemRequest & { id: number; mols?: string[] };
    const sentIn = () => w.sent.filter((m) => m.type === 'substructureIn') as In[];
    const a = chem.substructureIn('kb', ['C', 'CC'], 'C');
    const b = chem.substructureIn('kb', ['N', 'NN'], 'N');
    w.reply({ type: 'substructureIn', id: sentIn()[0].id, results: [0, 1] } as ChemResponse);
    await a;
    // the worker now holds the second set; a search over the first must send it again
    const c = chem.substructureIn('kb', ['C', 'CC'], 'CC');
    await Promise.resolve();
    expect(sentIn()[2].mols).toEqual(['C', 'CC']);
    w.reply({ type: 'substructureIn', id: sentIn()[1].id, results: [] } as ChemResponse);
    w.reply({ type: 'substructureIn', id: sentIn()[2].id, results: [1] } as ChemResponse);
    await expect(b).resolves.toMatchObject({ results: [] });
    await expect(c).resolves.toMatchObject({ results: [1] });
  });
});
