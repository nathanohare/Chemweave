// Insert > All Charts: every kind of chart in a pane, as the Styles pane shows the styles, each
// drawn from the cells selected (or from example numbers when nothing chartable is selected),
// so the right one can be picked by looking. Click one to insert it; the pane stays open to
// try another, and redraws when the selection changes.

import { FloatBox } from './float-box';
import { addInfo } from './info-tip';
import type { SheetView } from './sheet-view';
import type { Sheet } from '../sheet/workbook';
import { CHART_NAMES, chartData, chartFromRange, type ChartKind } from '../sheet/chart';
import { newChartBox, boxData } from '../sheet/chart-box';
import { chartCanvas } from '../render/chart-draw';
import { currentRegion } from './sheet-chart-ui';
import type { Range } from '../sheet/refs';

/** The kinds in groups, as Excel's Insert Chart window has them. */
const GROUPS: [string, ChartKind[]][] = [
  ['Common', ['scatter', 'line', 'column', 'bar']],
  ['Parts of a whole', ['pie', 'area', 'treemap']],
  ['Spread of values', ['histogram', 'box']],
  ['Several measures', ['combo', 'bubble', 'radar']],
  ['Flows and breakdowns', ['sankey', 'decomp']],
];

const W = 300, H = 186;

/** A chart button's tooltip: no article to get wrong (an area chart), and the name keeps its capitals. */
export function chartTip(k: ChartKind): string {
  return `Insert Chart: ${CHART_NAMES[k]}`;
}

export class ChartGallery {
  private box: FloatBox;
  private list: HTMLDivElement;
  private note: HTMLParagraphElement;

  constructor(private view: () => SheetView, private insert: (k: ChartKind) => void) {
    this.box = new FloatBox('Charts', () => {});
    this.box.el.classList.add('chart-gallery');
    this.box.el.querySelector<HTMLElement>('.fb-pin')?.setAttribute('hidden', '');
    addInfo(this.box.el.querySelector('.fb-title'), 'Each chart is drawn from the cells selected, with their header row. Click one to insert it. With no numbers selected, the charts use example numbers.');
    this.note = document.createElement('p');
    this.note.className = 'cg-note muted';
    this.list = document.createElement('div');
    this.list.className = 'cg-list';
    this.box.body.append(this.note, this.list);
  }

  get open(): boolean { return this.box.open; }

  toggle(near?: HTMLElement | null): void {
    if (this.box.open) { this.box.close(); return; }
    this.box.show(near);
    this.drawnFor = '\0';
    this.refresh();
  }

  /** The cells a chart would be made from, as Insert takes them (null: nothing to chart). */
  private source(): { sheet: Sheet; range: Range } | null {
    const v = this.view();
    const s = v.sheet;
    if (!s || s.dashboard) return null;
    let R = v.sel.range;
    if (R.r1 === R.r2 && R.c1 === R.c2) {
      if (s.value(R.r1, R.c1) === null) return null;
      const t = s.tableAt(R.r1, R.c1);
      R = t ? t.range : currentRegion(s, R.r1, R.c1);
    } else R = s.clip(R) ?? R;
    return R.r1 === R.r2 && R.c1 === R.c2 ? null : { sheet: s, range: R };
  }

  private drawnFor = '';
  /** The wait (ms) after the selection stops changing before the charts are drawn again. */
  private static readonly SETTLE_MS = 200;
  private settle = 0;
  /** Which drawing of the charts is current (an older one stops when a newer begins). */
  private round = 0;

  /**
   * Draw every kind again (from the selection as it is now); `ifMoved`: only when the selection
   * has changed, and then once it has stopped changing for a moment (dragging over thousands of
   * rows would draw them all at every step).
   */
  refresh(ifMoved = false): void {
    if (!this.box.open) return;
    const src = this.source();
    const key = src ? `${src.sheet.name}!${src.range.r1},${src.range.c1}:${src.range.r2},${src.range.c2}` : '';
    if (ifMoved && key === this.drawnFor) return;
    this.drawnFor = key;
    clearTimeout(this.settle);
    if (ifMoved) this.settle = window.setTimeout(() => this.draw(), ChartGallery.SETTLE_MS);
    else this.draw();
  }

  private draw(): void {
    if (!this.box.open) return;
    const src = this.source();
    const v = this.view();
    const round = ++this.round;
    // only the state is shown; how it works is behind the "i" on the title
    this.note.textContent = src ? '' : 'Using example numbers.';
    this.note.hidden = !!src;
    this.list.replaceChildren();
    // (the buttons come up at once, empty; each chart is drawn into its own a moment after the one before)
    const todo: (() => void)[] = [];
    for (const [name, kinds] of GROUPS) {
      const h = document.createElement('h3');
      h.textContent = name;
      const row = document.createElement('div');
      row.className = 'cg-row';
      for (const k of kinds) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'cg-item';
        b.title = chartTip(k);
        const blank = document.createElement('canvas');
        blank.className = 'cg-pic';
        const label = document.createElement('span');
        label.textContent = CHART_NAMES[k];
        b.append(blank, label);
        b.addEventListener('click', () => { this.insert(k); });
        row.append(b);
        todo.push(() => {
          let pic: HTMLCanvasElement | null = null;
          try {
            if (src && v.wb) {
              const c = { ...chartFromRange(src.sheet, src.range, k), w: W, h: H };
              pic = chartCanvas(c, chartData(v.wb, src.sheet, c), 1);
            }
          } catch { pic = null; }
          if (!pic) {
            const ex = newChartBox(k, W * 0.75, H * 0.75);
            pic = chartCanvas({ ...ex.chart, w: W, h: H }, boxData(ex), 1);
          }
          pic.className = 'cg-pic';
          blank.replaceWith(pic);
        });
      }
      this.list.append(h, row);
    }
    const some = () => {
      if (round !== this.round || !this.box.open) return;
      const t0 = performance.now();
      do todo.shift()!(); while (todo.length && performance.now() - t0 < 30);
      if (todo.length) setTimeout(some, 0);
    };
    some();
  }
}
