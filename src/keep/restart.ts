// Installing an update restarts the desktop app. Just before it closes, every open tab is written
// down (in order, with the tab showing, the split screen, other windows of a document, each
// canvas's zoom and the slide it was on), and each tab with unsaved changes is copied into the
// app's own folder (as recovery copies are). The files on disk are not touched. The first start
// after that opens the tabs again as they were: unsaved tabs come back unsaved, with their files
// still theirs, so the update loses nothing and asks nothing (Nate, 2026-11-26).
//
// The list stays until the tabs are open again and the recovery copies have them, so a crash in
// between, or an update that failed after the app began closing, loses nothing either.

import type { Workspace, Tab } from '../workspace';
import type { View } from '../render/renderer';
import type { FileStamp } from './recovery';
import type { KeepStore } from './store';
import { getText, putText } from './store';
import { readPath, pathExists, baseName, extensionOf, type FileRef } from '../io/files';

/** The place in the keep folder (the desktop app's keep.rs must list it too: tests/keep-roots.test.ts). */
export const RESTART_FOLDER = 'restart';
const FOLDER = RESTART_FOLDER;
const LIST = 'tabs.json';
/** Starts that may try a list before it is left alone (a file that stops the app as it opens would otherwise do so at every start). */
export const MAX_TRIES = 3;

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
  /** Unsaved changes: the copy in the restart folder that holds them. */
  copy?: string;
  /** Another window of the document or workbook in this entry. */
  windowOf?: number;
  si?: RestartSi;
  autoSave?: boolean;
  /** AutoSave was holding off this tab until it is saved by hand (a failed AutoSave, changes on disk to settle). */
  paused?: boolean;
  view?: View;
  fitted?: boolean;
  /** Presentations and designs: the slide showing. */
  slide?: number;
  /**
   * Reopened, but its recovery copy couldn't be made then: this copy is all there is until one
   * is (settleRestart lets it go then).
   */
  unsecured?: boolean;
}

export interface RestartList {
  kind: 'restart';
  made: number;
  tabs: RestartTab[];
  /** The tab showing, by position (-1: none of those kept). */
  active: number;
  /** Split screen: left and right, by position. */
  split?: [number, number];
  /** Starts that have tried to open it. */
  tries?: number;
  /** Said at the next start: why the update didn't install, when it didn't. */
  note?: string;
}

export interface RestartHooks {
  /** The canvas's zoom and scroll on screen now (the pane beside, or the tab showing). */
  liveView(): { view: View; fitted: boolean } | null;
  /** An SI tab: its project's file and working copy, or null when it can't be kept (one held in memory only). */
  siOf?(tab: Tab): RestartSi | null;
  /** Open an SI project again: from its working copy when it has one, otherwise from its file. */
  openSi?(si: RestartSi): Promise<Tab | null>;
  /** Whether AutoSave is holding off a tab until it is saved by hand. */
  paused?(tab: Tab): boolean;
  /** Hold AutoSave off a reopened tab until it is saved by hand. */
  pause?(tab: Tab): void;
  /** Make recovery copies of the reopened tabs now (before the restart's own copies go). */
  secure?(): Promise<unknown>;
  /** Whether a reopened tab's recovery copy holds it as it is now (when secure() didn't manage every tab). */
  kept?(tab: Tab): boolean;
}

/** Tabs whose zoom and scroll are the canvas's (documents and sheets keep theirs elsewhere). */
const canvasView = (t: Tab) => t.mode === 'drawing' || !!t.deck;

async function readList(store: KeepStore): Promise<RestartList | null> {
  return parseRestart(await getText(store, `${FOLDER}/${LIST}`).catch(() => null));
}

/**
 * Write down the open tabs and copy the unsaved ones, for the start after the update. Returns
 * the names of tabs with unsaved changes that couldn't be kept (an empty list when all were).
 * Copies left from an earlier restart that couldn't be opened then are kept, at the end.
 */
