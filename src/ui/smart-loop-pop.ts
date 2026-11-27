// Small popouts from the + Add menu on a Smart Scheme's species list: Add Loop (how the new loop is
// joined to the cycle, where, and how many species it has), Add Off-Cycle Species (where, and
// whether it comes in, goes out, or is in equilibrium) and, for a scheme in a line, Add Branch
// (where, and whether it leads away or in). They share the Scheme Format popout's look.

import type { LoopJoin } from '../chem/smart-scheme';

interface Species { k: number; name: string }
interface Step { k: number; from: number; to: number; name: string }

export interface LoopAsk {
  species: Species[];
  /** The steps a loop can turn with (ones round a single loop). */
  steps: Step[];
  /** The species of each loop, in arrow order (a stretch runs along one of them). */
  loops: number[][];
  /** Where to start: the species (and step) the caret was in. */
  slot: number;
  step?: number;
}

let open: (() => void) | null = null;

/** Close a popout that is open. */
export function closeLoopPop(): void { open?.(); }

function popout<T>(anchor: HTMLElement, title: string, build: (pop: HTMLElement, row: (...cells: HTMLElement[]) => HTMLElement) => () => T | null, action = 'Add'): Promise<T | null> {
  open?.();
  return new Promise((resolve) => {
    const pop = document.createElement('div');
    pop.className = 'smart-format-pop smart-loop-pop';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', title);
    const head = document.createElement('div');
    head.className = 'sfp-head';
    const name = document.createElement('span');
    name.textContent = title;
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'sfp-x';
    x.textContent = '×';
    x.title = 'Close';
    head.append(name, x);
    pop.append(head);
    const row = (...cells: HTMLElement[]) => {
      const r = document.createElement('div');
      r.className = 'sfp-row';
      r.append(...cells);
      pop.append(r);
      return r;
    };
    const value = build(pop, row);
    const foot = document.createElement('div');
    foot.className = 'sfp-foot';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'primary';
    ok.textContent = action;
    foot.append(cancel, ok);
    pop.append(foot);
    document.body.append(pop);
    const a = anchor.getBoundingClientRect();
    const w = pop.offsetWidth, h = pop.offsetHeight;
    pop.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, a.left))}px`;
    pop.style.top = `${a.bottom + 4 + h > window.innerHeight - 8 ? Math.max(8, a.top - h - 4) : a.bottom + 4}px`;
    const done = (v: T | null) => {
      document.removeEventListener('pointerdown', outside, true);
      pop.remove();
      if (open === closeIt) open = null;
      resolve(v);
    };
    const closeIt = () => done(null);
    const outside = (e: PointerEvent) => { if (!pop.contains(e.target as Node)) done(null); };
    setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
    pop.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); done(null); anchor.focus(); }
      if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'BUTTON') { e.preventDefault(); const v = value(); if (v) done(v); }
    });
    x.addEventListener('click', closeIt);
    cancel.addEventListener('click', closeIt);
    ok.addEventListener('click', () => { const v = value(); if (v) done(v); });
    open = closeIt;
    pop.querySelector<HTMLElement>('select, input')?.focus();
  });
}

function labelled(text: string, tip: string, control: HTMLElement, wide = true): HTMLLabelElement {
  const lab = document.createElement('label');
  lab.className = `sfp-field${wide ? ' sfp-wide' : ''}`;
  lab.title = tip;
  const span = document.createElement('span');
  span.textContent = text;
  lab.append(span, control);
  return lab;
}

const speciesOption = (s: Species) => new Option(`${s.k + 1}  ${s.name}`, String(s.k));

/** Ask how a new loop joins the cycle. Null when closed without adding. */
export function askLoop(anchor: HTMLElement, o: LoopAsk): Promise<{ join: LoopJoin; count: number } | null> {
  return popout(anchor, 'Add Loop', (_pop, row) => {
    const kind = document.createElement('select');
    kind.append(new Option('Shares a species', 'share'), new Option('Shares a stretch of species', 'fused'), new Option('Turns with a step', 'mesh'), new Option('Beside the cycle', 'beside'));
    if (!o.steps.length) kind.options[2].disabled = true;
    kind.value = o.step !== undefined && o.steps.some((s) => s.k === o.step) ? 'mesh' : 'share';
    row(labelled('Join', 'How the new loop goes with the cycle', kind));

    const at = document.createElement('select');
    for (const s of o.species) at.append(speciesOption(s));
    at.value = String(o.slot);
    const atRow = row(labelled('Species', 'The species both loops go through, drawn once between them', at));

    const from = document.createElement('select'), to = document.createElement('select');
    for (const s of o.species) if (o.loops.some((lp) => lp.includes(s.k))) from.append(speciesOption(s));
    from.value = String(o.loops.some((lp) => lp.includes(o.slot)) ? o.slot : o.loops[0]?.[0] ?? 0);
    // the stretch runs on from its first species the way the arrows go, round one loop
    const fillTo = () => {
      const a = Number(from.value), was = to.value;
      to.replaceChildren();
      const seen = new Set<number>();
      for (const lp of o.loops) {
        const i = lp.indexOf(a);
        if (i < 0) continue;
        // (not all the way round: some of the loop is left for the loop already there)
        for (let k = 1; k < lp.length - 1; k++) {
          const b = lp[(i + k) % lp.length];
          if (seen.has(b)) continue;
          seen.add(b);
          const s = o.species.find((x) => x.k === b);
          if (s) to.append(speciesOption(s));
        }
      }
      if ([...to.options].some((x) => x.value === was)) to.value = was;
    };
    from.addEventListener('change', fillTo);
    fillTo();
    const stretchRow = row(labelled('From', 'The first species both loops go through', from, false), labelled('To', 'The last species both loops go through, the way the arrows go. The steps between are in both loops, drawn straight', to, false));

    const step = document.createElement('select');
    for (const s of o.steps) step.append(new Option(`${s.from + 1} → ${s.to + 1}${s.name ? `  ${s.name}` : ''}`, String(s.k)));
    if (o.step !== undefined && o.steps.some((s) => s.k === o.step)) step.value = String(o.step);
    const stepRow = row(labelled('Step', 'The step the new loop turns with, like two gears: one of its own steps faces this one', step));

    const count = document.createElement('input');
    count.type = 'number';
    count.min = '1';
    count.max = '12';
    count.value = '3';
    row(labelled('New species', 'How many species of its own the new loop has', count));

    const show = () => {
      atRow.hidden = kind.value !== 'share';
      stretchRow.hidden = kind.value !== 'fused';
      stepRow.hidden = kind.value !== 'mesh';
      count.min = kind.value === 'mesh' || kind.value === 'beside' ? '2' : '1';
    };
    kind.addEventListener('change', show);
    show();
    return () => {
      const n = Math.max(Number(count.min), Math.min(12, Math.round(Number(count.value) || 3)));
      const join: LoopJoin | null = kind.value === 'share' ? { kind: 'share', slot: Number(at.value) }
        : kind.value === 'fused' ? (to.value ? { kind: 'fused', from: Number(from.value), to: Number(to.value) } : null)
          : kind.value === 'mesh' ? (step.value ? { kind: 'mesh', link: Number(step.value) } : null)
            : { kind: 'beside' };
      return join ? { join, count: n } : null;
    };
  });
}

/**
 * Ask where a species off the cycle goes and which way its arrow points; with `line`, where a
 * branch joins a scheme that runs in a line and which way it leads. Null when closed without adding.
 */
export function askBranch(anchor: HTMLElement, o: { species: Species[]; slot: number; line?: boolean }): Promise<{ slot: number; dir: 'in' | 'out' | 'both' } | null> {
  return popout(anchor, o.line ? 'Add Branch' : 'Add Off-Cycle Species', (_pop, row) => {
    const at = document.createElement('select');
    for (const s of o.species) at.append(speciesOption(s));
    at.value = String(o.slot);
    row(labelled('At', o.line ? 'The species the branch is joined to' : 'The species of the cycle it is joined to', at));
    const dir = document.createElement('select');
    if (o.line) dir.append(new Option('Leads away', 'out'), new Option('Leads in', 'in'), new Option('In equilibrium', 'both'));
    else dir.append(new Option('Enters the cycle', 'in'), new Option('Leaves the cycle', 'out'), new Option('In equilibrium', 'both'));
    row(labelled('Direction', o.line
      ? 'Leads away: a side product, or another route from this species. Leads in: a second starting material, or a fragment made separately. In equilibrium: a species this one is in equilibrium with'
      : 'Enters: a precatalyst. Leaves: a deactivated species. In equilibrium: a resting state off the cycle', dir));
    return () => ({ slot: Number(at.value), dir: dir.value as 'in' | 'out' | 'both' });
  });
}
