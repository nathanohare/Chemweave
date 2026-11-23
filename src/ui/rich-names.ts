// Rich text boxes for a window's names (TLC/Gel lane names and eluent, a diagram's items), as the
// Energy Diagram window has them: what is typed shows as it will be drawn, digits of formulas drop
// as typed, and a small bar (and Ctrl+B, Ctrl+I, Ctrl+U, Ctrl+=, Ctrl+Shift+=) sets bold, italic,
// underline, subscript and superscript on the box being typed in.

import { RichField, type RichFieldOptions } from './rich-field';
import { labelFromParts, labelParts, type LabelPart } from '../design/energy';

/** The formatting bar's buttons (the same as the Energy Diagram window's). */
export const NAME_BAR_HTML = '<button type="button" class="mo-fmt" data-look="bold" title="Bold (Ctrl+B)" aria-label="Bold"><b>B</b></button><button type="button" class="mo-fmt" data-look="italic" title="Italic (Ctrl+I)" aria-label="Italic"><i>I</i></button><button type="button" class="mo-fmt" data-look="underline" title="Underline (Ctrl+U)" aria-label="Underline"><u>U</u></button><span class="mo-bar-gap"></span><button type="button" class="mo-fmt" data-fmt="sub" title="Subscript (Ctrl+=)" aria-label="Subscript">X<sub>2</sub></button><button type="button" class="mo-fmt" data-fmt="sup" title="Superscript (Ctrl+Shift+=)" aria-label="Superscript">X<sup>2</sup></button>';

/** A name as the drawing keeps it: its text (with _{ } and ^{ } where needed) and its pieces when they hold more. */
export type RichName = { label: string; rich?: LabelPart[] };

/** What a field holds, with spaces at its ends trimmed, as a name. */
export function nameFromField(f: RichField): RichName {
  const parts = f.parts().map((p) => ({ ...p }));
  if (parts.length) { parts[0].text = parts[0].text.replace(/^\s+/, ''); parts[parts.length - 1].text = parts[parts.length - 1].text.replace(/\s+$/, ''); }
  return labelFromParts(parts.filter((p) => p.text));
}

export interface NameFields {
  /** The bar: put it in the window above the boxes. */
  bar: HTMLElement;
  /** A box for a name; `changed` hears every change to it. */
  field(name: RichName, label: string, changed: (n: RichName) => void, more?: Partial<RichFieldOptions>): RichField;
}

/** Rich name boxes sharing one formatting bar; `changed` hears any change (to redraw a preview). */
export function nameFields(changed: () => void): NameFields {
  let active: RichField | null = null;
  const bar = document.createElement('div');
  bar.className = 'mo-bar energy-bar';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Name formatting');
  bar.innerHTML = NAME_BAR_HTML;
  const typing = () => (active && document.activeElement === active.el ? active : null);
  const showState = () => {
    const r = typing();
    for (const b of bar.querySelectorAll<HTMLButtonElement>('button')) b.disabled = !r;
    for (const b of bar.querySelectorAll<HTMLButtonElement>('[data-look]')) b.setAttribute('aria-pressed', String(!!r?.hasLook(b.dataset.look as 'bold')));
    for (const b of bar.querySelectorAll<HTMLButtonElement>('[data-fmt]')) b.setAttribute('aria-pressed', String(!!r?.state(b.dataset.fmt as 'sub')));
  };
  // pressing a button keeps the cursor where it is
  bar.addEventListener('mousedown', (e) => { if ((e.target as HTMLElement).closest('button')) e.preventDefault(); });
  for (const b of bar.querySelectorAll<HTMLButtonElement>('[data-look]')) b.addEventListener('click', () => { typing()?.toggleLook(b.dataset.look as 'bold' | 'italic' | 'underline'); showState(); });
  for (const b of bar.querySelectorAll<HTMLButtonElement>('[data-fmt]')) b.addEventListener('click', () => { typing()?.toggle(b.dataset.fmt as 'sub' | 'sup'); showState(); });
  showState();
  return {
    bar,
    field(name, label, onName, more = {}) {
      let f: RichField | null = null;
      let was = JSON.stringify(name);
      // (only a change of words or looks is told: moving the cursor is not)
      const tell = () => {
        if (!f) return;
        const n = nameFromField(f), k = JSON.stringify(n);
        if (k === was) return;
        was = k;
        onName(n);
        changed();
      };
      f = new RichField(labelParts(name.label, name.rich), {
        label, placeholder: '', looks: true, chem: () => true, done: () => tell(),
        onState: (x) => { if (x === active) showState(); tell(); },
        ...more,
      });
      f.el.classList.add('mo-rich', 'energy-rich');
      f.el.addEventListener('focus', () => { active = f; showState(); });
      f.el.addEventListener('blur', () => setTimeout(showState));
      return f;
    },
  };
}
