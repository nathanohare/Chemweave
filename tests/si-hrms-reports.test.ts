// HRMS report files in an SI project (SI Assistant SPEC §13n.3): stored in the compound's hrms/
// folder and listed in hrms.reports, Found filled from them (hrms.found_from), the warning when a
// typed value differs, the Trash, and the printed table of a data file's peaks.
import { beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { MemoryFolder } from '../src/si/folder';
import { SiProject, valuesOf, type Json, type SiCompound } from '../src/si/project';
import { molFacts } from '../src/si/chem';
import { allWarnings, hrmsCalc, hrmsSpecies } from '../src/si/checks';
import { chooseMatch, readReport, updateFound } from '../src/si/ms-reports';
import { listTrash, restoreFromTrash } from '../src/si/trash';
import { compileSi } from '../src/si/compile-doc';
import { plainText } from '../src/richtext';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let RDKit: any;
beforeAll(async () => { RDKit = await createRequire(import.meta.url)('@rdkit/rdkit')(); });

const FIXTURE = join(__dirname, 'fixtures', 'si-example');
const REPORTS = join(__dirname, 'fixtures', 'ms-reports');
const C2D = 'sections/s-972b3c47_synthesis-and-charac/compounds/c-1eebe878_1-4-chlorophen';

/** SI Assistant's example project, with the HRMS report of 2d that SI Assistant ships with it. */
function exampleFolder(): MemoryFolder {
  const f = new MemoryFolder('Example project');
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name !== 'README.md') f.files.set(relative(FIXTURE, p).split('\\').join('/'), new Uint8Array(readFileSync(p)));
    }
  };
  walk(FIXTURE);
  f.files.set(`${C2D}/hrms/2d_HRMS_ESI.csv`, new Uint8Array(readFileSync(join(REPORTS, 'example', '2d_HRMS_ESI.csv'))));
  return f;
}

async function setup(): Promise<{ p: SiProject; c: SiCompound; f: MemoryFolder }> {
  const f = exampleFolder();
  const p = await SiProject.open(f);
  const c = p.compounds.find((x) => x.folder === C2D)!;
  return { p, c, f };
}

/** The reports' value for Found, as the SI page works it out. */
async function matchOf(p: SiProject, c: SiCompound) {
  const facts = molFacts(RDKit, await p.readStructure(c));
  const v = valuesOf(c).hrms as Json;
  const sp = hrmsSpecies(facts, v)!;
  const peaks = hrmsCalc(sp.info, String(v.adduct ?? ''), '', 5).peaks;
  const items = (v.reports as Json[] | undefined) ?? [];
  const reports = await Promise.all(items.map(async (i) => readReport(await p.folder.readBytes(`${c.folder}/hrms/${String(i.file)}`), String(i.file))));
  return { facts, match: chooseMatch(reports, peaks, 5) };
}

