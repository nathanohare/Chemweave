Fixed: Canvas: after Draw Next Intermediate, the lone pairs and charges of atoms the curved arrows don't change stay stuck to their atoms, so they move with them.
Fixed: Canvas: Arrange Scheme no longer fails on a catalytic cycle when another structure on the page is in no step; that structure is left where it is.
Fixed: Canvas: a Smart Scheme's own Shortest arrow length no longer carries over to Clean Up Reaction, Arrange Scheme and other schemes for the rest of the session.
Fixed: Canvas: Clean Up Reaction no longer puts a starting material on top of the product of the step before when that product is not the one nearest the arrow; the two sit side by side with a + between them.
Fixed: Canvas: Arrange Scheme uses the drawing style's own scheme distances, as Clean Up Reaction does, so the two commands no longer undo each other's spacing.
Fixed: Canvas: a new species added to a Smart Scheme whose first step is an equilibrium arrow gets an ordinary reaction arrow, not one shaft with half heads at both ends.
Fixed: Canvas: a fused loop can no longer be added along the whole of a cycle; some of the cycle is always left for the loop already there.
Fixed: Canvas: a Smart Scheme whose species have all been deleted no longer stops the drawing from being shown when it is selected.
Fixed: Canvas: selection changes no longer slow down on a drawing with a large Smart Scheme and another large structure.
Fixed: Canvas: deleting one atom of a focal bond or ring sends the focal point back to the middle of the box, instead of leaving it on the atoms that are left.
Fixed: Analysis: a metal labeled with its ligands written first (LnPd, L2Pd) is counted in Electron Count, and a metal label that can't be read is still counted from its drawn bonds, with its note shown.
Fixed: Analysis: an impossible isotope is flagged on atoms with a partial bond or in a transition state, and on an unlabeled metal it no longer hides the stereo label warning.
Fixed: Analysis: an atom sitting on a bond more than four bond lengths long is flagged.
Fixed: Lab Calculator: amounts that round up to a power of ten show the number of significant figures asked for (10.0 mg, not 10.00 mg).
Fixed: Spreadsheet: in a Stoichiometry Table, a concentration of 0 or text such as "neat" no longer gives an error in Volume (µL); the volume comes from the density instead.
Fixed: Spreadsheet: in a Stoichiometry Table, E-factor and PMI count a row typed just under the table, and the note under the table says how to add solvents and work-up.
Under the hood: Arrange Scheme lays out a branch of a branching scheme once for each side, not again for every side and slant it might take.
