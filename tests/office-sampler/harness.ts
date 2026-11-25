/**
 * The checks every Office sampler goes through (run per format by tests/office-samplers-docx.test.ts,
 * -pptx and -xlsx, so the formats spread over the Checks workflow's test shards):
 *   - its items are listed once, and every supported or kept item has a check;
 *   - every check holds on the file as built (so the check reads the item correctly);
 *   - the file as built is valid against the ECMA-376 Transitional schemas (tests/ooxml-schema.ts)
 *     and holds together (integrity(): every relationship it uses is there, every style it uses);
 *   - it opens through the app's Open and saves through its Save (app.ts);
 *   - the saved file is valid against the schemas and holds together too;
 *   - every supported and kept item is still there after the save;
 *   - opening the saved file and saving it again gives the same file.
 * It prints which loss items a save drops (and which it keeps after all), for the findings report.
 *
 * A check that fails on what this program does today is listed in FINDINGS (one list per format,
 * {docx,pptx,xlsx}-samplers.ts) with the finding's id; the findings report says what Office does,
 * what Chemweave does and the likely fix. It runs as an expected failure: CI stays green, the
 * failure stays visible in the test's name, and the test fails as soon as the item passes, so the
 * entry is taken off once it is fixed. Never add an entry to make a new problem pass: a new item
 * that fails is a new finding first.
 *
 * OFFICE_SAMPLER_OUT=<folder> writes every sampler, Chemweave's save of it (chemweave-saved/) and
 * manifest-<format>.json (each item: sampler, id, feature, tag, spec, basis, whether it survived
 * Chemweave's save, and its finding) to that folder, for the comparison in Word, PowerPoint and
 * Excel (scripts/office-sampler-compare.ps1). OFFICE_RESAVED=<folder of Office's own saves> then
 * checks every item on Office's copy (what Office itself keeps), saves Office's copy through
 * Chemweave into <OFFICE_SAMPLER_OUT>/office-then-chemweave, checks every item on that too, and
 * writes manifest-office-<format>.json; it only reports, it never fails.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { View, NS, type Sampler, type Finding } from './kit';
import { openAndSave } from './app';
import { validatePackage, schemasReady, schemasRequired } from '../ooxml-schema';

const REPO = resolve(__dirname, '..', '..');
/** A folder outside the repository, or an error: Office's copies and Chemweave's saves never go into it. */
function outside(folder: string | undefined, what: string): string | undefined {
  if (!folder) return undefined;
  const rel = relative(REPO, resolve(folder));
  if (!rel.startsWith('..') && !isAbsolute(rel)) throw new Error(`${what} (${folder}) is inside the repository; give a folder outside it`);
  return folder;
}
const OUT = outside(process.env.OFFICE_SAMPLER_OUT, 'OFFICE_SAMPLER_OUT');
const RESAVED = outside(process.env.OFFICE_RESAVED, 'OFFICE_RESAVED');

/** The parts of two saves that differ, with what may differ between saves made the same: when it was saved. */
function sameSave(a: Uint8Array, b: Uint8Array): string[] {
  const norm = (n: string, s: string) => n === 'docProps/core.xml'
    ? s.replace(/<cp:revision>\d+<\/cp:revision>/, '').replace(/(<dcterms:(?:created|modified)[^>]*>)[^<]*/g, '$1') : s;
  const pa = unzipSync(a), pb = unzipSync(b);
  const out: string[] = [];
  for (const n of new Set([...Object.keys(pa), ...Object.keys(pb)])) {
    if (!pa[n] || !pb[n]) { out.push(`${n}: only in the ${pa[n] ? 'first' : 'second'} save`); continue; }
    // pictures, embedded objects and other binary parts byte for byte
    if (!/\.(xml|rels|vml)$/i.test(n)) {
      const x = pa[n], y = pb[n];
      if (x.length !== y.length || x.some((v, i) => v !== y[i])) out.push(`${n}: its bytes differ`);
      continue;
    }
    const ta = norm(n, strFromU8(pa[n])), tb = norm(n, strFromU8(pb[n]));
    if (ta !== tb) {
      let i = 0;
      while (i < ta.length && ta[i] === tb[i]) i++;
      out.push(`${n}: differs at ${i}: …${ta.slice(Math.max(0, i - 60), i + 60)}… against …${tb.slice(Math.max(0, i - 60), i + 60)}…`);
    }
  }
  return out;
}

