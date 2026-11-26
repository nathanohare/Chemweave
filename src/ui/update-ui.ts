// Checking for a newer version (desktop app only): a quiet check a few seconds after the app
// starts, which shows a small notice in the corner if there is one, and File > Check for Updates…,
// which always says what it found. Installing keeps every open tab, unsaved changes and all, and
// the app opens them again after the restart (src/keep/restart.ts); it asks first only about a tab
// that can't be kept.

import { appVersion, findRelease, notesSince, newestNotes, noteLine, publishedReleases, shortNotes, worthOffering, RELEASES_PAGE, type Release, type UpdateChannel } from '../updates';
import { ask } from './ask';

export interface UpdateHost {
  /** Names of the open tabs with unsaved changes that can't be kept over the restart (an SI project held in memory only). */
  unkept(): string[];
  /** The version the user chose not to hear about again, if any. */
  skipped(): string | null;
  skip(version: string | null): void;
  /** Stable or Latest (Edit > Settings > Online). */
  channel(): UpdateChannel;
  /** Open a web page in the computer's browser. */
  openPage(url: string): void;
  /**
   * The app is about to close for the installer: keep the open tabs for the next start (throws,
   * stopping the update, when one with unsaved changes couldn't be kept), then tidy up as a normal
   * close does, so the next start doesn't also offer those tabs as unsaved work to recover.
   */
  closing(): Promise<void>;
  /** The update didn't install after closing began: the tabs kept for the restart aren't needed. */
  notInstalled?(): void;
}

export class UpdateUI {
  private box: HTMLElement | null = null;
  private busy = false;
  /** Tabs the person agreed to lose unsaved changes to (Install Anyway): not kept, and not a reason to stop. */
  unkeptAgreed: string[] = [];

  constructor(private host: UpdateHost) {}

  /** The check when the app starts: says nothing unless there is a version worth offering. */
  async quietCheck(): Promise<void> {
    let r: Release | null = null;
    try { r = await findRelease(this.host.channel()); } catch { return; } // offline, or GitHub unreachable: try again next time
    if (r && worthOffering(r.version, this.host.skipped())) this.offer(r);
  }

  /** File > Check for Updates…: always says what it found. */
  async check(): Promise<void> {
    const mine = await appVersion();
    const stable = this.host.channel() === 'stable';
    const where = 'Edit ▸ Settings ▸ Online chooses between Stable and Latest updates.';
    let r: Release | null;
    try {
      r = await findRelease(this.host.channel());
    } catch (e) {
      const why = stable ? 'Couldn’t find the stable version on GitHub (none may have been marked yet, or GitHub can’t be reached)' : 'Couldn’t reach GitHub to check for a newer version';
      await ask('Check for Updates', [], { ok: 'OK', noCancel: true, note: `${why} (${String(e)}). You have version ${mine}. ${where}` });
      return;
    }
    if (!r) {
      // on Stable, a version newer than the stable one (from Latest) is kept until Stable passes it
      const note = stable ? `You have the newest stable version, or a newer one (${mine}).` : `You have the newest version (${mine}).`;
      await ask('Check for Updates', [], { ok: 'OK', noCancel: true, note: `${note} ${where}` });
      return;
    }
    this.offer(r);
  }

