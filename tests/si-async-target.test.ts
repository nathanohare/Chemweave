// @vitest-environment jsdom
//
// Slow SI work tied to what it was asked for (G4-06): a PubChem name (up to 10 s) or a namer's
// name for a structure redrawn meanwhile is not written to the compound, and the user is told.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { MemoryFolder } from '../src/si/folder';
import { SiProject, valuesOf, type SiCompound } from '../src/si/project';
import { JournalFolder } from '../src/si/journal';
import { molFacts } from '../src/si/chem';

let during: () => Promise<void> = async () => {};
vi.mock('../src/si/pubchem-name', async (orig) => ({
  ...(await orig<typeof import('../src/si/pubchem-name')>()),
  lookupName: async () => { await during(); return { status: 'found', cid: 1, name: 'pubchem-name', message: 'Found.' }; },
}));
const { SiMode } = await import('../src/ui/si-mode');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let RDKit: any;
beforeAll(async () => { RDKit = await createRequire(import.meta.url)('@rdkit/rdkit')(); });

const FIXTURE = join(__dirname, 'fixtures', 'si-example');
async function openProject(): Promise<SiProject> {
  const f = new MemoryFolder('Example');
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
const flashes: string[] = [];
function makeMode(name: () => Promise<{ ok: true; name: string }>): InstanceType<typeof SiMode> {
  document.body.innerHTML = '<div id="work"></div>';
  try { localStorage.setItem('si.livePreview', 'off'); localStorage.setItem('si.pubchem.skipNote', '1'); } catch { /* (no storage) */ }
  const base: Record<string, unknown> = {
    flash: (m: string) => { flashes.push(m); }, hint: () => {}, changed: () => {}, contentsOf: () => null, molfileOf: () => ({ molblock: null }), pictureOf: () => '<svg></svg>',
    analyze: async () => null, smiles: async () => null, sizeOf: () => null, siStyle: () => ({}), openDocuments: () => [], drawingFiles: () => null, contentsOfCdxml: () => null,
    siFacts: async (ms: string[]) => ms.map((m) => (m ? molFacts(RDKit, m) : null)),
    nameStructure: name,
  };
  return new SiMode(new Proxy(base, { get: (t, k: string) => (k in t ? t[k] : () => undefined) }) as never);
}
const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));
const nameOf = (c: SiCompound): string => JSON.stringify(valuesOf(c).name ?? '');
// (jsdom has no modal dialogs: a question asked is answered with its default)
beforeAll(() => { HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); }; });

describe('slow SI work and the structure it was for', () => {
  it('Name from PubChem: a structure redrawn during the lookup keeps its name', async () => {
    const p = await openProject();
    const c = p.compounds.find((x) => p.hasStructure(x))!;
    await p.setValue(c, 'name', { text: '' });
    const mode = makeMode(async () => ({ ok: true, name: 'x' }));
    mode.show({ id: 1, mode: 'si', name: p.title, si: p, sheetState: { pick: { kind: 'compound', id: c.id } } } as never);
    await tick(200);
    const before = nameOf(c);
    // the structure is redrawn while PubChem is asked (the SI tab forgets the old drawing)
    during = async () => { (mode as unknown as { forgetStructure(c: unknown, p: unknown): void }).forgetStructure(c, p); };
    await mode.run('name-pubchem');
    expect(nameOf(c)).toBe(before);
    expect(flashes.some((m) => /structure changed/.test(m))).toBe(true);
    // unchanged structure: the name is used
    during = async () => {};
    await mode.run('name-pubchem');
    await mode.saved();
    expect(nameOf(c)).toContain('pubchem-name');
  });

  it('Structure to Name: a structure redrawn while it is named keeps its name', async () => {
    const p = await openProject();
    const c = p.compounds.find((x) => p.hasStructure(x))!;
    await p.setValue(c, 'name', { text: '' });
    const before = nameOf(c);
    const mode = makeMode(async () => {
      // redrawn meanwhile: another molfile written for the compound
      await p.setStructure(c, RDKit.get_mol('CCO').get_molblock());
      return { ok: true, name: 'namer-name' };
    });
    mode.show({ id: 1, mode: 'si', name: p.title, si: p, sheetState: { pick: { kind: 'compound', id: c.id } } } as never);
    await tick(200);
    flashes.length = 0;
    await (mode as unknown as { structureToName(l: unknown[]): Promise<void> }).structureToName([c, c].slice(0, 1));
    expect(nameOf(c)).toBe(before);
    expect(flashes.some((m) => /structure changed/.test(m))).toBe(true);
  });
});