/** Element and attribute names in `a`'s XML parts that `b`'s lack (for the printed summary). */
function namesLost(a: View, b: View): string[] {
  const names = (v: View) => {
    const s = new Set<string>();
    for (const p of Object.keys(v.parts)) {
      if (p.endsWith('.rels') || p === '[Content_Types].xml') continue;
      const d = v.doc(p);
      if (!d) continue;
      for (const e of Array.from(d.getElementsByTagName('*'))) { s.add(e.nodeName); for (const x of Array.from(e.attributes)) if (!x.name.startsWith('xmlns')) s.add(`${e.nodeName}@${x.name}`); }
    }
    return s;
  };
  const nb = names(b);
  return [...names(a)].filter((n) => !nb.has(n)).sort();
}

/**
 * What would make Office refuse a file that the schemas allow: a relationship id used in a part
 * that its .rels doesn't have, an internal relationship to a part that isn't in the package, and,
 * in a workbook, a cell, row or column style (s, style) or a differential format (dxfId) beyond
 * the ones styles.xml lists. (A sort by color keeping dxfId 4 when no dxfs are written made Excel
 * refuse a whole workbook: F-X-010.)
 */
export function integrity(v: View): string[] {
  const out: string[] = [];
  const all = new Set([...Object.keys(v.parts), ...Object.keys(v.binary)]);
  // every part has a content type, by its extension (Default) or its name (Override)
  const ct = v.doc('[Content_Types].xml');
  const defaults = new Set(Array.from(ct?.getElementsByTagNameNS(NS.ct, 'Default') ?? []).map((d) => (d.getAttribute('Extension') ?? '').toLowerCase()));
  const overrides = new Set(Array.from(ct?.getElementsByTagNameNS(NS.ct, 'Override') ?? []).map((o) => (o.getAttribute('PartName') ?? '').replace(/^\//, '').toLowerCase()));
  for (const p of all) {
    if (p === '[Content_Types].xml' || p.endsWith('/')) continue;
    const ext = /\.([^./]+)$/.exec(p)?.[1]?.toLowerCase() ?? '';
    if (!defaults.has(ext) && !overrides.has(p.toLowerCase())) out.push(`[Content_Types].xml: ${p} has no content type`);
  }
  for (const part of Object.keys(v.parts).filter((p) => /\.xml$/i.test(p) && !p.includes('_rels/'))) {
    const dir = part.includes('/') ? part.slice(0, part.lastIndexOf('/') + 1) : '';
    const rels = v.doc(`${dir}_rels/${part.slice(dir.length)}.rels`);
    const byId = new Map(Array.from(rels?.getElementsByTagNameNS(NS.rels, 'Relationship') ?? []).map((r) => [r.getAttribute('Id') ?? '', r]));
    for (const r of byId.values()) {
      if (r.getAttribute('TargetMode') === 'External') continue;
      const t = r.getAttribute('Target') ?? '';
      const path = t.startsWith('/') ? t.slice(1) : join(dir, t).replace(/\\/g, '/');
      if (!all.has(path)) out.push(`${part}: relationship ${r.getAttribute('Id')} goes to ${path}, which isn't in the file`);
    }
    const d = v.doc(part);
    if (!d) continue;
    for (const e of Array.from(d.getElementsByTagName('*'))) {
      for (const a of Array.from(e.attributes)) {
        if (a.namespaceURI !== NS.r || !a.value) continue;
        if (!byId.has(a.value)) out.push(`${part}: ${e.nodeName}@${a.name}="${a.value}" has no relationship`);
      }
    }
  }
  const styles = v.doc('xl/styles.xml');
  if (styles) {
    const count = (list: string, item: string) => Array.from(styles.getElementsByTagNameNS(NS.x, list)[0]?.getElementsByTagNameNS(NS.x, item) ?? []).length;
    const xfs = count('cellXfs', 'xf'), dxfs = count('dxfs', 'dxf');
    for (const part of v.partsLike(/^xl\/(worksheets\/sheet\d+|tables\/table\d+|pivotTables\/pivotTable\d+|styles)\.xml$/)) {
      for (const e of Array.from(v.doc(part)!.getElementsByTagName('*'))) {
        for (const attr of ['dxfId', 'headerRowDxfId', 'dataDxfId', 'totalsRowDxfId']) {
          const n = e.getAttribute(attr);
          if (n !== null && Number(n) >= dxfs) out.push(`${part}: ${e.localName}@${attr}="${n}", but styles.xml has ${dxfs} dxfs`);
        }
        if (part.includes('worksheets') && ['c', 'row'].includes(e.localName)) {
          const s = e.getAttribute('s');
          if (s !== null && Number(s) >= xfs) out.push(`${part}: ${e.localName}@s="${s}", but styles.xml has ${xfs} cellXfs`);
        }
        if (part.includes('worksheets') && e.localName === 'col') {
          const s = e.getAttribute('style');
          if (s !== null && Number(s) >= xfs) out.push(`${part}: col@style="${s}", but styles.xml has ${xfs} cellXfs`);
        }
      }
    }
  }
  return out;
}

/** The suite for one format's samplers. */
export function samplerSuite(format: string, samplers: Sampler[], findings: Record<string, Finding>): void {
  const manifest: Record<string, unknown>[] = [];
  /** Run `fn` as a test, or as an expected failure when `key` is a finding. */
  const check = (key: string, title: string, fn: () => void | Promise<void>, timeout?: number) => {
    const f = findings[key];
    if (f) it.fails(`${title} [expected failure: ${f.finding}]`, fn, timeout);
    else it(title, fn, timeout);
  };
  /**
   * A whole-file check whose problems come as lines: with no finding, no problem may be left; with
   * a finding that has a scope, the lines it covers run as the expected failure and every other
   * line fails as usual (so a new problem in that file is still caught).
   */
  const fileCheck = (key: string, title: string, problems: () => Promise<string[]>, timeout = 60_000) => {
    const f = findings[key];
    if (!f) { it(title, async () => expect(await problems()).toEqual([]), timeout); return; }
    if (!f.scope) { it.fails(`${title} [expected failure: ${f.finding}]`, async () => expect(await problems()).toEqual([]), timeout); return; }
    const scope = f.scope;
    it(`${title} (beyond what ${f.finding} covers)`, async () => expect((await problems()).filter((p) => !scope.test(p))).toEqual([]), timeout);
    it.fails(`${title}, as far as ${f.finding} covers [expected failure: ${f.finding}]`, async () => expect((await problems()).filter((p) => scope.test(p))).toEqual([]), timeout);
  };

  describe(`${format}: item ids and findings`, () => {
    // ids are never renumbered: an id keeps its feature for good (a removed item leaves a gap, a new
    // one takes the next number), checked against the list kept beside the samplers;
    // OFFICE_SAMPLER_IDS=update writes new ids into it, after a person has looked at the change
    const snapPath = join(__dirname, `ids-${format}.json`);
    const now: Record<string, string> = Object.fromEntries(samplers.flatMap((s) => s.items.map((i) => [i.id, i.feature])));
    it('keeps every item id on the feature it was first given', () => {
      const snap: Record<string, string> = existsSync(snapPath) ? JSON.parse(readFileSync(snapPath, 'utf8')) : {};
      const moved = Object.entries(snap).filter(([id, f]) => id in now && now[id] !== f).map(([id, f]) => `${id}: was "${f}", now "${now[id]}"`);
      expect(moved, 'an item id must keep its feature; give a new item a new number').toEqual([]);
      const fresh = Object.keys(now).filter((id) => !(id in snap));
      if (process.env.OFFICE_SAMPLER_IDS === 'update') {
        writeFileSync(snapPath, JSON.stringify({ ...snap, ...Object.fromEntries(fresh.map((id) => [id, now[id]])) }, null, 1) + '\n');
      } else {
        expect(fresh, `new items: add them to ${snapPath} with OFFICE_SAMPLER_IDS=update`).toEqual([]);
      }
    });
    it('names, for every finding, a check that exists', () => {
      const keys = new Set([...samplers.flatMap((s) => s.items.filter((i) => i.tag !== 'loss').map((i) => i.id)),
        ...samplers.flatMap((s) => ['opens', 'integrity', 'schema-out', 'second-save'].map((c) => `${s.name}:${c}`))]);
      expect(Object.keys(findings).filter((k) => !keys.has(k))).toEqual([]);
    });
  });

  if (RESAVED) {
    describe(`${format}: Office re-saves`, () => {
      const rows: Record<string, unknown>[] = [];
      for (const sampler of samplers) {
        it(`${sampler.name}: items on Office's copy, and on Chemweave's save of it`, async () => {
          const path = join(RESAVED, sampler.name);
          if (!existsSync(path)) { rows.push({ sampler: sampler.name, missing: true }); return; }
          const office = readFileSync(path);
          const ov = new View(office);
          let cw: View | undefined; let error = '';
          try {
            const saved = await openAndSave(office, sampler.name);
            cw = new View(saved);
            if (OUT) { mkdirSync(join(OUT, 'office-then-chemweave'), { recursive: true }); writeFileSync(join(OUT, 'office-then-chemweave', sampler.name), saved); }
          } catch (e) { error = String(e); }
          const run = (v: View | undefined, f: (v: View) => boolean) => { if (!v) return null; try { return f(v); } catch { return false; } };
          for (const i of sampler.items) rows.push({ sampler: sampler.name, id: i.id, tag: i.tag, office: i.check ? run(ov, i.check) : null, officeThenChemweave: i.check ? run(cw, i.check) : null, error });
          rows.push({ sampler: sampler.name, officeIntegrity: integrity(ov), officeThenChemweaveIntegrity: cw ? integrity(cw) : null });
          if (OUT) writeFileSync(join(OUT, `manifest-office-${format}.json`), JSON.stringify(rows, null, 1));
        }, 120_000);
      }
    });
  }

  describe.each(samplers.map((s) => [s.name, s] as [string, Sampler]))('%s', (name, sampler) => {
    const bytes = sampler.build();
    const built = new View(bytes);
    let saved: Uint8Array | undefined;
    let savedView: View | undefined;
    let again: Uint8Array | undefined;
    let failure: unknown;

    beforeAll(async () => {
      try {
        saved = await openAndSave(bytes, name);
        savedView = new View(saved);
        again = await openAndSave(saved, name);
      } catch (e) {
        failure = e;
      }
      if (OUT) {
        mkdirSync(join(OUT, 'chemweave-saved'), { recursive: true });
        writeFileSync(join(OUT, name), bytes);
        if (saved) writeFileSync(join(OUT, 'chemweave-saved', name), saved);
        for (const i of sampler.items) {
          let survived: boolean | null = null;
          if (i.check && savedView) { try { survived = i.check(savedView); } catch { survived = false; } }
          manifest.push({ sampler: name, area: sampler.area, id: i.id, feature: i.feature, tag: i.tag, spec: i.spec, basis: i.basis ?? '', survived, finding: findings[i.id]?.finding ?? '', note: findings[i.id]?.note ?? '' });
        }
        writeFileSync(join(OUT, `manifest-${format}.json`), JSON.stringify(manifest, null, 1));
      }
    }, 120_000);

    it('lists each item once, and every supported or kept item has a check', () => {
      const ids = sampler.items.map((i) => i.id);
      expect(ids.filter((x, k) => ids.indexOf(x) !== k)).toEqual([]);
      expect(sampler.items.filter((i) => i.tag !== 'loss' && !i.check).map((i) => i.id)).toEqual([]);
      // every id appears in the file
      const all = Object.values(built.parts).join('\n');
      expect(ids.filter((x) => !all.includes(x))).toEqual([]);
    });

    it('holds every item as built (each check reads its item)', () => {
      const wrong = sampler.items.filter((i) => i.check && !i.check(built)).map((i) => `${i.id} ${i.feature}`);
      expect(wrong).toEqual([]);
    });

    it('holds together as built (relationships and styles it uses are there)', () => {
      expect(integrity(built)).toEqual([]);
    }, 60_000);

    it.skipIf(!schemasReady() && !schemasRequired())('is valid against the ECMA-376 schemas as built', async () => {
      expect(schemasReady(), 'run `node scripts/fetch-ooxml-schemas.mjs`').toBe(true);
      const problems = await validatePackage(bytes);
      expect(problems.map((p) => `${p.part}:${p.message}`)).toEqual([]);
    }, 60_000);

    check(`${name}:opens`, 'opens and saves in Chemweave', () => {
      if (failure) throw failure;
      expect(saved).toBeDefined();
    });

    // each whole-file check works its problems out once, and prints them whole for the findings report
    const once = <T>(f: () => Promise<T>) => { let p: Promise<T> | undefined; return () => (p ??= f()); };
    const integrityProblems = once(async () => {
      if (!savedView) throw failure ?? new Error('not saved');
      const problems = integrity(savedView);
      if (problems.length) console.log(`${name}: saved file doesn't hold together:\n  ${problems.join('\n  ')}`);
      return problems;
    });
    fileCheck(`${name}:integrity`, 'saves a file that holds together (relationships and styles it uses are there)', integrityProblems);

    if (schemasReady() || schemasRequired()) {
      const schemaProblems = once(async () => {
        if (!saved) throw failure ?? new Error('not saved');
        const problems = (await validatePackage(saved)).map((p) => `${p.part}:${p.message}`);
        if (problems.length) console.log(`${name}: schema problems after saving:\n  ${problems.join('\n  ')}`);
        return problems;
      });
      fileCheck(`${name}:schema-out`, 'saves a file valid against the ECMA-376 schemas', schemaProblems);
    }

    const saveDiff = once(async () => {
      if (!saved || !again) throw failure ?? new Error('not saved');
      const diff = sameSave(saved, again);
      if (diff.length) console.log(`${name}: a second save differs:\n  ${diff.join('\n  ')}`);
      return diff;
    });
    fileCheck(`${name}:second-save`, 'saves the same file when opened and saved again', saveDiff);

    for (const item of sampler.items.filter((i) => i.tag !== 'loss' && i.check)) {
      check(item.id, `${item.id} ${item.feature} (${item.tag}) survives a save`, () => {
        if (!savedView) throw failure ?? new Error('not saved');
        // the item itself is still there (its id in its text or name), not only something like it
        expect(Object.values(savedView.parts).some((t) => t.includes(item.id)), `${item.id} is no longer in the saved file`).toBe(true);
        expect(item.check!(savedView)).toBe(true);
      });
    }

    it('prints what a save loses', () => {
      if (!savedView) return;
      const loss = sampler.items.filter((i) => i.tag === 'loss' && i.check);
      const kept = loss.filter((i) => i.check!(savedView!)).map((i) => i.id);
      const lost = loss.filter((i) => !i.check!(savedView!)).map((i) => i.id);
      const names = namesLost(built, savedView);
      console.log(`${name}: ${sampler.items.length} items (${sampler.items.filter((i) => i.tag === 'supported').length} supported, ${sampler.items.filter((i) => i.tag === 'kept').length} kept, ${sampler.items.filter((i) => i.tag === 'loss').length} loss)`
        + `\n  loss items dropped as expected (${lost.length}): ${lost.join(' ')}`
        + `\n  loss items kept after all (${kept.length}): ${kept.join(' ')}`
        + `\n  element and attribute names a save drops (${names.length}): ${names.join(', ')}`);
    }, 60_000);
  });
}
