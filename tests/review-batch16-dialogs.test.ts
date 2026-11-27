// @vitest-environment jsdom
//
// Review batch 16 (UI wording sweep, Office modes): windows built on screen. Help sits behind an
// "i" tip (docs/ui-style.md, standing rule 3), buttons and window titles are in Title Case (S70),
// and command names are Office's (rule 1). Each window is built, read and closed.

import { describe, it, expect } from 'vitest';
import { DocFile } from '../src/document/doc-file';
import { newDocument, type DocText } from '../src/document/document';
import { DocFind } from '../src/ui/doc-find';
import { askEquation } from '../src/ui/equation-dialog';
import { askLink } from '../src/ui/links-ui';
import { editMedia } from '../src/ui/media-dialog';
import { editTheme } from '../src/ui/theme-editor';
import { SLIDE_TEMPLATES } from '../src/deck/templates';
import { Deck } from '../src/deck/deck';
import { Doc } from '../src/model';
import { ToolWindow } from '../src/ui/tool-window';

const D = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
D.show ??= function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
D.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
D.close ??= function (this: HTMLDialogElement) { if (!this.hasAttribute('open')) return; this.removeAttribute('open'); this.dispatchEvent(new Event('close')); };

const buttons = (root: ParentNode) => [...root.querySelectorAll('button')].map((b) => b.textContent?.trim() ?? '');
const tips = (root: ParentNode) => [...root.querySelectorAll<HTMLElement>('.info-icon')].map((i) => i.dataset.tip ?? '');
const lastDialog = () => [...document.querySelectorAll('dialog')].pop() as HTMLDialogElement;

describe('F454, F455: Find and Replace', () => {
  const make = () => {
    const f = new DocFile({ ...newDocument(), runs: [{ text: 'Dry over MgSO4.' }], paras: [{}] } as DocText);
    const parent = document.createElement('div');
    document.body.append(parent);
    new DocFind(parent, { file: () => f, focus: () => {}, flash: () => {}, redraw: () => {} });
    return parent;
  };
  it('names the button Replace All, with the full name on the button itself', () => {
    const b = make().querySelector<HTMLButtonElement>('[data-act="all"]')!;
    expect(b.textContent).toBe('Replace All');
  });
  it('keeps the Replace help behind an "i" by "Make it", not on a line of its own', () => {
    const p = make();
    expect(p.querySelector('.df-hint')).toBeNull();
    expect(p.textContent).not.toContain('Leave “Replace with” empty');
    expect(tips(p.querySelector('.df-look')!)).toEqual(['Leave “Replace with” empty to change only how the found words look.']);
  });
});

describe('F701: Equation window', () => {
  it('has its LaTeX help behind an "i" by the title', () => {
    void askEquation({ tex: '', font: 'Arial', ok: 'Insert' });
    const d = lastDialog();
    const h = d.querySelector('h2')!;
    const tip = h.querySelector<HTMLElement>('.info-icon')!;
    expect(tip.dataset.tip).toContain('Type LaTeX');
    expect(d.querySelector<HTMLElement>('p.muted')!.hidden).toBe(true);
  });
});

describe('F732, F733: Insert Link window', () => {
  it('has Title Case link kinds and its help behind "i" tips', () => {
    void askLink({ text: '', places: [{ label: 'Intro', link: '#intro' }] });
    const d = lastDialog();
    const kinds = buttons(d.querySelector('.link-kinds')!);
    expect(kinds).toEqual(['Web Page or DOI', 'Place in This File', 'File', 'Email Address']);
    expect(d.querySelector('p.ask-help.muted')).toBeNull();
    const t = tips(d);
    expect(t.some((x) => x.includes('doi.org'))).toBe(true);
    expect(t.some((x) => x.includes('relative to this file'))).toBe(true);
  });
});

describe('F736, F737: Playback window', () => {
  it('has Title Case buttons and Office\'s option names', () => {
    // a video has the trim buttons; the loudspeaker (Hide During Show) is only on a sound
    void editMedia({ src: 'data:audio/mpeg;base64,AAAA', audio: true } as never);
    const sound = lastDialog();
    void editMedia({ src: 'data:video/mp4;base64,AAAA' } as never);
    const d = lastDialog();
    const b = buttons(d);
    expect(b).toContain('Start Here');
    expect(b).toContain('End Here');
    const labels = [...d.querySelectorAll('label'), ...sound.querySelectorAll('label')].map((l) => l.textContent?.trim());
    for (const n of ['Loop until Stopped', 'Rewind after Playing', 'Play Full Screen', 'Hide During Show', 'Play Across Slides']) {
      expect(labels.some((l) => l?.startsWith(n)), n).toBe(true);
    }
  });
});

describe('F811: theme editor', () => {
  it('has its help behind an "i" by the title', () => {
    const d0 = Deck.blank(new Doc());
    void editTheme(SLIDE_TEMPLATES[0], d0.master, d0.size);
    const d = lastDialog();
    expect(d.querySelector<HTMLElement>('p.muted')!.hidden).toBe(true);
    expect(tips(d.querySelector('h2')!)[0]).toContain('A theme sets the fonts');
  });
});

describe('F1013, F1050, F1064, F1078: tool windows keep help behind the title\'s "i"', () => {
  it('ToolWindow.info puts the text in an "i" on the title', () => {
    const w = new ToolWindow('Outline Settings');
    w.info('Where the summary rows go.');
    expect(tips(w.form.querySelector('h2')!)).toEqual(['Where the summary rows go.']);
    expect(w.body.querySelector('p')).toBeNull();
  });
});
