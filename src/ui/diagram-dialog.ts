// Insert ▸ Diagram… (and Edit Diagram…): SmartArt-style diagrams from text. On the left the
// layouts (lists, processes, cycles, hierarchies…), in the middle the text (one item per line,
// Tab for a level down), on the right the diagram as it will look; below, its colours and look.

import {
  DIAGRAM_BY_ID, DIAGRAM_CATEGORIES, DIAGRAM_COLOURS, DIAGRAM_DEFAULTS, DIAGRAM_LAYOUTS, newDiagram,
  type DiagramColours, type DiagramData,
} from '../design/diagrams';
import { iconsLoaded, loadIcons } from '../design/icons';
import { colourButton } from './colour-picker';
import type { Doc } from '../model';
import { fromRows, rowsOf, sliceParts, withoutIcons, type DiagramRow } from '../design/diagram-rows';
import { labelFromParts, type LabelPart } from '../design/energy';
import type { RichField } from './rich-field';
import { nameFields } from './rich-names';

/** How the last diagram looked, so a new one starts the same way. */
let lastLook: Pick<DiagramData, 'colours' | 'accent' | 'rounded' | 'shadow'> & { layout: string } = { ...DIAGRAM_DEFAULTS, layout: 'process' };

export interface DiagramDialogOptions {
  /** The diagram drawn as an SVG picture (for the preview and the layout buttons). */
  preview(d: DiagramData): string;
  /** New diagrams' size as a part of each layout's usual size (smaller in documents). */
  scale: number;
  /** The drawing the diagram goes in: when given, the accent is chosen from its color menu (its colors and your palettes), as in the Style panel. */
  drawing?: Doc;
}

