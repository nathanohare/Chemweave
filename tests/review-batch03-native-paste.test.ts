// @vitest-environment jsdom
//
// Review batch 03, F553: the Windows desktop app's paste reader takes cells and pictures before a
// word that only might be SMILES. The desktop app's clipboard commands are stood in for here, as
// in tests/clipboard-native-fallback.test.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest';

/** The Windows clipboard as the stand-in holds it: format name → bytes. */
const board = new Map<string, Uint8Array>();
vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => false,
  invoke: async (cmd: string, args: { names: string[] }) => {
    if (cmd !== 'clipboard_read') return new ArrayBuffer(0);
    const { packFormats } = await import('../src/io/clipboard');
    const name = args.names.find((n) => board.has(n));
    return name ? packFormats([[name, board.get(name)!]]).buffer : new ArrayBuffer(0);
  },
}));

import { readNativeClipboard } from '../src/io/clipboard';

const enc = new TextEncoder();
/** HTML Format as Windows keeps it: a header of byte offsets, then the page (the reader reads the part between the fragment marks). */
function cfHtml(body: string): Uint8Array {
  const page = `<html><body><!--StartFragment-->${body}<!--EndFragment--></body></html>`;
  const head = 'Version:0.9\r\nStartHTML:0000000000\r\nEndHTML:0000000000\r\nStartFragment:0000000000\r\nEndFragment:0000000000\r\n';
  const at = (s: string) => enc.encode(s).length;
  const n = (v: number) => String(v).padStart(10, '0');
  const start = at(head), sf = start + at(page.slice(0, page.indexOf('<!--StartFragment-->') + 20)), ef = start + at(page.slice(0, page.indexOf('<!--EndFragment-->')));
  return enc.encode(head.replace('StartHTML:0000000000', `StartHTML:${n(start)}`).replace('EndHTML:0000000000', `EndHTML:${n(start + at(page))}`)
    .replace('StartFragment:0000000000', `StartFragment:${n(sf)}`).replace('EndFragment:0000000000', `EndFragment:${n(ef)}`) + page);
}

describe('the desktop app\'s paste (F553)', () => {
  beforeEach(() => board.clear());

  it('cells copied with a word in them paste as a table', async () => {
    board.set('CF_UNICODETEXT', enc.encode('Yield'));
    board.set('HTML Format', cfHtml('<table><tr><td>Yield</td><td>95%</td></tr></table>'));
    expect((await readNativeClipboard()).kind).toBe('table');
  });

  it('a picture copied with its file name beside it pastes as the picture', async () => {
    board.set('CF_UNICODETEXT', enc.encode('picture.png'));
    board.set('PNG', new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    expect((await readNativeClipboard()).kind).toBe('picture');
  });

  it('a SMILES copied with a picture is still pasted as the SMILES', async () => {
    board.set('CF_UNICODETEXT', enc.encode('CCO'));
    board.set('PNG', new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    expect(await readNativeClipboard()).toEqual({ kind: 'text', text: 'CCO' });
  });
});
