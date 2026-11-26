// Installing an update restarts the desktop app. Just before it closes, every open tab is written
// down (in order, with the tab showing, the split screen, each tab's zoom and the slide it was on),
// and each tab with unsaved changes, or never saved, is copied into the app's own folder (as
// recovery copies are). The files on disk are not touched. The first start after that opens the
// tabs again as they were: unsaved tabs come back unsaved, with their files still theirs, so the
// update loses nothing and asks nothing (Nate, 2026-11-26).

import type { Workspace, Tab } from '../workspace';
import type { View } from '../render/renderer';
import type { FileStamp } from './recovery';
import type { KeepStore } from './store';
import { getText, putText } from './store';
import { readPath, baseName, extensionOf, type FileRef } from '../io/files';

const FOLDER = 'restart';
const LIST = 'tabs.json';

/** An SI project as the restart keeps it: its file, and its working copy when it holds unsaved changes. */
export interface RestartSi {
  file: string | null;
  stamp: FileStamp | null;
  /** The working copy (kept, not discarded, as the app closes) when it has changes not saved to the file. */
  working?: { working: string; root: string };
  title: string;
}

/** One tab as it was. */
export interface RestartTab {
  name: string;
  mode: string;
  /** Its file on disk, if it has one. */
  path: string | null;
  stamp: FileStamp | null;
  /** Unsaved changes (or a tab never saved): the copy in the restart folder that holds them. */
  copy?: string;
  /** The copy is of a tab without unsaved changes (one never saved and never changed). */
  clean?: boolean;
  /** Another window of the document or workbook in this entry. */
  windowOf?: number;
  si?: RestartSi;
  autoSave?: boolean | null;
  view?: View;
  fitted?: boolean;
  /** Presentations and designs: the slide showing. */
  slide?: number;
}

export interface RestartList {
  kind: 'restart';
  made: number;
  tabs: RestartTab[];
  /** The tab showing, by position (-1: none of those kept). */
  active: number;
  /** Split screen: left and right, by position. */
  split?: [number, number];
}

export interface RestartHooks {
  /** The zoom and scroll on screen now, for the tab whose view is live (the pane beside, or the tab showing). */
  liveView(): { view: View; fitted: boolean } | null;
  /** An SI tab: its project's file and working copy, or null when it can't be kept (one held in memory only). */
  siOf?(tab: Tab): RestartSi | null;
  /** Open an SI project again: from its working copy when it has one, otherwise from its file. */
  openSi?(si: RestartSi): Promise<Tab | null>;
}

/**
 * Write down the open tabs and copy the unsaved ones, for the start after the update. Returns
 * the names of tabs that couldn't be kept (an empty list when everything was).
 */
export async function keepForRestart(ws: Workspace, store: KeepStore, hooks: RestartHooks, now = Date.now()): Promise<string[]> {
  await store.remove(FOLDER).catch(() => {});
  ws.noteChange();
  const lost: string[] = [];
  const tabs: RestartTab[] = [];
  const at = new Map<Tab, number>();
  const live = ws.pane ?? ws.active;
  const liveView = hooks.liveView();
  for (const t of ws.tabs) {
    if (t.windowOf) continue;
    const e: RestartTab = { name: t.name, mode: t.mode, path: t.ref.kind === 'path' ? t.ref.path : null, stamp: t.stamp };
    if (t.mode === 'si') {
      const si = hooks.siOf?.(t) ?? null;
      if (!si) { if (t.dirty) lost.push(t.name); continue; }
      e.si = si;
    } else if (t.dirty || t.ref.kind !== 'path') {
      try {
        const c = await ws.copyOf(t);
        const file = `tab-${tabs.length}.${(extensionOf(c.name) || 'bin').toLowerCase()}`;
        await store.put(`${FOLDER}/${file}`, c.data);
        e.copy = file;
        // (a tab never saved and never changed: it comes back as new as it was)
        if (!t.dirty) e.clean = true;
      } catch {
        lost.push(t.name);
        continue;
      }
    }
    if (typeof t.autoSave === 'boolean') e.autoSave = t.autoSave;
    const v = t === live ? liveView : t.view ? { view: t.view, fitted: !!t.fitted } : null;
    if (v) { e.view = { ...v.view }; e.fitted = v.fitted; }
    if (t.deck && t.deck.index > 0) e.slide = t.deck.index;
    at.set(t, tabs.length);
    tabs.push(e);
  }
  // other windows of a document or workbook (View ▸ New Window): opened again beside their file's tab
  for (const t of ws.tabs) {
    const m = t.windowOf ? at.get(t.windowOf) : undefined;
    if (m === undefined) continue;
    at.set(t, tabs.length);
    tabs.push({ name: t.name, mode: t.mode, path: null, stamp: null, windowOf: m });
  }
  const list: RestartList = { kind: 'restart', made: now, tabs, active: at.get(ws.active) ?? (ws.active.windowOf ? at.get(ws.active.windowOf) : undefined) ?? -1 };
  const l = ws.split ? at.get(ws.split.left) : undefined, r = ws.split ? at.get(ws.split.right) : undefined;
  if (l !== undefined && r !== undefined) list.split = [l, r];
  await putText(store, `${FOLDER}/${LIST}`, JSON.stringify(list));
  return lost;
}

