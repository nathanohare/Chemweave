Fixed: Files: AutoSave and recovery copies keep running while a tool window such as Symbol or a PivotTable's fields stays open beside your work.
Fixed: Files: AutoSave no longer stops for a file, with no notice, when a check for changes on disk happens while the app is saving it. On a slow folder (OneDrive, a network drive) the app no longer takes its own save for a change made elsewhere.
Fixed: Files: a recovery copy that can't be reopened at the next start is kept, so File ▸ Versions and Recovery ▸ Recover Unsaved Work can try again. Before, it was deleted.
Fixed: Files: AutoSave and Recovery Options keeps each number within its limits as soon as you press Save. AutoSave can no longer be set to save every 0 seconds, and a field left empty keeps its value.
Fixed: Files: closing a tab no longer closes another tab's notices, such as tab 12's "changed on disk" notice when tab 1 closes.
Fixed: Files: Restore Version stops, and says why, when what the tab has now can't be kept as a version first. Your unsaved changes are no longer replaced.
Fixed: Files: one tab that can't be copied no longer stops the recovery copies of every other tab.
Fixed: Desktop app: after an update's restart, the copies of your unsaved tabs are kept until their recovery copies have been made.
Fixed: Web version: saving no longer reads every kept version and recovery copy into memory each time an old version is deleted.
Fixed: Assistant: an answer that shows a SMILES or a scheme in a block of its own before its proposal keeps the proposal, and Accept is offered.
Fixed: Assistant: an answer cut off at the AI service's length limit now says so, instead of ending without a word.
Fixed: Knowledge Base: Reagent Safety finds harmonized hazard codes written with their EU letter (H360D, H360FD, H350i). DMF, NMP and similar solvents now show "May damage fertility or the unborn child", and nickel salts with H350i get the Carcinogen 1A/1B badge.
Fixed: Knowledge Base: the lowest LD50 for each route compares doses in mg/kg, so 50 mg/kg is shown ahead of 0.2 g/kg.
Fixed: Knowledge Base: nitrobenzene, the nitroanilines and other neutral nitro compounds now get a skin permeability estimate.
Fixed: Knowledge Base: "Ca" on calcium (the Electronegativity table's symbols, Ca²⁺) no longer shows NIOSH's carcinogen note. "(Ca)" after an IDLH still does.
Fixed: Knowledge Base: Hammett Constants files styryl, (E)-prop-1-enyl, phenylazo and the other groups written with a double bond's geometry under the atom they're attached through, not Other.
Fixed: Knowledge Base: in Hard and Soft Acids and Bases, the negative electron affinities sort before the positive ones, and Copy Table pastes them into Excel as numbers.
Fixed: Library: syncing with Zotero keeps a reference's own collections, PubMed ID and abstract when Zotero has the same paper. A tag taken off in Zotero is taken off here too, and tags you added here stay.
Fixed: Library: changes you make while Sync with Zotero is still reading your Zotero library are no longer undone when it finishes. An item Zotero lists twice no longer makes two references, and a collection deleted in Zotero no longer comes back.
Fixed: Library: pasting a citation into the PubMed ID box adds only the marked PMID, not the year, volume and pages. A group author such as "ATLAS Collaboration CERN" stays as written, and a Zotero group's web address with the group's name in it is accepted.
Fixed: Library: an item without an id in the library file no longer appears twice after a save. Changes made to the library on another computer show in the open Library windows. A save that failed is tried again, including when the app closes.
Fixed: Find Structure in Files: a second search of a large folder no longer reads thousands of files again, and "contains" searches check the indexed structures in one go.
Fixed: NMR: a terminal vinyl CH (styrene, 1-hexene) is predicted as dd, not tt.
Fixed: NMR: Check Data stops reading a peak list at the next nucleus's list (19F, 31P) or at HRMS, IR, mp, [α]D or Rf, so those numbers are no longer taken for peaks. A solvent written (CD₃)₂SO or (CD₃)₂CO in the header is recognized.
Fixed: NMR: after a background prediction or simulation fails once, the next one runs in the background again instead of on the main thread.
Fixed: Import From Picture and Make Editable: Ts, Ac, Pr, Ar and Y written as groups stay groups, instead of becoming tennessine, actinium, praseodymium, argon or yttrium atoms. Iodine labels written as a bare I are found.
Fixed: Import From Picture: a reader that stops partway now says so, instead of waiting for ever. An AI model's answer in words gives its SMILES, not its first word, and a SMILES with a stereo backslash is read.
Fixed: Make Editable: caption words NaCI and AcCI become NaCl and AcCl, while CIP, CIS, compound labels such as S10, and formulas such as C10H21 are left as written.
Under the hood: the 3-D coupling constants leave out bonds next to a three- or four-membered ring, as their documentation says. The two protons of a CH2 with a predicted shift gap now share the mean coupling.
