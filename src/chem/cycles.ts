// Catalytic cycles from scratch (the Smart Scheme gallery's Cycle layout and ready-made cycles): the species round a loop, an arrow
// for each step with its name inside the loop, and what comes in and goes out on small curved
// arrows outside it. Two loops can turn together where they meet at a step (a Pd and a Cu cycle,
// a photocatalyst and a nickel cycle), share a species (two pathways from one resting state),
// or sit side by side. The loops are laid out by Chemistry ▸ Arrange's catalytic cycle, and every
// step keeps its roles, so a single loop can be arranged again after its text is swapped for
// structures.

import type { Arrow, Caption, Doc, StepRoles } from '../model';
import type { Rect, Vec } from '../geom';
import { chemRuns } from '../text/chemtext';
import { selectionBox, type Measure } from '../editor/arrange';
import { applyArrange, planArrange, type Scope } from './scheme-arrange';

/** One step, from a species to the next: its name, short and in full, and what comes in and goes out. */
export interface CycleStep { short: string; name: string; inn: string; out: string }

export interface CycleLoop {
  /** The species, in order round the loop (text with _ and ^ markup). */
  stations: string[];
  /** Step k goes from station k to station k + 1 (the last back to the first). */
  steps: CycleStep[];
  /** Written in the middle (the catalyst). */
  middle?: string;
}

/**
 * How a second loop goes with the first. mesh: step `a` of the first and step `b` of the second
 * face each other and the loops turn opposite ways, like gears; share: station `a` of the first
 * is station `b` of the second, drawn once where the loops touch (a figure of eight); beside:
 * the second loop to the right of the first.
 */
export interface CycleJoin { kind: 'mesh' | 'share' | 'beside'; a: number; b: number }

/**
 * How loop `loop` goes with an earlier loop `to`. mesh, share and beside as CycleJoin (a counts
 * in loop `to`, b in loop `loop`); fused: `span` species in a row (two or more), and the steps
 * between them, are in both loops, starting at species `a` of `to` and species `b` of `loop`
 * (the stretch is drawn once, straight, between the loops; its names and steps are loop `to`'s).
 */
export interface CycleLink { kind: 'mesh' | 'share' | 'beside' | 'fused'; loop: number; to: number; a: number; b: number; span?: number }

/** A species off the cycle, joined to species `station` of loop `loop`: coming in, going out, or in equilibrium with it. */
export interface CycleBranch { loop: number; station: number; species: string; dir: 'in' | 'out' | 'both'; note?: string }

export interface CycleSpec {
  loops: CycleLoop[];
  /** Two loops: how the second goes with the first. */
  join?: CycleJoin;
  /** Any number of loops: one for each loop after the first (used instead of `join`). */
  joins?: CycleLink[];
  branches?: CycleBranch[];
}

export interface CycleLook {
  /** The first loop runs anticlockwise (clockwise by default). */
  anticlockwise?: boolean;
  /** Step names: short (OA), in full (oxidative addition), or none. */
  names: 'short' | 'full' | 'none';
  /** What comes in and goes out on small curved arrows (otherwise beside the step, outside the loop). */
  reagentArrows: boolean;
}

export interface CyclePreset { id: string; name: string; group: 'classic' | 'two' | 'blank'; blurb: string; spec: CycleSpec }

const st = (short: string, name: string, inn = '', out = ''): CycleStep => ({ short, name, inn, out });
const OA = (inn = 'Ar–X') => st('OA', 'oxidative addition', inn);
const RE = (out: string) => st('RE', 'reductive elimination', '', out);

