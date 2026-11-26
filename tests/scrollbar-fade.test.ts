import { describe, expect, it, vi } from 'vitest';
import { InUse, nearBar, NEAR_BAR_PX, SCROLLBAR_IDLE_MS } from '../src/ui/scrollbar-fade';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const pane = { left: 100, top: 50, right: 500, bottom: 450 };

describe('scroll bars thin until in use', () => {
  it('the pointer is near a bar only inside the pane, within reach of its right or bottom edge', () => {
    expect(nearBar(pane, 500 - NEAR_BAR_PX + 1, 200, true, false)).toBe(true);
    expect(nearBar(pane, 300, 200, true, true)).toBe(false);
    expect(nearBar(pane, 300, 440, true, false)).toBe(false); // no bar along the bottom
    expect(nearBar(pane, 300, 440, false, true)).toBe(true);
    expect(nearBar(pane, 520, 200, true, true)).toBe(false); // outside the pane
  });
  it('grows on use and goes thin a few seconds after the last use, or at once when told', () => {
    vi.useFakeTimers();
    const seen: boolean[] = [];
    const u = new InUse((on) => seen.push(on));
    u.poke();
    vi.advanceTimersByTime(SCROLLBAR_IDLE_MS - 100);
    u.poke(); // still in use: the wait starts again
    vi.advanceTimersByTime(SCROLLBAR_IDLE_MS - 100);
    expect(seen).toEqual([true]);
    vi.advanceTimersByTime(200);
    expect(seen).toEqual([true, false]);
    u.poke();
    u.off(); // the pointer left the pane
    expect(seen).toEqual([true, false, true, false]);
    // a thumb held still while dragged stays full, and goes thin the usual time after it is let go
    u.poke(); u.held = true;
    vi.advanceTimersByTime(SCROLLBAR_IDLE_MS * 3);
    expect(u.on).toBe(true);
    u.held = false;
    vi.advanceTimersByTime(SCROLLBAR_IDLE_MS + 10);
    expect(u.on).toBe(false);
    vi.useRealTimers();
  });
  it('the Canvas bars change thickness at the shared motion timings (none when Animations are Off)', () => {
    const css = readFileSync(join(__dirname, '..', 'src/app.css'), 'utf8');
    const thumb = css.match(/^\.scroll-thumb::before \{[^}]*\}/m)![0];
    expect(thumb).toContain('var(--m-std)');
    expect(thumb).not.toMatch(/\d+m?s\b/);
  });
});
