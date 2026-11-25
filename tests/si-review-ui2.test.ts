// @vitest-environment jsdom
//
// The SI tab shows the warnings about the project as a whole (src/si/project-warnings.ts) with the
// compounds' own: on the Warnings page under where each is, in the tree's and the status bar's
// counts and on the Dashboard; and a compound's mention of a figure, table or scheme that is gone
// is reported (the labels are passed to its checks). None of it is worked out on a field's keystrokes.
import { describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { MemoryFolder } from '../src/si/folder';
import { SiProject } from '../src/si/project';
import { JournalFolder } from '../src/si/journal';
import { SiMode } from '../src/ui/si-mode';
import * as PW from '../src/si/project-warnings';

const FIXTURE = join(__dirname, 'fixtures', 'si-example');
async function openProject(): Promise<{ f: MemoryFolder; p: SiProject }> {
  const f = new MemoryFolder('Example');
  const walk = (dir: string): void => {
    for (const n of readdirSync(dir)) {
      const x = join(dir, n);
      if (statSync(x).isDirectory()) walk(x);
      else if (n !== 'README.md') f.files.set(relative(FIXTURE, x).split('\\').join('/'), new Uint8Array(readFileSync(x)));
    }
  };
  walk(FIXTURE);
  return { f, p: await SiProject.open(new JournalFolder(f)) };
}
const hints: string[] = [];
function makeMode(): SiMode {
  document.body.innerHTML = '<div id="work"></div>';
  try { localStorage.setItem('si.livePreview', 'off'); } catch { /* (no storage) */ }
  const base: Record<string, unknown> = {
    flash: () => {}, hint: (t: string) => { hints.push(t); }, changed: () => {}, contentsOf: () => null, molfileOf: () => ({ molblock: null }), pictureOf: () => '<svg></svg>',
    analyze: async () => null, smiles: async () => null, siFacts: async (m: string[]) => m.map(() => null), sizeOf: () => null, siStyle: () => ({}), openDocuments: () => [], drawingFiles: () => null, contentsOfCdxml: () => null,
  };
  return new SiMode(new Proxy(base, { get: (t, k: string) => (k in t ? t[k] : () => undefined) }) as never);
}
const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));
const count = (): number => Number(/Warnings \((\d+)\)/.exec(document.querySelector('.si-tree')!.textContent ?? '')?.[1] ?? -1);

describe('project warnings in the SI tab', () => {
  it('are listed on the Warnings page under their place, counted, and never worked out on a field edit', async () => {
    const { p } = await openProject();
    const text = p.sections.find((s) => s.type === 'text')!;
    // a mention of a table that is gone, in a section's text
    await p.writeSectionText(text, `${await p.readSectionText(text)}\nSee @{t-0000dead} for details.`);
    const c = p.compounds[0];
    const mode = makeMode();
    const tab = { id: 1, mode: 'si', name: p.title, si: p, sheetState: { pick: { kind: 'compound', id: c.id } } as unknown };
    mode.show(tab as never);
    const own = await PW.projectWarnings(p);
    expect(own.length).toBeGreaterThan(0);
    const inner = mode as unknown as { activeWarnings(x: unknown): unknown[] };
    const activeNow = (): number => p.compounds.reduce((n, x) => n + inner.activeWarnings(x).length, 0);
    // the tab works the project's warnings out after it shows: wait for the count rather than a
    // fixed time, which a busy test machine can overrun (the count read 0 after 80 ms on CI, #758)
    await vi.waitFor(() => expect(count()).toBe(activeNow() + own.length), { timeout: 5000, interval: 20 });
    const active = activeNow();
    expect(count()).toBeGreaterThanOrEqual(own.length);
    expect(count()).toBe(active + own.length);
    expect(hints[hints.length - 1]).toContain(`${count()} warning`);

    // a field edit does not work them out again
    const spy = vi.spyOn(PW, 'projectWarnings');
    const input = document.querySelector<HTMLInputElement>('.si-page .si-parts input')!;
    input.value = 'edited';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await mode.saved();
    await tick(1700);
    expect(spy).not.toHaveBeenCalled();

    // the Warnings page: under "Project", by place, with no Dismiss
    tab.sheetState = { pick: { kind: 'warnings' } };
    mode.show(tab as never);
    await tick(50);
    const lines = [...document.querySelectorAll<HTMLElement>('.si-page .si-warn-project')];
    expect(lines.map((l) => l.textContent)).toEqual(own.map((w) => w.message));
    expect(lines.every((l) => !l.querySelector('button'))).toBe(true);
    const place = lines[0].previousElementSibling as HTMLElement;
    expect(place.textContent).toContain(text.name);
    place.click();
    await tick(20);
    expect((tab.sheetState as { pick: { kind: string; id: string } }).pick).toEqual({ kind: 'section', id: text.id });

    // a project-level change (the text put right) takes them away again
    await mode.saved();
    const body = (await p.readSectionText(text)).replace('\nSee @{t-0000dead} for details.', '');
    await (mode as unknown as { act(f: () => Promise<unknown>): Promise<void> }).act(() => p.writeSectionText(text, body));
    await tick(1800);
    expect(spy).toHaveBeenCalled();
    expect(count()).toBe(active);
    spy.mockRestore();
  }, 20000);

  it('a compound that mentions a table that is gone is warned about (the labels reach its checks)', async () => {
    const { p } = await openProject();
    const c = p.compounds[0];
    await p.writeCompoundText(c, 'procedure', 'Prepared as in @{t-0000dead}.');
    const mode = makeMode();
    mode.show({ id: 1, mode: 'si', name: p.title, si: p, sheetState: { pick: { kind: 'compound', id: c.id } } } as never);
    await tick(100);
    const list = (mode as unknown as { warnings: Map<string, { message: string }[]> }).warnings.get(c.id) ?? [];
    expect(list.some((w) => /table/i.test(w.message))).toBe(true);
  });
});
