// @vitest-environment jsdom
//
// The SI tab's own pages and windows, each on its own (src/ui/si-*.ts), for the faults found in the
// full code review (batch 06): each test does what the finding's steps say.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { filesTaken } from '../src/ui/window-drop';
import { SiAttachmentPage } from '../src/ui/si-attachment';
import { SiManuscriptPage, newManuscriptState } from '../src/ui/si-manuscript';
import { SiFrontPage } from '../src/ui/si-front';
import { SiSpectraPage } from '../src/ui/si-spectra';
import { openTrash } from '../src/ui/si-trash';
import { askImport } from '../src/ui/si-import-dialog';
import { siSettingsWindow } from '../src/ui/si-settings';
import { cleanPastedHtml } from '../src/ui/si-paste-html';
import { compileProgress } from '../src/ui/si-progress';
import { splitDois } from '../src/document/references';
import { newSpectrum } from '../src/si/si-import-spectra';
import * as I from '../src/si/si-import';
import * as Rd from '../src/si/si-import-read';
import { parseMarkup } from '../src/si/markup';
import { fetchDoi } from '../src/document/references';
import { SiProjectError, type Json } from '../src/si/project';
import { impurityTolerances } from '../src/si/nmr';
import { MemoryFolder } from '../src/si/folder';
import { modalWindows, openProject, tick } from './review-batch06-helpers';

let readAllRuns = { now: 0, most: 0, fail: '' };
vi.mock('../src/si/ms-check', async (orig) => {
  const actual = await orig<typeof import('../src/si/ms-check')>();
  return {
    ...actual,
    manuscriptFiles: vi.fn(async () => { await new Promise((r) => setTimeout(r, 30)); return ['a.pdf']; }),
    readAll: vi.fn(async () => {
      readAllRuns.now++;
      readAllRuns.most = Math.max(readAllRuns.most, readAllRuns.now);
      await new Promise((r) => setTimeout(r, 50));
      readAllRuns.now--;
      if (readAllRuns.fail) throw new Error(readAllRuns.fail);
      return [];
    }),
  };
});
// (the Project Settings pages ask their questions with ask(): a test answers it, after changing the boxes of its body)
type AskHook = (title: string, fields: { name: string; value: string }[], opts: { body?: HTMLElement }) => Promise<Record<string, string> | null>;
let askHook: AskHook | null = null;
vi.mock('../src/ui/ask', async (orig) => {
  const actual = await orig<typeof import('../src/ui/ask')>();
  return { ...actual, ask: vi.fn(async (title: string, fields: never, opts: never) => (askHook ? askHook(title, fields, opts) : actual.ask(title, fields, opts))) };
});
vi.mock('../src/document/references', async (orig) => {
  const actual = await orig<typeof import('../src/document/references')>();
  return { ...actual, fetchDoi: vi.fn(actual.fetchDoi) };
});

beforeAll(modalWindows);
beforeEach(() => { askHook = null; document.body.innerHTML = ''; readAllRuns = { now: 0, most: 0, fail: '' }; });

const flashes: string[] = [];
const flash = (m: string): void => { flashes.push(m); };
const PDF = (tag: string): Uint8Array => new TextEncoder().encode(`%PDF-1.4 ${tag}`);

/** A file dropped on `target`, as the browser sends it (jsdom has no DataTransfer, and its File has no arrayBuffer). */
function drop(target: Element, name: string, bytes: Uint8Array = new Uint8Array([1, 2, 3])): Event {
  const file = { name, arrayBuffer: async () => bytes.buffer } as unknown as File;
  const e = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'dataTransfer', { value: { files: [file], types: ['Files'] } });
  target.dispatchEvent(e);
  return e;
}

