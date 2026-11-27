Fixed: SI Project: a spectrum page's Frame, Caption and Look settings now show and hide their Width, Caption Size and Color boxes as you change them.
Fixed: SI Project: choosing a general procedure no longer wipes the placeholder values you had typed, and a double-click on an NMR report's ✕ removes that report only.
Fixed: SI Project: Move Up and Move Down on a scheme page move the page among its section's pages, not the whole section.
Fixed: SI Project: Cite from My Library takes Enter in its Search box as Add, and cites into a compound that had no References value yet.
Fixed: SI Project: Tab through the ID table keeps the keyboard focus after each entry.
Fixed: SI Project: the project's dictionary is read again after you leave and return to the tab, Add by DOI keeps a comma or semicolon that is part of a DOI and adds nothing to a project you have left, and the browser's spelling check stays on when Chemweave's speller can't be loaded.
Fixed: SI Project: two changes made quickly to the default fields of a Data section both stay, and the arrow keys scroll the page when a button on it has the focus (they still move between rows in the tree).
Fixed: SI Project: Add Field ▸ A custom field gives names with no letters or digits a field each, instead of overwriting one.
Fixed: SI Project: Paste Spectrum reads the clipboard before waiting for earlier saves, and no longer says it pasted when the spectrum could not be saved.
Fixed: SI Project: dropping report files on a compound writes the HRMS field and the report as one step of Undo.
Fixed: SI Project: Live Preview compiles again after a failed compile, and the numbers of tables, figures and schemes are worked out only when the project's files change, so big projects stay quick.
Fixed: SI Project: the tree looks up the open flags once, not once for each compound.
Fixed: SI Project: Insert Structure in a scheme's conditions is one step of Undo, and changing an ID or yield no longer redraws the whole strip, so your keys and structures stay put.
Fixed: SI Project: a file dropped on the Attachment preview or the Manuscript Check page is no longer also opened by the window; Remove File keeps the file and the section as they were when the section can't be saved, and a replaced PDF of the same name and size shows its new pages.
Fixed: SI Project: Manuscript Check no longer runs two checks at once, and says that the check failed instead of "Reading the manuscript…" when it could not be made.
Fixed: SI Project: on the cover page a Spacing over the most shows the value that was kept, and a double-click on an author's ✕ takes off that author only.
Fixed: SI Project: a double-click on a row in Trash starts one Restore, not two.
Fixed: SI Project: pasted HTML keeps the cells of a table row apart and a list item holding a paragraph stays on one line.
Fixed: SI Project: the progress window no longer waits for animation frames while the window is hidden.
Fixed: SI Project: Move Up and Move Down of a spectrum no longer read and check every file again, and a structure box made smaller on blank space keeps the place where it is dropped.
Fixed: SI Project: a spectrum set to "(not matched)" in Import SI can be found again, what you type in the references while Crossref is asked is kept, and a section name cleared and left comes back in its box.
Fixed: SI Project Settings: a dictionary.txt that can't be read is no longer shown as empty and written over, an empty NMR tolerance box keeps the tolerance it had, and changing Normal moves the styles that follow it without saving the old Normal into them.
Fixed: SI Project: a double-click in a figure's Label box selects a word instead of opening the drawing tools, and Paste Picture says so when the clipboard holds only text.
Under the hood: new tests for the SI tab's pages and windows (tests/review-batch06-*.test.ts), and the SI project's Undo history counts its file changes so work done from the folder can be cached.
