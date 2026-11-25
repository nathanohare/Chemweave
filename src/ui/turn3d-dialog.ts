// View ▸ 3-D ▸ 3-D Rotation… (and the 3-D Rotation command in the menus): the selected structures turned about X, Y and Z by angles slid or typed
// in, shown live on the drawing as they change. The window sits to one side, over a drawing left
// undimmed, so the structure can be watched while it turns. Rotate keeps the turn (one Undo takes
// it back); Cancel or Esc puts the structures back as they were; Reset brings every angle to 0.

import { addInfo } from './info-tip';

/** The turn being tried (see Editor.previewTurn). */
export interface Turn3dPreview {
  notes: string[];
  set(x: number, y: number, z: number): number;
  keep(): void;
  cancel(): void;
}

export interface Turn3dHost {
  /** Get the selection ready to turn, as a flat sheet or (`real`) its real 3-D shape (null: nothing to turn). */
  prepare(real: boolean): Promise<Turn3dPreview | null>;
  /** The side of the window away from the selection, so the dialog doesn't hide it. */
  side(): 'left' | 'right';
  /** Where the drawing is on screen: the window sits inside its top corner, clear of the ribbon. */
  area?(): DOMRect;
}

export type Turn3dShape = 'flat' | 'real';
export interface Turn3dResult { x: number; y: number; z: number; shape: Turn3dShape }

const AXES = [
  { key: 'x', label: 'About X', help: 'Left–right axis. Positive tips the top toward you.' },
  { key: 'y', label: 'About Y', help: 'Up–down axis. Positive brings the left side toward you.' },
  { key: 'z', label: 'About Z', help: 'Axis into the page. Positive rotates clockwise.' },
] as const;
type Axis = (typeof AXES)[number]['key'];

/** An angle brought into −180…180. */
export function wrapAngle(v: number): number {
  if (!Number.isFinite(v)) return 0;
  const w = ((((v + 180) % 360) + 360) % 360) - 180;
  return w === -180 && v > 0 ? 180 : w;
}

