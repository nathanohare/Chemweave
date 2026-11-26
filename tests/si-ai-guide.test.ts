// The guide for AI assistants (docs/guide/si-import-for-ai.md): its example files are put together
// as one project, which must open, check and compile as the guide says, and it must name the
// format and the fields this program has, so the guide can't fall behind the program unnoticed.
import { beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { MemoryFolder } from '../src/si/folder';
import { JournalFolder } from '../src/si/journal';
import { unzipSync, zipSync } from 'fflate';
import { FORMAT_VERSION, SiProject, TYPE_LABELS, valuesOf } from '../src/si/project';
import { ADDUCTS, ALL_FIELDS, AMOUNT_UNITS, CUSTOM_TYPES, MASS_UNITS, NUCLEI, PLACEMENTS, SPECTRUM_TYPES, isFilled } from '../src/si/fields';
import { molFacts } from '../src/si/chem';
import { allWarnings } from '../src/si/checks';
import { computeLabels } from '../src/si/labels';
import { projectWarnings } from '../src/si/project-warnings';
import { compileSi } from '../src/si/compile-doc';
import { readScene, sceneToDoc } from '../src/io/chem-formats';
import { ACS_1996 } from '../src/style';
import { plainText } from '../src/richtext';
import { AI_GUIDE_URL, AI_NOTES_FILE, AI_NOTES_MARK, aiNotes, aiNotesAction, guideSection, guideToCopy, starterPrompt, writeAiNotes } from '../src/si/ai-guide';

const guide = readFileSync(join(__dirname, '../docs/guide/si-import-for-ai.md'), 'utf8').replace(/\r\n/g, '\n');
const examples = [...guide.matchAll(/^\*\*File:\*\* `([^`]+)`\n\n```\w+\n([\s\S]*?)^```$/gm)].map((m) => [m[1], m[2]] as const);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let RDKit: any;
beforeAll(async () => { RDKit = await createRequire(import.meta.url)('@rdkit/rdkit')(); });

async function open(): Promise<SiProject> {
  const f = new MemoryFolder('guide');
  for (const [path, text] of examples) f.files.set(path, new TextEncoder().encode(text));
  return SiProject.open(f);
}

describe('the guide for AI assistants', () => {
  it('has every example file, once', () => {
    expect(guide.match(/^\*\*File:\*\*/gm)!.length).toBe(examples.length);
    expect(new Set(examples.map(([p]) => p)).size).toBe(examples.length);
    expect(examples.length).toBeGreaterThan(15);
  });

  it('names the format and the fields this program has', () => {
    expect(guide).toContain(`\`format_version\` **${FORMAT_VERSION}**`);
    const table = guide.slice(guide.indexOf('\n### Fields'), guide.indexOf('\n## Importing each kind'));
    for (const [key, def] of ALL_FIELDS) {
      const row = table.split('\n').find((l) => l.startsWith(`| \`${key}\` |`));
      expect(row, key).toBeTruthy();
      for (const part of [...(def.parts ?? []), ...(def.itemParts ?? [])]) expect(row, `${key}.${part.key}`).toContain(`"${part.key}"`);
    }
    // each list of choices, in its own line (as whole words, so "1H" isn't found in "11H")
    const line = (start: string): string => guide.split('\n').find((l) => l.startsWith(start)) ?? '';
    const words = (l: string): string[] => l.split(/[\s,;:.|`()]+/);
    expect(words(line('| `nmr` |'))).toEqual(expect.arrayContaining([...NUCLEI]));
    expect(words(line('| `scale` |'))).toEqual(expect.arrayContaining([...AMOUNT_UNITS]));
    expect(words(line('| `yield` |'))).toEqual(expect.arrayContaining([...MASS_UNITS]));
    expect(words(line('| `files` |'))).toEqual(expect.arrayContaining(Object.keys(PLACEMENTS)));
    const types = line('- **Spectra:**');
    for (const t of SPECTRUM_TYPES) expect([' ', '`'].some((a) => [' ', '`', ',', '.'].some((b) => types.includes(a + t + b))), t).toBe(true);
    for (const a of ADDUCTS) expect(line('- Adducts:')).toContain(`\`${a}\``);
    for (const t of Object.keys(CUSTOM_TYPES)) expect(line('A custom field is')).toContain(`\`${t}\``);
    for (const t of Object.keys(TYPE_LABELS)) expect(line('`section.json` needs')).toContain(`\`${t}\``);
  });

  it('has a check script that knows every field', () => {
    const listed = (name: string): string[] => guide.split('\n').find((l) => l.startsWith(`${name} = "`))!.split('"')[1].split(' ');
    const kinds = (...k: string[]): string[] => [...ALL_FIELDS].filter(([, d]) => k.includes(d.kind)).map(([key]) => key).sort();
    expect(listed('PARTS').sort()).toEqual(kinds('parts', 'citations'));
    expect(listed('LISTS').sort()).toEqual(kinds('nmr', 'attachments', 'private'));
    for (const key of kinds('richtext', 'notes', 'structure')) expect(/^KNOWN = .*$/m.exec(guide)![0]).toContain(`"${key}"`);
  });

  // (the guide's two Python scripts: packing a project file, and checking a project)
  const scripts = [...guide.matchAll(/^```python\n([\s\S]*?)^```$/gm)].map((m) => m[1]);
  const packScript = scripts.find((s) => s.includes('zipfile.ZIP_DEFLATED'))!;
  const checkScript = scripts.find((s) => s.includes('R = os.path.abspath(sys.argv[1])'))!;
  const python = ['python3', 'python'].find((c) => spawnSync(c, ['-c', 'import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)']).status === 0);

  it('has both of its scripts', () => {
    expect(scripts.length).toBe(2);
    expect(packScript).toBeTruthy();
    expect(checkScript).toBeTruthy();
  });

  it.skipIf(!python)('has scripts that pack the example into a project file Chemweave opens, and check folders and files (needs Python)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'si-ai-guide-'));
    try {
      writeFileSync(join(dir, 'check.py'), checkScript);
      writeFileSync(join(dir, 'pack.py'), packScript);
      for (const [path, text] of examples) { mkdirSync(dirname(join(dir, 'si', path)), { recursive: true }); writeFileSync(join(dir, 'si', path), text); }
      // (what Chemweave leaves out of a project file is left out by the script too)
      writeFileSync(join(dir, 'si', '.lock'), '{}');
      mkdirSync(join(dir, 'si', 'build'));
      writeFileSync(join(dir, 'si', 'build', 'x.json'), '{}');
      writeFileSync(join(dir, 'si', 'EXAMPLE (Snapshot).docx'), 'x');
      const py = (...args: string[]): { status: number | null; out: string } => { const x = spawnSync(python!, args, { encoding: 'utf8' }); return { status: x.status, out: x.stdout + x.stderr }; };
      const file = join(dir, 'example.chemsi');
      expect(py(join(dir, 'pack.py'), join(dir, 'si'), file).status).toBe(0);
      const zip = unzipSync(readFileSync(file));
      expect(Object.keys(zip).sort()).toEqual(examples.map(([p]) => p).sort());
      expect(new TextDecoder().decode(zip['project.json'])).toBe(examples.find(([p]) => p === 'project.json')![1]);
      // (never over an existing file, nor inside the folder itself)
      expect(py(join(dir, 'pack.py'), join(dir, 'si'), file).status).not.toBe(0);
      expect(py(join(dir, 'pack.py'), join(dir, 'si'), join(dir, 'si', 'x.chemsi')).status).not.toBe(0);
      rmSync(join(dir, 'si', '.lock'));
      for (const target of [file, join(dir, 'si')]) {
        const good = py(join(dir, 'check.py'), target);
        expect(good.out).toMatch(/2 compounds, 1 general procedures, 1 references, .* 0 errors/);
      }
      expect(py(join(dir, 'check.py'), file).status).toBe(0);
      // a zip Chemweave won't open (project.json two folders down) is refused
      writeFileSync(join(dir, 'deep.chemsi'), zipSync(Object.fromEntries(Object.entries(zip).map(([k, v]) => [`a/b/${k}`, v]))));
      const deep = py(join(dir, 'check.py'), join(dir, 'deep.chemsi'));
      expect(deep.status).not.toBe(0);
      expect(deep.out).toContain('project.json must be at the top of the zip');
      writeFileSync(join(dir, 'si', 'sections/s-0a1b2c3d_optimization/content.txt'), 'See @{c-00000000}.');
      const bad = py(join(dir, 'check.py'), join(dir, 'si'));
      expect(bad.out).toContain("mention of c-00000000, which isn't there");
      expect(bad.status).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('has examples that open with only the warning it names', async () => {
    const p = await open();
    expect(p.warnings).toEqual([]);
    expect(p.newerFormat).toBe(false);
    const ids = p.idReport();
    expect(p.compounds.map((c) => ids.ids.get(c.id))).toEqual(['2a', '2b']);
    const labels = await computeLabels(p);
    expect(await projectWarnings(p, labels)).toEqual([]);
    const found: string[] = [];
    for (const c of p.compounds) {
      const facts = molFacts(RDKit, await p.readStructure(c));
      expect(facts?.info, c.id).toBeTruthy();
      found.push(...allWarnings(p, c, ids, facts, null, labels).map((w) => `${ids.ids.get(c.id)} ${w.key}`));
    }
    expect(found).toEqual(['2b heteroatom:19F']);
    const a = p.compounds[0];
    for (const e of a.data.fields as { key: string }[]) {
      const def = ALL_FIELDS.get(e.key)!;
      if (def.kind === 'notes') continue;
      expect(isFilled(def, e.key === 'structure' ? p.hasStructure(a) : valuesOf(a)[e.key], p.compoundText(a, e.key)), e.key).toBe(true);
    }
  });

  it('has examples that compile as it describes', async () => {
    const p = await open();
    const { doc, notes } = await compileSi(p, {
      contentsOf: (mol) => { const s = readScene('mol', mol); return s ? sceneToDoc(s, ACS_1996).doc.contents() : null; },
      sizeOf: () => null,
      facts: async (mols) => mols.map((m) => (m ? molFacts(RDKit, m) : null)),
    });
    expect(notes).toEqual([]);
    const text = plainText(doc.runs);
    expect(text).toContain('Prepared according to General Procedure A from aniline (93 mg, 1.00 mmol). The product was washed with cold water.');
    expect(text).toContain('The acylation that gives 2a was optimized (Table S1) in the apparatus of Figure S1.');
    expect(text).toContain('[CONFLICT: yield 57% (draft table) vs 68% (notebook)]');
    expect(text).not.toContain('??');
    expect(text).not.toContain('Made-up example data.');
  });
});

