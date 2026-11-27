Fixed: Canvas: Clean Up Structure keeps stereocenters drawn with hollow or wavy wedges as it keeps ones drawn with plain wedges, and turns a hollow wedge over when a layout is flipped.
Fixed: Canvas: Contract Label refuses a selection in more than one piece instead of deleting the atoms that aren't joined to the group.
Fixed: Canvas: Show Terminal Methyls on a selection with no chain end no longer takes every written-out CH₃ and Me off the rest of the drawing.
Fixed: Canvas: the t-Bu or tBu look leaves ligand abbreviations such as tBuDavePhos, ItBu, iPr-MACHO and t-Bu-Xantphos as they are spelled, so they are still read as the ligand.
Fixed: Canvas: clearing a stereo label typed by hand takes the typed text off the drawing where the rules can't decide a label.
Fixed: Canvas: Expand Label keeps deuterium in CD₃ and OCD₃ labels and keeps the charge set on the label (PPh₃ with a +).
Fixed: Canvas: redrawing a chair flat keeps a wedge that starts at a substituent's own stereocenter, and a substituent's far atoms move in depth with the rest of it.
Fixed: Canvas: Clean Up Structure counts a ring one atom bigger than its limit as a macrocycle, so a 37-membered ring no longer stalls it.
Fixed: Canvas: Kekulize and saving report at once that a circled ring system with one carbon too many has no Kekulé structure, instead of searching for a long time.
Fixed: Canvas: a two-species catalytic cycle is drawn as a round loop instead of two crossing curves.
Fixed: Newman Projections: torsion angles follow IUPAC's sign, so the projections drawn on a torsion energy chart show the right rotamer for a chiral bond.
Fixed: 3-D Model: finding more conformers by turning a bond, and xTB Refine, keep each conformer's count of equivalent forms in its population.
Fixed: 3-D Model: Place on Page and Best View no longer hold up the window for seconds on large models.
Fixed: Analysis: a saved m/z or exact-mass line with no decimal places set keeps its own default of 4, and vapor pressures from 99.5 to 100 read 100 instead of 1.0e+2.
Fixed: Analysis: deuterated compounds (CDCl₃, DMSO-d₆) get a density estimate.
Fixed: CAS RN lookups stop with a message when PubChem or NCI CACTUS stalls after starting to answer, and the message names the service that failed.
Fixed: Files: a CIF value with an exponent and an uncertainty (1.5e-3(2)) gets the right uncertainty.
Fixed: Files: a crystal structure with contacts longer than 4 Å (caesium salts) draws those bonds, and a molecule written wrapped across a cell face is grown once.
Fixed: Files: a stereocenter that carries a text label keeps its enhanced stereo group (and, or) when saved as MOL or SDF.
Fixed: Files: a damaged nickname SMILES in a settings or ChemDraw file no longer freezes or breaks label reading.
Fixed: Energy diagrams: Gaussian routes written as #B3LYP or #CBS-QB3, with em=gd3bj, or with scrf(smd,solvent=thf) give the right level of theory and energy.
Fixed: Energy diagrams: species names keep locants (2-naphthol) and endings such as Ser-Asp, and lose every job word (INT2_opt_freq becomes INT2).
Fixed: Lab Calculator: very small values such as a 2 nM concentration show their figures instead of 0.
Fixed: NMR prediction: the methyl protons of fluoromethane couple to fluorine.
Fixed: Text and paste: a CXSMILES with its |…| extras is read as a structure.
Under the hood: the chemistry engine's requests are answered with an error when a restarted engine can't start, Knowledge Base substructure searches always search the set they asked about, stereo labels worked out for a structure edited meanwhile are not shown, and a Hammett reference written with 〰 is named as a wavy bond in messages.
