// The tooltip that shows what an abbreviation or condensed label stands for (OTBS, Boc, CO2Me…)
// when the mouse rests on it: a small drawing of the group written out, with a wavy line where
// it joins, its full name and its formula. View > Group Tooltips turns it off.

import { labelTip, type LabelTip } from '../chem/label-tip';

/** How long the mouse rests on a label before the tooltip shows (ms). */
const DELAY = 450;

export interface TipTarget {
  /** The label's text. */
  label: string;
  /** Order of each bond from the label to the structure. */
  ext: number[];
  /** Where the mouse is, in window coordinates. */
  x: number;
  y: number;
}

export class LabelTooltip {
  enabled = true;
  private el: HTMLDivElement;
  private timer = 0;
  private key = '';
  private pictures = new Map<string, Promise<HTMLCanvasElement | null>>();

  /** @param draw makes the drawing of a group from its SMILES (null when it can't). */
  constructor(private draw: (tip: LabelTip) => Promise<HTMLCanvasElement | null>) {
    this.el = document.createElement('div');
    this.el.className = 'label-tip';
    this.el.hidden = true;
    this.el.setAttribute('role', 'tooltip');
    document.body.append(this.el);
  }

  /** The mouse is over this label (or over nothing that has one). */
  over(t: TipTarget | null): void {
    if (!this.enabled || !t) { this.hide(); return; }
    const key = `${t.label}|${t.ext.join(',')}`;
    if (key === this.key) {
      if (this.el.hidden) return;
      return; // stays where it first showed, so it doesn't chase the mouse
    }
    this.hide();
    const tip = labelTip(t.label, t.ext);
    if (!tip) return;
    this.key = key;
    this.timer = window.setTimeout(() => void this.show(tip, t, key), DELAY);
  }

  hide(): void {
    window.clearTimeout(this.timer);
    this.key = '';
    this.el.hidden = true;
  }

  private async show(tip: LabelTip, t: TipTarget, key: string): Promise<void> {
    let pic = this.pictures.get(tip.smiles);
    if (!pic) {
      pic = this.draw(tip).catch(() => null);
      this.pictures.set(tip.smiles, pic);
    }
    const canvas = await pic;
    // (a drawing that couldn't be made, as the chemistry engine was not ready yet, is tried again next time)
    if (!canvas && this.pictures.get(tip.smiles) === pic) this.pictures.delete(tip.smiles);
    if (this.key !== key) return; // the mouse moved on while it was drawn
    this.el.replaceChildren();
    const head = document.createElement('div');
    head.className = 'label-tip-head';
    const b = document.createElement('b');
    b.textContent = t.label;
    head.append(b);
    if (tip.name) head.append(document.createTextNode(` = ${tip.name}`));
    this.el.append(head);
    if (canvas) {
      const img = document.createElement('img');
      img.src = canvas.toDataURL();
      const dpr = window.devicePixelRatio || 1;
      img.width = Math.round(canvas.width / dpr);
      img.height = Math.round(canvas.height / dpr);
      img.alt = tip.smiles;
      this.el.append(img);
    }
    const f = document.createElement('div');
    f.className = 'label-tip-formula';
    f.innerHTML = formulaHtml(tip.formula);
    this.el.append(f);
    this.el.hidden = false;
    // below and to the right of the mouse, kept inside the window
    const r = this.el.getBoundingClientRect();
    let x = t.x + 14, y = t.y + 18;
    if (x + r.width > window.innerWidth - 4) x = Math.max(4, t.x - r.width - 10);
    if (y + r.height > window.innerHeight - 4) y = Math.max(4, t.y - r.height - 10);
    this.el.style.left = `${x}px`;
    this.el.style.top = `${y}px`;
  }
}

/** A formula with its counts as subscripts and the charge as a superscript (a charge of more than one is the number after a space, C4H12N2 2+, or after a closing bracket, [Cu(NH3)4]2+). */
export function formulaHtml(formula: string): string {
  let body = formula, charge = '';
  const sign = /([+−-])$/.exec(formula);
  if (sign) {
    charge = sign[1];
    body = formula.slice(0, -1);
    const n = /(?:\s+(\d+)|\](\d+))$/.exec(body);
    if (n) {
      charge = (n[1] ?? n[2]) + charge;
      body = body.slice(0, n.index) + (n[2] ? ']' : '');
    }
  }
  body = body.replace(/[&<>]/g, '').replace(/(\d+)/g, '<sub>$1</sub>');
  return body + (charge ? `<sup>${charge}</sup>` : '');
}
