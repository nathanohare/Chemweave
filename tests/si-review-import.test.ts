// @vitest-environment jsdom
// Import SI: what a review of it found (the review window's IDs, ticks and pictures, stereo
// prefixes in a PDF's labels, the ID table and general procedures of a project imported into).

import { describe, expect, it } from 'vitest';
import { MemoryFolder } from '../src/si/folder';
import { JournalFolder } from '../src/si/journal';
import { SiProject, compoundsOf, idTableOf, valuesOf } from '../src/si/project';
import { parseMarkup } from '../src/si/markup';
import * as Rd from '../src/si/si-import-read';
import * as I from '../src/si/si-import';
import * as A from '../src/si/si-import-apply';
import { findId, newSpectrum } from '../src/si/si-import-spectra';
import { outline, type ImportedSection } from '../src/si/si-import-text';
import { askImport, importProgress } from '../src/ui/si-import-dialog';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const para = (markup: string, extra: Partial<Rd.Para> = {}): Rd.Para => ({ ...Rd.newPara(Rd.mergeRuns(parseMarkup(markup)[0]?.runs ?? [])), ...extra });
const read = { file_name: 'si.pdf', kind: 'pdf', paras: [], pages: 1, spectrum_pages: [], notes: [], error: '', stopped: false } as Rd.ReadResult;
const host = { pictureOf: () => null, analyze: async () => null, dataSections: [], canMakeProject: false };
// (jsdom has no <dialog> methods)
const proto = HTMLDialogElement.prototype as unknown as { showModal: () => void; close: () => void };
proto.showModal = function () { /* */ };
proto.close = function () { /* */ };
const type = (box: HTMLInputElement, v: string): void => { box.value = v; box.dispatchEvent(new Event('input', { bubbles: true })); };
const click = (e: Element): void => (e as HTMLElement).click();
const labelled = (d: Element, text: string): HTMLButtonElement => [...d.querySelectorAll<HTMLButtonElement>('button.si-imp-label')].find((b) => (b.textContent ?? '').includes(text))!;
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

async function newProject(): Promise<SiProject> {
  return SiProject.create(new JournalFolder(new MemoryFolder('P')), 'P');
}

function coverSi(): Rd.Para[] {
  return [
    para('**Supporting Information**', { size: 16, page: 1 }),
    para('**A New Reaction of Phenols**', { size: 14, page: 1 }),
    para('Anna Author and Bert Author', { page: 1 }),
    para('**Table of Contents**', { size: 12, page: 1 }),
    para('General Information ........ S2', { page: 1 }),
    para('**1. General Information**', { size: 12, page: 2, top: 50, bottom: 62 }),
    para('All reactions were run under nitrogen in flame-dried glassware with magnetic stirring unless stated otherwise in the text.', { page: 2, top: 70, bottom: 90, size: 10 }),
    para('**Figure S1.** The setup.', { page: 2, top: 300, bottom: 312, size: 10 }),
    para('**2. Compounds**', { size: 12, page: 3 }),
    para('**Phenol (2).** Colorless oil (1 mg, 1%).', { page: 3, size: 10 }),
  ];
}

