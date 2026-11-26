# UI style guide

The rules every change to Chemweave's screens, menus and wording follows. Nate decided each one; the reason is given in a line so you can apply the rule to cases it does not name. Read this before any UI work, and when Nate decides something new, add it here in the same change (keep the numbers: new rules take the next free S number, and a changed rule keeps its number and says what it replaces).

Checks that enforce part of this file:

- `tests/ui-text-lint.test.ts` fails on banned words, British spellings and flat formulas in user-visible text (S26, S27, S29, S64, S70, S82). Run it alone with `npx vitest run tests/ui-text-lint.test.ts`.
- `scripts/screenshot-matrix.mjs` shoots changed screens at three window sizes in Light and Dark Gray (S1 to S3, S45, S48), for the pull request and for Nate.
- `tests/motion.test.ts` fails on an animation that uses its own timing or animates a layout property (S91, S92, S94).
- The pull request template (`.github/pull_request_template.md`) asks for the mockup pick (S41), the Office model followed (S13 to S25) and what a new control replaces (S25).

## The five standing UI rules

These came first and every later rule builds on them.

1. **Standard command names.** Use the name Office (or ChemDraw, for drawing) uses for the same command. People already know those names and can find them in Search.
2. **American spelling** everywhere the user reads (color, center, behavior, gray, organize). One spelling keeps Search, the guide and the app consistent.
3. **Help text goes behind an "i" tip** by the header it explains, never on a line of its own. Lines of help push the controls down and are read once.
4. **No wasted height.** Every row on screen must earn its place: laptop screens are 700 px tall.
5. **Canvas teal** is the Canvas mode accent; each mode keeps its own accent color.

## Layout and density

