// Drawing focal points on screen (never printed or saved): the mark on each structure, and the
// preview shown while pointing at Align, Distribute and Arrange (where each structure would go).

import type { Vec } from '../geom';
import type { Doc } from '../model';
import { focusOf, type Unit } from './arrange';

/** How a focal point is marked. */
import type { FocalLook } from '../chem/focal';
export type { FocalLook };

/** The marks in the order Preferences lists them, with their names there. */
export const FOCAL_LOOKS: { look: FocalLook; name: string }[] = [
  { look: 'target', name: 'Target' }, { look: 'diamond', name: 'Diamond' }, { look: 'cross', name: 'Crosshair' }, { look: 'mass', name: 'Center of mass' },
];

/**
 * One mark at p. `own`: a focal point set by hand (solid); otherwise the default middle of the
 * box (hollow, dashed). `faint` draws it lighter (on a selected structure).
 */
export function drawFocalMark(ctx: CanvasRenderingContext2D, p: Vec, px: number, color: string, look: FocalLook, own: boolean, faint = false): void {
  ctx.save();
  ctx.globalAlpha = faint ? 0.55 : 1;
  ctx.lineWidth = 1.5 * px;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  // a light rim so the mark reads over bonds and text
  const halo = (draw: () => void) => {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 4 * px;
    draw();
    ctx.stroke();
    ctx.restore();
    draw();
  };
  if (!own) ctx.setLineDash([2 * px, 1.6 * px]);
  if (look === 'target') {
    const r = 7 * px;
    halo(() => { ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); });
    ctx.stroke();
    ctx.setLineDash([]);
    halo(() => {
      ctx.beginPath();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { ctx.moveTo(p.x + dx * (r - 2.5 * px), p.y + dy * (r - 2.5 * px)); ctx.lineTo(p.x + dx * (r + 3 * px), p.y + dy * (r + 3 * px)); }
    });
    ctx.stroke();
    if (own) { ctx.beginPath(); ctx.arc(p.x, p.y, 2 * px, 0, Math.PI * 2); ctx.fill(); }
  } else if (look === 'diamond') {
    const r = 6.5 * px;
    const path = () => { ctx.beginPath(); ctx.moveTo(p.x, p.y - r); ctx.lineTo(p.x + r, p.y); ctx.lineTo(p.x, p.y + r); ctx.lineTo(p.x - r, p.y); ctx.closePath(); };
    halo(path);
    if (own) { ctx.globalAlpha *= 0.85; ctx.fill(); } else ctx.stroke();
  } else if (look === 'mass') {
    // the center-of-mass sign: a circle in quarters, two opposite quarters filled
    const r = 6.5 * px;
    halo(() => { ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); });
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha *= own ? 1 : 0.45;
    for (const a0 of [-Math.PI / 2, Math.PI / 2]) {
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.arc(p.x, p.y, r, a0, a0 + Math.PI / 2); ctx.closePath(); ctx.fill();
    }
  } else {
    const r = 9 * px, g = 2.5 * px;
    halo(() => {
      ctx.beginPath();
      ctx.moveTo(p.x - r, p.y); ctx.lineTo(p.x - g, p.y); ctx.moveTo(p.x + g, p.y); ctx.lineTo(p.x + r, p.y);
      ctx.moveTo(p.x, p.y - r); ctx.lineTo(p.x, p.y - g); ctx.moveTo(p.x, p.y + g); ctx.lineTo(p.x, p.y + r);
    });
    ctx.stroke();
  }
  ctx.restore();
}

/** What pointing at a layout command would do: each unit and how far it would move. */
export interface LayoutPreview {
  units: Unit[];
  offsets: Vec[];
  /** The line the centers come onto (Align Center: a vertical line at x; Align Middle: across at y). */
  line?: { axis: 'x' | 'y'; at: number };
}

/**
 * The preview: each structure as a faint copy where it would go, its focal point there, and the
 * line they line up on.
 */
export function drawLayoutPreview(ctx: CanvasRenderingContext2D, doc: Doc, pv: LayoutPreview, px: number, color: string, look: FocalLook): void {
  ctx.save();
  // the copies: bonds as plain lines, captions, arrows and shapes as their boxes
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.45;
  ctx.lineWidth = Math.max(1.2 * px, doc.style.lineWidth);
  ctx.lineCap = 'round';
  pv.units.forEach((u, i) => {
    const d = pv.offsets[i];
    if (Math.hypot(d.x, d.y) < 1e-3) return;
    const atoms = new Set(u.atoms);
    ctx.beginPath();
    // the unit's own bonds, from its atoms (each once, from its first atom)
    for (const id of u.atoms) {
      for (const bid of doc.adj.get(id) ?? []) {
        const b = doc.bonds.get(bid);
        if (!b || b.a1 !== id || !atoms.has(b.a2)) continue;
        const p = doc.atoms.get(b.a1), q = doc.atoms.get(b.a2);
        if (!p || !q) continue;
        ctx.moveTo(p.x + d.x, p.y + d.y); ctx.lineTo(q.x + d.x, q.y + d.y);
      }
    }
    ctx.stroke();
    if (!u.atoms.length) {
      ctx.setLineDash([3 * px, 2 * px]);
      ctx.strokeRect(u.box.x1 + d.x, u.box.y1 + d.y, u.box.x2 - u.box.x1, u.box.y2 - u.box.y1);
      ctx.setLineDash([]);
    }
  });
  ctx.globalAlpha = 1;
  // the line they line up on
  if (pv.line) {
    const fs = pv.units.map((u, i) => { const f = focusOf(u); return { x: f.x + pv.offsets[i].x, y: f.y + pv.offsets[i].y }; });
    ctx.strokeStyle = color;
    ctx.lineWidth = px;
    ctx.setLineDash([4 * px, 3 * px]);
    ctx.beginPath();
    const pad = 12 * px;
    if (pv.line.axis === 'x') { const ys = fs.map((f) => f.y); ctx.moveTo(pv.line.at, Math.min(...ys) - pad); ctx.lineTo(pv.line.at, Math.max(...ys) + pad); }
    else { const xs = fs.map((f) => f.x); ctx.moveTo(Math.min(...xs) - pad, pv.line.at); ctx.lineTo(Math.max(...xs) + pad, pv.line.at); }
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
  // each focal point where it is now (faint) and where it would go
  pv.units.forEach((u, i) => {
    const f = focusOf(u), d = pv.offsets[i];
    const moved = Math.hypot(d.x, d.y) >= 1e-3;
    if (moved) drawFocalMark(ctx, f, px, color, look, !!u.focus, true);
    drawFocalMark(ctx, { x: f.x + d.x, y: f.y + d.y }, px, color, look, !!u.focus);
  });
}