  private offer(r: Release): void {
    this.box?.remove();
    const box = document.createElement('div');
    box.className = 'update-box';
    box.setAttribute('role', 'status');
    const h = document.createElement('strong');
    h.textContent = `Chemweave ${r.version}${this.host.channel() === 'stable' ? ' (stable)' : ''} is ready`;
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = r.notes ? shortNotes(r.notes) : 'A newer version is available.';
    const bar = document.createElement('div');
    bar.className = 'update-progress';
    bar.hidden = true;
    const row = document.createElement('div');
    row.className = 'update-buttons';
    const button = (label: string, fn: () => void, main = false) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      if (main) b.className = 'primary';
      b.addEventListener('click', fn);
      row.append(b);
      return b;
    };
    button('Install and Restart', () => void this.install(r, bar, row), true);
    button('Later', () => box.remove());
    button('Skip This Version', () => { this.host.skip(r.version); box.remove(); });
    box.append(h, p, bar, row);
    document.body.append(box);
    this.box = box;
  }

  /**
   * After an update: a note in the status bar, never a card over the canvas (S86). Clicking it
   * shows what changed since the version that ran last (from the releases on GitHub). Nothing when
   * GitHub can't be reached or there are no notes; Help ▸ What's New shows them any time.
   */
  async whatsNewNote(before: string, now: string): Promise<void> {
    let found: { version: string; notes: string }[];
    try { found = notesSince(await publishedReleases(), before, now); } catch { return; }
    if (!found.length) return;
    document.getElementById('status-whats-new')?.remove();
    const note = document.createElement('button');
    note.type = 'button';
    note.id = 'status-whats-new';
    note.textContent = `Updated to ${now}: What’s New`;
    note.title = 'See what changed in this version (also in Help ▸ What’s New)';
    note.addEventListener('click', () => { note.remove(); this.showWhatsNew(found, now); });
    const status = document.getElementById('status');
    if (!status) return;
    status.insertBefore(note, document.getElementById('status-side'));
  }

  /** Help ▸ What's New: the notes of the newest versions up to this one (the web version opens the releases page). */
  async whatsNew(): Promise<void> {
    const now = await appVersion();
    let found: { version: string; notes: string }[] = [];
    if (now !== 'web') try { found = newestNotes(await publishedReleases(), now); } catch { /* offline: the page says it */ }
    if (!found.length) { this.host.openPage(RELEASES_PAGE); return; }
    document.getElementById('status-whats-new')?.remove();
    this.showWhatsNew(found, now);
  }

  /** The card in the corner with the notes, opened from the status-bar note or the Help menu. */
  private showWhatsNew(found: { version: string; notes: string }[], now: string): void {
    if (this.box) return;
    const box = document.createElement('div');
    box.className = 'update-box whats-new';
    box.setAttribute('role', 'status');
    const h = document.createElement('strong');
    h.textContent = `What’s new in Chemweave ${now}`;
    const list = document.createElement('div');
    list.className = 'whats-new-list';
    // every change of each version, under its kind (Added, Fixed…), so whoever reported a problem
    // can find its fix; the list scrolls when it is long
    for (const r of found.slice(0, 5)) {
      const sec = document.createElement('section');
      const v = document.createElement('b');
      v.textContent = r.version;
      sec.append(v);
      const lines = r.notes.split('\n').map(noteLine);
      // an older release (before change files) has no kinds of change: its first lines, as before
      if (!lines.some((l) => l.heading)) {
        const p = document.createElement('p');
        p.textContent = shortNotes(r.notes, 3);
        sec.append(p);
      }
      let ul: HTMLUListElement | null = null;
      for (const line of lines.some((l) => l.heading) ? lines : []) {
        if (line.heading) {
          const kind = document.createElement('div');
          kind.className = 'whats-new-kind';
          kind.textContent = line.heading;
          sec.append(kind);
          ul = null;
        } else if (line.text) {
          if (!ul) { ul = document.createElement('ul'); sec.append(ul); }
          const li = document.createElement('li');
          li.textContent = line.text;
          ul.append(li);
        }
      }
      list.append(sec);
    }
    const row = document.createElement('div');
    row.className = 'update-buttons';
    const all = document.createElement('button');
    all.type = 'button';
    all.textContent = 'All Release Notes';
    all.addEventListener('click', () => this.host.openPage(RELEASES_PAGE));
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'primary';
    ok.textContent = 'OK';
    ok.addEventListener('click', () => { box.remove(); this.box = null; });
    row.append(ok, all);
    box.append(h, list, row);
    document.body.append(box);
    this.box = box;
  }

  private async install(r: Release, bar: HTMLElement, row: HTMLElement): Promise<void> {
    if (this.busy) return;
    const open = this.host.unkept();
    if (open.length) {
      const ok = await ask('Install the Update?', [], {
        ok: 'Install Anyway',
        note: `The app restarts to install version ${r.version}. Other tabs reopen as they are, but these can’t be kept and will lose their unsaved changes: ${open.join(', ')}. Choose Cancel to save them first.`,
      });
      if (!ok) return;
    }
    this.unkeptAgreed = open;
    this.busy = true;
    row.hidden = true;
    bar.hidden = false;
    bar.textContent = 'Downloading…';
    let closed = false;
    try {
      await r.install((done) => {
        bar.textContent = done === null ? 'Downloading…' : done >= 1 ? 'Installing…' : `Downloading… ${Math.round(done * 100)}%`;
      }, async () => { closed = true; await this.host.closing(); });
    } catch (e) {
      if (closed) this.host.notInstalled?.();
      bar.textContent = `The update didn’t install: ${String(e)}`;
      row.hidden = false;
    } finally {
      this.busy = false;
    }
  }
}
