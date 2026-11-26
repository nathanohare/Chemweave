# For developers

How to run Chemweave from its source code, how releases are made, where things are in the code, and how to check changes. To use the program, download it instead: see [Getting started](guide/getting-started.md).

Chemweave is written in TypeScript. The drawing runs in a web page; the desktop app wraps that page with [Tauri](https://tauri.app). The chemistry (stereo, clean-up, properties) uses [RDKit](https://www.rdkit.org) compiled to WebAssembly, and names are read by [OPSIN](https://github.com/dan2097/opsin). [TECH-DECISION.md](../TECH-DECISION.md) explains why it is built this way.

## Run it from the source code

You need Node.js once. Everything else is installed into this folder.

1. **Install Node.js** (the LTS version, 24 or newer) from [nodejs.org](https://nodejs.org). The Windows installer is fine; keep the default options.
2. **Get the code.** Either use GitHub Desktop (File > Clone repository > `nathanohare/Chemweave`), or in a terminal:
   ```
   git clone https://github.com/nathanohare/Chemweave.git
   cd Chemweave
   ```
3. **Install the parts it needs** (about 60 MB, once):
   ```
   npm install
   ```
4. **Start it:**
   ```
   npm run dev
   ```
   Then open the address it prints, usually <http://localhost:5173>, in Chrome or Edge. Press Ctrl+C in the terminal to stop it.

## How releases are made

Every merge into `main` builds the installers for Windows, macOS and Linux (and the portable Windows zip, with the bare app that portable copies update from, signed with the same key), runs the app's self-test on Windows, and publishes them as a release numbered 0.1.*build number*, whose notes are the change files added since the last release (see **The changelog** under Rules for changes), with a `latest.json` file that the app's update check reads (`.github/workflows/desktop.yml`, `scripts/release.mjs`). Releases publish one at a time, and "latest" (which is where the update check looks) always goes to the highest version, so two merges close together can't leave an older build marked latest. This needs the update signing key saved as a repository secret named `TAURI_SIGNING_PRIVATE_KEY` (**Settings ▸ Secrets and variables ▸ Actions**). Its public half is in `src-tauri/tauri.conf.json`. Keep a copy of the private key somewhere safe: if it is lost, a new key can be made, but copies installed before the change won't accept updates and need installing once by hand. Without the secret the builds still run, and the installers are kept for a week under the run in the **Actions** tab instead of being published. Builds cost nothing while the repository is public; if it is made private, only Windows is built unless a run is started by hand. The Windows app and installers are also code-signed with Azure Artifact Signing, so SmartScreen does not warn, once its secrets and variables are set ([windows-signing.md](windows-signing.md)).

**Before each release** (before a merge into `main`), run the full undo sweep on the code being released and see that it reports nothing: `npm run build`, then `npm run undo-audit` (every Document, Spreadsheet, Canvas, Presentation and Design command and every drag, about 25 minutes; see [Checks for the standing rules](#checks-for-the-standing-rules), R7). Pull requests run only the quick sweep, a sixteenth of the commands a day, so this is the one run that covers every command at once. It is run by hand, not by the release workflow. If it reports a problem, fix it before the release; a problem is never added to `KNOWN_UNDO_PROBLEMS` to let a release through.

To build it on your own computer you also need Rust (from [rustup.rs](https://rustup.rs)) and, on Windows, the Microsoft C++ Build Tools that the Rust installer offers (on macOS, Xcode's command line tools; on Linux, the WebKitGTK packages listed in the workflow). Then:
```
npm run desktop          # opens the desktop app; it reloads as the code changes
npm run desktop:build    # makes the installers in src-tauri/target/release/bundle/
```

## Rules for changes

Every change follows these, whoever writes it:

- **Screens, menus and wording** follow the [UI style guide](ui-style.md) (rules S1 to S87). Read it before any UI work, and add Nate's new decisions to it in the same change. `tests/ui-text-lint.test.ts` checks the wording on every pull request.
- **Chemistry answers come from outside the code** (standing rule R8). A test's expected chemistry value (a mass, a formula, a shift, a name, a hazard, a green-chemistry rank) comes from a cited published source (a paper, a handbook, PubChem, NIST, IUPAC) or from Nate's reference molecules, with the reference in a comment next to it. Never take it from running the code under test: a test that copies the program's own answer can only show that the answer didn't change, not that it is right. Never take solvent rankings or other data from the CHEM21 guide (its licence doesn't allow it); bundled data follows the same rule ([CONTRIBUTING](../CONTRIBUTING.md#what-not-to-contribute)).
- **Places that must stay in step** (below): a change to one place on the list is made in every place beside it, or the pull request says why not.
- **Workflows** (`.github/workflows/`): a step that calls an outside service (an upload, a release, a push, a download) runs through `node scripts/retry.mjs -- <command>` (Windows signing has its own retrying script, `scripts/sign-windows.mjs`; Mac notarization happens inside Tauri's build and is not retried yet), which tries again after 15, 45 and 90 s and shows the service's own error; a call that can't safely be repeated is listed in `NOT_RETRIED` in `tests/ci-workflows.test.ts` with its reason. A workflow that runs only on main also runs on a pull request that changes it, building without publishing (and, for the Desktop app, without code signing, which happens only on main), so the change is tried before the merge. `tests/ci-workflows.test.ts` checks both, and the **Workflow lint** workflow runs [actionlint](https://github.com/rhysd/actionlint) on every pull request that changes a workflow.
- **Pop-ups over windows**: a window opened with `showModal()` sits above the whole page, so a drop-down list, menu or tip added to `document.body` is drawn under it and can't be clicked. Add pop-ups with `popupHost()` (`src/ui/popup-host.ts`). `tests/popup-host-lint.test.ts` fails on a new file that appends anything but a window to `document.body`, and R10's keyboard walk checks that the drop-down lists in the Orbital and Settings (AI page) windows are on top.
- **Windows and the title bar**: every window opened with `showModal()` goes through `src/ui/modal-guard.ts` (it wraps `showModal` at start-up, so nothing needs calling). In the desktop app with the title bar in the menu row, a modal window would make the window's own buttons (Minimize, Maximize, Close) and the strip that moves the program inert, so each modal window carries its own copy of them; and each is placed below the title strip and inside the part of the program that is on the screen. A window with its own position in `src/app.css` keeps its top at or below `var(--dlg-top)`. `tests/modal-title-bar.test.ts` checks both. Clicking outside a modal window closes it as Esc does (its `cancel` event), first asking "Discard Changes?" if a field in it was changed (`src/ui/outside-click.ts`); a window showing work in progress sets `data-outside-click="keep"`, one that asks about its own changes sets `"cancel"`, and one whose changes aren't in its fields calls `markDialogChanged()`. `tests/dialog-outside-click.test.ts` checks it.
- **Regular expressions built from data**: don't build one with `RegExp(` from a name, an id or any text from a file (alerts #52, #54, #55 to #58). Use a plain text method (`startsWith`, `includes`, an exact-name lookup) or a regular expression literal. `tests/regex-from-data-lint.test.ts` fails when a file gains such a call (a template literal, a variable or joined text as the argument); the numbers in it only go down.
- **Code scanning alerts** (CodeQL runs only on main and weekly): a fix for an alert merges to `staging` once its other checks pass; don't run CodeQL on the fix's branch by hand (Nate, 2026-11-25). Check that the alert has closed after the next `staging` to `main` merge, when CodeQL runs on main, and fix again if it hasn't. For an alert about a regular expression built from data, remove the regular expression (a plain text check) rather than escape it: CodeQL often still flags the escaped one (alert #54, 2026-11-24).
- **Old WebKit** (apps on macOS 12, iPads and computers with Safari 15.4 or later): no regex lookbehind, in a literal or in text that becomes a pattern; one anywhere stops the app from starting. Write the pattern without it and check the text before the match with `after()`, `notAfter()` or `guarded()` (`src/regex-behind.ts`; copy such a pattern with `reflag()`, never from its `source`). `tests/old-webkit.test.ts` checks the source, and `npm run build` ends with `scripts/check-old-webkit.mjs`, which checks the built scripts, libraries included. `color-mix()` in the style sheets gets a plain fallback (`scripts/color-mix-fallback.mjs`); don't use it in styles set from code. APIs newer than Safari 15.4 that a library needs go in `src/old-webkit.ts`.
- **Long lists in readers and writers** (`src/io/`): take the smallest or largest of a list with `minOf` and `maxOf` from `src/io/min-max.ts`, never `Math.min(...list)` or `Math.max(...list)`, which overflow the stack past about 125,000 values (a spectrum's points). `tests/io-min-max.test.ts` checks it.
- **The changelog**: every pull request that changes the app (`src/`, `src-tauri/`, `index.html`, `public/`, `opsin-js/`) adds a change file to `changes/`, one line per change such as `Fixed: Canvas: undo removes a pasted object in one step. Fixes #123.` ([changes/README.md](../changes/README.md)), written for the people who use the app. When a version is published, the change files added since the last one become its release notes, which Help ▸ What's New shows, and `CHANGELOG.md` is made again from all of them (`scripts/changelog.mjs`, from the release job in `.github/workflows/desktop.yml`, which commits it to `main`); a pull request never changes `CHANGELOG.md`, so it never conflicts with those commits. Merge `staging` into `main` with **Create a merge commit** rather than **Squash and merge**: a squashed roll-up still files every change under the right version, but each entry's pull request number then has to be looked up from the roll-up's own commits on GitHub. The **Changelog** workflow fails a pull request into `staging` that changes the app without one, unless it has the `no changelog` label; `tests/changelog.test.ts` checks the files and the notes.
- **Every pull request** fills in the [pull request template](../.github/pull_request_template.md): the real-program check, edge cases, licenses, screenshots, the mockup picked, new controls, chemistry test values, what it replaces and the places kept in step.

## Checks

```
npm test          # unit tests for the chemistry, geometry and saving
npm run build     # type-check and build the web version into dist/
npm run typecheck:strict   # stricter type checks (unused parameters, a path that forgets to return)
npm run typecheck:tests    # tests/: no duplicate, missing or misspelled names or imports
npm run smoke     # after a build: the app in a headless browser, start to save and every menu
```

Every pull request runs all of these (the **Checks** workflow), plus a speed check that times `bench/core.bench.ts` for the pull request and for the branch it merges into and fails when a measure gets more than 40% slower. Pull requests that change `src-tauri/` also run `cargo test`.

To see whether real drawings survive a save and reopen, `npm run roundtrip -- <folder>` (after a build) opens every `.cdxml`, `.cdx`, `.mol` and `.sdf` file in the folder, saves it as CDXML, opens it again and lists any file whose atoms, bonds, text, arrows or structures changed. The files are read where they are and never copied.

To check Undo everywhere, `npm run undo-audit` (after a build) runs every Document, Spreadsheet, Canvas, Presentation and Design command in the built app, and drags all over each kind of object, undoing and redoing each one and comparing the file with how it was. It lists anything that changed without an undo step, took more than one Ctrl+Z, or wasn't put back exactly. `npm run undo-audit -- document <file.docx>` runs the Document part on a Word file of your own (read where it is, never copied); `npm run undo-audit -- sheet` (or `canvas`, `slides`, `design`, `drags`) runs one part, and `--only cmd1,cmd2` runs only those commands. The full audit takes about 25 minutes, so every pull request runs a quick sweep instead (`npm run undo-audit -- ci`, about two minutes, in the build job): one sixteenth of the commands in each kind of tab, a different sixteenth each day, so every command is run within 16 days. It first checks that it still catches problems (a planted command that takes two undo steps and one that makes none must both be reported), and a failure prints its slice so you can run it again (`npm run undo-audit -- ci --slice 5/16`). Commands are left out only by name, each with its reason (`NOT_UNDOABLE` in `scripts/undo-audit-lists.mjs`). The unit tests `tests/undo-*.test.ts` check the same for Document mode's commands and drags and Edit Layouts on every pull request.

To also check saving against your own ChemDraw files (they stay on your computer), point the tests at a folder of `.cdxml` files: in PowerShell `$env:CHEM_TEST_FILES="C:\path\to\folder"; npm test`. Any `.cdx` files saved by ChemDraw in that folder, or in a folder inside it, are also checked against the `.cdxml` file of the same name. Big files need more memory than Node gives by default: also set `$env:NODE_OPTIONS="--max-old-space-size=8192"`.

### Checking against real files

Standing rule R1: the writers are checked against files saved by the real ChemDraw, Word, PowerPoint and Excel. Those files can never be in the repository ([CONTRIBUTING](../CONTRIBUTING.md#what-not-to-contribute): nothing made by a commercial program), so `tests/corpus.test.ts` reads them from a folder on your own computer, named by `CHEMWEAVE_CORPUS`, and is skipped (with a message saying so) wherever that isn't set, the Checks workflow included. For every `.cdxml`, `.cdx`, `.pptx`, `.docx` and `.xlsx` file in the folder and the folders inside it, it checks that the file opens and every drawing in it draws; that saving it and opening it again keeps its atoms, bonds, text, arrows, shapes, slides, sheets and paragraphs; that a saved Office file still has every part of the original (unknown parts are kept, not dropped), and that every part Chemweave does not write itself (pictures, embedded objects, fonts, custom XML) comes back byte for byte; that a saved CDXML file still has every element and attribute name ChemDraw wrote (it prints the names now written fewer times, and fails on a name that is gone, unless `CDXML_MAY_DROP` lists it with a reason); and that a second save is the same as the first. The files are only read, never copied or changed. If the folder named does not exist, the suite says so instead of failing with a file error. `CHEM_TEST_FILES`, used by `tests/cdx.test.ts`, `tests/stereo-files.test.ts` and `tests/warnings-files.test.ts`, is a different setting: a folder of ChemDraw files whose chemistry (CDX reading, stereo labels, warnings) is compared with what ChemDraw shows. One folder can serve both; only `CHEMWEAVE_CORPUS` also takes Word, PowerPoint and Excel files.

```
# PowerShell
$env:CHEMWEAVE_CORPUS="C:\Users\you\Chemweave corpus"; $env:NODE_OPTIONS="--max-old-space-size=8192"; npx vitest run tests/corpus.test.ts
# macOS and Linux
CHEMWEAVE_CORPUS=~/chemweave-corpus NODE_OPTIONS=--max-old-space-size=8192 npx vitest run tests/corpus.test.ts
```

A pull request that changes a writer, or drawing meant to match ChemDraw, says in its template whether this was run, and adds what to try to the laptop checks list.

Real drawings rarely hold the less common objects, so `tests/cdxml-sampler.ts` builds one large CDXML file that holds every object of the CDX/CDXML specification and every value its property pages list (bond orders and displays, node types, graphic, arrow, oval, orbital, bracket and symbol types, polymer brackets, tables, TLC plates, spectra, 3D query features), with assorted fonts, faces, colors and turned, tiny, huge and overlapping objects. `tests/cdxml-sampler.test.ts` checks that it covers those lists and survives open and save, and prints what a save drops. To check ChemDraw with it, write it out (`SAMPLER_OUT=<file.cdxml> npx vitest run tests/cdxml-sampler.test.ts`), open it in ChemDraw, save it again there as CDXML and as CDX into your corpus folder, and run the suite above on those copies: ChemDraw's copies then show how ChemDraw itself writes each object.

The Office samplers do the same for Word, PowerPoint and Excel: `tests/office-sampler/` builds several files per format, each covering one area (Word's character and paragraph formatting, styles and lists, tables, sections, fields and notes, objects with embedded ChemDraw objects; PowerPoint's and Excel's areas likewise), every sampled item with an id (W-CHR-07, P-SHP-12, X-NUM-03) in its text or name and a tag from the code: supported, kept (not modelled but kept through a save) or loss. `tests/office-samplers-docx.test.ts`, `-pptx` and `-xlsx` (through `tests/office-sampler/harness.ts`) check that each file is valid against the ECMA-376 schemas as built, opens and saves through the app's own Open and Save, is still valid after saving and holds together (every relationship and style it uses is there), keeps every supported and kept item, and saves the same file a second time; it prints which loss items a save drops. A check that fails today runs as an expected failure tied to its finding (the `FINDINGS` lists in `tests/office-sampler/{docx,pptx,xlsx}-samplers.ts`), so it is seen and fails once fixed; a finding on a whole-file check (the second save, the schema check) names the parts it covers, so any other difference still fails. Item ids never move: `tests/office-sampler/ids-{docx,pptx,xlsx}.json` keeps each id with its feature, and `OFFICE_SAMPLER_IDS=update` adds new ones. The schemas come from Ecma (`node scripts/fetch-ooxml-schemas.mjs`, into `.cache/`; the Checks workflow fetches them and requires them; locally the schema checks are skipped until they are fetched). To check Office with the samplers, write them out with Chemweave's saves beside them (`OFFICE_SAMPLER_OUT=<folder> npx vitest run tests/office-samplers-`), then on Windows with Office run `powershell -File scripts/office-sampler-compare.ps1 -Folder <folder>`: it opens each file in Word, PowerPoint or Excel, exports both copies to PDF and saves Office's own copy, all inside that folder, never in the repository; the script's header lists the steps after it (Chemweave's own PDFs, Office's copies through Chemweave, and the page-by-page comparison).

## Checks for the standing rules

The standing rules (R1 to R16, from the November 2026 audit) are built into these checks. Each one says which file and string is wrong; problems that were already there when the check was added are in a known list next to it, so a check fails only on a new problem and says when a known one has gone (take it off the list then; never add a new problem to a list to make a check pass).

| Rule | Check | Run it | Known problems |
|---|---|---|---|
| R1 | Real ChemDraw and Office files (local only) | see "Checking against real files" above | none |
| R2 | Open, save unchanged, compare, for every format; the Office samplers item by item, with the ECMA-376 schemas | `npx vitest run tests/open-save-compare.test.ts`; `node scripts/fetch-ooxml-schemas.mjs` once, then `npx vitest run tests/office-samplers-` | `KNOWN_DIFFERENT` in the test; `FINDINGS` in `tests/office-sampler/{docx,pptx,xlsx}-samplers.ts` (expected failures, each tied to a finding) |
| R3 | Every model field through CDXML, `.pptx`, `.docx` and `.xlsx` | `npx vitest run tests/field-round-trip.test.ts` | `CANT_CARRY` (can't be carried, with why) and `KNOWN_GAPS` in the test |
| R4 | The list below names every object kind, kind of tab and text surface; rich text survives every format | `npx vitest run tests/parity.test.ts` | `KNOWN_GAPS` in the test |
| R6 | Speed at real sizes, against the base branch and absolute budgets | on a pull request (the speed job); locally `npx vitest bench --run bench/core.bench.ts --outputJson a.json` then `node scripts/bench-gate.mjs a.json a.json`; start-up: `node scripts/startup-gate.mjs <base url> <head url>`; redraw while dragging in a big drawing: `node scripts/redraw-gate.mjs <base url> <head url>` | budgets (about 1.8 times a slower Checks machine's time, so 2.5 to 3 times on the faster ones; every measure has one): `BUDGETS` in `scripts/bench-gate.mjs`, `STARTUP_BUDGET_MS` in `bench/startup.mjs`, `REDRAW_BUDGETS` in `bench/redraw.mjs` |
| R7 | Undo for every command | `npx vitest run tests/undo-every-command.test.ts` (commands are left out only by name with a reason, the slices cover every command, CI runs the quick sweep); the quick sweep: `npm run undo-audit -- ci` (CI's build job); the full sweep: `npm run build` then `npm run undo-audit -- canvas` (or `slides`, `design`, `sheet`, `document`, `drags`, `all`), or against `npx vite`: `UNDO_AUDIT_URL=http://localhost:5173/ node scripts/undo-audit.mjs canvas` | `KNOWN_UNDO_PROBLEMS` and `NOT_UNDOABLE` in `scripts/undo-audit-lists.mjs` |
| R10 | axe on every kind of tab, menu and window in Light and Dark Gray, and on every ribbon tab and a right-click menu in Light; a keyboard-only walk; a drop-down list in a window is on top | `npm run smoke` (after a build), or against `npx vite`: `A11Y_URL=http://localhost:5173/ node scripts/a11y-check.mjs` | `scripts/a11y-known.mjs` |
| R11, R12 | The UI style guide; the wording lint | `npx vitest run tests/ui-text-lint.test.ts`, or `node scripts/lint-ui-text.mjs` (`--all` lists known problems too, `--prune` deletes the known ones that have been fixed; the test fails until they are gone). It reads every string with words in it, wherever it is in `src/` and `index.html` | `scripts/lint-ui-text-known.mjs`; `ALLOWED` in `scripts/lint-ui-text.mjs` |
| R13 | Screenshots at three sizes and two looks | `node scripts/screenshot-matrix.mjs [screens]` with `npx vite` running (see Screenshots below) | none: for people to look at |
| R5, R8, R9, R14 to R16 | The pull request template and review | — | — |

`npm run typecheck:strict` runs before any of them is merged.

## Places that must stay in step

Standing rule R4. Each line is a group of places that do the same job for different things; a change to one is made to all of them, or the pull request says why not. `tests/parity.test.ts` checks that this list names every object kind, kind of tab and text surface in the code, and that rich text comes back on every text surface from every format. Add to the list when you add a group.

- **Kinds of tab** (`Mode` in `src/workspace.ts`: `drawing`, `slides`, `design`, `sheet`, `document`, `si`). Each needs: opening and saving in `Workspace.openBytes` and `Workspace.encode` (`src/workspace.ts`); its menus and ribbons (`data-modes` in `index.html` and `modes` in `src/commands/registry.ts`); its commands (`COMMANDS`, `SHEET_COMMANDS`, `DOC_COMMANDS` in `src/main.ts`, or `run()` in `src/ui/sheet-mode.ts` and `src/ui/doc-mode.ts`); the undo audit (`scripts/undo-audit.mjs`); the smoke test (`scripts/smoke.mjs`), the accessibility check (`MODES` in `scripts/a11y-check.mjs`) and the screenshot matrix (`SCREENS` in `scripts/screenshot-matrix.mjs`).
- **Object kinds**: atoms, bonds, `Caption`, `Arrow`, and each `Shape.kind` (`line`, `rect`, `oval`, `symbol`, `bracket`, `picture`, `table`, `geo`, `ring`). Each needs: the CDXML writer and reader (`writeCdxml` in `src/io/cdxml-write.ts`, `readCdxml` in `src/io/cdxml.ts`); the PowerPoint writer and reader (`src/io/pptx-write.ts`, `src/io/pptx-read.ts`); drawing (`recordPicture` in `src/render/picture.ts`); picking, moving and sizing (`src/editor/`); copying (`copyDrawing` in `src/io/clipboard.ts`); its right-click menu; and a sample in `tests/field-round-trip.test.ts`. Word and Excel keep drawings whole, as the drawing's contents.
- **Text surfaces** (every place that holds rich text): `Caption.runs` (text on a drawing), `Shape.text` (text in a design shape), `TableCell.runs`, `TableData.title` and `TableData.notes` (tables), `Shape.holder` (a Smart Scheme box waiting for its structure), `MadeLabel.runs` (made when an atom label is drawn, never saved), a document's text (`DocText` in `src/document/`) and a spreadsheet cell's runs (`Cell.runs` in `src/sheet/workbook.ts`, which keeps subscript and superscript as `pos`: `src/sheet/rich-text.ts`). Each needs: the formatting commands (Bold, Italic, Subscript, Superscript, Formula, Font, Color), typing and editing (`src/ui/caption-editor.ts` and the modes' editors), Find and Replace, spelling, Format Painter (`src/format-painter.ts`) and every writer that saves it. Slide notes are plain text.
- **Copy and paste**: the Canvas, slides and designs (`copy`, `paste`, `pasteFrom`, `pasteChemistry`, `pasteText`, `pasteTable` in `src/main.ts`; `copyDrawing`, `copySvg`, `copyImage` in `src/io/clipboard.ts`); slides themselves (`copy-slides`, `paste-slides` in `src/main.ts`); the Document (`DocMode.paste`, and the `copyDrawing` and `readPaste` hooks in `src/ui/doc-mode.ts`); the Spreadsheet (`SheetMode.copy`, `paste`, `pasteWith` in `src/ui/sheet-mode.ts`; `src/io/table-clip.ts`). What one tab copies (a drawing as CDXML and a picture, SMILES, cells as an HTML table, plain text) pastes in every other.
- **Save paths**: the tab's own file (`Workspace.encode`); File ▸ Export (the `export-*` commands); keeping work safe and recovering it (`src/keep/`); Batch Convert (`src/io/batch-convert.ts`); workspace files (`src/io/workspace-file.ts`); printing and PDF (`src/io/pdf.ts`, `src/io/native-print.ts`). A new field reaches every one (`tests/field-round-trip.test.ts` and `tests/open-save-compare.test.ts` check the main ones).
- **Ribbon commands and the menus**: a command shown on the Canvas ribbon (`CANVAS_TABS` in `src/ui/canvas-ribbon.ts`, in a group or in a flyout's list or template pane) is also in a top menu (`index.html`, or the Insert menu built from `src/commands/registry.ts`) or a right-click menu, so Search, the keymap and people who hide the ribbon still find it; one taken off the ribbon stays in the menus. A change to the Canvas ribbon's tabs is made in step with the guide (**The Canvas ribbon** in `docs/guide/drawing.md`, **The ribbon** in `docs/guide/getting-started.md`), the UI style guide (S83, S88 to S90) and `tests/canvas-ribbon.test.ts`, which lists the tabs, groups and flyouts.
- **Right-click menus**: the Canvas, a slide and a design (the `contextmenu` handlers in `src/main.ts`); the slide list (`slideListMenu`), keyframes (`keyframeMenu`) and layouts (`layoutItemsMenu`) in `src/main.ts`; the Document (`src/ui/doc-mode.ts`); the Spreadsheet (`src/ui/sheet-mode.ts`); dashboards (`src/ui/dashboard-view.ts`). A ribbon command that acts on the picked object is in that object's right-click menu too, with the same name. The smoke test checks every right-click menu fits a laptop's window.
- **File types the desktop app opens**: `TYPES` in `src-tauri/src/file_types.rs` (Windows, and Edit ▸ Settings ▸ File Types); `fileAssociations` in `src-tauri/tauri.macos.conf.json` and `src-tauri/tauri.linux.conf.json`; the list in `src-tauri/Info.macos.plist` (it replaces the one Tauri writes, so a type's icon can be named there); and the uninstaller's `CI_FORGET_TYPE` lines in `src-tauri/windows/hooks.nsh`. A type with its own icon (only `.chemsi` so far, made by `scripts/make-file-icons.mjs`) also needs it in `OWN_ICONS` (`file_types.rs`: the app carries it and writes it out on Windows; the uninstaller in `hooks.nsh` removes it), the Mac app's `Resources` and, on Linux, a MIME type (`src-tauri/linux/chemweave-mime.xml`) with its icon in every size. `tests/file-icons.test.ts` checks these agree.

The `bench/` scripts drive the app in a headless browser to measure speed. Start `npm run build` and `npm run preview` first, then for example `node bench/perf.mjs stress`. They need Playwright's Chromium once: `npx playwright install chromium`.

## The wiki

The repository's [wiki](https://github.com/nathanohare/Chemweave/wiki) is made from the user guide in `docs/`, so write and correct the guide there, never on the wiki: each merge into `main` that changes `docs/` rebuilds the wiki (the **Wiki** workflow, `.github/workflows/wiki.yml`) and replaces edits made on it. `scripts/build-wiki.mjs` lists the wiki's pages and splits the long Canvas page into shorter ones; when you add a `##` section to `docs/guide/drawing.md`, add its heading to one of the Canvas pages there (until then it stays on the main Canvas page). `node scripts/build-wiki.mjs --check` lists any link or picture in `docs/` that leads nowhere, and the unit tests check the same.

## Where things are

| Folder | What is in it |
|---|---|
| `src/model.ts` | The drawing: atoms, bonds, text, arrows, shapes, undo and redo |
| `src/render/` | Drawing to the screen (tiles, bond and label drawing), and pictures for other programs (EMF, SVG, PNG) |
| `src/editor/` | Mouse tools and keyboard shortcuts; align, flip and rotate |
| `src/ui/` | Everything on screen around the drawing: toolboxes, ribbons, the Style panel, dialogs and windows, and each mode's own screen (`sheet-mode.ts`, `si-mode.ts` and so on) |
| `src/commands/` | The command list (`registry.ts`) that the Insert menu and Search are built from |
| `index.html` | The other menus and the Presentation, Spreadsheet, Document and Design ribbons |
| `src/ui/canvas-ribbon.ts` | The Canvas ribbon |
| `src/richtext.ts`, `src/text/` | Styled text (bold, subscripts, Greek letters), text read as chemistry, font measuring |
| `src/chem/` | Elements, labels, ring and chain geometry, templates, Clean Up Structure, molfile, formula |
| `scripts/make-templates.mjs` | Makes the template shapes (`src/chem/templates.json`) with RDKit |
| `src/io/cdxml.ts`, `cdxml-write.ts` | Reading and saving ChemDraw `.cdxml` files |
| `src/io/cdx.ts` | ChemDraw's binary CDX format (used on the clipboard), converted to and from CDXML |
| `src/io/files.ts`, `document-file.ts` | Open and Save dialogs, unsaved-changes prompts |
| `src/io/clipboard.ts`, `src-tauri/src/clipboard.rs` | Cut, copy and paste; the Windows clipboard |
| `src/ui/context-menu.ts`, `toolboxes.ts`, `palette-ui.ts`, `src/editor/frames.ts`, `src/chem/ring-fill.ts`, `src/render/fills.ts` | The right-click menu, toolboxes, your palettes, frames, ring fills, and hatched and gradient fills |
| `src/design/`, `src/ui/design-panel.ts`, `layers-panel.ts`, `template-gallery.ts` | Design mode: the shape library, the icon library (`design/icons.ts`, data made by `scripts/build-icons.mjs` from `@mdi/svg`), ready-made layouts, the Layers panel |
| `src/document/` | Document mode: the document, page layout, captions and fields, references and citations, find and replace, printing |
| `src/io/docx-write.ts`, `docx-read.ts`, `cfb.ts` | Saving and opening Word files, and the ChemDraw objects embedded in them |
| `src/deck/`, `src/io/pptx-read.ts`, `pptx-write.ts` | Presentation mode: slides, layouts, templates, animation and transitions, and PowerPoint files |
| `src/sheet/`, `src/io/xlsx-*.ts` | Spreadsheet mode: the workbook, formulas and functions, chemistry functions, charts, templates, and Excel files |
| `src/si/`, `src/ui/si-mode.ts`, `doc-si.ts` | SI Project: compounds, data, checks and the Supporting Information it builds |
| `src/kb/` | The Knowledge Base tables and their data, each value with its source |
| `src/library/` | Your own library of references and compounds, and **Find Structure in Files** |
| `src/keep/` | AutoSave, recovery of unsaved work and version history |
| `src/morph/` | Reaction animation (ported from cdxmorph, MIT) and its GIF and MP4 export |
| `src/recognise/` | Reading structures from pictures and PDFs |
| `src/ai/` | The Assistant: what a request would send, and the link to the person's own AI model |
| `src/vendor/` | Third-party code kept in the repository (OPSIN, for name to structure) |
| `src/worker/` | The RDKit chemistry engine, running in the background |
| `src-tauri/` | The desktop app shell (Tauri), its settings and icons |
| `tests/` | Unit tests |
| `bench/` | Speed measurements and checks that drive the app in a browser |


## Screenshots

The pictures in `docs/images/` are taken by `scripts/screenshots.mjs`, which drives the program in a browser and builds each scene (the scheme, the slides, the sheet, the document, the design, the ring fills, the hover tooltip, the moved toolboxes) from scratch. The animated GIFs are recorded by `scripts/animations.mjs`; both share their helpers in `scripts/shot-lib.mjs`. To take them again after the look changes, start the program (`npm run dev`), then run `node scripts/screenshots.mjs` and `node scripts/animations.mjs` (add names, such as `node scripts/animations.mjs frames spelling`, to record only some). They need Playwright (`npm install --no-save playwright` and `npx playwright install chromium`, or set `CHROMIUM` to a Chromium you already have), and the animations need `ffmpeg` on the path.

For a pull request that changes what people see (standing rule R13), `node scripts/screenshot-matrix.mjs <screen>` takes the screen at 1024 × 700, 1366 × 768 and 1920 × 1080, in Light and Dark Gray, at twice the pixels, into a folder outside the repository (`chemweave-screenshots` in the computer's temporary folder, or `--out <folder>`) with a page, `index.html`, showing them side by side. Start the program first (`npx vite`, then add `--url http://localhost:5173/` if it is on another port). `--list` names the screens: each kind of tab, the File menu, Settings, and the rare states that are easy to forget (`empty`, `floating-toolbox`, `error`, `zoomed-in`). Attach the pictures of the changed screens to the pull request. It uses the same Chromium as the other checks (set `CHROMIUM_PATH` if Playwright's own is missing).

## What stays out of the repository

Keep ChemDraw files, manuals and other reference documents out of this repository: it is public. The `.gitignore` already refuses `.cdxml`, `.cdx`, `.cds` and `.pdf` files. Test files made for the tests are built by the tests themselves.
