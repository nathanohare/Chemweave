Fixed: Files: AutoSave and recovery copies keep running while a tool window such as Symbol or a PivotTable's fields stays open beside your work.
Fixed: Files: AutoSave no longer stops for a file, with no notice, when a check for changes on disk happens while the app is saving it. On a slow folder (OneDrive, a network drive) the app no longer takes its own save for a change made elsewhere.
Fixed: Files: a recovery copy that can't be reopened at the next start is kept, so File ▸ Versions and Recovery ▸ Recover Unsaved Work can try again. Before, it was deleted.
Fixed: Files: AutoSave and Recovery Options keeps each number within its limits as soon as you press Save. AutoSave can no longer be set to save every 0 seconds, and a field left empty keeps its value.
Fixed: Files: closing a tab no longer closes another tab's notices, such as tab 12's "changed on disk" notice when tab 1 closes.
Fixed: Files: Restore Version stops, and says why, when what the tab has now can't be kept as a version first. Your unsaved changes are no longer replaced.
Fixed: Files: one tab that can't be copied no longer stops the recovery copies of every other tab.
Fixed: Desktop app: after an update's restart, the copy of an unsaved tab is kept until that tab's recovery copy has been made, and then let go.
Fixed: Web version: saving, and listing versions and recovery copies, no longer reads every kept copy into memory.
Fixed: Assistant: an answer that shows a SMILES or a scheme in a block of its own before its proposal keeps the proposal, and Accept is offered.
Fixed: Assistant: an answer cut off at the AI service's length limit now says so, instead of ending without a word.
Fixed: Knowledge Base: Reagent Safety finds harmonized hazard codes written with their EU letter (H360D, H360FD, H350i). DMF, NMP and similar solvents now show "May damage fertility or the unborn child", and nickel salts with H350i get the Carcinogen 1A/1B badge.
Fixed: Knowledge Base: the lowest LD50 for each route compares doses in mg/kg, so 50 mg/kg is shown ahead of 0.2 g/kg.
Fixed: Knowledge Base: nitrobenzene, the nitroanilines, pyridine N-oxide and other neutral compounds with charges written apart now get a skin permeability estimate. Salts and zwitterions such as glycine still get none.
Fixed: Knowledge Base: "Ca" on calcium (the Electronegativity table's symbols, Ca²⁺) no longer shows NIOSH's carcinogen note. "(Ca)" after an IDLH still does.
Fixed: Knowledge Base: Hammett Constants files styryl, (E)-prop-1-enyl, phenylazo and the other groups written with a double bond's geometry under the atom they're attached through, not Other.
Fixed: Knowledge Base: in Hard and Soft Acids and Bases, the negative electron affinities sort before the positive ones, and Copy Table pastes them into Excel as numbers.
Fixed: Library: syncing with Zotero keeps a reference's own collections, PubMed ID and abstract when Zotero has the same paper. A tag taken off in Zotero is taken off here too, and tags you added here stay.
Fixed: Library: changes you make while Sync with Zotero is still reading your Zotero library are no longer undone when it finishes. An item Zotero lists twice no longer makes two references, and a collection deleted in Zotero no longer comes back.
Fixed: Library: the PubMed ID box in References and the Library takes a pasted citation or PubMed link and adds only its PMIDs ("PMID: 31234567", "PMIDs 1, 2 and 3", pubmed.ncbi.nlm.nih.gov/…), not the year, volume and pages. A group author such as "ATLAS Collaboration CERN" stays as written, and a Zotero group's web address with the group's name in it is accepted.
Fixed: Library: an item without an id in the library file no longer appears twice after a save. Changes made to the library on another computer show in the open Library windows. A save that failed is tried again, including when the app closes.
Fixed: Find Structure in Files: a second search of a large folder no longer reads thousands of files again, and "contains" searches check the indexed structures in one go.
Fixed: NMR: a terminal vinyl CH (styrene, 1-hexene) is predicted as dd, not tt.
Fixed: NMR: Check Data stops reading a peak list at the next nucleus's list (19F, 31P) or at HRMS, IR, mp, [α]D or Rf, so those numbers are no longer taken for peaks. A solvent written (CD₃)₂SO or (CD₃)₂CO in the header is recognized.
Fixed: NMR: after a background prediction or simulation fails once, the next one runs in the background again instead of on the main thread.
Fixed: Import From Picture and Make Editable: Ts, Ac, Pr, Ar and Y written as groups stay groups, instead of becoming tennessine, actinium, praseodymium, argon or yttrium atoms. Iodine labels written as a bare I are found.
Fixed: Import From Picture: a reader that stops partway now says so, instead of waiting forever. An AI model's answer in words gives its SMILES, not its first word, and a SMILES with a stereo backslash is read.
Fixed: Make Editable: caption words NaCI and AcCI become NaCl and AcCl, while CIP, CIS, compound labels such as S10, and formulas such as C10H21 and C10H20 are left as written. Boc20, Ag20 and the like still become Boc₂O and Ag₂O.
Fixed: NMR: predicted spectra no longer use 3-D coupling constants for bonds next to a three- or four-membered ring (cyclopropanes, oxetanes), and the two protons of a CH₂ with different shifts share the mean of their couplings, so their multiplets match.
Fixed: Find Structure in Files: hits from files already indexed show at once, before the search reads a file that takes a while.
Fixed: NMR: Check Data also ends a peak list at a melting point written M.p. or Mp.
Under the hood: the safety-data build script loads the PubChem reader in Node again.
