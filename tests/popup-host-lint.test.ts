// Pop-ups over windows (lesson from the Orbital window). A window opened with showModal() sits in the
// browser's top layer, so a pop-up (drop-down list, menu, tip) added to document.body is drawn under
// it, greyed and unclickable. Pop-ups go in popupHost() (src/ui/popup-host.ts). This check reads
// src/ui and flags any file that adds something other than a window itself to document.body, unless
// the file is on the list below, which holds only the files that were there when the check began:
// each is opened from the page itself (ribbon, toolbar, side panel, a full-page mode) with no window
// over it. Do not add a file to the list; use popupHost(). The list is also checked for files
// that no longer need an entry, so it can only shrink.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const UI = join(__dirname, '..', 'src', 'ui');
// A window (dialog) variable, or a datalist: these are not pop-ups.
const WINDOW_ARG = /^(d|dialog|this\.d|w\.d|dl)$/;
const APPEND = /document\.body\.append(?:Child)?\(([^)]*)\)/g;

const KNOWN_PAGE_LEVEL = new Set([
  'assistant-bar.ts',
  'build-hint.ts',
  'canvas-ribbon-boxes.ts',
  'design-panel.ts',
  'doc-compare-card.ts',
  'doc-mode.ts',
  'doc-original-notes.ts',
  'float-box.ts',
  'guide-window.ts',
  'keep-ui.ts',
  'label-tooltip.ts',
  'nmr-spectrum.ts',
  'present.ts',
  'presenter-view.ts',
  'print.ts',
  'refs-box.ts',
  'ribbon-live.ts',
  'shape-menu.ts',
  'shape-styles.ts',
  'sheet-format-ui.ts',
  'sheet-look-ui.ts',
  'sheet-mode.ts',
  'sheet-notes-ui.ts',
  'sheet-objects-ui.ts',
  'si-dashboard.ts',
  'si-mention-tip.ts',
  'side-sections.ts',
  'smart-format-pop.ts',
  'smart-gallery.ts',
  'smart-loop-pop.ts',
  'smart-pane.ts',
  'template-thumbs.ts',
  'template-window.ts',
  'tool-tip.ts',
  'toolbar.ts',
  'toolboxes.ts',
  'update-ui.ts',
]);

function flagged(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const f of readdirSync(UI).filter((n) => n.endsWith('.ts'))) {
    const code = readFileSync(join(UI, f), 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    const hits = [...code.matchAll(APPEND)].map((m) => m[1].trim()).filter((a) => !a.split(',').every((p) => WINDOW_ARG.test(p.trim())));
    if (hits.length) out.set(f, hits);
  }
  return out;
}

describe('pop-ups go through popupHost', () => {
  it('no new file adds a pop-up straight to document.body', () => {
    const bad = [...flagged().keys()].filter((f) => !KNOWN_PAGE_LEVEL.has(f));
    expect(bad, 'use popupHost().append(...) from ./popup-host so the pop-up shows over a window').toEqual([]);
  });

  it('the list holds only files that still need an entry', () => {
    const now = flagged();
    expect([...KNOWN_PAGE_LEVEL].filter((f) => !now.has(f))).toEqual([]);
  });

  it('checks the checker: a window passes, a menu does not', () => {
    const sample = (s: string) => [...s.matchAll(APPEND)].map((m) => m[1].trim()).filter((a) => !a.split(',').every((p) => WINDOW_ARG.test(p.trim())));
    expect(sample('document.body.append(d);')).toEqual([]);
    expect(sample('document.body.append(menu);')).toEqual(['menu']);
    expect(sample('document.body.appendChild(el)')).toEqual(['el']);
  });
});
