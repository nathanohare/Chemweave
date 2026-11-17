// General procedures edited in an SI project, and figures, tables and procedures sent to the
// Trash as SI Assistant's Trash shows and restores them (SPEC §13j.3, §13k.5).
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { MemoryFolder } from '../src/si/folder';
import { SiProject, type Json } from '../src/si/project';

const ROOT = join(__dirname, 'fixtures', 'si-example');
function folder(): MemoryFolder {
  const f = new MemoryFolder('si-example');
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name !== 'README.md') f.files.set(relative(ROOT, p).split('\\').join('/'), new Uint8Array(readFileSync(p)));
    }
  };
  walk(ROOT);
  return f;
}
const trashEntries = (f: MemoryFolder): Json[] =>
  [...f.files.keys()].filter((k) => /^trash\/[^/]+\/entry\.json$/.test(k)).map((k) => JSON.parse(new TextDecoder().decode(f.files.get(k))) as Json);

describe('general procedures', () => {
  it('adds one named after the next free letter, edits, moves and deletes it to the Trash', async () => {
    const f = folder();
    const p = await SiProject.open(f);
    const s = p.dataSections.find((x) => p.generalProcedures(x).length)!;
    const gp = await p.addGeneralProcedure(s.id);
    expect(gp.name).toBe('General Procedure B');
    expect(gp.sentence).toBe('Prepared according to {GP} from {starting material} ({scale}).');
    await p.updateGeneralProcedure(String(gp.id), { title: 'Acetylation', sentence: 'Made by {GP} from {alcohol}.' });
    await p.writeGpText(String(gp.id), 'To a solution of the alcohol in CH_{2}Cl_{2} was added Ac_{2}O.');
    await p.moveGeneralProcedure(String(gp.id), -1);
    const again = await SiProject.open(f);
    const s2 = again.section(s.id);
    expect(again.generalProcedures(s2).map((g) => g.name)).toEqual(['General Procedure B', 'General Procedure A']);
    expect(await again.readGpText(s2, String(gp.id))).toContain('Ac_{2}O');
    const a = again.generalProcedures(s2)[1];
    expect(again.gpUsers(String(a.id)).length).toBeGreaterThan(0);
    await again.deleteGeneralProcedure(String(a.id));
    expect(again.generalProcedures(s2).map((g) => g.name)).toEqual(['General Procedure B']);
    const [entry] = trashEntries(f);
    expect(entry).toMatchObject({ kind: 'gp', name: 'General Procedure A', section_id: s.id, index: 1 });
    expect((entry.gp as Json).id).toBe(a.id);
    expect([...f.files.keys()].some((k) => k.startsWith('trash/') && k.endsWith(`${String(a.id)}.txt`))).toBe(true);
  });
});

describe('deleting a figure or table', () => {
  it('takes its paragraph out and sends its picture (with its drawing) or table file to the Trash', async () => {
    const f = folder();
    const p = await SiProject.open(f);
    const s = p.sections.find((x) => x.type === 'text' && x.folder.includes('reaction-optimizatio'))!;
    const rel = await p.addSectionPicture(s, 'ligand.svg', new Uint8Array([1]), { cdxml: new Uint8Array([2]) });
    s.data.figures = { ...((s.data.figures as Json) ?? {}), 'f-00000001': { file: rel, width: 4 } };
    await p.saveSection(s);
    await p.writeSectionText(s, `${(await p.readSectionText(s)).trimEnd()}\n!align{left} !figure{f-00000001} The **ligand**`);
    await p.deleteTextObject(s, 'figure', 'f-00000001');
    expect(await p.readSectionText(s)).not.toContain('f-00000001');
    expect((s.data.figures as Json)['f-00000001']).toBeUndefined();
    expect(f.files.has(`${s.folder}/images/ligand.svg`)).toBe(false);
    const fig = trashEntries(f).find((e) => e.kind === 'figure')!;
    expect(fig).toMatchObject({ owner: s.id, object_id: 'f-00000001', caption: 'The **ligand**', align: 'left', width: 4, item: 'ligand.svg', companions: ['ligand.cdxml'] });
    expect(fig.name).toBe(`Figure: The ligand (${s.name})`);
    await p.deleteTextObject(s, 'table', 't-1ece4eb2');
    // (a mention of it in the text stays, shown as ?? with a warning, as SI Assistant does)
    expect(await p.readSectionText(s)).not.toContain('!table{t-1ece4eb2}');
    expect(trashEntries(f).find((e) => e.kind === 'table')).toMatchObject({ object_id: 't-1ece4eb2', item: 't-1ece4eb2.json' });
  });
});

describe('the project’s references', () => {
  it('edits and deletes a reference, and lists where each is cited', async () => {
    const f = folder();
    const p = await SiProject.open(f);
    const uses = await p.referenceUses();
    const fulmer = p.references.find((r) => String(r.title).startsWith('NMR Chemical Shifts'))!;
    expect(uses.get(String(fulmer.id))?.texts).toEqual(['General Information']);
    const cited = p.references[0];
    expect(uses.get(String(cited.id))?.compounds.length).toBeGreaterThan(0);
    await p.updateReference({ ...cited, title: 'A new title', typed: 'My own text.' });
    await p.deleteReference(String(fulmer.id));
    const again = await SiProject.open(f);
    expect(again.references.length).toBe(6);
    expect(again.reference(String(cited.id))).toMatchObject({ title: 'A new title', typed: 'My own text.' });
    expect(again.reference(String(fulmer.id))).toBeUndefined();
  });
});
