Fixed: Document: typing into a shape's text puts the caret and the typed words in the middle of the shape, where its text is drawn, and a click lands on the letter under it.
Fixed: Document: double-clicking a plain header in a protected document no longer takes away the last step of Undo.
Fixed: Document: Outline view's Promote and Promote to Heading 1 no longer turn body text hidden by Show Level or a folded heading into headings.
Fixed: Document: applying a style, deleting one, or Home ▸ Clear All Formatting keeps a paragraph's index entries, marked citations, Set Numbering Value, Shift+Enter lines and content controls, and the text's language, content control and tracked formatting changes.
Fixed: Document: Select Text with Similar Formatting no longer takes in a single different character, line break or figure between two matching stretches.
Fixed: Document: Remove Cover Page can no longer delete the whole document after the cover's page break was joined away, and it puts back the first page's header and page number only if the document had them before.
Fixed: Document: Accept All Changes, Reject All Changes and the count of changes now include footnotes and endnotes, and a reviewer can type tracked changes in a footnote of a document protected for tracked changes.
Fixed: Document: Home ▸ Sort changes only the paragraphs sorted: tracked changes, comments and the look of the paragraph breaks elsewhere stay as they were.
Fixed: Document: Sort by Date no longer reads text such as "see note 2" as a date, and the same day written two ways sorts together; Case sensitive puts capitals first, as its label says.
Fixed: Document: Word Count counts each table cell's words and paragraphs on their own, and no longer counts a footnote or text box that was deleted.
Fixed: Document: Save Selection to Quick Part Gallery leaves out words deleted as tracked changes and their marks.
Fixed: Document: Convert to Text keeps a section break, page break or bookmark on the table's paragraph; Split Table no longer copies them to the new table; Merge Cells with an empty first cell no longer starts with an empty line.
Fixed: Document: text in a table cell after a heading takes its own paragraph's font and size.
Fixed: Document: a PAGEREF field in a header or footer shows the bookmark's page, and a table of authorities with nothing marked in its category says how to mark citations.
Fixed: Document: in an exported PDF, links in table cells, footnotes and endnotes can be clicked, and the labels of a flipped structure sit where the screen shows them.
Fixed: References: BibTeX import reads \url, \ce and \underline as commands instead of accents; a RIS record with only an end page has no stray dash, and one with no ER line is no longer lost.
Fixed: References: a damaged file naming a citation style such as "constructor" no longer stops the reference list from showing.
Fixed: Review ▸ Compare keeps characters such as mathematical italic letters and emoji whole.
Changed: Document: Replace All, Accept All Changes, tracked formatting, Sort, Delete Style, Promote and Demote, dragging headings in the Navigation pane, change bars, rich headers and footers, typing in a protected document and Zotero's Refresh are much faster in long documents.
Under the hood: regression tests for the document engine findings of the November 2026 code review (batch 10).
