Fixed: Design: a diagram line that starts with a word in square brackets, such as [Pd] oxidative addition or [M]-H complex, keeps its words in every layout but the icon list, where the brackets still choose the icon; changing an icon list to another layout in the Diagram window takes its icon names out of the text.
Fixed: Design: a structure dropped into a diagram's item stays with that item when a line is added or taken out above it in the Diagram window.
Fixed: Design: an icon list redrawn before its icons have loaded (as when a diagram changed in Word is opened) keeps its icons instead of turning them into plain circles.
Fixed: Design: an energy diagram species whose structure holds two or more separate molecules is no longer drawn again on top of itself each time the diagram is redrawn.
Fixed: Design: in an energy diagram, two pathways' species in one column at different energies, or with different names, each get their structure, and a later pathway's own name for a species at the same energy as another's is written under it.
Fixed: Design: an energy diagram's name shared by two pathways in a column goes under the lower of their levels, levels keep their width when two species are given the same position, dotted curves take the join line width, and the level of theory takes the diagram's font.
Fixed: Design: a sawhorse projection draws Ac (acetyl) and Pr (propyl) as groups instead of actinium and praseodymium atoms, and draws labels in italics when Settings ▸ Newman Projections says so.
Fixed: Design: an MO diagram with orbital pictures, drawn again after a change, has one set of p-orbital and hybrid lobes instead of a new set over the old ones.
Fixed: Design: an MO diagram of lithium or beryllium beside a 2p orbital no longer joins the bonding orbitals to the atom's empty 2p.
Fixed: Design: a TLC or gel spot typed with a word such as "constructor" is read as no color.
Fixed: Design: faded atoms are faded in ORTEP style too, and a very large ORTEP crystal drawing with principal ellipses can be fitted and placed on the page.
Fixed: Canvas: Animate Reaction pairs each product atom once when an atom of a symmetric molecule is paired by hand on an equivalency-sign step, and the rest of the molecule follows the hand pair.
Fixed: Canvas: Animate Reaction finds a group turning about a bond in a starting material drawn beside another molecule, and animates a second reaction drawn apart from the first instead of leaving it out: the first fades out and the second fades in, with no made-up step between them.
Fixed: Canvas: Animate Reaction no longer counts an aromatic bond as a double bond when marking the bonds that break and form in the Whole Scheme style, as for a ring drawn with a circle.
Fixed: Canvas: Animate Reaction and Map Atoms no longer freeze on large steps or on two drawings joined by an equivalency sign that are not the same molecule, and Map Atoms on a large step with a pair chosen by hand uses just the hand pairs.
Fixed: Canvas: Save MP4 shows the video encoder's own error when it fails, and Import Pairing says when a one-step file with only slides or a malformed step can't be used.
Changed: Canvas: Animate Reaction plays, scrubs and saves GIF animations of large schemes faster.
Under the hood: tests for code review batch 28 (Design diagrams and the reaction animation).
