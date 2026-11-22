// Commands that cannot run are greyed out, with the reason in the tooltip (style guide S15, S85;
// retrospective audit G5-28). Each mode answers "why can't this command run now?" with a reason,
// null when it can, or undefined when it has no such check; this paints the menu items and
// ribbon buttons from that answer. Only items it greyed itself are given back, so items greyed
// for other reasons (Undo with nothing to undo, another mode's commands) are left alone.
// A greyed item is marked aria-disabled, not disabled, so it still takes focus (the arrow keys
// reach it in a menu) and a screen reader reads its reason; choosing it shows the reason instead
// of running it (each mode's command runner asks the same check first; review of F5, R03).

/**
 * Does a menu opening in this mode ask its checks lazily (a costly answer given only when already
 * known)? Drawing, slides and design: yes, the reaction steps are worked out when a submenu opens or
 * the pointer rests on the button. A sheet asks in full: its costliest check (Property Columns) takes
 * about 20 ms on 20,000 rows (review F5b-R05).
 */
export function menuAsksLazily(mode: string): boolean {
  return mode !== 'sheet';
}

/** A reason the command cannot run now, null when it can, undefined when it has no check. */
export type WhyNot = (cmd: string) => string | null | undefined;

const MARK = 'cantRun';       // data-cant-run: greyed by this module
const KEEP = 'canRunTitle';   // data-can-run-title: the tooltip from before

/** Grey out (or give back) each button whose command, read from `attr` (a data-* name such as
 *  'cmd' or 'sh'), cannot run now. The reason goes first in its tooltip, its usual tip after. */
export function paintCanRun(buttons: Iterable<HTMLButtonElement>, attr: string, why: WhyNot): void {
  for (const b of buttons) {
    const cmd = b.dataset[attr];
    if (!cmd) continue;
    const reason = why(cmd);
    if (reason === undefined) continue;
    if (reason) {
      if (b.dataset[MARK] === undefined) b.dataset[KEEP] = b.getAttribute('title') ?? '';
      const tip = b.dataset[KEEP];
      b.dataset[MARK] = '';
      b.setAttribute('aria-disabled', 'true');
      b.title = tip ? `${reason}\n\n${tip}` : reason;
    } else if (b.dataset[MARK] !== undefined) {
      unpaint(b);
    }
  }
}

/** Give back a button greyed by paintCanRun: enabled, with its own tooltip. */
function unpaint(b: HTMLButtonElement): void {
  const tip = b.dataset[KEEP] ?? '';
  delete b.dataset[MARK];
  delete b.dataset[KEEP];
  b.removeAttribute('aria-disabled');
  if (tip) b.title = tip; else b.removeAttribute('title');
}

/** Whether paintCanRun has greyed this button. */
export function cantRun(b: Element): boolean {
  return b instanceof HTMLElement && b.dataset[MARK] !== undefined;
}

/** Give back every button under `root` that paintCanRun greyed (when the mode changes). */
export function clearCanRun(root: ParentNode): void {
  for (const b of root.querySelectorAll<HTMLButtonElement>('button[data-cant-run]')) unpaint(b);
}
