// @vitest-environment jsdom
//
// Insert > Quick Parts: "Save Selection to Quick Part Gallery…" is offered when text is selected,
// and greyed out when nothing is (it was the other way round, so a Quick Part could never be saved).

import { describe, it, expect, afterEach } from 'vitest';
import { DocInsertUI, type DocInsertHost } from '../src/ui/doc-insert-ui';
import type { DocFile } from '../src/document/doc-file';
import type { TextEditing } from '../src/text/editing';

afterEach(() => { document.body.innerHTML = ''; });

function menuWith(start: number, end: number, file: DocFile | null) {
  const ed = { start, end, text: 'Hello world' } as unknown as TextEditing;
  const host: DocInsertHost = {
    file: () => file,
    ed: () => ed,
    insertObject: () => 0,
    stopBox: () => {},
    flash: () => {},
    focus: () => {},
    quickParts: () => [],
    setQuickParts: () => {},
    author: () => '',
  };
  new DocInsertUI(host).quickPartsMenu(10, 10);
  const b = [...document.querySelectorAll<HTMLButtonElement>('.popup-menu button')].find((x) => x.textContent?.startsWith('Save Selection'));
  expect(b).toBeDefined();
  return b!;
}

describe('Quick Parts menu: Save Selection', () => {
  const file = {} as DocFile;
  it('is enabled when text is selected', () => {
    expect(menuWith(0, 5, file).disabled).toBe(false);
  });
  it('is disabled with no selection', () => {
    expect(menuWith(3, 3, file).disabled).toBe(true);
  });
  it('is disabled with no document', () => {
    expect(menuWith(0, 5, null).disabled).toBe(true);
  });
});
