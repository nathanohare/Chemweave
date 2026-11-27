Fixed: Desktop app: a portable copy no longer registers file types or changes the ones already set on the computer when it starts.
Fixed: Desktop app: starting the app no longer makes Windows refresh every desktop icon and folder window when the file types have not changed.
Fixed: Desktop app: on Windows, the full screen slide show window is no longer shrunk to the work area, showing the taskbar, when the main window is maximized.
Fixed: Desktop app: opening and saving big files, and loading the structure reader's model file, no longer freezes the window while the disk is read or written.
Fixed: Desktop app: a portable copy that updates itself now restarts reliably instead of sometimes closing and not coming back.
Fixed: Desktop app: on a Mac, choosing Cancel when quitting with unsaved work no longer closes the slide show's audience window.
Fixed: Settings: saved AI keys are written so that only you can read the file from the first moment, and a keys file that cannot be read is never written over: you are told, and a damaged one is kept aside.
Fixed: Settings: for an Other AI model, changing the address no longer leaves the key shown as saved: a key is only sent to the address it was saved for, so you are asked before saving without one.
Fixed: Files: Find Structure in Files now says the list is partial when folders were nested too deeply or the folder held too many items, and stops sooner in a huge tree with few drawings.
Fixed: Data ▸ Get Data ▸ From Web no longer cuts off a big file that is still arriving, and an answer that is too large is refused as it arrives instead of after all of it was received. The same goes for AI and Zotero answers.
Fixed: 3-D Model: when the program chosen for xtb does not answer the check, the message no longer blames a conformer taking 15 minutes.
Fixed: SI Project: a portable copy keeps its working copies of opened projects in its Chemweave Data folder, not on the computer it is plugged into, and still offers back the ones an earlier version left there.
Fixed: Canvas: Format Painter and Format Favorites now take the whole look of drawings, so a plain shape, atom or arrow painted over a colored, filled, dashed or shadowed one makes it plain.
Fixed: Canvas: text in Arial is measured correctly for primes, arrows, math signs, Greek letters and special spaces, and marks that take no room (combining accents, zero-width spaces) add none, so exported pictures, CDXML boxes and centering match Word and PowerPoint.
Fixed: Document: Change Case now capitalizes a word that follows an opening straight quote.
Fixed: Document: a rule under a heading merged across several rows no longer cuts through the merged cell, and inserting or deleting the first column no longer changes the other columns' alignment.
Fixed: Spreadsheet: links, PivotChart series and sparklines on a sheet whose name looks like a cell (S1, Q1, FY2024) are written with the quotes Excel needs.
Fixed: Canvas: the Thicken Lines fix in Check Figure for Journal no longer thickens every bond when two thin arrows or shapes overlap.
Fixed: Canvas: Check Accessibility sees alt text given to a structure that starts with a point of attachment, and is much faster on workbooks with thousands of merged cells.
Fixed: Canvas: choosing U-turn for an arrow whose handles were dragged now puts the U-turn back, and the Shape box shows Own path for it.
Fixed: Canvas: scaling a drawing style as a whole now scales its Results text size, and a drawing in the Elsevier style opens Drawing Style on Elsevier, not Wiley.
Fixed: Help: Send Feedback no longer fails to open a page when long text is cut inside an emoji, gives up when the answer stalls after it starts, and hides account folder names that contain spaces, with the cause of a stalled send said plainly.
Fixed: Help: a problem report for an error that was pushed out of the log by newer entries still includes that error.
Fixed: Files: in the web version, a failed attempt to open the list of recent files is retried instead of failing until the page is reloaded, and a file opened just after another is no longer dropped from Open Recent.
Fixed: Canvas: NMR predictions and PDF export of Hebrew, Arabic, Chinese and Japanese text try again after a failed download instead of staying switched off until restart.
Under the hood: Added tests for these fixes and for the Rust parts, which now also check the folder listing limits, the AI keys file, the file type refresh and reading oversized answers.
