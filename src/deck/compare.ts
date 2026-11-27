// Review > Compare for slides (PowerPoint's Compare Presentations): the differences between this
// deck and another version of it (a reviewer's copy, say), slide by slide, each to accept into
// this deck or reject. Slides are matched by their titles, in order (the longest run of titles
// the two decks share), then by place between those; a slide only in the other version is one
// to insert, a slide only in this one is one to delete, and a matched slide that differs lists
// what differs: its title, text, structures, pictures, charts, shapes, layout and notes.

import type { Contents, Caption, Atom, Bond, Shape } from '../model';

/** A slide as compared: its layout, what is on it, and its speaker notes. */
export interface SlideView { layout: string; contents: Contents; notes: string }

export type SlideChange =
  /** A slide only in the other version: inserted after this deck's slide `after` (-1: at the start). */
  | { kind: 'inserted'; theirs: number; after: number; title: string; details: string[] }
  /** A slide only in this deck. */
  | { kind: 'deleted'; mine: number; title: string; details: string[] }
  /** A slide in both that differs. */
  | { kind: 'changed'; mine: number; theirs: number; title: string; details: string[] };

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
const plain = (c: Pick<Caption, 'runs'>) => c.runs.map((r) => r.text).join('').replace(/\s+/g, ' ').trim();
const quote = (s: string) => `"${s.length > 40 ? s.slice(0, 38) + '…' : s}"`;

/** A slide's title (its title placeholder's text), or ''. */
export function slideTitle(c: Contents): string {
  const t = c.captions.find((x) => x.ph === 'title');
  return t ? plain(t) : '';
}

/** Pairs of indices the two lists share, in order (the longest common run of equal keys); empty keys never match. */
function commonRun(a: string[], b: string[]): [number, number][] {
  const n = a.length, m = b.length;
  const L: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    L[i][j] = a[i] && a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  }
  const out: [number, number][] = [];
  for (let i = 0, j = 0; i < n && j < m;) {
    if (a[i] && a[i] === b[j]) { out.push([i, j]); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) i++; else j++;
  }
  return out;
}

/** Every slide of `mine` and `theirs` matched up: pairs, and the slides only one of them has. */
export function matchSlides(mine: SlideView[], theirs: SlideView[]): { pairs: [number, number][]; onlyMine: number[]; onlyTheirs: { theirs: number; after: number }[] } {
  const anchors = commonRun(mine.map((s) => norm(slideTitle(s.contents))), theirs.map((s) => norm(slideTitle(s.contents))));
  const pairs: [number, number][] = [], onlyMine: number[] = [], onlyTheirs: { theirs: number; after: number }[] = [];
  let i = 0, j = 0;
  for (const [ai, aj] of [...anchors, [mine.length, theirs.length] as [number, number]]) {
    // between two matched titles: slides paired by place, the rest added or taken out
    const gm = ai - i, gt = aj - j, both = Math.min(gm, gt);
    for (let k = 0; k < both; k++) pairs.push([i + k, j + k]);
    for (let k = both; k < gm; k++) onlyMine.push(i + k);
    for (let k = both; k < gt; k++) onlyTheirs.push({ theirs: j + k, after: i + both - 1 });
    if (ai < mine.length) pairs.push([ai, aj]);
    i = ai + 1; j = aj + 1;
  }
  pairs.sort((a, b) => a[0] - b[0]);
  return { pairs, onlyMine, onlyTheirs };
}

