// @vitest-environment jsdom
//
// The SI tab's pages as a person uses them (src/ui/si-mode.ts), for the faults found in the full
// code review (batch 06): each test does what the finding's steps say and checks what should happen.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fieldKeys, valuesOf, defaultFieldsOf, type Json, type SiCompound } from '../src/si/project';
import { setSiDictionary } from '../src/ui/si-spell';
import { fetchDoi } from '../src/document/references';
import { ask } from '../src/ui/ask';
import * as CompileDoc from '../src/si/compile-doc';
import { flashes, makeMode, modalWindows, openProject, show, tabOf, tick } from './review-batch06-helpers';

// (the pop-up questions are answered with what each offers first; a test sets its own answers for the ones it cares about)
vi.mock('../src/ui/ask', async (orig) => {
  const actual = await orig<typeof import('../src/ui/ask')>();
  return {
    ...actual,
    ask: vi.fn(actual.ask),
    askChoice: vi.fn(async (_t: string, _x: string, options: { value: string; primary?: boolean }[]) => (options.find((o) => o.primary) ?? options[0]).value),
  };
});
vi.mock('../src/ui/si-spell', async (orig) => {
  const actual = await orig<typeof import('../src/ui/si-spell')>();
  return { ...actual, setSiDictionary: vi.fn(actual.setSiDictionary) };
});
vi.mock('../src/document/references', async (orig) => {
  const actual = await orig<typeof import('../src/document/references')>();
  return { ...actual, fetchDoi: vi.fn(actual.fetchDoi) };
});
vi.mock('../src/si/compile-doc', async (orig) => {
  const actual = await orig<typeof import('../src/si/compile-doc')>();
  return { ...actual, objectLabelSets: vi.fn(actual.objectLabelSets) };
});

beforeAll(modalWindows);
beforeEach(() => { flashes.length = 0; });

const SPECTRA = 's-d79a6040';
const DATA = 's-972b3c47';

async function open(pick: unknown, over: Record<string, unknown> = {}) {
  const proj = await openProject();
  const mode = makeMode(over);
  const tab = tabOf(proj.p);
  tab.sheetState = { pick };
  show(mode, tab);
  await tick(60);
  return { ...proj, mode, tab };
}
const rowOf = (group: string): HTMLElement => [...document.querySelectorAll<HTMLElement>('.si-spectra-row')].find((r) => r.querySelector('.si-spectra-group')?.textContent === group)!;
const cell = (row: HTMLElement, label: string): HTMLElement | undefined => [...row.querySelectorAll<HTMLElement>('label.si-part')].find((l) => l.textContent?.startsWith(label));

describe('Spectra section settings that show other controls (F229)', () => {
  it('Frame, Caption and Look show and hide their Width, Caption size and Color as they are changed', async () => {
    await open({ kind: 'section', id: SPECTRA });
    // (the example project has no frame, no caption and plain links)
    expect(cell(rowOf('Pages'), 'Width')).toBeUndefined();
    const frame = cell(rowOf('Pages'), 'Frame')!.querySelector('input')!;
    frame.checked = true;
    frame.dispatchEvent(new Event('change', { bubbles: true }));
    await tick(60);
    expect(cell(rowOf('Pages'), 'Width')).toBeDefined();
    expect(cell(rowOf('Pages'), 'Color')).toBeDefined();
    const again = cell(rowOf('Pages'), 'Frame')!.querySelector('input')!;
    again.checked = false;
    again.dispatchEvent(new Event('change', { bubbles: true }));
    await tick(60);
    expect(cell(rowOf('Pages'), 'Width')).toBeUndefined();

    expect(cell(rowOf('Structure and ID'), 'Caption size')).toBeUndefined();
    const cap = cell(rowOf('Structure and ID'), 'Caption')!.querySelector('input')!;
    cap.checked = true;
    cap.dispatchEvent(new Event('change', { bubbles: true }));
    await tick(60);
    expect(cell(rowOf('Structure and ID'), 'Caption size')).toBeDefined();

    expect(cell(rowOf('Links'), 'Color')).toBeUndefined();
    const look = cell(rowOf('Links'), 'Link Style')!.querySelector('select')!;
    look.value = 'blue';
    look.dispatchEvent(new Event('change', { bubbles: true }));
    await tick(60);
    expect(cell(rowOf('Links'), 'Color')).toBeDefined();
  });
});

