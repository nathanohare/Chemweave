// Import SI, structures (SPEC §13u.7): each compound's structure from the ChemDraw drawings
// embedded in a Word SI (CDX inside an OLE object), as SI Assistant's assign_structures finds
// them: the structure labeled with its ID (several: the one fitting its HRMS formula, else one
// in its own text); else, when its own text holds one drawing of one structure, that one. A
// structure that doesn't fit the HRMS formula gets a warning; when only one structure in the SI
// fits that formula, it is taken instead (a mislabeled drawing).
//
// The drawings are read with Chemweave's own CDX and CDXML readers; the formulas need RDKit
// (`facts`), so this runs after analyse(), before the review window.

import { cdxToCdxml } from '../io/cdx';
import { hillFormula, mainSpecies, parseMFormulaAndCharge, sameFormula, type Counts, type MolFacts } from './chem';
import { bareId, isIdLabel, type ImportPlan, type ImportedCompound } from './si-import';
import type { DocObject } from './si-import-read';

type Box = [number, number, number, number];   // left, top, right, bottom (pt, y down)

/** A structure of a drawing: its molfile, where it is, its label ("" none), its charge. */
interface Structure { molblock: string; frags: Element[]; box: Box; label: string; charge: number; atoms: number }

/** A structure found in one of the SI's drawings. */
interface Drawn {
  molblock: string;
  label: string;
  drawing: number;                 // which drawing (index into the SI's objects)
  alone: boolean;                  // the drawing shows only this structure (and counter-ions)
  picture: Uint8Array | null;      // the drawing's picture (EMF), for `alone` ones
  facts: MolFacts | null;
  key: string;                     // what tells two structures apart (its pieces' SMILES)
}

export interface StructureTools {
  /** What the checks read from molfiles (formula, pieces). */
  facts(mols: string[]): Promise<(MolFacts | null)[]>;
  /** One CDXML drawing's atoms as a molfile (null: none, or not readable). */
  molfileOf(cdxml: string): string | null;
}

const kids = (el: Element): Element[] => Array.from(el.children);
const CONTAINERS = new Set(['CDXML', 'page', 'group']);

