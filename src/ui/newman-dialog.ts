// The Newman Projection window (right-click a single bond ▸ Newman Projection…, or the Newman
// tool): the Newman projection and the sawhorse side by side (the sawhorse with the eye that shows
// which end is looked from, and Reverse Direction on its box), then the most stable conformers
// from a conformer search (or the conformation the wedges draw), a Turn dial and how the labels
// are written. Drag either picture onto the canvas, or select one and press Insert: the window
// closes and the picture follows the pointer until a click places it. Tab and Shift+Tab in a
// picture step through the conformers.

import { commonName, norm180, type NewmanConformer } from '../chem/newman';
import { chartTab, type ChartChoice, type ChartHost } from './newman-chart-tab';
import type { NewmanText } from '../design/newman-prefs';
import { addInfo, infoIcon, setInfo } from './info-tip';
import { FONT_GROUPS } from '../fonts';
import { minusText } from './minus-text';

/** What the window settles on; the caller makes the projection from it. */
export interface NewmanChoice {
  /** Look from the other end of the bond than the one picked. */
  reversed: boolean;
  kind: 'newman' | 'sawhorse';
  /** The most stable conformers (a search) or the one the drawing's wedges give. */
  source: 'stable' | 'drawn';
  /** Which picture down the bond, 0 the most stable. */
  index: number;
  /** Degrees the back atom is turned from that conformer. */
  turn: number;
  method: 'mmff' | 'xtb';
  mark: boolean;
  linked: boolean;
  /** Textbook angles (120° apart, staggered at exactly 60°) rather than the conformer's own. */
  ideal: boolean;
  /** The sawhorse's wedge and hashed wedge on each atom, and R/S beside its stereocenters. */
  wedges: boolean;
  rs: boolean;
  /** How the labels are written. */
  text: NewmanText;
}

export interface NewmanHost {
  /** The conformers seen down the bond, lowest first (`progress` tells how a search is going). Rejects with a readable reason. */
  list(reversed: boolean, method: 'mmff' | 'xtb', progress: (text: string) => void): Promise<NewmanConformer[]>;
  /** The conformation the wedges and bold bonds draw, or why there is none. */
  drawn(reversed: boolean): Promise<NewmanConformer | string>;
  /** Draw the choice as a Newman projection or as a sawhorse (with the eye at the end looked from) on a preview canvas. */
  paint(choice: NewmanChoice, conf: NewmanConformer, canvas: HTMLCanvasElement, kind: NewmanChoice['kind']): void;
  /** xTB can be used (the desktop app, which runs the person's xtb). */
  xtb: boolean;
  /** Stop a search under way. */
  stop(): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}): HTMLElementTagNameMap[K] => Object.assign(document.createElement(tag), props);
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** A conformer's line in the list: the torsion between the biggest groups and its everyday name. */
export function torsionText(c: NewmanConformer): string {
  const phi = Math.round(norm180(c.view.dihedral));
  const name = commonName(phi);
  return `${minusText(phi)}°${name ? ' ' + name : ''}`;
}

/** The Energy Chart tab, when the window offers one. */
export interface ChartOffer<S> {
  host: ChartHost<S>;
  start: Omit<ChartChoice, 'a' | 'd'>;
  /** Open on the chart tab. */
  first?: boolean;
}

/** `drag`: a picture was dragged out of the window, the pointer now at this place with its button still down. */
export type NewmanResult<S> = { choice: NewmanChoice; conf: NewmanConformer; drag?: { x: number; y: number } } | { choice: NewmanChoice; chart: ChartChoice; scan: S };

