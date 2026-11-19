// @vitest-environment jsdom
//
// The SI tab's page (src/ui/si-mode.ts) as a person uses it: typing in a compound's fields, moving
// between tabs and projects, the tree's keys and drops, and what is saved when. Each of these was
// a fault found in review; the tests say how it should behave.
import { beforeEach, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { MemoryFolder } from '../src/si/folder';
import { SiProject, valuesOf, type Json } from '../src/si/project';
import { JournalFolder } from '../src/si/journal';
import { SiMode } from '../src/ui/si-mode';
import { SiRichBox } from '../src/ui/si-rich';
import { cleanPastedHtml, hasFormatting } from '../src/ui/si-paste-html';
import { ALL_FIELDS } from '../src/si/fields';

const FIXTURE = join(__dirname, 'fixtures', 'si-example');
function exampleFolder(name: string, slowMs = 0): MemoryFolder {
  const f = new MemoryFolder(name);
  const walk = (dir: string): void => {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (n !== 'README.md') f.files.set(relative(FIXTURE, p).split('\\').join('/'), new Uint8Array(readFileSync(p)));
    }
  };
  walk(FIXTURE);
  if (slowMs) {
    // (a slow disk: each write lands later, the earlier-started ones latest, as unordered saves would cross)
    const write = f.writeText.bind(f);
    let n = 0;
    f.writeText = async (rel, text) => { const wait = Math.max(0, slowMs - 10 * n++); await tick(wait); await write(rel, text); };
  }
  return f;
}
async function openProject(name = 'Example', opts: { readOnly?: boolean; slowMs?: number } = {}) {
  const f = exampleFolder(name, opts.slowMs);
  const j = new JournalFolder(f);
  const p = await SiProject.open(j, { readOnly: opts.readOnly });
  return { f, j, p };
}
const flashes: string[] = [];
function makeMode(over: Record<string, unknown> = {}): SiMode {
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
interface FakeTab { id: number; mode: string; name: string; si: SiProject; sheetState: unknown }
const tabOf = (p: SiProject, id = 1): FakeTab => ({ id, mode: 'si', name: p.title, si: p, sheetState: null });
const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));
const show = (mode: SiMode, tab: FakeTab): void => mode.show(tab as never);
const compoundJson = (f: MemoryFolder, c: { folder: string }): string => new TextDecoder().decode(f.files.get(c.folder + '/compound.json')!);
const partInputs = (): HTMLInputElement[] => [...document.querySelectorAll<HTMLInputElement>('.si-page .si-parts input')];

beforeEach(() => { flashes.length = 0; });

describe('typing on a compound page', () => {
  it('saving one field leaves the others, the keys and what is half typed where they are', async () => {
    const { p, f } = await openProject();
    const mode = makeMode();
    const tab = tabOf(p);
    const c = p.compounds[0];
    tab.sheetState = { pick: { kind: 'compound', id: c.id } };
    show(mode, tab);
    await tick(50);
    const [a, b] = partInputs();
    a.value = 'changed A';
    a.dispatchEvent(new Event('change', { bubbles: true }));
    b.focus();
    b.value = 'half typed B';
    b.dispatchEvent(new Event('input', { bubbles: true }));
    await tick(50);
    expect(compoundJson(f, c)).toContain('changed A');
    expect(b.isConnected).toBe(true);
    expect(document.activeElement).toBe(b);
    expect(b.value).toBe('half typed B');
    // and B is saved by itself once typing stops
    await tick(800);
    expect(compoundJson(f, c)).toContain('half typed B');
    expect(b.isConnected).toBe(true);
  });

  it('a text box is still there after its text was saved', async () => {
    const { p } = await openProject();
    const mode = makeMode();
    const tab = tabOf(p);
    tab.sheetState = { pick: { kind: 'compound', id: p.compounds[0].id } };
    show(mode, tab);
    await tick(50);
    const box = document.querySelector<HTMLElement>('.si-page .si-rich')!;
    box.focus();
    box.append(document.createTextNode(' more'));
    box.dispatchEvent(new Event('input', { bubbles: true }));
    await tick(900);
    expect(box.isConnected).toBe(true);
  });

  it('the header follows a changed name in place', async () => {
    const { p } = await openProject();
    const mode = makeMode();
    const tab = tabOf(p);
    const c = p.compounds[0];
    tab.sheetState = { pick: { kind: 'compound', id: c.id } };
    show(mode, tab);
    await tick(50);
    const name = document.querySelector<HTMLInputElement>('.si-page .si-field[data-key="name"] input')!;
    name.value = 'A New Name';
    name.dispatchEvent(new Event('change', { bubbles: true }));
    await tick(50);
    expect(name.isConnected).toBe(true);
    expect(document.querySelector('.si-cpd-name')!.textContent).toBe('A New Name');
    expect(document.querySelector('.si-tree .si-row.on')!.textContent).toContain('A New Name');
  });
});

