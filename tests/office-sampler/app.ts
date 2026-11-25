/**
 * Opens and saves a file the way the app does: Workspace.openBytes and Workspace.encode with the
 * real file code for Word, PowerPoint and Excel (as src/main.ts wires it, and as
 * tests/open-save-compare.test.ts does). Pictures of drawings are stood in for by a fixed PNG; a
 * ChemDraw object in a Word file is read through CDX to CDXML as the app's docRead does.
 *
 * The test that imports this must mock '@tauri-apps/api/core' first (no desktop shell here).
 */
import { Doc } from '../../src/model';
import { Workspace, type WorkspaceHooks } from '../../src/workspace';
import { type PptxOptions } from '../../src/io/pptx-write';
import { readSheetFile, writeSheetFile, type SheetFileDeps } from '../../src/io/sheet-files';
import { readDocumentFile, writeDocumentFile } from '../../src/io/doc-files';
import { type DocxDeps, type DocxReadDeps } from '../../src/io/docx';
import { readCdxml } from '../../src/io/cdxml';
import { cdxToCdxml } from '../../src/io/cdx';
import { png } from './kit';

const PNG = png(40, 30);
const pptx: PptxOptions = { async picture(d) { const b = d.bounds(); return b ? { png: PNG, svg: '<svg xmlns="http://www.w3.org/2000/svg"/>', box: b } : null; }, async svgToPng() { return PNG; } };
const docx: DocxDeps = { async picture() { return { png: PNG, w: 80, h: 40 }; }, async svgToPng() { return PNG; } };
const docRead: DocxReadDeps = {
  convertChemDraw: false,
  chemdraw: (cdx) => readCdxml(cdxToCdxml(cdx)).doc.contents(),
  cdxml: (text) => readCdxml(text).doc.contents(),
};
const sheets: SheetFileDeps = { box: () => ({ w: 60, h: 40 }), picture: async () => PNG, settled: async () => {} };

function workspace(): Workspace {
  const hooks: WorkspaceHooks = {
    leave: () => {}, enter: () => {}, changed: () => {}, flash: () => {},
    pptx,
    measure: (t: string, s: number) => t.length * s * 0.5,
    sheets: { read: (b, name) => readSheetFile(b, name, sheets), write: (book, name) => writeSheetFile(book, name, sheets) },
    documents: { read: (b, name) => readDocumentFile(b, name, docRead), write: (t, name) => writeDocumentFile(t, name, docx) },
  };
  return new Workspace(new Doc(), hooks);
}

/** Open `bytes` as `name` and save it unchanged. Throws when it doesn't open. */
export async function openAndSave(bytes: Uint8Array, name: string): Promise<Uint8Array> {
  const ws = workspace();
  if (!(await ws.openBytes(bytes, name))) throw new Error(`${name} did not open`);
  const d = (await ws.encode(ws.active, name)).data;
  return typeof d === 'string' ? new TextEncoder().encode(d) : d;
}
