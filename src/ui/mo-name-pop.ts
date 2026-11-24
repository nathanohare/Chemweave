// Typing over a name or title of an MO diagram where it stands on the page (double-click it, or
// right-click a level ▸ Rename Level): one line of rich text with subscript, superscript, σ, π
// and * beside it. Enter or a click elsewhere keeps it; Escape leaves the name as it was.

import { parseMarkup, toMarkup } from '../design/mo';
import { RichField } from './rich-field';

let open: { close(keep: boolean): void } | null = null;

/** Close the name being typed, keeping what was typed. */
export function closeMoName(): void { open?.close(true); }

/** Type over `markup` in a field at `at` (window coordinates: where the name is drawn); `apply` gets the new markup if it changed. */
export function editMoName(at: { left: number; top: number; width: number; height: number }, markup: string, label: string, apply: (markup: string) => void): void {
  open?.close(true);
  const pop = document.createElement('div');
  pop.className = 'mo-name-pop';
  pop.setAttribute('role', 'group');
  pop.setAttribute('aria-label', label);
  let ended = false;
  const close = (keep: boolean) => {
    if (ended) return;
    ended = true;
    open = null;
    const now = toMarkup(field.parts()).trim();
    pop.remove();
    document.removeEventListener('pointerdown', outside, true);
    if (keep && now !== markup.trim()) apply(now);
  };
  const bar = document.createElement('span');
  bar.className = 'mo-name-bar';
  // (the field reports its state while it is being made, before there is anything to show it on)
  let ready = false;
  const field: RichField = new RichField(parseMarkup(markup), {
    label, placeholder: 'Name', chem: () => false,
    done: () => close(true),
    onState: () => show(),
    keys: (e) => { if (e.key === 'Enter') { e.preventDefault(); close(true); return true; } if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(false); return true; } return false; },
  });
  ready = true;
  field.el.classList.add('mo-rich');
  const button = (html: string, title: string, run: () => void, fmt?: 'sub' | 'sup') => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mo-fmt';
    b.innerHTML = html;
    b.title = title;
    b.setAttribute('aria-label', title);
    if (fmt) b.dataset.fmt = fmt;
    // pressing a button keeps the caret where it is
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => { run(); show(); });
    bar.append(b);
  };
  button('X<sub>2</sub>', 'Subscript (Ctrl+=)', () => field.toggle('sub'), 'sub');
  button('X<sup>2</sup>', 'Superscript (Ctrl+Shift+=)', () => field.toggle('sup'), 'sup');
  for (const [c, name] of [['σ', 'sigma'], ['π', 'pi'], ['*', 'antibonding'], ['δ', 'delta'], ['φ', 'phi'], ['ψ', 'psi']]) button(c, `Insert ${c} (${name})`, () => field.insert(c));
  function show(): void {
    if (!ready) return;
    for (const b of bar.querySelectorAll<HTMLButtonElement>('[data-fmt]')) b.setAttribute('aria-pressed', String(field.state(b.dataset.fmt as 'sub' | 'sup')));
  }
  pop.append(field.el, bar);
  document.body.append(pop);
  const w = Math.max(90, at.width + 30);
  pop.style.left = `${Math.max(4, Math.min(window.innerWidth - w - 190, at.left - 5))}px`;
  pop.style.top = `${Math.max(4, at.top + at.height / 2 - 14)}px`;
  field.el.style.minWidth = `${w}px`;
  const outside = (e: PointerEvent) => { if (!pop.contains(e.target as Node)) close(true); };
  document.addEventListener('pointerdown', outside, true);
  open = { close };
  field.focusAll();
  show();
}