describe('what is typed is saved when the tab, or the window, goes', () => {
  it('an input that still has the keys is saved to its own project on a tab switch', async () => {
    const A = await openProject('A');
    const B = await openProject('B');
    const mode = makeMode();
    const tab = tabOf(A.p);
    const c = A.p.compounds[0];
    tab.sheetState = { pick: { kind: 'compound', id: c.id } };
    show(mode, tab);
    await tick(30);
    const input = partInputs()[0];
    input.focus();
    input.value = 'TYPED-NOT-LEFT';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    show(mode, tabOf(B.p, 2));
    await mode.saved(A.p);
    expect(compoundJson(A.f, c)).toContain('TYPED-NOT-LEFT');
    expect(compoundJson(B.f, B.p.compound(c.id))).not.toContain('TYPED-NOT-LEFT');
  });

  it('saved() is done only when the writes have landed, in the order they were made', async () => {
    const { p, f } = await openProject('slow', { slowMs: 60 });
    const mode = makeMode();
    const tab = tabOf(p);
    const c = p.compounds[0];
    tab.sheetState = { pick: { kind: 'compound', id: c.id } };
    show(mode, tab);
    await tick(30);
    const [a, b] = partInputs();
    a.value = 'FIRST';
    a.dispatchEvent(new Event('change', { bubbles: true }));
    b.value = 'SECOND';
    b.dispatchEvent(new Event('change', { bubbles: true }));
    await mode.saved();
    const text = compoundJson(f, c);
    expect(text).toContain('FIRST');
    expect(text).toContain('SECOND');
  });

  it('Undo waits for what is being typed and takes back one step at a time', async () => {
    const { p, f, j } = await openProject();
    const mode = makeMode();
    const tab = tabOf(p);
    const c = p.compounds[0];
    tab.sheetState = { pick: { kind: 'compound', id: c.id } };
    show(mode, tab);
    await tick(30);
    const before = compoundJson(f, c);
    const input = partInputs()[0];
    input.value = 'TO-BE-UNDONE';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    // (two Undos at once: the second finds nothing left, it never runs into the first)
    await Promise.all([mode.undo(), mode.undo()]);
    expect(compoundJson(f, c)).toBe(before);
    expect(j.history(false)).toBeNull();
    expect(flashes.some((m) => /Wait for the change/.test(m))).toBe(false);
  });
});

describe('two SI projects in two tabs', () => {
  it('a copy of a project (the same compound ids) keeps its own structures', async () => {
    const A = await openProject('A');
    const B = await openProject('B (a copy)');
    const cA = A.p.compounds.find((c) => A.p.hasStructure(c))!;
    const cB = B.p.compound(cA.id);
    const molA = await A.p.readStructure(cA);
    await B.p.setStructure(cB, molA.replace(/ C /, ' N '));
    const molB = await B.p.readStructure(cB);
    expect(molB).not.toBe(molA);
    const mode = makeMode();
    const m = mode as unknown as { mols: Map<string, string> };
    show(mode, tabOf(A.p, 1));
    await tick(50);
    expect(m.mols.get(cA.id)).toBe(molA);
    show(mode, tabOf(B.p, 2));
    await tick(50);
    expect(m.mols.get(cB.id)).toBe(molB);
    show(mode, tabOf(A.p, 1));
    await tick(20);
    expect(m.mols.get(cA.id)).toBe(molA);
  });

  it('a project shown while another one’s structures are being read is still checked', async () => {
    const A = await openProject('A');
    const B = await openProject('B');
    const mode = makeMode({ siFacts: async (ms: string[]) => { await tick(60); return ms.map(() => null); } });
    const m = mode as unknown as { warnings: Map<string, unknown[]> };
    show(mode, tabOf(A.p, 1));
    await tick(5);
    show(mode, tabOf(B.p, 2));
    await tick(400);
    const withStructure = B.p.compounds.filter((c) => B.p.hasStructure(c));
    expect(withStructure.length).toBeGreaterThan(0);
    expect(withStructure.filter((c) => m.warnings.has(c.id)).length).toBe(withStructure.length);
  });
});

