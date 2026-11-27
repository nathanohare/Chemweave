// NCI CACTUS, the US National Cancer Institute's free Chemical Identifier Resolver
// (cactus.nci.nih.gov/chemical/structure): a second place to look up a CAS RN's structure when
// PubChem doesn't list the number. Only the CAS RN typed is sent. Requests go one at a time, a
// second apart, to be gentle with a free service. CACTUS warns that it may leave stereochemistry out.

import { untilAborted, type Fetch } from './pubchem';

export const CACTUS_HOST = 'cactus.nci.nih.gov';
const BASE = `https://${CACTUS_HOST}/chemical/structure`;

export class CactusError extends Error {}

const GAP_MS = 1000;
let queue: Promise<void> = Promise.resolve();
function turn(): Promise<void> {
  const go = queue;
  queue = queue.then(() => new Promise<void>((r) => setTimeout(r, GAP_MS)));
  return go;
}

/** The SMILES CACTUS gives for an identifier (a CAS RN), or null when it doesn't know it. */
export async function cactusSmiles(id: string, fetchFn: Fetch = fetch, timeoutMs = 15000): Promise<string | null> {
  await turn();
  const ctl = new AbortController();
  // the timer runs until the body has been read, not only until the headers come
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  const late = () => new CactusError('NCI CACTUS did not answer in time.');
  let first: string;
  try {
    let res: Response;
    try {
      res = await fetchFn(`${BASE}/${encodeURIComponent(id.trim())}/smiles`, { signal: ctl.signal });
    } catch {
      throw ctl.signal.aborted ? late() : new CactusError('Could not reach NCI CACTUS: is this computer online?');
    }
    if (res.status === 404) return null;
    if (!res.ok) throw new CactusError(`NCI CACTUS answered with an error (${res.status}).`);
    let body: string;
    try {
      body = await untilAborted(res.text(), ctl.signal);
    } catch {
      throw ctl.signal.aborted ? late() : new CactusError('NCI CACTUS\'s answer could not be read.');
    }
    // one SMILES per line when the identifier is ambiguous: the first is used
    first = body.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? '';
  } finally {
    clearTimeout(timer);
  }
  // an HTML page (an error page passed through a proxy) is not a SMILES
  return first && !/^</.test(first) && !/\s/.test(first) ? first : null;
}