function boxOf(el: Element): Box | null {
  const v = (el.getAttribute('BoundingBox') ?? '').trim().split(/\s+/).filter(Boolean).map(Number);
  if (v.length === 4 && v.every(Number.isFinite)) return [Math.min(v[0], v[2]), Math.min(v[1], v[3]), Math.max(v[0], v[2]), Math.max(v[1], v[3])];
  const pts = kids(el).filter((c) => c.tagName === 'n').map((n) => (n.getAttribute('p') ?? '').trim().split(/\s+/).slice(0, 2).map(Number)).filter((p) => p.length === 2 && p.every(Number.isFinite));
  if (!pts.length) return null;
  return [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
}

const textOf = (t: Element): string => Array.from(t.getElementsByTagName('s')).map((s) => s.textContent ?? '').join('').trim() || (t.textContent ?? '').trim();

/** How far a label is from a structure (pt): a label under the structure is nearest; one beside it a little further; above it further still. */
function labelDistance(label: Box, box: Box): number {
  const lx = (label[0] + label[2]) / 2, ly = (label[1] + label[3]) / 2;
  const dx = Math.max(box[0] - lx, 0, lx - box[2]);
  if (ly >= box[3]) return ly - box[3] + 2 * dx;
  if (ly <= box[1]) return 2 * (box[1] - ly) + 2 * dx + 20;
  return 1.5 * dx + 10;
}

function boxGap(a: Box, b: Box): number {
  const dx = Math.max(a[0] - b[2], b[0] - a[2], 0), dy = Math.max(a[1] - b[3], b[1] - a[3], 0);
  return Math.hypot(dx, dy);
}

/** The top-level objects of a CDXML drawing (in its pages and groups). */
function topLevel(root: Element): Element[] {
  const out: Element[] = [];
  const walk = (el: Element): void => { for (const c of kids(el)) { if (CONTAINERS.has(c.tagName)) walk(c); else out.push(c); } };
  walk(root);
  return out;
}

const parseCdxml = (cdxml: string): Element => new DOMParser().parseFromString(cdxml.replace(/<!DOCTYPE[^>]*>/i, ''), 'application/xml').documentElement;

/** The structures of a drawing with their places, each with the ID label nearest below or beside it. */
export function drawingStructures(cdxml: string, tools: Pick<StructureTools, 'molfileOf'>): Structure[] {
  const root = parseCdxml(cdxml);
  if (!root || root.tagName === 'parsererror' || root.getElementsByTagName('parsererror').length) return [];
  const structures: Structure[] = [];
  const labels: { text: string; box: Box }[] = [];
  for (const el of topLevel(root)) {
    if (el.tagName === 'fragment') {
      const box = boxOf(el);
      const nodes = kids(el).filter((c) => c.tagName === 'n');
      if (!box || !nodes.length) continue;
      const molblock = molOf([el], tools);
      if (!molblock) continue;
      const charge = nodes.reduce((n, a) => n + (Number(a.getAttribute('Charge') ?? 0) || 0), 0);
      structures.push({ molblock, frags: [el], box, label: '', charge, atoms: nodes.length });
    } else if (el.tagName === 't') {
      const text = textOf(el), box = boxOf(el);
      // (as a bare ID, as the compound headings give it: "(S)-3a" labels 3a)
      if (text && box && isIdLabel(text)) labels.push({ text: bareId(text), box });
    }
  }
  // each label goes to the nearest structure under it (or beside it); a structure takes only one label
  const pairs: [number, number, number][] = [];
  labels.forEach((l, li) => structures.forEach((s, si) => pairs.push([labelDistance(l.box, s.box), li, si])));
  pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  const takenL = new Set<number>(), takenS = new Set<number>();
  for (const [dist, li, si] of pairs) {
    if (takenL.has(li) || takenS.has(si) || dist > 160) continue;
    if (structures[si].atoms <= 1 && structures[si].charge) continue;   // (a counter-ion is not what a label names)
    structures[si].label = labels[li].text;
    takenL.add(li);
    takenS.add(si);
  }
  return structures;
}

/** Every ID label written in a drawing ("5a"), wherever it is. */
export function drawingLabels(cdxml: string): string[] {
  const root = parseCdxml(cdxml);
  if (!root || root.tagName === 'parsererror') return [];
  return topLevel(root).filter((el) => el.tagName === 't').map(textOf).filter((t) => t && isIdLabel(t)).map(bareId);
}

/** Fragments of a drawing as one molfile. */
function molOf(frags: Element[], tools: Pick<StructureTools, 'molfileOf'>): string | null {
  const ser = new XMLSerializer();
  try {
    return tools.molfileOf(`<?xml version="1.0" encoding="UTF-8" ?><CDXML><page id="1">${frags.map((f) => ser.serializeToString(f)).join('')}</page></CDXML>`);
  } catch {
    return null;
  }
}

/** Whether a drawing is only structures: no text of its own (labels, conditions), no arrows or other graphics (its picture can then be the compound's structure picture as it is). */
export function isPlain(cdxml: string): boolean {
  const root = parseCdxml(cdxml);
  if (!root) return false;
  return !topLevel(root).some((el) => ['t', 'graphic', 'curve', 'arrow', 'step'].includes(el.tagName) || (el.tagName === 'scheme' && el.children.length > 0));
}

const countsOf = (f: MolFacts | null): Counts | null => {
  if (!f?.info) return null;
  return f.pieces.length > 1 ? f.pieces[mainSpecies(f.pieces)].info.counts : f.info.counts;
};

/** Every structure in the ChemDraw drawings, with its label (a salt's counter-ion, drawn near its cation and not labeled itself, is joined to it). */
async function drawnStructures(objects: DocObject[], tools: StructureTools): Promise<Drawn[]> {
  const out: Omit<Drawn, 'facts' | 'key'>[] = [];
  objects.forEach((obj, index) => {
    if (obj.kind !== 'chemdraw' || !obj.cdx) return;
    let cdxml: string;
    try { cdxml = cdxToCdxml(obj.cdx); } catch { return; }
    const structures = drawingStructures(cdxml, tools);
    // (a charged structure without a label is a counter-ion when a structure of the opposite charge,
    // labeled or larger, takes it: the larger ion of an unlabeled salt is the compound)
    const ions = structures.filter((s) => s.charge && !s.label && structures.some((o) => o !== s && o.charge * s.charge < 0 && (!!o.label || o.atoms > s.atoms)));
    const used = new Set<Structure>();
    const mains: [string, string][] = [];
    for (const s of structures) {
      if (ions.includes(s) || (s.atoms <= 1 && !s.charge)) continue;   // (a counter-ion, or a lone atom: a label read as carbon)
      let molblock = s.molblock;
      if (s.charge) {   // join the nearest unlabeled ions of the opposite charge
        let need = s.charge;
        const frags = [...s.frags];
        for (const ion of [...ions].sort((a, b) => boxGap(a.box, s.box) - boxGap(b.box, s.box))) {
          if (!need || used.has(ion) || ion.charge * need > 0 || boxGap(ion.box, s.box) > 80) continue;
          frags.push(...ion.frags);
          used.add(ion);
          need += ion.charge;
        }
        if (frags.length > 1) molblock = molOf(frags, tools) ?? molblock;
      }
      mains.push([molblock, s.label]);
    }
    // its picture only for a drawing of just this one structure, with no text or arrows
    const plain = mains.length === 1 && isPlain(cdxml);
    for (const [molblock, label] of mains) out.push({ molblock, label, drawing: index, alone: mains.length === 1, picture: plain ? obj.picture : null });
  });
  if (!out.length) return [];
  const facts = await tools.facts(out.map((d) => d.molblock));
  return out.map((d, i) => ({ ...d, facts: facts[i] ?? null, key: (facts[i]?.pieces ?? []).map((p) => p.smiles).sort().join('.') || d.molblock }));
}

function hrmsCounts(c: ImportedCompound): Counts | null {
  const h = c.values.hrms as Record<string, unknown> | undefined;
  const f = String(h?.formula ?? '');
  if (!f) return null;
  try { return parseMFormulaAndCharge(f)[0]; } catch { return null; }
}

/** Give each compound its structure from the SI's ChemDraw drawings (see above). */
export async function assignStructures(plan: ImportPlan, tools: StructureTools): Promise<void> {
  const objects = plan.objects;
  const drawn = await drawnStructures(objects, tools);
  if (!drawn.length) return;
  const byLabel = new Map<string, Drawn[]>();
  for (const d of drawn) if (d.label) { const k = d.label.trim(); byLabel.set(k, [...(byLabel.get(k) ?? []), d]); }
  const indexOf = new Map(objects.map((o, i) => [o, i]));
  const fits = (d: Drawn, want: Counts | null): boolean => { const got = countsOf(d.facts); return !!want && !!got && sameFormula(got, want); };
  plan.compounds.forEach((c, k) => {
    const own = new Set((plan.own_objects[k] ?? []).map((o) => indexOf.get(o)).filter((i): i is number => i !== undefined));
    const want = hrmsCounts(c);
    const cands = byLabel.get(c.cid) ?? [];
    let chosen: Drawn | null = null, note = '';
    if (cands.length) {
      const rank = (d: Drawn): [number, number, number] => [fits(d, want) ? 0 : 1, own.has(d.drawing) ? 0 : 1, d.drawing];
      chosen = [...cands].sort((a, b) => { const x = rank(a), y = rank(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; })[0];
      note = `from the ChemDraw drawing labeled “${c.cid}”`;
      const others = new Set(cands.map((d) => d.key));
      others.delete(chosen.key);
      if (others.size) c.warnings.push(`“${c.cid}” labels ${others.size + 1} different structures in the SI's drawings; the one that fits its HRMS formula (or is next to its text) was taken. Check it.`);
    } else {
      const mine = drawn.filter((d) => own.has(d.drawing) && (!d.label || d.label === c.cid));
      if (mine.length === 1 && mine[0].alone) { chosen = mine[0]; note = 'from the ChemDraw drawing next to its text'; }
    }
    if (!chosen) return;
    let got = countsOf(chosen.facts);
    if (want && got && !sameFormula(got, want)) {
      // the labeled structure doesn't fit the HRMS: if just one structure in the whole SI does (by its formula), it is that one, labeled otherwise
      const fitting = new Map<string, Drawn>();
      for (const d of drawn) if (fits(d, want) && !fitting.has(d.key)) fitting.set(d.key, d);
      if (fitting.size === 1) {
        const other = [...fitting.values()][0];
        c.warnings.push(`The drawing labeled “${c.cid}” shows a structure (${hillFormula(got)}) that does not fit its HRMS; the only structure in the SI that does (drawn ${other.label ? `as “${other.label}”` : 'unlabeled'}) was taken instead. Check it.`);
        chosen = other;
        got = countsOf(other.facts);
        note = 'the one structure in the SI\'s drawings that fits its HRMS formula';
      }
    }
    c.structure = chosen.molblock;
    c.structure_note = note;
    c.structure_picture = chosen.alone ? chosen.picture : null;
    if (want && got && !sameFormula(got, want)) {
      c.warnings.push(`The structure found (${hillFormula(got)}) does not fit the formula of its HRMS (${String((c.values.hrms as Record<string, unknown>).formula)}): check the structure or the HRMS.`);
    }
  });
}
