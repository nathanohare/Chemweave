// @vitest-environment jsdom
//
// Review batch 19, the Styles pane (F806): Modify and Delete acted on the style last clicked in the
// list even after the caret had moved to a paragraph in another style, so the highlighted style
// and the one Delete removed could differ.

import { describe, expect, it, vi } from 'vitest';
import { StylesPane, type StylesPaneHost } from '../src/ui/styles-pane';
import { newDocument, type DocText, type NamedStyle } from '../src/document/document';
import type { ParaStyle } from '../src/model';
import type * as rt from '../src/richtext';

function setup() {
  const t0 = newDocument();
  const citation: NamedStyle = { ...t0.styles.Normal, id: 'Citation', name: 'Citation', custom: true } as NamedStyle;
  const t: DocText = { ...t0, styles: { ...t0.styles, Citation: citation } };
  const at = { style: 'Normal' };
  const host = {
    doc: () => ({ t, para: { style: at.style } as ParaStyle, look: {} as rt.RunStyle }),
    applyPara: vi.fn((id: string) => { at.style = id; }),
    applyChar: vi.fn(), newStyle: vi.fn(), modify: vi.fn(), remove: vi.fn(), focus: vi.fn(),
  } satisfies StylesPaneHost;
  document.body.replaceChildren();
  const pane = new StylesPane(host);
  document.body.append(pane['box'].el);
  pane.toggle();
  const item = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('.sp-item')].find((b) => b.querySelector('.sp-name')!.textContent === name)!;
  const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('.sp-buttons button')].find((b) => b.textContent === label)!;
  return { pane, host, at, item, button };
}

describe('F806: Modify and Delete follow the highlighted style', () => {
  it('can delete the custom style just clicked (the caret is in it)', () => {
    const { pane, host, item, button } = setup();
    item('Citation').click();
    pane.refresh();
    expect(button('Delete').disabled).toBe(false);
    button('Delete').click();
    expect(host.remove).toHaveBeenCalledWith('para', 'Citation');
  });
  it('does not delete or modify the style clicked once the caret is in another', () => {
    const { pane, host, at, item, button } = setup();
    item('Citation').click();
    pane.refresh();
    // the caret moves to a Normal paragraph; the list highlights Normal
    at.style = 'Normal';
    pane.refresh();
    expect(item('Normal').getAttribute('aria-pressed')).toBe('true');
    expect(button('Delete').disabled).toBe(true); // Normal is a standard style and can't be deleted
    button('Modify…').click();
    expect(host.modify).toHaveBeenCalledWith('para', 'Normal');
    expect(host.remove).not.toHaveBeenCalled();
  });
});