describe('a compound’s page', () => {
  it('choosing a general procedure keeps the placeholder values typed since the page was drawn (F231)', async () => {
    const { p, mode } = await open({ kind: 'compound', id: 'c-26c39a99' });
    const c = p.compound('c-26c39a99');
    const box = [...document.querySelectorAll<HTMLElement>('.si-gp-part')].find((x) => x.querySelector('.si-plabel')?.textContent === 'ketone')!.querySelector<HTMLElement>('.si-rich')!;
    box.textContent = 'TYPED KETONE';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    box.dispatchEvent(new Event('blur'));
    await mode.saved();
    const sel = [...document.querySelectorAll<HTMLElement>('label.si-part')].find((l) => l.querySelector('.si-plabel')?.textContent === 'General procedure')!.querySelector('select')!;
    sel.value = '';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await mode.saved();
    await tick(30);
    const proc = valuesOf(c).procedure as Json;
    expect(proc.gp).toBe('');
    expect(JSON.stringify((proc.values as Json).ketone)).toContain('TYPED KETONE');
  });

  it('a double click on an NMR report’s ✕ removes that report only (F232)', async () => {
    const proj = await openProject();
    const c = proj.p.compound('c-26c39a99');
    await proj.p.setValue(c, 'nmr', [1, 2, 3].map((n) => ({ nucleus: '1H', text: `report ${n}` })));
    const mode = makeMode();
    const tab = tabOf(proj.p);
    tab.sheetState = { pick: { kind: 'compound', id: c.id } };
    show(mode, tab);
    await tick(60);
    const xs = document.querySelectorAll<HTMLButtonElement>('.si-nmr .si-mini');
    expect(xs.length).toBe(3);
    xs[0].click();
    xs[0].click();
    await mode.saved();
    await tick(30);
    expect((valuesOf(c).nmr as Json[]).map((r) => r.text)).toEqual(['report 2', 'report 3']);
  });
});

describe('Move Up and Move Down on a scheme page (F233)', () => {
  it('move the scheme page among its section’s pages, not the section', async () => {
    const { p, mode, tab } = await open({ kind: 'section', id: DATA });
    const sec = p.section(DATA);
    const k = sec.items.find((i) => i.kind === 'scheme')!;
    const topBefore = p.top.map((s) => s.id);
    const at = sec.items.indexOf(k);
    tab.sheetState = { pick: { kind: 'scheme', id: k.id } };
    await mode.run('move-down');
    await mode.saved();
    expect(p.top.map((s) => s.id)).toEqual(topBefore);
    expect(p.section(DATA).items.indexOf(k)).toBe(at + 1);
    await mode.run('move-up');
    await mode.saved();
    expect(p.section(DATA).items.indexOf(k)).toBe(at);
  });

  it('say why when what is picked is not something that moves, and move nothing', async () => {
    const { p, mode, tab } = await open({ kind: 'section', id: SPECTRA });
    const top = p.top.map((s) => s.id);
    tab.sheetState = { pick: { kind: 'spectra', id: 'c-26c39a99', section: SPECTRA } };
    flashes.length = 0;
    await mode.run('move-down');
    await mode.saved();
    expect(p.top.map((s) => s.id)).toEqual(top);
    expect(flashes.some((m) => /Select a compound, a scheme page or a section/.test(m))).toBe(true);
  });
});