/** The restart list kept before an update, or null (none, or not readable). */
export function parseRestart(text: string | null): RestartList | null {
  if (!text) return null;
  let r: unknown;
  try { r = JSON.parse(text); } catch { return null; }
  const o = r as Record<string, unknown>;
  if (!o || o.kind !== 'restart' || !Array.isArray(o.tabs)) return null;
  const num = (x: unknown) => (typeof x === 'number' && isFinite(x) ? x : undefined);
  const n = o.tabs.length;
  const idx = (x: unknown) => (Number.isInteger(x) && (x as number) >= 0 && (x as number) < n ? (x as number) : undefined);
  const tabs: RestartTab[] = (o.tabs as unknown[]).map((x) => {
    const t = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
    const stamp = (s: unknown): FileStamp | null => { const q = s as FileStamp | null; return q && typeof q.modified === 'number' && typeof q.size === 'number' ? { modified: q.modified, size: q.size } : null; };
    const e: RestartTab = { name: typeof t.name === 'string' ? t.name : 'Untitled', mode: String(t.mode ?? ''), path: typeof t.path === 'string' ? t.path : null, stamp: stamp(t.stamp) };
    if (typeof t.copy === 'string' && /^[A-Za-z0-9._-]+$/.test(t.copy)) e.copy = t.copy;
    if (t.clean === true) e.clean = true;
    const w = idx(t.windowOf);
    if (w !== undefined) e.windowOf = w;
    const si = t.si as Record<string, unknown> | undefined;
    if (si && typeof si === 'object') {
      const wk = si.working as Record<string, unknown> | undefined;
      e.si = { file: typeof si.file === 'string' ? si.file : null, stamp: stamp(si.stamp), title: typeof si.title === 'string' ? si.title : e.name,
        ...(wk && typeof wk.working === 'string' && typeof wk.root === 'string' ? { working: { working: wk.working, root: wk.root } } : {}) };
    }
    if (typeof t.autoSave === 'boolean') e.autoSave = t.autoSave;
    const v = t.view as Record<string, unknown> | undefined;
    if (v && num(v.scale) && num(v.ox) !== undefined && num(v.oy) !== undefined) { e.view = { scale: v.scale as number, ox: v.ox as number, oy: v.oy as number }; e.fitted = t.fitted === true; }
    const s = num(t.slide);
    if (s !== undefined && s >= 0) e.slide = Math.floor(s);
    return e;
  });
  const split = Array.isArray(o.split) && o.split.length === 2 ? [idx(o.split[0]), idx(o.split[1])] : null;
  return {
    kind: 'restart', made: num(o.made) ?? 0, tabs, active: idx(o.active) ?? -1,
    ...(split && split[0] !== undefined && split[1] !== undefined && split[0] !== split[1] ? { split: [split[0], split[1]] as [number, number] } : {}),
  };
}

/** Whether tabs were kept for a restart. */
export async function restartWaiting(store: KeepStore): Promise<boolean> {
  return !!parseRestart(await getText(store, `${FOLDER}/${LIST}`).catch(() => null));
}

/** The update didn't install after all: the list and copies aren't needed (the tabs are still open). */
export function forgetRestart(store: KeepStore): Promise<void> {
  return store.remove(FOLDER);
}

export interface RestartResult {
  /** Tabs opened again. */
  opened: number;
  /** Files that are no longer where they were. */
  missing: string[];
  /** Unsaved copies that couldn't be opened (kept for the next start). */
  failed: string[];
}