describe('Import SI review window', () => {
  it('retyping a compound’s ID takes only its own spectra along', async () => {
    const plan = I.analyse([para('**Phenol (2).** Colorless oil (1 mg, 1%).'), para('**Anisole (2a).** Colorless oil (1 mg, 1%).')]);
    plan.spectra = [newSpectrum('pdf', png, '1H', { cid: '2', ext: '.png' }), newSpectrum('pdf', png, '1H', { cid: '2a', ext: '.png' }), newSpectrum('pdf', png, '13C', { cid: '', ext: '.png' })];
    const asked = askImport(plan, read, host);
    const d = document.querySelector('dialog.si-import')!;
    click(labelled(d, 'Anisole'));
    const id = d.querySelector<HTMLInputElement>('input.si-imp-id')!;
    for (const v of ['2', '', '3', '3b']) type(id, v);      // Backspace, Backspace, 3, b
    expect(plan.spectra.map((s: A.ImportedSpectrum) => s.cid)).toEqual(['2', '3b', '']);
    // …and while the ID is empty, or the same as another compound's, each spectrum still goes to its own compound
    type(id, '2');
    click([...d.querySelectorAll('button')].find((b) => b.textContent === 'Cancel')!);
    expect(await asked).toBeNull();
    const p = await newProject();
    await A.applyPlan(p, plan, 'si.pdf');
    const spectra = p.compounds.map((c) => ((valuesOf(c).spectra ?? []) as { type: string }[]).map((s) => s.type));
    expect(spectra).toEqual([['1H'], ['1H']]);
  });

  it('a spectrum without a compound is not given to a compound without an ID', async () => {
    const plan = I.analyse([para('**Phenol (2).** Colorless oil (1 mg, 1%).')]);
    plan.compounds[0].cid = '';
    plan.spectra = [newSpectrum('pdf', png, '13C', { cid: '', ext: '.png' })];
    const p = await newProject();
    const result = await A.applyPlan(p, plan, 'si.pdf');
    expect(result.spectra).toBe(0);
  });

  it('a heading’s level changed: the cover page’s and the figures’ ticks and changes stay', async () => {
    const plan = I.analyse(coverSi());
    expect(plan.cover).toBeTruthy();
    const asked = askImport(plan, read, host);
    const d = document.querySelector('dialog.si-import')!;
    const coverBox = labelled(d, 'Cover page').parentElement!.querySelector<HTMLInputElement>('input[type=checkbox]')!;
    click(coverBox);
    plan.cover.title = 'My Title';
    const fig = [...(plan.sections as ImportedSection[]).find((s) => s.figures.size)!.figures.values()][0];
    fig.keep = false;
    fig.label = 'Figure S9';
    fig.data = png;          // (cut out of the PDF)
    click(labelled(d, 'Sections'));
    const go = d.querySelector<HTMLButtonElement>('button.primary')!;
    for (const to of ['2', '1']) {
      const pick = d.querySelector<HTMLSelectElement>('.si-imp-heads select')!;
      pick.value = to;
      pick.dispatchEvent(new Event('change'));
      expect(go.disabled).toBe(true);        // (no Import while the sections are worked out again)
      await tick(); await tick();
    }
    expect(go.disabled).toBe(false);
    expect(plan.cover.keep).toBe(false);
    expect(plan.cover.title).toBe('My Title');
    const fig2 = [...(plan.sections as ImportedSection[]).find((s) => s.figures.size)!.figures.values()][0];
    expect([fig2.keep, fig2.label, fig2.data]).toEqual([false, 'Figure S9', png]);
    click(coverBox);
    expect(plan.cover.keep).toBe(true);
    click([...d.querySelectorAll('button')].find((b) => b.textContent === 'Cancel')!);
    await asked;
  });

  it('outline again keeps what it can of the figures when one more appears', () => {
    const plan = I.analyse(coverSi());
    const before = (plan.sections as ImportedSection[]).flatMap((s) => [...s.figures.values()]);
    before[0].keep = false;
    outline(plan, plan.body_size);
    const after = (plan.sections as ImportedSection[]).flatMap((s) => [...s.figures.values()]);
    expect(after.map((f) => f.keep)).toEqual([false]);
  });

  it('gives its pictures back when it closes', async () => {
    const made: string[] = [], revoked: string[] = [];
    const U = URL as unknown as { createObjectURL: (b: Blob) => string; revokeObjectURL: (u: string) => void };
    const [c0, r0] = [U.createObjectURL, U.revokeObjectURL];
    U.createObjectURL = () => { made.push(`blob:${made.length}`); return made[made.length - 1]; };
    U.revokeObjectURL = (u) => { revoked.push(u); };
    try {
      const plan = I.analyse([para('**Phenol (2).** Colorless oil (1 mg, 1%).')]);
      plan.spectra = [newSpectrum('pdf', png, '1H', { cid: '2', ext: '.png' })];
      const asked = askImport(plan, read, host);
      const d = document.querySelector('dialog.si-import')!;
      await tick();
      expect(made.length).toBe(1);
      click([...d.querySelectorAll('button')].find((b) => b.textContent === 'Cancel')!);
      await asked;
      expect(revoked).toEqual(made);
    } finally { U.createObjectURL = c0; U.revokeObjectURL = r0; }
  });

  it('the progress window: Cancel is remembered, and not offered while writing', () => {
    const busy = importProgress('Import SI: x.pdf');
    const d = document.querySelector('dialog.si-import-busy')!;
    const cancel = d.querySelector('button')!;
    busy.canCancel(false);
    expect(cancel.hidden).toBe(true);
    d.dispatchEvent(new Event('cancel', { cancelable: true }));
    expect(busy.cancelled).toBe(false);
    busy.canCancel(true);
    click(cancel);
    expect(busy.cancelled).toBe(true);
    busy.close();
    expect(document.querySelector('dialog.si-import-busy')).toBeNull();
  });
});

