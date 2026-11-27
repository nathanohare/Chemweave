Fixed: SI Project: a peak report typed with superscript digits ("¹H NMR (400 MHz, CDCl₃) …") no longer gets a second header in the compiled SI; its header is bold and linked to its spectrum as usual.
Fixed: SI Project: the Live Preview of a landscape section, or of a compound's spectra, shows its first page on its side.
Fixed: SI Project: the Live Preview of one section, sub-section or compound uses the heading level and heading number Compile prints.
Fixed: SI Project: the Live Preview numbers a compound's spectra pages without counting spectra that are left out of the SI (such as TIFF pictures), and no longer reads every earlier spectrum file again on each change.
Fixed: SI Project: the automatic X-ray caption names stick, space-filling and wireframe drawings as such, not as a ball-and-stick model.
Fixed: SI Project: the dashboard shows the spectrum type "2D NMR" as typed, not with a superscript 2.
Fixed: SI Project: stereodescriptors with lettered or primed locants, such as (3aR,7aS) or (1′R,2S), are printed in italics in compound titles.
Fixed: SI Project: the residual chloroform peak in CD₃OD is checked at δ 7.90.
Fixed: SI Project: the HRMS field's M can be set to any piece of a very large salt, not only the first.
Fixed: SI Project: the warning about a reference whose authors are typed on one line names the reference by its first author.
Fixed: SI Project: pasting nothing into a table no longer splits a merged cell.
Fixed: SI Project: a label font chosen in Project Settings with the default sizes is saved for SI Assistant too.
Fixed: SI Project: saving page settings keeps settings written by SI Assistant or a later version.
Fixed: SI Project: restoring a spectrum from the Trash when its name is taken again keeps its original file with it, so removing it later can't take another spectrum's original to the Trash; an original that can't be put back stays in the Trash as files to move back by hand.
Fixed: SI Project: deleting a section while another section's file can't be read keeps the deleted section's place and sub-sections for Restore.
Fixed: SI Project: a picture added to a section never writes over a picture of the same name with another extension.
Fixed: SI Project: replacing an X-ray section's CIF file when the new one can't be put in place leaves the old one in place.
Fixed: SI Project: Apply Default Fields lists Notes once when Notes is one of the default fields.
Fixed: SI Project: moving a compound of a scheme page to another section, when its folder can't be moved, leaves the scheme box as it was; drawing a structure over a box's picture, when it can't be saved, keeps the picture.
Fixed: SI Project: Undo waits for a save, move or deletion that is still under way, so it is never recorded into the wrong step.
Fixed: SI Project: Import SI keeps the first letters of numbered sub-headings ending in ":" or ".", such as "2.1 Solvents:".
Fixed: SI Project: Import SI no longer splits plain-numbered reference lists at a year (such as the "2" of "2010"), and still starts an entry at "2 (a)", a lower-case name such as "van der Waals" or a quoted title.
Fixed: SI Project: Import SI no longer turns ring locants in names or reaction orders, such as benzo[d][1,3]dioxole, [3,3]-sigmatropic or a [1,2] shift, into citations.
Fixed: SI Project: Import SI reads an optical rotation written without "=", such as "[α]D20 +12.3 (c 1.0, CHCl₃)", with its whole value, and one measured at a temperature with decimals, such as "[α]D 22.5 = +10.2".
Fixed: SI Project: Import SI gives compounds their structures from drawings labeled with a stereo prefix, such as "(S)-3a", and from unlabeled drawings of a salt; a reagent salt drawn beside a compound, such as AgOTf, is not taken for a compound.
Fixed: SI Project: Import SI keeps pictures and drawings placed in Word tables, and reads the text of tables nested three deep once.
Fixed: SI Project: Import SI reads Word paragraphs marked as body text (outline level 9) as text, not as headings.
Fixed: SI Project: Import SI keeps underlining in text it splits, and keeps short lines above a PDF figure's caption when the figure is cut from below it.
Fixed: SI Project: importing into an existing section keeps typed values of fields taken off a compound's page, and two general procedures of the same name get the right note.
Fixed: SI Project: the manuscript check no longer reports table cells without a value ("–", "n.d.", "trace") as differing from an empty SI value, nor bold numbers in headings and the reference list as compounds.
Fixed: SI Project: the manuscript check reports a compound number linked to an SI compound that was deleted, and manuscript data for a scheme label with no compound page.
Fixed: SI Project: Use SI Value in the manuscript check no longer doubles a sign or a % sign (">>99", "quant.%").
Fixed: SI Project: the Manuscript Check reads "r.t." as room temperature, and tries a structure comparison again after the chemistry engine has restarted.
Fixed: SI Project: an mzXML HRMS report with an empty scan can be read, an Excel listing says how many lines are really left out, and a report whose file name differs only in case is found.
Fixed: SI Project: an HRMS report read in the web version stays readable after its first read.
Changed: SI Project: importing spectra matches them to compounds faster, the X-ray checks keep their results for more structures, opening a project no longer reads attached text files, and pasting a large block into a table is quicker.
Under the hood: the SI engine's Python-style patterns treat "]" in a character class as Python does, and compound IDs in spectrum headers are found by a plain text search.
Under the hood: tests for the SI builder findings of the 2026-11-26 code review (batch 05).