describe('HRMS report files in a project', () => {
  it('gives the found m/z SI Assistant filled in for the example project', async () => {
    const { p, c } = await setup();
    const { match } = await matchOf(p, c);
    expect(match!.mz).toBe(179.02329);
    expect(match!.file).toBe('2d_HRMS_ESI.csv');
    const v = valuesOf(c).hrms as Json;
    expect(updateFound(v, match)).toBe(''); // (already filled from it)
  });

  it('stores a report in hrms/, lists it, fills Found, and takes it to the Trash and back', async () => {
    const { p, c, f } = await setup();
    const v = valuesOf(c).hrms as Json;
    v.found = ''; delete v.found_from; delete v.reports;
    const csv = readFileSync(join(REPORTS, 'example', '2d_HRMS_ESI.csv'));
    const name = await p.addHrmsReport(c, 'peaks 2d.csv', new Uint8Array(csv), async () => { updateFound(v, (await matchOf(p, c)).match); });
    expect(name).toBe('peaks 2d.csv');
    expect(f.files.has(`${C2D}/hrms/peaks 2d.csv`)).toBe(true);
    const saved = JSON.parse(new TextDecoder().decode(f.files.get(`${C2D}/compound.json`)!)) as { values: { hrms: Json } };
    expect(saved.values.hrms.reports).toEqual([{ file: 'peaks 2d.csv', kind: 'file' }]);
    expect(saved.values.hrms.found).toBe('179.0233');
    expect(saved.values.hrms.found_from).toEqual({ file: 'peaks 2d.csv', mz: 179.02329 });
    // a second copy of the same name is kept beside it
    expect(await p.addHrmsReport(c, 'peaks 2d.csv', new Uint8Array(csv))).toBe('peaks 2d (2).csv');
    await p.removeHrmsReport(c, 'peaks 2d (2).csv');
    await p.removeHrmsReport(c, 'peaks 2d.csv', async () => { updateFound(v, (await matchOf(p, c)).match); });
    expect(v.found).toBe('');
    expect('reports' in v).toBe(false);
    expect(f.files.has(`${C2D}/hrms/peaks 2d.csv`)).toBe(false);
    const trash = await listTrash(p);
    const entry = trash.find((e) => e.name === 'peaks 2d.csv')!;
    expect(entry.info.field_key).toBe('hrms_reports');
    expect(entry.info.item_values).toEqual({ file: 'peaks 2d.csv', kind: 'file' });
    await restoreFromTrash(p, entry.id);
    expect(v.reports).toEqual([{ file: 'peaks 2d.csv', kind: 'file' }]);
    expect(f.files.has(`${C2D}/hrms/peaks 2d.csv`)).toBe(true);
  });

  it('keeps the print choice per compound', async () => {
    const { p, c } = await setup();
    await p.setHrmsPrint(c, true);
    expect((valuesOf(c).hrms as Json).print_reports).toBe(true);
    await p.setHrmsPrint(c, null);
    expect('print_reports' in (valuesOf(c).hrms as Json)).toBe(false);
  });

  it('warns when a typed found m/z differs from the reports', async () => {
    const { p, c } = await setup();
    const v = valuesOf(c).hrms as Json;
    v.found = '179.0290'; delete v.found_from;
    const { facts, match } = await matchOf(p, c);
    const w = allWarnings(p, c, p.idReport(), facts, match).find((x) => x.key === 'hrms:report-differs');
    expect(w?.message).toBe("The found m/z you typed (179.0290) is +31.9 ppm from the report's value (179.0233 in 2d_HRMS_ESI.csv). Check which is right.");
    v.found = '179.0234';
    expect(allWarnings(p, c, p.idReport(), facts, match).some((x) => x.key === 'hrms:report-differs')).toBe(false);
  });

  it('prints a data file as a table of the peaks near the ion, the found one marked', async () => {
    const { p, c, f } = await setup();
    const v = valuesOf(c).hrms as Json;
    // a made-up mzML of the ion's peaks (for 2d's [M+Na]+, its peaks moved onto 179.0233)
    const { facts } = await matchOf(p, c);
    const sp = hrmsSpecies(facts, v)!;
    const peaks = hrmsCalc(sp.info, String(v.adduct), '', 5).peaks.slice(0, 4);
    const mz = peaks.map((x) => x.mz), inten = peaks.map((x) => x.abundance * 1000);
    const b64 = (a: number[]): string => Buffer.from(new Float64Array(a).buffer).toString('base64');
    const arr = (a: number[], acc: string): string => `<binaryDataArray><cvParam accession="MS:1000523"/><cvParam accession="MS:1000576"/><cvParam accession="${acc}"/><binary>${b64(a)}</binary></binaryDataArray>`;
    const mzml = `<?xml version="1.0"?><mzML><run><spectrumList><spectrum defaultArrayLength="${mz.length}"><cvParam accession="MS:1000511" value="1"/><cvParam accession="MS:1000127"/><binaryDataArrayList>${arr(mz, 'MS:1000514')}${arr(inten, 'MS:1000515')}</binaryDataArrayList></spectrum></spectrumList></run></mzML>`;
    await p.addHrmsReport(c, '2d.mzML', new TextEncoder().encode(mzml));
    v.found = mz[0].toFixed(4);
    await p.setHrmsPrint(c, true);
    const { doc } = await compileSi(p, { contentsOf: () => null, sizeOf: () => null, facts: async (ms) => ms.map((m) => (m ? molFacts(RDKit, m) : null)) });
    const text = plainText(doc.runs);
    expect(text).toContain('HRMS report: 2d.mzML');
    expect(text).toMatch(/mzML: 4 peaks from 1 spectrum\. The largest peaks near m\/z 179\.\d{4}:/);
    const tables = Object.values(doc.objects).filter((o) => o.kind === 'table') as { table: { rows: { runs: { text: string }[] }[][] } }[];
    const cells = tables.map((t) => t.table.rows.map((r) => r.map((x) => x.runs.map((y) => y.text).join(''))));
    const peaksTable = cells.find((t) => t[0][0] === 'm/z')!;
    expect(peaksTable[0]).toEqual(['m/z', 'Intensity (%)', '']);
    expect(peaksTable[1]).toEqual([mz[0].toFixed(4), '100.0', 'found m/z']);
    expect(peaksTable.length).toBe(5);
    expect(f.files.has(`${C2D}/hrms/2d.mzML`)).toBe(true);
  });
});
