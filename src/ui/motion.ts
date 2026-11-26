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

/** The level in use now. */
export function motionLevel(): MotionLevel {
  return chosen ?? automaticMotion();
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
  const d = motionMs(t);
  if (!el || !d || typeof (el as HTMLElement).animate !== 'function') return null;
  try { return (el as HTMLElement).animate(FRAMES[how], { duration: d, easing: EASE_OUT }); } catch { return null; }
}

/** How a scroll the app makes itself moves: gliding when animations are on, else a jump (S97). */
export const scrollBehavior = (): ScrollBehavior => (moving() ? 'smooth' : 'auto');

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
    requestAnimationFrame(() => { if (d.open) for (const c of d.children) if (c !== sum) enter(c, 'fade'); });
  }, true);
}

// the system's setting changing while the app is open moves the automatic level with it
try {
  if (typeof matchMedia !== 'undefined') matchMedia('(prefers-reduced-motion: reduce)').addEventListener?.('change', () => { if (!chosen) applyMotion(); });
} catch { /* an older engine: read at start only */ }

applyMotion();