/**
 * The first start after an update: open the tabs kept for it, as they were, then forget the list.
 * Null when there was nothing kept. Unsaved copies that can't be opened stay for the next start.
 */
export async function reopenAfterRestart(ws: Workspace, store: KeepStore, hooks: RestartHooks): Promise<RestartResult | null> {
  const list = parseRestart(await getText(store, `${FOLDER}/${LIST}`).catch(() => null));
  if (!list) return null;
  const opened: (Tab | null)[] = list.tabs.map(() => null);
  const missing: string[] = [];
  const failed: number[] = [];
  for (const [i, e] of list.tabs.entries()) {
    if (e.windowOf !== undefined) continue;
    try {
      if (e.si) {
        opened[i] = (await hooks.openSi?.(e.si)) ?? null;
        // (a working copy that won't open is offered again by the SI projects' own recovery at the next start)
        if (!opened[i]) missing.push(e.si.file ?? e.name);
      } else if (e.copy) {
        const bytes = await store.get(`${FOLDER}/${e.copy}`);
        // (a file opened already, by a double-click that started the app: this copy opens beside it, unsaved, without its file)
        const taken = e.path && ws.tabs.some((o) => o.ref.kind === 'path' && o.ref.path === e.path);
        const ref: FileRef = e.path && !taken ? { kind: 'path', path: e.path } : { kind: 'none' };
        const t = bytes ? await ws.openAs(bytes, e.copy, { name: e.name, ref, dirty: !e.clean, stamp: ref.kind === 'path' ? e.stamp : null }) : null;
        if (t) opened[i] = t;
        else failed.push(i);
      } else if (e.path) {
        let bytes: Uint8Array | null = null;
        try { bytes = await readPath(e.path); } catch { missing.push(e.path); }
        if (bytes && (await ws.openBytes(bytes, baseName(e.path), { kind: 'path', path: e.path }))) opened[i] = ws.active;
      }
    } catch {
      if (e.copy) failed.push(i);
      else missing.push(e.path ?? e.name);
    }
    const t = opened[i];
    if (t && e.autoSave !== undefined) t.autoSave = e.autoSave;
  }
  // the other windows of documents and workbooks
  for (const [i, e] of list.tabs.entries()) {
    if (e.windowOf === undefined) continue;
    const main = opened[e.windowOf];
    if (!main || (!main.document && !main.book)) continue;
    ws.activate(main);
    opened[i] = ws.newWindow();
  }
  // the slide each deck was on, and each tab's zoom and scroll
  const setViews = (skip: Tab | null) => list.tabs.forEach((e, i) => {
    const t = opened[i];
    if (!t || t === skip) return;
    if (e.view) { t.view = { ...e.view }; t.fitted = e.fitted; }
  });
  list.tabs.forEach((e, i) => {
    const d = opened[i]?.deck;
    if (d && e.slide !== undefined && e.slide < d.slides.length && e.slide !== d.index) {
      if (opened[i] === ws.active) d.go(e.slide);
      else d.index = e.slide;
    }
  });
  if (list.split) {
    const [l, r] = list.split.map((i) => opened[i]);
    if (l && r && l !== r) ws.setSplit({ left: l, right: r });
  }
  const show = (list.active >= 0 ? opened[list.active] : null) ?? opened.find((t) => t) ?? null;
  setViews(null);
  if (show) {
    if (show === ws.active || show === ws.pane) ws.reshow();
    else ws.activate(show);
    // (leaving the tab that showed while opening wrote its fitted view over the one kept)
    setViews(ws.pane ?? ws.active);
  }
  // done: forget the list, except unsaved copies that couldn't be opened (tried again next time)
  if (failed.length) {
    const keep: RestartList = { kind: 'restart', made: list.made, tabs: failed.map((i) => ({ ...list.tabs[i], windowOf: undefined })), active: -1 };
    const names = new Set(keep.tabs.flatMap((t) => (t.copy ? [t.copy] : [])));
    for (const e of list.tabs) if (e.copy && !names.has(e.copy)) await store.remove(`${FOLDER}/${e.copy}`).catch(() => {});
    await putText(store, `${FOLDER}/${LIST}`, JSON.stringify(keep));
  } else {
    await store.remove(FOLDER).catch(() => {});
  }
  return { opened: opened.filter((t) => t).length, missing, failed: failed.map((i) => list.tabs[i].name) };
}
