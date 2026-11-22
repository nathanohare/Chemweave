// A SMILES (or a CXSMILES with its |…| extras) as a molfile, by the chemistry engine (RDKit).

import { cxSmiles } from './reaction-io';

/** The parts of RDKit's JavaScript molecule this needs. */
interface EngineMol { is_valid(): boolean; set_new_coords(useCoordGen?: boolean): boolean; get_molblock(): string; get_v3Kmolblock(): string; delete(): void }

/**
 * A molfile for a SMILES, laid out by the engine; null when it can't be read. A CXSMILES (RDKit
 * reads its extras) is written as V3000, which keeps its enhanced stereo (and, or, abs groups),
 * and keeps its own coordinates when it has them.
 */
export function smilesMolblock(rdkit: { get_mol(s: string): EngineMol | null }, smiles: string): string | null {
  const cx = cxSmiles(smiles);
  const mol = rdkit.get_mol(smiles.trim());
  if (!mol || !mol.is_valid()) { mol?.delete(); return null; }
  if (!cx || !/(^|,)\(/.test(cx.extras)) mol.set_new_coords(true);
  const mb = cx ? mol.get_v3Kmolblock() : mol.get_molblock();
  mol.delete();
  return mb;
}