describe('Cite from My Library (F234, F982)', () => {
  const lib = { now: { references: [{ type: 'article', authors: ['A. Author'], title: 'A Paper', journal: 'J', year: '2020', volume: '', issue: '', pages: '', doi: '10.1000/xyz', url: '', publisher: '', note: '' }] } };

  it('Enter in the Search box takes the Add button, not Cancel', async () => {
    const { p, mode } = await open({ kind: 'compound', id: 'c-26c39a99' }, { library: async () => lib });
    const c = p.compound('c-26c39a99');
    const before = ((valuesOf(c).references as Json | undefined)?.refs as string[] | undefined)?.length ?? 0;
    const done = mode.run('cite-library');
    await tick(30);
    const dialog = document.querySelector<HTMLDialogElement>('dialog.si-pick')!;
    const form = dialog.querySelector('form')!;
    // (jsdom has no method="dialog": a submit closes the window with its submitter's value, as a browser does)
    form.addEventListener('submit', (e) => { e.preventDefault(); dialog.close((e as SubmitEvent).submitter?.getAttribute('value') ?? ''); });
    const row = dialog.querySelector<HTMLInputElement>('.si-pick-row input')!;
    row.checked = true;
    row.dispatchEvent(new Event('change', { bubbles: true }));
    // (Enter in a box clicks the form's first submit button)
    const first = [...form.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.type === 'submit')!;
    expect(first.textContent).toBe('Add');
    form.requestSubmit(first);
    await done;
    await mode.saved();
    expect(((valuesOf(c).references as Json).refs as string[]).length).toBe(before + 1);
  });

  it('cites into a compound whose References value is missing', async () => {
    const { p, mode } = await open({ kind: 'compound', id: 'c-26c39a99' }, { library: async () => lib });
    const c = p.compound('c-26c39a99');
    delete valuesOf(c).references;
    const done = mode.run('cite-library');
    await tick(30);
    const row = document.querySelector<HTMLInputElement>('dialog.si-pick .si-pick-row input')!;
    row.checked = true;
    row.dispatchEvent(new Event('change', { bubbles: true }));
    const add = [...document.querySelectorAll<HTMLButtonElement>('dialog.si-pick button')].find((b) => b.textContent === 'Add')!;
    add.click();
    document.querySelector<HTMLDialogElement>('dialog.si-pick')!.close('ok');
    await done;
    await mode.saved();
    expect(flashes.filter((m) => /Could not save/.test(m))).toEqual([]);
    expect(((valuesOf(c).references as Json).refs as string[]).length).toBe(1);
  });
});

const priv = (mode: unknown): Record<string, (...a: unknown[]) => Promise<unknown>> & Record<string, unknown> => mode as never;

// (F228: a ribbon command already runs as one named step of Undo, SiMode.run; this keeps it so)
describe('Structure to Name on a section (F228)', () => {
  it('writes every name in one step of Undo, called Structure to Name', async () => {
    let n = 0;
    const { p, j, mode } = await open({ kind: 'section', id: DATA }, { nameStructure: async () => ({ ok: true, name: `made name ${++n}` }) });
    const list = p.compounds.filter((c) => p.hasStructure(c)).slice(0, 3);
    for (const c of list) await p.setValue(c, 'name', { text: '' });
    await mode.saved();
    j.settle();
    const was = list.map((c) => JSON.stringify(valuesOf(c).name));
    await mode.run('structure-to-name');
    await mode.saved();
    j.settle();
    expect(list.every((c) => /made name/i.test(JSON.stringify(valuesOf(c).name)))).toBe(true);
    expect(j.history(false)).toBe('Structure to Name');
    await mode.undo();
    const after = list.map((c) => JSON.stringify(valuesOf(p.compound(c.id)).name));
    expect(after).toEqual(was);
  });
});