/** Open the window; resolves with what was kept, or null when it was cancelled. */
export function openTurn3d(host: Turn3dHost, shape: Turn3dShape): Promise<Turn3dResult | null> {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    const side = host.side();
    d.className = `ask turn3d-dialog ${side}`;
    const area = host.area?.();
    if (area) {
      const top = Math.round(area.top + 12);
      d.style.margin = side === 'left' ? `${top}px auto auto ${Math.round(area.left + 12)}px` : `${top}px ${Math.round(window.innerWidth - area.right + 12)}px auto auto`;
    }
    const form = document.createElement('form');
    form.className = 'turn3d-form';
    const h = document.createElement('h2');
    h.textContent = '3-D Rotation';
    addInfo(h, 'Rotates the selected structures from where they are now; the drawing shows the rotation as you go. Shift+arrow keys on a slider move it 15° at a time. To rotate by eye, drag with the Perspective tools.');
    form.append(h);

    const angle: Record<Axis, number> = { x: 0, y: 0, z: 0 };
    const sliders = new Map<Axis, HTMLInputElement>();
    const boxes = new Map<Axis, HTMLInputElement>();
    for (const a of AXES) {
      const name = document.createElement('label');
      name.className = 'turn3d-name';
      name.textContent = a.label;
      name.htmlFor = `turn3d-${a.key}`;
      addInfo(name, a.help);
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = '-180';
      slider.max = '180';
      slider.step = '1';
      slider.value = '0';
      slider.setAttribute('aria-label', `${a.label} (slider)`);
      const box = document.createElement('input');
      box.type = 'number';
      box.id = `turn3d-${a.key}`;
      box.step = 'any';
      box.value = '0';
      box.className = 'turn3d-box';
      const unit = document.createElement('span');
      unit.className = 'muted';
      unit.textContent = '°';
      slider.addEventListener('input', () => { angle[a.key] = Number(slider.value); box.value = slider.value; show(); });
      slider.addEventListener('keydown', (e) => {
        // Shift+arrows: 15° steps
        if (!e.shiftKey || !/^Arrow(Left|Right|Up|Down)$/.test(e.key)) return;
        e.preventDefault();
        const dir = e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 1;
        const v = Math.max(-180, Math.min(180, (Math.round(angle[a.key] / 15) + dir) * 15));
        angle[a.key] = v; slider.value = box.value = String(v); show();
      });
      box.addEventListener('input', () => {
        const v = parseFloat(box.value);
        if (!Number.isFinite(v)) return;
        angle[a.key] = v;
        slider.value = String(wrapAngle(v));
        show();
      });
      sliders.set(a.key, slider);
      boxes.set(a.key, box);
      form.append(name, slider, box, unit);
    }

    const shapeName = document.createElement('label');
    shapeName.className = 'turn3d-name';
    shapeName.textContent = 'Rotate';
    shapeName.htmlFor = 'turn3d-shape';
    addInfo(shapeName, 'A flat sheet tilts the drawing as drawn. The real 3-D shape is built from the structure (wedges and bold bonds say which shape is meant), which takes a moment the first time.');
    const pick = document.createElement('select');
    pick.id = 'turn3d-shape';
    pick.className = 'turn3d-shape';
    pick.add(new Option('The drawing as a flat sheet', 'flat', false, shape === 'flat'));
    pick.add(new Option('The real 3-D shape', 'real', false, shape === 'real'));
    form.append(shapeName, pick);

    const status = document.createElement('p');
    status.className = 'turn3d-status muted small';
    status.setAttribute('role', 'status');
    status.hidden = true;
    form.append(status);
    const say = (t: string) => { status.textContent = t; status.hidden = !t; };

    const buttons = document.createElement('p');
    buttons.className = 'ask-buttons turn3d-buttons';
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'turn3d-reset';
    reset.textContent = 'Reset';
    reset.title = 'Every angle back to 0°';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    const ok = document.createElement('button');
    ok.type = 'submit';
    ok.className = 'primary';
    ok.textContent = 'Rotate';
    buttons.append(reset, cancel, ok);
    form.append(buttons);
    d.append(form);

    let preview: Turn3dPreview | null = null;
    let asked = 0;
    let frame = 0;
    const show = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!preview) return;
        const unshown = preview.set(angle.x, angle.y, angle.z);
        say(unshown ? 'From this angle a stereocenter can\'t be drawn so it reads right; Rotate keeps the last angle where it could.' : preview.notes[0] ? `${preview.notes[0]} Rotating it flat instead.` : '');
      });
    };
    const load = async () => {
      const mine = ++asked;
      preview?.cancel();
      preview = null;
      const real = pick.value === 'real';
      say(real ? 'Building the 3-D shape…' : '');
      ok.disabled = true;
      const p = await host.prepare(real);
      if (mine !== asked || finished) { p?.cancel(); return; }
      preview = p;
      ok.disabled = !p;
      if (!p) { say('Select a structure to rotate in 3-D.'); return; }
      say(p.notes[0] ? `${p.notes[0]} Rotating it flat instead.` : '');
      show();
    };
    pick.addEventListener('change', () => void load());
    reset.addEventListener('click', () => {
      for (const a of AXES) { angle[a.key] = 0; sliders.get(a.key)!.value = '0'; boxes.get(a.key)!.value = '0'; }
      show();
    });

    let finished = false;
    const done = (keep: boolean) => {
      if (finished) return;
      finished = true;
      if (frame) { cancelAnimationFrame(frame); frame = 0; }
      if (keep && preview) {
        preview.set(angle.x, angle.y, angle.z);
        preview.keep();
      } else preview?.cancel();
      if (d.open) d.close();
      d.remove();
      resolve(keep ? { ...angle, shape: pick.value as Turn3dShape } : null);
    };
    form.addEventListener('submit', (e) => { e.preventDefault(); done(true); });
    cancel.addEventListener('click', () => done(false));
    d.addEventListener('close', () => done(false));
    document.body.append(d);
    d.showModal();
    sliders.get('x')!.focus();
    void load();
  });
}
