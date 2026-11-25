// @vitest-environment jsdom
//
// Selecting a whole MO diagram (its frame and every caption and line in it, as a selection box or
// Ctrl+A makes) shows the same Side Panel settings as selecting its frame alone. The settings do
// not show when something that is not part of the diagram is selected too.
import { describe, expect, it } from 'vitest';
import { Doc } from '../src/model';
import { ACS_1996 } from '../src/style';
import { POINTS } from '../src/editor/arrange';
import { newDSplitPlate, newPlate, putPlate } from '../src/design/plates';
import { setMolecule, MO_MOLECULES } from '../src/design/mo';
import { StylePanel } from '../src/ui/style-panel';
import type { Selection } from '../src/editor/editor';

function build(kind: 'h2' | 'dsplit' | 'molecule') {
  const doc = new Doc();
  doc.style = { ...ACS_1996 };
  const L = doc.style.bondLength;
  let d = kind === 'dsplit' ? newDSplitPlate(L) : newPlate('mo', L);
  if (kind === 'molecule') d = { ...d, mo: setMolecule(d.mo!, MO_MOLECULES[0].id) };
  let id = 0;
  doc.edit('MO', () => { id = putPlate(doc, POINTS, d, { x: 100, y: 100 }); });
  return { doc, id };
}

function rows(doc: Doc, sel: () => Selection): { title: string; labels: string[] } {
  const section = document.createElement('section'), body = document.createElement('div');
  section.append(Object.assign(document.createElement('h2'), { textContent: 'Style' }));
  const p = new StylePanel(section, body, doc, sel, () => {});
  p.refresh(true);
  return { title: section.querySelector('h2')!.textContent ?? '', labels: [...body.querySelectorAll('.style-row')].map((r) => r.firstElementChild?.textContent ?? '') };
}

const none = (): Selection => ({ atoms: new Set(), bonds: new Set(), captions: new Set(), arrows: new Set(), shapes: new Set() });

for (const kind of ['h2', 'dsplit', 'molecule'] as const) {
  describe(`selecting a whole ${kind} MO diagram`, () => {
    it('shows the settings the frame alone shows', () => {
      const { doc, id } = build(kind);
      const f = doc.shapes.get(id)!.frame!;
      expect(f.shapes.length + f.captions.length).toBeGreaterThan(2);
      const alone = rows(doc, () => ({ ...none(), shapes: new Set([id]) }));
      expect(alone.labels.length).toBeGreaterThan(0);
      const whole = rows(doc, () => ({ ...none(), shapes: new Set([id, ...f.shapes]), captions: new Set(f.captions) }));
      expect(whole).toEqual(alone);
      // (what Ctrl+A selects)
      const all = rows(doc, () => ({ ...none(), shapes: new Set(doc.shapes.keys()), captions: new Set(doc.captions.keys()) }));
      expect(all).toEqual(alone);
    });

    it('does not show them when something else is selected too', () => {
      const { doc, id } = build(kind);
      const f = doc.shapes.get(id)!.frame!;
      const alone = rows(doc, () => ({ ...none(), shapes: new Set([id]) }));
      let other = 0;
      doc.edit('Add', () => { other = doc.addCaption({ x: 0, y: 0, runs: [{ text: 'note' }], justify: 'left', chem: false }).id; });
      const mixed = rows(doc, () => ({ ...none(), shapes: new Set([id, ...f.shapes]), captions: new Set([...f.captions, other]) }));
      expect(mixed.labels).not.toEqual(alone.labels);
      let atom = 0;
      doc.edit('Atom', () => { atom = doc.addAtom(5, 5).id; });
      const withAtom = rows(doc, () => ({ ...none(), shapes: new Set([id, ...f.shapes]), captions: new Set(f.captions), atoms: new Set([atom]) }));
      expect(withAtom.labels).not.toEqual(alone.labels);
    });
  });
}
