// The SI project's storage: what must hold so a project is never lost or corrupted (found in
// review): nothing is deleted outright or reached outside the project folder, a project taken
// over or moved is not written to, structural changes don't interleave, and JSON and text
// come out as Chem SI Assistant writes and reads them.
import { describe, expect, it } from 'vitest';
import { MemoryFolder, decodeText, isTrashPath } from '../src/si/folder';
import { SiProject, compoundsOf, compoundName, valuesOf } from '../src/si/project';
import { cloneJson, dumpPyJson, parsePyJson } from '../src/si/pyjson';
import { allBoxes, markAsCompound, setBoxStructure, unlinkBox } from '../src/si/scheme-edit';
import { duplicateCompound } from '../src/si/duplicate';
import { JournalFolder } from '../src/si/journal';

const MOL = '\n  test\n\n  1  0  0  0  0  0  0  0  0  0999 V2000\n    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0\nM  END';

async function project(folder: MemoryFolder | JournalFolder = new MemoryFolder('P')) {
  const p = await SiProject.create(folder, 'P');
  const s = await p.addSection('data', 'Products');
  return [p, s] as const;
}
const files = (p: SiProject): string[] => { let f = p.folder as unknown as { inner?: unknown; files?: Map<string, Uint8Array> }; while (f.inner) f = f.inner as typeof f; return [...f.files!.keys()]; };
const text = (p: SiProject, rel: string): string => { let f = p.folder as unknown as { inner?: unknown; text?: (r: string) => string | undefined }; while (f.inner) f = f.inner as typeof f; return f.text!(rel) ?? ''; };

describe('project files are never deleted outright', () => {
  it('only the lock can be removed from a folder, in memory as on disk', async () => {
    const f = new MemoryFolder('P');
    await f.writeText('a.txt', 'x');
    await f.writeText('.lock', '{}');
    await expect(f.remove('a.txt')).rejects.toThrow(/lock/);
    await f.remove('.lock');
    expect([...f.files.keys()]).toEqual(['a.txt']);
  });

  it('a scheme compound made from a drawn box can be unlinked, moved out and deleted', async () => {
    const [p, s] = await project();
    const k = await p.addScheme(s.id);
    const [first] = allBoxes(k)[0];
    await setBoxStructure(p, k, String(first.id), MOL);
    const a = (await markAsCompound(p, k, String(first.id), 'A'))!;
    await unlinkBox(p, k, String(first.id));
    const b = (await markAsCompound(p, k, String(first.id), 'B'))!;
    await p.moveCompound(b.id, s.id, 0);
    expect(b.schemeId).toBeNull();
    const c = (await markAsCompound(p, k, String(first.id), 'C'))!;
    await p.deleteCompound(c.id);
    expect(compoundsOf(s).map(compoundName)).toEqual(['B', 'A']);
    // the box's earlier files went to the Trash (restorable), not deleted
    expect(files(p).some((f) => f.startsWith('trash/') && f.endsWith('.mol'))).toBe(true);
  });
});

describe('paths that would leave the project folder', () => {
  it('are refused for changes and read as "not there"', async () => {
    const f = new MemoryFolder('P');
    await expect(f.writeText('sections/../../x.txt', 'x')).rejects.toThrow(/outside the project folder/);
    await expect(f.move('a', '../b')).rejects.toThrow(/outside the project folder/);
    expect(await f.readText('../x.txt')).toBeNull();
    expect(await f.exists('sections/../../x')).toBe(false);
    expect(isTrashPath('trash/../sections')).toBe(false);
  });

  it('a section file named with ".." is never moved to the Trash', async () => {
    const f = new MemoryFolder('P');
    const moves: string[] = [];
    const move = f.move.bind(f);
    f.move = async (from: string, to: string) => { moves.push(from); await move(from, to); };
    const p = await SiProject.create(f, 'P');
    const s = await p.addSection('file', 'Attachment');
    s.data.file = '../../../Documents/thesis.docx';
    f.files.set(`${s.folder}/../../../Documents/thesis.docx`, new Uint8Array([1]));
    const pick = await p.attachSectionFile(s, 'new.pdf', new Uint8Array([2]));
    expect(pick).toBe('new.pdf');
    expect(moves.some((m) => m.includes('..'))).toBe(false);
    expect(f.files.has(`${s.folder}/../../../Documents/thesis.docx`)).toBe(true);
  });
});

