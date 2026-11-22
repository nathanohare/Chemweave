// The chemistry client when the worker dies or hangs (G4-02, review F4-R05, R08, R09): the worker
// is restarted, the user is told, the other requests waiting are sent again, only the structure to
// blame is kept back (a batch is worked through one structure at a time to find it), a slow
// structure gets a second try, and an engine that never loads says so. A fake worker stands in.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChemClient, ENGINE_BROKE, ENGINE_LOAD_SLOW, ENGINE_SKIPPED, ENGINE_SLOW, LOAD_MS, SINGLE_MS, WATCHDOG_MS, type WorkerLike } from '../src/chem/client';
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

  it('a structure the engine is slow on: stopped after SINGLE_MS, tried once more, then kept back; the rest answer', async () => {
    const chem = make();
    const told: string[] = [];
    chem.onRestart = (m) => told.push(m);
    workers[0].ready();
    const hung = chem.molToSmiles('big');
    const other = chem.molToSmiles('small');
    // (one structure gets longer than a batch's silence limit before it counts as hung)
    vi.advanceTimersByTime(WATCHDOG_MS + 1);
    expect(workers.length).toBe(1);
    const failed = expect(hung).rejects.toThrow(ENGINE_SLOW);
    vi.advanceTimersByTime(SINGLE_MS - WATCHDOG_MS);
    await failed;
    expect(workers[0].terminated).toBe(true);
    expect(told).toEqual(['The chemistry engine took too long on a structure and was restarted.']);
    // the request waiting behind it is sent again to the new worker, and answered
    workers[1].ready();
    expect(workers[1].last().type).toBe('molToSmiles');
    workers[1].reply({ type: 'molToSmiles', id: workers[1].last().id, smiles: 'C' });
    await expect(other).resolves.toBe('C');
    // the second time it is kept back for the session
    const again = chem.molToSmiles('big');
    const keptBack = expect(again).rejects.toThrow(ENGINE_BROKE);
    vi.advanceTimersByTime(SINGLE_MS + 1);
    await keptBack;
    await expect(chem.molToSmiles('big')).rejects.toThrow(ENGINE_SKIPPED);
    workers[2].ready();
    const fine = chem.molToSmiles('small');
    workers[2].reply({ type: 'molToSmiles', id: workers[2].last().id, smiles: 'CCO' });
    await expect(fine).resolves.toBe('CCO');
  });

  it('a long batch that says it is still working is not taken for a hang', async () => {
    const chem = make();
    workers[0].ready();
    const slow = chem.props(['CCO', 'CC']);
    vi.advanceTimersByTime(WATCHDOG_MS - 1000);
    workers[0].reply({ type: 'alive' });
    vi.advanceTimersByTime(WATCHDOG_MS - 1000);
    workers[0].reply({ type: 'props', id: workers[0].last().id, results: [] });
    await expect(slow).resolves.toEqual([]);
    expect(workers.length).toBe(1);
  });

  it('a batch the engine broke on: each structure asked on its own, only the one to blame kept back', async () => {
    const chem = make();
    const told: string[] = [];
    chem.onRestart = (m) => told.push(m);
    workers[0].ready();
    const batch = chem.siFacts(['a', 'bad', 'b']);
    const other = chem.canonical('CO');
    workers[0].reply({ type: 'error', id: (workers[0].sent[1] as { id: number }).id, message: 'trap', fatal: true });
    expect(told).toEqual(['The chemistry engine stopped on a structure and was restarted.']);
    // the new worker: the other request first, then the batch's structures one at a time
    workers[1].ready();
    const facts = (x: string) => ({ info: null, generic: [x], pieces: [], uniqueCarbons: 0, hTotal: 0, hExch: 0 });
    expect(workers[1].sent.slice(1).map((m) => m.type)).toEqual(['canonical', 'siFacts']);
    workers[1].reply({ type: 'canonical', id: (workers[1].sent[1] as { id: number }).id, smiles: 'CO' });
    await expect(other).resolves.toBe('CO');
    workers[1].reply({ type: 'siFacts', id: workers[1].last().id, results: [facts('a')] });
    await vi.waitFor(() => expect((workers[1].last() as { mols: string[] }).mols).toEqual(['bad']));
    workers[1].reply({ type: 'error', id: workers[1].last().id, message: 'trap', fatal: true });
    workers[2].ready();
    await vi.waitFor(() => expect((workers[2].last() as { mols?: string[] }).mols).toEqual(['b']));
    workers[2].reply({ type: 'siFacts', id: workers[2].last().id, results: [facts('b')] });
    const got = await batch;
    expect(got[0]).toEqual(facts('a'));
    expect(got[1]!.error).toBe(ENGINE_BROKE);
    expect(got[2]).toEqual(facts('b'));
    // later batches with it: the others are asked, it is not sent
    const later = chem.siFacts(['bad', 'c']);
    await vi.waitFor(() => expect((workers[2].last() as { mols?: string[] }).mols).toEqual(['c']));
    workers[2].reply({ type: 'siFacts', id: workers[2].last().id, results: [facts('c')] });
    const l = await later;
    expect(l[0]!.error).toBe(ENGINE_SKIPPED);
    expect(l[1]).toEqual(facts('c'));
    // (restarts with a structure to blame never use up the engine)
    expect(chem.error).toBe('');
  });

  it('a worker that keeps dying with nothing to blame: stopped after three restarts in a few minutes, and says so', async () => {
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

  it('an engine that never finishes loading: what waits is told after LOAD_MS, and so is the user', async () => {
    const chem = make();
    const told: string[] = [];
    chem.onRestart = (m) => told.push(m);
    const waiting = chem.canonical('C');
    const failed = expect(waiting).rejects.toThrow(ENGINE_LOAD_SLOW);
    vi.advanceTimersByTime(LOAD_MS + 1);
    await failed;
    expect(workers[0].terminated).toBe(true);
    expect(told).toEqual([ENGINE_LOAD_SLOW]);
    await expect(chem.canonical('C')).rejects.toThrow(ENGINE_LOAD_SLOW);
  });

  it('a watchdog that fires long after it was set (the computer slept) starts again instead', async () => {
    const chem = make();
    workers[0].ready();
    const asked = chem.canonical('C');
    vi.setSystemTime(Date.now() + 3 * 3600_000);
    vi.advanceTimersByTime(SINGLE_MS + 1);
    expect(workers.length).toBe(1);
    workers[0].reply({ type: 'canonical', id: workers[0].last().id, smiles: 'C' });
    await expect(asked).resolves.toBe('C');
  });
});
