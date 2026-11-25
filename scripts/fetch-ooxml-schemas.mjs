// Fetches the Office Open XML Transitional schemas (ECMA-376 Part 4, 5th edition, December 2016)
// from Ecma International into .cache/ooxml-schemas/, for tests/ooxml-schema.ts, which checks the
// Word, PowerPoint and Excel files this program writes against them. Usage:
//   node scripts/fetch-ooxml-schemas.mjs            (CI runs it through scripts/retry.mjs)
//
// The schemas are not kept in the repository: Ecma's copyright notice for the standard covers its
// text, and whether its BSD software licence covers the schemas of this edition isn't stated on
// the copy we can read, so they are downloaded where they are needed instead. The download is
// checked against its SHA-256, so a changed file on Ecma's site fails here rather than in a test.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';

const URL = 'https://ecma-international.org/wp-content/uploads/ECMA-376-4_5th_edition_december_2016.zip';
const SHA256 = 'bd25da1109f73762356596918bf5ff8b74a1331642dba5f1c1d1dfc6bed34ecd';
const INNER = 'OfficeOpenXML-XMLSchema-Transitional.zip';

export const SCHEMA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '.cache', 'ooxml-schemas', 'transitional');

async function main() {
  if (existsSync(SCHEMA_DIR) && readdirSync(SCHEMA_DIR).some((f) => f === 'wml.xsd')) {
    console.log(`The schemas are already in ${SCHEMA_DIR}.`);
    return;
  }
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`Ecma answered ${res.status} ${res.statusText} for ${URL}`);
  const zip = new Uint8Array(await res.arrayBuffer());
  const sum = createHash('sha256').update(zip).digest('hex');
  if (sum !== SHA256) throw new Error(`${URL} has changed (SHA-256 ${sum}, expected ${SHA256}); check it and update SHA256 here`);
  const inner = unzipSync(zip)[INNER];
  if (!inner) throw new Error(`${INNER} is not in ${URL}`);
  mkdirSync(SCHEMA_DIR, { recursive: true });
  let n = 0;
  for (const [name, bytes] of Object.entries(unzipSync(inner))) {
    if (!name.endsWith('.xsd') || name.includes('/')) continue;
    writeFileSync(join(SCHEMA_DIR, name), bytes);
    n++;
  }
  console.log(`Wrote ${n} schemas to ${SCHEMA_DIR}.`);
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
