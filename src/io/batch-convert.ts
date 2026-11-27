// File > Export > Batch Convert: many drawings or structure files turned into one other format at
// once (CDXML, CDX, molfile, SVG, PNG or a SMILES list), saved in a zip or a folder. Each record of
// an SD file and each line of a SMILES file becomes a file of its own.

import { Doc } from '../model';
import type { DocStyle } from '../style';
import { readCdxml } from './cdxml';
import { writeCdxml } from './cdxml-write';
import { cdxToCdxml, cdxmlToCdx } from './cdx';
import { toMolfile } from '../chem/molfile';
import { chemFormatOf, readScene, sceneToDoc } from './chem-formats';
import { allSpecies } from '../chem/species';
import { recordPicture, pictureCanvas, canvasPng, pictureSvg } from '../render/picture';
import { pngWithDpi } from '../render/emf-read';

export type BatchFormat = 'cdxml' | 'cdx' | 'mol' | 'svg' | 'png' | 'smi';

/** What can be read: ChemDraw drawings, molfiles, SD files, SMILES lists, and RXN, Marvin, Ketcher, CML and ChemDoodle files. */
export const BATCH_INPUTS = ['cdxml', 'cdx', 'mol', 'sdf', 'sd', 'smi', 'smiles', 'rxn', 'mrv', 'ket', 'cml', 'json'];

export const BATCH_FORMATS: { value: BatchFormat; label: string }[] = [
  { value: 'cdxml', label: 'CDXML (ChemDraw XML, opens here and in ChemDraw)' },
  { value: 'cdx', label: 'CDX (binary ChemDraw)' },
  { value: 'mol', label: 'Molfile (V2000, for databases and other programs)' },
  { value: 'svg', label: 'SVG picture (stays sharp)' },
  { value: 'png', label: 'PNG picture' },
  { value: 'smi', label: 'SMILES list (one file: SMILES and name on each line)' },
];

export interface BatchItem { name: string; doc: Doc }

export interface BatchDeps {
  /** The style molfiles and SMILES are drawn in (the current drawing style). */
  style: DocStyle;
  smilesToMol(smiles: string): Promise<string | null>;
  molToSmiles(molblock: string): Promise<string | null>;
}

/**
 * The records of an SD file, each with the name on its first line (or "" when it has none). A
 * record with no "M  END" (cut short, or only data fields) comes with an empty molblock, so it is
 * counted as one that can't be read (review F533); only blank text between records is passed over.
 */
export function splitSdf(text: string): { name: string; molblock: string }[] {
  const out: { name: string; molblock: string }[] = [];
  // (a record's first line, its name, may be blank, so only the line ending after $$$$ goes)
  for (const body of text.replace(/\r\n?/g, '\n').split(/^\$\$\$\$[ \t]*\n?/m)) {
    const end = body.indexOf('M  END');
    if (end < 0) { if (body.trim()) out.push({ name: body.split('\n')[0].trim(), molblock: '' }); continue; }
    const molblock = body.slice(0, end + 6) + '\n';
    out.push({ name: molblock.split('\n')[0].trim(), molblock });
  }
  return out;
}

/** The lines of a SMILES file: the SMILES, then an optional name after a space or tab. */
export function splitSmilesList(text: string): { name: string; smiles: string }[] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    .map((l) => { const m = /^(\S+)(?:\s+(.*))?$/.exec(l)!; return { smiles: m[1], name: (m[2] ?? '').trim() }; })
    .filter((x) => !/^smiles$/i.test(x.smiles));
}

/**
 * Names Windows keeps for devices, whatever follows them after a dot (Microsoft, "Naming Files,
 * Paths, and Namespaces": CON, PRN, AUX, NUL, COM1 to COM9, LPT1 to LPT9).
 */
const RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
/** For each set of names used, the next number to try for each name (so many equal names don't each count up from 2). */
const nextNumber = new WeakMap<Set<string>, Map<string, number>>();

/** A file name safe on Windows and Mac, made different from the ones used already. */
export function uniqueName(stem: string, ext: string, used: Set<string>): string {
  // (cut to length first, so no dot or space is left at the end; a device name gets a _ before it; review F534)
  let clean = stem.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 120).replace(/[. ]+$/, '') || 'structure';
  if (RESERVED.test(clean.split('.')[0].trim())) clean = `_${clean}`;
  let name = `${clean}.${ext}`;
  const key = name.toLowerCase();
  let next = nextNumber.get(used);
  if (!next) nextNumber.set(used, (next = new Map()));
  // (counting on from the number the last name like this one got; review F535)
  for (let i = next.get(key) ?? 2; used.has(name.toLowerCase()); i++) { name = `${clean} (${i}).${ext}`; next.set(key, i + 1); }
  used.add(name.toLowerCase());
  return name;
}

