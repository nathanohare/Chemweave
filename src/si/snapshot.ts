// Home ▸ Save Snapshot in the SI Project tab: the whole project zipped, as Chem SI Assistant saves
// snapshots, for milestones such as "submitted version": snapshots/<date>_<time>_<label>.zip
// inside the project, holding the project folder (by its own name) without build/, snapshots/,
// the .lock or other hidden files, or the Word snapshot (snapshot-docx.ts: it is made again from
// the project, and can be large). Files that are compressed already (PDFs, pictures, zips) are
// stored as they are, which is much faster.

import { zipSync, type Zippable } from 'fflate';
import { slugify } from './ids';
import { SiProjectError, type SiProject } from './project';
import { besideFolderOf, isSnapshotDocx } from './snapshot-docx';

export const SNAPSHOTS_DIR = 'snapshots';
const SKIP_TOP = new Set(['build', SNAPSHOTS_DIR]);
const STORED = /\.(pdf|png|jpe?g|gif|zip|docx|xlsx|pptx|7z|gz|mp4|tif?f|webp)$/i;
const join = (...parts: string[]): string => parts.filter(Boolean).join('/');
const pad = (n: number): string => String(n).padStart(2, '0');

/** Every file of the project that goes in a snapshot, as paths from the project folder. */
export async function snapshotFiles(p: SiProject): Promise<string[]> {
  const out: string[] = [];
  const walk = async (rel: string): Promise<void> => {
    for (const e of await p.folder.entries(rel)) {
      if (!rel && (SKIP_TOP.has(e.name) || (!e.folder && isSnapshotDocx(e.name)))) continue;
      if (e.name.startsWith('.tmp-') || e.name.startsWith('.')) continue;
      const path = join(rel, e.name);
      if (e.folder) await walk(path); else out.push(path);
    }
  };
  await walk('');
  return out.sort();
}

/**
 * Zip the project into snapshots/ and give the snapshot's path from the project folder. A
 * project file's snapshots go beside the file instead, in "<file name> Snapshots" (inside the
 * file, each would make the file to share, and every save, bigger by a whole project); the path
 * is then from the file's folder.
 */
export async function saveSnapshot(p: SiProject, label = '', now = new Date()): Promise<string> {
  if (p.readOnly) throw new SiProjectError('This SI project is open read-only.');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const name = label.trim() ? `${stamp}_${slugify(label, 40)}` : stamp;
  const top = p.folder.where.replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop() || 'SI project';
  const tree: Zippable = {};
  for (const f of await snapshotFiles(p)) {
    const bytes = await p.folder.readBytes(f);
    if (!bytes) continue;
    tree[`${top}/${f}`] = [bytes, { level: STORED.test(f) ? 0 : 6 }];
  }
  const zip = zipSync(tree, { mtime: now });
  const beside = besideFolderOf(p);
  const into = beside ?? p.folder;
  const dir = beside ? `${(p.file ?? '').replace(/\\/g, '/').split('/').pop()?.replace(/\.[^.]*$/, '') || top} Snapshots` : SNAPSHOTS_DIR;
  let dest = join(dir, `${name}.zip`);
  for (let n = 2; await into.exists(dest); n++) dest = join(dir, `${name} (${n}).zip`);
  await into.writeBytes(dest, zip);
  return dest;
}
