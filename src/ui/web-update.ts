// The web version, when a newer version is published while a page is open (GitHub Pages replaces
// the whole site on each merge into main; .github/workflows/pages.yml).
//
// A page keeps running the version it started with. Its files carry a stamp of their contents in
// their names and the site keeps earlier versions' files for a week (vite.config.ts,
// scripts/keep-old-web-files.mjs), so it goes on working. This module tells the person a newer
// version is there, in a notice in the corner, and reloads when they choose: unsaved work is
// copied first and offered again as soon as the page is back (src/keep/keeper.ts). Should a part
// of the page still fail to load because of a new version (its file gone from the site), the
// notice says so. The desktop app has its own updates (src/updates.ts) and never runs this.

import { isTauri } from '@tauri-apps/api/core';
import { notice, closeNotice } from './keep-ui';

export interface WebUpdateHost {
  /** Finish what is being typed, so it counts as a change. */
  finishTyping(): void;
  /** Whether any tab has unsaved changes. */
  anyDirty(): boolean;
  /** Whether recovery copies are switched on. */
  recoveryOn(): boolean;
  /** Copy every tab with unsaved changes now; true when all of them are kept (or there are none). */
  keepForReload(): Promise<boolean>;
  /** The page is about to reload with its work kept: the "Leave site?" question isn't needed. */
  reloading(): void;
}

/** How often a page that is showing asks whether there is a newer version. */
export const CHECK_MS = 15 * 60_000;
/** Coming back to the page asks again once this long has passed since the last time. */
export const RECHECK_MS = 5 * 60_000;
const KEY = 'web-update';

/**
 * Whether to tell the person about the published build: it differs from the one running, and
 * isn't the one they said Later to (a later one is told again).
 */
export function worthTelling(mine: string, published: string | null, dismissed: string | null): boolean {
  return !!published && published !== mine && published !== dismissed;
}

/** The build this page is (written into the page by vite.config.ts), or null outside the web version's build. */
export function pageBuild(doc: Document = document): string | null {
  return doc.querySelector<HTMLMetaElement>('meta[name="chemweave-build"]')?.content || null;
}

/**
 * The build the site has now, or null when it can't be read (offline, or not the web version).
 * The query keeps GitHub's servers from answering with the copy they hold for ten minutes.
 */
export async function publishedBuild(fetcher: typeof fetch = fetch, base = document.baseURI, now = Date.now()): Promise<string | null> {
  try {
    const r = await fetcher(new URL(`version.json?t=${now}`, base).href, { cache: 'no-store' });
    if (!r.ok) return null;
    const j: unknown = await r.json();
    const b = j && typeof j === 'object' ? (j as { build?: unknown }).build : null;
    return typeof b === 'string' && b ? b : null;
  } catch {
    return null;
  }
}

export class WebUpdates {
  private dismissed: string | null = null;
  private lastCheck = 0;
  private checking: Promise<void> | null = null;

  constructor(private host: WebUpdateHost, readonly mine: string | null = pageBuild(), private fetcher: typeof fetch = (...a) => fetch(...a)) {}

  /** Start checking (the web version's built page only). */
  start(): void {
    if (isTauri() || import.meta.env.DEV || !this.mine) return;
    // a part that fails to load (Vite reports every lazily loaded part that fails this way)
    window.addEventListener('vite:preloadError', () => void this.failedLoad());
    window.setInterval(() => { if (document.visibilityState === 'visible') void this.check(); }, CHECK_MS);
    const back = () => { if (document.visibilityState === 'visible' && Date.now() - this.lastCheck >= RECHECK_MS) void this.check(); };
    document.addEventListener('visibilitychange', back);
    window.addEventListener('online', back);
    this.lastCheck = Date.now();
  }

  /** Ask the site which version it has; a notice when it is newer than this page's. */
  check(): Promise<void> {
    this.checking ??= (async () => {
      this.lastCheck = Date.now();
      const published = await publishedBuild(this.fetcher);
      if (this.mine && worthTelling(this.mine, published, this.dismissed)) this.offer(published!, false);
    })().finally(() => { this.checking = null; });
    return this.checking;
  }

  /** A part of the page didn't load: if a newer version is the reason, say so (even after Later). */
  async failedLoad(): Promise<void> {
    const published = await publishedBuild(this.fetcher);
    if (this.mine && worthTelling(this.mine, published, null)) this.offer(published!, true);
  }

  private offer(build: string, failed: boolean): void {
    const work = !this.host.anyDirty() ? ''
      : this.host.recoveryOn() ? ' Unsaved work is copied first and offered again when the page reopens.'
      : ' Save your work first: recovery copies are switched off.';
    const text = failed
      ? `A newer version was published while this page was open, so part of Chemweave couldn’t load. Reload to use the new version.${work}`
      : `A newer version of Chemweave has been published. Reload to use it.${work}`;
    notice(KEY, failed ? 'Chemweave Was Updated' : 'New Version Available', text, [
      { label: 'Reload', main: true, run: () => void this.reload() },
      { label: 'Later', run: () => { this.dismissed = build; } },
    ]);
  }

  /** Reload for the new version, unsaved work copied first. */
  async reload(): Promise<void> {
    this.host.finishTyping();
    // (when not everything could be copied, or something changes after the copy, the browser's
    // "Leave site?" question still asks)
    if (await this.host.keepForReload().catch(() => false)) this.host.reloading();
    closeNotice(KEY);
    location.reload();
  }
}