describe('the tree', () => {
  it('Alt+ArrowDown in a field is the field’s own key; on a row it moves the compound and the keys stay in the tree', async () => {
    const { p } = await openProject();
    const mode = makeMode();
    const tab = tabOf(p);
    const sec = p.dataSections[0];
    const loose = sec.items.filter((x) => x.kind === 'compound');
    const c = loose[0];
    const at = sec.items.indexOf(c);
    tab.sheetState = { pick: { kind: 'compound', id: c.id } };
    show(mode, tab);
    await tick(30);
    const input = partInputs()[0];
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true, cancelable: true }));
    await tick(50);
    expect(sec.items.indexOf(c)).toBe(at);
    const row = document.querySelector<HTMLElement>('.si-tree .si-row.on')!;
    row.focus();
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true, cancelable: true }));
    await tick(50);
    expect(sec.items.indexOf(c)).toBe(at + 1);
    const on = document.querySelector<HTMLElement>('.si-tree .si-row.on')!;
    expect(document.activeElement).toBe(on);
    // and again, without clicking
    on.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true, cancelable: true }));
    await tick(50);
    expect(sec.items.indexOf(c)).toBe(at + 2);
  });

  it('keeps its rows when only a field’s value changed', async () => {
    const { p } = await openProject();
    const mode = makeMode();
    const tab = tabOf(p);
    tab.sheetState = { pick: { kind: 'compound', id: p.compounds[0].id } };
    show(mode, tab);
    await tick(50);
    const rows = [...document.querySelectorAll('.si-tree .si-row')];
    const notes = document.querySelector<HTMLElement>('.si-page .si-rich')!;
    notes.append(document.createTextNode('x'));
    notes.dispatchEvent(new Event('blur'));
    await tick(50);
    const after = [...document.querySelectorAll('.si-tree .si-row')];
    expect(after.length).toBe(rows.length);
    expect(after.filter((r, i) => r === rows[i]).length).toBeGreaterThan(rows.length - 2);
  });

  it('a pick that Undo took away falls back to the project’s page, and its row is the one marked', async () => {
    const { p } = await openProject();
    const mode = makeMode();
    const tab = tabOf(p);
    show(mode, tab);
    await tick(20);
    await mode.run('new-compound');
    await tick(20);
    expect((tab.sheetState as { pick: { kind: string } }).pick.kind).toBe('compound');
    await mode.undo();
    await tick(20);
    expect((tab.sheetState as { pick: { kind: string } }).pick.kind).toBe('project');
    expect(document.querySelector('.si-tree .si-row.on')!.classList.contains('si-root')).toBe(true);
  });

  it('a drop on a scheme page’s row never lands past the scheme’s compounds', async () => {
    const { p } = await openProject();
    const mode = makeMode();
    show(mode, tabOf(p));
    await tick(20);
    const m = mode as unknown as { dropPlace(d: unknown, t: unknown, f: number): { where: string; run(): Promise<void> } | null };
    const sec = p.dataSections[0];
    const k = sec.items.find((x) => x.kind === 'scheme' && x.children.length)!;
    if (k.kind !== 'scheme') throw new Error('no scheme page with compounds in the example');
    const child = k.children[0];
    const loose = sec.items.find((x) => x.kind === 'compound')!;
    // its own compound: stays (the lower part), or moves out before the scheme (the top edge)
    expect(m.dropPlace({ kind: 'compound', id: child.id }, { kind: 'scheme', id: k.id }, 0.8)).toBeNull();
    expect(m.dropPlace({ kind: 'compound', id: child.id }, { kind: 'scheme', id: k.id }, 0.1)?.where).toBe('before');
    // another compound: into the scheme
    const got = m.dropPlace({ kind: 'compound', id: loose.id }, { kind: 'scheme', id: k.id }, 0.8)!;
    expect(got.where).toBe('in');
    await got.run();
    expect(k.children.some((x) => x.id === loose.id)).toBe(true);
    // onto itself, and a section into itself
    expect(m.dropPlace({ kind: 'compound', id: child.id }, { kind: 'compound', id: child.id }, 0.2)).toBeNull();
    expect(m.dropPlace({ kind: 'section', id: sec.id }, { kind: 'section', id: sec.id }, 0.5)).toBeNull();
  });
});

describe('commands', () => {
  it('a command that fails says so and leaves the tab usable', async () => {
    const { p } = await openProject();
    const mode = makeMode({ pickFiles: async () => { throw new Error('the file window could not open'); } });
    const tab = tabOf(p);
    tab.sheetState = { pick: { kind: 'compound', id: p.compounds[0].id } };
    show(mode, tab);
    await tick(20);
    await expect(mode.run('add-files')).resolves.toBeUndefined();
    expect(flashes.some((m) => m.includes('the file window could not open'))).toBe(true);
    await mode.run('new-compound');
    expect((tab.sheetState as { pick: { kind: string } }).pick.kind).toBe('compound');
  });

  it('a read-only project’s values are not changed in memory either', async () => {
    const { p } = await openProject('ro', { readOnly: true });
    const c = p.compounds[0];
    const before = JSON.stringify(valuesOf(c));
    await expect(p.setPart(c, 'name', 'text', 'changed')).rejects.toThrow(/read-only/);
    expect(JSON.stringify(valuesOf(c))).toBe(before);
    const mode = makeMode();
    const tab = tabOf(p);
    tab.sheetState = { pick: { kind: 'compound', id: c.id } };
    show(mode, tab);
    await tick(30);
    expect(partInputs().every((i) => i.disabled)).toBe(true);
  });
});

