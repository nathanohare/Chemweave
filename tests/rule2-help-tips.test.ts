// UI rule 2 (help text behind an "i", never on a line of its own; retrospective audit G5-29):
// the help lines the sweep found are now in "i" tips by the heading or label they explain, and
// the paragraphs that held them are gone (R16: a replacement removes what it replaces).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = (f: string) => readFileSync(join(__dirname, '..', f), 'utf8');

describe('help behind an "i"', () => {
  it('Lab Calculator: Make a Solution and Dilution', () => {
    const s = src('src/ui/lab-calc-dialog.ts');
    expect(s).toContain("addInfo(sMass.row.querySelector('span'), 'Dissolve, then make up to the volume in a volumetric flask.')");
    expect(s).toContain("addInfo(c1.row.querySelector('span'), 'Leave one box empty and it is calculated (c₁V₁ = c₂V₂).')");
    expect(s).not.toMatch(/el\('p', 'muted small', 'Dissolve|el\('p', 'muted small', 'Leave one box/);
  });
  it('Name Manager: Refers to', () => {
    const s = src('src/ui/sheet-formulas-ui.ts');
    expect(s).toMatch(/addInfo\(refersRow\.querySelector\('span'\), 'Cells \(=Sheet1/);
    expect(s).not.toContain("el('p', 'ask-help muted', 'Refers to:");
  });
  it('Set Up Show: the kiosk note (its radio button\'s tooltip says the same) is gone', () => {
    expect(src('src/ui/show-setup-dialog.ts')).not.toContain('kioskNote');
    expect(src('src/deck/show-setup.ts')).toContain("tip: 'Full screen, advancing automatically by slide timings and looping until Esc. Clicks only follow links and action buttons'");
  });
  it('Animate: the pairing instructions are on the Pairing heading', () => {
    const s = src('src/ui/animate-dialog.ts');
    expect(s).toContain("withInfo(el('h3', undefined, this.steps.length > 1 ? `Pairing for step ${i + 1}` : 'Pairing'), introText)");
    expect(s).not.toContain("const intro = el('p', 'muted'");
  });
  it('SI Import: Sections and References pages', () => {
    const s = src('src/ui/si-import-dialog.ts');
    expect(s).toContain("el('h3', 'si-imp-title', 'Sections')");
    expect(s).toContain("el('h3', 'si-imp-title', 'References')");
    expect(s).not.toMatch(/el\('p', 'muted', 'The SI’s text outside|el\('p', 'muted', 'Each reference as read/);
  });
  it('SI Project Settings ▸ NMR Impurities: on the Solvent and δ column heads', () => {
    const s = src('src/ui/si-settings.ts');
    expect(s).toContain("if (h === 'Solvent') addInfo(th,");
    expect(s).toContain("if (h === 'δ (ppm)') addInfo(th, 'Rows without a number in δ are left out.')");
    expect(s).not.toContain("note.textContent = 'Rows without a number");
  });
  it('Settings ▸ Apps and System: the File Types heading carries the platform note', () => {
    const s = src('src/ui/file-types-page.ts');
    expect(s).toContain("subhead('File Types', host.platform === 'web'");
    expect(s).not.toMatch(/\bnote\(/);
  });
  it('Highlight Style: the note is the Style box\'s tip', () => {
    const s = src('src/main.ts');
    const at = s.indexOf("const got = await ask('Highlight Style', [");
    const call = s.slice(at, s.indexOf('});', at));
    expect(call).toContain("help: 'The ready-made styles keep the highlight");
    expect(call).not.toContain('note:');
  });
});