/** A short text standing for a longer one (so the make-up of a neighbourhood stays short). */
function hashOf(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

/** Bond displays that run one way (a wedge's narrow end is its first atom): swapping the ends is a different bond. */
const DIRECTED = new Set(['wedge', 'hashWedge', 'hollowWedge', 'wavyWedge', 'dative']);

/**
 * A structure's make-up, to tell structures apart: each atom's element or label, charge, isotope and
 * radical, and how the atoms are joined (each bond's order and kind, wedge or hash with its
 * direction), so that isomers and a wedge turned to a hash are different structures. Atoms are
 * told apart by their surroundings, a few steps out, as a Morgan or Weisfeiler-Lehman pass does.
 */
function structureKeys(c: Contents): { key: string; x: number; y: number }[] {
  const byId = new Map<number, Atom>(c.atoms.map((a) => [a.id, a]));
  const adj = new Map<number, number[]>();
  for (const b of c.bonds) {
    adj.set(b.a1, [...(adj.get(b.a1) ?? []), b.a2]);
    adj.set(b.a2, [...(adj.get(b.a2) ?? []), b.a1]);
  }
  const seen = new Set<number>();
  const out: { key: string; x: number; y: number }[] = [];
  for (const a of c.atoms) {
    if (seen.has(a.id)) continue;
    const frag: Atom[] = [];
    const stack = [a.id];
    seen.add(a.id);
    while (stack.length) {
      const id = stack.pop()!;
      const at = byId.get(id);
      if (at) frag.push(at);
      for (const k of adj.get(id) ?? []) if (!seen.has(k)) { seen.add(k); stack.push(k); }
    }
    const ids = new Set(frag.map((x) => x.id));
    const bonds = c.bonds.filter((b) => ids.has(b.a1) && ids.has(b.a2) && byId.has(b.a1) && byId.has(b.a2));
    // each atom starts as what it is; each step adds what it is joined to, and how
    const around = new Map<number, Bond[]>();
    for (const b of bonds) for (const id of [b.a1, b.a2]) around.set(id, [...(around.get(id) ?? []), b]);
    let sig = new Map<number, string>(frag.map((x) => [x.id, `${x.label ?? `${x.z}${x.charge ? `(${x.charge})` : ''}`}${x.isotope ? `^${x.isotope}` : ''}${x.radical ? `.${x.radical}` : ''}`]));
    const edge = (b: Bond, from: number): string => {
      const other = from === b.a1 ? b.a2 : b.a1;
      const dir = DIRECTED.has(b.display) ? (from === b.a1 ? '>' : '<') : '';
      return `${b.order}${b.display}${dir}${sig.get(other)}`;
    };
    // until the atoms stop being told further apart (at most as many steps as there are atoms: a chain's two ends can be that far from what sets them apart)
    let kinds = new Set(sig.values()).size;
    for (let round = 0; round < frag.length; round++) {
      const next = new Map<number, string>();
      for (const x of frag) next.set(x.id, hashOf(`${sig.get(x.id)}(${(around.get(x.id) ?? []).map((b) => edge(b, x.id)).sort().join(',')})`));
      sig = next;
      const now = new Set(sig.values()).size;
      if (now === kinds) break;
      kinds = now;
    }
    // a double bond's two sides: the substituents on the same side of it (cis) or opposite sides (trans), when each end has substituents that differ
    const geometry = (b: Bond): string => {
      if (b.order !== 2) return '';
      const u = byId.get(b.a1)!, v = byId.get(b.a2)!;
      const side = (from: Atom, to: Atom): number | null => {
        const subs = (around.get(from.id) ?? []).filter((x) => x !== b).map((x) => byId.get(x.a1 === from.id ? x.a2 : x.a1)!);
        if (!subs.length || subs.length > 2) return null;
        // (substituents that are alike are no stereo: either could be told as the one)
        if (subs.length === 2 && sig.get(subs[0].id) === sig.get(subs[1].id)) return null;
        const n = subs.length === 1 ? subs[0] : sig.get(subs[0].id)! < sig.get(subs[1].id)! ? subs[0] : subs[1];
        return Math.sign((to.x - from.x) * (n.y - from.y) - (to.y - from.y) * (n.x - from.x));
      };
      const p = side(u, v), q = side(v, u);
      // (seen from each end the axis runs the other way, so the same side is the opposite sign)
      return p && q ? (p === -q ? 'c' : 't') : '';
    };
    const atoms = frag.map((x) => sig.get(x.id)).sort().join(',');
    const joins = bonds.map((b) => {
      const p = sig.get(b.a1)!, q = sig.get(b.a2)!;
      return DIRECTED.has(b.display) ? `${p}${b.order}${b.display}>${q}` : `${[p, q].sort().join(`${b.order}${b.display}${geometry(b)}`)}`;
    }).sort().join(',');
    out.push({ key: `${atoms}|${joins}`, x: frag.reduce((s, x) => s + x.x, 0) / frag.length, y: frag.reduce((s, x) => s + x.y, 0) / frag.length });
  }
  return out;
}

/** The things on a slide that are compared by what they are: pictures (by their image), charts (by their data), other shapes. */
function shapeKey(s: Shape): string {
  if (s.chart) return `chart:${JSON.stringify(s.chart.chart)}:${JSON.stringify(s.chart.cells)}`;
  if (s.math) return `math:${s.math.tex}`;
  if (s.kind === 'picture') return `picture:${s.src?.length}:${s.src?.slice(-64)}`;
  if (s.kind === 'table') return `table:${JSON.stringify(s.table)}`;
  const { id: _i, x1: _a, y1: _b, x2: _c, y2: _d, z: _z, ...look } = s;
  return `shape:${JSON.stringify(look)}`;
}

const shapeName = (key: string) => (key.startsWith('chart:') ? 'Chart' : key.startsWith('math:') ? 'Equation' : key.startsWith('picture:') ? 'Picture' : key.startsWith('table:') ? 'Table' : 'Shape');

/**
 * Take out what both lists have (by key), and say what is left: added, removed, or (paired in
 * order) changed; things in both that moved are counted.
 */
function diffLists<T extends { key: string; x: number; y: number; w?: number; h?: number }>(a: T[], b: T[], name: (t: T) => string, changed: (x: T, y: T) => string, worded?: (t: T, how: 'added' | 'removed') => string): { lines: string[]; moved: number; resized: number } {
  const left = [...b];
  const gone: T[] = [];
  let moved = 0, resized = 0;
  for (const x of a) {
    const k = left.findIndex((y) => y.key === x.key);
    if (k < 0) { gone.push(x); continue; }
    const y = left.splice(k, 1)[0];
    if (Math.hypot(x.x - y.x, x.y - y.y) > 2) moved++;
    // a picture or shape made bigger or smaller (about its centre, or from a corner) is the same thing at the same place, but changed
    if (Math.abs((x.w ?? 0) - (y.w ?? 0)) > 2 || Math.abs((x.h ?? 0) - (y.h ?? 0)) > 2) resized++;
  }
  const lines: string[] = [];
  const both = Math.min(gone.length, left.length);
  for (let k = 0; k < both; k++) lines.push(changed(gone[k], left[k]));
  // `worded` makes the whole line (so no wording is found again by pattern in the text itself)
  for (const x of gone.slice(both)) lines.push(worded ? worded(x, 'removed') : `${name(x)} removed`);
  for (const y of left.slice(both)) lines.push(worded ? worded(y, 'added') : `${name(y)} added`);
  return { lines, moved, resized };
}

/** What differs between two versions of a slide, line by line (none when they are the same). */
export function slideDifferences(a: SlideView, b: SlideView): string[] {
  const out: string[] = [];
  const ta = slideTitle(a.contents), tb = slideTitle(b.contents);
  if (ta !== tb) out.push(ta && tb ? `Title changed: ${quote(ta)} → ${quote(tb)}` : tb ? `Title added: ${quote(tb)}` : `Title removed: ${quote(ta)}`);
  if (a.layout !== b.layout) out.push('Layout changed');
  // text (other than the title), and how it looks
  const texts = (c: Contents) => c.captions.filter((x) => x.ph !== 'title' && plain(x)).map((x) => ({ key: plain(x), x: x.x, y: x.y, look: JSON.stringify(x.runs.map(({ text: _t, ...r }) => r)) }));
  const ca = texts(a.contents), cb = texts(b.contents);
  const t = diffLists(ca, cb, (x) => `Text ${quote(x.key)}`, (x, y) => `Text changed: ${quote(x.key)} → ${quote(y.key)}`, (x, how) => `Text ${how}: ${quote(x.key)}`);
  out.push(...t.lines);
  const restyled = ca.filter((x) => cb.some((y) => y.key === x.key && y.look !== x.look)).length;
  if (restyled) out.push(`Text formatting changed (${restyled} text box${restyled > 1 ? 'es' : ''})`);
  // structures
  const s = diffLists(structureKeys(a.contents), structureKeys(b.contents), () => 'Structure', () => 'Structure changed');
  out.push(...s.lines);
  // pictures, charts, tables, shapes
  const shapes = (c: Contents) => c.shapes.filter((x) => !x.ring && !x.pin).map((x) => ({ key: shapeKey(x), x: (x.x1 + x.x2) / 2, y: (x.y1 + x.y2) / 2, w: Math.abs(x.x2 - x.x1), h: Math.abs(x.y2 - x.y1) }));
  const sh = diffLists(shapes(a.contents), shapes(b.contents), (x) => shapeName(x.key), (x, y) => (shapeName(x.key) === shapeName(y.key) ? `${shapeName(x.key)} changed` : `${shapeName(x.key)} replaced by a ${shapeName(y.key).toLowerCase()}`));
  out.push(...sh.lines);
  const arrows = (c: Contents) => c.arrows.length;
  if (arrows(a.contents) !== arrows(b.contents)) out.push(`Arrows: ${arrows(a.contents)} → ${arrows(b.contents)}`);
  const moved = t.moved + s.moved + sh.moved;
  if (moved) out.push(`Moved: ${moved} thing${moved > 1 ? 's' : ''}`);
  if (sh.resized) out.push(`Resized: ${sh.resized} thing${sh.resized > 1 ? 's' : ''}`);
  if (a.notes.trim() !== b.notes.trim()) out.push('Speaker notes changed');
  return out;
}

/** The changes from this deck (`mine`) to another version (`theirs`), in this deck's order. */
export function compareDecks(mine: SlideView[], theirs: SlideView[]): SlideChange[] {
  const { pairs, onlyMine, onlyTheirs } = matchSlides(mine, theirs);
  const out: (SlideChange & { order: number })[] = [];
  for (const [i, j] of pairs) {
    const details = slideDifferences(mine[i], theirs[j]);
    if (details.length) out.push({ kind: 'changed', mine: i, theirs: j, title: slideTitle(theirs[j].contents) || slideTitle(mine[i].contents), details, order: i });
  }
  for (const i of onlyMine) out.push({ kind: 'deleted', mine: i, title: slideTitle(mine[i].contents), details: ['Slide deleted in the other version'], order: i });
  for (const { theirs: j, after } of onlyTheirs) {
    const what = slideTitle(theirs[j].contents);
    out.push({ kind: 'inserted', theirs: j, after, title: what, details: [`Slide inserted${what ? '' : ' (no title)'}`], order: after + 0.5 + j / 1e4 });
  }
  return out.sort((a, b) => a.order - b.order).map(({ order: _o, ...c }) => c as SlideChange);
}
