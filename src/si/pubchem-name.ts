// A compound's name from PubChem (the US National Library of Medicine's free database), as Chem
// SI Assistant looks it up (its SPEC §13n.5): only when asked (Name from PubChem on the ribbon),
// because an unpublished structure should not leave the computer without the person choosing
// to. Only the structure's InChIKey is sent, not the structure:
//
//   https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/inchikey/<KEY>/property/IUPACName,Title/JSON
//
// - The full InChIKey first (stereochemistry included).
// - Not found: the connectivity part (its first 14 characters: the same atoms and bonds, any
//   stereochemistry), offered only when PubChem has exactly one compound for it, and labeled
//   "without stereochemistry".
// - A salt or mixture is looked up as a whole; when it isn't found the answer says so.
// The name stays editable; compound.json keeps name.from_pubchem = {cid, name, stereo} while
// the text is unchanged, as SI Assistant keeps it.

export type Fetch = typeof fetch;

const BASE = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/inchikey/';
const PROPERTIES = 'IUPACName,Title';
const TIMEOUT_MS = 10000;
export const PUBCHEM_PAGE = 'https://pubchem.ncbi.nlm.nih.gov/compound/';
export const NOT_FOUND_TEXT = 'This exact structure is not in PubChem: paste the name from ChemDraw (Structure ▸ Convert Structure to Name), or use Structure to Name.';

export interface NameResult {
  /** found: the exact structure; no_stereo: only its atoms and bonds matched (one compound); not_found; error (offline…). */
  status: 'found' | 'no_stereo' | 'not_found' | 'error';
  /** The IUPAC name (PubChem's title when it has none). */
  name: string;
  title: string;
  cid: number;
  inchikey: string;
  /** What happened, in plain words. */
  message: string;
}

class NotFound extends Error {}
class Failed extends Error {}

async function getJson(url: string, fetchFn: Fetch): Promise<unknown> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetchFn(url, { headers: { Accept: 'application/json' }, signal: ctl.signal });
  } catch {
    throw new Failed('PubChem could not be reached. Check the internet connection and try again.');
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 404) throw new NotFound();
  if (res.status === 503 || res.status === 504) throw new Failed('PubChem is busy at the moment. Please try again in a minute.');
  if (!res.ok) throw new Failed(`PubChem answered with an error (HTTP ${res.status}). Please try again later.`);
  try { return await res.json(); } catch { throw new Failed('PubChem’s answer could not be read. Please try again later.'); }
}

function properties(answer: unknown): Record<string, unknown>[] {
  const list = (answer as { PropertyTable?: { Properties?: unknown } } | null)?.PropertyTable?.Properties;
  return Array.isArray(list) ? list.filter((p): p is Record<string, unknown> => !!p && typeof p === 'object' && !Array.isArray(p)) : [];
}

const empty = (status: NameResult['status'], inchikey: string, message: string): NameResult => ({ status, name: '', title: '', cid: 0, inchikey, message });

function result(status: 'found' | 'no_stereo', prop: Record<string, unknown>, key: string): NameResult {
  const iupac = String(prop.IUPACName ?? '').trim();
  const title = String(prop.Title ?? '').trim();
  const cid = Number.isInteger(Number(prop.CID)) ? Number(prop.CID) : 0;
  const name = iupac || title;
  if (!name) return empty('not_found', key, NOT_FOUND_TEXT);
  const where = `PubChem CID ${cid}` + (title && title !== name ? `, “${title}”` : '');
  const message = status === 'found'
    ? `Name from PubChem (${where}).`
    : `PubChem has this structure only without (or with other) stereochemistry (${where}). The name is for the structure without stereochemistry: check or add the stereodescriptors (R/S, E/Z).`;
  return { status, name, title, cid, inchikey: key, message };
}

/** The PubChem name of a structure, by its InChIKey; `pieces` (a salt has several) words the "not found" answer. */
export async function lookupName(inchikey: string, pieces = 1, fetchFn: Fetch = fetch): Promise<NameResult> {
  const key = inchikey.trim();
  if (!key) return empty('error', '', 'An InChIKey could not be made for this structure, so it can’t be looked up.');
  const url = (k: string): string => `${BASE}${encodeURIComponent(k)}/property/${PROPERTIES}/JSON`;
  try {
    const props = properties(await getJson(url(key), fetchFn));
    if (props.length) return result('found', props[0], key);
  } catch (e) {
    if (e instanceof Failed) return empty('error', key, e.message);
    if (!(e instanceof NotFound)) throw e;
  }
  // not there as drawn: the same atoms and bonds, any stereochemistry
  let props: Record<string, unknown>[] = [];
  try {
    props = properties(await getJson(url(key.split('-')[0]), fetchFn));
  } catch (e) {
    if (e instanceof Failed) return empty('error', key, e.message);
    if (!(e instanceof NotFound)) throw e;
  }
  if (props.length === 1) return result('no_stereo', props[0], key);
  return empty('not_found', key, pieces > 1
    ? `This structure has ${pieces} pieces (a salt, say), and PubChem has no compound with exactly these pieces together. ${NOT_FOUND_TEXT}`
    : NOT_FOUND_TEXT);
}
