// Things copied into a drawing get new ids. What points at other things by id has to follow:
// an arrow's chosen roles (reaction steps, a Smart Scheme's order) and a frame's members.

import type { Attachment, Doc, Frame, Glue, MorphStep, Pin, StepRoles } from '../model';
import { structureKey } from '../design/newman';

export interface IdMaps {
  atoms: Map<number, number>;
  captions: Map<number, number>;
  shapes: Map<number, number>;
  arrows: Map<number, number>;
}

/** An arrow's roles naming the new copies; things not copied drop out. */
export function remapStep(st: StepRoles, maps: IdMaps): StepRoles {
  const ref = (r: string): string | null => {
    const n = Number(r.slice(1));
    const to = r[0] === 'a' ? maps.atoms.get(n) : r[0] === 'c' ? maps.captions.get(n) : r[0] === 's' ? maps.shapes.get(n) : undefined;
    return to === undefined ? null : r[0] + to;
  };
  const refs = (list: string[]) => list.map(ref).filter((r): r is string => r !== null);
  const out: StepRoles = { ...st, reactants: refs(st.reactants), products: refs(st.products), above: refs(st.above), below: refs(st.below) };
  if (st.plusses) out.plusses = refs(st.plusses);
  if (st.inside) out.inside = refs(st.inside);
  return out;
}

/** The copied frames (Smart Schemes, energy diagrams) holding the copies of what they held. */
export function remapFrames(doc: Doc, maps: IdMaps): void {
  const keep = (list: number[], by: Map<number, number>) => list.map((x) => by.get(x)).filter((x): x is number => x !== undefined);
  for (const id of maps.shapes.values()) {
    const f = doc.shapes.get(id)?.frame;
    if (!f) continue;
    doc.updateShape(id, { frame: { ...f, atoms: keep(f.atoms, maps.atoms), captions: keep(f.captions, maps.captions), arrows: keep(f.arrows, maps.arrows), shapes: keep(f.shapes, maps.shapes) } });
    // a Newman projection copied with its structure follows the copy; copied alone it lets go
    const d = doc.shapes.get(id)?.newman;
    if (d?.link) {
      const front = maps.atoms.get(d.link.front), back = maps.atoms.get(d.link.back);
      if (front === undefined || back === undefined) { const { link: _l, mark: _m, ...rest } = d; doc.updateShape(id, { newman: rest }); continue; }
      const atoms = [...doc.fragmentOf(front)];
      const arrows = d.mark?.arrows.map((x) => maps.arrows.get(x)), shapes = d.mark?.shapes.map((x) => maps.shapes.get(x));
      const mark = d.mark && arrows!.every((x) => x !== undefined) && shapes!.every((x) => x !== undefined) ? { ...d.mark, arrows: arrows as number[], shapes: shapes as number[] } : undefined;
      const { mark: _m, ...rest } = d;
      doc.updateShape(id, { newman: { ...rest, link: { atoms, front, back, key: structureKey(doc, atoms) }, ...(mark ? { mark } : {}) } });
    }
  }
}

/** The kinds of thing a reference names: atoms, bonds, captions, arrows, shapes. */
export type RefKind = 'a' | 'b' | 'c' | 'r' | 's';
/** What an old id became (undefined when it is not there). */
export type IdOf = (kind: RefKind, id: number) => number | undefined;

/**
 * The fields of each kind of thing that name other things by id (besides a multicentre point's
 * `multi`, which goes with its structure): a variable attachment's ring, a bond's crossing
 * bonds, a caption tied to a structure, an arrow's step, pins, glued ends, reagent arrow and
 * animation, a ring fill's atoms, a shape's pin and a frame's members.
 */
export const REF_FIELDS: Record<RefKind, readonly string[]> = {
  a: ['ringOf'],
  b: ['crossing'],
  c: ['attach'],
  r: ['step', 'pin', 'from', 'to', 'reagentFor', 'morph'],
  s: ['ring', 'pin', 'frame'],
};