describe('a file dropped on the Attachment preview (F225)', () => {
  for (const readOnly of [false, true]) {
    it(`is not also handled by the window's drop handler${readOnly ? ' (read-only project too)' : ''}`, async () => {
      const { p } = await openProject('A', { readOnly });
      const sec = p.sections.find((s) => s.type === 'file') ?? (readOnly ? p.section('s-972b3c47') : await p.addSection('file', 'Att'));
      const page = new SiAttachmentPage({ project: p, section: sec, flash, pickFiles: async () => [], pdfPages: async () => null, redraw: () => {} });
      document.body.append(page.el);
      const e = drop(page.el.querySelector('.si-attach-stage')!, 'x.png');
      // (the window's drop handler skips a drop whose files a part of the page took)
      expect(e.defaultPrevented).toBe(true);
      expect(filesTaken(e)).toBe(true);
    });
  }
});

describe('the Attachment page’s file', () => {
  it('Remove File leaves the file and the section as they were when the section can’t be saved (F959)', async () => {
    const { p, f } = await openProject();
    const sec = await p.addSection('file', 'Att');
    await p.attachSectionFile(sec, 'a.png', new Uint8Array([1, 2, 3]));
    const page = new SiAttachmentPage({ project: p, section: sec, flash, pickFiles: async () => [], pdfPages: async () => null, redraw: () => {} });
    vi.spyOn(p, 'saveSection').mockRejectedValueOnce(new Error('locked'));
    await page.remove();
    expect(sec.data.file).toBe('a.png');
    expect(f.files.has(`${sec.folder}/a.png`)).toBe(true);
  });

  it('shows the pages of a replaced PDF of the same name and length, not the old ones (F960)', async () => {
    let urls = 0;
    (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => `blob:page-${++urls}`;
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
    const { p } = await openProject();
    const sec = await p.addSection('file', 'Att');
    const host = {
      project: p, section: sec, flash, pickFiles: async () => [], pdfPages: async () => null, redraw: () => {},
      openPdf: async () => ({ count: 1, size: async () => ({ w: 595, h: 842 }), picture: async () => new Blob(['page']), close: () => {} }),
    };
    const shownSrc = async (): Promise<string> => {
      const page = new SiAttachmentPage(host as never);
      await tick(60);
      const src = page.el.querySelector('img')!.getAttribute('src') ?? '';
      page.dispose();
      return src;
    };
    await p.attachSectionFile(sec, 'report.pdf', PDF('AAAA'));
    const first = await shownSrc();
    expect(first).toMatch(/^blob:/);
    // (the old file goes to the Trash, so the name is free again)
    await p.attachSectionFile(sec, 'report.pdf', PDF('BBBB'));
    expect(sec.data.file).toBe('report.pdf');
    const second = await shownSrc();
    expect(second).toMatch(/^blob:/);
    expect(second).not.toBe(first);
  });
});

describe('the Manuscript Check page', () => {
  const manuscript = async (): Promise<{ page: SiManuscriptPage; state: ReturnType<typeof newManuscriptState> }> => {
    const { p } = await openProject();
    const state = newManuscriptState();
    const page = new SiManuscriptPage({
      project: p, flash, pickFiles: async () => [], openDocuments: () => [], smiles: async () => null, facts: async () => [],
      act: async (_l, f) => { await f(); }, openAt: () => {}, resultChanged: () => {},
    }, state);
    document.body.append(page.el);
    return { page, state };
  };

  it('files dropped on it are not also opened by the window’s drop handler (F227)', async () => {
    const { page } = await manuscript();
    const e = drop(page.el, 'manuscript.pdf', PDF('x'));
    expect(e.defaultPrevented).toBe(true);
    expect(filesTaken(e)).toBe(true);
    await tick(200);
  });

  it('two checks asked for at once are not run at once (F967)', async () => {
    const { page } = await manuscript();
    // (the first check is still listing the folder)
    await page.check(true);
    await tick(300);
    expect(readAllRuns.most).toBe(1);
  });

  it('says that the check failed, not that it is reading, when it could not be made (F968)', async () => {
    readAllRuns.fail = 'the PDF is damaged';
    const { page } = await manuscript();
    void page;
    await tick(300);
    const text = document.querySelector('.si-ms-summary')!.textContent!;
    expect(text).not.toMatch(/Reading the manuscript/);
    expect(text).toContain('the PDF is damaged');
    expect(text).toMatch(/Check Again/);
  });
});

describe('the cover page (F962, F963)', () => {
  const front = async (): Promise<{ page: SiFrontPage; p: Awaited<ReturnType<typeof openProject>>['p'] }> => {
    const { p } = await openProject();
    p.settings.authors = [{ name: 'Ann' }, { name: 'Bo' }, { name: 'Cy' }];
    const page = new SiFrontPage({ project: p, flash, label: () => '', mentionable: () => [], titleChanged: () => {}, redraw: () => {} });
    document.body.append(page.el);
    return { page, p };
  };

  it('a Spacing over the most shows the most that was kept (F962)', async () => {
    const { page, p } = await front();
    const box = page.el.querySelector<HTMLInputElement>('.si-front-num')!;
    box.value = '500';
    box.dispatchEvent(new Event('change', { bubbles: true }));
    await page.settled();
    expect(box.value).toBe('400');
    expect(JSON.stringify(p.settings)).toContain('400');
  });

  it('a double click on an author’s ✕ takes off that author only (F963)', async () => {
    const { page, p } = await front();
    const rm = page.el.querySelector<HTMLButtonElement>('.si-front-author .si-mini[title="Take this author off"]')!;
    rm.click();
    rm.click();
    await page.settled();
    expect((p.settings.authors as Json[]).map((a) => a.name)).toEqual(['Bo', 'Cy']);
  });
});

describe('Project ▸ Trash (F991)', () => {
  it('a double click on a row starts one Restore, not two', async () => {
    const { p } = await openProject();
    const sec = await p.addSection('file', 'Att');
    await p.attachSectionFile(sec, 'a.png', new Uint8Array([1, 2, 3]));
    await p.attachSectionFile(sec, 'b.png', new Uint8Array([4, 5, 6]));
    const messages: string[] = [];
    await openTrash(p, (m) => messages.push(m));
    const row = document.querySelector<HTMLElement>('.si-trash-row')!;
    row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await tick(150);
    expect(messages.length).toBe(1);
    expect(document.querySelector('.si-trash-say, dialog .muted.si-trash-none, dialog')!.textContent).not.toMatch(/not (in|there)|no longer/i);
  });
});

describe('pasted HTML (F983)', () => {
  it('keeps the cells of a table row apart and gives a list item holding a paragraph one line', () => {
    expect(cleanPastedHtml('<table><tr><td>Entry</td><td>Yield</td></tr><tr><td>1</td><td>89%</td></tr></table>', true)).toBe('Entry Yield<br>1 89%');
    expect(cleanPastedHtml('<ul><li><p>one</p></li><li><p>two</p></li></ul>', true)).toBe('one<br>two');
  });
});

describe('the progress window (F984)', () => {
  it('goes on while the window is hidden and paints no frames', async () => {
    const was = window.requestAnimationFrame;
    window.requestAnimationFrame = (() => 0) as never;      // (a hidden window never gets its frames)
    try {
      const progress = compileProgress('Compile', ['One']);
      await progress.at(1, 10, 'Working');
      await tick(150);
      const waited = Date.now();
      await progress.at(2, 10, 'Working');
      expect(Date.now() - waited).toBeLessThan(2000);
      progress.close();
    } finally { window.requestAnimationFrame = was; }
  }, 10000);
});

describe('Add by DOI (F972)', () => {
  it('keeps a comma or semicolon inside a DOI and splits on spaces, lines and a comma between DOIs', () => {
    // (a Wiley SICI-style DOI: Statistics in Medicine 1998, 17, 1661; its DOI holds "<", ">", ":" and ";")
    const sici = '10.1002/(SICI)1097-0258(19980815/30)17:15/16<1661::AID-SIM968>3.0.CO;2-2';
    expect(splitDois(sici)).toEqual([sici]);
    expect(splitDois(`${sici}\n10.1021/om100106e`)).toEqual([sici, '10.1021/om100106e']);
    expect(splitDois('10.1021/om100106e, 10.1021/ja00001a001')).toEqual(['10.1021/om100106e', '10.1021/ja00001a001']);
    expect(splitDois('10.1021/om100106e,10.1021/ja00001a001;10.1002/anie.1')).toEqual(['10.1021/om100106e', '10.1021/ja00001a001', '10.1002/anie.1']);
  });
});

// ---------------------------------------------------------------- the spectra page

describe('a compound’s spectra page', () => {
  const png = (w: number, h: number): Uint8Array => {
    const b = new Uint8Array(33);
    b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    const dv = new DataView(b.buffer);
    dv.setUint32(16, w); dv.setUint32(20, h);
    b[24] = 8; b[25] = 2;
    return b;
  };
  async function setUp(layout: Json = {}): Promise<{ page: SiSpectraPage; p: Awaited<ReturnType<typeof openProject>>['p']; c: ReturnType<Awaited<ReturnType<typeof openProject>>['p']['compound']>; saves: number[] }> {
    const { p, f } = await openProject();
    const c = p.compounds[0];
    const spectra = (c.data.values as { spectra: Json[] }).spectra;
    spectra.splice(0, spectra.length, { file: 'one.png', type: '1H', layout }, { file: 'two.png', type: '13C' });
    f.files.set(`${c.folder}/spectra/one.png`, png(200, 100));
    f.files.set(`${c.folder}/spectra/two.png`, png(200, 100));
    const saves: number[] = [];
    const ink = { rows: 10, cols: 10, ink: new Uint8Array(100).fill(1) };
    // (blank paper only in the top left corner, three cells across and down)
    for (let r = 0; r < 3; r++) for (let q = 0; q < 3; q++) ink.ink[r * 10 + q] = 0;
    const page = new SiSpectraPage({
      project: p, compound: c, section: null, flash, idOf: () => '2a', contentsOf: () => null, sizeOf: () => null, pictureOf: () => null,
      pdfPages: async () => null, contentBox: async () => null, inkMap: async () => ink,
      act: async (g) => { saves.push(1); await g(); }, chosen: () => {}, openSection: () => {},
    });
    document.body.append(page.el);
    for (let i = 0; i < 100 && !(page as unknown as { entries: unknown[] }).entries.length; i++) await tick(5);
    await tick(30);
    return { page, p, c, saves };
  }

  it('Move Down reorders the list without reading and fingerprinting every file again (F988)', async () => {
    const { page, p } = await setUp();
    const read = vi.spyOn(p.folder, 'readBytes');
    await page.move(1);
    expect(read).not.toHaveBeenCalled();
    expect(page.current!.file).toBe('one.png');
    const names = [...page.el.querySelectorAll('.si-spectra-file')].map((x) => x.textContent);
    expect(names).toEqual(['two.png', 'one.png']);
    await page.automaticOrder();
    expect([...page.el.querySelectorAll('.si-spectra-file')].map((x) => x.textContent)).toEqual(['one.png', 'two.png']);
    expect(read).not.toHaveBeenCalled();
  });

  it('a structure box made smaller on blank space keeps where it is dropped (F238)', async () => {
    const { page } = await setUp({ struct_box: true, struct_place: 'auto', auto_shrink: true, struct_scale: 4, auto_min_scale: 0.25, corner: 'top-left' });
    const box = page.el.querySelector<HTMLElement>('.si-spectra-box')!;
    expect(box).toBeTruthy();
    const paper = box.parentElement!;
    Object.defineProperty(box, 'offsetParent', { value: paper });
    (box as unknown as { setPointerCapture: () => void }).setPointerCapture = () => {};
    const at = (type: string, x: number, y: number): void => { box.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true })); };
    at('pointerdown', 10, 10);
    at('pointermove', 60, 40);
    at('pointerup', 60, 40);
    await tick(30);
    const pages = page.current!.item.pages as Json | undefined;
    const own = (pages?.['1'] ?? {}) as Json;
    expect(typeof own.x).toBe('number');
    expect(typeof own.y).toBe('number');
  });
});

