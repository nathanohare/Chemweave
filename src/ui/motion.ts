// The interface's motion: one set of timings for every animation, and the Animations setting
// (Settings ▸ Preferences: Off, Fast or Normal) that controls them all (UI style guide S91 to S97).
//
// The style sheet reads the timings from CSS variables (--m-short, --m-toggle, --m-std, --m-large,
// --m-hi and the curves --ease-out, --ease-in) that change with `data-motion` on the page's root;
// scripted animations read the same values here, so the two never disagree. Off sets every
// duration to zero: nothing moves and nothing waits. A highlight still shows when Off, for the
// same time, and disappears without fading.
//
// With no choice made, the desktop app starts on Fast and the web app on Off; either starts on Off
// when the system asks for reduced motion.

import { isTauri } from '@tauri-apps/api/core';

export type MotionLevel = 'off' | 'fast' | 'normal';
export type MotionTime = 'short' | 'toggle' | 'std' | 'large';

/** The Fast timings, in ms. Normal is 1.5 times these; Off is 0. */
export const FAST_MS: Readonly<Record<MotionTime, number>> = { short: 80, toggle: 96, std: 120, large: 180 };
/** How long a highlight on something that just changed lasts, at every level (ms). */
export const HIGHLIGHT_MS = 600;
/** Normal's timings against Fast's. */
export const NORMAL_SCALE = 1.5;
/** Ease-out (cubic) for anything appearing or moving; ease-in for anything leaving. */
export const EASE_OUT = 'cubic-bezier(0.215, 0.61, 0.355, 1)';
export const EASE_IN = 'cubic-bezier(0.55, 0.055, 0.675, 0.19)';

const LEVELS: readonly MotionLevel[] = ['off', 'fast', 'normal'];
export const isMotionLevel = (v: unknown): v is MotionLevel => typeof v === 'string' && (LEVELS as readonly string[]).includes(v);

/** The level chosen in Preferences (null: none chosen, follow the app and the system). */
let chosen: MotionLevel | null = null;