/**
 * A field's value naming the things it named by their new ids. With `strict`, undefined when
 * any of them is not there (the field is then best left as it was); otherwise those drop out
 * (and a single reference that is gone gives undefined).
 */
export function remapField(kind: RefKind, field: string, v: unknown, idOf: IdOf, strict: boolean): unknown {
  if (v === undefined || v === null) return undefined;
  let lost = false;
  const one = (k: RefKind, id: unknown): number | undefined => { const n = typeof id === 'number' ? idOf(k, id) : undefined; if (n === undefined) lost = true; return n; };
  const list = (k: RefKind, ids: unknown): number[] => (Array.isArray(ids) ? ids : []).map((id) => one(k, id)).filter((x): x is number => x !== undefined);
  const pin = (p: unknown): Pin | undefined => {
    const q = p as Pin | undefined;
    if (!q || !Array.isArray(q.ref)) return undefined;
    const ref = list('a', q.ref);
    return ref.length === q.ref.length ? { ...q, ref } : (lost = true, undefined);
  };
  let out: unknown;
  const key = `${kind}.${field}`;
  switch (key) {
    case 'a.ringOf': case 's.ring': out = list('a', v); break;
    case 'b.crossing': out = list('b', v); break;
    case 'c.attach': { const at = v as Attachment; out = { ...at, atoms: list('a', at.atoms) }; break; }
    case 'r.step': {
      const st = v as StepRoles;
      const ref = (r: string): string | null => { const k = r[0] as RefKind; const n = one(k, Number(r.slice(1))); return n === undefined ? null : k + n; };
      const refs = (l: string[] | undefined) => (l ?? []).map(ref).filter((r): r is string => r !== null);
      const o: StepRoles = { ...st, reactants: refs(st.reactants), products: refs(st.products), above: refs(st.above), below: refs(st.below) };
      if (st.plusses) o.plusses = refs(st.plusses);
      if (st.inside) o.inside = refs(st.inside);
      out = o;
      break;
    }
    case 'r.pin': {
      const p = v as { tail?: Pin; head?: Pin };
      const tail = p.tail ? pin(p.tail) : undefined, head = p.head ? pin(p.head) : undefined;
      out = tail || head ? { ...(tail ? { tail } : {}), ...(head ? { head } : {}) } : undefined;
      break;
    }
    case 's.pin': out = pin(v); break;
    case 'r.from': case 'r.to': { const g = v as Glue; const shape = one('s', g.shape); out = shape === undefined ? undefined : { ...g, shape }; break; }
    case 'r.reagentFor': out = one('r', v); break;
    case 'r.morph': {
      const m = v as MorphStep;
      const pairs = (l: number[][] | undefined, n: number) => (l ?? []).map((t) => list('a', t)).filter((t) => t.length === n);
      const o: MorphStep = { ...m };
      if (m.pairs) o.pairs = pairs(m.pairs, 2) as [number, number][];
      if (m.shifts) o.shifts = pairs(m.shifts, 3) as [number, number, number][];
      if (m.slides) o.slides = (m.slides ?? []).map((sl) => sl.map((t) => list('a', t))).filter((sl) => sl.every((t) => t.length === 2)) as [[number, number], [number, number]][];
      out = o;
      break;
    }
    case 's.frame': { const f = v as Frame; out = { ...f, atoms: list('a', f.atoms), captions: list('c', f.captions), arrows: list('r', f.arrows), shapes: list('s', f.shapes) }; break; }
    default: return v;
  }
  return strict && lost ? undefined : out;
}

/** Every reference field of a thing (REF_FIELDS) made to name the new ids, in place (fields naming only things that are gone are taken off). */
export function remapRefs(kind: RefKind, o: Record<string, unknown>, idOf: IdOf): void {
  for (const f of REF_FIELDS[kind]) {
    if (o[f] === undefined) continue;
    const v = remapField(kind, f, o[f], idOf, false);
    if (v === undefined) delete o[f]; else o[f] = v;
  }
}
