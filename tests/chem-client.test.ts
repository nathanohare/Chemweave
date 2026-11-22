// The chemistry client when the worker dies or hangs (G4-02): what waits is told so, the worker
// is restarted, the user is told, a request that broke the engine is not sent again, and a small
// request afterwards is answered. A fake worker stands in for the real one.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChemClient, ENGINE_RESTARTED, ENGINE_SKIPPED, WATCHDOG_MS, type WorkerLike } from '../src/chem/client';
import type { ChemRequest, ChemResponse } from '../src/worker/chem-worker';

class FakeWorker implements WorkerLike {
  sent: ChemRequest[] = [];
  terminated = false;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  onmessageerror: ((e: MessageEvent) => void) | null = null;
  postMessage(m: unknown): void { this.sent.push(m as ChemRequest); }
  terminate(): void { this.terminated = true; }
  reply(m: ChemResponse): void { this.onmessage?.({ data: m } as MessageEvent); }
  ready(): void { this.reply({ type: 'ready', ms: 1, version: 'test' }); }
  last(): ChemRequest & { id: number } { return this.sent[this.sent.length - 1] as ChemRequest & { id: number }; }
}

let workers: FakeWorker[] = [];
const make = (): ChemClient => new ChemClient('http://localhost/', () => { const w = new FakeWorker(); workers.push(w); return w; });

beforeEach(() => { workers = []; vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('ChemClient', () => {
  it('holds requests made while the engine loads, and sends them once it is ready', async () => {
    const chem = make();
    const got = chem.canonical('OCC');
    expect(workers[0].sent.map((m) => m.type)).toEqual(['init']);
    workers[0].ready();
    const req = workers[0].last();
    expect(req.type).toBe('canonical');
    workers[0].reply({ type: 'canonical', id: req.id, smiles: 'CCO' });
    await expect(got).resolves.toBe('CCO');
  });

  it('a hung worker: the request fails after the watchdog, a new worker starts, the user is told, and the next request answers', async () => {
    const chem = make();
    const told: string[] = [];
    chem.onRestart = (m) => told.push(m);
    workers[0].ready();
    const hung = chem.molToSmiles('big');
    const failed = expect(hung).rejects.toThrow(ENGINE_RESTARTED);
    vi.advanceTimersByTime(WATCHDOG_MS + 1);
    await failed;
    expect(workers[0].terminated).toBe(true);
    expect(workers.length).toBe(2);
    expect(told).toEqual(['The chemistry engine stopped responding and was restarted.']);
    expect(chem.ready).toBe(false);
    // the same request is not sent again; another one is, once the new engine is ready
    await expect(chem.molToSmiles('big')).rejects.toThrow(ENGINE_SKIPPED);
    const small = chem.molToSmiles('small');
    workers[1].ready();
    const req = workers[1].last();
    expect(req.type).toBe('molToSmiles');
    workers[1].reply({ type: 'molToSmiles', id: req.id, smiles: 'CCO' });
    await expect(small).resolves.toBe('CCO');
  });

  it('a long request that says it is still working is not taken for a hang', async () => {
    const chem = make();
    workers[0].ready();
    const slow = chem.props(['CCO']);
    vi.advanceTimersByTime(WATCHDOG_MS - 1000);
    workers[0].reply({ type: 'alive' });
    vi.advanceTimersByTime(WATCHDOG_MS - 1000);
    workers[0].reply({ type: 'props', id: workers[0].last().id, results: [] });
    await expect(slow).resolves.toEqual([]);
    expect(workers.length).toBe(1);
  });

  it('an engine that broke on a request, or a worker that died: restarted, the request not sent again', async () => {
    const chem = make();
    const told: string[] = [];
    chem.onRestart = (m) => told.push(m);
    workers[0].ready();
    const bad = chem.siFacts(['bad']);
    const other = chem.siFacts(['other']);
    workers[0].reply({ type: 'error', id: (workers[0].sent[1] as { id: number }).id, message: 'trap', fatal: true });
    await expect(bad).rejects.toThrow(ENGINE_RESTARTED);
    await expect(other).rejects.toThrow(ENGINE_RESTARTED);
    expect(told).toEqual(['The chemistry engine stopped and was restarted.']);
    await expect(chem.siFacts(['bad'])).rejects.toThrow(ENGINE_SKIPPED);
    workers[1].ready();
    const next = chem.siFacts(['other']);
    workers[1].onerror?.({ message: 'gone' } as ErrorEvent);
    await expect(next).rejects.toThrow(ENGINE_RESTARTED);
    expect(workers.length).toBe(3);
  });

  it('stops restarting after three restarts in a few minutes, and says so', async () => {
    const chem = make();
    const told: string[] = [];
    chem.onRestart = (m) => told.push(m);
    for (let k = 0; k < 4; k++) {
      workers[k].ready();
      workers[k].onerror?.({ message: 'gone' } as ErrorEvent);
    }
    expect(workers.length).toBe(4);
    expect(told[3]).toMatch(/was not restarted/);
    expect(chem.error).toMatch(/restart Chemweave/);
    await expect(chem.canonical('C')).rejects.toThrow(/restart Chemweave/);
  });

  it('an engine that fails to load fails what waits, and later requests at once', async () => {
    const chem = make();
    const waiting = chem.canonical('C');
    workers[0].reply({ type: 'error', message: 'no wasm' });
    await expect(waiting).rejects.toThrow('no wasm');
    await expect(chem.canonical('C')).rejects.toThrow('no wasm');
  });
});