/** The test set: classic cycles, then ones with two loops or two pathways drawn together. */
export const CYCLE_PRESETS: CyclePreset[] = [
  {
    id: 'suzuki', name: 'Suzuki–Miyaura coupling', group: 'classic', blurb: 'Pd(0)/Pd(II): oxidative addition, base exchange, transmetalation, reductive elimination.',
    spec: { loops: [{
      stations: ['L_nPd^0', 'L_nPd^{II}(Ar)X', 'L_nPd^{II}(Ar)OR', 'L_nPd^{II}(Ar)Ar′'],
      steps: [OA(), st('LE', 'ligand exchange', '^−OR', 'X^−'), st('TM', 'transmetalation', 'Ar′B(OH)2', 'ROB(OH)2'), RE('Ar–Ar′')],
      middle: 'Pd catalyst',
    }] },
  },
  {
    id: 'heck', name: 'Mizoroki–Heck reaction', group: 'classic', blurb: 'Neutral pathway: alkene binding, migratory insertion, β-hydride elimination, base.',
    spec: { loops: [{
      stations: ['Pd^0L_2', 'ArPd^{II}XL_2', 'ArPd^{II}XL(alkene)', 'RCH(Ar)CH_2Pd^{II}XL', 'HPd^{II}XL_2'],
      steps: [OA(), st('—', 'alkene coordination', 'RCH=CH_2', 'L'), st('MI', 'migratory insertion'), st('β-H', 'β-hydride elimination', 'L', 'ArCH=CHR'), st('—', 'base', 'base', 'base·HX')],
    }] },
  },
  {
    id: 'buchwald', name: 'Buchwald–Hartwig amination', group: 'classic', blurb: 'Oxidative addition, amine binding and deprotonation, reductive elimination.',
    spec: { loops: [{
      stations: ['LPd^0', 'LPd^{II}(Ar)X', 'LPd^{II}(Ar)NR_2'],
      steps: [OA(), st('—', 'amine binding, deprotonation', 'HNR_2, base', 'base·HX'), RE('Ar–NR_2')],
    }] },
  },
  {
    id: 'wilkinson', name: 'Wilkinson hydrogenation', group: 'classic', blurb: 'Rh(I)/Rh(III): H₂ addition, alkene binding, insertion, reductive elimination.',
    spec: { loops: [{
      stations: ['RhCl(PPh_3)_2', 'RhH_2Cl(PPh_3)_2', 'RhH_2Cl(PPh_3)_2(alkene)', 'RhHCl(alkyl)(PPh_3)_2'],
      steps: [OA('H_2'), st('—', 'alkene coordination', 'alkene'), st('MI', 'migratory insertion'), RE('alkane')],
      middle: 'RhCl(PPh3)3',
    }] },
  },
  {
    id: 'metathesis', name: 'Olefin metathesis (Chauvin)', group: 'classic', blurb: 'Metal alkylidene and metallacyclobutane, by [2+2] and retro-[2+2] steps.',
    spec: { loops: [{
      stations: ['[M]=CHR^1', 'metallacyclobutane', '[M]=CH_2', 'metallacyclobutane′'],
      steps: [st('[2+2]', '[2+2] cycloaddition', 'CH_2=CHR^2'), st('r[2+2]', 'retro-[2+2]', '', 'R^1CH=CHR^2'), st('[2+2]', '[2+2] cycloaddition', 'CH_2=CHR^1'), st('r[2+2]', 'retro-[2+2]', '', 'CH_2=CH_2')],
    }] },
  },
  {
    id: 'monsanto', name: 'Monsanto acetic acid process', group: 'classic', blurb: 'Rh(I)/Rh(III) carbonylation of methanol (Cativa uses Ir in the same way).',
    spec: { loops: [{
      stations: ['[Rh(CO)_2I_2]^−', '[CH_3Rh(CO)_2I_3]^−', '[CH_3CORh(CO)I_3]^−', '[CH_3CORh(CO)_2I_3]^−'],
      steps: [OA('CH_3I'), st('MI', 'migratory insertion'), st('—', 'CO binding', 'CO'), RE('CH_3COI')],
    }] },
  },
  {
    id: 'sonogashira', name: 'Sonogashira coupling (Pd and Cu)', group: 'two', blurb: 'The palladium and copper cycles turn together at transmetalation.',
    spec: {
      loops: [
        { stations: ['Pd^0L_2', 'ArPd^{II}XL_2', 'ArPd^{II}(C≡CR)L_2'], steps: [OA(), st('TM', 'transmetalation'), RE('Ar–C≡CR')], middle: 'Pd' },
        { stations: ['CuX', 'CuC≡CR'], steps: [st('—', 'π-complex, deprotonation', 'H–C≡CR, base', 'base·HX'), st('TM', 'transmetalation')], middle: 'Cu' },
      ],
      join: { kind: 'mesh', a: 1, b: 1 },
    },
  },
  {
    id: 'wacker', name: 'Wacker oxidation (Pd and Cu)', group: 'two', blurb: 'Palladium oxidizes ethylene; copper(II) reoxidizes Pd(0), and O₂ reoxidizes copper.',
    spec: {
      loops: [
        {
          stations: ['PdCl_4^{2−}', '[PdCl_3(C_2H_4)]^−', 'PdCl_2(H_2O)(C_2H_4)', '[PdCl_2(CH_2CH_2OH)]^−', 'Pd^0'],
          steps: [st('—', 'alkene coordination', 'C_2H_4', 'Cl^−'), st('—', 'ligand exchange', 'H_2O', 'Cl^−'), st('—', 'hydroxypalladation', 'H_2O', 'H_3O^+'), st('β-H', 'β-hydride elimination', '', 'CH_3CHO, HCl, Cl^−'), st('—', 'reoxidation', '', '')],
          middle: 'Pd',
        },
        { stations: ['2 CuCl_2', '2 CuCl'], steps: [st('—', 'reoxidation'), st('—', 'air oxidation', '½ O_2, 2 HCl', 'H_2O')], middle: 'Cu' },
      ],
      join: { kind: 'mesh', a: 4, b: 0 },
    },
  },
  {
    id: 'photoredox', name: 'Ni/Ir metallaphotoredox', group: 'two', blurb: 'Decarboxylative arylation: the iridium photocatalyst and the nickel cycle meet at electron transfer.',
    spec: {
      loops: [
        {
          stations: ['Ni^0L_n', 'ArNi^{II}(X)L_n', 'ArNi^{III}(R)(X)L_n', 'Ni^IXL_n'],
          steps: [OA(), st('—', 'radical capture', 'R•'), RE('Ar–R'), st('SET', 'single-electron transfer')],
          middle: 'Ni',
        },
        {
          stations: ['Ir^{III}', '*Ir^{III}', 'Ir^{II}'],
          steps: [st('hν', 'excitation'), st('SET', 'single-electron transfer', 'RCO_2^−', 'CO_2, R•'), st('SET', 'single-electron transfer')],
          middle: 'photocatalyst',
        },
      ],
      join: { kind: 'mesh', a: 3, b: 2 },
    },
  },
  {
    id: 'heck-two', name: 'Neutral vs cationic Heck', group: 'two', blurb: 'Two pathways from Pd(0): losing L (aryl halides) or losing X⁻ (aryl triflates).',
    spec: {
      loops: [
        {
          stations: ['Pd^0L_2', 'ArPdXL_2', 'ArPdXL(alkene)', 'RPdXL', 'HPdXL_2'],
          steps: [OA('Ar–X'), st('—', 'alkene binding', 'alkene', 'L'), st('MI', 'migratory insertion'), st('β-H', 'β-hydride elimination', 'L', 'product'), st('—', 'base', 'base', 'base·HX')],
          middle: 'neutral',
        },
        {
          stations: ['Pd^0L_2', 'ArPd(OTf)L_2', '[ArPdL_2(alkene)]^+', '[RPdL_2]^+', '[HPdL_2]^+'],
          steps: [OA('Ar–OTf'), st('—', 'alkene binding', 'alkene', 'TfO^−'), st('MI', 'migratory insertion'), st('β-H', 'β-hydride elimination', '', 'product'), st('—', 'base', 'base', 'base·H^+')],
          middle: 'cationic',
        },
      ],
      join: { kind: 'share', a: 0, b: 0 },
    },
  },
  {
    id: 'ch-two', name: 'Pd(0)/Pd(II) vs Pd(II)/Pd(IV) C–H arylation', group: 'two', blurb: 'Two ways to arylate a C–H bond, side by side for comparison.',
    spec: {
      loops: [
        {
          stations: ['Pd^0L_n', 'ArPd^{II}X', 'ArPd^{II}Ar′'],
          steps: [OA(), st('CMD', 'C–H activation (CMD)', 'Ar′–H, base', 'base·HX'), RE('Ar–Ar′')],
          middle: 'Pd(0)/Pd(II)',
        },
        {
          stations: ['Pd^{II}X_2', 'Ar′Pd^{II}X', 'Ar′(Ar)Pd^{IV}X_2'],
          steps: [st('C–H', 'C–H activation', 'Ar′–H', 'HX'), st('Ox', 'oxidation', '[Ar_2I]^+X^−', 'ArI'), RE('Ar–Ar′')],
          middle: 'Pd(II)/Pd(IV)',
        },
      ],
      join: { kind: 'beside', a: 0, b: 0 },
    },
  },
  {
    id: 'blank', name: 'Blank cycle', group: 'blank', blurb: 'Four species and four steps to fill in.',
    spec: { loops: [{ stations: ['Catalyst', 'Intermediate 1', 'Intermediate 2', 'Intermediate 3'], steps: [st('', 'Step 1'), st('', 'Step 2'), st('', 'Step 3'), st('', 'Step 4')], middle: '' }] },
  },
];

