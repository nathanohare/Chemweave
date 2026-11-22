// Convert to Figure window (Document mode, a picture picked: Picture Format ▸ Convert to Figure,
// right-click, or the Compare card when a picture was read badly). The picture becomes an empty
// figure of its size in its place, to draw in by hand with the picture beside it. Here the drawing
// style is picked: the picture's own (measured from it, each value changeable) or the document's,
// each shown on one sample structure at one scale, so the difference in size shows too.

import type { DocStyle } from '../style';
import type { PictureLook, StyleChoice } from '../recognise/editable';
import { Doc } from '../model';
import { freeRing, placeRing, sprout } from '../chem/chemgeom';
import { recordPicture, pictureCanvas } from '../render/picture';
import { styleForLook } from './doc-make-editable';
import { infoIcon } from './info-tip';
import { showDialog } from './dialog-host';

export interface ConvertFigureWindow {
  /** The picture's look as measured (null: it couldn't be; `from` says how it was measured). */
  measuring: Promise<{ look: PictureLook; from: 'read' | 'lines' } | null>;
  style: DocStyle;
  initial: StyleChoice;
  /** Convert to Figure pressed: the style, and the look (with any values changed). */
  apply(choice: StyleChoice, look: PictureLook | null): void;
}

/** One sample structure in a drawing style: a ring with a wedged carbon bearing an amide, labels and a double bond. */
function sampleDoc(style: DocStyle): Doc {
  const doc = new Doc();
  doc.style = { ...style };
  doc.bulk(() => {
    const ring = placeRing(doc, freeRing({ x: 0, y: 0 }, 6, style.bondLength), { aromatic: true });
    const c = sprout(doc, ring[1]);
    sprout(doc, c.id, 1, 'hashWedge');
    const n = sprout(doc, c.id, 1, 'wedge', 7);
    const co = sprout(doc, n.id);
    sprout(doc, co.id, 2, 'solid', 8);
    sprout(doc, co.id, 1, 'solid', 8);
  });
  return doc;
}

/** The two samples drawn at one scale (`k` CSS pixels to the point, fitted to the larger), as canvases. */
function samples(styles: DocStyle[], w: number, h: number): HTMLCanvasElement[] {
  const dpr = window.devicePixelRatio || 1;
  const docs = styles.map(sampleDoc);
  const pics = docs.map((d) => recordPicture(d, 2));
  let k = 3;
  for (const p of pics) if (p) k = Math.min(k, (w - 16) / (p.box.x2 - p.box.x1), (h - 16) / (p.box.y2 - p.box.y1));
  return docs.map((d, i) => {
    const out = document.createElement('canvas');
    out.width = Math.round(w * dpr);
    out.height = Math.round(h * dpr);
    out.style.width = `${w}px`;
    out.style.height = `${h}px`;
    const g = out.getContext('2d');
    const p = pics[i];
    if (!g || !p) return out;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, out.width, out.height);
    const { canvas } = pictureCanvas(d, p, k * dpr * 72);
    const dw = (p.box.x2 - p.box.x1) * k * dpr, dh = (p.box.y2 - p.box.y1) * k * dpr;
    g.drawImage(canvas, (out.width - dw) / 2, (out.height - dh) / 2, dw, dh);
    return out;
  });
}