describe('a project that is no longer this program’s to change', () => {
  it('stops saving when someone takes the lock over, and says who', async () => {
    const [p, s] = await project();
    const a = await p.addCompound(s.id, undefined, 'A');
    await p.acquireLock('nate', 'laptop');
    await p.setPart(a, 'yield', 'percent', '50');           // ours: saved
    const saved = text(p, `${a.folder}/compound.json`);
    await p.folder.writeText('.lock', dumpPyJson({ user: 'Sam', computer: 'lab-pc', opened_at: '2026-11-19T10:00:00', session: 'ffffffffffffffff' }));
    let told = '';
    p.onReadOnly = (m) => { told = m; };
    expect(await p.checkLock()).toBe(false);
    expect(p.readOnly).toBe(true);
    expect(told).toMatch(/Sam has taken this project over for editing on lab-pc/);
    await expect(p.setPart(a, 'yield', 'percent', '60')).rejects.toThrow(/taken this project over/);
    expect(text(p, `${a.folder}/compound.json`)).toBe(saved);
    // closing does not take the other person's lock away
    await p.release();
    expect(text(p, '.lock')).toContain('Sam');
  });

  it('notices on the next save, without being asked', async () => {
    const [p, s] = await project();
    const a = await p.addCompound(s.id, undefined, 'A');
    await p.acquireLock('nate', 'laptop');
    await p.folder.writeText('.lock', dumpPyJson({ user: 'Sam', computer: 'lab-pc', opened_at: '', session: 'ffffffffffffffff' }));
    const before = text(p, `${a.folder}/compound.json`);
    await expect(p.setIdOverride(a, '9')).rejects.toThrow(/taken this project over.*The last change was not saved/);
    expect(text(p, `${a.folder}/compound.json`)).toBe(before);
    expect(p.readOnly).toBe(true);
  });

  it('a lock that can’t be read just now is "don’t know": the project stays open for editing', async () => {
    const [p, s] = await project();
    await p.acquireLock('nate', 'laptop');
    const lock = text(p, '.lock');
    (p.folder as MemoryFolder).files.set('.lock', new TextEncoder().encode('{"user": "na'));   // half-synced
    expect(await p.checkLock()).toBe(true);
    expect(p.readOnly).toBe(false);
    await p.addCompound(s.id, undefined, 'A');
    (p.folder as MemoryFolder).files.set('.lock', new TextEncoder().encode(lock));
    expect(await p.lockStillOurs()).toBe(true);
  });

  it('a project folder that was renamed or moved is not made again by a save', async () => {
    const [p, s] = await project();
    const a = await p.addCompound(s.id, undefined, 'A');
    await p.acquireLock('nate', 'laptop');
    const f = p.folder as MemoryFolder;
    f.files.clear();                                           // the folder went elsewhere
    await expect(p.setIdOverride(a, '9')).rejects.toThrow(/no longer at P.*renamed or moved/);
    expect([...f.files.keys()]).toEqual([]);
    expect(p.readOnly).toBe(true);
  });

  it('works under the Undo history’s folder too', async () => {
    const j = new JournalFolder(new MemoryFolder('P'));
    const [p, s] = await project(j);
    const a = await p.addCompound(s.id, undefined, 'A');
    await p.acquireLock('nate', 'laptop');
    await j.inner.writeText('.lock', dumpPyJson({ user: 'Sam', computer: 'lab-pc', opened_at: '', session: 'ffffffffffffffff' }));
    await expect(p.deleteCompound(a.id)).rejects.toThrow(/taken this project over/);
    expect(files(p).some((x) => x.startsWith('trash/'))).toBe(false);
  });

  it('read-only: nothing changes in memory when a change is refused', async () => {
    const [p, s] = await project();
    const a = await p.addCompound(s.id, undefined, 'A');
    p.readOnly = true;
    await expect(p.setIdTable(s.id, ['1', '2'])).rejects.toThrow(/read-only/);
    expect(s.data.id_table).toEqual([]);
    await expect(p.addReference({ title: 'T' })).rejects.toThrow(/read-only/);
    expect(p.references).toEqual([]);
    await expect(p.renameSection(s.id, 'Other')).rejects.toThrow(/read-only/);
    expect(s.name).toBe('Products');
    await expect(p.setPart(a, 'yield', 'percent', '50')).rejects.toThrow(/read-only/);
    expect((valuesOf(a).yield as Record<string, unknown> | undefined)?.percent ?? '').toBe('');
  });
});

