// Review batch 16 (UI wording sweep, Office modes): the windows and panels that need a whole
// spreadsheet, document or drawing on screen to build are checked in their source, the way
// tests/rule2-help-tips.test.ts does: the wording is Office's and in Title Case (docs/ui-style.md
// S70, standing rule 1), American spelling, and help sits behind an "i" tip, not on a line of its
// own (standing rule 3). Names are Excel's, Word's and PowerPoint's own.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = (f: string) => readFileSync(join(__dirname, '..', f), 'utf8');
const has = (f: string, ...needles: string[]) => { const s = src(f); for (const n of needles) expect(s.includes(n), `${f} should hold: ${n}`).toBe(true); };
const hasNot = (f: string, ...needles: string[]) => { const s = src(f); for (const n of needles) expect(s.includes(n), `${f} should not hold: ${n}`).toBe(false); };

describe('Spreadsheet windows keep help behind an "i"', () => {
  it('F1013 Data Table', () => {
    has('src/ui/sheet-analysis-ui.ts', "w.info('Put the input values in the top row");
    hasNot('src/ui/sheet-analysis-ui.ts', 'w.note(`The table: ${rangeName(sel)}. Put');
  });
  it('F1021 chart panel: drill and expand help is on the row label', () => {
    has('src/ui/sheet-chart-ui.ts', "addInfo(drilled.firstElementChild, 'Click a box of the chart", "addInfo(expanded.firstElementChild, 'Click a node of the chart");
    hasNot('src/ui/sheet-chart-ui.ts', "out.push(note('Click a box", "out.push(note('Click a node");
  });
  it('F1025 Remove Duplicates', () => {
    has('src/ui/sheet-data-ui.ts', "addInfo(w.form.querySelector('h2'), `In ${rangeName(all)}: rows whose checked columns match");
    hasNot('src/ui/sheet-data-ui.ts', "el('p', 'muted small', `In ${rangeName(all)}");
  });
  it('F1064 Create Sparklines, F1078 Custom Views', () => {
    has('src/ui/sheet-sparkline-ui.ts', "w.info('Choose the data range");
    has('src/ui/sheet-views-ui.ts', "w.info('A view saves the visible sheet");
    hasNot('src/ui/sheet-views-ui.ts', "w.note('A view saves");
  });
  it('F1050 Outline Settings', () => {
    has('src/ui/sheet-outline-ui.ts', "new ToolWindow('Outline Settings')", "w.info('Where the summary rows");
    hasNot('src/ui/sheet-outline-ui.ts', "'Outline settings'", "w.note('Where the summary");
  });
  it('F1057 PivotTable layout checkboxes', () => {
    has('src/ui/sheet-pivot-ui.ts', "w.check('Grand Totals for Rows'", "w.check('Grand Totals for Columns'", "w.check('Σ Values on Rows'");
    hasNot('src/ui/sheet-pivot-ui.ts', '(a Grand Total row at the bottom)', '(not across the columns)');
  });
  it('F1067 Data Validation uses Excel\'s labels', () => {
    has('src/ui/sheet-validation-ui.ts', "check('Ignore blank'", "check('Show error alert after invalid data is entered'", "[['stop', 'Stop'], ['warning', 'Warning'], ['information', 'Information']]");
    hasNot('src/ui/sheet-validation-ui.ts', 'Stop: it can', 'empty cells pass)', 'after something else is typed');
  });
  it('F1047 the cell panel', () => {
    has('src/ui/sheet-mode.ts', "button('Insert Property Columns…'", "button('Reset to Calculated'", "button('Change the Column\\'s Formula…'", "'Row Height' : 'Column Width'",
      "addInfo(calculated, 'Type in the cell to put a custom value instead.')");
    hasNot('src/ui/sheet-mode.ts', "para('Type in the cell to put a custom value instead.'");
  });
});

