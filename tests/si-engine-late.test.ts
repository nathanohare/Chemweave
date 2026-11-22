// @vitest-environment jsdom
//
// An SI project opened before the chemistry engine is ready, or while it restarts (G4-03): the
// engine's failure is never kept as the structures' facts. The checks that need the structures
// come back once the engine is ready, and the warnings then equal those of a normal run.
import { beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { MemoryFolder } from '../src/si/folder';
import { SiProject } from '../src/si/project';
import { JournalFolder } from '../src/si/journal';
import { SiMode } from '../src/ui/si-mode';
import { molFacts } from '../src/si/chem';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let RDKit: any;
beforeAll(async () => { RDKit = await createRequire(import.meta.url)('@rdkit/rdkit')(); });

const FIXTURE = join(__dirname, 'fixtures', 'si-checks');
async function openProject(): Promise<SiProject> {
  const f = new MemoryFolder('Checks');
  const walk = (dir: string): void => {
    for (const n of readdirSync(dir)) {
      const x = join(dir, n);
      if (statSync(x).isDirectory()) walk(x);
      else if (n !== 'README.md') f.files.set(relative(FIXTURE, x).split('\\').join('/'), new Uint8Array(readFileSync(x)));
    }
  };
  walk(FIXTURE);
  return SiProject.open(new JournalFolder(f));
}
function makeMode(engine: { up: boolean; asked: number }): SiMode {
  document.body.innerHTML = '<div id="work"></div>';
  try { localStorage.setItem('si.livePreview', 'off'); } catch { /* (no storage) */ }
  const base: Record<string, unknown> = {
    flash: () => {}, hint: () => {}, changed: () => {}, contentsOf: () => null, molfileOf: () => ({ molblock: null }), pictureOf: () => '<svg></svg>',
    analyze: async () => { if (!engine.up) throw new Error('The chemistry engine stopped and was restarted. Try again.'); return { formula: 'C', mw: 1, exact: 1 }; },
    smiles: async () => null, sizeOf: () => null, siStyle: () => ({}), openDocuments: () => [], drawingFiles: () => null, contentsOfCdxml: () => null,
    siFacts: async (ms: string[]) => {
      engine.asked++;
      if (!engine.up) throw new Error('The chemistry engine stopped and was restarted. Try again.');
      return ms.map((m) => (m ? molFacts(RDKit, m) : null));
    },
  };
  return new SiMode(new Proxy(base, { get: (t, k: string) => (k in t ? t[k] : () => undefined) }) as never);
}
const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));
const total = (mode: SiMode, p: SiProject): number => {
  const inner = mode as unknown as { warnings: Map<string, unknown[]> };
  return p.compounds.reduce((n, c) => n + (inner.warnings.get(c.id)?.length ?? 0), 0);
};

describe('SI checks when the chemistry engine is late', () => {
  it('asks again once the engine is ready, and then gives the warnings of a normal run', async () => {
    const normal = { up: true, asked: 0 };
    const p1 = await openProject();
    const m1 = makeMode(normal);
    m1.show({ id: 1, mode: 'si', name: p1.title, si: p1, sheetState: { pick: { kind: 'warnings' } } } as never);
    await tick(300);
    const want = total(m1, p1);
    expect(want).toBeGreaterThan(0);

    const late = { up: false, asked: 0 };
    const p2 = await openProject();
    const m2 = makeMode(late);
    m2.show({ id: 2, mode: 'si', name: p2.title, si: p2, sheetState: { pick: { kind: 'warnings' } } } as never);
    await tick(300);
    expect(late.asked).toBeGreaterThan(0);
    // (the structure checks are missing for now, and the failure says why where the formula would show)
    expect(total(m2, p2)).toBeLessThan(want);
    const facts = (m2 as unknown as { facts: Map<string, { error?: string } | null> }).facts;
    expect([...facts.values()].some((f) => /run again once the chemistry engine is ready/.test(f?.error ?? ''))).toBe(true);
    late.up = true;
    m2.engineReady();
    await tick(300);
    expect(total(m2, p2)).toBe(want);
  });
});