export async function keepForRestart(ws: Workspace, store: KeepStore, hooks: RestartHooks, now = Date.now()): Promise<string[]> {
  const earlier = await readList(store);
  ws.noteChange(); // (the tab showing: its unsaved mark as it is now)
  const lost: string[] = [];
  const tabs: RestartTab[] = [];
  const at = new Map<Tab, number>();
  const live = ws.pane ?? ws.active;
  const liveView = canvasView(live) ? hooks.liveView() : null;
  // (each restart's copies have names of their own, so an earlier list's copies are never written over)
  const stem = `t${now.toString(36)}`;
  for (const t of ws.tabs) {
    if (t.windowOf) continue;
    // a new tab nothing was done in (a file opened from Word for editing comes back only if changed, without its link)
    if (!t.dirty && t.ref.kind !== 'path' && t.mode !== 'si') continue;
    const e: RestartTab = { name: t.name, mode: t.mode, path: t.ref.kind === 'path' ? t.ref.path : null, stamp: t.ref.kind === 'path' ? t.stamp : null };
    if (t.mode === 'si') {
      const si = hooks.siOf?.(t) ?? null;
      if (!si || (!si.file && !si.working)) { if (t.dirty) lost.push(t.name); continue; }
      e.si = si;
    } else if (t.dirty) {
      try {
        const c = await ws.copyOf(t);
        const file = `${stem}-${tabs.length}.${(extensionOf(c.name) || 'bin').toLowerCase()}`;
        await store.put(`${FOLDER}/${file}`, c.data);
        e.copy = file;
      } catch {
        lost.push(t.name);
        continue;
      }
    }
    if (typeof t.autoSave === 'boolean') e.autoSave = t.autoSave;
    if (hooks.paused?.(t)) e.paused = true;
    if (canvasView(t)) {
      const v = t === live ? liveView : t.view ? { view: t.view, fitted: !!t.fitted } : null;
      if (v) { e.view = { ...v.view }; e.fitted = v.fitted; }
    }
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
  // unsaved copies an earlier restart couldn't open: still kept
  for (const e of earlier?.tabs ?? []) if (e.copy) tabs.push({ ...e, windowOf: undefined });
  const list: RestartList = { kind: 'restart', made: now, tabs, active: at.get(ws.active) ?? (ws.active.windowOf ? at.get(ws.active.windowOf) : undefined) ?? -1 };
  const l = ws.split ? at.get(ws.split.left) : undefined, r = ws.split ? at.get(ws.split.right) : undefined;
  if (l !== undefined && r !== undefined) list.split = [l, r];
  await putText(store, `${FOLDER}/${LIST}`, JSON.stringify(list));
  await tidy(store, list);
  return lost;
}

/** Delete the copies in the folder that the list doesn't name. */
async function tidy(store: KeepStore, list: RestartList): Promise<void> {
  const named = new Set(list.tabs.flatMap((t) => (t.copy ? [t.copy] : [])));
  for (const f of await store.list(FOLDER).catch(() => [])) {
    if (f.name !== LIST && !named.has(f.name)) await store.remove(`${FOLDER}/${f.name}`).catch(() => {});
  }
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
  const stamp = (s: unknown): FileStamp | null => { const q = s as FileStamp | null; return q && typeof q.modified === 'number' && typeof q.size === 'number' ? { modified: q.modified, size: q.size } : null; };
  const tabs: RestartTab[] = (o.tabs as unknown[]).map((x) => {
    const t = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
    const e: RestartTab = { name: typeof t.name === 'string' ? t.name : 'Untitled', mode: String(t.mode ?? ''), path: typeof t.path === 'string' ? t.path : null, stamp: stamp(t.stamp) };
    if (typeof t.copy === 'string' && /^[A-Za-z0-9._-]+$/.test(t.copy) && t.copy !== LIST) e.copy = t.copy;
    const w = idx(t.windowOf);
    if (w !== undefined) e.windowOf = w;
    const si = t.si as Record<string, unknown> | undefined;
    if (si && typeof si === 'object') {
      const wk = si.working as Record<string, unknown> | undefined;
      e.si = { file: typeof si.file === 'string' ? si.file : null, stamp: stamp(si.stamp), title: typeof si.title === 'string' ? si.title : e.name,
        ...(wk && typeof wk.working === 'string' && typeof wk.root === 'string' ? { working: { working: wk.working, root: wk.root } } : {}) };
    }
    if (typeof t.autoSave === 'boolean') e.autoSave = t.autoSave;
    if (t.paused === true) e.paused = true;
    const v = t.view as Record<string, unknown> | undefined;
    if (v && num(v.scale) && num(v.ox) !== undefined && num(v.oy) !== undefined) { e.view = { scale: v.scale as number, ox: v.ox as number, oy: v.oy as number }; e.fitted = t.fitted === true; }
    const s = num(t.slide);
    if (s !== undefined && s >= 0) e.slide = Math.floor(s);
    if (t.unsecured === true) e.unsecured = true;
    return e;
  });
  // (another window of another window, or of itself, has no file to come back from)
  for (const e of tabs) if (e.windowOf !== undefined && (tabs[e.windowOf] === e || tabs[e.windowOf].windowOf !== undefined)) delete e.windowOf;
  const split = Array.isArray(o.split) && o.split.length === 2 ? [idx(o.split[0]), idx(o.split[1])] : null;
  const tries = num(o.tries);
  return {
    kind: 'restart', made: num(o.made) ?? 0, tabs, active: idx(o.active) ?? -1,
    ...(split && split[0] !== undefined && split[1] !== undefined && split[0] !== split[1] ? { split: [split[0], split[1]] as [number, number] } : {}),
    ...(tries ? { tries: Math.floor(tries) } : {}),
    ...(typeof o.note === 'string' && o.note ? { note: o.note } : {}),
  };
}

/** Whether tabs were kept for a restart. */
export async function restartWaiting(store: KeepStore): Promise<boolean> {
  return !!(await readList(store));
}

/** The update didn't install after the app began closing: say why at the start that reopens the tabs. */
export async function noteRestart(store: KeepStore, note: string): Promise<void> {
  const list = await readList(store);
  if (list) await putText(store, `${FOLDER}/${LIST}`, JSON.stringify({ ...list, note }));
}

/**
 * The recovery copies have the reopened tabs now (a later copy worked, or they were saved or
 * closed): the restart's own copies kept for them go. Copies that couldn't be opened stay.
 */
export async function settleRestart(store: KeepStore): Promise<void> {
  const list = await readList(store);
  if (!list || !list.tabs.some((t) => t.unsecured)) return;
  const rest = list.tabs.filter((t) => !t.unsecured);
  if (!rest.length) { await store.remove(FOLDER); return; }
  const keep: RestartList = { ...list, tabs: rest, active: -1 };
  delete keep.split;
  await putText(store, `${FOLDER}/${LIST}`, JSON.stringify(keep));
  await tidy(store, keep);
}

/** Forget the tabs kept for a restart, and their copies. */
export function forgetRestart(store: KeepStore): Promise<void> {
  return store.remove(FOLDER);
}

export interface RestartResult {
  /** Tabs opened again. */
  opened: number;
  /** Files that are no longer where they were (or no longer open). */
  missing: string[];
  /** Tabs with unsaved changes whose file is no longer where it was: reopened, with AutoSave holding off. */
  moved: string[];
  /** Unsaved copies that couldn't be opened (kept for the next start). */
  failed: string[];
  /** Why the update didn't install, when it didn't. */
  note?: string;
  /** The list was tried too often: it was left alone (it is in the keep folder's restart folder). */
  gaveUp?: boolean;
}

/**
 * The first start after an update: open the tabs kept for it, as they were, then forget the list
 * (once the recovery copies have the unsaved tabs). Null when there was nothing kept. Unsaved
 * copies that can't be opened stay for the next start.
 */
export async function reopenAfterRestart(ws: Workspace, store: KeepStore, hooks: RestartHooks): Promise<RestartResult | null> {
  const list = await readList(store);
  if (!list) return null;
  const tries = (list.tries ?? 0) + 1;
  if (tries > MAX_TRIES) return { opened: 0, missing: [], moved: [], failed: list.tabs.filter((t) => t.copy).map((t) => t.name), gaveUp: true };
  // (counted first: should opening one stop the app, the next start knows)
  await putText(store, `${FOLDER}/${LIST}`, JSON.stringify({ ...list, tries })).catch(() => {});
  const opened: (Tab | null)[] = list.tabs.map(() => null);
  const missing: string[] = [];
  const moved: string[] = [];
  const failed: number[] = [];
  const releases: (() => void)[] = [];
  // (each tab opened is held, so opening the next one never takes the place of one still new)
  const got = (i: number, t: Tab | null) => { if (t) { opened[i] = t; releases.push(ws.hold(t)); } };
  await ws.quietly(async () => {
    for (const [i, e] of list.tabs.entries()) {
      if (e.windowOf !== undefined) continue;
      try {
        if (e.si) {
          got(i, (await hooks.openSi?.(e.si)) ?? null);
          // (a working copy that won't open is offered again by the SI projects' own recovery)
          if (!opened[i]) missing.push(e.si.file ?? e.name);
        } else if (e.copy) {
          const bytes = await store.get(`${FOLDER}/${e.copy}`);
          // (a file the person opened meanwhile: this copy opens beside it, unsaved, without its file)
          const taken = e.path && ws.tabs.some((o) => o.ref.kind === 'path' && o.ref.path === e.path);
          const ref: FileRef = e.path && !taken ? { kind: 'path', path: e.path } : { kind: 'none' };
          const t = bytes ? await ws.openAs(bytes, e.copy, { name: e.name, ref, dirty: true, stamp: ref.kind === 'path' ? e.stamp : null }) : null;
          if (!t) { failed.push(i); continue; }
          got(i, t);
          // its file moved or deleted since: AutoSave doesn't make it again by itself
          const gone = ref.kind === 'path' && !(await pathExists(ref.path).catch(() => true));
          if (gone) moved.push(e.name);
          if (e.paused || gone) hooks.pause?.(t);
        } else if (e.path) {
          let bytes: Uint8Array | null = null;
          try { bytes = await readPath(e.path); } catch { missing.push(e.path); }
          if (bytes) {
            const ok = await ws.openBytes(bytes, baseName(e.path), { kind: 'path', path: e.path });
            const t = ok ? ws.tabs.find((o) => o.ref.kind === 'path' && o.ref.path === e.path) ?? null : null;
            if (t) got(i, t);
            else missing.push(e.path);
          }
        }
      } catch {
        if (e.copy) failed.push(i);
        else missing.push(e.path ?? e.name);
      }
      const t = opened[i];
      if (t && e.autoSave !== undefined) t.autoSave = e.autoSave;
      if (t && e.paused && !e.copy) hooks.pause?.(t);
    }
    // the other windows of documents and workbooks
    for (const [i, e] of list.tabs.entries()) {
      if (e.windowOf === undefined) continue;
      const main = opened[e.windowOf];
      if (!main || !ws.tabs.includes(main) || (!main.document && !main.book)) continue;
      ws.activate(main);
      got(i, ws.newWindow());
    }
  });
  for (const r of releases) r();
  for (const [i, t] of opened.entries()) if (t && !ws.tabs.includes(t)) opened[i] = null;
  // the slide each deck was on, and each canvas's zoom and scroll
  list.tabs.forEach((e, i) => {
    const d = opened[i]?.deck;
    if (d && e.slide !== undefined && e.slide < d.slides.length && e.slide !== d.index) {
      if (opened[i] === ws.active) d.go(e.slide);
      else d.index = e.slide;
    }
  });
  const setViews = (skip: Tab | null) => list.tabs.forEach((e, i) => {
    const t = opened[i];
    if (!t || t === skip || !e.view) return;
    t.view = { ...e.view };
    t.fitted = e.fitted;
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
  // the unsaved tabs have recovery copies of their own before the restart's copies go
  // (if they couldn't be made, the restart's copies of the unsaved tabs are all there is: they stay for the next start)
  // (tried twice: a write that failed once, such as a file held for a moment, may go the second time)
  const attempt = () => (hooks.secure ? hooks.secure().then(() => true, () => false) : Promise.resolve(true));
  const secured = (await attempt()) || (await attempt());
  // only the tabs whose recovery copy is missing keep theirs here (one tab that can't be copied
  // doesn't keep everyone's)
  const unsecured = secured ? [] : list.tabs.flatMap((e, i) => (e.copy && opened[i] && !failed.includes(i) && !(hooks.kept?.(opened[i]!) ?? false) ? [i] : []));
  const keepIdx = [...failed, ...unsecured];
  if (keepIdx.length) {
    const keep: RestartList = { kind: 'restart', made: list.made, tabs: keepIdx.map((i) => ({ ...list.tabs[i], windowOf: undefined, ...(unsecured.includes(i) ? { unsecured: true } : {}) })), active: -1, tries };
    await putText(store, `${FOLDER}/${LIST}`, JSON.stringify(keep));
    await tidy(store, keep);
  } else {
    await store.remove(FOLDER).catch(() => {});
  }
  return { opened: opened.filter((t) => t).length, missing, moved, failed: failed.map((i) => list.tabs[i].name), ...(list.note ? { note: list.note } : {}) };
}
