// Review batch 08, F384, F385 and F405: a lookup's timeout also covers reading the answer's body
// (a server can send its headers and then stall), and the CAS RN lookup's message names the
// service that failed; a body given up on before it was waited for fails quietly when it fails.
// No network: the services' answers are made here.
import { describe, expect, it } from 'vitest';
import { cactusSmiles, CactusError } from '../src/chem/cactus';
import { pubchemName, PubChemError, untilAborted, type Fetch } from '../src/chem/pubchem';
import { CasMemory, structureForCas, type CasDeps } from '../src/chem/cas';

/** A 200 answer whose body never comes. */
const stalled = (async () => new Response(new ReadableStream({ start() { /* never sends */ } }), { status: 200 })) as unknown as Fetch;

describe('timeouts cover the body', () => {
  it('NCI CACTUS', async () => {
    const r = cactusSmiles('50-78-2', stalled, 50);
    await expect(r).rejects.toBeInstanceOf(CactusError);
    await expect(r).rejects.toThrow('did not answer in time');
  }, 10000);

  it('PubChem', async () => {
    const r = pubchemName('aspirin', stalled, 50);
    await expect(r).rejects.toBeInstanceOf(PubChemError);
    await expect(r).rejects.toThrow('did not answer in time');
  }, 10000);
});

describe('giving up on a body', () => {
  it('a body already given up on fails quietly when it fails later', async () => {
    const seen: unknown[] = [];
    const on = (e: unknown) => { seen.push(e); };
    process.on('unhandledRejection', on);
    try {
      const ctl = new AbortController();
      ctl.abort();
      let fail!: (e: Error) => void;
      const body = new Promise<never>((_, reject) => { fail = reject; });
      await expect(untilAborted(body, ctl.signal)).rejects.toThrow('Aborted');
      fail(new Error('the body was lost'));
      await new Promise((r) => setTimeout(r, 20));
      expect(seen).toEqual([]);
    } finally {
      process.off('unhandledRejection', on);
    }
  });
});

describe('CAS RN lookup messages', () => {
  const memStore = () => { const s = { text: null as string | null, read: () => s.text, write: (t: string) => { s.text = t; } }; return s; };
  const deps = (fetchFn: Fetch): CasDeps => ({ library: async () => [], memory: new CasMemory(memStore()), online: true, canonical: async (s) => s, fetchFn });

  it('keeps the capitals of NCI CACTUS when PubChem has no match and CACTUS fails', async () => {
    const f = (async (url: string) => (url.includes('cactus') ? new Response('', { status: 500 }) : new Response('not found', { status: 404 }))) as unknown as Fetch;
    const r = await structureForCas('50-78-2', deps(f));
    expect('error' in r && r.error).toContain('and NCI CACTUS answered with an error (500)');
  }, 10000);

  it('doesn\'t say PubChem doesn\'t list a number when PubChem couldn\'t be asked', async () => {
    const f = (async (url: string) => new Response('', { status: url.includes('cactus') ? 404 : 503 })) as unknown as Fetch;
    const r = await structureForCas('50-78-2', deps(f));
    expect('error' in r && r.error).toContain('PubChem is busy');
    expect('error' in r && r.error).not.toContain('doesn\'t list');
    expect('error' in r && r.error).toContain('NCI CACTUS doesn\'t know CAS RN 50-78-2');
  }, 10000);
});
