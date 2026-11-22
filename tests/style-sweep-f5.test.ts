// Style-guide sweep leftovers (retrospective audit F5): American spelling in visible text.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = (f: string) => readFileSync(join(__dirname, '..', f), 'utf8');

describe('style sweep (F5)', () => {
  it('Spreadsheet Header and Footer boxes say center, not centre', () => {
    const s = src('src/ui/sheet-page-ui.ts');
    expect(s).toContain('label: `${label}: ${k}`,');
    expect(s).not.toContain("'centre'");
  });
});
