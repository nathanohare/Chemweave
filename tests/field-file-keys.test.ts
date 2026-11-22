// @vitest-environment jsdom
//
// The file's own keys (Ctrl+S, Ctrl+O, Ctrl+P…) from any text box (G3-08): the fix for the
// speaker notes (#620) now covers Outline View, Smart Scheme rows, comments, the Find box and
// text typed on the drawing, through one handler (editor/field-keys.ts).

import { describe, expect, it } from 'vitest';
import { FIELD_FILE_KEYS, fieldFileCommand, fieldKeyHandler, isTypingField } from '../src/editor/field-keys';
import { threadCard, type ThreadActions } from '../src/ui/comment-cards';
import { OutlineView } from '../src/ui/outline-view';
import { Doc } from '../src/model';
import { Deck } from '../src/deck/deck';
import { slideOutline } from '../src/deck/outline';

const KEYS: Record<string, string> = { 'Ctrl+S': 'command save', 'Ctrl+Shift+S': 'command save-as', 'Ctrl+O': 'command open', 'Ctrl+P': 'command print', 'Ctrl+W': 'command close-tab', 'Ctrl+B': 'command bold', 'Ctrl+Z': 'command undo' };
const lookup = (c: string) => KEYS[c];

function field(html: string, pick: string): HTMLElement {
  document.body.innerHTML = html;
  return document.querySelector<HTMLElement>(pick)!;
}

describe('file keys from a text box', () => {
  it('Save, Save As, Open, Print and Close are sent from Outline View, a Smart Scheme row, the notes and the Find box', () => {
    const boxes = [
      field('<div id="slide-outline"><input class="ol-title"></div>', '.ol-title'),
      field('<div id="slide-outline"><textarea class="ol-body"></textarea></div>', '.ol-body'),
      field('<div class="smart-pane"><div class="sp-rich" contenteditable="true"></div></div>', '.sp-rich'),
      field('<aside><input class="df-find" type="text"></aside>', '.df-find'),
      field('<textarea class="text-input"></textarea>', 'textarea'),
    ];
    for (const b of boxes) {
      document.body.append(b);
      expect(fieldFileCommand(b, 'Ctrl+S', lookup), b.className).toBe('save');
      expect(fieldFileCommand(b, 'Ctrl+Shift+S', lookup)).toBe('save-as');
      expect(fieldFileCommand(b, 'Ctrl+O', lookup)).toBe('open');
      expect(fieldFileCommand(b, 'Ctrl+P', lookup)).toBe('print');
      expect(fieldFileCommand(b, 'Ctrl+W', lookup)).toBe('close-tab');
    }
  });

  it('keys the box uses itself (Bold, Undo, typing) stay with the box', () => {
    const b = field('<input class="ol-title">', 'input');
    expect(fieldFileCommand(b, 'Ctrl+B', lookup)).toBeNull();
    expect(fieldFileCommand(b, 'Ctrl+Z', lookup)).toBeNull();
    expect(fieldFileCommand(b, 'S', lookup)).toBeNull();
    expect(fieldFileCommand(b, null, lookup)).toBeNull();
    for (const k of ['save', 'open', 'print', 'close-tab', 'next-tab', 'prev-tab']) expect(FIELD_FILE_KEYS.has(k)).toBe(true);
  });

  it('not from a window, a document\'s text or a sheet (they keep the keys or send them themselves)', () => {
    expect(fieldFileCommand(field('<dialog open><input></dialog>', 'input'), 'Ctrl+S', lookup)).toBeNull();
    expect(fieldFileCommand(field('<textarea class="text-input doc-input"></textarea>', 'textarea'), 'Ctrl+S', lookup)).toBeNull();
    expect(fieldFileCommand(field('<div id="sheet-pane"><textarea id="sh-formula"></textarea></div>', 'textarea'), 'Ctrl+S', lookup)).toBeNull();
  });

  it('only boxes being typed in count (not check boxes, buttons or the page)', () => {
    expect(isTypingField(field('<input type="checkbox">', 'input'))).toBe(false);
    expect(isTypingField(field('<button>x</button>', 'button'))).toBe(false);
    expect(isTypingField(document.body)).toBe(false);
    expect(isTypingField(field('<input type="number">', 'input'))).toBe(true);
    expect(fieldFileCommand(field('<button>x</button>', 'button'), 'Ctrl+S', lookup)).toBeNull();
  });
});

