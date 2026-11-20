// The Spectra section of an SI project: which spectra print, in which order and how, their
// header lines and captions, auto-crop, and the spectra and HRMS pages of the compiled SI.
import { beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { MemoryFolder } from '../src/si/folder';
import { SiProject, type Json } from '../src/si/project';
import { molFacts } from '../src/si/chem';
import { compileSi } from '../src/si/compile-doc';
import { readScene, sceneToDoc } from '../src/io/chem-formats';
import { ACS_1996 } from '../src/style';
import { captionText, clean, contentBox, DEFAULTS, effective, grid, headerParts, listingLines, printKind, sectionDefaults, shownSize, slotSize, spectrumItems } from '../src/si/spectra';
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

describe('spectra settings', () => {
  it('ignores values that cannot be used and layers file and page settings', () => {
    expect(clean({ per_page: 3, orientation: 'sideways', struct_scale: 9, id_size: -1, struct_bg: '#ABCDEF', auto_crop: 'yes' })).toEqual({ struct_scale: 4, id_size: 0, struct_bg: '#abcdef' });
    expect(clean({ nmr_links: true }, false, true)).toEqual({});
    const item = { layout: { per_page: 2 }, pages: { 2: { corner: 'bottom-right', x: 1.4, y: 0.5 } } };
    expect(effective(DEFAULTS, item, '1')).toMatchObject({ per_page: 2, corner: 'top-left' });
    expect(effective(DEFAULTS, item, '2')).toMatchObject({ per_page: 2, corner: 'bottom-right', x: 1, y: 0.5 });
    expect(sectionDefaults(null, { spectra_per_page: 2 }).per_page).toBe(2);
  });

  it('sizes slots and spectra as the styles do', () => {
    expect(grid(2, false)).toEqual([1, 2]);
    expect(grid(2, true)).toEqual([2, 1]);
    expect(grid(4, true)).toEqual([2, 2]);
    const s = slotSize(468, 648, 2, false);
    expect(s.w).toBe(468);
    expect(s.h).toBeCloseTo((648 - 22.68) / 2, 1);
    // a landscape page in a tall slot: as wide as the slot
    expect(shownSize({ w: 400, h: 600 }, 0.5, null)).toEqual({ w: 400, h: 200 });
    // cropped to its middle half: the part shown keeps its own shape
    expect(shownSize({ w: 400, h: 600 }, 1, [0.25, 0.25, 0.75, 0.75])).toEqual({ w: 400, h: 400 });
  });

  it('finds the content of a page, leaving the axes', () => {
    const w = 200, h = 100, px = new Uint8ClampedArray(w * h * 4).fill(255);
    for (let x = 50; x < 150; x++) { const i = (60 * w + x) * 4; px[i] = px[i + 1] = px[i + 2] = 0; }
    for (let y = 20; y < 61; y++) { const i = (y * w + 50) * 4; px[i] = px[i + 1] = px[i + 2] = 0; }
    expect(contentBox(px, w, h)).toEqual([0.23, 0.16, 0.77, 0.65]);
    expect(contentBox(new Uint8ClampedArray(w * h * 4).fill(255), w, h)).toBeNull();
  });

  it('reads HRMS report files', () => {
    expect(printKind('3a.PDF')).toBe('pdf');
    expect(printKind('3a.mzML')).toBe('peaks');
    expect(printKind('3a.csv')).toBe('listing');
    expect(printKind('3a.raw')).toBe('none');
    expect(listingLines('a\tb\r\nc\n', 1)).toEqual([['a       b'], 1]);
  });
});

describe('a compound’s spectra', () => {
  it('orders them by type, or as set by hand, with header lines and captions from the peak reports', async () => {
    const p = await SiProject.open(folder('si-example'));
    const c = p.compounds.find((x) => x.id === 'c-26c39a99')!;
    expect(spectrumItems(c).map(([, i]) => i.file)).toEqual(['2a_1H.pdf', '2a_13C.pdf']);
    c.data.spectra_order = [['spectra', '2a_13C.pdf']];
    expect(spectrumItems(c).map(([, i]) => i.file)).toEqual(['2a_13C.pdf', '2a_1H.pdf']);
    delete c.data.spectra_order;
    const [, h1] = spectrumItems(c)[0];
    expect(headerParts(c, h1, '2a', 1)).toEqual(['2a — 1H NMR', ' (500 MHz, CDCl3)']);
    expect(headerParts(c, h1, '2a', 2)).toEqual(['2a — 1H NMR', ' (500 MHz, CDCl3)', ' (continued)']);
    expect(headerParts(c, { ...h1, title: 'Crude ¹H NMR' }, '2a', 1)).toEqual(['Crude ¹H NMR']);
    expect(captionText(c, h1)).toBe('1H NMR (CDCl3, 500 MHz)');
    expect(captionText(c, { type: 'HPLC/SFC', file: 'x.pdf' })).toBe('');
  });
});

describe('the spectra pages of the compiled SI', () => {
  it('lays each spectrum page out with its header and the structure and ID over it', async () => {
    const f = folder('si-example');
    f.files.set(`${C2A}/spectra/2a_1H.pdf`, new Uint8Array([37, 80, 68, 70]));
    f.files.set(`${C2A}/spectra/2a_13C.pdf`, new Uint8Array([37, 80, 68, 70, 1]));
    const p = await SiProject.open(f);
    const page = { src: 'data:image/png;base64,AAAA', w: 792, h: 612, px: { w: 1650, h: 1275 } };
    const { doc, notes } = await compileSi(p, {
      contentsOf: (mol) => { const s = readScene('mol', mol); return s ? sceneToDoc(s, ACS_1996).doc.contents() : null; },
      sizeOf: () => ({ w: 216, h: 79.2 }),
      facts: async (mols) => mols.map((m) => (m ? molFacts(RDKit, m) : null)),
      pdfPages: async (b) => (b.length === 5 ? [page, page] : [page]),
      contentBox: async () => [0.1, 0.1, 0.9, 0.9],
    });
    expect(notes.some((n) => /2a_1H/.test(n))).toBe(false);
    const objs = Object.values(doc.objects);
    const pics = objs.filter((o): o is Extract<DocObject, { kind: 'picture' }> => o.kind === 'picture' && !!o.float);
    expect(pics).toHaveLength(3);
    // the example's Spectra section turns its pages landscape (9 × 6.5 in of body): each
    // spectrum as large as fits under its header, keeping its shape (the first page also has
    // the section's heading)
    for (const pic of pics) { expect(pic.h / pic.w).toBeCloseTo(612 / 792, 3); expect(pic.w).toBeLessThanOrEqual(648); expect(pic.h).toBeLessThan(468 - 20); }
    expect(pics[1].w).toBeGreaterThan(pics[0].w);
    const heads = objs.filter((o): o is Extract<DocObject, { kind: 'textbox' }> => o.kind === 'textbox' && !!o.float.name?.startsWith('Header'));
    expect(heads.map((h) => h.runs.map((r) => r.text).join(''))).toEqual(['2a — 1H NMR (500 MHz, CDCl3)', '2a — 13C NMR (126 MHz, CDCl3)', '2a — 13C NMR (126 MHz, CDCl3) (continued)']);
    expect(heads[0].runs.find((r) => r.text === '1')?.sup).toBe(true);
    const boxes = objs.filter((o): o is Extract<DocObject, { kind: 'textbox' }> => o.kind === 'textbox' && !!o.float.name?.startsWith('Structure box'));
    expect(boxes).toHaveLength(3);
    expect(boxes[0]).toMatchObject({ fill: '#ffffff', runs: [] });
    const ids = objs.filter((o): o is Extract<DocObject, { kind: 'textbox' }> => o.kind === 'textbox' && !!o.float.name?.startsWith('Compound ID'));
    expect(ids[0].runs[0]).toMatchObject({ text: '2a', bold: true });
    // the structure, its natural size (3 × 1.1 in) fitted into 1.5 × 1.1 in, over the box
    const drawings = objs.filter((o): o is Extract<DocObject, { kind: 'drawing' }> => o.kind === 'drawing' && !!o.float);
    expect(drawings).toHaveLength(3);
    expect(drawings[0].scale).toBe(0.5);
    expect(drawings[0].float!.x).toBeGreaterThan(boxes[0].float.x);
    // each box's parts are one group (they move together), a group of their own per spectrum
    expect(boxes[0].float.group).toBeDefined();
    expect(ids[0].float.group).toBe(boxes[0].float.group);
    expect(drawings[0].float!.group).toBe(boxes[0].float.group);
    expect(boxes[1].float.group).not.toBe(boxes[0].float.group);
    // the pages turn landscape for the spectra and back for the references
    const breaks = doc.paras.map((ps, i) => [i, ps?.section] as const).filter(([, s]) => s);
    expect(breaks.map(([, s]) => s!.page!.w)).toEqual([792, 612]);
  });

  it('auto-crops, sets out 2 to a page and prints the HRMS reports when asked', async () => {
    const f = folder('si-example');
    f.files.set(`${C2A}/spectra/2a_1H.pdf`, new Uint8Array([37, 80, 68, 70]));
    f.files.set(`${C2A}/spectra/2a_13C.pdf`, new Uint8Array([37, 80, 68, 70]));
    const sec = 'sections/s-d79a6040_spectra/section.json';
    const data = JSON.parse(new TextDecoder().decode(f.files.get(sec))) as Json;
    data.defaults = { ...(data.defaults as Json), per_page: 2, orientation: 'portrait', auto_crop: true, caption: true, hrms_reports: true };
    f.files.set(sec, new TextEncoder().encode(JSON.stringify(data)));
    const cj = `${C2A}/compound.json`;
    const comp = JSON.parse(new TextDecoder().decode(f.files.get(cj))) as Json;
    ((comp.values as Json).hrms as Json).reports = [{ file: '2a_hrms.txt' }];
    f.files.set(cj, new TextEncoder().encode(JSON.stringify(comp)));
    f.files.set(`${C2A}/hrms/2a_hrms.txt`, new TextEncoder().encode('m/z\tintensity\n145.0625\t100\n'));
    const p = await SiProject.open(f);
    const page = { src: 'data:image/png;base64,AAAA', w: 612, h: 792 };
    const { doc } = await compileSi(p, {
      contentsOf: (mol) => { const s = readScene('mol', mol); return s ? sceneToDoc(s, ACS_1996).doc.contents() : null; },
      sizeOf: () => null,
      facts: async (mols) => mols.map((m) => (m ? molFacts(RDKit, m) : null)),
      pdfPages: async () => [page],
      contentBox: async () => [0.1, 0.2, 0.9, 0.8],
    });
    const pics = Object.values(doc.objects).filter((o): o is Extract<DocObject, { kind: 'picture' }> => o.kind === 'picture' && !!o.float);
    expect(pics).toHaveLength(2);
    expect(pics[0].crop).toEqual({ l: 0.1, t: 0.2, r: expect.closeTo(0.1, 5), b: expect.closeTo(0.2, 5) });
    // both on one portrait page: the second below the first
    expect(pics[1].float!.y).toBeGreaterThan(pics[0].float!.y + pics[0].h);
    expect(doc.paras.some((ps) => ps?.section)).toBe(false);
    const box = Object.values(doc.objects).find((o): o is Extract<DocObject, { kind: 'textbox' }> => o.kind === 'textbox' && !!o.float.name?.startsWith('Compound ID'))!;
    expect(box.runs.map((r) => r.text).join('')).toBe('2a\n1H NMR (CDCl3, 500 MHz)');
    const text = doc.runs.map((r) => r.text).join('');
    expect(text).toContain('HRMS reports');
    expect(text).toContain('2a — HRMS report: 2a_hrms.txt');
    expect(text).toContain('145.0625        100');
  });

  it('keeps a page’s own place for the box and for its ID (Alt-dragged), and prints them there', async () => {
    expect(clean({ x: 0.5, y: 2, label_dx: 12, label_dy: 'no' }, true)).toEqual({ x: 0.5, y: 1, label_dx: 12 });
    expect(clean({ label_dx: 12 })).toEqual({});
    const f = folder('si-example');
    f.files.set(`${C2A}/spectra/2a_1H.pdf`, new Uint8Array([37, 80, 68, 70]));
    f.files.set(`${C2A}/spectra/2a_13C.pdf`, new Uint8Array([37, 80, 68, 70]));
    const cj = `${C2A}/compound.json`;
    const comp = JSON.parse(new TextDecoder().decode(f.files.get(cj))) as Json;
    const items = ((comp.values as Json).spectra as Json[]);
    items[0].pages = { 1: { x: 0.5, y: 0.5, label_dx: 20, label_dy: -5 } };
    f.files.set(cj, new TextEncoder().encode(JSON.stringify(comp)));
    const p = await SiProject.open(f);
    const page = { src: 'data:image/png;base64,AAAA', w: 792, h: 612 };
    const { doc } = await compileSi(p, {
      contentsOf: (mol) => { const s = readScene('mol', mol); return s ? sceneToDoc(s, ACS_1996).doc.contents() : null; },
      sizeOf: () => ({ w: 108, h: 79.2 }),
      facts: async (mols) => mols.map((m) => (m ? molFacts(RDKit, m) : null)),
      pdfPages: async () => [page],
    });
    const objs = Object.values(doc.objects);
    const named = (n: string) => objs.filter((o) => 'float' in o && (o as { float?: { name?: string } }).float?.name?.startsWith(n)) as Extract<DocObject, { kind: 'textbox' }>[];
    const [pic] = objs.filter((o): o is Extract<DocObject, { kind: 'picture' }> => o.kind === 'picture' && !!o.float);
    const [box] = named('Structure box'), [id] = named('Compound ID');
    // the box centred on the spectrum, the ID 20 pt right and 5 pt up of its place under the structure
    expect(box.float.x + box.w / 2).toBeCloseTo(pic.float!.x + pic.w / 2, 1);
    expect(id.float.x - box.float.x).toBeCloseTo(20, 5);
    const [other] = named('Compound ID').slice(1);
    expect(other.float.x - named('Structure box')[1].float.x).toBeCloseTo(0, 5);
  });
});