export function askNewman<S = never>(start: NewmanChoice, host: NewmanHost, editing: boolean, offer?: ChartOffer<S>): Promise<NewmanResult<S> | null> {
  return new Promise((resolve) => {
    const choice: NewmanChoice = { ...start };
    let confs: NewmanConformer[] = [];
    let drawnConf: NewmanConformer | null = null;
    /** Each search made (a newer one makes the answer of an older one not count), whether the newest is still running, and whether the window is over. */
    let req = 0, loading = false, over = false;
    const d = el('dialog', { className: 'ask newman-dialog' });
    d.setAttribute('aria-label', 'Newman projection');
    const form = el('form', { method: 'dialog' });
    const fontOptions = FONT_GROUPS.map((g) => `<optgroup label="${esc(g.name)}">${g.fonts.map((f) => `<option>${esc(f)}</option>`).join('')}</optgroup>`).join('');
    form.innerHTML = `<h2>${editing ? 'Edit Newman Projection' : 'Newman Projection'}</h2>
      ${offer ? '<div class="np-tabs" role="tablist"><button type="button" role="tab" data-tab="proj">Projection</button><button type="button" role="tab" data-tab="chart">Energy Chart</button></div>' : ''}
      <div class="np-page" data-page="proj">
      <div class="np-views" role="radiogroup" aria-label="Draw as">
        <div class="np-view" data-kind="newman" role="radio" tabindex="0"><span class="np-cap">Newman</span><canvas class="np-preview" role="img" aria-label="Newman projection preview"></canvas></div>
        <div class="np-view" data-kind="sawhorse" role="radio" tabindex="0"><span class="np-cap">Sawhorse</span><button type="button" class="np-swap" data-act="swap" title="Reverse Direction" aria-label="Reverse Direction">⇄</button><canvas class="np-preview" role="img" aria-label="Sawhorse preview"></canvas></div>
      </div>
      <div class="np-grid">
        <div class="np-left">
          <label class="ask-row"><span>Conformation</span><select name="source"><option value="stable">Most stable (conformer search)</option><option value="drawn">As drawn (wedges)</option></select></label>
          <label class="ask-row"><span>Energies</span><select name="method"><option value="mmff">MMFF94s+ (fast)</option><option value="xtb">GFN2-xTB (your xtb)</option></select></label>
          <label class="ask-row np-turn"><span>Turn</span><input name="turn" type="range" min="-180" max="180" step="5" aria-label="Turn the back atom" /><output class="muted"></output></label>
          <div class="ask-row np-text"><span>Text</span><span class="np-textrow"><select name="font" aria-label="Font"><option value="">Drawing font</option>${fontOptions}</select><input name="size" type="number" min="4" max="72" step="0.5" placeholder="Auto" aria-label="Font size, points" /><button type="button" class="np-face" data-face="bold" aria-pressed="false" title="Bold"><b>B</b></button><button type="button" class="np-face" data-face="italic" aria-pressed="false" title="Italic"><i>I</i></button></span></div>
        </div>
        <div class="np-right">
          <div class="np-list" role="listbox" aria-label="Conformers"><table><thead><tr><th>#</th><th class="np-th-torsion">Torsion</th><th class="num">kcal/mol</th><th class="num">Share</th></tr></thead><tbody></tbody></table></div>
          <p class="muted small np-status" aria-live="polite"></p>
        </div>
      </div>
      <div class="np-checks">
        <label title="Draw the bonds 120° apart and staggered at exactly 60°, as textbooks do. Off: the conformer's own angles."><input name="ideal" type="checkbox" /> Idealized Angles</label>
        <label title="Make the labels smaller, down to 70%, where they would not fit at full size."><input name="auto" type="checkbox" /> Auto-Scale Text</label>
        <label title="On the sawhorse, a wedge and a hashed wedge on each atom show which groups point toward and away from you."><input name="wedges" type="checkbox" /> Wedges</label>
        <label title="On the sawhorse, show R or S beside each stereocenter."><input name="rs" type="checkbox" /> R/S Labels</label>
        <label title="Mark the viewing direction on the structure with an eye and a dotted arrow."><input name="mark" type="checkbox" /> Viewing Mark</label>
        <label title="Draw the projection again whenever its structure changes."><input name="linked" type="checkbox" /> Linked</label>
      </div>
      </div>
      ${offer ? '<div class="np-page" data-page="chart" hidden></div>' : ''}
      <p class="ask-buttons"><button type="button" data-act="cancel">Cancel</button> <button type="submit" class="primary">${editing ? 'Redraw' : 'Insert'}</button></p>`;
    const $ = <T extends Element>(q: string) => form.querySelector<T>(q)!;
    addInfo(form.querySelector('h2'), `${editing ? 'Select the Newman projection or the sawhorse, then click Redraw.' : 'Drag the Newman projection or the sawhorse onto the canvas, or select one and click Insert, then click where it should go.'} The eye on the sawhorse shows which end you are looking from. Groups are colored by size on each atom (largest, middle, smallest by A-value): change this in Settings ▸ Newman Projections.`);
    const listInfo = infoIcon('Conformers looking down this bond, most stable first. Tab in a preview: next conformer. Shift+Tab: previous.');
    $<HTMLElement>('.np-th-torsion').append(' ', listInfo);
    const views = [...form.querySelectorAll<HTMLElement>('.np-view')];
    const canvases = new Map(views.map((v) => [v.dataset.kind as NewmanChoice['kind'], v.querySelector('canvas')!] as const));
    const turn = $<HTMLInputElement>('input[name=turn]');
    const turnOut = $<HTMLOutputElement>('.np-turn output');
    const sourceSel = $<HTMLSelectElement>('select[name=source]');
    const methodSel = $<HTMLSelectElement>('select[name=method]');
    const body = $<HTMLTableElement>('.np-list table').tBodies[0];
    const status = $<HTMLParagraphElement>('.np-status');
    const submit = $<HTMLButtonElement>('button[type=submit]');
    if (!host.xtb) {
      const o = methodSel.options[1];
      o.disabled = true;
      o.textContent = 'GFN2-xTB (desktop app with xtb installed)';
    }

    const current = (): NewmanConformer | null => (choice.source === 'drawn' ? drawnConf : confs[choice.index] ?? null);
    let tab: 'proj' | 'chart' = offer?.first ? 'chart' : 'proj';
    const chart = offer ? chartTab(form.querySelector<HTMLElement>('[data-page=chart]')!, offer.host, offer.start, () => choice.reversed, host.xtb, () => { if (tab === 'chart') paint(); }, () => reverse()) : null;
    const paint = () => {
      if (tab === 'chart') { submit.disabled = !chart?.result(); return; }
      const c = current();
      submit.disabled = !c || loading;
      for (const [kind, cv] of canvases) {
        if (!c) { cv.getContext('2d')?.clearRect(0, 0, cv.width, cv.height); continue; }
        try { host.paint(choice, c, cv, kind); } catch { /* drawn on the next change */ }
      }
    };
    const pickKind = (kind: NewmanChoice['kind']) => {
      choice.kind = kind;
      for (const v of views) v.setAttribute('aria-checked', String(v.dataset.kind === kind));
    };
    const fillList = () => {
      body.innerHTML = '';
      const rows = choice.source === 'drawn' ? (drawnConf ? [drawnConf] : []) : confs;
      rows.forEach((c, i) => {
        const tr = body.insertRow();
        tr.setAttribute('role', 'option');
        const on = choice.source === 'drawn' || i === choice.index;
        tr.setAttribute('aria-selected', String(on));
        tr.className = on ? 'on' : '';
        tr.innerHTML = `<td>${choice.source === 'drawn' ? '–' : i + 1}</td><td>${esc(torsionText(c))}</td><td class="num">${c.energy === null ? '–' : c.energy.toFixed(2)}</td><td class="num">${c.population === undefined ? '–' : Math.round(c.population * 100) + '%'}</td>`;
        if (choice.source !== 'drawn') tr.addEventListener('click', () => { pick(i); views.find((v) => v.dataset.kind === choice.kind)?.focus(); });
      });
    };
    const pick = (i: number) => {
      choice.index = Math.max(0, Math.min(confs.length - 1, i));
      fillList();
      body.rows[choice.index]?.scrollIntoView({ block: 'nearest' });
      paint();
    };
    const load = async () => {
      const ask = ++req;
      loading = true;
      paint();
      status.textContent = choice.source === 'drawn' ? 'Building the shape the wedges draw…' : 'Searching conformers…';
      try {
        if (choice.source === 'drawn') {
          const got = await host.drawn(choice.reversed);
          if (ask !== req || over) return;
          drawnConf = typeof got === 'string' ? null : got;
          status.textContent = typeof got === 'string' ? got : '';
        } else {
          const got = await host.list(choice.reversed, choice.method, (t) => { if (ask === req && !over) status.textContent = t; });
          if (ask !== req || over) return;
          confs = got;
          if (choice.index >= confs.length) choice.index = 0;
          status.textContent = confs.length ? '' : 'No conformers were found.';
          setInfo(listInfo, `${confs.length} conformer${confs.length === 1 ? '' : 's'} looking down this bond, most stable first (${choice.method === 'xtb' ? 'GFN2-xTB' : 'MMFF94s+'}). Tab in a preview: next conformer. Shift+Tab: previous.`);
        }
      } catch (e) {
        if (ask !== req || over) return;
        const msg = (e as Error)?.message ?? String(e);
        status.textContent = msg === 'stopped' ? '' : msg;
        if (choice.source !== 'drawn' && choice.method === 'xtb') { choice.method = 'mmff'; methodSel.value = 'mmff'; }
      } finally {
        if (ask === req) loading = false;
      }
      fillList();
      paint();
    };

    pickKind(choice.kind);
    sourceSel.value = choice.source;
    methodSel.value = choice.method === 'xtb' && host.xtb ? 'xtb' : 'mmff';
    choice.method = methodSel.value as 'mmff' | 'xtb';
    methodSel.disabled = choice.source === 'drawn';
    turn.value = String(choice.turn);
    turnOut.textContent = `${minusText(choice.turn)}°`;
    choice.text = { ...choice.text };
    const flags = ['ideal', 'wedges', 'rs', 'mark', 'linked'] as const;
    for (const k of flags) {
      const box = $<HTMLInputElement>(`input[name=${k}]`);
      box.checked = choice[k];
      box.addEventListener('change', () => { choice[k] = box.checked; paint(); });
    }
    const autoBox = $<HTMLInputElement>('input[name=auto]'), fontSel = $<HTMLSelectElement>('select[name=font]'), sizeBox = $<HTMLInputElement>('input[name=size]');
    autoBox.checked = choice.text.auto;
    autoBox.addEventListener('change', () => { choice.text.auto = autoBox.checked; paint(); });
    if (choice.text.font && ![...fontSel.options].some((o) => o.value === choice.text.font)) fontSel.add(new Option(choice.text.font, choice.text.font));
    fontSel.value = choice.text.font ?? '';
    fontSel.addEventListener('change', () => { if (fontSel.value) choice.text.font = fontSel.value; else delete choice.text.font; paint(); });
    sizeBox.value = choice.text.size !== undefined ? String(choice.text.size) : '';
    sizeBox.addEventListener('input', () => { const v = Number(sizeBox.value); if (sizeBox.value !== '' && isFinite(v) && v >= 4 && v <= 72) choice.text.size = v; else delete choice.text.size; paint(); });
    for (const b of form.querySelectorAll<HTMLButtonElement>('.np-face')) {
      const k = b.dataset.face as 'bold' | 'italic';
      b.setAttribute('aria-pressed', String(!!choice.text[k]));
      b.addEventListener('click', () => { if (choice.text[k]) delete choice.text[k]; else choice.text[k] = true; b.setAttribute('aria-pressed', String(!!choice.text[k])); paint(); });
    }

    turn.addEventListener('input', () => { choice.turn = Number(turn.value) || 0; turnOut.textContent = `${minusText(choice.turn)}°`; paint(); });
    turn.addEventListener('dblclick', () => { choice.turn = 0; turn.value = '0'; turnOut.textContent = '0°'; paint(); });
    const reverse = () => { choice.reversed = !choice.reversed; choice.index = 0; void load(); chartStale = true; if (tab === 'chart') { chartStale = false; chart?.open(true); } };
    for (const b of form.querySelectorAll<HTMLButtonElement>('[data-act=swap]')) b.addEventListener('click', (e) => { e.stopPropagation(); reverse(); });
    sourceSel.addEventListener('change', () => { choice.source = sourceSel.value as NewmanChoice['source']; methodSel.disabled = choice.source === 'drawn'; void load(); });
    methodSel.addEventListener('change', () => { choice.method = methodSel.value as NewmanChoice['method']; choice.index = 0; void load(); });
    // a picture is selected by a click (or Space), and dragged out of the window onto the canvas
    for (const v of views) {
      const kind = v.dataset.kind as NewmanChoice['kind'];
      v.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); pickKind(kind); } });
      v.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || (e.target as Element).closest('button')) return;
        pickKind(kind);
        const c = current();
        if (editing || !c || loading) return;
        const x0 = e.clientX, y0 = e.clientY;
        const move = (ev: PointerEvent) => {
          if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
          stopDrag();
          d.close();
          finish({ choice: { ...choice, text: { ...choice.text } }, conf: c, drag: { x: ev.clientX, y: ev.clientY } });
        };
        const stopDrag = () => { window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerup', stopDrag, true); window.removeEventListener('pointercancel', stopDrag, true); };
        window.addEventListener('pointermove', move, true);
        window.addEventListener('pointerup', stopDrag, true);
        // (a touch the browser takes for a scroll ends in pointercancel, not pointerup)
        window.addEventListener('pointercancel', stopDrag, true);
      });
    }
    // Tab steps through the conformers while the preview has focus; past either end it moves on as usual
    for (const v of views) v.addEventListener('keydown', (e) => {
      if (choice.source === 'drawn' || !confs.length) return;
      const step = e.key === 'Tab' ? (e.shiftKey ? -1 : 1) : e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
      if (!step) return;
      const next = choice.index + step;
      if (next < 0 || next >= confs.length) return;
      e.preventDefault();
      pick(next);
    });

    // the tabs: the chart's scan starts the first time its tab is shown
    let chartStale = false;
    const show = (t: 'proj' | 'chart') => {
      tab = t;
      for (const b of form.querySelectorAll<HTMLButtonElement>('[data-tab]')) { b.setAttribute('aria-selected', String(b.dataset.tab === t)); b.tabIndex = b.dataset.tab === t ? 0 : -1; }
      for (const p of form.querySelectorAll<HTMLElement>('[data-page]')) p.hidden = p.dataset.page !== t;
      submit.textContent = t === 'chart' ? (editing ? 'Redraw Chart' : 'Insert Chart') : editing ? 'Redraw' : 'Insert';
      if (t === 'chart') { chart?.open(chartStale); chartStale = false; }
      paint();
    };
    for (const b of form.querySelectorAll<HTMLButtonElement>('[data-tab]')) {
      b.addEventListener('click', () => show(b.dataset.tab as 'proj' | 'chart'));
      b.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); const t = tab === 'proj' ? 'chart' : 'proj'; show(t); form.querySelector<HTMLButtonElement>(`[data-tab=${t}]`)!.focus(); } });
    }

    d.append(form);
    document.body.append(d);
    const finish = (v: NewmanResult<S> | null) => { over = true; loading = false; chart?.stop(); if (!v) host.stop(); d.remove(); resolve(v); };
    $<HTMLButtonElement>('[data-act=cancel]').addEventListener('click', () => { d.close(); finish(null); });
    d.addEventListener('cancel', () => finish(null));
    d.addEventListener('keydown', (e) => { if (e.key !== 'Escape') e.stopPropagation(); });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (tab === 'chart') {
        const r = chart?.result();
        if (!r) return;
        d.close();
        finish({ choice: { ...choice }, ...r });
        return;
      }
      const c = current();
      if (!c) return;
      d.close();
      finish({ choice: { ...choice, text: { ...choice.text } }, conf: c });
    });
    d.showModal();
    if (offer) show(tab);
    if (tab === 'proj') views.find((v) => v.dataset.kind === choice.kind)?.focus(); else form.querySelector<HTMLButtonElement>('[data-tab=chart]')!.focus();
    void load();
  });
}