describe('the window\'s handler for the file keys (what is typed goes in first)', () => {
  const MAPS: Record<'slides' | 'command', Record<string, string>> = { slides: { 'Ctrl+N': 'command new-slides', 'Ctrl+M': 'command new-slide' }, command: { 'Ctrl+N': 'command new', 'Ctrl+S': 'command save' } };
  /** The handler on the window, with what it ran and when the box's text had gone in. */
  function install(slides = false, atRun: () => void = () => undefined) {
    const ran: string[] = [];
    let flushed = 0;
    const h = fieldKeyHandler({ lookup: (ctx, c) => MAPS[ctx][c], slides: () => slides, flush: () => { flushed++; }, run: (n) => { atRun(); ran.push(n); } });
    window.addEventListener('keydown', h, true);
    return { ran, flushed: () => flushed, off: () => window.removeEventListener('keydown', h, true) };
  }
  const press = (el: Element, key: string, more: KeyboardEventInit = {}) => el.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true, ...more }));

  it('Ctrl+S in a comment\'s box saves the comment as typed before the file', () => {
    document.body.innerHTML = '';
    const seen: string[] = [];
    const k = install();
    try {
    const a: ThreadActions = { edit: (t) => { seen.push(`edit ${t} (save run: ${k.ran.length})`); }, reply: () => undefined, removeReply: () => undefined, resolve: () => undefined, remove: () => undefined, focus: () => undefined };
    const card = threadCard({ author: 'Nate', date: '', text: 'Dry it' }, { active: true, editing: true, actions: a, rich: true });
    document.body.append(card);
    const box = card.querySelector<HTMLElement>('.cmt-rich')!;
    // (jsdom doesn't give the attribute for the property, nor isContentEditable)
    box.setAttribute('contenteditable', 'true');
    (box.querySelector('span')!.firstChild as Text).data = 'Dry it first';
    box.dispatchEvent(new Event('input'));
    press(box, 's');
    expect(seen).toEqual(['edit Dry it first (save run: 0)']);
    expect(k.ran).toEqual(['save']);
    } finally { k.off(); }
  });

  it('Ctrl+S in Outline View\'s box puts the words on the slide first, once a press', () => {
    document.body.innerHTML = '';
    const host = new Doc();
    const d = Deck.blank(host);
    d.attach();
    d.setLayout('title-content');
    const parent = document.createElement('div');
    document.body.append(parent);
    const view = new OutlineView(parent, { deck: () => d, go: () => undefined, focusSlide: () => undefined });
    view.show(true);
    const title = parent.querySelector<HTMLElement>('.ol-title')!;
    title.setAttribute('contenteditable', 'true');
    title.append('Aldol reactions');
    title.dispatchEvent(new Event('input'));
    let titleAtSave = '';
    const k = install(false, () => { titleAtSave = slideOutline(d.docOf(0)).title ?? ''; });
    const was = k.ran.length;
    try {
    press(title, 's');
    expect(k.ran.slice(was)).toEqual(['save']);
    expect(slideOutline(d.docOf(0)).title).toBe('Aldol reactions');
    expect(titleAtSave).toBe('Aldol reactions');
    expect(k.flushed()).toBe(1);
    // held down: not again; while an input method is composing: not at all
    press(title, 's', { repeat: true });
    press(title, 's', { isComposing: true } as KeyboardEventInit);
    expect(k.ran.slice(was)).toEqual(['save']);
    } finally { view.show(false); k.off(); }
  });

  it('in a presentation, Ctrl+N from a text box is New Presentation, as from the slide', () => {
    document.body.innerHTML = '<div class="sp-rich" contenteditable="true"></div>';
    const box = document.querySelector('.sp-rich')!;
    const inDeck = install(true);
    try { press(box, 'n'); } finally { inDeck.off(); }
    const inCanvas = install(false);
    try { press(box, 'n'); } finally { inCanvas.off(); }
    expect(inDeck.ran).toEqual(['new-slides']);
    expect(inCanvas.ran).toEqual(['new']);
  });
});