describe('Structure to Name when a name can’t be saved (F981)', () => {
  it('counts only the names written', async () => {
    const { p, mode } = await open({ kind: 'section', id: DATA }, { nameStructure: async () => ({ ok: true, name: 'some name' }) });
    const c = p.compounds.find((x) => p.hasStructure(x))!;
    await p.setValue(c, 'name', { text: '' });
    await mode.saved();
    vi.spyOn(p, 'setValue').mockRejectedValueOnce(new Error('locked'));
    flashes.length = 0;
    await mode.run('structure-to-name');
    await mode.saved();
    expect(flashes.some((m) => /Could not save|locked/.test(m))).toBe(true);
    expect(flashes.some((m) => /^Named from its structure/.test(m))).toBe(false);
  });
});

describe('the ID table (F230)', () => {
  it('keeps the keys in the next row after Tab out of a row that was changed', async () => {
    const { mode } = await open({ kind: 'section', id: DATA });
    const row = (n: number): HTMLInputElement => document.querySelector<HTMLInputElement>(`input[aria-label="ID for row ${n}"]`)!;
    row(1).focus();
    row(1).value = '9z';
    row(1).dispatchEvent(new Event('change', { bubbles: true }));
    row(2).focus();
    await mode.saved();
    await tick(30);
    expect(document.activeElement?.getAttribute('aria-label')).toBe('ID for row 2');
    expect(document.activeElement?.isConnected).toBe(true);
    expect(row(1).value).toBe('9z');
  });

  it('keeps what was typed in that row before the page was drawn again, caret included', async () => {
    const { mode } = await open({ kind: 'section', id: DATA });
    const row = (n: number): HTMLInputElement => document.querySelector<HTMLInputElement>(`input[aria-label="ID for row ${n}"]`)!;
    row(1).focus();
    row(1).value = '9z';
    row(1).dispatchEvent(new Event('change', { bubbles: true }));
    const two = row(2);
    two.focus();
    // (typed while the change of row 1 is being saved, before the page is drawn again)
    two.value = '3b';
    two.setSelectionRange(1, 1);
    await mode.saved();
    await tick(30);
    expect(document.activeElement?.getAttribute('aria-label')).toBe('ID for row 2');
    expect(document.activeElement).not.toBe(two);
    expect((document.activeElement as HTMLInputElement).value).toBe('3b');
    expect((document.activeElement as HTMLInputElement).selectionStart).toBe(1);
  });

  it('does not give the keys to a button of the page drawn again', async () => {
    const { mode } = await open({ kind: 'section', id: DATA });
    const button = [...document.querySelectorAll<HTMLButtonElement>('.si-page button')].find((b) => !b.disabled && !b.closest('[hidden]'))!;
    button.focus();
    expect(document.activeElement).toBe(button);
    const m = mode as unknown as { shownKey: string; refresh(): void };
    m.shownKey = '';
    m.refresh();
    expect(document.activeElement?.tagName).not.toBe('BUTTON');
  });
});

describe('the project’s dictionary (F969)', () => {
  it('is read again when the tab was left before its words were read', async () => {
    const proj = await openProject();
    proj.f.files.set('dictionary.txt', new TextEncoder().encode('CDK2\n'));
    const read = proj.f.readText.bind(proj.f);
    proj.f.readText = async (rel: string) => { if (rel === 'dictionary.txt') await tick(80); return read(rel); };
    const mode = makeMode();
    const tab = tabOf(proj.p);
    vi.mocked(setSiDictionary).mockClear();
    show(mode, tab);
    show(mode, null);
    await tick(200);
    show(mode, tab);
    await tick(200);
    const last = vi.mocked(setSiDictionary).mock.calls.at(-1)![0];
    expect(last?.words).toContain('CDK2');
  });
});