function reducedBySystem(): boolean {
  try { return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

function desktopApp(): boolean {
  try { return isTauri(); } catch { return false; }
}

/** The level used when none is chosen: Off when the system asks for reduced motion, else Fast in the desktop app and Off on the web. */
export function automaticMotion(reduced = reducedBySystem(), desktop = desktopApp()): MotionLevel {
  return reduced || !desktop ? 'off' : 'fast';
}

/** The level used when none is chosen, worked out once and again when the system's setting changes. */
let automatic: MotionLevel | null = null;

/** The level in use now. */
export function motionLevel(): MotionLevel {
  return chosen ?? (automatic ??= automaticMotion());
}

/** The level chosen in Preferences, or null when it follows the app and the system. */
export function chosenMotion(): MotionLevel | null {
  return chosen;
}

/** Choose a level (null: automatic) and apply it to the page. */
export function setMotion(level: MotionLevel | null): void {
  chosen = level && isMotionLevel(level) ? level : null;
  applyMotion();
}

/** Put the level on the page's root, where the style sheet's timings read it. */
export function applyMotion(root: HTMLElement | null = typeof document !== 'undefined' ? document.documentElement : null): void {
  if (root) root.dataset.motion = motionLevel();
}

/** A duration in ms at the level in use (0 when Off). */
export function motionMs(t: MotionTime, level: MotionLevel = motionLevel()): number {
  if (level === 'off') return 0;
  return Math.round(FAST_MS[t] * (level === 'normal' ? NORMAL_SCALE : 1));
}

/** Animations are on (Fast or Normal). */
export const moving = (): boolean => motionLevel() !== 'off';

/** The ways things arrive, as Nate picked them (Chemweave Motion Choices, 2026-11-26). */
export type Entrance = 'fade' | 'rise' | 'slide-in-right' | 'slide-in-left';

const FRAMES: Record<Entrance, Keyframe[]> = {
  fade: [{ opacity: 0 }, { opacity: 1 }],
  rise: [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }],
  'slide-in-right': [{ opacity: 0, transform: 'translateX(24px)' }, { opacity: 1, transform: 'none' }],
  'slide-in-left': [{ opacity: 0, transform: 'translateX(-24px)' }, { opacity: 1, transform: 'none' }],
};

/**
 * Play an arrival on an element that has just been shown (opacity and transform only, S92). Does
 * nothing when Off, and never holds anything up: the element is usable at once.
 */
export function enter(el: Element | null | undefined, how: Entrance = 'fade', t: MotionTime = 'std'): Animation | null {
  if (el && !(el as HTMLElement).isConnected) return null;
  const d = motionMs(t);
  if (!el || !d || typeof (el as HTMLElement).animate !== 'function') return null;
  try {
    const a = (el as HTMLElement).animate(FRAMES[how], { duration: d, easing: EASE_OUT });
    if (how !== 'fade') arriving(el, a);
    return a;
  } catch { return null; }
}

const clear = (c: string): boolean => /^(transparent|rgba\(0, 0, 0, 0\))$/.test(c);
/**
 * The element paints the same background as what is behind it: fading it would only make that
 * background pulse, so it shows at once and what is on it fades (S99).
 */
function sameAsBehind(el: Element): boolean {
  const own = getComputedStyle(el).backgroundColor;
  if (clear(own)) return false;
  for (let up = el.parentElement; up; up = up.parentElement) {
    const b = getComputedStyle(up).backgroundColor;
    if (!clear(b)) return b === own;
  }
  return false;
}

/**
 * Fade in what was just put into a container that stays (a Settings page, a template category's
 * cards, a slide added to the list): its new contents, not the container, and never a background
 * that is the same as the one behind it.
 */
export function fadeContent(box: Element | null, depth = 3): void {
  if (!box || !moving()) return;
  let n = 0;
  const walk = (el: Element, d: number): void => {
    for (const c of el.children) {
      if (n >= 24) return;
      if (sameAsBehind(c)) { if (d > 1) walk(c, d - 1); continue; }
      n++;
      enter(c, 'fade');
    }
  };
  walk(box, depth);
}

/**
 * A whole new look (another mode, its colors, another theme) shows at once: for two frames no control
 * fades its color and no ribbon fades in, so the window never pulses (S99). Call it only when the look
 * really changes: it restyles the whole window twice.
 */
export function holdTransitions(root: HTMLElement | null = typeof document !== 'undefined' ? document.documentElement : null): void {
  if (!root || !moving()) return;
  root.dataset.mStill = '';
  requestAnimationFrame(() => {
    // (before the frame is drawn: the new ribbon's groups are there at once, not fading in)
    for (const r of document.querySelectorAll('.ribbon')) for (const a of r.getAnimations({ subtree: true })) { try { a.finish(); } catch { /* a repeating one */ } }
    requestAnimationFrame(() => { delete root.dataset.mStill; });
  });
}

// Something arriving by a move (a menu dropping, the File page or the Side Panel sliding in) is, for
// those few frames, the frame that fixed-position parts inside it are placed against: a submenu or a
// pop-up opened inside it then would show in the wrong place and jump. So the moment the pointer or
// the keyboard reaches into it, its arrival finishes (S99).
const moves = new Set<Element>();
function arriving(el: Element, a: Animation): void {
  moves.add(el);
  const done = (): void => { moves.delete(el); };
  a.addEventListener('finish', done);
  a.addEventListener('cancel', done);
}
const MOVING_ARRIVALS = new Set(['m-drop', 'm-from-left']);
if (typeof document !== 'undefined') {
  document.addEventListener('animationstart', (e) => { if (MOVING_ARRIVALS.has(e.animationName) && e.target instanceof Element) moves.add(e.target); }, true);
  const gone = (e: AnimationEvent): void => { if (e.target instanceof Element) moves.delete(e.target); };
  document.addEventListener('animationend', gone, true);
  document.addEventListener('animationcancel', gone, true);
  const reach = (e: Event): void => {
    if (!moves.size) return;
    const t = e.target as Node | null;
    for (const el of [...moves]) {
      if (!el.isConnected) { moves.delete(el); continue; }
      if (t && el.contains(t)) { for (const a of el.getAnimations()) { try { a.finish(); } catch { /* a repeating one */ } } moves.delete(el); }
    }
  };
  for (const type of ['pointerover', 'pointerdown', 'focusin', 'keydown']) document.addEventListener(type, reach, true);
}

/** How a scroll the app makes itself moves: gliding when animations are on, else a jump (S97). */
export const scrollBehavior = (): ScrollBehavior => (moving() ? 'smooth' : 'auto');

/** Fade in a folding section's contents: the first rows only, so a long list costs no more than a short one. */
export function fadeIn(els: Iterable<Element>, most = 24): void {
  let n = 0;
  for (const el of els) { if (n++ >= most) break; enter(el, 'fade'); }
}

/** Scroll an element into view, gliding there when animations are on (jumping to an item, S97). */
export function scrollToItem(el: Element | null | undefined, block: ScrollLogicalPosition = 'nearest'): void {
  if (!el) return;
  try { el.scrollIntoView({ block, inline: 'nearest', behavior: scrollBehavior() }); } catch { el.scrollIntoView(); }
}

// a folding section opened by a click (or Enter or Space) on its heading: its contents fade in. (A
// section that opens itself, or is drawn again open, shows at once: no fade each time a panel refreshes.)
if (typeof document !== 'undefined') {
  document.addEventListener('click', (e) => {
    const sum = (e.target as Element | null)?.closest?.('summary');
    const d = sum?.parentElement;
    if (!sum || !(d instanceof HTMLDetailsElement)) return;
    requestAnimationFrame(() => { if (d.open) fadeIn([...d.children].filter((c) => c !== sum)); });
  }, true);
}

// the system's setting changing while the app is open moves the automatic level with it
try {
  if (typeof matchMedia !== 'undefined') matchMedia('(prefers-reduced-motion: reduce)').addEventListener?.('change', () => { automatic = null; if (!chosen) applyMotion(); });
} catch { /* an older engine: read at start only */ }

applyMotion();
