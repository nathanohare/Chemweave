Fixed: Spreadsheet: a Total Row goes into the row under the table when it is free, and otherwise makes a whole row so merges, tables, rules and formulas under the table follow; when cells beside the table would have to move, it says so and changes nothing.
Fixed: Spreadsheet: removing a Total Row only clears it when nothing is directly under it, and leaves the cells where they are when others sit beside the table.
Fixed: Spreadsheet: Increase and Decrease Indent reach every empty cell of a block of up to 10,000 cells, say so when a bigger block's empty cells are left as they are, and keep each cell's own level in a long column.
Fixed: Spreadsheet: Fill Down and Fill Right fill the cells selected below or beside the data, and no longer replace the first cell with the one above it.
Fixed: Spreadsheet: unchecking one value in a filter's list of more than 1,000 values no longer hides every row whose value isn't listed, and with (Select all) unchecked only the values checked show; the list says how many it shows.
Fixed: Spreadsheet: Strikethrough and a lowered or raised cell show in copied cells and in printouts.
Fixed: Spreadsheet: Cut then Paste on another sheet moves the cells in one step, and formulas that pointed at them follow.
Fixed: Spreadsheet: Cut then Paste into another workbook pastes there and clears the cells where they were, and says that Undo in each workbook takes back its part.
Fixed: Spreadsheet: Fit Height and Fit Width to Contents on several rows or columns undo in one step.
Fixed: Spreadsheet: Row Height, Column Width, Fit to Contents and Hide work on rows and columns below or right of the data, and on every row that holds data however many, and say when a selection is cut short.
Fixed: Spreadsheet: Delete Rows below the data takes out every row selected, and a cleared size box no longer collapses the rows.
Fixed: Spreadsheet: switching sheet, adding one or deleting one while a cell's data validation alert is waiting, or while typing, no longer puts the typing on the wrong sheet.
Fixed: Spreadsheet: text running over empty cells shows over their fill colors without hiding a sparkline there, and keeps showing when its own cell is scrolled out of view or frozen beside them.
Fixed: Spreadsheet: selecting a whole column or the whole sheet no longer makes the grid lay out a million rows, and Ctrl+Shift+Down or Right to the end of the sheet still scrolls there; later edits and zooming stay quick.
Fixed: Spreadsheet: Ctrl+Enter in a block of more than 500,000 cells says so and keeps what you typed, instead of freezing the app.
Fixed: Spreadsheet: resizing a column or row past the data sets every column or row selected, including those beyond the one you dragged.
Fixed: Spreadsheet: dragging a column border no longer measures every wrapped cell for each step.
Fixed: Spreadsheet: double-clicking the fill handle counts on (1, 2 then 3, 4; S1 then S2), as dragging it does.
Fixed: Spreadsheet: a pasted column of SMILES strings draws at most 500 structures and says so, instead of working through every row.
Fixed: Spreadsheet: structures drawn from pasted SMILES no longer finish the cell you are typing in.
Fixed: Spreadsheet: a Sort, a pasted structure or a pasted SMILES column that finishes after you change sheet goes to the sheet it was started on, and a deleted sheet is left alone.
Fixed: Spreadsheet: Convert Column to Values keeps error results as text (and says so) instead of emptying the cells, and waits for results still being calculated.
Fixed: Spreadsheet: Insert Link links every cell selected.
Fixed: Spreadsheet: Copy leaves hidden rows and columns out of the text for Excel.
Fixed: Spreadsheet: Print Titles refuses columns typed as rows (and rows as columns).
Fixed: Spreadsheet: a picture converted after you change sheet is not put on the wrong sheet.
Fixed: Spreadsheet: Conditional Formatting: the Data Bars preview matches the entry pointed at.
Fixed: Spreadsheet: changing a fill-only Conditional Formatting rule keeps it fill-only and keeps its underline.
Fixed: Spreadsheet: the up and down arrows in Manage Rules move a rule past the next rule shown.
Fixed: Spreadsheet: a touch that the browser takes over no longer leaves a column resize or other drag stuck.
Fixed: Spreadsheet: arrow keys stay put when only hidden rows lie above, and the border under a hidden row resizes the row above it.
Fixed: Spreadsheet: Page Down moves by the rows that fill the window, and zooming keeps the same cells at the top left.
Fixed: Spreadsheet: wrapped text in merged cells doesn't make the row tall.
Under the hood: the notes layer no longer writes every note out each time the grid is drawn.
Under the hood: tests for spreadsheet grid editing.
