// The UI text check (scripts/lint-ui-text.mjs, standing rule R12): banned words, British spellings
// and flat formulas in what people read. First the checker on strings known to be right or wrong,
// so it stays accurate, then the whole app.
import { describe, expect, it } from 'vitest';
import { checkText, flatFormulas, formulaParts, tsStrings, pageStrings, lintRepo, describeProblem, KNOWN_UI_TEXT } from '../scripts/lint-ui-text.mjs';

const rules = (s: string, o?: { command?: boolean; input?: boolean }) => checkText(s, o).map((p: { rule: string; found: string }) => `${p.rule}:${p.found}`);

describe('the checker', () => {
  it('passes text that follows the style guide', () => {
    for (const s of [
      'Rotate the selection 90° clockwise',
      'Snap to Objects',
      'Turn on AutoSave', // "turn on" is Office's word for a setting, not a rotation
      'Next turn: Nate', // and "turn" for a turn in a sequence is fine
      'Selected structures: 3',
      'Colors and palettes',
      'Center on Page',
      'Gray outline',
      'Analyze the selection',
      'Organize favorites',
      'The cursor is in a table cell',
      'Custom styles',
      'Chemweave could not open the file',
      'Cell C1 must hold a number', // a cell reference, not carbon
      'Press F5 to start the slide show', // a key
      'Copy as ChemDraw-style drawing',
      'Open ChemDraw XML drawings (.cdxml)', // a file type keeps its name
      'Page 1 of 12',
      'Use Ctrl+Z to undo',
      'Code U+00B0', // a character code, not a uranium cation
      'BF₄⁻ and [M+H]⁺',
      'H₂O',
      'N-methyl', // a hyphen before a word is not a charge
      'Emphasis', // a noun, not the British verb
      'Otherwise the analysis is skipped',
      'Licensed under the GPL',
      'MP4 video', // a file type
      'B3LYP/6-31G(d)', // a method name
    ]) expect(rules(s, { command: true }), s).toEqual([]);
  });

  it('finds banned words (S26, S64, S70)', () => {
    expect(rules('Delete the references picked')).toEqual(['S26:picked']);
    expect(rules('Turn the selection a quarter turn clockwise')).toEqual(['S26:turn clockwise']);
    expect(rules('Positive turns clockwise')).toEqual(['S26:turns clockwise']);
    expect(rules("It's your turn")).toEqual(['S26:your turn']);
    expect(rules('Insert a picture at the caret')).toEqual(['S70:caret']);
    expect(rules('It opens in the program your computer uses')).toEqual(['S70:the program']);
    expect(rules('Make your own palette')).toEqual(['S70:your own']);
    expect(rules('Toggle object snapping')).toEqual(['S64:Toggle']);
    expect(rules('MW worked out from the structure')).toEqual(['S26:worked out']);
    expect(rules('Numbers figures by itself')).toEqual(['S26:by itself']);
  });

  it('finds British spellings (UI rule 2)', () => {
    for (const [s, w] of [['Fill colour', 'colour'], ['Behaviour', 'Behaviour'], ['Centre on page', 'Centre'], ['Grey', 'Grey'], ['Organise styles', 'Organise'],
      ['Recognised solvents', 'Recognised'], ['Analyse the selection', 'Analyse'], ['Favourites', 'Favourites'], ['Labelled atoms', 'Labelled'], ['Normalising', 'Normalising'], ['Dialogue', 'Dialogue']]) {
      expect(rules(s), s).toEqual([`UI rule 2:${w}`]);
    }
  });

  it('finds formulas written flat (S27)', () => {
    expect(flatFormulas('show what is missing (e.g. H2O or HCl)')).toEqual(['H2O']);
    expect(flatFormulas('in CDCl3 at 25 °C')).toEqual(['CDCl3']);
    expect(flatFormulas('CH4 and NaBH4')).toEqual(['CH4', 'NaBH4']);
    expect(flatFormulas('a BF4- salt')).toEqual(['BF4-']);
    expect(flatFormulas('Na+ and K+ ions')).toEqual(['Na+', 'K+']);
    expect(flatFormulas('an ion ([M+H]+, [M+Na]+)').length).toBe(2);
    expect(formulaParts('CDCl3')?.map((p: { sym: string; n: string }) => p.sym + p.n)).toEqual(['C', 'D', 'Cl3']);
    expect(formulaParts('Ctrl')).toBeNull();
  });

  it('leaves typed examples flat: placeholders, before → after, and quoted function arguments', () => {
    expect(rules('e.g. C12H13NO', { input: true })).toEqual([]);
    expect(rules('AutoFormat Chemical Formulas (CH2Cl2 → CH₂Cl₂)')).toEqual([]);
    expect(rules('The m/z: HRMS(B2,"[M+Na]+")')).toEqual([]);
  });

  it('finds "ChemDraw" in a command name only (S82)', () => {
    expect(rules('Copy for ChemDraw')).toEqual([]); // a tooltip phrase about the other program
    expect(rules('Gray outline (ChemDraw style)', { command: true })).toEqual(['S82:ChemDraw']);
    expect(rules('ChemDraw Clean Up', { command: true })).toEqual(['S82:ChemDraw']);
    expect(rules('Paste (Ctrl+V): structures from ChemDraw', { command: true })).toEqual([]);
  });

  it('reads only user-visible strings in code', () => {
    const src = `
      // a comment with colour and the program
      const id = 'toggle-snap';
      const attr = { 'w:color': 'auto', colour: 'red' };
      el.title = 'Fill colour';
      b.textContent = ok ? 'Done' : 'Toggle grid';
      flash(\`Saved \${n} files to your own folder\`);
      doc.edit('Centre atoms', () => {});
      x.setAttribute('aria-label', 'Grey');
      x.setAttribute('class', 'grey');
      const opts = { label: 'Picked items', value: 'picked' };
      box.innerHTML = \`<button class="colour" title="Behaviour">Organise</button>\`;
    `;
    const found = tsStrings(src).map((s: { text: string }) => s.text);
    expect(found).toEqual(['Fill colour', 'Done', 'Toggle grid', 'Saved   files to your own folder', 'Centre atoms', 'Grey', 'Picked items', 'Behaviour', 'Organise']);
  });

  it('reads text and tooltips in HTML, not ids, classes or scripts', () => {
    const html = '<div id="colour-box" class="grey"><button role="menuitem" data-cmd="toggle-x" title="Toggle the grid">Centre</button>\n<script>const colour = 1;</script>\n<input placeholder="e.g. CH4" /></div>';
    const s = pageStrings(html);
    expect(s.map((x: { text: string }) => x.text)).toEqual(['Toggle the grid', 'Centre', 'e.g. CH4']);
    expect(s.find((x: { text: string }) => x.text === 'Centre').command).toBe(true);
    expect(s.find((x: { text: string }) => x.text === 'e.g. CH4').input).toBe(true);
  });
});

describe('the app', () => {
  it('has no new problems in user-visible text (docs/ui-style.md)', () => {
    const problems = lintRepo();
    const fresh = problems.filter((p: { known: boolean }) => !p.known);
    // Known problems (scripts/lint-ui-text-known.mjs) that have since been fixed: delete their lines.
    const found = new Set(problems.map((p: { file: string; found: string }) => `${p.file}\t${p.found}`));
    const stale = KNOWN_UI_TEXT.filter((k: { file: string; found: string }) => !found.has(`${k.file}\t${k.found}`));
    if (stale.length) console.warn(`${stale.length} known UI text problem(s) are fixed; run node scripts/lint-ui-text.mjs --stale and delete those lines.`);
    expect(fresh.map(describeProblem).join('\n'), 'Fix the wording (docs/ui-style.md), or for a deliberate exception add it to ALLOWED in scripts/lint-ui-text.mjs with the reason').toBe('');
  }, 60_000);
});