describe('Add by DOI (F973)', () => {
  it('adds nothing to a project that was left while the DOIs were looked up', async () => {
    const A = await openProject('A');
    const B = await openProject('B');
    vi.mocked(ask).mockImplementationOnce(async () => ({ doi: '10.1000/one' }));
    vi.mocked(fetchDoi).mockImplementationOnce(async () => { await tick(60); return { id: 'r1', type: 'article', authors: ['A. Author'], title: 'T', journal: 'J', year: '2020', volume: '', issue: '', pages: '', doi: '10.1000/one', url: '', publisher: '', note: '' } as never; });
    const mode = makeMode();
    const tabA = tabOf(A.p, 1);
    show(mode, tabA);
    await tick(30);
    const refsBefore = A.p.references.length;
    const run = mode.run('ref-doi');
    await tick(10);
    show(mode, tabOf(B.p, 2));
    await run;
    await mode.saved(A.p);
    await mode.saved(B.p);
    expect(A.p.references.length).toBe(refsBefore);
    expect(B.j.history(false)).toBeNull();
    expect(flashes.some((m) => /Another project is showing/.test(m))).toBe(true);
  });
});

describe('the default fields of a Data section (F975)', () => {
  it('two changes made before the list is drawn again both stay', async () => {
    const { p, mode } = await open({ kind: 'section', id: DATA });
    const boxes = [...document.querySelectorAll<HTMLInputElement>('.si-fieldrow input[type=checkbox]')];
    const off = boxes.filter((b) => !b.checked).slice(0, 2);
    expect(off.length).toBe(2);
    const keysOf = off.map((b) => b.closest('.si-fieldrow')!.textContent);
    for (const b of off) { b.checked = true; b.dispatchEvent(new Event('change', { bubbles: true })); }
    await mode.saved();
    await tick(30);
    const sec = p.section(DATA);
    const required = defaultFieldsOf(sec).filter((e) => e.required).length;
    expect(required).toBe(boxes.filter((b) => b.checked).length);
    expect(keysOf.length).toBe(2);
  });
});

describe('keys on the page (F978)', () => {
  it('Arrow Down on a button of the page scrolls it; on the tree it goes to the next row', async () => {
    const { tab } = await open({ kind: 'compound', id: 'c-26c39a99' });
    const key = (target: Element): void => { target.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })); };
    const button = document.querySelector('.si-page button')!;
    key(button);
    await tick(30);
    expect((tab.sheetState as { pick: { id: string } }).pick.id).toBe('c-26c39a99');
    key(document.querySelector('.si-tree .si-row.on')!);
    await tick(30);
    expect((tab.sheetState as { pick: { id: string } }).pick.id).not.toBe('c-26c39a99');
  });
});

describe('Add Field ▸ A custom field (F979)', () => {
  it('names with no letters or digits each get a field of their own', async () => {
    const { p, mode } = await open({ kind: 'compound', id: 'c-26c39a99' });
    const add = async (label: string): Promise<void> => {
      vi.mocked(ask).mockImplementationOnce(async () => ({ key: '+custom' }));
      vi.mocked(ask).mockImplementationOnce(async () => ({ label, type: 'short_text' }));
      await mode.run('add-field');
      await mode.saved();
    };
    const c = p.compound('c-26c39a99');
    const before = fieldKeys(c).filter((k) => k.startsWith('custom_')).length;
    await add('δ');
    await add('%');
    expect(fieldKeys(p.compound(c.id)).filter((k) => k.startsWith('custom_')).length).toBe(before + 2);
    expect(flashes.some((m) => /already/.test(m))).toBe(false);
    // (the same name again is still refused)
    await add('δ');
    expect(flashes.some((m) => /already/.test(m))).toBe(true);
  });
});

