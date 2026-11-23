// Wordings Nate chose (F8b item 10): the SI ribbon's picture and figure width boxes are
// "Custom width" (empty: the picture's own size), the Isotope Pattern window's compound box
// shows "Formula, such as C10H12N2O", and the guide says "your API key".
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

describe('wordings (F8b)', () => {
  it('SI Table Layout and Figure: "Custom width", with no "own" placeholder', () => {
    const si = read('src/ui/si-mode.ts');
    expect(si.match(/>Custom width <input type="number" class="rb-num" data-si-field="(fig-)?width"/g)).toHaveLength(2);
    expect(si).not.toMatch(/placeholder="own"/);
  });

  it('Isotope Pattern: the compound box\'s example', () => {
    expect(read('src/ui/sheet-mode.ts')).toContain("label: 'Compound', value: here, placeholder: 'Formula, such as C10H12N2O' }");
  });

  it('the guide says "your API key"', () => {
    for (const p of ['docs/guide/getting-started.md', 'docs/guide/drawing.md']) {
      expect(read(p)).not.toContain('your own API key');
      expect(read(p)).toContain('with your API key');
    }
  });
});
