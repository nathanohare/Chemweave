// @vitest-environment jsdom
// Increase/Decrease Font Size on an SI Live Preview selection of mixed sizes: every size stretch
// steps from its own size, written as ONE change, so one Undo takes it all back (the standing rule:
// every command undoes in one step).
import { describe, expect, it, vi } from 'vitest';
import { SiPreview } from '../src/ui/si-preview';

type Any = Record<string, unknown>;

function rig(): { pv: Any; writes: unknown[][]; formats: number } {
  const pv = Object.create(SiPreview.prototype) as Any;
  const writes: unknown[][] = [];
  let formats = 0;
  const file = { ed: { text: 'aaabbb', start: 0, end: 6, collapsed: false, select: vi.fn() } };
  Object.assign(pv, {
    file, editable: true, dirty: new Set(), fresh: new Set(), editGen: 0, owner: 'o', spans: [], blocks: [],
    // each stretch's plan: a change to the formatting file only (a size never goes in a field)
    planFormat: async (look: Any, s: number, e: number) => ({ fields: [], later: [(items: unknown[]) => [...items, { s, e, look }]], printedNow: new Map() }),
    api: { writeFormat: async (fields: unknown[], change: (x: unknown[]) => unknown[]) => { writes.push(change([])); void fields; }, flash: () => {} },
    format: async () => { formats++; return true; },
    written: new Map(), bumpWritten: () => {},
  });
  return { pv, writes, get formats() { return formats; } } as never;
}

describe('SI Live Preview: Increase Font Size on mixed sizes', () => {
  it('writes every size stretch in one change (one Undo step)', async () => {
    const r = rig();
    const done = await (r.pv.formatEach as (x: unknown) => Promise<boolean>).call(r.pv, [
      { start: 0, end: 3, look: { size: 12 } },
      { start: 3, end: 6, look: { size: 20 } },
    ]);
    expect(done).toBe(true);
    // one write holding both stretches, each with its own new size; no stretch formatted on its own
    expect(r.writes).toHaveLength(1);
    expect(r.writes[0]).toEqual([{ s: 0, e: 3, look: { size: 12 } }, { s: 3, e: 6, look: { size: 20 } }]);
    expect(r.formats).toBe(0);
  });
});