describe('Spreadsheet commands use Excel\'s names in Title Case', () => {
  it('F1017 Solver, F1032 Manage Rules', () => {
    has('src/ui/sheet-analysis-ui.ts', "'Close (Keep Model)'");
    hasNot('src/ui/sheet-analysis-ui.ts', "'Close (keep model)'");
    has('src/ui/sheet-format-ui.ts', "btn('Edit Rule…'");
    hasNot('src/ui/sheet-format-ui.ts', "btn('Change…'");
  });
  it('F1019 Through the Origin shows its check mark', () => has('src/ui/sheet-chart-ui.ts', "first?.intercept === 0 ? '✓ ' : ''}Through the Origin"));
  it('F1022 chart panel buttons', () => {
    has('src/ui/sheet-chart-ui.ts', "'Remove Series'", "'Reset Position'", "'Copy Equation'", "button('Add Series…'", "button('Copy as Picture'", "button('Delete Chart'");
    hasNot('src/ui/sheet-chart-ui.ts', "'Remove this series'", "'Reset position", "'Copy equation'", "button('Add series…'", "button('Copy as picture'", "button('Delete chart'");
  });
  it('F1027 sorting left to right says column', () => has('src/ui/sheet-data-ui.ts', "byCols ? 'There is only one column to sort.'"));
  it('F1039 Home menus', () => {
    has('src/ui/sheet-mode.ts', "'Bottom Border'", "'Top and Bottom Border'", "'Thick Bottom Border'", "'Outside Borders'", "'All Borders'", "'No Border'",
      "'Insert Sheet Rows'", "'Insert Sheet Columns'", "'Insert Sheet'", "'Delete Sheet Rows'", "'Delete Sheet Columns'", "'Delete Sheet'",
      "'No Fill' : 'Automatic'", "'More Colors… '", "'Sort Smallest to Largest'", "'Sort Largest to Smallest'", "' (Select All)'");
    hasNot('src/ui/sheet-mode.ts', "'Bottom border'", "'Insert rows above'", "'Delete this worksheet'", "'No fill'", "'Automatic (black)'", "btn('Sort smallest to largest'", "(Select all)");
  });
  it('F1065 sparkline Empty Cells menu', () => {
    has('src/ui/sheet-sparkline-ui.ts', 'Show Empty Cells as Gaps', 'Show Empty Cells as Zero', 'Connect Data Points with Line', 'Show Data in Hidden Rows and Columns');
    hasNot('src/ui/sheet-sparkline-ui.ts', 'Show empty cells', 'Connect data points', 'Show data in hidden');
  });
});

describe('Spreadsheet messages', () => {
  it('F1062 a connection-only load does not say rows were loaded', () => {
    has('src/ui/sheet-query-ui.ts', 'connectionOnly ? `${q.name} is a connection only.`');
  });
});

describe('Document and Slides wording', () => {
  it('F457 Mark Citation says it updated when nothing new was marked', () => has('src/ui/doc-index-ui.ts', "'Updated the citation under'"));
  it('F474 the Word dialog name', () => has('src/ui/doc-mode.ts', "ask('Footnote and Endnote', ["));
  it('F475 "look" is "style" or "formatting"', () => {
    has('src/ui/doc-mode.ts', "'Use Standard Formatting'", "label: 'Entry formatting'", "'Tracing Style'");
    hasNot('src/ui/doc-mode.ts', "'Use the Standard Look'", "'Entries look'", "'Tracing look'");
  });
  it('F479 header and footer window title', () => has('src/ui/doc-panel.ts', "hf: 'Header, Footer and Page Numbers'"));
  it('F483 the Figure section keeps only its size line, how to work with it is in the heading\'s "i"', () => {
    has('src/ui/doc-panel.ts', "this.figureTip = addInfo(s.querySelector('h3'), ' ')", 'setInfo(this.figureTip');
    hasNot('src/ui/doc-panel.ts', "this.figureInfo.textContent = (isBox ? 'A text box");
  });
  it('F672, F673 Format Background', () => {
    has('src/ui/background-dialog.ts', "head.textContent = 'Color Stops'", "'Apply to This Slide'");
    hasNot('src/ui/background-dialog.ts', "'Color stops: color, how far", "'Apply to this slide'");
  });
  it('F679 caption menu', () => has('src/ui/caption-editor.ts', "item('Leave as Written'"));
  it('F774, F777 reference style window', () => {
    has('src/ui/references-dialog.ts', "textContent: 'Reference Style'", 'as Chemweave fields');
    hasNot('src/ui/references-dialog.ts', "textContent: 'Reference style'", 'as Chem Illustrator fields');
  });
  it('F779 the References box button is named as the command is in the menus', () => {
    has('src/ui/refs-box.ts', "button('References on Slide…'");
    hasNot('src/ui/refs-box.ts', "button('Look…'");
  });
  it('F798 the gap tooltip tells the truth: 30% of the bond length, as the code uses', () => {
    has('src/ui/style-dialog.ts', 'Leave blank for 30% of the bond length', 'bl * 0.3');
    hasNot('src/ui/style-dialog.ts', 'a third of the bond length');
  });
});

