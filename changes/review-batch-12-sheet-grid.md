Fixed: Spreadsheet: Total Row only moves the cells under the table, in the table's own columns; whatever is beside the table stays where it is, turned on or off.
Fixed: Spreadsheet: Increase and Decrease Indent reach every empty cell of the block selected, and a long column keeps each cell's own level.
Fixed: Spreadsheet: Fill Down and Fill Right fill the cells selected below or beside the data, and no longer replace the first cell with the one above it.
Fixed: Spreadsheet: a filter's list of values no longer hides every row whose value isn't listed when one is unticked in a column of more than 1000 values; the list says how many it shows.
Fixed: Spreadsheet: Strikethrough and a lowered or raised cell show in copied cells and in printouts.
Fixed: Spreadsheet: Cut then Paste on another sheet moves the cells (formulas that pointed at them follow), in one step.
Fixed: Spreadsheet: Fit Height and Fit Width to Contents on several rows or columns undo in one step.
Fixed: Spreadsheet: Row Height, Column Width, Fit to Contents, Hide and Delete Rows work on rows and columns below or right of the data, and a cleared size box no longer collapses the rows.
Fixed: Spreadsheet: switching sheet, adding one or deleting one while a cell's data validation alert is waiting, or while typing, no longer puts the typing on the wrong sheet.
Fixed: Spreadsheet: text running over empty cells shows over their fill colors, and keeps showing when its own cell is scrolled out of view or frozen beside them.
Fixed: Spreadsheet: selecting a whole column or the whole sheet no longer makes the grid lay out a million rows; later edits and zooming stay quick.
Fixed: Spreadsheet: resizing a column or row past the data with whole columns selected sets the one you dragged, and dragging a column border no longer measures every wrapped cell for each step.
Fixed: Spreadsheet: double-clicking the fill handle counts on (1, 2 then 3, 4; S1 then S2), as dragging it does.
Fixed: Spreadsheet: a pasted column of SMILES strings draws at most 500 structures and says so, instead of working through every row.
Fixed: Spreadsheet: a Sort, a pasted structure or a pasted SMILES column that finishes after you change sheet goes to the sheet it was started on, and a deleted sheet is left alone.
Fixed: Spreadsheet: Convert Column to Values keeps error results as text (and says so) instead of emptying the cells.
Fixed: Spreadsheet: Insert Link links every cell selected; Copy leaves hidden rows and columns out of the text for Excel; Print Titles refuses columns typed as rows (and rows as columns); a picture converted after you change sheet is not put on the wrong sheet.
Fixed: Spreadsheet: Conditional Formatting: the Data Bars preview matches the entry pointed at, changing a fill-only rule keeps it fill-only (and keeps its underline), and the up and down arrows in Manage Rules move a rule past the next rule shown.
Fixed: Spreadsheet: a touch that the browser takes over no longer leaves a column resize or other drag stuck; arrow keys stay put when only hidden rows lie above; the border under a hidden row resizes the row above it; Page Down moves by the rows that fill the window; zooming keeps the same cells at the top left; wrapped text in merged cells doesn't make the row tall.
Under the hood: the notes layer no longer writes every note out each time the grid is drawn.
Under the hood: tests for the spreadsheet grid findings of the November 2026 review (batch 12).
