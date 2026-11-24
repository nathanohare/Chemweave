// The Spectra section's newer parts: every project gets one, its defaults written as SI Assistant
// writes them, the structure box above, beside or on blank space (SI Assistant's issue #1), the
// links from peak reports to their spectra and back (SPEC §13l.7), links to places that aren't in
// the document swept away, and the live preview of the section and of one compound's pages.
// The geometry is worked by hand from the functions' own definitions; no chemistry values.
import { beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { MemoryFolder } from '../src/si/folder';
import { SiProject, type Json } from '../src/si/project';
import { molFacts } from '../src/si/chem';
import { compileSi, compoundBookmark, PREVIEW_SPECTRA, spectraPagesBefore, spectrumMark, type CompileHost } from '../src/si/compile-doc';
import { readScene, sceneToDoc } from '../src/io/chem-formats';
import { ACS_1996 } from '../src/style';
import { autoPlace, blankSpot, boxSpot, DEFAULTS, defaultsJson, PLACE_GAP, roomBeside, type InkMap, type SpectrumLayout } from '../src/si/spectra';
import { dumpPyJson } from '../src/si/pyjson';
import type { DocObject } from '../src/document/document';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let RDKit: any;
beforeAll(async () => { RDKit = await createRequire(import.meta.url)('@rdkit/rdkit')(); });

function folder(dir: string): MemoryFolder {
  const root = join(__dirname, 'fixtures', dir);
  const f = new MemoryFolder(dir);
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name !== 'README.md') f.files.set(relative(root, p).split('\\').join('/'), new Uint8Array(readFileSync(p)));
    }
  };
  walk(root);
  return f;
}

const C2A = 'sections/s-972b3c47_synthesis-and-charac/compounds/c-26c39a99_1-phenylethan';
const SPECTRA = 'sections/s-d79a6040_spectra/section.json';
const page = { src: 'data:image/png;base64,AAAA', w: 792, h: 612 };

function host(extra: Partial<CompileHost> = {}): CompileHost {
  return {
    contentsOf: (mol) => { const s = readScene('mol', mol); return s ? sceneToDoc(s, ACS_1996).doc.contents() : null; },
    sizeOf: () => ({ w: 108, h: 79.2 }),
    facts: async (mols) => mols.map((m) => (m ? molFacts(RDKit, m) : null)),
    pdfPages: async () => [page],
    ...extra,
  };
}

async function example(defaults: Partial<SpectrumLayout> & Json = {}): Promise<SiProject> {
  const f = folder('si-example');
  f.files.set(`${C2A}/spectra/2a_1H.pdf`, new Uint8Array([37, 80, 68, 70]));
  f.files.set(`${C2A}/spectra/2a_13C.pdf`, new Uint8Array([37, 80, 68, 70]));
  const data = JSON.parse(new TextDecoder().decode(f.files.get(SPECTRA))) as Json;
  data.defaults = { ...(data.defaults as Json), ...defaults };
  f.files.set(SPECTRA, new TextEncoder().encode(JSON.stringify(data)));
  return SiProject.open(f);
}

const floats = (objs: DocObject[], name: string) => objs.filter((o) => 'float' in o && (o as { float?: { name?: string } }).float?.name?.startsWith(name)) as Extract<DocObject, { kind: 'textbox' }>[];
const spectraPics = (objs: DocObject[]) => objs.filter((o): o is Extract<DocObject, { kind: 'picture' }> => o.kind === 'picture' && !!o.float);

describe('every project has a Spectra section', () => {
  it('adds one to a project without, once, moving the old project settings into it', async () => {
    const f = new MemoryFolder('new');
    const p = await SiProject.create(f, 'Test');
    expect(p.settings.spectra_per_page).toBe(2);
    expect(p.sections.some((s) => s.type === 'spectra')).toBe(false);
    const s = (await p.ensureSpectraSection({ nmr_links: true, link_back: true }))!;
    expect(s.type).toBe('spectra');
    expect(p.top[p.top.length - 1]).toBe(s);
    expect(p.settings.spectra_per_page).toBeUndefined();
    const d = s.data.defaults as Json;
    expect(d.per_page).toBe(2);
    expect(d.nmr_links).toBe(true);
    expect(d.link_back).toBe(true);
    expect(await p.ensureSpectraSection()).toBe(s);
    // and it is there when the project is opened again
    const back = await SiProject.open(f);
    expect(back.sections.filter((x) => x.type === 'spectra')).toHaveLength(1);
  });

  it('writes the defaults in SI Assistant’s order, its decimals as decimals', () => {
    const d = defaultsJson({ struct_scale: 1, per_page: 2 });
    // (every key SI Assistant writes, in its order; Chemweave's link color only when one is chosen)
    expect(Object.keys(d)).toEqual(Object.keys(DEFAULTS).filter((k) => k !== 'link_color'));
    expect(Object.keys(defaultsJson({ link_color: '#c00000' }))).toContain('link_color');
    const text = dumpPyJson(d);
    expect(text).toContain('"struct_scale": 1.0');
    expect(text).toContain('"auto_min_scale": 0.5');
    expect(text).toContain('"per_page": 2,');
  });
});