describe('Paste Spectrum (F980, F981)', () => {
  const pdf = (): { kind: 'picture'; mime: string; bytes: Uint8Array } => ({ kind: 'picture', mime: 'application/pdf', bytes: new TextEncoder().encode('%PDF-1.4 test') });

  it('reads the pasted data before it waits for the saves on their way', async () => {
    let live = true;
    const { p, mode } = await open({ kind: 'compound', id: 'c-26c39a99' }, { readClipboard: async () => { if (!live) throw new Error('the paste event is over'); return pdf(); } });
    const c = p.compound('c-26c39a99');
    const done = priv(mode).pasteSpectrum(c, {} as ClipboardEvent);
    live = false;
    await done;
    await mode.saved();
    expect(flashes.some((m) => /could not be read/.test(m))).toBe(false);
    expect(flashes.some((m) => /^Pasted a/.test(m))).toBe(true);
  });

  it('does not say it pasted when the spectrum could not be saved', async () => {
    const { p, f, mode } = await open({ kind: 'compound', id: 'c-26c39a99' }, { readClipboard: async () => pdf() });
    const c = p.compound('c-26c39a99');
    f.writeBytes = async () => { throw new Error('disk full'); };
    await priv(mode).pasteSpectrum(c);
    await mode.saved();
    expect(flashes.some((m) => /Could not save/.test(m))).toBe(true);
    expect(flashes.some((m) => /^Pasted a/.test(m))).toBe(false);
  });
});

describe('Report files dropped on a compound (F977)', () => {
  it('the HRMS field and the report are one step of Undo', async () => {
    const { p, j, mode } = await open({ kind: 'compound', id: 'c-26c39a99' });
    const c0 = p.compound('c-26c39a99');
    await p.removeField(c0, 'hrms');
    await mode.saved();
    j.settle();
    await priv(mode).addReports(c0 as SiCompound, [{ name: 'report.txt', bytes: new TextEncoder().encode('HRMS (ESI) m/z calcd for C8H10O [M+H]+ 123.0804, found 123.0801') }]);
    await mode.saved();
    j.settle();
    expect(fieldKeys(p.compound(c0.id))).toContain('hrms');
    await mode.undo();
    expect(fieldKeys(p.compound(c0.id))).not.toContain('hrms');
  });
});

describe('the Live Preview after a failed compile (F976)', () => {
  it('compiles again the next time it is asked for, not only moves over the old one', async () => {
    const { mode } = await open({ kind: 'section', id: DATA });
    const m = priv(mode);
    m.liveOn = true;
    // (a preview that failed: the state line says so and what is shown is the key of the last good compile)
    m.live = { el: document.createElement('div'), host: document.createElement('div'), state: document.createElement('div'), empty: document.createElement('div'), view: null, shown: '{"kind":"whole"}' };
    m.liveTarget = (() => ({ kind: 'whole' })) as never;
    m.liveDirty = false;
    m.pendingOf = (async () => { throw new Error('a file could not be read'); }) as never;
    await (m.liveUpdate as () => Promise<void>).call(mode);
    expect((m.live as { state: HTMLElement }).state.textContent).toContain('Not updated');
    expect(m.liveDirty).toBe(true);
  });
});

describe('the labels of tables, figures and schemes (F971)', () => {
  it('are worked out again only after the project’s files changed, not at every page drawn', async () => {
    const { p, mode, tab } = await open({ kind: 'compound', id: 'c-26c39a99' });
    const calls = vi.mocked(CompileDoc.objectLabelSets);
    await tick(60);
    const n0 = calls.mock.calls.length;
    for (const id of ['c-cf3f4417', 'c-e2e36085', 'c-26c39a99']) {
      tab.sheetState = { pick: { kind: 'compound', id } };
      show(mode, tab);
      await tick(50);
    }
    expect(calls.mock.calls.length).toBe(n0);
    await p.setValue(p.compound('c-cf3f4417'), 'name', { text: 'changed' });
    tab.sheetState = { pick: { kind: 'compound', id: 'c-cf3f4417' } };
    show(mode, tab);
    await tick(60);
    expect(calls.mock.calls.length).toBeGreaterThan(n0);
  });

  it('are worked out again after the project is read again from its files, and after Undo', async () => {
    const { p, j, mode, tab } = await open({ kind: 'compound', id: 'c-26c39a99' });
    const calls = vi.mocked(CompileDoc.objectLabelSets);
    const again = async (): Promise<number> => {
      const n = calls.mock.calls.length;
      tab.sheetState = { pick: { kind: 'compound', id: 'c-cf3f4417' } };
      show(mode, tab);
      await tick(60);
      tab.sheetState = { pick: { kind: 'compound', id: 'c-26c39a99' } };
      show(mode, tab);
      await tick(60);
      return calls.mock.calls.length - n;
    };
    await again();
    expect(await again()).toBe(0);
    // (a sync brought changes made elsewhere: Reload Project)
    await p.reload();
    expect(await again()).toBeGreaterThan(0);
    expect(await again()).toBe(0);
    await p.setValue(p.compound('c-cf3f4417'), 'name', { text: 'changed' });
    j.settle();
    await again();
    const n = calls.mock.calls.length;
    await mode.undo();
    await tick(100);
    expect(calls.mock.calls.length).toBeGreaterThan(n);
  });
});

