// Format and Chemistry menus per mode (retrospective audit G5-27, S85): Document and Spreadsheet
// get their own Format and Chemistry commands as plain items (no "Spreadsheet" submenu), and each
// item names a command the mode runs.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = (f: string) => readFileSync(join(__dirname, '..', f), 'utf8');
const html = src('index.html');
const menu = (id: string) => {
  const at = html.indexOf(`<div id="${id}"`);
  return html.slice(at, html.indexOf('<div class="menu-wrap">', at));
};
const items = (m: string, mode: string) => [...m.matchAll(new RegExp(`<button data-modes="${mode}" role="menuitem[a-z]*"[^>]* data-cmd="([a-z-]+)"`, 'g'))].map((x) => x[1]);

describe('Format menu per mode (G5-27)', () => {
  const fmt = menu('format-menu');
  it('Document has Font, Paragraph, Tabs, Borders and Shading and Styles', () => {
    expect(items(fmt, 'document')).toEqual(['font-box', 'box-para', 'para-tabs', 'borders-shading', 'styles-launcher']);
  });
  it('Spreadsheet has Format Cells and its own items straight in the menu, not in a submenu', () => {
    expect(items(fmt, 'sheet').slice(0, 4)).toEqual(['format-cells', 'new-rule', 'manage-rules', 'data-validation']);
    expect(fmt).not.toContain('>Spreadsheet</button>');
  });
  it('every item runs in its mode', () => {
    const doc = src('src/ui/doc-mode.ts'), sheet = src('src/ui/sheet-mode.ts');
    for (const c of items(fmt, 'document')) expect(doc, c).toContain(`'${c}'`);
    for (const c of items(fmt, 'sheet')) expect(sheet, c).toContain(`'${c}'`);
  });
});

describe('Chemistry menu per mode (G5-27)', () => {
  const chem = menu('chemistry-menu');
  it('Document and Spreadsheet get their structure commands', () => {
    expect(items(chem, 'document')).toEqual(['insert-structure', 'structure-from-name-doc', 'compound-number']);
    expect(items(chem, 'sheet')).toEqual(['structure-from-name', 'property-column', 'reagent-table']);
    const doc = src('src/ui/doc-mode.ts'), sheet = src('src/ui/sheet-mode.ts');
    for (const c of items(chem, 'document')) expect(doc, c).toContain(`case '${c}'`);
    for (const c of items(chem, 'sheet')) expect(sheet, c).toContain(`case '${c}'`);
  });
});
