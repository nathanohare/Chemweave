Fixed: Spreadsheet: number formats that scale by thousands after the decimals (such as 0.0,,"M") show the scaled number, as Excel does.
Fixed: Spreadsheet: Increase Decimal and Decrease Decimal change the number in formats with a currency, locale or condition in brackets (such as [$€-407] #,##0.00), not the bracketed code.
Fixed: Spreadsheet: formats with the word General in them (such as General" mg") show the number with their text.
Fixed: Spreadsheet: formats with text between digit groups (000-0000, 000-00-0000) put the digits on both sides of the text.
Fixed: Files: OpenDocument spreadsheets keep values in every copy of a row repeated more than 1000 times (a row repeated to the foot of the sheet stops at about 250,000 cells, and the file says so on opening), the height and hiding of repeated empty rows, and the bold, fill and alignment of named cell styles such as Heading 1.
Fixed: Files: in old Excel workbooks (.xls) with a chart sheet, formulas and sheet names point at the right sheet, and references into other workbooks keep their values.
Fixed: Files: Excel charts with Standard Error bars no longer show bars of 1; these and one-sided error bars are named when the file opens.
Fixed: Files: Excel scatter charts drawn with lines keep their lines, and a chart's text size is no longer taken from one axis title.
Fixed: Files: Excel charts placed at a fixed position on the sheet open, and a chart resized in Excel opens at its new size.
Fixed: Files: shape text colored by an Excel shape style shows in that color instead of white.
Fixed: Files: pictures, shapes and text boxes named "Structure ..." in Excel are kept in workbooks saved here.
Fixed: Files: a filter's range follows rows inserted or deleted inside it in Excel.
Fixed: Files: Contains filters for text with * or ? are saved so Excel matches the characters themselves, and open again as Contains.
Fixed: Files: date cells with a time but no time zone open at the time written, whatever the computer's time zone.
Fixed: Files: links on ranges larger than 1000 rows or 100 columns cover the whole range, and a block of cells with the same link is saved to Excel as one link.
Fixed: Files: names on a sheet stay on that sheet when the hidden sheet of drop-down lists was moved in Excel.
Fixed: Files: sparklines with no empty-cell setting show empty cells as zero, as Excel does, and custom views open the sheet they were made on.
Fixed: Files: freezing panes in a sheet that was saved scrolled down no longer freezes the wrong row in Excel.
Fixed: Files: whole-row formatting from Excel, which isn't kept, is now named when the file opens.
Fixed: Files: a structure in a hidden column saved as a ChemDraw object no longer makes a damaged Excel file.
Fixed: Files: in a dashboard saved for Excel, a chart's numbers no longer run into the tile below it, and a short table tile no longer writes a row past its edge.
Fixed: Files: CSV and SD files saved as UTF-16 big-endian open with the right characters.
Fixed: Files: SD files saved from a sheet with a blank row under the header keep the field names, and keep a second column with the same header as the title column.
Changed: Files: old Excel workbooks, and Excel files with many formulas, embedded objects or sorted structure tables, open faster.
Under the hood: Tests for the Excel, OpenDocument and number-format fixes of review batch 17.
