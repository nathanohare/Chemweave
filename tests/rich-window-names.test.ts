// @vitest-environment jsdom
//
// Rich text boxes in the TLC Plate, Gel and Diagram windows, as the Energy Diagram window has
// (F3 Needs Nate 1, Nate: yes; F8b item 5): what is typed shows as drawn, bold, italic and
// underline are kept, and the drawing uses them while they still spell the words.
import { afterEach, describe, expect, it } from 'vitest';
import { Doc } from '../src/model';
import { POINTS } from '../src/editor/arrange';
import { askPlate } from '../src/ui/plate-dialog';
import { askDiagram } from '../src/ui/diagram-dialog';
import { newPlate, putPlate, type PlateData } from '../src/design/plates';
import { newDiagram, putDiagram, type DiagramData } from '../src/design/diagrams';
import { fromRows, rowsOf, sliceParts } from '../src/design/diagram-rows';
import { writeCdxml } from '../src/io/cdxml-write';
import { readCdxml } from '../src/io/cdxml';

HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true; };
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.open = false; };

afterEach(() => { for (const d of document.querySelectorAll('dialog')) d.remove(); });

const captionsOf = (doc: Doc) => [...doc.captions.values()].map((c) => c.runs);

describe('TLC Plate window', () => {
  it('shows lane names and the eluent in rich boxes with a formatting bar, and keeps their looks', async () => {
    const d: PlateData = { ...newPlate('tlc', 14.4), lanes: [{ label: 'SM', marks: '0.5', labelRich: [{ text: 'SM', bold: true }] }], note: 'CH2Cl2', noteRich: [{ text: 'CH' }, { text: '2', sub: true }, { text: 'Cl' }, { text: '2', sub: true }] };
    const got = askPlate('tlc', d, 14.4);
    const dlg = document.querySelector('dialog.plate-dialog')!;
    expect(dlg.querySelector('.energy-bar [data-look=bold]')).toBeTruthy();
    const lane = dlg.querySelector<HTMLElement>('.plate-name')!;
    expect(lane.getAttribute('role')).toBe('textbox');
    expect(lane.querySelector('span')?.style.fontWeight).toBe('bold');
    const eluent = dlg.querySelector<HTMLElement>('.plate-note')!;
    expect(eluent.querySelectorAll('sub')).toHaveLength(2);
    expect(dlg.querySelector('input[name=note]')).toBeNull();
    dlg.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    const out = (await got)!;
    expect(out.lanes[0]).toMatchObject({ label: 'SM', labelRich: [{ text: 'SM', bold: true }] });
    expect(out.note).toBe('CH2Cl2');
  });

  it('draws a lane name bold while its pieces spell it, and plainly once the name is changed', () => {
    const doc = new Doc();
    const d: PlateData = { ...newPlate('tlc', 14.4), rf: false, lanes: [{ label: 'SM', marks: '0.5', labelRich: [{ text: 'SM', bold: true }] }] };
    doc.edit('TLC', () => { putPlate(doc, POINTS, d, { x: 0, y: 0 }); });
    expect(captionsOf(doc).some((r) => r.some((x) => x.text === 'SM' && x.bold))).toBe(true);
    const doc2 = new Doc();
    doc2.edit('TLC', () => { putPlate(doc2, POINTS, { ...d, lanes: [{ ...d.lanes[0], label: 'P' }] }, { x: 0, y: 0 }); });
    expect(captionsOf(doc2).some((r) => r.some((x) => x.text === 'P' && !x.bold))).toBe(true);
  });
});

describe('Diagram window rows', () => {
  it('reads the text as rows with levels, an icon kept in front, and the looks of the items', () => {
    const rows = rowsOf({ text: 'Mix\n\t[flask] Heat\nWork up', rich: { 2: [{ text: 'Heat', italic: true }] } });
    expect(rows.map((r) => [r.level, r.label])).toEqual([[0, 'Mix'], [1, '[flask] Heat'], [0, 'Work up']]);
    expect(rows[1].rich).toEqual([{ text: '[flask] ' }, { text: 'Heat', italic: true }]);
    expect(fromRows(rows)).toEqual({ text: 'Mix\n\t[flask] Heat\nWork up', rich: { 2: [{ text: 'Heat', italic: true }] } });
  });
  it('drops looks that no longer spell their line, and keeps none for plain rows', () => {
    expect(rowsOf({ text: 'Mix\nCool', rich: { 2: [{ text: 'Heat', bold: true }] } })[1].rich).toBeUndefined();
    expect(fromRows([{ level: 0, label: 'Mix' }]).rich).toBeUndefined();
    expect(sliceParts([{ text: 'ab' }, { text: 'cd', bold: true }], 1, 3)).toEqual([{ text: 'b' }, { text: 'c', bold: true }]);
  });
  it('draws an item bold in its shape', () => {
    const doc = new Doc();
    const d: DiagramData = { ...newDiagram('process', 'Mix\nHeat'), rich: { 2: [{ text: 'Heat', bold: true }] } };
    doc.edit('Diagram', () => { putDiagram(doc, POINTS, d, { x: 0, y: 0 }); });
    const runs = [...doc.shapes.values()].flatMap((s) => s.text?.runs ?? []);
    expect(runs.some((r) => r.text === 'Heat' && r.bold)).toBe(true);
    expect(runs.some((r) => r.text === 'Mix' && !r.bold)).toBe(true);
  });
  it('the window shows one rich box per item, and gives the looks back', async () => {
    const editing: DiagramData = { ...newDiagram('process', 'Mix\n\tHeat'), rich: { 2: [{ text: 'Heat', underline: true }] } };
    const got = askDiagram(editing, { preview: () => '', scale: 1 });
    const dlg = document.querySelector('dialog.diagram-dialog')!;
    expect(dlg.querySelector('textarea')).toBeNull();
    const boxes = [...dlg.querySelectorAll<HTMLElement>('.dg-row')];
    expect(boxes).toHaveLength(2);
    expect(boxes[1].style.marginLeft).toBe('1.25em');
    expect(boxes[1].querySelector('span')?.style.textDecoration).toBe('underline');
    dlg.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    const out = (await got)!;
    expect(out.text).toBe('Mix\n\tHeat');
    expect(out.rich).toEqual({ 2: [{ text: 'Heat', underline: true }] });
  });
});

describe('the looks are saved with the drawing', () => {
  it('keeps a plate\'s and a diagram\'s rich names through CDXML', () => {
    const doc = new Doc();
    const plate: PlateData = { ...newPlate('tlc', 14.4), lanes: [{ label: 'SM', marks: '0.5', labelRich: [{ text: 'SM', italic: true }] }], note: 'hexanes', noteRich: [{ text: 'hexanes', bold: true }] };
    const diagram: DiagramData = { ...newDiagram('process', 'Mix\nHeat'), rich: { 2: [{ text: 'Heat', bold: true }] } };
    doc.edit('Add', () => { putPlate(doc, POINTS, plate, { x: 0, y: 0 }); putDiagram(doc, POINTS, diagram, { x: 0, y: 300 }); });
    const back = readCdxml(writeCdxml(doc)).doc;
    const p = [...back.shapes.values()].find((s) => s.plate)?.plate;
    expect(p?.lanes[0].labelRich).toEqual([{ text: 'SM', italic: true }]);
    expect(p?.noteRich).toEqual([{ text: 'hexanes', bold: true }]);
    expect([...back.shapes.values()].find((s) => s.diagram)?.diagram?.rich).toEqual({ 2: [{ text: 'Heat', bold: true }] });
  });
});
