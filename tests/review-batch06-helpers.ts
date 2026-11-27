// Shared set-up for the review-batch06-*.test.ts files: the example SI project (built from the
// test fixture folder in the repository, which is written by hand for the tests), an SI tab on it,
// and the dialog methods jsdom does not have. Not a test itself.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { MemoryFolder } from '../src/si/folder';
import { SiProject } from '../src/si/project';
import { JournalFolder } from '../src/si/journal';
import { SiMode } from '../src/ui/si-mode';

const FIXTURE = join(__dirname, 'fixtures', 'si-example');

export function exampleFolder(name = 'Example'): MemoryFolder {
  const f = new MemoryFolder(name);
  const walk = (dir: string): void => {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (n !== 'README.md') f.files.set(relative(FIXTURE, p).split('\\').join('/'), new Uint8Array(readFileSync(p)));
    }
  };
  walk(FIXTURE);
  return f;
}

export async function openProject(name = 'Example', opts: { readOnly?: boolean } = {}): Promise<{ f: MemoryFolder; j: JournalFolder; p: SiProject }> {
  const f = exampleFolder(name);
  const j = new JournalFolder(f);
  const p = await SiProject.open(j, { readOnly: opts.readOnly });
  return { f, j, p };
}

export const flashes: string[] = [];

export function makeMode(over: Record<string, unknown> = {}): SiMode {
  document.body.innerHTML = '<div id="work"></div>';
  try { localStorage.setItem('si.livePreview', 'off'); } catch { /* (no storage) */ }
  const base: Record<string, unknown> = {
    flash: (m: string) => { flashes.push(m); }, hint: () => {}, changed: () => {},
    contentsOf: () => null, molfileOf: () => ({ molblock: null }), pictureOf: () => '<svg></svg>',
    analyze: async () => null, smiles: async () => null, siFacts: async (m: string[]) => m.map(() => null),
    sizeOf: () => null, siStyle: () => ({}), openDocuments: () => [], drawingFiles: () => null, contentsOfCdxml: () => null,
    ...over,
  };
  const host = new Proxy(base, { get: (t, k: string) => (k in t ? t[k] : () => undefined) });
  return new SiMode(host as never);
}

export interface FakeTab { id: number; mode: string; name: string; si: SiProject; sheetState: unknown }
export const tabOf = (p: SiProject, id = 1): FakeTab => ({ id, mode: 'si', name: p.title, si: p, sheetState: null });
export const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));
export const show = (mode: SiMode, tab: FakeTab | null): void => mode.show(tab as never);
export const decode = (f: MemoryFolder, rel: string): string => new TextDecoder().decode(f.files.get(rel)!);

/** jsdom has no modal windows: showModal opens one, and close shuts it with its return value, as a browser does. */
export function modalWindows(): void {
  const proto = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  proto.showModal = function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
  proto.close = function (this: HTMLDialogElement, value?: string) {
    if (value !== undefined) this.returnValue = value;
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
}