describe('placing the structure box', () => {
  /** A map `cols` × `rows` with ink in the columns from `from` to `to`. */
  const inked = (rows: number, cols: number, from: number, to: number): InkMap => {
    const ink = new Uint8Array(rows * cols);
    for (let y = 0; y < rows; y++) for (let x = from; x < to; x++) ink[y * cols + x] = 1;
    return { rows, cols, ink };
  };

  it('finds the blank place nearest the corner', () => {
    // ink in the left half: a box 3 cells square nearest the top left is at columns 5 to 7, rows 0 to 2
    expect(blankSpot(inked(10, 10, 0, 5), [0.3, 0.3], 'top-left')).toEqual([0.65, 0.15]);
    expect(blankSpot(inked(10, 10, 0, 5), [0.3, 0.3], 'bottom-right')).toEqual([0.85, 0.85]);
    // nothing blank wide enough
    expect(blankSpot(inked(10, 10, 2, 9), [0.3, 0.3], 'top-left')).toBeNull();
  });

  it('makes the structure smaller to fit when asked, and gives up below the smallest size', () => {
    const ink = inked(100, 100, 0, 60);   // 40 % of the width blank
    const shown = { w: 500, h: 500 };
    const box = (scale: number) => ({ w: 300 * scale, h: 100 * scale });
    expect(autoPlace(ink, shown, box, 1, 'top-left')).toBeNull();
    const got = autoPlace(ink, shown, box, 1, 'top-left', true, 0.5)!;
    expect(got.scale).toBeLessThan(1);
    expect(got.scale).toBeGreaterThanOrEqual(0.5);
    // (the box and its clearance end inside the blank part)
    expect(got.x - (box(got.scale).w / 2) / shown.w).toBeGreaterThanOrEqual(0.6);
    expect(autoPlace(ink, shown, box, 1, 'top-left', true, 0.9)).toBeNull();
  });

  it('gives a box above or beside the spectrum its own room', () => {
    const eff = { ...DEFAULTS, struct_place: 'above' as const };
    expect(boxSpot(eff)).toBe('above');
    expect(boxSpot({ ...eff, x: 0.5, y: 0.5 })).toBe('on');   // (a dragged box stays on the spectrum)
    expect(boxSpot({ ...eff, struct_box: false })).toBe('on');
    expect(roomBeside({ w: 600, h: 400 }, 'above', { w: 100, h: 80 })).toEqual({ w: 600, h: 400 - 80 - PLACE_GAP });
    expect(roomBeside({ w: 600, h: 400 }, 'beside', { w: 100, h: 80 })).toEqual({ w: 600 - 100 - PLACE_GAP, h: 400 });
  });

  it('prints the box above the spectrum, the spectrum smaller under it', async () => {
    const on = await compileSi(await example(), host());
    const above = await compileSi(await example({ struct_place: 'above' }), host());
    const [picOn] = spectraPics(Object.values(on.doc.objects));
    const objs = Object.values(above.doc.objects);
    const [pic] = spectraPics(objs);
    const [box] = floats(objs, 'Structure box');
    expect(pic.h).toBeLessThan(picOn.h);
    expect(box.float.y + box.h).toBeLessThanOrEqual(pic.float!.y + 1e-6);
  });

  it('prints the box beside the spectrum', async () => {
    const got = await compileSi(await example({ struct_place: 'beside' }), host());
    const objs = Object.values(got.doc.objects);
    const [pic] = spectraPics(objs);
    const [box] = floats(objs, 'Structure box');
    expect(box.float.x).toBeGreaterThanOrEqual(pic.float!.x + pic.w - 1e-6);
  });

  it('puts the box on blank space of the spectrum, or above it when there is none', async () => {
    // the left 60 % of each spectrum inked: the box goes in the blank right part
    const map = (from: number, to: number): InkMap => { const m = { rows: 100, cols: 100, ink: new Uint8Array(10000) }; for (let y = 0; y < 100; y++) for (let x = from; x < to; x++) m.ink[y * 100 + x] = 1; return m; };
    const got = await compileSi(await example({ struct_place: 'auto' }), host({ inkMap: async () => map(0, 60) }));
    const objs = Object.values(got.doc.objects);
    const [pic] = spectraPics(objs);
    const [box] = floats(objs, 'Structure box');
    expect(box.float.x).toBeGreaterThanOrEqual(pic.float!.x + 0.6 * pic.w);
    expect(box.float.y).toBeGreaterThanOrEqual(pic.float!.y);
    const full = await compileSi(await example({ struct_place: 'auto' }), host({ inkMap: async () => map(0, 100) }));
    const o2 = Object.values(full.doc.objects);
    const [p2] = spectraPics(o2);
    const [b2] = floats(o2, 'Structure box');
    expect(b2.float.y + b2.h).toBeLessThanOrEqual(p2.float!.y + 1e-6);
    // (and says so, as it does when the spectrum can't be read)
    expect(got.notes.join('\n')).not.toContain('above the spectrum');
    expect(full.notes.some((n) => n.includes('fits no blank space') && n.includes('2a_1H.pdf'))).toBe(true);
    const unread = await compileSi(await example({ struct_place: 'auto' }), host({ inkMap: async () => { throw new Error('no canvas'); } }));
    expect(unread.notes.some((n) => n.includes('blank space could not be read'))).toBe(true);
  });
});