describe('a compound’s files', () => {
  it('removing one takes only its own original to the Trash, not another file of the same stem', async () => {
    const { p, f } = await openProject();
    const c = p.compounds[0];
    const def = ALL_FIELDS.get('spectra')!;
    const dir = `${c.folder}/${def.subdir || 'spectra'}`;
    await p.addField(c, { key: 'spectra' }).catch(() => {});
    const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
    // "1H.svg" pasted with its original "1H.emf"; "1H (2).pdf" with no original, beside another spectrum's "1H (2).emf"
    f.files.set(`${dir}/1H.svg`, enc('<svg/>'));
    f.files.set(`${dir}/1H.emf`, enc('emf-1'));
    f.files.set(`${dir}/1H (2).pdf`, enc('pdf'));
    f.files.set(`${dir}/1H (2).emf`, enc('emf-of-another'));
    const list: Json[] = [{ file: '1H.svg', type: '1H', original: '1H.emf' }, { file: '1H (2).pdf', type: '1H' }, { file: 'other.svg', type: '13C', original: '1H (2).emf' }];
    valuesOf(c).spectra = list;
    await p.saveCompound(c);
    await p.removeAttachment(c, def, '1H (2).pdf');
    expect(f.files.has(`${dir}/1H (2).pdf`)).toBe(false);
    expect(f.files.has(`${dir}/1H (2).emf`)).toBe(true);
    await p.removeAttachment(c, def, '1H.svg');
    expect(f.files.has(`${dir}/1H.svg`)).toBe(false);
    expect(f.files.has(`${dir}/1H.emf`)).toBe(false);
    expect([...f.files.keys()].some((k) => k.startsWith('trash/') && k.endsWith('/1H.emf'))).toBe(true);
  });
});

describe('SI text boxes', () => {
  const box = (text = '', multiline = true): SiRichBox => {
    const b = new SiRichBox(text, { label: (r) => r, changed: () => {} }, multiline);
    document.body.append(b.el);
    return b;
  };

  it('a line break inside a paragraph is a new line, not lost', () => {
    const b = box();
    b.el.innerHTML = '<div>first<br>second<br></div><div><b>third<br>fourth</b></div><div><br></div><div>last</div>';
    expect(b.text.split('\n').map((l) => l.replace(/\*\*/g, ''))).toEqual(['first', 'second', 'third', 'fourth', '', 'last']);
    const one = box('', false);
    one.el.innerHTML = '<div>a<br>b</div>';
    expect(one.text).toBe('a b');
  });

  it('keeps a non-breaking space between words, and reads the browser’s own as spaces', () => {
    const b = box();
    b.el.innerHTML = '<div>400\u00a0MHz and\u00a0 two, end\u00a0</div>';
    expect(b.text).toBe('400\u00a0MHz and  two, end ');
  });

  it('pasted text keeps underline, mentions and citations', () => {
    const html = '<p><u>under</u> <span style="text-decoration: underline">lined</span> see <span class="si-mention" contenteditable="false" data-ref="c:c-12345678">2b</span> and <span class="si-cite" data-ref="cite:r-1,r-2">[1,2]</span> <a href="x" style="text-decoration: underline">link</a> <span data-ref="javascript:alert(1)">x</span></p>';
    const clean = cleanPastedHtml(html, true);
    expect(hasFormatting(clean)).toBe(true);
    expect(clean).toContain('<u>under</u>');
    expect(clean).toContain('<u>lined</u>');
    expect(clean).toContain('data-ref="c:c-12345678"');
    expect(clean).toContain('data-ref="cite:r-1,r-2"');
    expect(clean).not.toContain('<u>link</u>');
    expect(clean).not.toContain('javascript');
    expect(cleanPastedHtml('<p>400\u00a0MHz</p>', true)).toBe('400\u00a0MHz');
    // and the box reads the pasted links back as links
    const b = box();
    b.el.innerHTML = `<div>${clean}</div>`;
    expect(b.text).toContain('@{c-12345678}');
  });
});