export function openConvertFigureWindow(o: ConvertFigureWindow): void {
  const d = document.createElement('dialog');
  d.className = 'ask convert-figure-dialog';
  d.setAttribute('aria-label', 'Convert to Figure');
  const form = document.createElement('form');
  form.method = 'dialog';
  form.noValidate = true;
  const h = document.createElement('h2');
  h.append('Convert to Figure ', infoIcon('The picture is replaced by an empty figure of the same size, in the same place (its wrapping and spacing kept, so nothing on the page moves), for you to draw in. The picture stays beside the figure while you draw, to copy, or to trace with Trace. Pick the style what you draw takes: the picture\'s own, measured from it (change any value and the preview follows), or the document\'s. Revert to Picture puts the picture back.'));

  const cards = document.createElement('div');
  cards.className = 'cf-cards';
  const card = (choice: StyleChoice, title: string) => {
    const fig = document.createElement('label');
    fig.className = 'cf-card';
    const head = document.createElement('span');
    head.className = 'cf-title';
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'cf-style';
    radio.value = choice;
    head.append(radio, ` ${title}`);
    const pv = document.createElement('span');
    pv.className = 'cf-preview';
    const vals = document.createElement('span');
    vals.className = 'cf-values';
    fig.append(head, pv, vals);
    cards.append(fig);
    return { fig, radio, pv, vals };
  };
  const mine = card('match', 'Original picture\'s style');
  const theirs = card('default', 'Document style');

  // the measured values, each changeable (points)
  const field = (label: string) => {
    const name = document.createElement('span');
    name.textContent = label;
    const box = document.createElement('span');
    const input = document.createElement('input');
    input.type = 'number';
    // (any value: a measured one may not be a whole number of steps, which would stop the window submitting)
    input.step = 'any';
    input.min = '0';
    input.disabled = true;
    box.append(input, ' pt');
    mine.vals.append(name, box);
    return input;
  };
  const bond = field('Bond length');
  const line = field('Line width');
  const label = field('Label size');
  const how = document.createElement('span');
  how.className = 'cf-how muted';
  how.textContent = 'Measuring the picture…';
  mine.vals.append(how);
  const r1 = (v: number, n = 1) => (Math.round(v * 10 ** n) / 10 ** n).toString();
  const ds = o.style;
  for (const [k, v] of [['Style', ds.name], ['Bond length', `${r1(ds.bondLength)} pt`], ['Line width', `${r1(ds.lineWidth, 2)} pt`], ['Label size', `${r1(ds.labelSize)} pt`]] as const) {
    const a = document.createElement('span');
    a.textContent = k;
    const b = document.createElement('span');
    b.textContent = v;
    theirs.vals.append(a, b);
  }

  const buttons = document.createElement('p');
  buttons.className = 'ask-buttons';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'Cancel';
  const ok = document.createElement('button');
  ok.type = 'submit';
  ok.className = 'primary';
  ok.textContent = 'Convert to Figure';
  buttons.append(cancel, ok);
  form.append(h, cards, buttons);
  d.append(form);

  let measured: PictureLook | null = null;
  const look = (): PictureLook | null => {
    if (!measured) return null;
    const n = (i: HTMLInputElement, was: number | null) => { const v = parseFloat(i.value); return Number.isFinite(v) && v > 0 ? v : was; };
    return { bondLength: n(bond, measured.bondLength) ?? measured.bondLength, lineWidth: n(line, measured.lineWidth), labelSize: n(label, measured.labelSize), ...(measured.preset && bond.value === r1(measured.bondLength) ? { preset: measured.preset } : {}) };
  };
  const choice = (): StyleChoice => (mine.radio.checked && measured ? 'match' : 'default');
  const redraw = () => {
    const l = look();
    const styles = l ? [styleForLook(ds, l), ds] : [ds];
    const [a, b] = samples(styles, 230, 120);
    if (l) { mine.pv.replaceChildren(a); theirs.pv.replaceChildren(b); }
    else { theirs.pv.replaceChildren(a); }
    mine.fig.classList.toggle('on', choice() === 'match');
    theirs.fig.classList.toggle('on', choice() === 'default');
  };
  mine.radio.checked = o.initial === 'match';
  theirs.radio.checked = !mine.radio.checked;
  mine.radio.disabled = true;
  for (const r of [mine.radio, theirs.radio]) r.addEventListener('change', redraw);
  for (const i of [bond, line, label]) i.addEventListener('input', () => { mine.radio.checked = true; redraw(); });

  let closed = false;
  const close = () => { closed = true; if (d.open) d.close(); d.remove(); };
  cancel.addEventListener('click', close);
  d.addEventListener('cancel', () => { closed = true; d.remove(); });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const c = choice(), l = look();
    close();
    o.apply(c, l);
  });
  showDialog(d);
  redraw();
  ok.focus();
  void o.measuring.then((got) => {
    if (closed) return;
    if (!got) {
      how.textContent = 'This picture couldn\'t be measured: use the document style, or draw and change the style later.';
      theirs.radio.checked = true;
      redraw();
      return;
    }
    measured = got.look;
    bond.value = r1(got.look.bondLength);
    line.value = got.look.lineWidth !== null ? r1(got.look.lineWidth, 2) : '';
    label.value = got.look.labelSize !== null ? r1(got.look.labelSize) : '';
    line.placeholder = label.placeholder = 'not measured';
    for (const i of [bond, line, label]) i.disabled = false;
    mine.radio.disabled = false;
    how.textContent = got.from === 'read' ? (got.look.preset ? `Measured from the picture: ${got.look.preset} at this size.` : 'Measured from the picture.') : 'Only the line width could be measured: the bond length is the document\'s. Change it to match the picture.';
    redraw();
  });
}