/** Ask for a diagram: a new one, or `editing` with its text and look to change. */
export function askDiagram(editing: DiagramData | null, o: DiagramDialogOptions): Promise<DiagramData | null> {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'ask diagram-dialog';
    d.setAttribute('aria-label', 'Diagram');
    const form = document.createElement('form');
    form.method = 'dialog';
    form.innerHTML = `<h2>${editing ? 'Edit Diagram' : 'Diagram'}</h2>
      <div class="dg-body">
        <div class="dg-layouts" role="listbox" aria-label="Layout"></div>
        <div class="dg-text">
          <div class="dg-text-head" data-info="One item per box: Enter starts the next, Tab moves an item a level down, Shift+Tab up. Formulas are subscripted automatically (CO2); the bar (or Ctrl+B, Ctrl+I, Ctrl+U, Ctrl+=, Ctrl+Shift+=) sets bold, italic, underline, subscript and superscript."><b>Text</b></div>
          <div class="dg-rows" role="group" aria-label="Text: one item per box"></div>
          <p class="muted small dg-blurb"></p>
        </div>
        <div class="dg-preview" aria-label="How it will look"></div>
      </div>
      <div class="dg-look">
        <label class="ask-row"><span>Colors</span><select name="colours"></select></label>
        <label class="ask-row"><span>Accent color</span><input name="accent" type="color" /></label>
        <label class="ask-row"><span>Text size</span><span class="energy-pair"><input name="size" type="number" min="4" max="96" step="0.5" placeholder="fit" aria-label="Text size in points (empty: as big as fits)" /> pt</span></label>
        <label class="ask-row"><span>Size</span><span class="energy-pair"><input name="w" type="number" min="40" step="any" aria-label="Width" /> × <input name="h" type="number" min="30" step="any" aria-label="Height" /> pt</span></label>
        <label class="ask-row ask-check"><input name="rounded" type="checkbox" /><span>Rounded corners</span></label>
        <label class="ask-row ask-check"><input name="shadow" type="checkbox" /><span>Shadow</span></label>
      </div>
      <p class="ask-buttons"><button type="button" data-act="cancel">Cancel</button> <button type="submit" class="primary">${editing ? 'Change' : 'Insert'}</button></p>`;
    const $ = <T extends Element>(q: string) => form.querySelector<T>(q)!;
    const rowsBox = $<HTMLDivElement>('.dg-rows');
    const coloursSel = $<HTMLSelectElement>('select[name=colours]');
    for (const [k, name] of DIAGRAM_COLOURS) coloursSel.append(new Option(name, k));
    const accent = $<HTMLInputElement>('input[name=accent]');
    const size = $<HTMLInputElement>('input[name=size]');
    const wIn = $<HTMLInputElement>('input[name=w]'), hIn = $<HTMLInputElement>('input[name=h]');
    const rounded = $<HTMLInputElement>('input[name=rounded]'), shadow = $<HTMLInputElement>('input[name=shadow]');
    const look = editing ?? newDiagram(lastLook.layout, null, lastLook, o.scale);
    let layout = look.layout;
    // the items as rows of rich text boxes (F8b), as the Energy Diagram window's names
    let rows: DiagramRow[] = rowsOf(look);
    let sample = !editing;
    const names = nameFields(() => { sample = false; later(); });
    rowsBox.before(names.bar);
    let fields: RichField[] = [];
    const rowOf = (parts: LabelPart[], level: number): DiagramRow => {
      const n = labelFromParts(parts.filter((p) => p.text));
      return { level, label: n.label, ...(n.rich ? { rich: n.rich } : {}) };
    };
    const showRows = (focus?: { i: number; at: number }) => {
      if (!rows.length) rows = [{ level: 0, label: '' }];
      fields = rows.map((row, i) => {
        const f = names.field({ label: row.label, ...(row.rich ? { rich: row.rich } : {}) }, `Item ${i + 1}`, (n) => {
          row.label = n.label;
          if (n.rich) row.rich = n.rich; else delete row.rich;
        }, { keys: (e, f) => rowKey(e, f, i) });
        f.el.classList.add('dg-row');
        f.el.style.marginLeft = `${row.level * 1.25}em`;
        f.el.addEventListener('paste', (e) => pasteLines(e, i));
        return f;
      });
      rowsBox.replaceChildren(...fields.map((f) => f.el));
      if (focus) { const f = fields[Math.max(0, Math.min(fields.length - 1, focus.i))]; f.el.focus(); f.select(focus.at); }
    };
    const edited = () => { sample = false; later(); };
    /** Enter, Tab, Shift+Tab, Backspace at the start, and the up and down arrows move between and change the rows. */
    const rowKey = (e: KeyboardEvent, f: RichField, i: number): boolean => {
      if (e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return false;
      const parts = f.parts() as LabelPart[];
      const len = parts.reduce((a, p) => a + p.text.length, 0);
      const [a, b] = f.selection() ?? [len, len];
      const row = rows[i];
      if (e.key === 'Enter' && !e.shiftKey) {
        rows.splice(i, 1, rowOf(sliceParts(parts, 0, a), row.level), rowOf(sliceParts(parts, b, len), row.level));
        showRows({ i: i + 1, at: 0 });
        edited();
        return true;
      }
      if (e.key === 'Tab') {
        Object.assign(row, rowOf(parts, Math.max(0, row.level + (e.shiftKey ? -1 : 1))));
        showRows({ i, at: a });
        edited();
        return true;
      }
      if (e.key === 'Backspace' && a === 0 && b === 0 && i > 0) {
        const prev = fields[i - 1].parts() as LabelPart[];
        const at = prev.reduce((x, p) => x + p.text.length, 0);
        rows.splice(i - 1, 2, rowOf([...prev, ...parts], rows[i - 1].level));
        showRows({ i: i - 1, at });
        edited();
        return true;
      }
      if (e.key === 'ArrowUp' && i > 0) { fields[i - 1].el.focus(); fields[i - 1].select(Math.min(a, fields[i - 1].text().length)); return true; }
      if (e.key === 'ArrowDown' && i < fields.length - 1) { fields[i + 1].el.focus(); fields[i + 1].select(Math.min(a, fields[i + 1].text().length)); return true; }
      return false;
    };
    /** Lines pasted into a row: the first goes in it, each of the others becomes a row (Tabs in front set its level). */
    const pasteLines = (e: ClipboardEvent, i: number) => {
      const t = e.clipboardData?.getData('text/plain') ?? '';
      if (!/\r?\n/.test(t)) return;
      e.preventDefault();
      const [first, ...more] = t.split(/\r?\n/);
      fields[i].insert(first);
      const base = rows[i].level;
      const added = more.filter((l) => l.trim()).map((l) => rowsOf({ text: l })[0]).map((r) => ({ ...r, level: base + r.level }));
      rows.splice(i + 1, 0, ...added);
      showRows({ i: i + added.length, at: 0 });
      edited();
    };
    showRows();
    coloursSel.value = look.colours;
    accent.value = look.accent;
    size.value = look.size ? String(look.size) : '';
    wIn.value = String(Math.round(look.w));
    hIn.value = String(Math.round(look.h));
    rounded.checked = look.rounded;
    shadow.checked = look.shadow;
    // with a drawing, the accent box becomes that drawing's color button (its colors, your palettes, More Colors…)
    const drawing = o.drawing;
    const putAccentButton = (): void => {
      if (!drawing) return;
      const holder = accent.parentElement!;
      holder.querySelector('.dg-accent')?.remove();
      const btn = colourButton(drawing, accent.value, (picked) => {
        if (!picked) return;
        accent.value = picked;
        putAccentButton();
        later();
      }, { autoLabel: 'Default blue', autoSwatch: DIAGRAM_DEFAULTS.accent });
      btn.classList.add('dg-accent');
      accent.after(btn);
    };
    accent.hidden = !!drawing;
    putAccentButton();
    // (a layout's sample text is replaced by the next layout's sample until the text is changed)

    const data = (): DiagramData => ({
      layout, ...fromRows(rows, layout),
      colours: coloursSel.value as DiagramColours, accent: accent.value,
      rounded: rounded.checked, shadow: shadow.checked,
      ...(Number(size.value) > 0 ? { size: Number(size.value) } : {}),
      w: Math.max(40, Number(wIn.value) || look.w), h: Math.max(30, Number(hIn.value) || look.h),
      // spaces held for structures carry over; the next refit works them out again
      ...(editing?.figs && { figs: editing.figs }),
    });

    // the layouts, by kind, each a button with a small picture of it
    const list = $<HTMLDivElement>('.dg-layouts');
    const buttons = new Map<string, HTMLButtonElement>();
    const thumb = (id: string) => o.preview({ ...newDiagram(id, null, { colours: 'accent', accent: '#4472c4', rounded: true, shadow: false }), size: 0.1 });
    const thumbs: [HTMLElement, string][] = [];
    for (const cat of DIAGRAM_CATEGORIES) {
      const ls = DIAGRAM_LAYOUTS.filter((l) => l.category === cat);
      if (!ls.length) continue;
      list.append(Object.assign(document.createElement('h3'), { textContent: cat }));
      const grid = document.createElement('div');
      grid.className = 'dg-grid';
      for (const l of ls) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'dg-layout';
        b.setAttribute('role', 'option');
        b.title = `${l.name}: ${l.blurb}`;
        b.setAttribute('aria-label', l.name);
        const pic = document.createElement('span');
        pic.className = 'dg-thumb';
        pic.innerHTML = thumb(l.id);
        thumbs.push([pic, l.id]);
        b.append(pic, Object.assign(document.createElement('span'), { textContent: l.name }));
        b.addEventListener('click', () => pick(l.id));
        buttons.set(l.id, b);
        grid.append(b);
      }
      list.append(grid);
    }
    const pick = (id: string) => {
      const l = DIAGRAM_BY_ID.get(id);
      if (!l) return;
      const was = DIAGRAM_BY_ID.get(layout);
      layout = id;
      if (sample) { rows = rowsOf({ text: l.sample }); showRows(); }
      // (leaving the icon list: the icons named in brackets go, as the other layouts draw none)
      else if (was?.id === 'icon-list' && id !== 'icon-list') { rows = withoutIcons(rows); showRows(); }
      // a new diagram takes the layout's own shape (a cycle is square, a process wide) unless the size was typed
      if (!editing && was && Math.round(was.size[0] * o.scale) === Number(wIn.value) && Math.round(was.size[1] * o.scale) === Number(hIn.value)) {
        wIn.value = String(Math.round(l.size[0] * o.scale));
        hIn.value = String(Math.round(l.size[1] * o.scale));
      }
      for (const [k, b] of buttons) { b.classList.toggle('on', k === id); b.setAttribute('aria-selected', String(k === id)); }
      $('.dg-blurb').textContent = l.blurb;
      draw();
    };

    const view = $<HTMLDivElement>('.dg-preview');
    const draw = () => { view.innerHTML = o.preview(data()); };
    let timer = 0;
    const later = () => { clearTimeout(timer); timer = window.setTimeout(draw, 120); };
    // icon lists show icons from the icon library, loaded the first time a diagram is made
    if (!iconsLoaded()) void loadIcons().then(() => { for (const [pic, id] of thumbs) pic.innerHTML = thumb(id); draw(); }, () => {});
    for (const el of [coloursSel, accent, size, wIn, hIn, rounded, shadow]) el.addEventListener('input', later);

    d.append(form);
    document.body.append(d);
    const finish = (v: DiagramData | null) => { clearTimeout(timer); d.remove(); resolve(v); };
    form.querySelector('[data-act=cancel]')!.addEventListener('click', () => { d.close(); finish(null); });
    d.addEventListener('cancel', () => finish(null));
    d.addEventListener('keydown', (e) => { if (e.key !== 'Escape') e.stopPropagation(); });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const out = data();
      if (!out.text.trim()) { fields[0]?.el.focus(); return; }
      lastLook = { layout: out.layout, colours: out.colours, accent: out.accent, rounded: out.rounded, shadow: out.shadow };
      d.close();
      finish(out);
    });
    pick(layout);
    d.showModal();
    fields[0]?.el.focus();
  });
}
