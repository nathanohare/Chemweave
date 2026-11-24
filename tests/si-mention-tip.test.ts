// @vitest-environment jsdom
// A compound's ID in SI text shows the compound's structure when the mouse rests on it (Nate,
// 2026-11-23). Only the tooltip is tested here, with a stand-in picture.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MentionTip, type MentionInfo } from '../src/ui/si-mention-tip';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="600pt" height="150pt" viewBox="0 0 600 150"><path d="M0 0L10 10"/></svg>';

function setUp(info: (id: string) => MentionInfo | null): { root: HTMLElement; chip: HTMLElement; table: HTMLElement; tip: MentionTip } {
  const root = document.createElement('div');
  root.innerHTML = '<p>Alcohol <span class="si-mention" data-ref="c:c-1">2b</span> and <span class="si-mention" data-ref="c:t-1">Table S1</span></p>';
  document.body.append(root);
  const tip = new MentionTip(root, info);
  const [chip, table] = [...root.querySelectorAll<HTMLElement>('.si-mention')];
  return { root, chip, table, tip };
}

const hover = (el: HTMLElement): void => { el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); };

describe('SI compound ID tooltip', () => {
  beforeEach(() => { vi.useFakeTimers(); document.body.replaceChildren(); });
  afterEach(() => { vi.useRealTimers(); });

  it('shows the ID, name and structure after the mouse rests on the ID', () => {
    const asked: string[] = [];
    const { chip, tip } = setUp((id) => { asked.push(id); return { label: '2b', name: '1-Phenylethanol', svg: SVG }; });
    hover(chip);
    expect(tip.el.hidden).toBe(true);
    vi.advanceTimersByTime(500);
    expect(asked).toEqual(['c-1']);
    expect(tip.el.hidden).toBe(false);
    expect(tip.el.querySelector('.label-tip-head')!.textContent).toBe('2b 1-Phenylethanol');
    // (a wide structure made smaller to fit: 600 pt is 800 px, shown 300 px wide)
    const svg = tip.el.querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe('300');
    expect(svg.getAttribute('height')).toBe('75');
  });

  it('goes away when the mouse leaves, and on a click or a key', () => {
    const { root, chip, tip } = setUp(() => ({ label: '2b', name: '1-Phenylethanol', svg: SVG }));
    hover(chip);
    vi.advanceTimersByTime(500);
    chip.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: root }));
    expect(tip.el.hidden).toBe(true);
    hover(chip);
    vi.advanceTimersByTime(500);
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    expect(tip.el.hidden).toBe(true);
    // (leaving before it shows: it never does)
    hover(chip);
    chip.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: root }));
    vi.advanceTimersByTime(500);
    expect(tip.el.hidden).toBe(true);
  });

  it('has none for a table’s label, and says so for a compound without a structure', () => {
    const asked: string[] = [];
    const { chip, table, tip } = setUp((id) => { asked.push(id); return id === 'c-1' ? { label: '2b', name: '', svg: null, note: 'No structure' } : null; });
    hover(table);
    vi.advanceTimersByTime(500);
    expect(tip.el.hidden).toBe(true);
    hover(chip);
    vi.advanceTimersByTime(500);
    expect(tip.el.hidden).toBe(false);
    expect(tip.el.textContent).toBe('2bNo structure');
    expect(tip.el.querySelector('svg')).toBeNull();
    expect(asked).toEqual(['t-1', 'c-1']);
  });

  it('does not show while text is being selected with the mouse', () => {
    const { chip, tip } = setUp(() => ({ label: '2b', name: '1-Phenylethanol', svg: SVG }));
    chip.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, buttons: 1 }));
    vi.advanceTimersByTime(500);
    expect(tip.el.hidden).toBe(true);
  });
});