// ---------------------------------------------------------------- the Import SI window

describe('Import SI window', () => {
  const para = (markup: string): Rd.Para => ({ ...Rd.newPara(Rd.mergeRuns(parseMarkup(markup)[0]?.runs ?? [])) });
  const read = { file_name: 'si.pdf', kind: 'pdf', paras: [], pages: 1, spectrum_pages: [], notes: [], error: '', stopped: false } as Rd.ReadResult;
  const host = { pictureOf: () => null, analyze: async () => null, dataSections: [], canMakeProject: false };
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  const label = (d: Element, text: string): HTMLButtonElement | undefined => [...d.querySelectorAll<HTMLButtonElement>('button.si-imp-label')].find((b) => (b.textContent ?? '').includes(text));
  const cancel = (d: Element): void => [...d.querySelectorAll('button')].find((b) => b.textContent === 'Cancel')!.click();

  it('a spectrum set to “(not matched)” can be found again when every spectrum was matched at first (F964)', async () => {
    const plan = I.analyse([para('**Phenol (2).** Colorless oil (1 mg, 1%).'), para('**Anisole (2a).** Colorless oil (1 mg, 1%).')]);
    plan.spectra = [newSpectrum('pdf', png, '1H', { cid: '2', ext: '.png' })];
    const asked = askImport(plan, read, host);
    const d = document.querySelector('dialog.si-import')!;
    expect(label(d, 'Spectra not matched')).toBeTruthy();
    label(d, 'Phenol')!.click();
    const which = d.querySelector<HTMLSelectElement>('.si-imp-side select[aria-label="Compound"]')!;
    which.value = '';
    which.dispatchEvent(new Event('change', { bubbles: true }));
    expect(label(d, 'Spectra not matched (1)')).toBeTruthy();
    label(d, 'Spectra not matched')!.click();
    expect(d.querySelectorAll('.si-imp-side select[aria-label="Compound"]').length).toBe(1);
    cancel(d);
    await asked;
  });

  it('what is typed in the references while Crossref is asked is kept, in the object the boxes write to (F965)', async () => {
    const plan = I.analyse([para('**Phenol (2).** Colorless oil (1 mg, 1%).')]);
    const ref = { id: 'r1', type: 'article', authors: [], title: 'Old title', journal: '', year: '', volume: '', issue: '', pages: '', doi: '10.1000/one', url: '', publisher: '', note: '' };
    plan.references = [{ number: '1', text: 'Old title', ref, keep: true, looked_up: '' } as never];
    vi.mocked(fetchDoi).mockImplementationOnce(async () => { await tick(60); return { ...ref, title: 'Crossref title', journal: 'Crossref journal' } as never; });
    const asked = askImport(plan, read, host);
    const d = document.querySelector('dialog.si-import')!;
    label(d, 'References')!.click();
    const look = [...d.querySelectorAll<HTMLButtonElement>('button')].find((b) => /Look Up/.test(b.textContent ?? ''))!;
    look.click();
    await tick(10);
    const title = d.querySelectorAll<HTMLInputElement>('.si-imp-refs td input[type=text]')[1];
    title.value = 'My own title';
    title.dispatchEvent(new Event('input', { bubbles: true }));
    await tick(150);
    const kept = (plan.references[0] as unknown as { ref: Json }).ref;
    expect(kept).toBe(ref);
    expect(kept.title).toBe('My own title');
    expect(kept.journal).toBe('Crossref journal');
    cancel(d);
    await asked;
  });

  it('a section name cleared and left comes back in its box (F966)', async () => {
    const plan = I.analyse([para('**1. General Information**'), para('All reactions were run under nitrogen in flame-dried glassware with magnetic stirring unless stated otherwise in the text.')]);
    plan.sections = [{ key: 's1', name: 'General', kind: 'text', parent: '', keep: true, compounds: [], figures: new Map() } as never];
    const asked = askImport(plan, read, host);
    const d = document.querySelector('dialog.si-import')!;
    label(d, 'Sections')!.click();
    const name = d.querySelector<HTMLInputElement>('.si-imp-made-row input[aria-label="Section name"]')!;
    name.value = '';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    name.dispatchEvent(new Event('change', { bubbles: true }));
    expect((plan.sections[0] as unknown as { name: string }).name).toBe('General');
    expect(name.value).toBe('General');
    cancel(d);
    await asked;
  });
});

