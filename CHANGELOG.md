# Changelog

<!-- Made by scripts/changelog.mjs from changes/ each time a version is published. Edit the files in changes/, not this one. -->

Every version of Chemweave, newest first: 159 versions and 489 pull requests so far. Each version's installers are on the [Releases](https://github.com/nathanohare/Chemweave/releases) page, and the app shows what's new in **Help ▸ What's New**. Found a problem? **Help ▸ Send Feedback**, or [open an issue](https://github.com/nathanohare/Chemweave/issues); the fix's entry here names the issue it fixes.

## Milestones

<!-- Major moments, newest first; shown at the top of CHANGELOG.md. Add one when something big lands. -->

- **2026-11-24**: Molecular orbital diagrams, d-orbital splitting and inorganic tables on the page ([#721](https://github.com/nathanohare/Chemweave/pull/721)).
- **2026-11-22**: Make Editable turns a pasted picture of a structure or scheme into an editable drawing ([#664](https://github.com/nathanohare/Chemweave/pull/664)).
- **2026-11-20**: SI Projects: supporting information written and compiled inside Chemweave ([#632](https://github.com/nathanohare/Chemweave/pull/632)).
- **2026-11-18**: Smart Schemes with branching routes and catalytic cycles ([#644](https://github.com/nathanohare/Chemweave/pull/644)).
- **2026-11-08**: Chem Illustrator becomes **Chemweave** ([#604](https://github.com/nathanohare/Chemweave/pull/604)).
- **2026-11-05**: NMR prediction: shifts, couplings, spectra and Check Data ([#532](https://github.com/nathanohare/Chemweave/pull/532)).
- **2026-11-03**: Lossless copy and paste with ChemDraw, and a full CDXML audit ([#499](https://github.com/nathanohare/Chemweave/pull/499)).
- **2026-11-01**: Knowledge Base window, then the Ligand Library a day later ([#306](https://github.com/nathanohare/Chemweave/pull/306), [#328](https://github.com/nathanohare/Chemweave/pull/328)).
- **2026-10-30**: Structure to Name (offline IUPAC names), chemical properties and the 3-D model window ([#284](https://github.com/nathanohare/Chemweave/pull/284), [#280](https://github.com/nathanohare/Chemweave/pull/280)).
- **2026-10-24**: Signed Windows and Mac apps, pen and touch drawing, and the first iPad build ([#173](https://github.com/nathanohare/Chemweave/pull/173), [#174](https://github.com/nathanohare/Chemweave/pull/174), [#170](https://github.com/nathanohare/Chemweave/pull/170)).
- **2026-10-23**: A web version that runs in the browser ([#150](https://github.com/nathanohare/Chemweave/pull/150)).
- **2026-10-22**: Office-style Document, Presentation and Spreadsheet modes finished in five waves ([#83](https://github.com/nathanohare/Chemweave/pull/83) to [#126](https://github.com/nathanohare/Chemweave/pull/126)).
- **2026-10-14**: The first published release, 0.1.72, with installers for Windows, macOS and Linux.
- **2026-10-12**: The first line of code: a speed prototype, the desktop app, and saving CDXML files ([#1](https://github.com/nathanohare/Chemweave/pull/1), [#2](https://github.com/nathanohare/Chemweave/pull/2)).

## Unreleased

### Added

- A changelog for every version, from the first line of code to today, linked from the top of the README.
- Canvas: d-Orbital Splitting diagrams and inorganic reference tables. ([#721](https://github.com/nathanohare/Chemweave/pull/721))

### Changed

- Help ▸ What's New lists every change in each version under Added, Changed, Fixed and Removed, and names the issue each fix closes.
- SI Project: projects open and save as one .chemsi file, with AutoSave, crash recovery and File ▸ Convert SI Project Folder. ([#717](https://github.com/nathanohare/Chemweave/pull/717))
- Canvas: the Orbital window's Pointing box is now a plain Rotation box, and both phase colors can be picked. ([#719](https://github.com/nathanohare/Chemweave/pull/719))
- Canvas: MO diagrams are placed and edited on the page, with ready-made molecules and electron counts. ([#721](https://github.com/nathanohare/Chemweave/pull/721))
- Interface: clicking outside a window closes it, asking first if something changed. ([#733](https://github.com/nathanohare/Chemweave/pull/733))

### Fixed

- Interface: drop-down lists and right-click menus show over windows instead of under them. ([#718](https://github.com/nathanohare/Chemweave/pull/718))
- Desktop app: the title bar stays usable and windows stay on the screen while a window is open. ([#732](https://github.com/nathanohare/Chemweave/pull/732))

### Under the hood

- Every pull request now adds a short change file, which becomes the release notes, What's New and CHANGELOG.md.
- Checks that pop-ups show over windows. ([#720](https://github.com/nathanohare/Chemweave/pull/720))
- Word, PowerPoint and Excel sampler files with an ECMA-376 schema check. ([#722](https://github.com/nathanohare/Chemweave/pull/722))
- Tests are type-checked for duplicate, missing or misspelled names. ([#723](https://github.com/nathanohare/Chemweave/pull/723))

<!-- The changelog from before change files: written in November 2026 from every merged pull request (each pull request under the first version that held it). Edit freely; scripts/changelog.mjs adds this below the newer versions in CHANGELOG.md. -->

## 0.1.256 (2026-11-24)

### Added

- Files: ChemDraw TLC plates and spectra in CDXML files are now shown. ([#713](https://github.com/nathanohare/Chemweave/pull/713))

### Fixed

- Files: CDXML tables keep dashed and bold borders, saving the same file twice gives the same file, and CDX files keep 48 more properties. ([#714](https://github.com/nathanohare/Chemweave/pull/714))
- Files: spectra with more than about 125,000 points and very large drawings no longer fail to read or save. ([#715](https://github.com/nathanohare/Chemweave/pull/715))

### Under the hood

- A CDXML sampler file covering every object and property. ([#713](https://github.com/nathanohare/Chemweave/pull/713))

## 0.1.255 (2026-11-24)

### Added

- Canvas: Show Reaction Roles shows every step's roles, with quick fixes by click, right-click or Link Steps in Order. ([#706](https://github.com/nathanohare/Chemweave/pull/706))

### Fixed

- Canvas: a Results line stays clear of its arrow when there is no text below, with a settable minimum gap. ([#704](https://github.com/nathanohare/Chemweave/pull/704))
- Canvas: each reaction arrow is read as its own step, so redrawn ChemDraw schemes get correct roles. ([#706](https://github.com/nathanohare/Chemweave/pull/706))

### Under the hood

- Windows signing retries when the signing service refuses a request. ([#705](https://github.com/nathanohare/Chemweave/pull/705))
- Build workflows are tried on their pull requests, workflows are linted and outside-service calls are retried. ([#708](https://github.com/nathanohare/Chemweave/pull/708))
- Tighter speed checks, a redraw timing check for big drawings, and desktop builds signed only on main. ([#709](https://github.com/nathanohare/Chemweave/pull/709))
- A spreadsheet test checks relationship lines as plain text. ([#710](https://github.com/nathanohare/Chemweave/pull/710))
- The developer guide says to run CodeQL on a fix's branch before merging. ([#711](https://github.com/nathanohare/Chemweave/pull/711))

## 0.1.244 (2026-11-24)

### Added

- SI Project: Synchronous Scrolling in the Live Preview makes the SI page follow as you scroll. ([#701](https://github.com/nathanohare/Chemweave/pull/701))
- SI Project: Position and Wrap Text for compound structures and figures, with text wrapping beside structures by default. ([#702](https://github.com/nathanohare/Chemweave/pull/702))

### Fixed

- SI Project: the Live Preview no longer flickers when hovering between lines of a paragraph. ([#700](https://github.com/nathanohare/Chemweave/pull/700))

### Under the hood

- The web version deploys in its own build step. ([#699](https://github.com/nathanohare/Chemweave/pull/699))

## 0.1.243 (2026-11-23)

### Added

- SI Project: resting the mouse on a compound's ID in the text shows its name and structure. ([#696](https://github.com/nathanohare/Chemweave/pull/696))
- SI Project: the Live Preview shows the whole SI and can be typed into as in Word, with a Word snapshot and flags shown as comments. ([#697](https://github.com/nathanohare/Chemweave/pull/697))

### Fixed

- SI Project: pasting a drawing into section text makes a figure, Undo works in the structure window, and redrawn figures keep their own scale. ([#694](https://github.com/nathanohare/Chemweave/pull/694))

### Under the hood

- Cleared seven code scanning alerts in checks, the wiki build and Gaussian reading. ([#695](https://github.com/nathanohare/Chemweave/pull/695))

## 0.1.242 (2026-11-23)

### Added

- Canvas: Raise Charge Digits (Fe₃⁺ to Fe³⁺), a setting for wedges without a chiral flag, and copied reaction schemes as reaction SMILES. ([#693](https://github.com/nathanohare/Chemweave/pull/693))

### Fixed

- Files: bonded labels are written as drawn, and RXN files from other programs keep their layout. ([#693](https://github.com/nathanohare/Chemweave/pull/693))

## 0.1.241 (2026-11-23)

### Added

- Slides: a setting to scroll between slides, with slides scrolling only to their edges. ([#688](https://github.com/nathanohare/Chemweave/pull/688))
- SI Project: every project gets a Spectra section, exported PDF and Word files have working links, and salts can print their ion as [M−Br]⁺. ([#690](https://github.com/nathanohare/Chemweave/pull/690))
- Interface: Paste ▾ on every mode's Home tab, a Picture Format tab in Document, and rich text in the TLC Plate, Gel and Diagram windows. ([#691](https://github.com/nathanohare/Chemweave/pull/691))
- Spreadsheet: chart titles take bold and italic, Excel notes keep rich text, and undo works inside a cell being typed in. ([#691](https://github.com/nathanohare/Chemweave/pull/691))

### Changed

- SI Project: a resizable, foldable tree, live preview that follows every edit, full-width pages, dashboard columns, cover spacing, contents switches and compile progress. ([#689](https://github.com/nathanohare/Chemweave/pull/689))

### Fixed

- Document and Slides: clicks no longer make the view jump, slides switch without flicker and open fitted to the window. ([#688](https://github.com/nathanohare/Chemweave/pull/688))

## 0.1.240 (2026-11-22)

### Added

- Slides: canvas slides glide back to the previous keyframe in a slide show, and View ▸ Gridlines and snapping work on canvas slides. ([#659](https://github.com/nathanohare/Chemweave/pull/659))
- Spreadsheet: template cards show the real first sheet, template columns get number formats from their units, and SMILES are drawn as structures in cells. ([#660](https://github.com/nathanohare/Chemweave/pull/660))
- Document: Show/Hide ¶ (Ctrl+Shift+8) shows spaces, tabs and paragraph marks, and Insert ▸ Cover Page is a picture gallery. ([#663](https://github.com/nathanohare/Chemweave/pull/663))
- Document: Make Editable turns a pasted picture of a structure or scheme into an editable drawing, with a Compare window and a new Picture Format tab. ([#664](https://github.com/nathanohare/Chemweave/pull/664))
- Document: double-click a header or footer to edit it on the page, with a Header & Footer ribbon tab, and hide the white space between pages. ([#666](https://github.com/nathanohare/Chemweave/pull/666))
- Slides: Ctrl+Z and Ctrl+Y work inside Edit Layouts. ([#671](https://github.com/nathanohare/Chemweave/pull/671))
- Slides: View ▸ Slide Master opens a PowerPoint-style master view, layout items are locked on slides, and a References placeholder lists citations. ([#672](https://github.com/nathanohare/Chemweave/pull/672))
- Document: Convert to Figure replaces a picture Make Editable can't read with an empty figure beside the original, to draw the structure by hand. ([#678](https://github.com/nathanohare/Chemweave/pull/678))
- SI Project: add files to Store additional files and folders by Insert, drag or paste, and New Section makes X-ray structure sections. ([#681](https://github.com/nathanohare/Chemweave/pull/681))

### Changed

- Canvas: tilt handles show only while a Perspective tool is in use. ([#659](https://github.com/nathanohare/Chemweave/pull/659))
- Document: New Document cards show the template's first page as it prints. ([#660](https://github.com/nathanohare/Chemweave/pull/660))
- Slides: text boxes show PowerPoint's round handles and a move border, including when rotated, with no second box while typing. ([#662](https://github.com/nathanohare/Chemweave/pull/662))
- Interface: the ribbon runs the full width of the window in every mode. ([#663](https://github.com/nathanohare/Chemweave/pull/663))
- Interface: one Font group in every mode, greyed commands say why, menus grouped as in Office, and more readable Dark Gray text. ([#680](https://github.com/nathanohare/Chemweave/pull/680))
- Interface: every known wording and accessibility problem is fixed, including real subscripts in formulas such as CO₂Et and PPh₃. ([#684](https://github.com/nathanohare/Chemweave/pull/684))

### Fixed

- Document: Borders is a real split button, Line Spacing is its normal height, the Styles launcher opens the Styles pane and Margins pictures are drawn correctly. ([#661](https://github.com/nathanohare/Chemweave/pull/661))
- Help: the built-in User Guide finds the Libraries sections when searching. ([#667](https://github.com/nathanohare/Chemweave/pull/667))
- Slides: a text box's rotate stem no longer crosses its top handle. ([#668](https://github.com/nathanohare/Chemweave/pull/668))
- Document: resizing, inserting text boxes and notes, and page breaks each undo in one step, and undoing a delete keeps the drawing order. ([#671](https://github.com/nathanohare/Chemweave/pull/671))
- SI Project: correct automatic table and figure labels, pasting a drawing into section text, editing caption lines, shorter duplicate-ID warnings and NMR signal counts. ([#675](https://github.com/nathanohare/Chemweave/pull/675))
- Canvas: diagrams drawn from data keep bold, italic and color set on their labels when redrawn, and Format Painter, the Style panel and Action Settings handle every diagram kind. ([#676](https://github.com/nathanohare/Chemweave/pull/676))
- Canvas: the chemistry engine recovers from crashes, very large structures no longer hang it, and results stay with the drawing they started on. ([#677](https://github.com/nathanohare/Chemweave/pull/677))
- Files: Word, PowerPoint and Excel files keep embedded objects, styles, formatting and settings the app does not change, and copied formula text agrees everywhere. ([#679](https://github.com/nathanohare/Chemweave/pull/679))
- Files: MOL, SDF, RXN and other exchange files and the clipboard keep R-groups, abbreviations, charges, dative bonds, enhanced stereo and chiral flags. ([#682](https://github.com/nathanohare/Chemweave/pull/682))
- Files: settings ChemDraw has no place for, and links between a slide's parts, are kept through CDXML and PowerPoint, and remaining undo problems are fixed. ([#685](https://github.com/nathanohare/Chemweave/pull/685))
- Files: large Gaussian logs open as fast as before post-HF energies were added. ([#687](https://github.com/nathanohare/Chemweave/pull/687))

### Under the hood

- The GitHub wiki is built automatically from the user guide. ([#665](https://github.com/nathanohare/Chemweave/pull/665))
- The README's user guide links point to the wiki. ([#667](https://github.com/nathanohare/Chemweave/pull/667))
- The user guide's command names, Settings table and spelling are corrected. ([#669](https://github.com/nathanohare/Chemweave/pull/669))
- The user guide's Reactions and schemes sections have their own headings, and the wiki's A to Z list is fuller. ([#670](https://github.com/nathanohare/Chemweave/pull/670))
- The user guide covers the current window, missing Design, Presentation and Document features, shortcut tables and new pictures. ([#673](https://github.com/nathanohare/Chemweave/pull/673))
- The user guide gains an SI Project page and updated Windows install steps for the signed app. ([#674](https://github.com/nathanohare/Chemweave/pull/674))
- A UI style guide, a wording check, a pull request template and round-trip, undo, accessibility and speed checks. ([#683](https://github.com/nathanohare/Chemweave/pull/683))

## 0.1.239 (2026-11-21)

### Fixed

- Slides: layouts given title slide colors no longer draw a stray template bar across the slide. ([#658](https://github.com/nathanohare/Chemweave/pull/658))

## 0.1.238 (2026-11-21)

### Fixed

- Files: figures in Word documents no longer overlap the text around them, and raised or lowered text makes its line taller as in Word. ([#657](https://github.com/nathanohare/Chemweave/pull/657))

## 0.1.237 (2026-11-20)

### Changed

- Files: Word documents open with Word's line heights, line breaks, justified spacing and table row heights, so pages line up much more closely. ([#656](https://github.com/nathanohare/Chemweave/pull/656))

## 0.1.236 (2026-11-20)

### Under the hood

- Cleared four code scanning alerts in formula matching, SI reading and Word writing. ([#655](https://github.com/nathanohare/Chemweave/pull/655))

## 0.1.235 (2026-11-20)

### Changed

- Files: Word documents open with bold list numbers, kerning, hyphenation of chemical names, embedded fonts and header and footer placement as in Word. ([#654](https://github.com/nathanohare/Chemweave/pull/654))

## 0.1.234 (2026-11-20)

### Changed

- Files: Word documents use matching stand-ins for Calibri and Cambria, keep the file's own and embedded fonts, and keep the contents' look. ([#653](https://github.com/nathanohare/Chemweave/pull/653))

## 0.1.233 (2026-11-20)

### Changed

- Files: Word documents open closer to how Word shows them, including EMF+ pictures, grouped pictures, Word's own numbering, live contents and table cell margins. ([#652](https://github.com/nathanohare/Chemweave/pull/652))

## 0.1.232 (2026-11-20)

### Added

- SI Project: open and edit Chem SI Assistant projects in their own tab, with a tree of sections and compounds, compound pages, ID tables and field editors. ([#632](https://github.com/nathanohare/Chemweave/pull/632))

### Under the hood

- The iPad build uses the newest released Xcode. ([#651](https://github.com/nathanohare/Chemweave/pull/651))

## 0.1.230 (2026-11-20)

### Under the hood

- The feedback relay keeps error details in its log instead of sending them back. ([#650](https://github.com/nathanohare/Chemweave/pull/650))

## 0.1.229 (2026-11-19)

### Fixed

- Files: exported pictures measure Times New Roman and other fonts with their own widths, so caption text no longer spreads apart. ([#649](https://github.com/nathanohare/Chemweave/pull/649))

## 0.1.228 (2026-11-18)

### Fixed

- Canvas: a drawn counterion grouped with its ion counts as one salt in the Analysis panel. ([#647](https://github.com/nathanohare/Chemweave/pull/647))

## 0.1.227 (2026-11-18)

### Added

- Canvas: focal points mark the atom, bond or ring center that Align, Distribute, Arrange and Clean Up line structures up on. ([#636](https://github.com/nathanohare/Chemweave/pull/636))
- Canvas: the drawing style sets a default font, size, color, side and gap for ID labels and linked captions, and Link Text to Structure applies it. ([#637](https://github.com/nathanohare/Chemweave/pull/637))
- Canvas: 3-D Rotation opens a live-preview window, selected structures get tilt handles, and Perspective tools are on the Arrange tab and toolboxes. ([#639](https://github.com/nathanohare/Chemweave/pull/639))
- Canvas: reaction arrows get text alignment, a Results line, Reaction, Mechanism and Plain arrow types, smarter role detection and Smart Clean (Ctrl+Shift+K). ([#641](https://github.com/nathanohare/Chemweave/pull/641))
- Slides and Design: focal points with hover preview, Distribute options on the ribbon and focal-point Align commands. ([#643](https://github.com/nathanohare/Chemweave/pull/643))
- Canvas: Smart Schemes can branch (divergent and convergent routes) with a new Tree layout, and the species list is faster to type into. ([#644](https://github.com/nathanohare/Chemweave/pull/644))

### Changed

- Canvas: setting a linked caption to Center moves it back to the middle of its structure. ([#635](https://github.com/nathanohare/Chemweave/pull/635))
- Canvas: Smart Scheme and catalytic cycles are one tool with a gallery of layouts and ready-made cycles, cycles of any number of joined loops and off-cycle species. ([#638](https://github.com/nathanohare/Chemweave/pull/638))
- Canvas: Newman projections use textbook angles and labels that stay on their bonds, with a wedged sawhorse drawing and a new Newman window and energy chart layout. ([#640](https://github.com/nathanohare/Chemweave/pull/640))
- Interface: the side panel has one header row with section tabs that can be stacked, folded and reordered. ([#642](https://github.com/nathanohare/Chemweave/pull/642))

### Removed

- Canvas: the separate Catalytic Cycle command and its table window are removed. ([#638](https://github.com/nathanohare/Chemweave/pull/638))

## 0.1.226 (2026-11-17)

### Changed

- Interface: one status bar layout in every mode, dialogs that keep their buttons in view, tidier Settings, ribbons and right-click menus. ([#633](https://github.com/nathanohare/Chemweave/pull/633))
- Canvas: a compact two-column Drawing Tools toolbox with fly-outs for bond variants, and a floating side panel. ([#633](https://github.com/nathanohare/Chemweave/pull/633))

## 0.1.225 (2026-11-16)

### Changed

- Desktop app: a new app icon, an interlaced hexagon on a deep teal tile. ([#634](https://github.com/nathanohare/Chemweave/pull/634))

## 0.1.224 (2026-11-16)

### Changed

- Interface: about 1,000 tooltips, messages, labels and user guide texts are reworded to be clearer, shorter and consistent, with one menu path style. ([#631](https://github.com/nathanohare/Chemweave/pull/631))

## 0.1.223 (2026-11-16)

### Changed

- Knowledge Base: the pKa table shows the acidic H in red on its own bond, and table columns can be moved and resized. ([#630](https://github.com/nathanohare/Chemweave/pull/630))

## 0.1.222 (2026-11-16)

### Added

- Knowledge Base: a Key pKa Values table of 121 compounds in water and DMSO, each with its acidic H drawn and a cited source. ([#629](https://github.com/nathanohare/Chemweave/pull/629))
- Knowledge Base: tables can group rows under foldable headings with Collapse All and Expand All. ([#629](https://github.com/nathanohare/Chemweave/pull/629))

## 0.1.221 (2026-11-16)

### Fixed

- Canvas: numbered R groups, MTPA and ChemDraw's 1.5 bonds no longer give false valence warnings, and warning tooltips are shorter. ([#626](https://github.com/nathanohare/Chemweave/pull/626))

## 0.1.220 (2026-11-16)

### Added

- Slides: the status bar has PowerPoint-style view buttons (Normal, Slide Sorter, Reading View, Slide Show) and a zoom slider. ([#628](https://github.com/nathanohare/Chemweave/pull/628))

## 0.1.219 (2026-11-16)

### Fixed

- Knowledge Base: the structure card beside a compound name no longer stays stuck over the table. ([#625](https://github.com/nathanohare/Chemweave/pull/625))

## 0.1.218 (2026-11-16)

### Fixed

- Slides: the ribbon refits when the Keyframes group appears on a canvas slide, so groups no longer run off the window's edge. ([#627](https://github.com/nathanohare/Chemweave/pull/627))

## 0.1.217 (2026-11-16)

### Fixed

- Canvas: the Select tool's hints beside the pointer are hidden while panning. ([#624](https://github.com/nathanohare/Chemweave/pull/624))

## 0.1.216 (2026-11-08)

### Changed

- Help: links, update checks and feedback point to the renamed Chemweave repository and web address. ([#606](https://github.com/nathanohare/Chemweave/pull/606))

### Fixed

- Files: very large structures and pictures saved in PowerPoint are no longer cut short, and slide text line spacing, theme colors and picture placeholders match PowerPoint. ([#615](https://github.com/nathanohare/Chemweave/pull/615))
- Files: Excel workbooks keep their row heights, Power Query refresh and charts after a save, and the notice about values in cells counts only pictures. ([#616](https://github.com/nathanohare/Chemweave/pull/616))
- Files: Word documents keep list start numbers, fields in headers and footers, comments, the Table Grid style and glow effects when saved. ([#617](https://github.com/nathanohare/Chemweave/pull/617))

## 0.1.215 (2026-11-08)

### Fixed

- Files: ChemDraw objects in PowerPoint carry their own picture, so they open at the right size instead of as an empty frame. ([#622](https://github.com/nathanohare/Chemweave/pull/622))

## 0.1.214 (2026-11-08)

### Fixed

- Files: replies to comments in a Word document show as threaded replies in Word 365. ([#621](https://github.com/nathanohare/Chemweave/pull/621))

## 0.1.213 (2026-11-08)

### Fixed

- Files: ChemDraw objects saved in PowerPoint and Word open in the ChemDraw installed on the computer. ([#620](https://github.com/nathanohare/Chemweave/pull/620))
- Canvas: energy diagrams get more room, ion charges and neater bonds to labels, and Save, Open and Print shortcuts work while typing speaker notes. ([#620](https://github.com/nathanohare/Chemweave/pull/620))

## 0.1.212 (2026-11-08)

### Fixed

- Files: rows that Excel sized to fit keep their height when the workbook is saved here and opened in Excel again. ([#619](https://github.com/nathanohare/Chemweave/pull/619))

## 0.1.211 (2026-11-08)

### Fixed

- Files: re-saving a CDXML file from an older version gives atoms and bonds their drawing order, so ChemDraw no longer draws them at the very back. ([#609](https://github.com/nathanohare/Chemweave/pull/609))

## 0.1.210 (2026-11-08)

### Fixed

- Files: brings the PowerPoint, Excel and Word saving fixes for long tags, line spacing, row heights, list numbering and header fields to the main release. ([#618](https://github.com/nathanohare/Chemweave/pull/618))

## 0.1.209 (2026-11-08)

### Fixed

- Canvas: fixes to energy diagrams, ring SMILES in sheet cells, copying a diagram picked by its frame, cut-off turned axis titles in pictures and printing to a file printer. ([#614](https://github.com/nathanohare/Chemweave/pull/614))

## 0.1.208 (2026-11-08)

### Added

- Slides: speaker notes take bold, italic, underline, strikethrough and bullets, saved to PowerPoint and shown in Presenter View. ([#613](https://github.com/nathanohare/Chemweave/pull/613))

## 0.1.207 (2026-11-08)

### Fixed

- Files: a PowerPoint box or oval with text typed in it comes in and saves back as one shape, and Wingdings bullets are saved in Wingdings. ([#612](https://github.com/nathanohare/Chemweave/pull/612))

## 0.1.206 (2026-11-08)

### Fixed

- Settings: Save structures as ChemDraw objects for PowerPoint takes effect without restarting the app. ([#611](https://github.com/nathanohare/Chemweave/pull/611))

## 0.1.205 (2026-11-08)

### Fixed

- Files: a comment on text in a Word table cell is saved once, so Word opens the file without an unreadable-content error. ([#610](https://github.com/nathanohare/Chemweave/pull/610))

## 0.1.204 (2026-11-08)

### Added

- Help: Help ▸ Send Feedback can send a report without a GitHub account, with a choice of public or private and an optional reply email and picture. ([#608](https://github.com/nathanohare/Chemweave/pull/608))

## 0.1.203 (2026-11-08)

### Under the hood

- Cleared a code scanning alert in the analysis label. ([#607](https://github.com/nathanohare/Chemweave/pull/607))

## 0.1.202 (2026-11-08)

### Under the hood

- Cleared two code scanning alerts in icon switching and the analysis label. ([#605](https://github.com/nathanohare/Chemweave/pull/605))

## 0.1.199 (2026-11-06)

### Under the hood

- Cleared three code scanning alerts in tests and file reading. ([#580](https://github.com/nathanohare/Chemweave/pull/580))

## 0.1.198 (2026-11-05)

### Fixed

- Canvas: a label tied to a structure, such as a compound number, stays with its own structure when the file is opened again. ([#575](https://github.com/nathanohare/Chemweave/pull/575))

## 0.1.197 (2026-11-05)

### Changed

- Interface: Dark Gray shows the selected ribbon tab, title bar and status bar with readable contrast, and narrow windows fold the ribbon and file tabs more cleanly. ([#557](https://github.com/nathanohare/Chemweave/pull/557))

### Fixed

- Spreadsheet: the Page Layout tab has its Page Setup group again (Margins, Orientation, Size, Print Area, Print Titles). ([#557](https://github.com/nathanohare/Chemweave/pull/557))

## 0.1.196 (2026-11-05)

### Changed

- Interface: tooltips, info tips and messages are rewritten to be clearer and more standard. ([#555](https://github.com/nathanohare/Chemweave/pull/555))

## 0.1.194 (2026-11-05)

### Removed

- NMR: NMR prediction, spectra, Check Data and NMR data files are taken out of the app while the predictor is re-evaluated. ([#548](https://github.com/nathanohare/Chemweave/pull/548))

## 0.1.193 (2026-11-05)

### Fixed

- NMR: Check Data no longer fails in the Spectrum window when the predicted rows change after a check. ([#547](https://github.com/nathanohare/Chemweave/pull/547))

## 0.1.189 (2026-11-04)

### Fixed

- Canvas: dragging from the cursor in a text box selects text, so Bold, Italic, Font, Size and Color can be applied to it. ([#523](https://github.com/nathanohare/Chemweave/pull/523))

## 0.1.188 (2026-11-04)

### Fixed

- Canvas: the H of a stacked NH label moves to the open side when a structure is rotated or flipped, instead of sitting on its bonds. ([#522](https://github.com/nathanohare/Chemweave/pull/522))

## 0.1.185 (2026-11-03)

### Fixed

- Canvas: the Cloud shape is drawn with rounded bumps instead of a spiky starburst. ([#473](https://github.com/nathanohare/Chemweave/pull/473))
- Files: compound numbers linked to a structure stay as text when a canvas slide is saved to PowerPoint, keeping their link. ([#473](https://github.com/nathanohare/Chemweave/pull/473))

## 0.1.184 (2026-11-03)

### Fixed

- Files: CDXML files list objects in their drawing order, so ChemDraw shows a structure brought to the front in front of the shapes behind it. ([#461](https://github.com/nathanohare/Chemweave/pull/461))

## 0.1.182 (2026-11-02)

### Fixed

- Canvas: a B(OH)₂ label joined on the right reads (HO)₂B, as do similar groups like (EtO)₃Si. ([#433](https://github.com/nathanohare/Chemweave/pull/433))

## 0.1.181 (2026-11-02)

### Added

- Slides: Auto-Animate Steps can follow the camera on a copy of a canvas slide that has its own keyframes. ([#419](https://github.com/nathanohare/Chemweave/pull/419))
- Document: the Make Figures offer has Don't Ask for This File and a Preferences setting. ([#421](https://github.com/nathanohare/Chemweave/pull/421))

### Changed

- Canvas: Bring to Front and Send to Back work on every object as in PowerPoint, and the order is saved in CDXML. ([#410](https://github.com/nathanohare/Chemweave/pull/410))
- Interface: the app starts faster by drawing the shapes library and loading some windows only when first needed. ([#417](https://github.com/nathanohare/Chemweave/pull/417))
- Canvas: Clean Up leaves tidy structures alone, \ switches a six-membered ring between flat and chair, and the atom menu is shorter. ([#418](https://github.com/nathanohare/Chemweave/pull/418))
- Canvas: the map number box look is saved with each drawing. ([#420](https://github.com/nathanohare/Chemweave/pull/420))
- Assistant: in a browser the request log lasts only until the tab closes, and sending the whole document is off by default. ([#426](https://github.com/nathanohare/Chemweave/pull/426))
- Interface: new installs start in the Dark Gray theme, and Office ribbons name each group under it again while the Canvas ribbon shows none. ([#430](https://github.com/nathanohare/Chemweave/pull/430))

### Fixed

- Slides: Smart Schemes survive PowerPoint round trips, cycle arcs stay curved, and Turn in 3-D views stay in order. ([#411](https://github.com/nathanohare/Chemweave/pull/411))
- Files: V3000 SD files open, map numbers and animation pieces are kept when saving, Chem4Word CML reads the right way up and CIF crystals grow faster. ([#412](https://github.com/nathanohare/Chemweave/pull/412))
- Knowledge Base typing is much faster, the Assistant replaces the right structure, and 3-D Model searches can be stopped cleanly. ([#413](https://github.com/nathanohare/Chemweave/pull/413))
- Canvas: chiral ligands draw as their named enantiomers, Map Atoms maps every product of a step that splits up, and formulas like Me₂CO read correctly. ([#414](https://github.com/nathanohare/Chemweave/pull/414))
- Document and Spreadsheet: Esc no longer throws away a structure being drawn in the structure editor. ([#415](https://github.com/nathanohare/Chemweave/pull/415))
- Canvas: big drawings and Clean Up are much faster, products stay on their arrows, and Copy As on a right-clicked atom copies its whole structure. ([#416](https://github.com/nathanohare/Chemweave/pull/416))
- Canvas: Check Balance names missing HCl, HBr, HF and SO₂, and Newman projections label a benzoate OBz. ([#422](https://github.com/nathanohare/Chemweave/pull/422))
- Document and Spreadsheet: Hammett columns stay responsive, figures grow on save, Format Favorites apply to shapes and pictures, and print area fixes. ([#423](https://github.com/nathanohare/Chemweave/pull/423))
- Files: Find in Files searches MOL, SDF, RXN, MRV, KET and CML files, unreadable labels are kept as aliases, and Zotero leaves no empty citation. ([#424](https://github.com/nathanohare/Chemweave/pull/424))
- Canvas: Repeat Label goes on just the atom clicked, Space no longer sticks as the free-angle key, and Align is faster on big drawings. ([#425](https://github.com/nathanohare/Chemweave/pull/425))
- Interface: Strong shadows are deeper than Light in the system dark theme. ([#426](https://github.com/nathanohare/Chemweave/pull/426))
- Slides: Auto-Animate Steps is one undo step, long Gaussian logs and Turn in 3-D run faster, and the Smart Scheme pane stays live. ([#428](https://github.com/nathanohare/Chemweave/pull/428))

### Removed

- Spreadsheet: atom economy is removed from the Stoichiometry Table. ([#420](https://github.com/nathanohare/Chemweave/pull/420))
- Settings: the option for where ribbon group names go is removed. ([#430](https://github.com/nathanohare/Chemweave/pull/430))

## 0.1.180 (2026-11-02)

### Fixed

- Canvas: Align and Distribute treat a group as one object, and a typed ring NH puts its H below the N. ([#409](https://github.com/nathanohare/Chemweave/pull/409))

## 0.1.179 (2026-11-02)

### Changed

- Knowledge Base: each table's description moves behind an "i" and the filters sit in the title row. ([#396](https://github.com/nathanohare/Chemweave/pull/396))

### Fixed

- Canvas: saving a big drawing as a molfile is quick again, which also fixes the Windows desktop build. ([#398](https://github.com/nathanohare/Chemweave/pull/398))
- Canvas: Smart Scheme cycles keep their place on the page when laid out again. ([#403](https://github.com/nathanohare/Chemweave/pull/403))

### Under the hood

- Code scanning runs on pushes to main, weekly and by hand. ([#400](https://github.com/nathanohare/Chemweave/pull/400))
- Faster automatic checks, a cached signing tool and two tests fixed. ([#401](https://github.com/nathanohare/Chemweave/pull/401))

## 0.1.178 (2026-11-02)

### Added

- Canvas: Chemistry ▸ Mechanism Arrows ▸ Draw Next Intermediate reads curved arrows as moving electrons, checks them and draws the structure they make. ([#296](https://github.com/nathanohare/Chemweave/pull/296))
- References: My Library keeps one reference library for every file, with collections, tags, attached PDFs, Add by PubMed ID and read-only Zotero sync. ([#301](https://github.com/nathanohare/Chemweave/pull/301))
- Canvas: a Compound Library (Chemistry ▸ Compound Library) records your compounds and the files they are in, and Find Structure in Files searches your drawings. ([#301](https://github.com/nathanohare/Chemweave/pull/301))
- Canvas: Chemistry ▸ Reactions and Schemes ▸ Check Balance counts elements and charge on each side and names the likely missing by-product. ([#302](https://github.com/nathanohare/Chemweave/pull/302))
- Spreadsheet: the Stoichiometry Table adds yield, atom economy, E-factor and PMI, and charts fit first-order, second-order, Arrhenius, Eyring and Hammett data. ([#302](https://github.com/nathanohare/Chemweave/pull/302))
- Copy and paste: copy reactions as reaction SMILES or RXN, plus a lab calculator and batch file conversion. ([#302](https://github.com/nathanohare/Chemweave/pull/302))
- Canvas: Format ▸ Align ▸ Arrange in a Row, Arrange in a Column and Arrange in a Grid, and Clean Up evens out rows and schemes. ([#303](https://github.com/nathanohare/Chemweave/pull/303))
- Knowledge Base: Chemistry ▸ Look Up ▸ Knowledge Base opens a searchable window with NMR impurity shifts, a solvent table, abbreviation tooltips and your own tables. ([#306](https://github.com/nathanohare/Chemweave/pull/306))
- Canvas: Insert ▸ Lab Figures draws TLC plates with stains and Rf values, gels with ladder markers, orbitals and MO diagrams. ([#307](https://github.com/nathanohare/Chemweave/pull/307))
- Document: cite live with the Zotero desktop app: Add/Edit Citation, Add/Edit Bibliography, Refresh, Document Preferences and Unlink Citations. ([#308](https://github.com/nathanohare/Chemweave/pull/308))
- Canvas: Chemistry ▸ Reactions and Schemes ▸ Map Atoms maps atoms across reaction steps and shows bonds made and broken; map numbers are saved in CDXML and molfiles. ([#309](https://github.com/nathanohare/Chemweave/pull/309))
- Knowledge Base: Reagent Safety (hazard tiers from measured data, incompatibilities) and Physical Constants tables, with online lookups. ([#310](https://github.com/nathanohare/Chemweave/pull/310))
- Knowledge Base: add your own PDFs and search them page by page in the Knowledge Base window. ([#311](https://github.com/nathanohare/Chemweave/pull/311))
- Knowledge Base: Purify and Store table (how to purify, dry, store and check 40 common compounds) and a Techniques table. ([#312](https://github.com/nathanohare/Chemweave/pull/312))
- Canvas: Insert ▸ Lab Figures ▸ Crystal Structure (CIF) shows X-ray structures as ORTEP ellipsoids or ball-and-stick, with the crystal data table, and places them on the page. ([#313](https://github.com/nathanohare/Chemweave/pull/313))
- Knowledge Base: Solvents (with CHEM21 rankings and properties), pKa in Water, Solubility and skin permeability tables. ([#314](https://github.com/nathanohare/Chemweave/pull/314))
- Files: open and save MOL, SDF, RXN, Marvin, Ketcher, CML and ChemDoodle JSON files as drawings. ([#315](https://github.com/nathanohare/Chemweave/pull/315))
- Slides: Insert ▸ Zotero cites live on slides with a Zotero-made References slide, and Zotero note styles put citations in footnotes. ([#316](https://github.com/nathanohare/Chemweave/pull/316))
- Canvas: Smart Schemes keep a reaction scheme or catalytic cycle as one editable object, with a species pane, + buttons between steps and switchable layouts. ([#318](https://github.com/nathanohare/Chemweave/pull/318))
- Canvas: an angle readout and Shift, Alt and Ctrl hints appear beside the pointer while drawing, and new arrows can have their own line and head sizes. ([#319](https://github.com/nathanohare/Chemweave/pull/319))
- Settings: every page has Apply and Set as Default, with previews and a keyboard picture of the hotkeys. ([#319](https://github.com/nathanohare/Chemweave/pull/319))
- Canvas: look up a structure from a CAS RN (check digit verified), and see a structure's CAS RN in the Analysis panel. ([#320](https://github.com/nathanohare/Chemweave/pull/320))
- Canvas: the Energy Diagram window imports Gaussian and ORCA output files into a reaction pathway. ([#321](https://github.com/nathanohare/Chemweave/pull/321))
- Knowledge Base: Hammett Constants table for 124 substituents, ICH Q3C solvent classes, a Not rated safety tier and live PubChem ratings. ([#322](https://github.com/nathanohare/Chemweave/pull/322))
- 3-D Model: Search Conformers, xTB refining, Gaussian and ORCA input files, and Boltzmann populations for each conformer. ([#324](https://github.com/nathanohare/Chemweave/pull/324))
- Slides: during a slide show, pan and zoom around a canvas slide, press G for a grid of every slide and M for the canvas map. ([#325](https://github.com/nathanohare/Chemweave/pull/325))
- Canvas: a Ligand Library of 291 ligands in 17 families, each drawn on a metal, searchable and usable as a template or typed label. ([#328](https://github.com/nathanohare/Chemweave/pull/328))
- Slides: Animations ▸ Auto-Animate Steps builds a scheme up one arrow and species at a time in the slide show. ([#329](https://github.com/nathanohare/Chemweave/pull/329))
- Slides: Insert ▸ Action Button shows a gallery of buttons with an action drop-down, and can add a back, home and next set at once. ([#330](https://github.com/nathanohare/Chemweave/pull/330))
- Files: save V3000 molfiles, SD and RXN files, and the 3-D Model window shows conformers' relative energies. ([#333](https://github.com/nathanohare/Chemweave/pull/333))
- Canvas: View ▸ Toolboxes ▸ Text Formatting (formulas, italic stereodescriptors, chemists' symbols) and Guides (crosshairs and ruled guides that atoms snap to). ([#334](https://github.com/nathanohare/Chemweave/pull/334))
- Settings: drawing style presets grouped for journals, presentations, posters and theses, shown as cards with thumbnails. ([#335](https://github.com/nathanohare/Chemweave/pull/335))
- Canvas: Tab takes a selected cyclohexane through flat, chair, flipped chair and boat, and a chair can be walked round or flipped keeping its stereochemistry. ([#337](https://github.com/nathanohare/Chemweave/pull/337))
- Slides: the slide show has a right-click menu, L and buttons to look around a canvas slide, and offers a build for a selected scheme. ([#338](https://github.com/nathanohare/Chemweave/pull/338))
- Canvas: a ligand name on its own expands to its library drawing, and Expand Label Fully draws every group out. ([#339](https://github.com/nathanohare/Chemweave/pull/339))
- Canvas: Newman projections from a toolbox tool or a bond's right-click menu, linked to the structure, with a Settings page. ([#342](https://github.com/nathanohare/Chemweave/pull/342))
- Canvas: energy diagrams switch between ΔG, ΔH and ΔE, add brackets between any two species, line styles, 2-D structures and transition-state bond distances. ([#344](https://github.com/nathanohare/Chemweave/pull/344))
- Interface: resting the pointer on some tools shows a short demo of how to use them. ([#345](https://github.com/nathanohare/Chemweave/pull/345))
- Slides: Turn in 3-D emphasis effect turns a structure smoothly between key views set in a Key Views window. ([#346](https://github.com/nathanohare/Chemweave/pull/346))
- Canvas: the Newman Projection window has an Energy Chart tab that plots torsional energy for a bond from a relaxed scan. ([#347](https://github.com/nathanohare/Chemweave/pull/347))
- Interface: Right-click ▸ Save Format as Favorite keeps a whole look under a name, applied in one click from the Format Favorites gallery on the Home tab. ([#348](https://github.com/nathanohare/Chemweave/pull/348))
- Assistant: Settings ▸ AI Model gains Local only, shows what will be sent before a request, and keeps a request log. ([#351](https://github.com/nathanohare/Chemweave/pull/351))
- Knowledge Base: Green Solvents in NMR table of 47 green solvents, acids and bases as trace impurities in eight NMR solvents. ([#352](https://github.com/nathanohare/Chemweave/pull/352))
- Assistant: Edit ▸ Assistant (Ctrl+/) opens a prompt bar in every mode to ask your own AI model, off until you turn it on. ([#353](https://github.com/nathanohare/Chemweave/pull/353))
- Document: double-click a structure to edit it in place on the page, and Insert ▸ Figure makes an area for structures that text wraps around. ([#356](https://github.com/nathanohare/Chemweave/pull/356))
- Settings: Preferences can show alkyl prefixes in italics and with a dash (tBu, t-Bu, iPr) without changing the label's text. ([#357](https://github.com/nathanohare/Chemweave/pull/357))
- Settings: a new Preferences page, with an option for Enter to finish typing a text box and Alt+Enter for a new line. ([#358](https://github.com/nathanohare/Chemweave/pull/358))
- Settings: Drawing Style has a Reaction arrows section with a live preview laid out by Clean Up Reaction. ([#363](https://github.com/nathanohare/Chemweave/pull/363))
- Canvas: the Energy Diagram window has a Structure column for drawing each species, and Smart Scheme panes gain formatting and structure boxes. ([#366](https://github.com/nathanohare/Chemweave/pull/366))
- Document: new structures can be drawn in place on the page too. ([#371](https://github.com/nathanohare/Chemweave/pull/371))
- Spreadsheet: the Home tab has the Format Favorites gallery for cells and shapes. ([#373](https://github.com/nathanohare/Chemweave/pull/373))
- Spreadsheet: Hammett σ, F and R columns filled in from an attachment point, set with Right-click ▸ Attachment Point. ([#374](https://github.com/nathanohare/Chemweave/pull/374))
- Canvas: guides can have their own color and transparency. ([#378](https://github.com/nathanohare/Chemweave/pull/378))
- Canvas: Chemistry ▸ Reactions and Schemes ▸ Map Number Format sets your own box look; map numbers use gray outlined boxes by default. ([#380](https://github.com/nathanohare/Chemweave/pull/380))
- Canvas: a compact ribbon with Arrow, Ring and Bond tabs, Analysis and Warnings boxes, context toolboxes, warning marks and a zooming page edge. ([#381](https://github.com/nathanohare/Chemweave/pull/381))
- Slides: Insert ▸ Action Button offers four looks, and Smart Scheme cycles can add a second loop. ([#382](https://github.com/nathanohare/Chemweave/pull/382))
- Canvas: Energy diagrams have a Geometry View for each species' 3-D geometry, with styles, viewing angle and hidden or faded parts. ([#384](https://github.com/nathanohare/Chemweave/pull/384))
- Interface: soft shadows under the menus and toolboxes, with a Shadows setting to make them stronger or turn them off. ([#386](https://github.com/nathanohare/Chemweave/pull/386))

### Changed

- Canvas: Clean Up Reaction puts following steps on one line, makes arrows pointing the same way equally long and keeps a scheme's wrapped rows. ([#300](https://github.com/nathanohare/Chemweave/pull/300))
- Canvas: Alt or Space pressed mid-drag frees a bond's or arrow's angle, and Tab skips templates that would make the same molecule. ([#317](https://github.com/nathanohare/Chemweave/pull/317))
- Document and Spreadsheet: one Insert Structure button replaces the idle drawing tools; a docked side panel along the top or bottom is a short strip. ([#317](https://github.com/nathanohare/Chemweave/pull/317))
- Interface: View ▸ Navigator is now Document Map and Dark Page is Reading Mode; tooltips show keys and the status bar guides each step. ([#323](https://github.com/nathanohare/Chemweave/pull/323))
- Spreadsheet: print settings move from the Page Layout tab to File ▸ Print, and a single selected atom no longer shows a rotate handle. ([#331](https://github.com/nathanohare/Chemweave/pull/331))
- Interface: Office-mode ribbons get a new icon set, a Picture Format tab, an inline chart gallery, editable buttons and groups that shrink to fit. ([#340](https://github.com/nathanohare/Chemweave/pull/340))
- Knowledge Base: Reagent Safety grows to about 5,500 compounds, each with hazard data from an open source. ([#341](https://github.com/nathanohare/Chemweave/pull/341))
- 3-D Model: choose Quick, Full Search or xTB Refine, see conformers in a ranked list and a cleaner ball-and-stick view. ([#343](https://github.com/nathanohare/Chemweave/pull/343))
- Canvas: text set to Chemical reads lone groups and atoms (OH, CH₃, NO₂) and more simple formulas as chemistry. ([#349](https://github.com/nathanohare/Chemweave/pull/349))
- Interface: tool demos are off by default and can be turned on in Settings ▸ General. ([#350](https://github.com/nathanohare/Chemweave/pull/350))
- Canvas: Ligand Library drawings write groups short (NMe₂, OMe, Ph, t-Bu), put ring double bonds inside and draw arcs on η³ and η⁴ ligands. ([#354](https://github.com/nathanohare/Chemweave/pull/354))
- Interface: commands use standard Office and chemistry names (Align Center, Flip Horizontal, Keyboard Shortcuts) and American spelling; search still finds old names. ([#355](https://github.com/nathanohare/Chemweave/pull/355))
- Settings: finishing typing with Esc or Enter is now a pick list and applies to text from the Text tool in every mode. ([#359](https://github.com/nathanohare/Chemweave/pull/359))
- Canvas: Newman projection labels stay on their bonds, chart insets sit at ideal angles, and energy barriers can be dragged. ([#360](https://github.com/nathanohare/Chemweave/pull/360))
- Canvas: Ligand Library drawings follow hand-drawn layouts, write ethyl as Et and draw each chiral ligand as its named enantiomer. ([#362](https://github.com/nathanohare/Chemweave/pull/362))
- Canvas: Map Atoms draws map numbers in small rounded boxes beside the atoms, with a choice of fill. ([#364](https://github.com/nathanohare/Chemweave/pull/364))
- Canvas: Arrange in a Grid opens a window with a live preview, structures sharing a ring line up on it, and Clean Up Reaction again fits each arrow to its text. ([#372](https://github.com/nathanohare/Chemweave/pull/372))
- Canvas: Draw Next Intermediate keeps the starting layout, lines up the reaction center and draws tidier arrows, with a setting. ([#376](https://github.com/nathanohare/Chemweave/pull/376))
- Canvas: the Smart Scheme species list docks like a toolbox and is more compact; Auto-Animate Steps shows a preview. ([#377](https://github.com/nathanohare/Chemweave/pull/377))
- Canvas: the Text Formatting toolbox matches the bar shown while typing. ([#378](https://github.com/nathanohare/Chemweave/pull/378))
- Canvas: Smart Scheme and Energy Diagram windows are clearer, with step text marks and help behind an info icon. ([#385](https://github.com/nathanohare/Chemweave/pull/385))
- Interface: View ▸ Density offers Compact, Cozy (the new default) and Normal toolbox spacing, changing only the gap between buttons. ([#387](https://github.com/nathanohare/Chemweave/pull/387))
- Canvas: the Guides toolbox takes units in its boxes and has a snapping checkbox; the Drawing Style preview is wider. ([#388](https://github.com/nathanohare/Chemweave/pull/388))
- Interface: the dark theme's mode accent colors are muted so they no longer glow against the grays. ([#389](https://github.com/nathanohare/Chemweave/pull/389))
- Interface: help text in windows moves behind "i" tips, and dialogs are tighter. ([#390](https://github.com/nathanohare/Chemweave/pull/390))
- Canvas: Map Number Format has a shorter preview and standard names. ([#394](https://github.com/nathanohare/Chemweave/pull/394))

### Fixed

- Files: saving Word, PowerPoint and Excel files keeps data other programs put in them, and Chem4Word structures open as editable drawings. ([#304](https://github.com/nathanohare/Chemweave/pull/304))
- Interface: words on accent-colored buttons are readable in every mode and theme, and the Shapes and Icons menu uses the current mode's color. ([#317](https://github.com/nathanohare/Chemweave/pull/317))
- Canvas: Animate Reaction no longer twists a symmetric structure over (propane to acetone). ([#331](https://github.com/nathanohare/Chemweave/pull/331))
- Canvas: Bring to Front and Send to Back work on bonds, and a selected bond no longer shows a dashed box inside it. ([#336](https://github.com/nathanohare/Chemweave/pull/336))
- Document and Spreadsheet: the structure editor no longer shows the last structure edited when opened for another. ([#356](https://github.com/nathanohare/Chemweave/pull/356))
- Canvas: the Newman eye mark's cone now opens toward the bond, with settings for the ring arc and eye style. ([#365](https://github.com/nathanohare/Chemweave/pull/365))
- Knowledge Base: table fixes, including a picture of each group in Hammett Constants. ([#370](https://github.com/nathanohare/Chemweave/pull/370))
- Canvas: Check Figure for Journal fixes no longer leave a figure a hair over or under a limit. ([#375](https://github.com/nathanohare/Chemweave/pull/375))
- Interface: windows no longer open with an info tip already showing. ([#393](https://github.com/nathanohare/Chemweave/pull/393))

### Removed

- Interface: the tool demo clips on a long hover are taken out for now. ([#368](https://github.com/nathanohare/Chemweave/pull/368))
- Settings: the drawing style preset cards and their new presets are taken out for now. ([#369](https://github.com/nathanohare/Chemweave/pull/369))
- Knowledge Base: search of your own PDFs is taken out. ([#370](https://github.com/nathanohare/Chemweave/pull/370))

### Under the hood

- Scripts to build an NMR test set and score shift predictors. ([#361](https://github.com/nathanohare/Chemweave/pull/361))
- Ligand Library pictures are built safely, clearing two code-scanning alerts. ([#379](https://github.com/nathanohare/Chemweave/pull/379))
- NMR prediction scripts moved to their own branch until complete. ([#383](https://github.com/nathanohare/Chemweave/pull/383))
- The Windows desktop build passes its self-test again. ([#399](https://github.com/nathanohare/Chemweave/pull/399))

## 0.1.176 (2026-11-02)

### Fixed

- Canvas: right-clicking an atom or bond selects just that atom or bond, and color menus close without an error. ([#332](https://github.com/nathanohare/Chemweave/pull/332))

## 0.1.175 (2026-11-01)

### Changed

- Canvas: Clean Up Structure untangles cages and bridged ring systems pasted from SMILES into regular fused rings, with layout options. ([#298](https://github.com/nathanohare/Chemweave/pull/298))

## 0.1.174 (2026-11-01)

### Added

- Files: File ▸ Check Figure for Journal checks a drawing, design page or slide against ACS, RSC, Elsevier, Nature or Wiley guidelines and lists what to fix. ([#299](https://github.com/nathanohare/Chemweave/pull/299))

### Changed

- Slides: Rehearse Timings and Record are completed. ([#299](https://github.com/nathanohare/Chemweave/pull/299))

## 0.1.173 (2026-11-01)

### Added

- Canvas: Perspective and 3-D Perspective tools turn a structure as a flat sheet or in its real 3-D shape, keeping each stereocenter, with optional depth shading. ([#295](https://github.com/nathanohare/Chemweave/pull/295))

## 0.1.172 (2026-11-01)

### Added

- Canvas: Insert ▸ Structure from Sequence draws a peptide from one- or three-letter codes, alongside new Haworth sugar and nucleotide templates. ([#297](https://github.com/nathanohare/Chemweave/pull/297))

## 0.1.171 (2026-11-01)

### Added

- Canvas: the right-click menu offers to repeat the last typed atom label, for example Repeat “NHAc” Label. ([#294](https://github.com/nathanohare/Chemweave/pull/294))

## 0.1.170 (2026-11-01)

### Fixed

- Interface: rows in the right-click menu no longer stay highlighted after the mouse moves off them. ([#293](https://github.com/nathanohare/Chemweave/pull/293))

## 0.1.169 (2026-11-01)

### Under the hood

- The Windows signing step now actually signs the app. ([#292](https://github.com/nathanohare/Chemweave/pull/292))

## 0.1.166 (2026-11-01)

### Fixed

- Desktop app: the notice after an unexpected close stays until answered and shows even after a quick restart. ([#291](https://github.com/nathanohare/Chemweave/pull/291))

## 0.1.165 (2026-10-31)

### Added

- 3-D Model: a Best View button turns the model to its clearest view. ([#288](https://github.com/nathanohare/Chemweave/pull/288))

### Fixed

- 3-D Model: Place on Page turns the model slightly so atoms don't land on top of each other. ([#288](https://github.com/nathanohare/Chemweave/pull/288))

## 0.1.164 (2026-10-31)

### Changed

- Canvas: Fill Rings opens the Style panel, and the right-click menu has Show Style Panel. ([#290](https://github.com/nathanohare/Chemweave/pull/290))

## 0.1.163 (2026-10-30)

### Added

- Settings: Settings ▸ Drawing ▸ Ends of bond lines chooses Round, Half round, Slightly round (the new default) or Square. ([#287](https://github.com/nathanohare/Chemweave/pull/287))

### Fixed

- Canvas: exocyclic double bonds join the ring with no gap. ([#287](https://github.com/nathanohare/Chemweave/pull/287))

## 0.1.162 (2026-10-30)

### Fixed

- Canvas: the Structure from Name or SMILES window accepts SMILES and molfiles as well as names. ([#286](https://github.com/nathanohare/Chemweave/pull/286))

## 0.1.161 (2026-10-30)

### Changed

- Canvas: alkyne and allene carbons are drawn linear, and a bond made triple straightens its neighbors (a Settings ▸ General option turns this off). ([#285](https://github.com/nathanohare/Chemweave/pull/285))

## 0.1.160 (2026-10-30)

### Changed

- Interface: more room for work: file tabs move into the menu row, Documents and Spreadsheets show a narrow toolbox rail, and the side panel starts folded. ([#283](https://github.com/nathanohare/Chemweave/pull/283))
- Interface: one accent look for every mode, a teal Canvas, a dark area round the page in dark theme, sharper corners and a quick bar you can customize. ([#283](https://github.com/nathanohare/Chemweave/pull/283))

## 0.1.159 (2026-10-30)

### Added

- Canvas: Chemistry ▸ Look Up ▸ Structure to Name puts an offline IUPAC name under each selected structure, checked by reading it back. ([#284](https://github.com/nathanohare/Chemweave/pull/284))

## 0.1.158 (2026-10-30)

### Changed

- Canvas: after a hotkey edit, the highlight follows the mouse again as soon as it moves. ([#282](https://github.com/nathanohare/Chemweave/pull/282))

## 0.1.157 (2026-10-30)

### Under the hood

- The updater library is updated to clear security alerts. ([#281](https://github.com/nathanohare/Chemweave/pull/281))

## 0.1.156 (2026-10-30)

### Added

- Canvas: the Analysis panel estimates pKa, solubility, critical point, thermochemistry, vapor pressure and Henry's law constant. ([#280](https://github.com/nathanohare/Chemweave/pull/280))
- 3-D Model: a window shows the structure in 3-D to turn and view. ([#280](https://github.com/nathanohare/Chemweave/pull/280))

## 0.1.155 (2026-10-30)

### Added

- Document: one Reference Manager shows the references of every open file, and copies them between files. ([#279](https://github.com/nathanohare/Chemweave/pull/279))
- Slides: presentations keep their own references, and References on Slide puts chosen ones at the foot of a slide. ([#279](https://github.com/nathanohare/Chemweave/pull/279))

## 0.1.154 (2026-10-30)

### Changed

- Interface: the modes are renamed Canvas, Presentation, Spreadsheet and Document, and File ▸ New Drawing is now New Canvas. ([#278](https://github.com/nathanohare/Chemweave/pull/278))

## 0.1.153 (2026-10-30)

### Fixed

- Canvas: pages in use show white edge to edge with the page grid, instead of a box round the drawing. ([#277](https://github.com/nathanohare/Chemweave/pull/277))

## 0.1.152 (2026-10-29)

### Added

- Canvas: Page Edges on the right-click menu fixes or frees a page edge, and pasting past a fixed edge offers to add pages or wrap the structures. ([#276](https://github.com/nathanohare/Chemweave/pull/276))

### Changed

- Canvas: the drawing is shown as a grid of whole pages that grows and shrinks with the drawing, like ChemDraw. ([#276](https://github.com/nathanohare/Chemweave/pull/276))

## 0.1.151 (2026-10-29)

### Added

- Slides: canvas slides, endless slides shown through keyframes with camera moves, exported to PowerPoint and PDF as a slide per keyframe. ([#275](https://github.com/nathanohare/Chemweave/pull/275))
- Slides: show extras for canvas slides: spotlight, detours, a mini-map, compound-number jumps and a keyframe list in Presenter View. ([#275](https://github.com/nathanohare/Chemweave/pull/275))

## 0.1.150 (2026-10-29)

### Fixed

- Canvas: fused ring fills cast one shadow round their outer edge; a Shadow between fused rings checkbox brings back a shadow for each ring. ([#274](https://github.com/nathanohare/Chemweave/pull/274))

## 0.1.149 (2026-10-29)

### Fixed

- Canvas: a hashed wedge's hashes start a step away from the stereocenter, as ChemDraw draws them. ([#273](https://github.com/nathanohare/Chemweave/pull/273))

## 0.1.148 (2026-10-29)

### Changed

- Canvas: a new bond on an alkyne carbon carries straight on instead of zig-zagging. ([#269](https://github.com/nathanohare/Chemweave/pull/269))
- Canvas: a new bond on an alkyne carbon carries straight on instead of zig-zagging. ([#270](https://github.com/nathanohare/Chemweave/pull/270))

## 0.1.147 (2026-10-27)

### Fixed

- Files: security fixes for CDXML reading, notes pages and chart titles, so crafted files can't cause trouble. ([#268](https://github.com/nathanohare/Chemweave/pull/268))

## 0.1.146 (2026-10-27)

### Fixed

- Files: updated PDF and ZIP libraries close security holes, including one where a harmful PDF could run code when opened. ([#267](https://github.com/nathanohare/Chemweave/pull/267))

## 0.1.145 (2026-10-27)

### Added

- Help: the README and Getting Started explain how to install the iPad test version through TestFlight. ([#264](https://github.com/nathanohare/Chemweave/pull/264))

## 0.1.144 (2026-10-27)

### Under the hood

- Two stray files are removed from the repository. ([#263](https://github.com/nathanohare/Chemweave/pull/263))

## 0.1.143 (2026-10-27)

### Under the hood

- The staging branch is retired. ([#262](https://github.com/nathanohare/Chemweave/pull/262))

## 0.1.142 (2026-10-27)

### Fixed

- Canvas: deleting a charge sign removes the atom's charge with it. ([#253](https://github.com/nathanohare/Chemweave/pull/253))
- Document: icons in reopened documents draw at their own size, and a cover page saved in Word is recognized again. ([#258](https://github.com/nathanohare/Chemweave/pull/258))
- Desktop app: a window restored from maximized stays on a screen. ([#259](https://github.com/nathanohare/Chemweave/pull/259))
- Canvas: deleting a charge sign removes the atom's charge with it. ([#260](https://github.com/nathanohare/Chemweave/pull/260))

## 0.1.141 (2026-10-27)

### Fixed

- Word files: figures named in the Selection Pane keep that name in Word, Escape closes the page's right-click menu, and menus follow Interface Size. ([#254](https://github.com/nathanohare/Chemweave/pull/254))
- CDXML: rotated text from older files is turned on save, and ChemDraw's page count is kept. ([#255](https://github.com/nathanohare/Chemweave/pull/255))
- Document: cross-references keep their bookmark after Insert ▸ Cover Page. ([#256](https://github.com/nathanohare/Chemweave/pull/256))

## 0.1.140 (2026-10-26)

### Fixed

- Document: Tab and text fitting in diagrams, the save note, Word themes and scrolling work better. ([#247](https://github.com/nathanohare/Chemweave/pull/247))
- Spreadsheet: pivot field menus show over the Fields window, stray lock files are cleaned up, and interface text is no longer selected by accident. ([#248](https://github.com/nathanohare/Chemweave/pull/248))
- Slides: an equation in a line of a text box can be reached, and PowerPoint themed table styles keep their colors and lines. ([#249](https://github.com/nathanohare/Chemweave/pull/249))
- Slides: guides are saved where PowerPoint 2013 and later keep them, and reused slides keep their placeholders on their template. ([#250](https://github.com/nathanohare/Chemweave/pull/250))
- Interface: menus in short windows, Ctrl+Alt+0 on Windows, resizing the toolbox grid and arranging icons in documents work properly. ([#251](https://github.com/nathanohare/Chemweave/pull/251))

## 0.1.139 (2026-10-26)

### Added

- Spreadsheet: LAMBDA names can be called as dynamic array formulas, with improved PivotTable Fields menus and dragging and a PivotChart range. ([#235](https://github.com/nathanohare/Chemweave/pull/235))
- Spreadsheet: Formula Style ▸ Spot Formulas in Typed Text turns formula spotting on or off for each workbook. ([#236](https://github.com/nathanohare/Chemweave/pull/236))
- Slides: Summary Zoom, video fades and poster frames, Keep Source Formatting, and real elbow connectors. ([#240](https://github.com/nathanohare/Chemweave/pull/240))
- Slides: handout master and guides. ([#241](https://github.com/nathanohare/Chemweave/pull/241))

### Changed

- Interface: the app starts faster, loading Spreadsheet, Document and Slides only when first used. ([#234](https://github.com/nathanohare/Chemweave/pull/234))
- Slides: Compare follows Undo and docks on the right, and original pictures survive a trip through PowerPoint. ([#241](https://github.com/nathanohare/Chemweave/pull/241))

### Fixed

- Slides: videos and sounds on slides play in the desktop app. ([#231](https://github.com/nathanohare/Chemweave/pull/231))
- Spreadsheet: imported text and labels such as Q1 no longer get automatic subscripts, and Save As watches the new file for being open elsewhere. ([#236](https://github.com/nathanohare/Chemweave/pull/236))
- Slides: text typed beside a PowerPoint equation is kept, and double-click opens what's under the pointer. ([#237](https://github.com/nathanohare/Chemweave/pull/237))
- Diagrams: elbow lines are saved as shapes so PowerPoint no longer wipes org-chart slides, and diagram menu items are labeled. ([#238](https://github.com/nathanohare/Chemweave/pull/238))
- Slides: tables restyled in PowerPoint keep PowerPoint's look, the text box stays selected while using the ribbon, and pictures over empty placeholders can be clicked. ([#239](https://github.com/nathanohare/Chemweave/pull/239))
- Document: Escape in a gallery or drop-down only closes it, instead of leaving the table cell you were typing in. ([#242](https://github.com/nathanohare/Chemweave/pull/242))
- Document: the figure editor keeps its own right-click menu, double-click selects a word, and structures copy correctly between Word files. ([#243](https://github.com/nathanohare/Chemweave/pull/243))
- Word files: headings, links and footnote marks in Word 97-2003 .doc files look as they do in Word. ([#244](https://github.com/nathanohare/Chemweave/pull/244))
- Interface: floating boxes, popups and dialogs fit inside the window. ([#245](https://github.com/nathanohare/Chemweave/pull/245))

## 0.1.138 (2026-10-26)

### Fixed

- Document: Quick Parts and Date & Time are back on the Insert tab. ([#233](https://github.com/nathanohare/Chemweave/pull/233))

## 0.1.137 (2026-10-26)

### Changed

- Help: the user guide is read through and brought up to date with the current app. ([#232](https://github.com/nathanohare/Chemweave/pull/232))

## 0.1.136 (2026-10-26)

### Added

- Canvas: Chemistry ▸ Reactions and Schemes ▸ Stoichiometry Table builds a sheet of amounts for the selected step, and the Select button gains a lasso. ([#215](https://github.com/nathanohare/Chemweave/pull/215))
- Interface: a start view, View ▸ Focus View, a light or dark theme choice, a What's New card after updates, and recent files in the web version. ([#215](https://github.com/nathanohare/Chemweave/pull/215))
- Canvas: curved arrows can be drawn through clicked points and reshaped by dragging the line. ([#225](https://github.com/nathanohare/Chemweave/pull/225))
- Canvas: curved arrow shape presets (single, S, U-turn, loop), Reverse, and Smooth and Simplify for the path. ([#226](https://github.com/nathanohare/Chemweave/pull/226))
- Canvas: curved arrows can be drawn freehand, and take a longer way round when neither a curve nor an S gets past. ([#229](https://github.com/nathanohare/Chemweave/pull/229))

### Changed

- Interface: menus are regrouped so each fits in one column, pastes land under the mouse clear of other objects, and settings are backed up automatically. ([#215](https://github.com/nathanohare/Chemweave/pull/215))
- Canvas: curved arrows are paths with smooth joins: add and remove bends, step angles with Shift, set the end gap, with a grab cursor. ([#223](https://github.com/nathanohare/Chemweave/pull/223))
- Print: on Windows, printing goes through the system's print settings. ([#227](https://github.com/nathanohare/Chemweave/pull/227))

### Fixed

- Document: Insert ▸ Link works in footnotes, endnotes, text boxes and table cells. ([#220](https://github.com/nathanohare/Chemweave/pull/220))
- Links added in PowerPoint are kept, and Spreadsheet New Note works on another cell. ([#222](https://github.com/nathanohare/Chemweave/pull/222))
- Desktop app: the app reopens after installing an update, and discarded tabs are no longer offered for recovery. ([#224](https://github.com/nathanohare/Chemweave/pull/224))
- Help: the Error Console buttons (Inspector, Copy, Log Folder) work. ([#228](https://github.com/nathanohare/Chemweave/pull/228))

## 0.1.135 (2026-10-26)

### Added

- Document: a notice when Word lets go of a file. ([#216](https://github.com/nathanohare/Chemweave/pull/216))
- Canvas: drag an atom onto another to join them. ([#217](https://github.com/nathanohare/Chemweave/pull/217))

### Changed

- Files: Import Structures places structures in free space, and the web version says first when an AI model is needed. ([#218](https://github.com/nathanohare/Chemweave/pull/218))

### Fixed

- Spreadsheet: headings are readable in a dark window, and Developer Tools are gathered in one menu. ([#216](https://github.com/nathanohare/Chemweave/pull/216))
- Desktop app: the update installer waits for the app to close. ([#217](https://github.com/nathanohare/Chemweave/pull/217))

## 0.1.134 (2026-10-26)

### Added

- Files: Import Structures from PDF shows each page with the drawings found outlined, and reads only the ones you pick. ([#211](https://github.com/nathanohare/Chemweave/pull/211))
- Spreadsheet: CEILING, FLOOR, LOOKUP, PMT, NPV, FACT and COMBIN, and a warning when an Excel file uses a function the app lacks. ([#211](https://github.com/nathanohare/Chemweave/pull/211))

### Fixed

- Damaged Word, Excel, OpenDocument and RTF files no longer freeze the app, and long sheets, big drawings, posters and large scans are handled much faster. ([#211](https://github.com/nathanohare/Chemweave/pull/211))

## 0.1.133 (2026-10-26)

### Added

- Document: a notice when a OneDrive file is open in Word. ([#205](https://github.com/nathanohare/Chemweave/pull/205))
- Crash handling: errors are caught and kept in a local log, the app says when it closed unexpectedly, and an Error Console and Inspector help track problems down. ([#210](https://github.com/nathanohare/Chemweave/pull/210))

### Changed

- Document: comments show beside their own page in Read Mode and Side to Side. ([#206](https://github.com/nathanohare/Chemweave/pull/206))

### Fixed

- Document: pressing Escape keeps a new comment's text. ([#205](https://github.com/nathanohare/Chemweave/pull/205))
- Interface: fixes to the menu bar and to comments on slides. ([#206](https://github.com/nathanohare/Chemweave/pull/206))
- Canvas: when building from the keyboard, the highlight stays put while the mouse passes by, and Undo puts it back. ([#207](https://github.com/nathanohare/Chemweave/pull/207))

### Under the hood

- The iPad app is built only from the main branch, and outdated check runs are stopped. ([#209](https://github.com/nathanohare/Chemweave/pull/209))

## 0.1.132 (2026-10-26)

### Changed

- Desktop app: the first window fits the screen. ([#201](https://github.com/nathanohare/Chemweave/pull/201))

### Fixed

- Print: wide pages print landscape on Windows printers. ([#198](https://github.com/nathanohare/Chemweave/pull/198))
- CDXML: Design shapes keep their fill in ChemDraw, and the energy diagram's axis title stays turned. ([#199](https://github.com/nathanohare/Chemweave/pull/199))
- CDXML: rotated text, structures in table cells, paper size and text boxes now come through correctly, including files saved back from ChemDraw. ([#200](https://github.com/nathanohare/Chemweave/pull/200))
- Canvas: the tropylium and cyclopentadienide templates are read as ions in analysis instead of giving valence errors. ([#202](https://github.com/nathanohare/Chemweave/pull/202))
- CDXML: a structure in a table cell is saved inside ChemDraw's cell. ([#203](https://github.com/nathanohare/Chemweave/pull/203))

## 0.1.131 (2026-10-25)

### Fixed

- Interface: menus laid out in columns close again when you click away. ([#197](https://github.com/nathanohare/Chemweave/pull/197))

## 0.1.130 (2026-10-25)

### Added

- IPad: write into text boxes with Scribble. ([#195](https://github.com/nathanohare/Chemweave/pull/195))

### Fixed

- IPad: in Safari, Pencil sketch strokes are kept, hand-size letters are read, and menus are easier to use by touch. ([#193](https://github.com/nathanohare/Chemweave/pull/193))

### Under the hood

- One-command speed baselines, benchmarks for each mode, test coverage and strict type checking. ([#191](https://github.com/nathanohare/Chemweave/pull/191))
- IPad builds keep their version and raise only the build number, so testers get each new build sooner. ([#192](https://github.com/nathanohare/Chemweave/pull/192))
- Pen stroke timings in Developer Tools. ([#195](https://github.com/nathanohare/Chemweave/pull/195))

## 0.1.129 (2026-10-25)

### Changed

- Help: the README and Getting Started say the Mac installer is signed and notarized. ([#194](https://github.com/nathanohare/Chemweave/pull/194))

## 0.1.128 (2026-10-25)

### Added

- Slides: the slide list and speaker notes can be resized, and the notes can be hidden. ([#187](https://github.com/nathanohare/Chemweave/pull/187))
- IPad: a privacy policy page is published with the web version for TestFlight and the App Store. ([#190](https://github.com/nathanohare/Chemweave/pull/190))

## 0.1.127 (2026-10-25)

### Added

- Canvas: reagents and formulas typed in text boxes are read as chemistry. ([#188](https://github.com/nathanohare/Chemweave/pull/188))

### Fixed

- Interface: the window buttons and menus stay inside the window. ([#186](https://github.com/nathanohare/Chemweave/pull/186))

## 0.1.126 (2026-10-25)

### Changed

- Settings: AI keys are kept more safely, and opening files is better protected against damaged or harmful files. ([#182](https://github.com/nathanohare/Chemweave/pull/182))
- Web version: AI keys are forgotten when the tab closes unless you choose to remember them. ([#183](https://github.com/nathanohare/Chemweave/pull/183))

### Under the hood

- The iPad app icon has no transparency, so TestFlight accepts the upload. ([#184](https://github.com/nathanohare/Chemweave/pull/184))

## 0.1.125 (2026-10-25)

### Added

- Settings: Settings ▸ AI Model links an AI model of your choice, hosted or local, with your own key. ([#168](https://github.com/nathanohare/Chemweave/pull/168))
- Files: File ▸ Import Structures from Picture and File ▸ Paste Picture as Structure read structures from pictures and hand drawings, with a review screen to check and correct each one. ([#171](https://github.com/nathanohare/Chemweave/pull/171))
- Files: File ▸ Import Structures from PDF finds the drawings on each page and opens them on the review screen with the page they came from. ([#172](https://github.com/nathanohare/Chemweave/pull/172))
- IPad: a test version of the iPad app is built for TestFlight. ([#173](https://github.com/nathanohare/Chemweave/pull/173))
- Spreadsheet: treemap charts with drill-down, and decomposition trees. ([#178](https://github.com/nathanohare/Chemweave/pull/178))
- Diagrams: swimlane flowcharts, Gantt charts and timelines with dates. ([#179](https://github.com/nathanohare/Chemweave/pull/179))

### Removed

- Canvas: the Pen tool for Bézier arrows is taken out for now, to be rebuilt; curved and S-shaped arrows keep their own editing. ([#176](https://github.com/nathanohare/Chemweave/pull/176))

### Under the hood

- The Mac app is signed and notarized once the signing keys are set. ([#173](https://github.com/nathanohare/Chemweave/pull/173))
- The Windows app and installers can be signed with Azure Artifact Signing. ([#174](https://github.com/nathanohare/Chemweave/pull/174))
- IPad builds are uploaded to TestFlight only when that is switched on. ([#175](https://github.com/nathanohare/Chemweave/pull/175))
- The iPad build is fixed, with a clear message when the App Store Connect key is missing. ([#180](https://github.com/nathanohare/Chemweave/pull/180))

## 0.1.123 (2026-10-24)

### Added

- Interface: View ▸ Touch Mode gives bigger menus, ribbons and toolboxes, long press and double taps, and an atom keypad for the atom or bond last drawn. ([#169](https://github.com/nathanohare/Chemweave/pull/169))
- Canvas: the Sketch tool turns pen strokes into bonds, rings and benzene rings, erases with a scribble and reads handwritten atom labels; Pen Always Sketches works with any tool. ([#169](https://github.com/nathanohare/Chemweave/pull/169))

## 0.1.122 (2026-10-24)

### Added

- Canvas: pen and touch: two fingers pan and zoom, a finger pans once a pen has been used, and a long press opens the right-click menu. ([#166](https://github.com/nathanohare/Chemweave/pull/166))

### Changed

- Canvas: wheel scrolling stops at the edge of the drawing. ([#165](https://github.com/nathanohare/Chemweave/pull/165))

## 0.1.121 (2026-10-24)

### Added

- Files: ChemDraw style sheets (.cds) can be opened. ([#162](https://github.com/nathanohare/Chemweave/pull/162))
- Desktop app: View ▸ Interface Size zooms the whole window from 80% to 150%, with Ctrl+Alt+=, Ctrl+Alt+- and Ctrl+Alt+0. ([#163](https://github.com/nathanohare/Chemweave/pull/163))

### Changed

- Interface: the drawing toolbox looks the same in every mode, without the hint line that widened it in Spreadsheet and Document. ([#163](https://github.com/nathanohare/Chemweave/pull/163))

## 0.1.120 (2026-10-24)

### Added

- Diagrams: diagram items can hold chemical structures, and there are four new diagram layouts. ([#153](https://github.com/nathanohare/Chemweave/pull/153))
- Spreadsheet: Sankey charts, and clicking a chart on a dashboard filters the dashboard by what was clicked. ([#155](https://github.com/nathanohare/Chemweave/pull/155))
- Settings: Settings ▸ General ▸ Redraw ChemDraw objects in Word files as they open brings back the old redrawing. ([#157](https://github.com/nathanohare/Chemweave/pull/157))

### Changed

- Canvas: bold bonds and wedges join cleanly, and half arrowheads blend into their line. ([#156](https://github.com/nathanohare/Chemweave/pull/156))
- Word files: ChemDraw objects in a .docx keep their look and are saved back unchanged until you double-click one (or use Edit Drawing) to edit it. ([#157](https://github.com/nathanohare/Chemweave/pull/157))
- Word files: new bonds drawn on a ChemDraw structure from Word match that structure's style. ([#160](https://github.com/nathanohare/Chemweave/pull/160))

### Fixed

- Interface: toolboxes no longer keep empty cells where retired template palettes used to be. ([#158](https://github.com/nathanohare/Chemweave/pull/158))
- CDXML: saving no longer fails on a structure that has a charge sign but no ring circle. ([#159](https://github.com/nathanohare/Chemweave/pull/159))

## 0.1.119 (2026-10-23)

### Under the hood

- The README shows a Diels–Alder mechanism, an energy diagram, navigation and the dark interface, with links to the web version. ([#154](https://github.com/nathanohare/Chemweave/pull/154))

## 0.1.118 (2026-10-23)

### Changed

- Canvas: the 3-D template palettes are trimmed down. ([#151](https://github.com/nathanohare/Chemweave/pull/151))

## 0.1.117 (2026-10-23)

### Added

- Canvas: new ways to find your way around a drawing: a navigator, arrows at the edge pointing to what's off screen, a dot grid, a tint outside the page and Go to Selection. ([#146](https://github.com/nathanohare/Chemweave/pull/146))
- Canvas: a Pen tool draws and edits Bézier arrows. ([#148](https://github.com/nathanohare/Chemweave/pull/148))
- Web version: the browser version is published on GitHub Pages, so it runs without installing anything. ([#149](https://github.com/nathanohare/Chemweave/pull/149))

## 0.1.116 (2026-10-22)

### Changed

- Canvas: drawings are back on an endless canvas, with no page edge shown on screen. ([#144](https://github.com/nathanohare/Chemweave/pull/144))

### Fixed

- Word files: a Word file saved after editing a chart opens as a document, not as a spreadsheet. ([#141](https://github.com/nathanohare/Chemweave/pull/141))
- Files: histogram and box charts are saved with their chart style and color parts, as Office expects. ([#142](https://github.com/nathanohare/Chemweave/pull/142))
- Files: axis titles of histogram and box charts are saved in the form Office expects. ([#143](https://github.com/nathanohare/Chemweave/pull/143))

## 0.1.115 (2026-10-22)

### Changed

- Canvas: faster dragging, opening and saving of big drawings. ([#134](https://github.com/nathanohare/Chemweave/pull/134))
- Spreadsheet: changing the Drawing Style redraws every structure cell as one undo step. ([#136](https://github.com/nathanohare/Chemweave/pull/136))
- Interface: Customize Toolboxes shows each toolbox as a grid, cell by cell. ([#139](https://github.com/nathanohare/Chemweave/pull/139))

### Fixed

- Interface: editing a structure in a document or sheet beside a drawing no longer changes that drawing, and split view works beside a Design. ([#133](https://github.com/nathanohare/Chemweave/pull/133))
- Copy and paste: tables, text and structures paste correctly between Documents, Sheets and Slides, and copied charts and pictures paste as pictures. ([#133](https://github.com/nathanohare/Chemweave/pull/133))
- Slides: Undo and Redo name the step, and a Slide Master drawing-style change restyles existing structures. ([#133](https://github.com/nathanohare/Chemweave/pull/133))
- Files: a tropylium plus shows in ChemDraw, PowerPoint no longer repairs decks with edited pictures, and the Open dialog accepts files open in Word. ([#135](https://github.com/nathanohare/Chemweave/pull/135))
- Canvas: a gray box no longer shows at the top left of the canvas. ([#137](https://github.com/nathanohare/Chemweave/pull/137))
- Interface: folded toolboxes can be opened again, and View ▸ Reset Toolboxes restores the layout. ([#138](https://github.com/nathanohare/Chemweave/pull/138))

## 0.1.114 (2026-10-22)

### Changed

- Interface: faster startup, opening and dragging in big drawings, and AutoSave waits for a pause in typing. ([#131](https://github.com/nathanohare/Chemweave/pull/131))

### Fixed

- Spreadsheet: text with emoji no longer crashes drawing or saving, and CSV files starting with "PK" open. ([#131](https://github.com/nathanohare/Chemweave/pull/131))
- Canvas: changing a bond order in an opened CDXML file updates the hydrogens, and copies keep their tied captions and arrow pins. ([#131](https://github.com/nathanohare/Chemweave/pull/131))

## 0.1.113 (2026-10-22)

### Added

- Canvas: Bicyclic rings palette with named bridged scaffolds (norbornane, camphor, tropane, DABCO) and saturated benzene, pyridine, piperidine and morpholine bioisosteres. ([#128](https://github.com/nathanohare/Chemweave/pull/128))

### Changed

- Canvas: atoms from 3-D templates keep their depth so the bond further back gets the gap where bonds cross, and charge signs can be dragged anywhere, such as inside a ring. ([#128](https://github.com/nathanohare/Chemweave/pull/128))
- Slides: Design and Transitions share one ribbon tab. ([#129](https://github.com/nathanohare/Chemweave/pull/129))

## 0.1.112 (2026-10-22)

### Added

- Document: Insert ▸ Object and Paste as Object, with objects from Word files kept. ([#114](https://github.com/nathanohare/Chemweave/pull/114))
- Slides: motion paths, animation triggers, Animation Painter, header and footer, and slide show setup. ([#115](https://github.com/nathanohare/Chemweave/pull/115))
- Spreadsheet: cell styles, outlines and subtotals, sparklines, page views and themes. ([#116](https://github.com/nathanohare/Chemweave/pull/116))
- Document: Restrict Editing, form fields, an index and a table of authorities. ([#117](https://github.com/nathanohare/Chemweave/pull/117))
- Desktop app: choose Stable or Latest updates; test builds carry a Beta mark. ([#118](https://github.com/nathanohare/Chemweave/pull/118))
- Files: open and save .xls, .xlsm and .ods spreadsheets, and a template gallery. ([#119](https://github.com/nathanohare/Chemweave/pull/119))
- Slides: Compare Presentations, an accessibility checker and alt text. ([#119](https://github.com/nathanohare/Chemweave/pull/119))
- Document: paragraph borders and shading, Sort, date and cross-reference fields, cover pages, Go To and Select. ([#120](https://github.com/nathanohare/Chemweave/pull/120))
- Document: Spelling and Grammar pane, Thesaurus, Word Count and automatic hyphenation. ([#120](https://github.com/nathanohare/Chemweave/pull/120))
- Slides: shape styles and effects, ruler and guides, Outline view, Notes Page and masters. ([#121](https://github.com/nathanohare/Chemweave/pull/121))
- Spreadsheet: Get Data to import and shape outside data, and a Compound data type for cells. ([#122](https://github.com/nathanohare/Chemweave/pull/122))
- Document: headers and footers, markup views, Arrange tools and themes. ([#124](https://github.com/nathanohare/Chemweave/pull/124))
- Files: open and save RTF, ODT and DOC documents. ([#124](https://github.com/nathanohare/Chemweave/pull/124))
- Settings: Customize Toolboxes with phone-style editing, and Import and Export of all settings. ([#125](https://github.com/nathanohare/Chemweave/pull/125))
- Settings: Customize the Ribbon to reorder tabs and groups and add groups of your own. ([#127](https://github.com/nathanohare/Chemweave/pull/127))

### Changed

- Interface: compact window with a tighter ribbon, menu bar and tabs and its own title bar. ([#123](https://github.com/nathanohare/Chemweave/pull/123))

### Fixed

- Interface: icon fixes. ([#123](https://github.com/nathanohare/Chemweave/pull/123))

## 0.1.111 (2026-10-22)

### Added

- Document: Compare and Combine documents, and live Zotero, Mendeley and EndNote citations. ([#101](https://github.com/nathanohare/Chemweave/pull/101))
- Document: Picture Format with corrections, recolor, transparency, Remove Background and crop to shape. ([#102](https://github.com/nathanohare/Chemweave/pull/102))
- Spreadsheet: Page Layout tab with print area, print titles, breaks, headers and footers and Print Preview, plus pictures, shapes and text boxes saved to Excel files. ([#103](https://github.com/nathanohare/Chemweave/pull/103))
- Slides: sections, Slide Sorter, layouts in the slide master, your own themes and any slide size. ([#104](https://github.com/nathanohare/Chemweave/pull/104))
- Document: table styles, borders, cell margins, convert text to table and back, Split Table, and a Navigation pane. ([#105](https://github.com/nathanohare/Chemweave/pull/105))
- Spreadsheet: Find and Replace, Go To Special, Flash Fill, Paste Special, Text to Columns, Remove Duplicates, multi-level sort, Advanced Filter, and Freeze Panes. ([#106](https://github.com/nathanohare/Chemweave/pull/106))
- Document: more text, list and style options, a ruler and page look settings. ([#107](https://github.com/nathanohare/Chemweave/pull/107))
- Slides: rotation, Selection Pane, table styles and text options. ([#108](https://github.com/nathanohare/Chemweave/pull/108))
- Slides: ink, zooms, action buttons, video and audio, emphasis effects and Morph transitions. ([#109](https://github.com/nathanohare/Chemweave/pull/109))
- Spreadsheet: date functions, spilling arrays, LET and LAMBDA, named ranges and Insert Function. ([#110](https://github.com/nathanohare/Chemweave/pull/110))
- Spreadsheet: PivotTables, What-If analysis, Solver and the Analysis ToolPak. ([#111](https://github.com/nathanohare/Chemweave/pull/111))
- Interface: Format Painter in every mode and an Insert Symbol window. ([#112](https://github.com/nathanohare/Chemweave/pull/112))

## 0.1.110 (2026-10-22)

### Added

- Interface: hyperlinks in every mode, saved as Office's own links. ([#99](https://github.com/nathanohare/Chemweave/pull/99))

## 0.1.109 (2026-10-22)

### Added

- Help: a built-in User Guide that works offline, opened at the right section with F1. ([#84](https://github.com/nathanohare/Chemweave/pull/84))
- Document: table cells can be merged down a column, and tables can be placed inside cells. ([#86](https://github.com/nathanohare/Chemweave/pull/86))
- Slides: Hide Slide, copy and paste slides between decks, Reuse Slides, and equations on slides saved as PowerPoint equations. ([#88](https://github.com/nathanohare/Chemweave/pull/88))
- Spreadsheet: Excel lookup, conditional, text and statistics functions such as XLOOKUP, SUMIFS, TEXTJOIN, T.TEST and LINEST. ([#89](https://github.com/nathanohare/Chemweave/pull/89))
- Spreadsheet: combo, histogram, box and whisker, bubble and radar charts. ([#90](https://github.com/nathanohare/Chemweave/pull/90))
- Spreadsheet: cell notes, threaded comments and data validation. ([#91](https://github.com/nathanohare/Chemweave/pull/91))
- Document: footnotes, endnotes and a table of figures. ([#92](https://github.com/nathanohare/Chemweave/pull/92))
- Desktop app: double-click or Open With a file to open it in the app, and choose file types in Settings ▸ File Types. ([#93](https://github.com/nathanohare/Chemweave/pull/93))
- Document: Insert Caption position setting, and italic stereodescriptors and bold compound numbers as you type. ([#94](https://github.com/nathanohare/Chemweave/pull/94))
- Document: sections and line numbers. ([#96](https://github.com/nathanohare/Chemweave/pull/96))
- Desktop app: edit drawings placed in Word, PowerPoint and Excel on Windows. ([#97](https://github.com/nathanohare/Chemweave/pull/97))

### Changed

- Interface: scrolling file tabs with a list of open files, and Undo and Redo name the step they will take back. ([#84](https://github.com/nathanohare/Chemweave/pull/84))
- Settings: one Settings window (Ctrl+,) with all pages and a Find box. ([#87](https://github.com/nathanohare/Chemweave/pull/87))
- Interface: the side panel and ribbon fold to fit small windows. ([#87](https://github.com/nathanohare/Chemweave/pull/87))
- Document: spell check knows about 300 name-reaction names and common synthesis words. ([#94](https://github.com/nathanohare/Chemweave/pull/94))
- Slides: pasted structures fit the slide and use the slides' drawing style; typed reagent names become structures, and formulas work in cells. ([#95](https://github.com/nathanohare/Chemweave/pull/95))

### Fixed

- Desktop app: files open in Word can be opened on Windows, and a new empty Drawing tab no longer shows the previous drawing. ([#85](https://github.com/nathanohare/Chemweave/pull/85))

## 0.1.108 (2026-10-22)

### Added

- Copy and paste: structures travel inside pictures copied to Word and can be edited again, and pictures carry SMILES alt text. ([#68](https://github.com/nathanohare/Chemweave/pull/68))
- Canvas: faster keyboard building of structures, with new keys for Boc, hashed wedges, spiro rings and η-ligands, and ring keys that keep the highlight in a useful place. ([#69](https://github.com/nathanohare/Chemweave/pull/69))
- Interface: full keyboard access to menus, tabs, ribbon, toolbox and side panel (F10, Alt shortcuts, Ctrl+F6), and screen readers announce tools and the selection. ([#72](https://github.com/nathanohare/Chemweave/pull/72))
- Design: icon library of about 7,000 icons, including lab and hazard signs. ([#74](https://github.com/nathanohare/Chemweave/pull/74))
- Document: charts in Document and Slides modes, saved as native Word and PowerPoint charts. ([#75](https://github.com/nathanohare/Chemweave/pull/75))
- Document: Word-style views: Read Mode, Web Layout, Outline, Draft, Side to Side, Split and New Window. ([#76](https://github.com/nathanohare/Chemweave/pull/76))
- Canvas: Format ▸ Group and Ungroup, Link Text to Structure, and Bring to Front and Send to Back. ([#77](https://github.com/nathanohare/Chemweave/pull/77))
- Canvas: structures can sit inside table cells, and two-row schemes read as one scheme. ([#78](https://github.com/nathanohare/Chemweave/pull/78))
- Document: SmartArt-style diagrams in Documents and Slides. ([#79](https://github.com/nathanohare/Chemweave/pull/79))
- Canvas: File ▸ Page Setup with page sizes and orientation, a zoom box in the status bar, and a welcome card on first launch. ([#80](https://github.com/nathanohare/Chemweave/pull/80))
- Files: picture export to TIFF, EMF and EPS, and PDFs with embedded, searchable fonts. ([#80](https://github.com/nathanohare/Chemweave/pull/80))
- Canvas: Flip Keeping Configuration commands and Chemistry ▸ Orient Like First. ([#82](https://github.com/nathanohare/Chemweave/pull/82))

### Changed

- Interface: the same menu bar in every mode, with Chemistry and Format menus that have submenus, better command search, and Help ▸ About. ([#70](https://github.com/nathanohare/Chemweave/pull/70))
- Interface: clearer tool icons, transition-state and single brackets in the toolbox, core tools always in view, and new toolboxes opening clear of the others. ([#71](https://github.com/nathanohare/Chemweave/pull/71))
- Canvas: Undo and Redo select what they changed, and the text formatting bar docks along the top so it no longer covers structures. ([#77](https://github.com/nathanohare/Chemweave/pull/77))
- Canvas: smarter alignment guides, a live preview in the Energy Diagram window, curved arrows that route round other objects, and compound numbers that line up in rows. ([#78](https://github.com/nathanohare/Chemweave/pull/78))
- Canvas: Thieme, Wiley and Elsevier drawing styles follow the journals' published settings. ([#80](https://github.com/nathanohare/Chemweave/pull/80))
- Canvas: atom labels are typed in a box on the atom that shows subscripts and charges as you type, with hand-set superscripts and raised R-group numbers. ([#81](https://github.com/nathanohare/Chemweave/pull/81))
- Canvas: the Analysis panel handles R groups, the side panel no longer jumps, and Name to Structure errors show where the name could not be read. ([#82](https://github.com/nathanohare/Chemweave/pull/82))

### Fixed

- Canvas: new bonds never point into a ring, Esc keeps a typed label, and Copy as SMILES explains valence problems. ([#69](https://github.com/nathanohare/Chemweave/pull/69))
- Files: videos in saved decks play in PowerPoint, and comment times in Word and PowerPoint files are correct. ([#73](https://github.com/nathanohare/Chemweave/pull/73))

## 0.1.107 (2026-10-22)

### Added

- Files: AutoSave, crash recovery, Version History and checks for files in shared folders. ([#66](https://github.com/nathanohare/Chemweave/pull/66))

## 0.1.106 (2026-10-22)

### Added

- Slides: Format Background with solid color, gradient, picture or pattern fills. ([#67](https://github.com/nathanohare/Chemweave/pull/67))

## 0.1.105 (2026-10-22)

### Added

- Canvas: metallocene templates for sandwich, bent, ansa and half-sandwich complexes. ([#64](https://github.com/nathanohare/Chemweave/pull/64))

## 0.1.104 (2026-10-22)

### Added

- Canvas: S-shaped mechanism arrows, smarter snapping, and arrows that stay attached to structures when they move. ([#65](https://github.com/nathanohare/Chemweave/pull/65))

## 0.1.103 (2026-10-20)

### Added

- Canvas: isotope patterns for every stable element, including the transition metals. ([#62](https://github.com/nathanohare/Chemweave/pull/62))

## 0.1.102 (2026-10-20)

### Added

- Slides: reaction animations with 3-D turns, MP4 export and animation clips on slides. ([#63](https://github.com/nathanohare/Chemweave/pull/63))

## 0.1.101 (2026-10-20)

### Added

- Slides: highlight effects and looks, and animated highlights on slides. ([#61](https://github.com/nathanohare/Chemweave/pull/61))

## 0.1.100 (2026-10-20)

### Added

- Canvas: electron counting for metal complexes in the Analysis panel. ([#59](https://github.com/nathanohare/Chemweave/pull/59))

## 0.1.99 (2026-10-20)

### Added

- Canvas: conformer templates in textbook perspectives. ([#60](https://github.com/nathanohare/Chemweave/pull/60))

## 0.1.98 (2026-10-20)

### Added

- Canvas: catalytic cycles, energy diagrams, partial bonds and transition-state brackets. ([#56](https://github.com/nathanohare/Chemweave/pull/56))

## 0.1.97 (2026-10-20)

### Under the hood

- README shows metal complex and lone pair animations and see-through ring fills. ([#58](https://github.com/nathanohare/Chemweave/pull/58))

## 0.1.96 (2026-10-20)

### Under the hood

- Only the highest version number can be marked as the latest release. ([#57](https://github.com/nathanohare/Chemweave/pull/57))

## 0.1.95 (2026-10-20)

### Changed

- Canvas: highlights run straight along bonds and center on double bonds. ([#55](https://github.com/nathanohare/Chemweave/pull/55))

## 0.1.94 (2026-10-20)

### Added

- Canvas: Scheme ▸ Animate Reaction animates one structure turning into the next. ([#54](https://github.com/nathanohare/Chemweave/pull/54))

## 0.1.93 (2026-10-20)

### Added

- Canvas: hapto bonds, metal-aware valence and chemistry, and metal complex and ligand templates. ([#53](https://github.com/nathanohare/Chemweave/pull/53))

## 0.1.92 (2026-10-20)

### Added

- Canvas: conformer template palettes and ring fusing that respects 3-D shape. ([#52](https://github.com/nathanohare/Chemweave/pull/52))

## 0.1.91 (2026-10-20)

### Changed

- Canvas: charges keep clear of bonds, and lone pairs can be aimed by dragging them round the atom. ([#51](https://github.com/nathanohare/Chemweave/pull/51))

## 0.1.90 (2026-10-20)

### Changed

- Canvas: ring fill patterns are see-through, fills can have drop shadows, swatches show the real fill, and copies keep their fills. ([#50](https://github.com/nathanohare/Chemweave/pull/50))

## 0.1.89 (2026-10-20)

### Changed

- Canvas: highlight outlines are smooth. ([#48](https://github.com/nathanohare/Chemweave/pull/48))

## 0.1.88 (2026-10-20)

### Fixed

- Canvas: the drawing no longer flickers when selecting and deselecting. ([#47](https://github.com/nathanohare/Chemweave/pull/47))

## 0.1.87 (2026-10-18)

### Added

- Desktop app: a portable Windows copy that runs without installing. ([#44](https://github.com/nathanohare/Chemweave/pull/44))

### Fixed

- Desktop app: new releases publish again after the portable-copy change. ([#46](https://github.com/nathanohare/Chemweave/pull/46))

### Under the hood

- README rewritten as a showcase with new screenshots and animations. ([#45](https://github.com/nathanohare/Chemweave/pull/45))

## 0.1.84 (2026-10-17)

### Added

- Document: comments in Documents and Slides. ([#43](https://github.com/nathanohare/Chemweave/pull/43))

## 0.1.83 (2026-10-15)

### Added

- Canvas: reagent text on reaction arrows and a Scheme Settings window. ([#42](https://github.com/nathanohare/Chemweave/pull/42))

### Fixed

- Canvas: Drawing Style fonts are applied to the drawing. ([#42](https://github.com/nathanohare/Chemweave/pull/42))

## 0.1.82 (2026-10-15)

### Added

- Document: in-line structures and pictures can be dragged to another place in the text. ([#41](https://github.com/nathanohare/Chemweave/pull/41))

### Changed

- Interface: the side panel is a toolbox in every mode, folds and reopens reliably, and remembers its state per mode. ([#41](https://github.com/nathanohare/Chemweave/pull/41))

## 0.1.81 (2026-10-15)

### Fixed

- Canvas: rings added to the end of a chain point the right way. ([#40](https://github.com/nathanohare/Chemweave/pull/40))

## 0.1.80 (2026-10-15)

### Added

- Slides: Home tab Font and Paragraph groups, and Insert ▸ Shapes in Slides and Documents. ([#38](https://github.com/nathanohare/Chemweave/pull/38))

### Changed

- Canvas: mechanism arrows start from lone pairs, pick a clear side and snap to atoms and bonds; Scheme ▸ Clean Up Arrow tidies them. ([#38](https://github.com/nathanohare/Chemweave/pull/38))
- Interface: each toolbox has its own lock, and the side panel remembers folded or open for each mode. ([#38](https://github.com/nathanohare/Chemweave/pull/38))

### Under the hood

- README documentation. ([#39](https://github.com/nathanohare/Chemweave/pull/39))

## 0.1.79 (2026-10-15)

### Added

- Interface: drawing toolbox beside Word-style documents and Excel-style sheets, Ctrl+drag to copy, and pointers that show what a click will do. ([#35](https://github.com/nathanohare/Chemweave/pull/35))

### Changed

- Canvas: better contrast on the dark page. ([#35](https://github.com/nathanohare/Chemweave/pull/35))

## 0.1.78 (2026-10-14)

### Changed

- Interface: faster sheets, isotope patterns, typing in long documents, dragging in drawings and switching slides; editing one cell recalculates only what depends on it. ([#34](https://github.com/nathanohare/Chemweave/pull/34))

## 0.1.77 (2026-10-14)

### Fixed

- Canvas: formulas and m/z for charged ions and labels such as C(O)Me, CHCl₂ and NMe₃⁺ are correct, and undo during a drag no longer leaves atoms without bonds. ([#33](https://github.com/nathanohare/Chemweave/pull/33))
- Spreadsheet: cut and paste keeps formulas working, and newer functions open in Excel without #NAME? errors. ([#33](https://github.com/nathanohare/Chemweave/pull/33))
- Document: Track Changes records replacements, autocorrect and table cells, and a picture repeated on many slides is saved once. ([#33](https://github.com/nathanohare/Chemweave/pull/33))

## 0.1.76 (2026-10-14)

### Added

- Spreadsheet: isotope pattern table and mass spectrum chart. ([#32](https://github.com/nathanohare/Chemweave/pull/32))

## 0.1.75 (2026-10-14)

### Added

- Interface: recent files, command search, printing and presenter view. ([#29](https://github.com/nathanohare/Chemweave/pull/29))
- Desktop app: installers for macOS and Linux. ([#29](https://github.com/nathanohare/Chemweave/pull/29))

## 0.1.73 (2026-10-14)

### Added

- Interface: workspaces save and reopen all your open tabs together. ([#28](https://github.com/nathanohare/Chemweave/pull/28))

## 0.1.72 (2026-10-14)

### Added

- Canvas: first working drawing prototype with ChemDraw-style tools and hotkeys, CDXML opening, and formula, exact mass, MW, adduct ions and R/S labels for the selected structure. ([#1](https://github.com/nathanohare/Chemweave/pull/1))
- Desktop app: runs as a Windows desktop app, with a web version for Chrome and Edge. ([#1](https://github.com/nathanohare/Chemweave/pull/1))
- Files: save drawings as CDXML that keeps everything from the original file, plus New, Open, Save As, Export Molfile and an Edit menu with Undo, Redo, Cut, Copy and Paste. ([#2](https://github.com/nathanohare/Chemweave/pull/2))
- Copy and paste: structures copy into ChemDraw as structures and into Word or PowerPoint as sharp vector pictures; paste accepts ChemDraw structures, SMILES or a molfile. ([#2](https://github.com/nathanohare/Chemweave/pull/2))
- Canvas: reaction, equilibrium, retrosynthetic and curved arrows, boxes, brackets and shapes, a Style panel, align, flip and rotate commands, and rich-text captions. ([#3](https://github.com/nathanohare/Chemweave/pull/3))
- Canvas: ring, heterocycle, amino acid and sugar templates, and Clean Up Structure for even bond lengths and angles. ([#3](https://github.com/nathanohare/Chemweave/pull/3))
- Canvas: live structure warnings for valence, unreadable labels and overlapping atoms, and live R/S and E/Z labels. ([#4](https://github.com/nathanohare/Chemweave/pull/4))
- Canvas: Name to Structure turns a typed or selected chemical name into a drawing, working offline. ([#4](https://github.com/nathanohare/Chemweave/pull/4))
- Settings: every hotkey can be changed, exported and imported, with ChemDraw's keys as the defaults. ([#4](https://github.com/nathanohare/Chemweave/pull/4))
- Canvas: wrapping text boxes with bullets, numbering, alignment and spacing, and chemistry formatting as you type (CH₂Cl₂, ¹H NMR, °C). ([#5](https://github.com/nathanohare/Chemweave/pull/5))
- Canvas: spell check that knows chemistry words, with suggestions and fixes for formatting slips. ([#5](https://github.com/nathanohare/Chemweave/pull/5))
- Copy and paste: formatted text copies to and pastes from Word with bold, italic, subscripts, colors and lists kept. ([#5](https://github.com/nathanohare/Chemweave/pull/5))
- Slides: a Slides mode for building presentations with structures on slides. ([#6](https://github.com/nathanohare/Chemweave/pull/6))
- Spreadsheet: a Sheet mode with tables for working with compound data. ([#7](https://github.com/nathanohare/Chemweave/pull/7))
- Document: a Document mode for writing text with structures in it. ([#8](https://github.com/nathanohare/Chemweave/pull/8))
- Canvas: Scheme menu reads reaction steps, cleans up reactions, arranges whole schemes as lines, rows, snakes, cycles or trees, and numbers compounds. ([#9](https://github.com/nathanohare/Chemweave/pull/9))
- Canvas: snapping mechanism arrows, lone pairs and radicals, aromatic circles, dative and quadruple bonds, a periodic table, color fills, and your own templates and nicknames. ([#9](https://github.com/nathanohare/Chemweave/pull/9))
- Spreadsheet: unit formats for reaction conditions. ([#10](https://github.com/nathanohare/Chemweave/pull/10))
- Canvas: Analysis panel with ion masses, isotope pattern, elemental analysis, estimated properties and ready-to-paste HRMS text, plus fragment, stereo group, polymer bracket and R-group table tools. ([#11](https://github.com/nathanohare/Chemweave/pull/11))
- Document: reference manager with DOI lookup, BibTeX and RIS import, and journal-style bibliographies. ([#11](https://github.com/nathanohare/Chemweave/pull/11))
- Interface: View ▸ Split View puts a drawing beside a document, sheet or slides. ([#11](https://github.com/nathanohare/Chemweave/pull/11))
- Document: bibliographies in ten journal styles, with every detail of a style changeable. ([#12](https://github.com/nathanohare/Chemweave/pull/12))
- Interface: scroll bars on the drawing, tabs reorder by dragging, and Show R/S in the View menu. ([#13](https://github.com/nathanohare/Chemweave/pull/13))
- Design: a Design mode for graphics, posters and flowcharts. ([#14](https://github.com/nathanohare/Chemweave/pull/14))
- Canvas: right-click menu, Add Frame with padding that fits its contents, Show Terminal Methyls, and highlights, ring fills and hatched, stippled or gradient fills. ([#15](https://github.com/nathanohare/Chemweave/pull/15))
- Interface: custom color palettes shared by every mode, and extra toolboxes that float or dock. ([#15](https://github.com/nathanohare/Chemweave/pull/15))
- Canvas: ID labels, captions and formula or mass descriptors stay tied to their structure, and Number Compounds offers more numbering styles. ([#16](https://github.com/nathanohare/Chemweave/pull/16))
- Slides: an I-beam pointer over text boxes and a Lock Structures button. ([#17](https://github.com/nathanohare/Chemweave/pull/17))
- Spreadsheet: dashboards, charts with fitted lines, and conditional formatting. ([#18](https://github.com/nathanohare/Chemweave/pull/18))
- Canvas: tooltips on group labels show what OTBS, Boc or CO₂Me stands for. ([#19](https://github.com/nathanohare/Chemweave/pull/19))
- Canvas: axial chirality labels (Ra/Sa or P/M) for biaryls, allenes and alkylidenecycloalkanes. ([#20](https://github.com/nathanohare/Chemweave/pull/20))
- Canvas: drawing styles with journal presets, your own styles and defaults, and a dark page. ([#21](https://github.com/nathanohare/Chemweave/pull/21))
- Interface: free fonts in every font box, embedded when saving Office files, and alignment guides while dragging. ([#22](https://github.com/nathanohare/Chemweave/pull/22))
- Document: Layout tab, highlighter, text boxes, text wrapping, columns and Word-style tables. ([#24](https://github.com/nathanohare/Chemweave/pull/24))
- Desktop app: checks for updates and installs new releases; the program is now licensed under GPL version 3. ([#27](https://github.com/nathanohare/Chemweave/pull/27))

### Changed

- Canvas: highlights can be round, diamond or square with shadows or soft edges, and toolboxes and the side panel can be locked and folded. ([#16](https://github.com/nathanohare/Chemweave/pull/16))

### Fixed

- Interface: toolboxes no longer cover menus, and ring fills can be edited inside frames. ([#16](https://github.com/nathanohare/Chemweave/pull/16))
- Interface: font and size drop-downs show a full list; each kind of tab has its own icon, and ribbon buttons show icons. ([#17](https://github.com/nathanohare/Chemweave/pull/17))
- Interface: a stray box no longer appears, and the Slides ribbon is shorter. ([#27](https://github.com/nathanohare/Chemweave/pull/27))
