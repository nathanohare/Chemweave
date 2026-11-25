// The plain pictures in the Canvas ribbon's Diagrams pane (canvas-ribbon.ts): one small line drawing
// of each kind of diagram, drawn here by hand, for looking over before picking one. Where the
// drawing code can draw the real thing at small size (the MO and d-orbital diagrams), main.ts
// draws it over these the first time the pane opens.
//
// Each is 80 × 50 units, in the ink color (currentColor) with its main line in the accent.

const pic = (body: string): string =>
  `<svg viewBox="0 0 80 50" width="80" height="50" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
/** The accent's line. */
const A = 'style="stroke: var(--accent)"';
/** Words on a picture. */
const word = (x: number, y: number, text: string, size = 7, anchor = 'middle'): string =>
  `<text x="${x}" y="${y}" font-size="${size}" text-anchor="${anchor}" fill="currentColor" stroke="none" font-family="system-ui, sans-serif">${text}</text>`;

export const DIAGRAM_THUMBS: Record<string, string> = {
  // a reaction coordinate: two barriers, an intermediate, product lower than start
  energy: pic(`<path d="M9 5v38h65"/><path ${A} stroke-width="1.6" d="M12 30h6c5 0 6-20 11-20s6 12 11 12 5-7 9-7 6 21 11 21h9"/>`
    + word(29, 7, '‡', 6)),
  // [ ]‡ round a structure with a partial bond
  ts: pic(`<path d="M22 8h-5v34h5M58 8h5v34h-5"/><path d="M28 30l8-8 8 4"/><path ${A} d="M44 26l8-8" stroke-dasharray="2 2"/>` + word(68, 11, '‡', 9)),
  // energy against dihedral angle: a three-fold barrier
  torsion: pic(`<path d="M9 5v38h65"/><path ${A} stroke-width="1.6" d="M11 12c4 0 6 26 10 26s6-14 10-14 6 14 10 14 6-26 10-26 6 26 10 26 6-12 10-12"/>`),
  // the front carbon's three bonds meeting in the middle, the back carbon's from the circle
  newman: pic(`<circle cx="40" cy="25" r="12"/><path ${A} stroke-width="1.6" d="M40 25V7M40 25l15.6 9M40 25l-15.6 9"/><path d="M50.4 19l7.8-4.5M29.6 19l-7.8-4.5M40 37v6"/>`),
  // two atoms' levels joined to the molecule's in the middle
  mo: pic(`<path d="M8 30h12M60 30h12"/><path ${A} stroke-width="1.6" d="M32 40h16M32 14h16"/><path d="M20 30l12 10M48 40l12-10M20 30l12-16M48 14l12 16" stroke-dasharray="1.6 1.6" stroke-width="0.9"/>`),
  // five d orbitals as one level, split into three below and two above
  dsplit: pic(`<path d="M6 25h7M15 25h7M24 25h7"/><path ${A} stroke-width="1.6" d="M44 33h7M53 33h7M62 33h7M49 15h7M58 15h7"/><path d="M31 25l13 8M31 25l18-10" stroke-dasharray="1.6 1.6" stroke-width="0.9"/>`),
  // a p orbital: two lobes, one shaded
  orbital: pic(`<path ${A} d="M40 25c-9-4-10-20 0-20s9 16 0 20z" fill="color-mix(in srgb, var(--accent) 30%, transparent)"/><path d="M40 25c-9 4-10 20 0 20s9-16 0-20z"/><circle cx="40" cy="25" r="1.4" fill="currentColor"/>`),
  // three boxes in a process with arrows between them
  diagram: pic(`<rect ${A} x="5" y="17" width="18" height="16" rx="2"/><rect ${A} x="31" y="17" width="18" height="16" rx="2"/><rect ${A} x="57" y="17" width="18" height="16" rx="2"/><path d="M24.5 25h5M27.5 23l2 2-2 2M50.5 25h5M53.5 23l2 2-2 2"/>`),
};