// ---------------------------------------------------------------- Project Settings

describe('Project Settings', () => {
  /** Opens a page of the window: its question is answered by `askHook`. */
  async function settings(page: string): Promise<{ p: Awaited<ReturnType<typeof openProject>>['p']; f: MemoryFolder; saved: number[] }> {
    const proj = await openProject();
    const saved: number[] = [];
    const host = {
      save: async (change: () => void | Promise<void>) => { await change(); await proj.p.saveSettings(); saved.push(1); },
      chooseDrawingStyle: async () => null,
      dictionaryChanged: () => {},
    };
    siSettingsWindow(proj.p, host as never, page);
    await tick(150);
    return { p: proj.p, f: proj.f, saved };
  }

  it('a dictionary.txt that can’t be read is not shown as empty and written over (F236)', async () => {
    flashes.length = 0;
    const proj = await openProject();
    proj.f.files.set('dictionary.txt', new TextEncoder().encode('CDK2\nPdCl2\n'));
    const real = proj.f.readText.bind(proj.f);
    proj.f.readText = async (rel: string) => { if (rel === 'dictionary.txt') throw new Error('half synced'); return real(rel); };
    const saved: string[] = [];
    siSettingsWindow(proj.p, {
      save: async (change: () => void | Promise<void>) => { try { await change(); saved.push('saved'); } catch (e) { flashes.push(e instanceof SiProjectError || e instanceof Error ? e.message : String(e)); } },
      chooseDrawingStyle: async () => null, dictionaryChanged: () => {},
    } as never, 'dictionary');
    await tick(150);
    // (no Dictionary window with an empty box: a message instead, and the file as it was)
    expect(document.querySelector('textarea')).toBeNull();
    expect(flashes.join(' ')).toMatch(/dictionary\.txt/);
    expect(new TextDecoder().decode(proj.f.files.get('dictionary.txt')!)).toBe('CDK2\nPdCl2\n');
    expect(saved).toEqual([]);
  });

  it('an empty NMR tolerance box keeps the tolerance it had (F987)', async () => {
    let was: [number, number] = [0, 0];
    askHook = async (title, fields) => {
      if (title !== 'NMR Impurities') return null;
      return { tolH: '', tolC: fields.find((x) => x.name === 'tolC')!.value };
    };
    const proj = await openProject();
    was = impurityTolerances(proj.p.settings);
    const saved: number[] = [];
    siSettingsWindow(proj.p, { save: async (c: () => void) => { await c(); saved.push(1); }, chooseDrawingStyle: async () => null, dictionaryChanged: () => {} } as never, 'impurities');
    await tick(150);
    expect(saved.length).toBe(1);
    // (not 0 ppm, which would switch the warnings about ¹H peaks off)
    expect(impurityTolerances(proj.p.settings)).toEqual(was);
    expect(was[0]).toBeGreaterThan(0);
  });

  it('changing Normal moves Compound Title and Contents Heading with it, and saves no old Normal into them (F237)', async () => {
    const seen: string[] = [];
    askHook = async (title, _fields, opts) => {
      if (title !== 'Styles') return null;
      const rows = [...opts.body!.querySelectorAll<HTMLTableRowElement>('.si-styles-table tbody tr')];
      const font = (name: string): HTMLInputElement => rows.find((r) => r.cells[0].textContent === name)!.querySelector<HTMLInputElement>('input.si-st-font')!;
      const normal = font('Normal');
      normal.value = 'Arial';
      normal.dispatchEvent(new Event('input', { bubbles: true }));
      normal.dispatchEvent(new Event('change', { bubbles: true }));
      // (the styles made from Normal show it at once)
      seen.push(font('Compound Title').value, font('Contents Heading').value);
      return {};
    };
    const { f, saved } = await settings('styles');
    expect(saved.length).toBe(1);
    expect(seen).toEqual(['Arial', 'Arial']);
    const file = JSON.parse(new TextDecoder().decode(f.files.get('chemweave-styles.json')!)) as { styles: Record<string, Json> };
    expect(file.styles.Normal).toEqual({ font: 'Arial' });
    expect(file.styles.SICompound).toBeUndefined();
    expect(file.styles.SITocHeading).toBeUndefined();
  });
});

