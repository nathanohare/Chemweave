Fixed: Assistant: turning on an item that starts off under Will Send, such as the whole document's text, now sends it with your question instead of switching it off again.
Fixed: Assistant: asking a second question before the first answer arrives now shows both answers and no longer leaves a Thinking line behind.
Fixed: Assistant: Accept and Reject can be used again after an Accept that could not be carried out, and a card's Undo only takes back its own proposal, never a later change.
Fixed: Slides: dragging a picture or shape in the Selection Pane to a new place puts it where you drop it, even when the slide has text boxes, structures and arrows listed above it.
Fixed: Design: the Layers panel no longer rebuilds its whole list on every step of a drag on a page with many shapes.
Fixed: Format: renaming a palette in Edit Palettes keeps the new name when you then change, add or take out a color in that row.
Fixed: Spreadsheet, Document: the first Esc after choosing an item from a right-click menu now reaches the window or edit it opened, instead of being swallowed.
Fixed: View: choosing a smaller grid in Customize Toolboxes and answering Take Them Out now makes the grid smaller for toolboxes and fly-outs that were never customized, and deleting a toolbox of your own no longer says Restore Deleted Toolboxes brings it back.
Fixed: Help: What's New opens after the update notice was dismissed with Later or Skip This Version.
Fixed: Settings: the AI Model window keeps a key you typed when the Other server address is missing, and the Esc key answers the Apply Your Changes question instead of being ignored.
Fixed: Settings: Apps and System no longer saves an empty Open With list when the current list could not be read.
Fixed: Canvas: Arrange in a Grid corrects the Rows box to the number of rows the columns really make.
Fixed: Canvas: Name to Structure no longer draws the structure after you press Cancel while the name is being read.
Fixed: Canvas: the Guides toolbox puts the old tick spacing back when you press Esc or type a value that is not a length.
Fixed: Slides: a keyframe drag no longer writes back the keyframes from before an Undo pressed during the drag, and a drag cancelled by the system lets go cleanly.
Fixed: Document: a plain click on an existing tab stop in the ruler leaves it where it is and adds no Undo step, and a cancelled click on the ruler no longer leaves a new tab stop drawn.
Fixed: Dragging floating boxes, tool windows and rows in lists now stops cleanly when the system cancels the touch or pen, and a cancelled row drag no longer moves the row.
Fixed: Customize Ribbon: moving groups in a tab keeps hidden groups where they were instead of sending them to the end of the tab.
Fixed: Customize Quick Access Toolbar: adding a command that is already on the bar puts it right after the selected button.
Fixed: Drop-down lists: pressing a list's scrollbar no longer closes it, and the first key typed after it was closed already narrows it.
Fixed: Search Commands starts on its first row each time it opens.
Fixed: Insert: clicking Shapes or Icons again while its menu is open closes the menu.
Fixed: New spreadsheet: the sample pictures on template cards show drawn structures once the chemistry engine has finished loading.
Under the hood: Tests for each of these fixes, from the 2026-11-26 code review.
