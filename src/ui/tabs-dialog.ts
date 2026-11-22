// Document Home ▸ Paragraph ▸ Tabs… (retrospective audit G5-09): Word's Tabs window. The stops
// in a list under the Tab stop position box, Alignment and Leader as radio buttons, and Set, Clear
// and Clear All, in place of one typed list. Positions take in, cm, mm or pt (inches when none).

import type { TabStop } from '../model';
import { showDialog } from './dialog-host';
import { addInfo } from './info-tip';
import { parseLength, showLength } from './doc-panel';

type Kind = TabStop['kind'];
type Leader = NonNullable<TabStop['leader']> | '';

export const TAB_KINDS: [Kind, string][] = [['left', 'Left'], ['center', 'Center'], ['right', 'Right'], ['decimal', 'Decimal']];
export const TAB_LEADERS: [Leader, string][] = [['', 'None'], ['dot', 'Dots …….'], ['hyphen', 'Dashes -------'], ['underscore', 'Line ______']];

/** The window: resolves with the stops (sorted, one per position) on OK, or null on Cancel. */
export function editTabStops(current: readonly TabStop[]): Promise<TabStop[] | null> {
  return new Promise((resolve) => {
    let stops: TabStop[] = current.map((t) => ({ ...t })).sort((a, b) => a.pos - b.pos);
    let picked = stops.length ? 0 : -1;
    const d = document.createElement('dialog');
    d.className = 'ask tabs-dialog';
    d.setAttribute('aria-label', 'Tabs');
    const form = document.createElement('form');
    form.method = 'dialog';
    const h = document.createElement('h2');
    h.textContent = 'Tabs';
    addInfo(h, 'Type a position (inches unless you add cm, mm or pt), choose its alignment and leader, and click Set. After the last stop, tabs fall every 0.5 in. You can also click the ruler to set a stop.');
    const posLabel = document.createElement('label');
    posLabel.className = 'tabs-pos';
    posLabel.textContent = 'Tab stop position';
    const pos = document.createElement('input');
    pos.type = 'text';
    pos.autocomplete = 'off';
    posLabel.append(pos);
    const list = document.createElement('select');
    list.size = 6;
    list.className = 'tabs-list';
    list.setAttribute('aria-label', 'Tab stops');
    const left = document.createElement('div');
    left.className = 'tabs-left';
    left.append(posLabel, list);
    const radios = (legend: string, name: string, choices: [string, string][]) => {
      const fs = document.createElement('fieldset');
      const lg = document.createElement('legend');
      lg.textContent = legend;
      fs.append(lg);
      for (const [v, t] of choices) {
        const l = document.createElement('label');
        const r = document.createElement('input');
        r.type = 'radio';
        r.name = name;
        r.value = v;
        l.append(r, ` ${t}`);
        fs.append(l);
      }
      return fs;
    };
    const right = document.createElement('div');
    right.className = 'tabs-right';
    right.append(radios('Alignment', 'kind', TAB_KINDS), radios('Leader', 'leader', TAB_LEADERS));
    const body = document.createElement('div');
    body.className = 'tabs-body';
    body.append(left, right);
    const btn = (text: string, title: string, act: () => void) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = text;
      b.title = title;
      b.addEventListener('click', act);
      return b;
    };
    const status = document.createElement('span');
    status.className = 'tabs-status';
    status.setAttribute('role', 'status');
    const actions = document.createElement('p');
    actions.className = 'tabs-actions';
    const radio = (name: string, v: string) => form.querySelector<HTMLInputElement>(`input[name=${name}][value="${v}"]`)!;
    const checked = (name: string) => form.querySelector<HTMLInputElement>(`input[name=${name}]:checked`)?.value ?? '';
    const showPicked = () => {
      const t = stops[picked];
      radio('kind', t?.kind ?? 'left').checked = true;
      radio('leader', t?.leader ?? '').checked = true;
      pos.value = t ? showLength(t.pos, 'in') + ' in' : '';
    };
    const fill = () => {
      list.replaceChildren(...stops.map((t, i) => new Option(`${showLength(t.pos, 'in')} in`, String(i), false, i === picked)));
      clear.disabled = picked < 0;
      clearAll.disabled = !stops.length;
    };
    const set = (): boolean => {
      if (!pos.value.trim()) return true;
      const at = parseLength(pos.value, 'in');
      if (at === null || at <= 0) { status.textContent = 'Type a position above 0, such as 1.5 or 3 cm.'; pos.focus(); return false; }
      status.textContent = '';
      const leader = checked('leader') as Leader;
      const stop: TabStop = { pos: at, kind: (checked('kind') || 'left') as Kind, ...(leader ? { leader } : {}) };
      // a stop at the same place (to a hundredth of a point) is changed, not doubled
      stops = stops.filter((t) => Math.abs(t.pos - at) > 0.01);
      stops.push(stop);
      stops.sort((a, b) => a.pos - b.pos);
      picked = stops.indexOf(stop);
      fill();
      return true;
    };
    const clear = btn('Clear', 'Remove the selected tab stop', () => { if (picked < 0) return; stops.splice(picked, 1); picked = Math.min(picked, stops.length - 1); fill(); showPicked(); });
    const clearAll = btn('Clear All', 'Remove every tab stop', () => { stops = []; picked = -1; fill(); showPicked(); });
    actions.append(btn('Set', 'Add the tab stop, or change the one at this position', () => { set(); }), clear, clearAll, status);
    list.addEventListener('change', () => { picked = Number(list.value); showPicked(); clear.disabled = picked < 0; });
    pos.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); set(); } });
    const buttons = document.createElement('p');
    buttons.className = 'ask-buttons';
    const cancel = btn('Cancel', '', () => { d.close(); });
    cancel.removeAttribute('title');
    const ok = document.createElement('button');
    ok.type = 'submit';
    ok.className = 'primary';
    ok.textContent = 'OK';
    buttons.append(cancel, ok);
    form.append(h, body, actions, buttons);
    d.append(form);
    let result: TabStop[] | null = null;
    // OK sets what is typed in the box first, as Word does
    form.addEventListener('submit', (e) => { e.preventDefault(); if (!set()) return; result = stops; d.close(); });
    d.addEventListener('close', () => { d.remove(); resolve(result); });
    document.body.append(d);
    showDialog(d);
    fill();
    showPicked();
    pos.focus();
  });
}