/** A blank cycle of `n` species to fill in (four when fewer than two are asked for). */
export function blankCycle(n = 0): CycleSpec {
  const count = n >= 2 ? Math.min(n, 12) : 4;
  return { loops: [{
    stations: Array.from({ length: count }, (_, k) => (k === 0 ? 'Catalyst' : `Intermediate ${k}`)),
    steps: Array.from({ length: count }, (_, k) => st('', `Step ${k + 1}`)),
    middle: '',
  }] };
}

export { STEP_NAMES, shortName } from './step-names';
import { shortName } from './step-names';

export interface BuiltCycle {
  captions: number[];
  arrows: number[];
  /** The box round all of it. */
  box: Rect | null;
}

/** A spec's joins, one for each loop after the first (the two-loop form `join` read as the second loop joined to the first). */
export function joinsOf(spec: CycleSpec): CycleLink[] {
  if (spec.joins) return spec.joins;
  return spec.join && spec.loops.length > 1 ? [{ ...spec.join, loop: 1, to: 0 }] : [];
}

/**
 * Draw the cycle with its middle at `at`. Selected structures (or captions) in `stations`
 * stand for the first loop's species, in order, instead of new text. One undoable step.
 */
export function buildCycle(doc: Doc, m: Measure, spec: CycleSpec, look: CycleLook, at: Vec, stations: { atoms: number[]; caption?: number }[] = []): BuiltCycle {
  const L = doc.style.bondLength;
  const made: BuiltCycle = { captions: [], arrows: [], box: null };
  doc.edit('Catalytic Cycle', () => {
    const caption = (text: string, x: number, y: number): Caption => {
      const c = doc.addCaption({ x, y, runs: chemRuns(text), justify: 'center' });
      made.captions.push(c.id);
      return c;
    };
    const arrowLook = (): Omit<Arrow, 'id' | 'tail' | 'head'> => ({
      headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'solid', noGo: false, equilibrium: false, sweep: 0,
      headLength: doc.style.lineWidth * 10, headWidth: doc.style.lineWidth * 2.5,
    });
    const scope: Scope = { atoms: new Set(), captions: new Set(), shapes: new Set(), arrows: new Set() };
    const joins = joinsOf(spec).filter((j) => j.loop > 0 && j.loop < spec.loops.length && j.to >= 0 && j.to < j.loop);
    const joinOf = (li: number) => joins.find((j) => j.loop === li);
    const refs: string[][] = [];
    /** For each loop, the arrow of each step. */
    const stepArrows: number[][] = [];
    /** Steps beside a species two loops share: the far side of them is the other loop. */
    const crowded = (li: number, k: number, n: number): boolean => joins.some((j) => {
      const at0 = j.loop === li ? j.b : j.to === li ? j.a : -1;
      if (at0 < 0) return false;
      if (j.kind === 'mesh') return k === at0;
      if (j.kind === 'share') return k === at0 || (k + 1) % n === at0;
      // the steps into and out of a stretch two loops share
      return j.kind === 'fused' && (k === (at0 - 1 + n) % n || k === (at0 + Math.max(2, j.span ?? 2) - 1) % n);
    });
    spec.loops.forEach((loop, li) => {
      const y = li * 12 * L;
      const j = joinOf(li);
      const n = loop.stations.length;
      // the species a loop takes from the one it is joined to: one shared, or a stretch of them
      const span = j?.kind === 'fused' ? Math.max(2, Math.min(j.span ?? 2, n, spec.loops[j.to].stations.length)) : j?.kind === 'share' ? 1 : 0;
      const theirs = (k: number): string | null => {
        if (!j || !span) return null;
        const d = (k - j.b + n) % n;
        const from = refs[j.to];
        return d < span ? from[(j.a + d) % from.length] : null;
      };
      // the species in a row to start with (the layout puts them round the loop)
      const ref: string[] = loop.stations.map((text, k) => {
        const shared = theirs(k);
        if (shared) return shared;
        const given = li === 0 ? stations[k] : undefined;
        if (given?.atoms.length) { for (const a of given.atoms) scope.atoms.add(a); return 'a' + Math.min(...given.atoms); }
        if (given?.caption !== undefined) { scope.captions.add(given.caption); return 'c' + given.caption; }
        const c = caption(text.trim() || '…', k * 6 * L, y);
        scope.captions.add(c.id);
        return 'c' + c.id;
      });
      const arrows: number[] = [];
      loop.steps.slice(0, n).forEach((s, k) => {
        // a step in a stretch two loops share is the first loop's
        if (j?.kind === 'fused' && theirs(k) && theirs((k + 1) % n) && (k - j.b + n) % n < span - 1) {
          const from = stepArrows[j.to];
          arrows.push(from[(j.a + ((k - j.b + n) % n)) % from.length]);
          return;
        }
        const x = k * 6 * L + 3 * L;
        const roles: StepRoles = { reactants: [ref[k]], products: [ref[(k + 1) % n]], above: [], below: [] };
        const word = look.names === 'short' ? s.short || shortName(s.name) : look.names === 'full' ? s.name : '';
        // a dash stands for a step with no short name
        if (word && word !== '—') { const c = caption(word, x, y + L); roles.inside = ['c' + c.id]; scope.captions.add(c.id); }
        // beside a species two loops share, outside the loop is the other loop: what comes in
        // and goes out there is written inside under the step's name (by the layout), as + and −
        const mark = crowded(li, k, n);
        if (s.inn) { const c = caption((mark ? '+ ' : '') + s.inn, x, y - L); roles.above.push('c' + c.id); scope.captions.add(c.id); }
        if (s.out) { const c = caption((mark ? '− ' : '') + s.out, x, y + 2 * L); roles.below.push('c' + c.id); scope.captions.add(c.id); }
        const r = doc.addArrow({ ...arrowLook(), tail: { x: x - 1.5 * L, y }, head: { x: x + 1.5 * L, y }, step: roles });
        made.arrows.push(r.id);
        scope.arrows.add(r.id);
        arrows.push(r.id);
      });
      if (loop.middle) scope.captions.add(caption(loop.middle, (n - 1) * 3 * L, y - 3 * L).id);
      refs.push(ref);
      stepArrows.push(arrows);
    });
    // species off the cycle: a precatalyst coming in, a product or resting state going out
    (spec.branches ?? []).forEach((b, bi) => {
      const on = refs[b.loop]?.[b.station];
      if (!on) return;
      const x = bi * 8 * L, y = -14 * L;
      const c = caption(b.species.trim() || '…', x, y);
      scope.captions.add(c.id);
      const roles: StepRoles = b.dir === 'in' ? { reactants: ['c' + c.id], products: [on], above: [], below: [] } : { reactants: [on], products: ['c' + c.id], above: [], below: [] };
      if (b.note) { const t = caption(b.note, x + 3 * L, y - L); roles.above.push('c' + t.id); scope.captions.add(t.id); }
      const r = doc.addArrow({ ...arrowLook(), ...(b.dir === 'both' ? { headStyle: 'halfLeft' as const, tailStyle: 'halfLeft' as const, equilibrium: true } : {}), tail: { x: x + 1.5 * L, y }, head: { x: x + 4.5 * L, y }, step: roles });
      made.arrows.push(r.id);
      scope.arrows.add(r.id);
    });

    // lay it out: the first loop clockwise (or as asked), each joined loop the other way from the one it joins
    const sign = look.anticlockwise ? -1 : 1;
    const n0 = refs[0].length;
    const turn = (k: number) => sign * (2 * Math.PI * k) / n0;
    // the first loop turned so that what joins it first is on its right
    const j1 = joins.find((j) => j.to === 0 && j.kind !== 'beside');
    const startAngle = !j1 ? -Math.PI / 2 : j1.kind === 'mesh' ? -turn(j1.a + 0.5) : j1.kind === 'share' ? -turn(j1.a) : -turn(j1.a + ((j1.span ?? 2) - 1) / 2);
    const meshes = joins.flatMap((j): [number, number][] => (j.kind === 'mesh' && stepArrows[j.to]?.[j.a] !== undefined && stepArrows[j.loop]?.[j.b] !== undefined ? [[stepArrows[j.to][j.a], stepArrows[j.loop][j.b]]] : []));
    const plan = planArrange(doc, m, scope, { kind: 'cycle', anticlockwise: !!look.anticlockwise, reagentArrows: look.reagentArrows, start: refs[0][0], startAngle, meshes });
    if (plan) {
      const added = applyArrange(doc, m, plan, 'Catalytic Cycle');
      made.arrows.push(...added);
      for (const id of added) scope.arrows.add(id);
    }
    // the whole thing, with its middle where it was asked for
    const b = selectionBox(doc, scopeSel(scope), m);
    if (b) {
      const d = { x: at.x - (b.x1 + b.x2) / 2, y: at.y - (b.y1 + b.y2) / 2 };
      moveScope(doc, scope, d);
      made.box = { x1: b.x1 + d.x, y1: b.y1 + d.y, x2: b.x2 + d.x, y2: b.y2 + d.y };
    }
  });
  made.captions = made.captions.filter((id) => doc.captions.has(id));
  made.arrows = made.arrows.filter((id) => doc.arrows.has(id));
  return made;
}

const scopeSel = (s: Scope) => {
  const bonds = new Set<number>();
  return { atoms: s.atoms, bonds, captions: s.captions, arrows: s.arrows, shapes: s.shapes };
};

function moveScope(doc: Doc, s: Scope, d: Vec): void {
  if (Math.hypot(d.x, d.y) < 1e-9) return;
  doc.moveAtoms(s.atoms, d.x, d.y);
  for (const id of s.captions) { const c = doc.captions.get(id); if (c) doc.updateCaption(id, { x: c.x + d.x, y: c.y + d.y }); }
  for (const id of s.arrows) {
    const r = doc.arrows.get(id);
    if (r) doc.updateArrow(id, { tail: { x: r.tail.x + d.x, y: r.tail.y + d.y }, head: { x: r.head.x + d.x, y: r.head.y + d.y } });
  }
}