/**
 * As uniqueName, and also not the name of a file already in the folder written to (`taken` says
 * whether one is), so converting into a folder never writes over a file there: the new file
 * gets a " (2)" name instead. A folder that can't be checked (`taken` fails) stops it, with why.
 */
export async function freeBatchName(stem: string, ext: string, used: Set<string>, taken: (name: string) => Promise<boolean>): Promise<string> {
  for (let tries = 0; tries < 10000; tries++) {
    const name = uniqueName(stem, ext, used);
    if (!(await taken(name))) return name;
  }
  throw new Error(`every name for ${stem}.${ext} is taken in the folder`);
}

const stemOf = (file: string) => file.replace(/\.[^.\\/]+$/, '');
const extensionOf = (file: string) => /\.([^.\\/]+)$/.exec(file)?.[1].toLowerCase() ?? '';

function molDoc(molblock: string, style: DocStyle): Doc | null {
  return sceneDoc('x.mol', molblock, style);
}

/** A molfile (V2000 or V3000), RXN, Marvin, Ketcher, CML or ChemDoodle file as a drawing, or null. */
function sceneDoc(file: string, text: string, style: DocStyle): Doc | null {
  const fmt = chemFormatOf(file, text);
  const scene = fmt ? readScene(fmt, text) : null;
  if (!scene) return null;
  try {
    const d = sceneToDoc(scene, style).doc;
    return d.atoms.size ? d : null;
  } catch {
    return null;
  }
}

/**
 * The drawings in one file: one for a drawing or molfile, one per record of an SD file or line of
 * a SMILES file. Records that can't be read are counted in `failed`.
 */
export async function readBatchFile(file: string, bytes: Uint8Array, deps: BatchDeps): Promise<{ items: BatchItem[]; failed: number }> {
  const ext = extensionOf(file), stem = stemOf(file);
  const text = () => new TextDecoder().decode(bytes);
  const items: BatchItem[] = [];
  let failed = 0;
  if (ext === 'cdx') items.push({ name: stem, doc: readCdxml(cdxToCdxml(bytes)).doc });
  else if (ext === 'cdxml') items.push({ name: stem, doc: readCdxml(text()).doc });
  else if (['mol', 'rxn', 'mrv', 'ket', 'cml', 'json'].includes(ext)) { const d = sceneDoc(file, text(), deps.style); if (d) items.push({ name: stem, doc: d }); else failed++; }
  else if (ext === 'sdf' || ext === 'sd') {
    splitSdf(text()).forEach((r, i) => {
      const d = molDoc(r.molblock, deps.style);
      if (d) items.push({ name: r.name || `${stem}_${i + 1}`, doc: d }); else failed++;
    });
  } else if (ext === 'smi' || ext === 'smiles') {
    let i = 0;
    for (const r of splitSmilesList(text())) {
      i++;
      const mb = await deps.smilesToMol(r.smiles).catch(() => null);
      const d = mb ? molDoc(mb, deps.style) : null;
      if (d) items.push({ name: r.name || `${stem}_${i}`, doc: d }); else failed++;
    }
  } else failed++;
  return { items, failed };
}

/** One drawing in the chosen format. Null when there is nothing to write (an empty drawing). */
export async function writeBatchItem(it: BatchItem, format: Exclude<BatchFormat, 'smi'>, dpi = 300): Promise<Uint8Array | string | null> {
  const d = it.doc;
  switch (format) {
    case 'cdxml': return writeCdxml(d);
    case 'cdx': return cdxmlToCdx(writeCdxml(d, { cdx: true }));
    case 'mol': return d.atoms.size ? toMolfile(d, d.atoms.keys(), it.name, { species: allSpecies(d) }).molblock : null;
    case 'svg': { const p = recordPicture(d, 4); return p ? pictureSvg(p) : null; }
    case 'png': {
      const p = recordPicture(d, 4);
      if (!p) return null;
      const { canvas, dpi: got } = pictureCanvas(d, p, dpi);
      return pngWithDpi(new Uint8Array(await (await canvasPng(canvas)).arrayBuffer()), got);
    }
  }
}

/** A line of a SMILES list for one drawing (null when it has no structure, or one SMILES can't show). */
export async function smilesLine(it: BatchItem, deps: BatchDeps): Promise<string | null> {
  const d = it.doc;
  if (!d.atoms.size) return null;
  const { molblock, unknownLabels } = toMolfile(d, d.atoms.keys(), '', { species: allSpecies(d) });
  if (unknownLabels.length) return null;
  const smi = await deps.molToSmiles(molblock).catch(() => null);
  return smi ? `${smi}\t${it.name}` : null;
}