describe('the tree (F970)', () => {
  it('looks up the open flags once for the whole tree, not once for each compound', async () => {
    const proj = await openProject();
    const spy = vi.spyOn(proj.p, 'openFlagsByPlace');
    const mode = makeMode();
    const tab = tabOf(proj.p);
    tab.sheetState = { pick: { kind: 'project' } };
    show(mode, tab);
    await tick(60);
    expect(proj.p.compounds.length).toBeGreaterThan(5);
    expect(spy.mock.calls.length).toBeLessThanOrEqual(3);
  });
});

describe('a scheme page', () => {
  const SCHEME = 'k-730d7f01';
  const svg = '<svg width="40pt" height="30pt"></svg>';

  it('Insert Structure in the conditions is one step of Undo (F235)', async () => {
    const drawn = { atoms: [{}], arrows: [], captions: [], shapes: [] };
    const { p, j, mode } = await open({ kind: 'scheme', id: SCHEME }, {
      pictureOf: () => svg,
      editStructure: (_c: unknown, _t: string, done: (c: unknown) => void) => done(drawn),
      molfileOf: () => ({ molblock: '\n  test\n\n  0  0  0  0  0  0  0  0  0  0999 V2000\nM  END\n' }),
    });
    await tick(60);
    const page = priv(mode).schemePage as unknown as { picked: unknown; command(c: string): Promise<void> };
    const k = p.scheme(SCHEME);
    const step = (k.data.editor as Json & { steps: { id: string }[] }).steps[0].id;
    page.picked = { kind: 'step', id: step, which: 'top' };
    const inline = (): string[] => Object.keys(((p.scheme(SCHEME).data.editor as Json).inline ?? {}) as Json);
    const before = inline().length;
    j.settle();
    await page.command('insert-structure');
    await tick(80);
    await mode.saved();
    j.settle();
    expect(inline().length).toBe(before + 1);
    await mode.undo();
    expect(inline().length).toBe(before);
    expect(JSON.stringify(p.scheme(SCHEME).data)).not.toContain('@struct');
  });

  it('a changed ID or yield does not draw the strip again, so the keys and the structures stay put (F985, F986)', async () => {
    let pictures = 0;
    const { mode } = await open({ kind: 'scheme', id: SCHEME }, { pictureOf: () => { pictures++; return svg; } });
    await tick(80);
    const strip = document.querySelector('.si-scheme-strip')!;
    const yieldBox = strip.querySelector<HTMLInputElement>('.si-scheme-yield')!;
    const label = strip.querySelector<HTMLInputElement>('.si-scheme-label')!;
    expect(pictures).toBeGreaterThan(0);
    const drawn = pictures;
    label.value = '1x';
    label.dispatchEvent(new Event('change', { bubbles: true }));
    yieldBox.focus();
    await mode.saved();
    await tick(80);
    expect(yieldBox.isConnected).toBe(true);
    expect(document.activeElement).toBe(yieldBox);
    expect(pictures).toBe(drawn);
    // (and a strip drawn again makes only the pictures it has not drawn before)
    await (priv(mode).schemePage as unknown as { paint(): Promise<void> }).paint();
    expect(pictures).toBe(drawn);
  });
});
