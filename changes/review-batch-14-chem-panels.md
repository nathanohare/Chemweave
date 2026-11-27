Fixed: Settings ▸ Analysis: changing which places a lab calculation shows in, or pressing Reset, is no longer undone by a stale read of the form.
Fixed: Settings ▸ Analysis: editing a lab calculation no longer changes its significant figures when it was set to 1 or 6.
Fixed: Analysis: solubility is no longer written with an exponent near 100 mg/mL, and a value just under 1 mg/mL reads as 1.0 mg/mL.
Fixed: Lab Calculator: typing the limiting reagent's amount now works out the equivalents of the others.
Changed: Compound Library: clicking, arrowing and typing in a long library are much faster. Pictures are drawn only as their rows scroll into view, and rows are kept as you search.
Fixed: Compound Library: Enter, Delete and the arrow keys on a focused button press that button instead of inserting, deleting or moving the selection, and Enter no longer inserts while Insert is dimmed. Ctrl+A still selects every compound shown.
Fixed: Ligand Library: Enter on the PubChem link follows the link, and the arrow keys on a family tab no longer step the ligand cards or use the template.
Fixed: Crystal Structure: pressing Enter in the atom Find box searches instead of placing the figure and closing the window.
Fixed: Import Review: Select All no longer ticks the hidden "not a structure" pictures, so they are not placed.
Fixed: Import Review: a SMILES you typed for a row is no longer overwritten when an older reading of that row finishes.
Fixed: Knowledge Base: opening it again starts with an empty search, with every table's rows showing.
Fixed: Knowledge Base: "Looking for compounds containing it" is added once, not again on every scroll, and removing an imported table drops its filters and sort.
Changed: Knowledge Base: typing a structure searches faster, because each row's structure is worked out once, including rows of tables imported later.
Fixed: Newman Projection: an older search for conformers can no longer replace the newest one.
Fixed: Newman Projection: a touch that the system cancels no longer leaves a drag behind that closes the window and inserts the structure on the next move.
Fixed: Energy Diagram: changing the axis quantity or the unit keeps the energies you typed over values from a file, and the zero stays the first file's energy of the kind shown.
Fixed: Energy Diagram: From Name or SMILES asks in the program's own window, naming the species, which works in the desktop app.
Fixed: Energy Diagram: Insert and Redraw say what is missing when no energy has been typed, instead of doing nothing. Flat 2-D structures are laid out once and kept.
Fixed: 3-D Model: Stop during xTB Refine keeps the conformers already refined and says it was stopped. Closing the window with × or Esc stops a running search.
Fixed: 3-D Model: Gaussian input from the window uses a Gaussian method instead of an ORCA one, and says so when it swaps the method.
Fixed: 3-D Model: the method buttons are off while a new model is being built, and the Spin button shows when spinning has stopped.
Fixed: 3-D Model: Copy Picture draws element letters and lines at the same relative size as the window, and a second click on Export no longer leaves a menu behind that swallows Esc.
Fixed: 3-D Model: typing 0 in the count of conformers to refine means one, and the saved count is no longer lowered by a small molecule.
Fixed: NMR: Check Data runs again when the solvent changes, so its note to select the solvent clears, and the list stays on the nucleus you were looking at.
Fixed: NMR: the peak label size in Settings ▸ NMR Prediction now applies on screen and in pictures, and Copy as Picture and Put on Canvas keep the label leader lines.
Fixed: NMR: the panel's list follows a quality change made in the Spectrum window, and dragging the Spectrum window by its title bar ends when the system cancels the pointer.
Fixed: NMR: Copy as Picture says the picture could not be made when that is the problem, not that the copy was refused.
Changed: NMR: an NMR section opened with the panel is predicted once, not twice, and moving over the spectrum strip no longer redraws the structure when the same peak stays under the pointer.
Fixed: Build Step by Step: the Animate Steps offer appears or goes away when you add or remove structures and captions from the selection, not only when the arrows change.
Fixed: Energy Diagram geometry window: fading or hiding an atom of a molecule and then undoing it no longer shows other hidden atoms again.
Fixed: Group tooltips: a drawing that could not be made before the chemistry engine loaded is tried again on the next hover.
Fixed: Group tooltips: a charge such as the 2+ of [Cu(NH3)4]2+ or Ca2+ is shown raised, not as a subscript.
Under the hood: regression tests for each fix in this batch.