describe('links between peak reports and spectra', () => {
  it('links “1H NMR” of the peak report to the spectrum, and the spectrum’s header back', async () => {
    const { doc } = await compileSi(await example({ nmr_links: true, link_back: true }), host());
    const to1H = `#${spectrumMark('c-26c39a99', '1H')}`;
    const linked = doc.runs.filter((r) => r.link === to1H).map((r) => r.text).join('');
    expect(linked).toBe('1H NMR');
    const marks = doc.paras.flatMap((ps) => ps?.marks ?? []);
    expect(marks).toContain(spectrumMark('c-26c39a99', '1H'));
    expect(marks).toContain(compoundBookmark('c-26c39a99'));
    const heads = floats(Object.values(doc.objects), 'Header');
    expect(heads[0].runs.some((r) => r.link === `#${compoundBookmark('c-26c39a99')}`)).toBe(true);
  });

  it('leaves the links out when turned off, and drops a link whose spectrum isn’t printed', async () => {
    const off = await compileSi(await example({ nmr_links: false, link_back: false }), host());
    expect(off.doc.runs.some((r) => r.link?.startsWith('#si_'))).toBe(false);
    // no spectrum files can be read: nothing to link to
    const gone = await compileSi(await example({ nmr_links: true }), host({ pdfPages: async () => null }));
    expect(gone.doc.runs.some((r) => r.link?.startsWith('#si_nmr'))).toBe(false);
  });

  it('colors the links when asked, in the color chosen', async () => {
    const { doc } = await compileSi(await example({ nmr_links: true, link_style: 'blue_underline' }), host());
    const run = doc.runs.find((r) => r.link === `#${spectrumMark('c-26c39a99', '1H')}`)!;
    expect(run.color).toBe('#0563c1');
    expect(run.underline).toBeTruthy();
    const red = await compileSi(await example({ nmr_links: true, link_style: 'blue', link_color: '#c00000' }), host());
    const r2 = red.doc.runs.find((r) => r.link === `#${spectrumMark('c-26c39a99', '1H')}`)!;
    expect(r2.color).toBe('#c00000');
    expect(r2.underline).toBeFalsy();
  });

  it('links the spectra back to the compounds without the peak reports’ links', async () => {
    const { doc } = await compileSi(await example({ nmr_links: false, link_back: true }), host());
    expect(doc.runs.some((r) => r.link?.startsWith('#si_nmr'))).toBe(false);
    const heads = floats(Object.values(doc.objects), 'Header');
    expect(heads[0].runs.some((r) => r.link === `#${compoundBookmark('c-26c39a99')}`)).toBe(true);
  });

  it('turns the table of contents’ links off when asked', async () => {
    const on = await compileSi(await example(), host());
    expect(Object.values(on.doc.objects).find((o) => o.kind === 'toc')).toMatchObject({ kind: 'toc' });
    expect(Object.values(on.doc.objects).find((o) => o.kind === 'toc')).not.toHaveProperty('noLinks');
    const p = await example();
    p.settings.toc = { ...(p.settings.toc as Json ?? {}), links: false };
    const off = await compileSi(p, host());
    expect(Object.values(off.doc.objects).find((o) => o.kind === 'toc')).toMatchObject({ noLinks: true });
  });
});