| # | Rule | Why |
|---|---|---|
| S1 | Every ribbon is the same height (the Spreadsheet's) in every mode and density, the Canvas included (three rows). | Switching mode must not move the drawing area. |
| S2 | No horizontal scroll bar on the ribbon or on the side or Style panel; compact the commands instead. | A scroll bar hides commands people then can't find. |
| S3 | Icons and labels are vertically centered and unified on every ribbon tab at every window size. | Uneven rows look broken. |
| S4 | Right-click menus fit a 700 px window and lead with the commands for what was clicked. | Laptops are short; the first items are the ones used. |
| S5 | A floating toolbox keeps its docked two-column width. | The buttons stay where the hand expects them. |
| S6 | The lock icon is always visible on every toolbox and on the side panel; no empty row above the commands. | Locking must always be one click away, without wasted height. |
| S7 | Toolboxes pinned under the ribbon fuse with it (minimal dark padding); no gray strip under the ribbon. | They read as one control surface. |
| S8 | The Quick Access Toolbar has a divider after its ▾ and minimal spacing between buttons. | Small screens. |
| S9 | New canvases open at 100% with the top of the page in view (replaces Fit, which fitted the first page in the window). | People start drawing at the top, at real size. |
| S10 | Canvas mode starts on the Select tool for new and opened tabs. | A stray click must not draw. |
| S11 | No first-run pop-ups over the canvas (replaces the welcome card shown on first launch). | They cover the work and are dismissed unread. |
| S12 | A template window appears over the new blank file, categories left and cards right; a click outside closes it; one shared window for every mode. | Office's New window, the same everywhere. |
| S42 | Menus never break into columns. Long menus are regrouped into submenus, and a short window scrolls the menu. | Columns are hard to scan and jump around between window sizes. |
| S43 | File tabs sit in the menu row by default (their own row is a setting); tabs collapse to icons with the name in a tooltip; the ribbon does not fold by itself on short windows unless turned on. The OS title bar is hidden and thin tabs are merged. | Height (UI rule 4). |
| S44 | Shape tokens: corner rounding 2 px on controls, 3 px on tabs, groups and thumbnails, 4 px on menus, dialogs and cards; round things stay round; a five-step type scale; color tokens. | One consistent look; values come from the tokens, not typed by hand. |
| S45 | Every dialog keeps its buttons in view, and dialogs grow to use larger screens. | A dialog whose OK is off screen can't be finished. |
| S46 | The status bar has one layout in every mode, PowerPoint's (view buttons, −, slider, +, percent, fit), with no emoji glyphs. | Familiar, and the same in every mode. |
| S47 | Toolboxes never cover menus. Every toolbox has its own lock and icons; the big lock button locks or unlocks all. | Menus must always be reachable. |
| S48 | Drawing toolboxes have the same spacing in every mode and no text inside. The Drawing Tools toolbox is a compact 2 × 12 grid with no third column and fits a 700 px window; variants live in fly-outs, and users can make custom fly-outs. | ChemDraw's compact tool palette; fits a laptop. |
| S49 | Toolbox density changes only the gap between buttons (Compact 0, Cozy 1 px, the default, Normal 2 px); icon size is a separate setting. | Two independent needs, two settings. |
| S50 | Shadows are light by default on menus and toolboxes, with Strong and Off settings; the ribbon keeps its own shadow. | Depth without clutter. |
| S51 | The Side Panel (keep that name) floats at the top right below the ribbon by default, with its tabs across the top (no vertical tabs); every side panel can be closed fully and has a one-row header; a held key stops toolboxes docking. | Out of the drawing's way; height. |
| S52 | Ribbon group names are centered under each group in every mode, the Canvas included. | Office's ribbon. |
| S53 | No contextual ribbon tabs in Canvas mode; never add them back there. The Office modes keep Office's contextual tabs (see S84). | Canvas tabs must not appear and vanish while drawing. |
| S54 | Canvas Home holds Clipboard, Font and Paragraph; the typing bar is hidden while Home shows. | The same text commands are never shown twice (S63). |
| S55 | Canvas Analysis is a full three-line group with m/z and labels underneath. | Matches the other ribbon groups (S1, S3). |
| S56 | The Warnings button sits at the far right of the tab row; the warning mark default is the red square, with the soft disc as an option. | Always in the same place; the square reads as a warning. |
| S57 | Speaker notes are one line by default; less padding left of the slide number; the New Slide button is centered. | Height. |
| S58 | Developer readouts (Speed panel, stress test) stay under View ▸ Developer Tools, off by default, in one Developer menu rather than bar items. | Users never need them. |
| S83 | Canvas ribbon tabs: Home (Clipboard, Font, Paragraph, Format Favorites, Clean Up with Smart Clean and Number Compounds, then the Align, Rotate, Order and Focal Point flyouts), Insert (Structure From…, Schemes, Diagrams, Mechanism, Lab), Chemistry (Structure, Reaction, Predict NMR, Look Up) and View (Zoom, Show, 3-D). No Arrange tab, and no Rings or Arrows groups: those commands live in the right-click menus, the menus and Search; a saved or asked-for tab that is gone opens Home (replaces "keep labels where there is room; the rest waits for the reorganization", and the Arrange tab). | Fewer, larger buttons; the commands that belong together sit together. |
| S87 | Side Panel defaults: floating top right in Canvas and Design; closed by default in Document, Spreadsheet and Presentation; remembered per mode. | Office modes have their own panes; drawing modes use it all the time. |
| S88 | A family of commands on a ribbon goes behind one large flyout button with ▾ after its name: a one-column list (picture and name) for commands, a pane of labeled thumbnails for things to insert (Diagrams), drawn by Chemweave or as simple line pictures. Opening one never changes the drawing; arrow keys, Enter, Esc and a click outside work; a toolbox can keep every command in view. | Less to scan on the ribbon; a picture says what a diagram looks like before it is placed. |
| S89 | The Canvas's Lab Calculator sits at the right end of the tab row, just left of the warnings box, on every tab; picture only in a narrow window. | Always one click away, without taking room from a group. |
| S90 | A command that opens a window ends in "…" in menus and in a flyout's list (Arrange in a Grid…, Rotate…), as Office's menus do; a ribbon button shows its name without it (Lab Calculator, on the tab row and in Look Up alike), and its tooltip may keep it. A flyout named for where things come from keeps it as part of its name (Structure From…). Two groups on one ribbon never share a name or differ only by a plural (Home's Clean Up, Insert's Schemes). | Office's convention; one name per group so a group can be found by name. |

## Controls and consistency

| # | Rule | Why |
|---|---|---|
| S13 | One context-menu component everywhere: Title Case names, real submenu arrows, shortcuts shown. | Menus look and work the same in every mode. |
| S14 | Show and hide switches are checkboxes in every mode. | One kind of control for one kind of choice. |
| S15 | Commands that cannot run are disabled, with the reason in the tooltip (not a message after clicking). See S85 for other modes' commands. | People learn why before they try. |
| S16 | Dropdown arrows are solid triangles with the same proportions everywhere. | Consistency. |
| S17 | The same command has the same icon in every mode (only the accent color differs); Document's Insert tab icons are the reference style; text-only ribbon commands get icons. | People find commands by icon. |
| S18 | Settings that change a look show a live preview, drawn by Chemweave, that updates with the control; shorten long dropdowns, show one sample beside it, and put examples in the tooltip. | A setting's name rarely says what it looks like. |
| S19 | Distance settings show the distance on the preview like a technical (CAD) drawing, have sensible ranges, and keep everything visible at the extremes. | A number means nothing without seeing what it measures. |
| S20 | Group related settings under subheadings; app and device integration settings have their own page ("Apps and System"). | Long settings pages are scanned, not read. |
| S21 | Controls that do not help on a given table or panel are not shown there (for example no search box on Solvents or Miscibility). | Less to look at. |
| S22 | Previews show the whole result (double bonds, live Shift and Ctrl changes). | A partial preview misleads. |
| S23 | Status bar hints show only when their key does something right now. | Hints that are always there are ignored. |
| S24 | Data gets structured input (one row per TLC spot with an Rf box), not free text. | Structured data can be checked, formatted and saved. |
| S25 | When a new control replaces an old one, the old one is removed in the same change. | Two ways to do one thing confuse people and double the upkeep. |
| S59 | Settings: Apply keeps a change for good; Set as Default appears only on per-file pages (Drawing Style: new files too); every Settings tab uses Apply and Set as Default; closing with unapplied changes asks to save or discard. | One model for every settings page. |
| S60 | No two commands share an icon, except repeated generic icons (gear, palette, brush) on settings and style rows. | An icon must identify its command. |
| S61 | "i" info tips only where they add something beyond the label; they show on hover and on Tab, and a click pins them. | A tip that repeats the label is noise. |
| S62 | A Format Favorites gallery sits on the Home tab in every mode, Canvas and Spreadsheet included, with one shared set. | Favorites made in one mode are used in the others. |
| S63 | The Text Formatting toolbox is exactly the floating typing bar; the same bar is never shown twice. | One control, one place. |
| S64 | Object snapping is a checkable command named "Snap to Objects" (never "Toggle …"). | Office names checkable commands by what they turn on. |
| S65 | The Quick Access Toolbar has Save, Undo and Redo and is customizable like Office's. | Familiar. |
| S66 | When a style default changes (drawing style, terminal methyl as Me, alkyl group form), ask whether to restyle existing structures or use it only for new ones. | Existing work must not change without asking. |
| S67 | Additions to a structure take that structure's own bond length, widths and colors (a setting, on by default). | Mixed styles inside one structure look wrong. |
| S68 | Ctrl+Z re-selects what the undone command changed. | People see what Undo did. |
| S69 | Crash reports are opt-in and local-first; nothing is sent automatically. | Privacy. |
| S81 | The SI Project tab has options for every look choice, with all Chemweave scheme and drawing options available under SI's own defaults; it uses Chemweave's engine and history, not SI Assistant's; nothing redundant; commands on the ribbon, not inline. | One program, not two glued together. |
| S84 | No contextual ribbon tabs in Canvas mode only; every other mode and the SI Project tab follow Office's contextual tabs. | Office users expect them there (S53 for Canvas). |
| S85 | Menus leave out commands that belong to another mode; commands of this mode that cannot run right now are disabled with the reason in the tooltip. | Menus show only what can matter here (S15). |
| S86 | What's New is never shown over the canvas: a status-bar note, or Help ▸ What's New, which opens on click. | S11. |

## Wording and typography

| # | Rule | Why |
|---|---|---|
| S26 | Preferred words: "selected" not "picked", "rotate" not "turn", "calculated" not "worked out", "automatically" not "by itself", "check" not "tick". | Plain, standard software words. |
| S27 | Subscript formulas and raise charges in all UI text (BF₄⁻, [M+H]⁺), Knowledge Base tables and headings included; minus signs (−), not hyphens, for negative values. | Chemists read flat formulas as typos. |
| S28 | Tooltips describe the command; they do not say "click where it goes". | The tooltip is read before clicking. |
| S29 | American spelling also in saved data shown in the UI (palette names from older versions). Proper names keep their own spelling; command search still accepts British words. | UI rule 2, applied to everything shown. |
| S70 | Menu paths use ▸; "cursor" not "caret"; "style" or "formatting" not "look"; "calculate" not "work out"; Remove, Undo, Restore; "custom" not "your own"; "Chemweave" not "the program"; "X type"; Title Case for commands, buttons and window titles. | Standard, consistent wording. |
| S71 | Standard names, with Nate's edits: Flip Horizontal (Left-Right), Flip Vertical (Top-Bottom), Preserve Stereochemistry, Chemical Abbreviation Tooltips, Pin to Nearest Structure; keep Depth Shading. | UI rule 1. |
| S72 | Mode names are the short names (Canvas, Document, Presentation, Spreadsheet, Design) in tabs, ribbons and submenus, with no parentheses. In the New menu and the start and template view, items follow Office: "Blank canvas", "Blank document", "Blank presentation", "Blank spreadsheet", "Blank design". | Short names fit; Office's New wording is familiar. |
| S73 | Warning tooltips are short, for example "C has 5 bonds (max 4)". | Read at a glance. |
| S82 | "Hotkeys" only for ChemDraw-style one-key atom and bond keys; "keyboard shortcuts" for everything else. No "ChemDraw" in command names (it is a trademark); say "ChemDraw-style". | Familiar terms; trademark. |

## Canvas and chemistry display

| # | Rule | Why |
|---|---|---|
| S30 | Canvas teal throughout Canvas mode, including the typed-text frame, selection, hover and drawing marks, checkboxes and CSS fallbacks; dark-theme accents are muted (Canvas #4ea9bc). | UI rule 5. |
| S31 | Selecting any part of a structure analyzes the whole structure; one carbon never reads CH₄. | Chemists mean the molecule. |
| S32 | Dragging a bond's end atom keeps the bond length; Alt for any length; Shift for straight. | ChemDraw's behavior. |
| S33 | A typed atom always becomes an atom (no checkbox; Undo keeps the text) (replaces a setting that could turn this off). | One predictable result; Undo for the exception. |
| S34 | Brackets drawn as a pair select together. | They are one object to the chemist. |
| S35 | Visual polish: no notches at bond joins, a single selection tint, no dashed box round a straight arrow. | Clean drawing. |
| S36 | Clean Up on an already tidy structure does nothing and says so. | It must never make a good drawing worse. |
| S37 | The one-atom right-click menu has no Align, Rotate or Flip. | They do nothing to one atom. |
| S38 | Map numbers default to ChemDraw's gray outline, with a per-number tint and a custom format as options; the look is saved with the drawing, and the last look becomes the default for new drawings. | ChemDraw's look by default. |
| S39 | The 3-D Model view stays light gray in every theme; the light gray page area stays in Dark theme. | Models and pages are judged as printed. |
| S40 | Differences from ChemDraw under 1 pt are acceptable when they are pure shifts, not wrong pixels. | Not visible in print. |
| S41 | Every visual change gets mockups for Nate to pick before building. Exception: fixes that only make a drawing match ChemDraw skip the mockup; show Nate screenshots and merge without waiting. | Nate picks looks; ChemDraw is already the agreed target. |
| S74 | The dark page is view-only: files, print, copy and exports are unchanged; an eye button switches it. | Output must not depend on a screen setting. |
| S75 | Bond-line ends default to Slightly round, with Round, Half round and Square still selectable; centered double bonds meet the ring bond with no gap. | Matches print expectations. |
| S76 | A key-set hotkey highlight holds only while the mouse is still and follows the pointer once it moves; ChemDraw's sticky way is an opt-in box. | Less surprise; ChemDraw users can opt in. |
| S77 | The Canvas shows a page grid with fixed page edges; the hatched page edge grows with zoom; scrolling stops a thin band past the page edge (spare room right and down). | The page is the document. |
| S78 | Newman projections: one wedge and one hashed wedge per carbon; the viewing eye drawn with a pupil and the ring arc as a dashed gray line (both can be changed in Settings ▸ Newman Projections); no rotated label text; text 2 pt under caption size; textbook angles by default; the front-on eye icon only on the tool button. | Textbook convention. |
| S79 | Tilt handles show only while a Perspective tool is active (replaces showing them beside the rotate handle all the time). | They get in the way otherwise. |
| S80 | In a slide show, going back glides on canvas slides; normal slides go back instantly, as in PowerPoint. | PowerPoint's behavior for normal slides. |

## Motion

Timings live in one place: the `--m-*` variables in `src/app.css` and `src/ui/motion.ts`, which the Animations setting (Settings ▸ Preferences ▸ Interface) switches between Off, Fast and Normal.

| # | Rule | Why |
|---|---|---|
| S91 | Every animation takes its length from the shared timings: Short 80 ms (right-click menus, button colors), Toggle 96 ms (check boxes and switches), Standard 120 ms (dialogs, menus, panels, tabs), Large 180 ms (mode changes, the Side Panel, the File page) and Highlight 600 ms. Normal is 1.5 times Fast; Off is zero. Things arrive with ease-out and leave with ease-in, faster than they came. | One feel everywhere, and one setting changes it all. |
| S92 | Only opacity, transform (translate, scale, rotate), colors and clip-path are animated; never a size, a position, a margin or the drawing itself. | These cost no layout, so an animation never slows the program. |
| S93 | With no choice made, the desktop app starts on Fast and the web app on Off; either starts on Off when the system asks for reduced motion. Off turns every animation off but keeps highlights (shown for the same time, without fading). | Speed comes first; the web app stays light; people who asked their system for less motion get none. |
| S94 | Nothing waits for an animation: what appears is usable at once, a second click starts over, and no command is delayed to let something finish moving; a closing window or menu never catches a click. Only a repeating animation (a busy stripe, the jiggle while customizing) keeps its own period. `tests/motion.test.ts` checks S91, S92 and S94. | Animations smooth the program; they must never make it feel slower. |
| S95 | How things arrive (Nate's picks, 2026-11-26): dialogs fade and grow from 97% and close with a quick fade; menus fade and drop 4 px; right-click menus and tooltips fade; the Side Panel slides in from the right; toolboxes, a ribbon tab's contents, a page inside a window, a folding section's contents, added list items and a new mode (also when picking a template) fade in; the selected ribbon tab's shape slides to the tab clicked; the File page slides in from the left; status messages fade and rise 6 px; check marks draw in; busy shows a bar with a moving stripe; when dragging to reorder, the other items slide out of the way. | Each element's movement says where it came from, and the same kind of element always moves the same way. |
| S96 | A folding section's arrow turns rather than swapping glyphs; a highlight on something that just changed flashes, then fades over 600 ms. | It shows the change without a second shape to read. |
| S97 | Drawing, panning, zooming and scrolling the canvas, switching between open files and moving through a list with the keyboard stay instant. Jumping to an item (a link in Help, a field the program points to, a box it reveals) glides there when animations are on (`scrollToItem` in `src/ui/motion.ts`). | The canvas is already smooth; a jump that glides shows where you went. |
| S98 | Scroll bars are a thin line until in use: they grow to full width while their pane scrolls or the pointer is near them, and go thin again 2 s after that, or as soon as the pointer leaves the pane. The room a bar takes never changes, so nothing moves when it grows. The Canvas bars grow at the shared timings; the others change at once (a scroll bar's parts can't be animated). Where the system's own bars already overlay the page and fade (macOS), they are left as they are (`src/ui/scrollbar-fade.ts`). | The work gets the room; a bar is still there to show where you are and grows when you reach for it. |

## When a rule changes

Write the new rule over the old one here, keep its number, and add "(replaces …)" with a few words on what it was, so nobody builds the old behavior again from an older note.
