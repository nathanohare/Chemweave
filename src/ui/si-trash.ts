// Home ▸ Trash in the SI Project tab: the project's Trash (its trash/ folder, shared with Chem SI
// Assistant), newest first: what each item was, where it came from, when and by whom it was
// deleted. Restore puts the selected item back; Delete removes it for good; Empty Trash deletes
// everything (both ask first). Items Chemweave can't put back say so, and SI Assistant restores them.

import { showDialog } from './dialog-host';
import { addInfo } from './info-tip';
import { askChoice } from './ask';
import { journalOf } from '../si/journal';
import { deleteFromTrash, emptyTrash, KIND_NAMES, listTrash, restoreFromTrash, RESTORABLE, type TrashEntry } from '../si/trash';
import type { SiProject } from '../si/project';

const when = (iso: string): string => {
  const d = new Date(iso);
  return iso && !Number.isNaN(d.getTime()) ? d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
};

/** Where an item came from, as a short phrase ("from Synthesis"). */
function origin(e: TrashEntry): string {
  const i = e.info;
  const s = (k: string): string => (typeof i[k] === 'string' ? (i[k] as string) : '');
  const from = s('section_name') || s('owner_name') || s('compound_name') || s('scheme_name');
  return from ? `from “${from}”` : '';
}

/**
 * Open the Trash window. `changed` is called after something was put back (the project has been
 * read again), so the tree and page are drawn again.
 */
export async function openTrash(p: SiProject, changed: (message: string) => void): Promise<void> {
  const d = document.createElement('dialog');
  d.className = 'ask si-trash';
  const form = document.createElement('form');
  form.className = 'ask-form';
  form.addEventListener('submit', (e) => e.preventDefault());
  const h = document.createElement('h2');
  h.textContent = 'Trash';
  addInfo(h, 'What was deleted from this project, newest first. The Trash is the project folder’s trash folder, shared with Chem SI Assistant: either program can put items back. Sections, compounds, scheme pages, general procedures, figures, tables and files are restored here; the rest (old pasted scheme pictures, manuscript check files, unfinished deletions) in Chem SI Assistant.');
  const list = document.createElement('div');
  list.className = 'si-trash-list';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Deleted items');
  const say = document.createElement('p');
  say.className = 'muted si-trash-say';
  const buttons = document.createElement('p');
  buttons.className = 'ask-buttons';
  const button = (text: string, title: string, primary = false): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.title = title;
    if (primary) b.className = 'primary';
    return b;
  };
  const empty = button('Empty Trash', 'Delete everything in the Trash permanently (it asks first)');
  const del = button('Delete', 'Delete the selected item permanently (it asks first)');
  const close = button('Close', '');
  const restore = button('Restore', 'Restore the selected item to where it was', true);
  buttons.append(empty, del, close, restore);
  form.append(h, list, say, buttons);
  d.append(form);

  let entries: TrashEntry[] = [];
  let picked = '';
  const update = (): void => {
    const e = entries.find((x) => x.id === picked);
    restore.disabled = !e || !RESTORABLE.has(e.kind) || p.readOnly;
    del.disabled = !e || p.readOnly;
    empty.disabled = !entries.length || p.readOnly;
    for (const r of list.querySelectorAll<HTMLElement>('.si-trash-row')) {
      const on = r.dataset.id === picked;
      r.classList.toggle('on', on);
      r.setAttribute('aria-selected', String(on));
    }
  };
  const draw = async (): Promise<void> => {
    entries = await listTrash(p);
    if (!entries.some((x) => x.id === picked)) picked = entries[0]?.id ?? '';
    list.replaceChildren();
    if (!entries.length) {
      const none = document.createElement('p');
      none.className = 'muted si-trash-none';
      none.textContent = 'The Trash is empty.';
      list.append(none);
    }
    for (const e of entries) {
      const r = document.createElement('div');
      r.className = 'si-trash-row';
      r.dataset.id = e.id;
      r.setAttribute('role', 'option');
      r.tabIndex = -1;
      const kind = document.createElement('span');
      kind.className = 'si-trash-kind';
      kind.textContent = KIND_NAMES[e.kind] ?? e.kind;
      const name = document.createElement('span');
      name.className = 'si-trash-name';
      name.textContent = e.name;
      const more = document.createElement('span');
      more.className = 'si-trash-more muted';
      more.textContent = [origin(e), when(e.deletedAt), e.deletedBy ? `by ${e.deletedBy}` : ''].filter(Boolean).join(' · ');
      if (!RESTORABLE.has(e.kind)) { r.classList.add('si-trash-elsewhere'); r.title = 'Restored in Chem SI Assistant'; }
      r.append(kind, name, more);
      r.addEventListener('click', () => { picked = e.id; say.textContent = ''; update(); });
      r.addEventListener('dblclick', () => { picked = e.id; void doRestore(); });
      list.append(r);
    }
    update();
  };
  // (each thing done here is one step of Undo, named as its button; `sure` asks first, before the step begins, so nothing saved while the question is open joins it)
  const busy = async (f: () => Promise<void>, label: string, sure?: () => Promise<boolean>): Promise<void> => {
    for (const b of [restore, del, empty]) b.disabled = true;
    const j = journalOf(p.folder);
    try {
      if (sure && !(await sure())) { update(); return; }
      await (j ? j.step(label, f) : f());
    } catch (err) {
      say.textContent = err instanceof Error ? err.message : String(err);
    }
    await draw();
  };
  const doRestore = (): Promise<void> => busy(async () => {
    const e = entries.find((x) => x.id === picked);
    if (!e || !RESTORABLE.has(e.kind)) return;
    const message = await restoreFromTrash(p, e.id);
    say.textContent = message;
    changed(message);
  }, 'Restore');
  restore.addEventListener('click', () => void doRestore());
  del.addEventListener('click', () => {
    const e = entries.find((x) => x.id === picked);
    if (!e) return;
    void busy(async () => {
      await deleteFromTrash(p, e.id);
      say.textContent = `Deleted “${e.name}”.`;
    }, 'Delete from Trash', async () => (await askChoice('Delete from Trash', `Delete “${e.name}” permanently? Edit ▸ Undo brings it back while this step is still in the Undo history and the project is open; after that it can’t be restored, by Chemweave or by Chem SI Assistant.`, [{ value: 'keep', label: 'Cancel' }, { value: 'delete', label: 'Delete', primary: true }], 'keep')) === 'delete');
  });
  empty.addEventListener('click', () => void busy(async () => {
    await emptyTrash(p);
    say.textContent = 'The Trash was emptied.';
  }, 'Empty Trash', async () => (await askChoice('Empty Trash', `Delete all ${entries.length} item${entries.length === 1 ? '' : 's'} in the Trash permanently? Edit ▸ Undo brings them back while this step is still in the Undo history and the project is open; after that they can’t be restored, by Chemweave or by Chem SI Assistant.`, [{ value: 'keep', label: 'Cancel' }, { value: 'empty', label: 'Empty Trash', primary: true }], 'keep')) === 'empty'));
  close.addEventListener('click', () => d.close());
  list.addEventListener('keydown', (ev) => {
    if (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown' && ev.key !== 'Enter') return;
    ev.preventDefault();
    if (ev.key === 'Enter') { void doRestore(); return; }
    const i = entries.findIndex((x) => x.id === picked);
    const next = entries[Math.max(0, Math.min(entries.length - 1, i + (ev.key === 'ArrowUp' ? -1 : 1)))];
    if (next) { picked = next.id; update(); }
  });
  list.tabIndex = 0;
  d.addEventListener('close', () => d.remove());
  await draw();
  showDialog(d);
  list.focus();
}
