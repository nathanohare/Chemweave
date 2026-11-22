// @vitest-environment jsdom
// Document mode builds the shared Font group itself when the page doesn't have it yet (it no longer
// depends on main.ts having put it in first), and building it again adds nothing.
import { describe, it, expect } from 'vitest';
import { docMode } from './doc-mode-harness';
import { installFontGroups } from '../src/ui/font-group';

describe('Document mode and the shared Font group', () => {
  it('starts on the bare page (no Font group put in yet) and has exactly one, with its boxes', async () => {
    const { dm } = await docMode({ runs: [{ text: 'Hello' }], paras: [{}] });
    expect(dm).toBeTruthy();
    expect(document.querySelectorAll('[data-font-mode="document"]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-font-group]')).toHaveLength(0);
    expect(document.querySelector<HTMLInputElement>('#doc-font')).not.toBeNull();
    installFontGroups();
    expect(document.querySelectorAll('[data-font-mode="document"]')).toHaveLength(1);
    expect(document.querySelectorAll('#doc-font, #doc-size, #doc-colour')).toHaveLength(3);
  });
});