describe('pages in the Trash', () => {
  it('a late save of a deleted compound does not make its folder again', async () => {
    const [p, s] = await project();
    const a = await p.addCompound(s.id, undefined, 'A');
    await p.deleteCompound(a.id);
    await expect(p.setValue(a, 'yield', { percent: '50' })).rejects.toThrow(/in the project’s Trash/);
    await expect(p.writeCompoundText(a, 'procedure', 'text')).rejects.toThrow(/Trash/);
    await expect(p.setStructure(a, MOL)).rejects.toThrow(/Trash/);
    expect(files(p).some((f) => f.startsWith(a.folder + '/'))).toBe(false);
    const re = await SiProject.open(p.folder);
    expect(compoundsOf(re.section(s.id))).toEqual([]);
  });

  it('a deleted compound’s (or scheme page’s) X-ray structures go into the tree, after its section', async () => {
    const [p, s] = await project();
    await p.addSection('text', 'Later');
    const a = await p.addCompound(s.id, undefined, 'A');
    const k = await p.addScheme(s.id);
    const b = await p.addSchemeCompound(k, 0, 'B');
    const f = p.folder as MemoryFolder;
    await f.writeText('sections/s-11111111_xray/section.json', dumpPyJson({ id: 's-11111111', type: 'xray', name: 'X-ray of A', anchored: true, compound: a.id }));
    await f.writeText('sections/s-22222222_xray/section.json', dumpPyJson({ id: 's-22222222', type: 'xray', name: 'X-ray of B', anchored: true, compound: b.id }));
    await p.reload();
    expect(p.top.map((x) => x.name)).toEqual(['Products', 'Later']);
    await p.deleteCompound(a.id);
    expect(p.top.map((x) => x.name)).toEqual(['Products', 'X-ray of A', 'Later']);
    expect(p.anchored.size).toBe(1);
    await p.deleteScheme(k.id);
    expect(p.top.map((x) => x.name)).toEqual(['Products', 'X-ray of B', 'X-ray of A', 'Later']);
    expect((parsePyJson(text(p, 'sections/s-11111111_xray/section.json')) as { anchored: boolean }).anchored).toBe(false);
    const re = await SiProject.open(p.folder);
    expect(re.top.map((x) => x.name)).toEqual(['Products', 'X-ray of B', 'X-ray of A', 'Later']);
  });
});

describe('changes to the project’s structure run one at a time', () => {
  it('two moves of one compound at once leave every compound where it belongs', async () => {
    const [p, s] = await project();
    const other = await p.addSection('data', 'Other');
    const a = await p.addCompound(s.id, undefined, 'A');
    await p.addCompound(s.id, undefined, 'B');
    await p.addCompound(s.id, undefined, 'X');
    await Promise.allSettled([p.moveCompound(a.id, other.id, 0), p.moveCompound(a.id, other.id, 0)]);
    expect(compoundsOf(s).map(compoundName)).toEqual(['B', 'X']);
    expect(compoundsOf(other).map(compoundName)).toEqual(['A']);
    const re = await SiProject.open(p.folder);
    expect(compoundsOf(re.section(s.id)).map(compoundName)).toEqual(['B', 'X']);
    expect(compoundsOf(re.section(other.id)).map(compoundName)).toEqual(['A']);
    expect((parsePyJson(text(p, `${other.folder}/section.json`)) as { compound_order: string[] }).compound_order).toEqual([a.id]);
  });

  it('adding, deleting and reading again at once do not interleave', async () => {
    const [p, s] = await project();
    const a = await p.addCompound(s.id, undefined, 'A');
    const got = await Promise.allSettled([p.addCompound(s.id, undefined, 'B'), p.deleteCompound(a.id), p.reload(), p.addCompound(s.id, undefined, 'C')]);
    expect(got.map((g) => g.status)).toEqual(['fulfilled', 'fulfilled', 'fulfilled', 'fulfilled']);
    expect(compoundsOf(p.section(s.id)).map(compoundName)).toEqual(['B', 'C']);
  });

  it('a project that can’t be read again stays as it was in memory', async () => {
    const [p, s] = await project();
    const a = await p.addCompound(s.id, undefined, 'A');
    await p.writeCompoundText(a, 'procedure', 'Stirred for 1 h.');
    const f = p.folder as MemoryFolder;
    const list = f.list.bind(f);
    f.list = async () => { throw new Error('the drive went away'); };
    await expect(p.reload()).rejects.toThrow(/drive went away/);
    f.list = list;
    expect(compoundsOf(p.section(s.id)).map(compoundName)).toEqual(['A']);
    expect(p.compoundText(a, 'procedure')).toBe('Stirred for 1 h.');
  });
});

