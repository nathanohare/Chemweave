Fixed: SI Project: a file dropped or pasted on a compound's report box, the manuscript or the attachments is added once, instead of also landing on the hidden drawing or opening in a new tab.
Fixed: Copy and paste: a pasted reaction stays selected whole, so its arrow and + signs move with it and are kept inside a page's fixed edge.
Fixed: Copy and paste: Cut deletes what it copied, even when something else is clicked or another slide or tab comes up while the copy is made.
Fixed: Copy and paste: CDXML text on the clipboard that can't be read is pasted as text in a document or a spreadsheet, instead of nothing happening.
Fixed: Copy and paste: Copy as Molfile Text on an empty drawing says there is nothing to copy instead of copying an empty molfile.
Fixed: Slides: a guide being dragged, or dragged out of a ruler, is drawn where the pointer takes it.
Fixed: Slides: Fit Keyframe to Selection keeps the keyframe's title, zone color, spotlight and detour.
Fixed: Slides: Slide Show ▸ Clear acts on the slides selected in Slide Sorter.
Fixed: Slides: narration recorded with Record Slide Show is undone with its timings in one step, and is not lost without a word when the presentation is closed while the recording is being kept.
Fixed: Slides: Lock Structures says it works on slides when used elsewhere, instead of claiming a lock it doesn't apply.
Fixed: Slides: Insert ▸ Action Settings is grayed out for the frames of TLC plates, Smart Schemes, Newman projections and torsion charts, which it can't change.
Fixed: Slides: Export Picture works on a canvas slide whose selected keyframe was deleted.
Fixed: Settings: choosing the style that is already the default for new files in File ▸ Drawing Style, with its box left alone, no longer changes that default.
Fixed: Files: Batch Convert to a SMILES list offers a .smi file name instead of .zip, and converting into a folder never writes over a file already there (the new file gets a " (2)" name).
Fixed: Canvas: Picture Style shows at once and marks the file as changed.
Fixed: Canvas: the Analysis panel stays cleared when the selection is cleared while a structure is still being analyzed.
Fixed: Canvas: Place on Page in the 3-D Model window works only on the drawing and structure the model was made from, and its check of the stereocenters never undoes an edit made meanwhile.
Fixed: Canvas: a picture waiting to be placed goes away when another tab or slide comes up, and the next click works as usual.
Fixed: Canvas: a linked Newman projection whose slide or tab was left before it was worked out again is worked out when it shows again.
Fixed: Canvas: Expand Label, Contract Label, Number Compounds, Clean Up Structure, Smart Clean, Clean Up Options and Orient Like First are not applied to another drawing that comes up while the chemistry engine works.
Fixed: Canvas: Map Atoms is undone in one step when its number box style was changed, and changes nothing when there is no reaction step to map.
Fixed: Canvas: Name to Structure skips a text box deleted while its name was looked up, and puts the structure where the box is now.
Fixed: Canvas: Scale works when the bond length box is cleared and a size is typed.
Fixed: Canvas: Orient Like First says only that the structures could not be compared when that happens, and Clean Up and Orient Reaction is undone in one step.
Fixed: Canvas: the Undo button shown after a flip that inverts stereocenters undoes only the flip, and says so when something else has changed since.
Fixed: Canvas: Text Guides can be turned off for a plain reaction arrow selected with other straight arrows.
Fixed: Canvas: Chemistry ▸ Check Structure goes to the text box problems the Warnings box lists, such as an ion without its charge.
Fixed: Canvas: changing Outline the rest of a group in Settings ▸ General shows at once.
Fixed: SI Project: Add to SI Project with several structures is undone in one step.
Fixed: Document: documents linked to two SI projects changed close together both follow the changes.
Fixed: Help ▸ Send Feedback: the page picture of a very large drawing keeps to 2000 pixels a side.
Fixed: View ▸ Reading Mode Colors: a palette chosen and saved under a new name keeps that palette's colors.
Fixed: Format Favorites: renaming a favorite to the name of another one is refused instead of deleting the other favorite.
Changed: Slides: opening a deck with many pictures and typing or dragging in Outline View on a long deck are faster.
Under the hood: the Analysis panel asks for a structure's name once when asked twice at once, and a descriptor text box whose structure the engine can't weigh is not sent to it again until the structure changes; Print splits each canvas slide once.