describe('the live preview of spectra pages', () => {
  it('shows one compound’s spectra pages without the section heading', async () => {
    const p = await example();
    const { doc } = await compileSi(p, host(), { kind: 'spectra', id: 'c-26c39a99' });
    expect(spectraPics(Object.values(doc.objects))).toHaveLength(2);
    expect(doc.runs.map((r) => r.text).join('')).not.toContain('Spectra');
  });

  it('numbers one compound’s spectra pages on from the spectra before it', async () => {
    // 2a's two PDFs of three pages each, one to a page (the example's Spectra section): six pages before 2b's
    const p = await example();
    expect(await spectraPagesBefore(p, host(), 'c-26c39a99', async () => 3)).toBe(0);
    expect(await spectraPagesBefore(p, host(), 'c-cf3f4417', async () => 3)).toBe(6);
    // two to a page: three; four to a page: two (4 + 2); a PDF that can’t be read: none
    expect(await spectraPagesBefore(await example({ per_page: 2 }), host(), 'c-cf3f4417', async () => 3)).toBe(3);
    expect(await spectraPagesBefore(await example({ per_page: 4 }), host(), 'c-cf3f4417', async () => 3)).toBe(2);
    expect(await spectraPagesBefore(p, host(), 'c-cf3f4417', async () => null)).toBe(0);
  });

  it('shows the whole Spectra section when it is selected', async () => {
    const p = await example();
    const s = p.sections.find((x) => x.type === 'spectra')!;
    const { doc } = await compileSi(p, host(), { kind: 'section', id: s.id });
    expect(spectraPics(Object.values(doc.objects))).toHaveLength(2);
    expect(doc.runs.map((r) => r.text).join('')).toContain('Spectra');
  });

  it('shows only the first spectra of a long Spectra section, and says Compile prints them all', async () => {
    const many = Array.from({ length: PREVIEW_SPECTRA }, () => page);
    const p = await example();
    const s = p.sections.find((x) => x.type === 'spectra')!;
    const prev = await compileSi(p, host({ pdfPages: async () => many }), { kind: 'section', id: s.id });
    expect(spectraPics(Object.values(prev.doc.objects))).toHaveLength(PREVIEW_SPECTRA);
    expect(prev.notes.some((n) => n.includes(`first ${PREVIEW_SPECTRA} spectra; Compile prints them all`))).toBe(true);
    const all = await compileSi(p, host({ pdfPages: async () => many }));
    expect(spectraPics(Object.values(all.doc.objects))).toHaveLength(2 * PREVIEW_SPECTRA);
  });
});

describe('the printed HRMS ion label in compound.json', () => {
  it('goes before the report files and where the found m/z came from, as SI Assistant writes it', async () => {
    const p = await example();
    const c = p.compounds.find((x) => x.id === 'c-26c39a99')!;
    await p.setValue(c, 'hrms', { ionization: 'ESI', adduct: '[M+Na]+', found: '145.0625', species: '', formula: '', reports: [], found_from: { file: 'a.txt', mz: 145.0625 } });
    await p.setPart(c, 'hrms', 'ion_label', '[M−Br]+', ['reports', 'print_reports', 'found_from']);
    expect(Object.keys(c.data.values && (c.data.values as Json).hrms as Json)).toEqual(['ionization', 'adduct', 'found', 'species', 'formula', 'ion_label', 'reports', 'found_from']);
    await p.setPart(c, 'hrms', 'ion_label', '', ['reports', 'print_reports', 'found_from']);
    expect(Object.keys((c.data.values as Json).hrms as Json)[5]).toBe('ion_label');
  });
});