describe('JSON as SI Assistant writes it, after changes', () => {
  it('decimals stay decimals in a copy, in a rebuilt settings object, and in a list that changes', () => {
    const src = '{\n  "defaults": {\n    "id_size": 0.0,\n    "struct_scale": 1.0,\n    "caption_size": 9.0,\n    "per_page": 2\n  },\n  "xs": [\n    1.0,\n    2.0,\n    3.5\n  ],\n  "mixed": [\n    1.0,\n    2\n  ],\n  "mz": 153.0\n}\n';
    const o = parsePyJson(src) as { defaults: Record<string, number>; xs: number[]; mixed: number[]; mz: number };
    expect(dumpPyJson(cloneJson(o))).toBe(src);
    expect(dumpPyJson(structuredClone(o))).not.toBe(src);     // (why cloneJson is used)
    o.defaults = { ...o.defaults, caption_size: 10 };         // made anew, as the Spectra section's page saves its settings
    o.xs.shift();
    o.xs.push(4);
    expect(dumpPyJson(o)).toBe('{\n  "defaults": {\n    "id_size": 0.0,\n    "struct_scale": 1.0,\n    "caption_size": 10.0,\n    "per_page": 2\n  },\n  "xs": [\n    2.0,\n    3.5,\n    4.0\n  ],\n  "mixed": [\n    1.0,\n    2\n  ],\n  "mz": 153.0\n}\n');
  });

  it('a whole number typed by hand under a decimal’s key stays whole until it changes', () => {
    const o = parsePyJson('{"hrms_tolerance_ppm": 5}') as Record<string, number>;
    expect(dumpPyJson(o)).toBe('{\n  "hrms_tolerance_ppm": 5\n}\n');
    expect(dumpPyJson({ ...o })).toBe('{\n  "hrms_tolerance_ppm": 5.0\n}\n');
    o.hrms_tolerance_ppm = 3;
    expect(dumpPyJson(o)).toBe('{\n  "hrms_tolerance_ppm": 3.0\n}\n');
  });

  it('whole numbers keep every digit, however large', () => {
    const src = '[\n  9007199254740993,\n  1000000000000000000000,\n  -123456789012345678901234567890,\n  7\n]\n';
    expect(dumpPyJson(parsePyJson(src))).toBe(src);
    expect(dumpPyJson(cloneJson(parsePyJson(src)))).toBe(src);
    expect(dumpPyJson([1e21, 2 ** 80])).toBe('[\n  1000000000000000000000,\n  1208925819614629174706176\n]\n');
  });

  it('a duplicated compound’s values are written as the original’s', async () => {
    const [p, s] = await project();
    const a = await p.addCompound(s.id, undefined, 'A');
    const v = parsePyJson('{"found": "153.0910", "mz": 153.0, "n": 2}') as Record<string, unknown>;
    await p.setValue(a, 'hrms', v);
    const [copy] = await duplicateCompound(p, a, ['hrms']);
    expect(text(p, `${copy.folder}/compound.json`)).toContain('"mz": 153.0,');
    expect(text(p, `${copy.folder}/compound.json`)).toContain('"n": 2');
  });

  it('a structure’s stored values keep their decimals when the structure is drawn again', async () => {
    const [p, s] = await project();
    const a = await p.addCompound(s.id, undefined, 'A');
    valuesOf(a).structure = parsePyJson('{"scale": 1.0, "from_scheme": true}');
    await p.setStructure(a, MOL);
    expect(text(p, `${a.folder}/compound.json`)).toMatch(/"scale": 1\.0,\n\s+"from_scheme": false/);
  });
});

describe('text files as SI Assistant reads them', () => {
  it('only the bytes that are not UTF-8 are read as Windows-1252', () => {
    const enc = new TextEncoder();
    const bytes = new Uint8Array([...enc.encode('δ 7.26, CDCl₃, 20 '), 0xb0, ...enc.encode('C – 5 '), 0xb5, ...enc.encode('L 😀'), 0xe2, 0x82]);
    expect(decodeText(bytes)).toBe('δ 7.26, CDCl₃, 20 °C – 5 µL 😀â‚');
    expect(decodeText(new Uint8Array([0x32, 0x30, 0xb0, 0x43]))).toBe('20°C');
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x41, 0x81]))).toBe('A\u0081');      // (a byte Windows-1252 has no character for is kept)
    expect(decodeText(enc.encode('plain δ'))).toBe('plain δ');
  });

  it('line ends are "\\n" whatever editor saved the file', async () => {
    const f = new MemoryFolder('P');
    f.files.set('a.txt', new TextEncoder().encode('one\r\ntwo\r\n'));
    expect(await f.readText('a.txt')).toBe('one\ntwo\n');
    expect(f.text('a.txt')).toBe('one\ntwo\n');
    expect(new TextDecoder().decode((await f.readBytes('a.txt'))!)).toBe('one\r\ntwo\r\n');   // (the bytes themselves are untouched)
  });
});
