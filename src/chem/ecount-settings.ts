// A metal's electron-count settings set by hand (Atom.ecount), checked the one way wherever they
// come from: the drawing (countElectrons), a CDXML file (readEcount) and our own clipboard format
// (clip-check.ts). Only whole numbers in range, and only ligand types that parseType reads, are
// kept; anything else is dropped, so that value is automatic again.

import type { ElectronCountSettings } from '../model';

/** A type code read back (L2X → l 2, x 1), or null when it isn't one. */
export function parseType(code: string): { l: number; x: number; z: number } | null {
  const m = /^(?:L(\d?))?(?:X(\d?))?(?:Z(\d?))?$/.exec(code);
  if (!m || !code) return null;
  const n = (k: string, d: string | undefined) => (code.includes(k) ? Number(d || 1) : 0);
  return { l: n('L', m[1]), x: n('X', m[2]), z: n('Z', m[3]) };
}

/** The range each number set by hand may have: oxidation states −4 to +9, charges −8 to +8, counts 2 to 30. */
export const ECOUNT_RANGE = { ox: [-4, 9], charge: [-8, 8], expect: [2, 30] } as const;

/**
 * A ligand type's key in ElectronCountSettings.types: the ligand's name and the type worked out
 * for it (Cl|X), so two ligands of one name (a bridging chloride's X and L, an amine's and an
 * amide's N) are set apart.
 */
export const typeKey = (name: string, auto: string): string => `${name}|${auto}`;

/** Settings set by hand with only what is sound kept (see above); null when nothing is. */
export function sanitizeEcount(v: unknown): ElectronCountSettings | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const out: ElectronCountSettings = {};
  if (o.types && typeof o.types === 'object' && !Array.isArray(o.types)) {
    const types: Record<string, string> = {};
    for (const [k, t] of Object.entries(o.types as Record<string, unknown>)) {
      if (k === '__proto__' || k.length > 200 || typeof t !== 'string' || t.length > 12 || !parseType(t)) continue;
      types[k] = t;
    }
    if (Object.keys(types).length) out.types = types;
  }
  for (const k of ['ox', 'charge', 'expect'] as const) {
    const x = o[k], [lo, hi] = ECOUNT_RANGE[k];
    if (typeof x === 'number' && Number.isInteger(x) && x >= lo && x <= hi) out[k] = x;
  }
  return Object.keys(out).length ? out : null;
}