describe('what is made from the guide for AI assistants (si/ai-guide.ts)', () => {
  it('starts the copy with the starting message, told to read the guide after it', () => {
    const prompt = starterPrompt(guide);
    expect(prompt).toMatch(/^Help me import my Supporting Information/);
    expect(prompt).toContain(AI_GUIDE_URL);
    const copy = guideToCopy(guide);
    expect(copy.startsWith(prompt.replace(/First read \S+ in full and follow it\./, 'First read the guide below in full and follow it.'))).toBe(true);
    expect(copy).not.toContain(`First read ${AI_GUIDE_URL}`);
    expect(copy).not.toContain('## Start your assistant');
    expect(copy).toContain('## Critical rules');
    expect(copy.endsWith(guide.slice(guide.indexOf('## Critical rules')).trim() + '\n')).toBe(true);
  });

  it('makes the note for AI assistants from the guide\'s Critical rules', () => {
    const notes = aiNotes(guide);
    expect(notes.split('\n', 1)[0]).toMatch(/ \([0-9a-f]{8}\)\. -->$/);
    expect(notes.startsWith(AI_NOTES_MARK)).toBe(true);
    expect(notes).toContain(AI_GUIDE_URL);
    const rules = guideSection(guide, 'Critical rules').split('\n').filter((l) => /^\d+\. /.test(l));
    expect(rules.length).toBeGreaterThan(5);
    for (const r of rules) expect(notes).toContain(r.replace(/\[([^\]]+)\]\(#[^)]*\)/g, '$1'));
    expect(notes).not.toMatch(/\]\(#/);
    expect(notes).not.toContain('Agent: everything from here on');
    expect(guideSection(guide, 'No such heading')).toBe('');
  });

  it('writes the note, updates its own, and never replaces one someone wrote', async () => {
    const p = await open();
    expect(await writeAiNotes(p, guide)).toBe('written');
    expect(await p.folder.readText(AI_NOTES_FILE)).toBe(aiNotes(guide));
    expect(await writeAiNotes(p, guide)).toBe('same');
    // (an older Chemweave's note, unchanged since, is brought up to date, with Windows line ends or a BOM too)
    const older = aiNotes(guide.replace('1. **Never invent data.**', '1. **Never make up data.**'));
    expect(older).not.toBe(aiNotes(guide));
    for (const old of [older, older.replace(/\n/g, '\r\n'), '﻿' + older]) {
      await p.folder.writeText(AI_NOTES_FILE, old);
      expect(await writeAiNotes(p, guide)).toBe('updated');
      expect(await p.folder.readText(AI_NOTES_FILE)).toBe(aiNotes(guide));
    }
    expect(aiNotesAction(aiNotes(guide).replace(/\n/g, '\r\n'), aiNotes(guide))).toBe('same');
    // (one changed by hand, even with its first line kept, is left alone, and so is a project's own)
    for (const own of ['# Notes for AI assistants\nOur own rules.\n', 'Edited.\n' + older, older + '\n## Our lab rules\nAsk Sam first.\n', older.replace('Never make up data', 'Never make up any data'), `${AI_NOTES_MARK} (00000000). -->\n# Ours\n`]) {
      await p.folder.writeText(AI_NOTES_FILE, own);
      expect(await writeAiNotes(p, guide)).toBe('kept');
      expect(await p.folder.readText(AI_NOTES_FILE)).toBe(own);
    }
  });

  it('gives a new project the note without an Undo step that takes it away', async () => {
    // (as main.ts's openSiWorking makes a project: the note written before the Undo history starts)
    const main = readFileSync(join(__dirname, '../src/main.ts'), 'utf8');
    const write = main.indexOf("if (opts.create !== undefined) await import('./si/ai-guide')");
    expect(write).toBeGreaterThan(0);
    expect(main.indexOf('await journalOf(project.folder)?.clear()', write)).toBeGreaterThan(write);
    expect(main.indexOf('await journalOf(project.folder)?.clear()', write) - write).toBeLessThan(300);
    const j = new JournalFolder(new MemoryFolder('new'));
    const p = await SiProject.create(j, 'New SI');
    expect(await writeAiNotes(p, guide)).toBe('written');
    j.clear();
    await new Promise((r) => setTimeout(r, 900));
    expect(j.history(false)).toBeNull();
    expect(await p.folder.readText(AI_NOTES_FILE)).toBe(aiNotes(guide));
  });

  it('adds nothing to the SI or its warnings with the note in the project', async () => {
    const p = await open();
    await writeAiNotes(p, guide);
    await p.reload();
    expect(p.warnings).toEqual([]);
    expect(await projectWarnings(p, await computeLabels(p))).toEqual([]);
    const { doc, notes } = await compileSi(p, {
      contentsOf: (mol) => { const s = readScene('mol', mol); return s ? sceneToDoc(s, ACS_1996).doc.contents() : null; },
      sizeOf: () => null,
      facts: async (mols) => mols.map((m) => (m ? molFacts(RDKit, m) : null)),
    });
    expect(notes).toEqual([]);
    expect(plainText(doc.runs)).not.toContain('Notes for AI assistants');
  });

  it('is reachable from the app: Help, the SI tab and a new project', () => {
    const html = readFileSync(join(__dirname, '../index.html'), 'utf8');
    for (const cmd of ['copy-ai-guide', 'save-ai-guide']) expect(html).toContain(`data-cmd="${cmd}"`);
    const main = readFileSync(join(__dirname, '../src/main.ts'), 'utf8');
    expect(main).toMatch(/'copy-ai-guide': \(\) =>/);
    expect(main).toMatch(/'save-ai-guide': \(\) =>/);
    expect(main).toMatch(/opts\.create !== undefined\) await import\('\.\/si\/ai-guide'\)/);
    const si = readFileSync(join(__dirname, '../src/ui/si-mode.ts'), 'utf8');
    expect(si).toContain('data-si="ai-import"');
    expect(si).toContain("case 'ai-import':");
    // (the page's own instructions name these commands)
    for (const c of ['Help ▸ Copy Guide for AI Assistants', 'Help ▸ Save Guide for AI Assistants…', 'Insert ▸ Import with AI']) expect(guide).toContain(c);
  });
});
