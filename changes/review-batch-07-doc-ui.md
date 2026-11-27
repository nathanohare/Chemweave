Fixed: Document: Insert ▸ Quick Parts ▸ Field ▸ Time now shows the time (it showed today's date).
Fixed: Document: Make Editable reads a cropped EMF or SVG picture at its own proportions, and a crop that rounds past the picture's edge or reaches outward no longer reads wrong pixels.
Fixed: Document: changing the style of a structure made editable keeps what you corrected by hand (atoms, colors, arrows, shapes and captions), drawn at the other style's bond length, and keeps its size, turn, tracing and cleared alt text, instead of going back to the first reading.
Fixed: Document: right-clicking the body text while typing in a table cell, text box or note now works on the body text clicked, not on the box's text.
Fixed: Document: the Text Highlight Color menu highlights the text in the table cell, text box or note you are typing in, and with Select Text with Similar Formatting it highlights every place found.
Fixed: Document: on a Mac, Option+Left, Option+Right, Option+Backspace and Option+Delete work by word.
Fixed: Document: Paste from the Home tab or the right-click menu brings the structures, citations, fields and tables of text copied in the document, as Ctrl+V does.
Fixed: Document: dragging a structure's top-right corner handle resizes it from the left edge instead of shrinking it to a sliver.
Fixed: Document: the Spelling and Grammar pane no longer changes text at the wrong place after you edit the document or switch documents, and each step is much faster in long documents.
Fixed: Document: the Navigation pane no longer searches the whole document again and rebuilds every result when the caret moves; very long result lists show the first 500 (Enter still goes through all of them), folded headings stay folded when paragraphs are added above them, new searches start at the first result, and Shift+Enter starts at the last.
Fixed: Document: Web Layout, Draft and Outline draw only the part of the document on the screen, so they stay quick in long documents.
Fixed: Document: Use SI Values, linking an SI project and inserting a letter of a compound number are each one step of Undo.
Fixed: Document: Insert ▸ Link to a heading is one step of Undo.
Fixed: Document: Table Design ▸ Cell Margins ▸ OK with nothing changed changes nothing; the table style gallery no longer swallows the next Escape; Sort with "The first row is a heading" unchecked sorts that row too and the table no longer has a heading row.
Fixed: Document: Cross-reference lists a caption that follows a picture on the same line with its own number; Compound Number and Insert Citation in a table cell no longer leave the next text bold or raised.
Fixed: Document: Shift+F3 (Change Case) keeps cycling with the cursor in a word; Insert Table with 0 rows or columns gives 1; the Thesaurus works in table cells and text boxes and keeps the spaces round a selected word; clearing First page number leaves the numbering alone (0 still works, to leave a cover page unnumbered).
Fixed: Document: Read Mode comes back on the page you were reading after switching tabs; a new split window shows View Gridlines as the first one does; Wrap Text keeps a figure where it was in documents whose sections have different page sizes; the figure panel uses the margins of the figure's own section.
Fixed: Document: the Style controls of the Paragraph and Style panels are off while you type in a table cell, text box or note (they used to restyle the paragraph that holds it); the Line Spacing boxes work on the cell's own paragraph.
Changed: Document: References ▸ Mark Entry's Mark All now says it marks every paragraph with the selected text, or the word at the cursor when nothing is selected (which is what it always did).
Under the hood: tests for the Document mode review findings in this batch; the split window's view now lets go of its window and picture watchers when it is closed, and a cancelled pointer ends a drag in the page and on the split bar.
