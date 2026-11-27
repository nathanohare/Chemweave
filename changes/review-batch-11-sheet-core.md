Fixed: Spreadsheet: a semicolon-separated file whose numbers use decimal commas (1,5;2,5) opens and pastes into the right columns with the separator on Auto.
Fixed: Spreadsheet: a formula that read cells on another sheet that were then deleted shows #REF!, not #NAME?, and still follows later row and column changes.
Fixed: Spreadsheet: references such as AB5 or AA1:AD40 typed without $ work in Solver, Change Data Source and defined names.
Fixed: Spreadsheet: a workbook asking for more than 20,000 chemistry answers no longer keeps working them out again for ever.
Fixed: Spreadsheet: a structure filter the chemistry engine can't finish says so and leaves those rows showing, instead of hiding them as if they didn't match.
Fixed: Spreadsheet: Borders reach the empty cells of a selection, so an Outside Border on empty cells draws the whole box.
Fixed: Spreadsheet: Clear Formats and Clear All on whole columns clear formatted empty columns past the data too.
Fixed: Spreadsheet: Copy, Cut, Paste and Fill keep a cell's Compound data type and an array formula; Fill keeps bold or colored words inside a cell; Clear Formats no longer turns a Compound back into plain text.
Fixed: Spreadsheet: Data ▸ Filter leaves rows you hid yourself, or in a collapsed group, hidden when it is turned on, changed or turned off.
Fixed: Spreadsheet: two defined names that use each other no longer stop the sheets from working out; the cells show an error.
Fixed: Spreadsheet: Home ▸ Cell Styles such as Good or Heading 1 keep the cells' number format (dates stay dates); Normal still puts back General.
Fixed: Spreadsheet: formatting a block of up to 250,000 cells keeps the format in its empty cells, so numbers typed there later show in it.
Fixed: Spreadsheet: merging cells over a spilled array shows #SPILL! straight away, and unmerging lets it spill again.
Fixed: Spreadsheet: conditional formatting that reads another sheet updates when a value is typed there.
Fixed: Spreadsheet: STEYX gives 0 for points on a straight line, LOG(1000) is exactly 3, COUNT of one cell skips TRUE and text as a range does, SORT and SORTBY keep empty cells last when sorting largest first, and COUNTIF, SUMIF and AVERAGEIF accept a single cell.
Fixed: Spreadsheet: SUMIF and AVERAGEIF with a smaller sum range use one as large as the range tested, as Excel does.
Fixed: Spreadsheet: OFFSET and FIELDVALUE on a LET name for cells on another sheet read that sheet; DUPLICATE no longer finds a cell itself when the range names its own sheet.
Fixed: Spreadsheet: WORKDAY with a huge number of days gives #NUM! instead of freezing the program.
Fixed: Spreadsheet: small numbers joined to text are written with two-digit exponents (1E-07), as in Excel.
Fixed: Spreadsheet: Insert Property Column no longer takes a column of names such as Aspirin or THF for SMILES.
Changed: Spreadsheet: long running totals over formula columns, long banded tables, filters on long tables or long value lists, DUPLICATE down a long list, and Copy or Format Painter on whole columns are much quicker.
Under the hood: tests for review batch 11 (spreadsheet engine).
