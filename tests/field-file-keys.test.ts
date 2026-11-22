// @vitest-environment jsdom
//
// The file's own keys (Ctrl+S, Ctrl+O, Ctrl+P…) from any text box (G3-08): the fix for the
// speaker notes (#620) now covers Outline View, Smart Scheme rows, comments, the Find box and
// text typed on the drawing, through one handler (editor/field-keys.ts).

import { describe, expect, it } from 'vitest';
import { FIELD_FILE_KEYS, fieldFileCommand, isTypingField } from '../src/editor/field-keys';

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