describe('Import SI: IDs with a stereo prefix, general procedures, the ID table', () => {
  it('finds an ID after its stereo prefix in a spectrum’s header', () => {
    expect(findId('(±)-3 — 1H NMR (400 MHz, CDCl3)', ['3'])).toBe('3');
    expect(findId('(S)-2a 13C NMR', ['2', '2a'])).toBe('2a');
    expect(findId('1H NMR of rac-5', ['5'])).toBe('5');
    expect(findId('1H NMR of ent-4b', ['4', '4b'])).toBe('4b');
    // (still not inside a word or another ID, and never the nucleus)
    expect(findId('SI-3 1H NMR', ['3'])).toBe('');
    expect(findId('1H NMR of 2a', ['2a', ''])).toBe('2a');
  });

  it('names more than 26 unlabelled general procedures', () => {
    const paras: Rd.Para[] = [];
    for (let i = 0; i < 30; i++) paras.push(para('**General Procedure**'), para('Text of it.'));
    const names = I.analyse(paras).gps.map((g) => g.name);
    expect(names.slice(24)).toEqual(['General Procedure Y', 'General Procedure Z', 'General Procedure 1', 'General Procedure 2', 'General Procedure 3', 'General Procedure 4']);
    expect(new Set(names).size).toBe(30);
  });

  const gpSi = (): Rd.Para[] => [
    para('**General Procedure A: Methylation**'), para('To a solution of phenol was added MeI.'),
    para('**Phenol (3c).** Prepared according to General Procedure A from x (10 mg). Colorless oil (1 mg, 1%).'),
    para('**Anisole (3d).** Prepared according to General Procedure A from y (12 mg). Colorless oil (1 mg, 1%).'),
  ];

  it('a general procedure’s name stays its own in the project', async () => {
    const p = await newProject();
    await A.applyPlan(p, I.analyse(gpSi()), 'si.docx');
    const second = await A.applyPlan(p, I.analyse(gpSi()), 'si.docx');
    expect(p.dataSections.flatMap((s) => p.generalProcedures(s).map((g) => g.name))).toEqual(['General Procedure A', 'General Procedure B']);
    expect(second.notes.join(' ')).toContain('General Procedure B');
    // its compounds are linked to it all the same
    const c = compoundsOf(p.dataSections[1])[0];
    expect(p.compoundGp(c)?.name).toBe('General Procedure B');
  });

  it('an ID waiting in the ID table is used, not written a second time', async () => {
    const p = await newProject();
    const s = await p.addSection('data', 'Mine');
    await p.addCompound(s.id, undefined, 'a');
    await p.addCompound(s.id, undefined, 'b');
    await p.setIdTable(s.id, ['3a', '3b', '3c', '3d', '3e']);
    const plan = I.analyse(gpSi());
    plan.compounds.reverse();          // (3d before 3c)
    await A.applyPlan(p, plan, 'si.docx', { sectionId: s.id });
    expect(idTableOf(p.section(s.id))).toEqual(['3a', '3b', '3d', '3c', '3e']);
    const r = p.idReport();
    expect(compoundsOf(p.section(s.id)).map((c) => r.ids.get(c.id))).toEqual(['3a', '3b', '3d', '3c']);
    expect(r.tableWarnings.size).toBe(0);
  });
});

describe('Import SI: a Word file read in steps', () => {
  const DIR = join(__dirname, 'fixtures', 'si-import', 'files');
  const bytes = new Uint8Array(readFileSync(join(DIR, '49f744f844.docx')));

  it('reads the same as in one go', async () => {
    const whole = Rd.readSiDocx('si.docx', bytes);
    const steps = await Rd.readSiFile('si.docx', bytes, () => true);
    expect(steps.paras.map(Rd.paraMarkup)).toEqual(whole.paras.map(Rd.paraMarkup));
    expect(steps.error).toBe(whole.error);
  });

  it('can be stopped', async () => {
    const r = await Rd.readSiFile('si.docx', bytes, () => false);
    expect(r.stopped).toBe(true);
    expect(r.error).toBe('');
  });
});