describe('Panels and windows', () => {
  it('F693, F691 Dashboard panel', () => {
    has('src/ui/dashboard-ui.ts', "button('Clear All Filters'", "button('Clear This Slicer'", "button('Delete Tile'", "withInfo(head('Dashboard'), 'Click a tile to change it.");
    hasNot('src/ui/dashboard-ui.ts', "button('Clear all filters'", "button('Clear this slicer'", "button('Delete tile'", "out.push(note('Click a tile");
  });
  it('F682 Charts pane', () => {
    has('src/ui/chart-gallery.ts', "addInfo(this.box.el.querySelector('.fb-title')", "'Using example numbers.'");
    hasNot('src/ui/chart-gallery.ts', "'Each chart is drawn from the cells selected. Click one to insert it.' :");
  });
  it('F756, F757 Picture Format', () => {
    has('src/ui/picture-dialog.ts', 'foldIntoInfo(note, h)', "'Choose in Picture'", "'Mark Areas to Keep'", "'Mark Areas to Remove'", "'Clear Marks'", "head('Remove Background')");
    hasNot('src/ui/picture-dialog.ts', "'Choose in the picture'", "'Mark to keep'", "head('Remove background')", "unit('(what joins", "unit('(centered;");
  });
  it('F817 Typing and Spelling buttons', () => {
    has('src/ui/typing-dialog.ts', '>Add a Replacement</button>', '>Use the Standard List</button>');
  });
  it('F800, F801, F803, F805 Style panel', () => {
    has('src/ui/style-panel.ts', "'Lone Pair Style'", "button('Crop',", "'Remove White…'", "'Original Size'", "'Edit Chart…'", "'Edit Equation…'", "'Split into Single Bonds'", "'Tie the Others Too'",
      "'Insert Row Above'", "'Insert Column Right'", "'Merge Right'", "'Split Cells'", "'Fit Columns to Text'", "'Edit Title' : 'Add Title'", "['CH3', 'CH₃']",
      "this.help(cell ? 'Double-click a cell to edit; Tab moves to the next.'", "this.help('It counts in the formula, mass and SMILES");
    hasNot('src/ui/style-panel.ts', "'Lone pair look'", "'Crop with mouse'", "'Original size'", "'Row above'", "'Delete row'", "'Fit columns to text'", "['CH3', 'CH3']",
      "Double-click a cell to edit; Tab moves to the next.`", "It counts in the formula, mass and SMILES of what it is selected with.`");
  });
  it('F810 indent buttons are Decrease Indent and Increase Indent', () => {
    has('src/ui/text-bar.ts', "'Decrease Indent (Shift+Tab)'", "'Increase Indent (Tab)'", "'Line and Paragraph Spacing, Text Box Width'");
    hasNot('src/ui/text-bar.ts', "'Less indent", "'More indent");
  });
});

describe('Slide undo steps are in Title Case (F854)', () => {
  it('names the steps as the commands are named', () => {
    has('src/deck/deck.ts', "'Add Section'", "'Rename Section'", "'Remove All Sections'", "'Move Section'", "'Remove Section and Slides'", "'Change Layout'", "'Edit Slide Layouts'", "'Edit Slide Master'",
      "'Set Up Show'", "'Lock Layout Items'", "'Unlock Layout Items'", "'Rehearse Timings'", "'Clear Timings'", "'Show Reference on Slide'", "'References on Slide'", "'Stop Listing References'", "'Change Drawing Style'", "'Apply Background to All'");
    hasNot('src/deck/deck.ts', "'Add section'", "'Set up show'", "'Change drawing style'", "'Edit slide master'", "'Lock layout items'", "'Apply background to all'");
    has('src/main.ts', "'Set Up Show'", "'Rehearse Timings'", "'Clear Timings on All Slides'");
  });
});

describe('Round 2: the user guide names the buttons the app has', () => {
  it('uses the renamed buttons', () => {
    has('docs/guide/slides.md', '**References on Slide…**', '**Mark Areas to Keep**', '**Mark Areas to Remove**', '**Original Size**', '**Apply to This Slide**');
    has('docs/guide/design.md', '**Remove White…**');
    has('docs/guide/sheets.md', '**First-Order Decay**', 'Σ Values on Rows');
    has('docs/guide/documents.md', '**Replace All**');
    has('docs/guide/si-project.md', 'Header, Footer and Page Numbers');
  });
  it('no longer uses the old names', () => {
    hasNot('docs/guide/slides.md', '**Look…**', '**Mark to keep**', '**Original size**', '**Apply to this slide**');
    hasNot('docs/guide/design.md', '**Remove white…**');
    hasNot('docs/guide/sheets.md', '**First-order decay**', 'Σ Values down the rows');
    hasNot('docs/guide/documents.md', 'and **All** for every match');
  });
  it('other paths to the same commands use the same undo names', () => {
    has('src/ui/outline-view.ts', "'New Slide'");
    hasNot('src/ui/outline-view.ts', "'New slide'");
    has('src/ui/sheet-view.ts', "'Column Width' : 'Row Height'", "'Row Height' : 'Column Width'");
    hasNot('src/ui/sheet-view.ts', "'Row height'", "'Column width'");
    has('src/ui/sheet-mode.ts', "'Reset to Calculated'");
    has('src/ui/dashboard-ui.ts', "'Clear Slicer'");
    has('src/ui/dashboard-view.ts', "'Clear Slicer'");
    has('src/ui/background-dialog.ts', '`Apply to ${o.count} Slides`');
    has('src/ui/sheet-sparkline-ui.ts', "'More Colors… '");
  });
  it('the float box leaves an "i" in its title bar out of the drag', () => has('src/ui/float-box.ts', "closest('button, .info-icon')"));
});
