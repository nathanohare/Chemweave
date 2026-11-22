// The SI Project tab: a Supporting Information kept as Chem SI Assistant keeps it (a folder of
// readable files, src/si/project.ts), worked on here. On the left, the project's sections with
// their compounds; in the middle, the selected page: a compound's data, a Data section's ID
// table and fields, or a section's text. Every change is saved to the folder as it is made, so
// there is nothing to Save, and the project opens in SI Assistant as it is.
//
// Structures are drawn with the drawing tools (Edit Structure); compounds go to and come from
// the Compound Library; references come from My Library.

import { fieldLabelNodes } from './field-label';
import type { Tab } from '../workspace';
import type { Contents, Doc } from '../model';
import type { DocStyle } from '../style';
import { defaultStyles, type DocText } from '../document/document';
import { compileSi, objectLabelSets, type SiPreviewTarget } from '../si/compile-doc';
import type { DocView } from './doc-view';
import { FIT_WIDTH_ICON, statusZoom, type StatusZoom } from './status-zoom';
import { DEFAULTS as SPECTRA_DEFAULTS, captionText, headerParts, reportItems, sectionDefaults, spectrumItems, type SpectrumLayout } from '../si/spectra';
import type { LibCompound, LibraryData, LibReference } from '../library/library';
import { SiProject, SiProjectError, compoundName, compoundsOf, defaultFieldsOf, fieldKeys, fieldsOf, flagsOf, idOverride, idTableOf, valuesOf, MAX_SECTION_DEPTH, PRIVATE_DIR, TYPE_LABELS, type Json, type SiCompound, type SiScheme, type SiSection } from '../si/project';
import { displayId, patternIds, cellKey, type IdReport } from '../si/compound-ids';
import { ALL_FIELDS, NUCLEI, SPECTRUM_TYPES, fieldDef, learnedChoices, nucleusLabel, partText, CORE_FIELDS, LIBRARY_FIELDS, type FieldDef, type Part, type FieldEntry } from '../si/fields';
import { CITE, MENTION, parseMarkup, type Paragraph } from '../si/markup';
import { newId } from '../si/ids';
import { capitalizeName } from '../si/chem-names';
import { SiRichBox } from './si-rich';
import { SiTableEditor } from './si-table';
import { SiFigureEditor } from './si-figure';
import { SiPictures, PICTURE_MIME, toPng as pngOf } from './si-picture';
import { SiXrayPage } from './si-xray';
import { SiAttachmentPage } from './si-attachment';
import { SiManuscriptPage, newManuscriptState, type ManuscriptState } from './si-manuscript';
import { cachedResult, problemsOf, type Finding as MsFinding } from '../si/ms-check';
import { SiFrontPage } from './si-front';
import { SiSchemePage } from './si-scheme';
import { SiSpectraPage } from './si-spectra';
import { nextMisspelled, setSiDictionary } from './si-spell';
import { addDictionaryWord, dictionaryWords } from '../si/dictionary';
import { typingPrefs } from '../text/typing';
import { editReference } from './references-dialog';
import { blankRef, cleanRef, fetchDoi, newRefId, parseReferenceText, type Reference } from '../document/references';
import { newTable } from '../si/tables';
import type { Pasted } from '../io/clipboard';
import { ask, askChoice } from './ask';
import { allWarnings, compoundHrms, hrmsCalc, hrmsSpecies, hrmsTolerance, isDismissed, monoisotopic, outOfTolerance, parseNumber, ID_KEY, type SiWarning } from '../si/checks';
import { FOUND_FROM_KEY, HRMS_DIR, MAX_FILE_BYTES as MAX_REPORT_BYTES, PRINT_KEY, chooseMatch, foundIsFromReport, updateFound, vendorRawKind, type Match, type ReportData } from '../si/ms-reports';
import { readReportFile } from '../si/report-files';
import { adductDisplay, sameFormula, speciesLabel, ChemError, unreadableFacts, type MolFacts, type Peak } from '../si/chem';
import { ENGINE_SKIPPED } from '../chem/client';
import { addInfo } from './info-tip';
import { computeLabels, type SiLabels } from '../si/labels';
import { projectWarnings, type ProjectWarning } from '../si/project-warnings';
import { openTrash } from './si-trash';
import { compoundsUnder } from '../si/trash';
import { saveSnapshot } from '../si/snapshot';
import { journalOf } from '../si/journal';
import { lookupName, PUBCHEM_PAGE } from '../si/pubchem-name';
import { PASTE_TYPE_LABELS, guessPastedType, keptLine, pastedStem } from '../si/spectrum-paste';
import { availableColumns, buildRows, chosenColumns, fieldLabel, filterOf, isCompact, isSplit, projectScope, sectionScope, setView, statusColors, storeStatusColors, summarize, summaryText, type DashboardFacts, type Row, type Scope } from '../si/dashboard';
import { dashboardGrid, projectSummaryCard, sectionDashboard, statusColorsBody, type GridOptions } from './si-dashboard';
import { MAX_COPIES, checkCopies, copyableFields, duplicateCompound, duplicateScheme, neverCopiedFields } from '../si/duplicate';
import { popupMenu } from './popup-menu';
import { fontGroupHtml, siFontBoxes, SI_FONT_OFF, SI_FONT_REASON } from './font-group';
import { paintCanRun } from './can-run';
import { formulaStyleRange } from './si-formula';
import { allBoxes } from '../si/scheme-edit';

/** Said when a change was made on a page of before the project was read again (Undo, Reload): its objects are no longer the project's. */
const READ_AGAIN = 'The project was being read again when this change was made, so the change was not saved. Make it again.';

export interface SiModeHost {
  flash(msg: string, ms?: number): void;
  /** The status bar's text. */
  hint(text: string): void;
  /** The tab's name or marks changed. */
  changed(): void;
  /** A molfile as a drawing (null when it can't be read). */
  contentsOf(molfile: string): Contents | null;
  /** A drawing as one molfile, or why it can't be. */
  molfileOf(c: Contents): { molblock: string | null; problem?: string };
  /** A picture (SVG markup) of a molfile's structure, drawn in the house style. */
  pictureOf(molfile: string): string | null;
  /** Formula and masses. */
  analyze(molfile: string): Promise<{ formula: string; mw: number; exact: number } | null>;
  smiles(molfile: string): Promise<string | null>;
  /** Draw a structure with the drawing tools; `done` gets it (null: cancelled). */
  editStructure(contents: Contents | null, title: string, done: (c: Contents | null) => void): void;
  /** A drawing as an SVG picture and as CDXML (to draw it again); null when empty. */
  drawingFiles(d: Contents | Doc): { svg: string; cdxml: string } | null;
  /** A CDXML drawing as a drawing (null when it can't be read). */
  contentsOfCdxml(text: string): Contents | null;
  /** What is on the clipboard: from a paste event, or read (a Paste button). */
  readClipboard(e?: ClipboardEvent): Promise<Pasted>;
  /** The library (loaded): what it holds now, and a change to it. */
  library(): Promise<{ now: LibraryData; change(f: (lib: LibraryData) => LibraryData): void }>;
  /** Files chosen to add (spectra, other files). */
  pickFiles(label: string, exts: string[]): Promise<{ name: string; bytes: Uint8Array }[]>;
  /** File ▸ New ▸ SI Project: a new project, opened in its tab (null: none made; absent: can't be made here). */
  newSiProject?: (() => Promise<SiProject | null>) | null;
  /** What the checks need from structures (molfiles): formula, pieces, distinct carbons, H counts. */
  siFacts(mols: string[]): Promise<(MolFacts | null)[]>;
  /** A drawing's own size in points, in the SI drawing style. */
  sizeOf(c: Contents): { w: number; h: number } | null;
  /** The compiled SI, opened as a document named `name` (and, with `pdf`, saved as a PDF too). */
  openCompiled(doc: DocText, name: string, pdf: boolean): Promise<void>;
  /** The SI project's drawing style now (its structures in the live preview). */
  siStyle(): DocStyle;
  /** Insert ▸ Symbol's window (it types into the SI text box last typed in). */
  openSymbols(): void;
  /** Put text on the clipboard as plain text and HTML. */
  copyRich(text: string, html: string): Promise<void>;
  /** A structure's systematic name, given only when the name reads back as the same structure. */
  nameStructure(molfile: string): Promise<{ ok: true; name: string } | { ok: false; message: string }>;
  /** The Drawing Style window, for an SI project's style (Project Settings ▸ Structures); null when cancelled. */
  chooseDrawingStyle(current: DocStyle, note: string): Promise<DocStyle | null>;
  /** The documents open in Chemweave (for the manuscript check), each saved as .docx when asked. */
  openDocuments(): { name: string; bytes(): Promise<Uint8Array> }[];
}

/** An SI compound as the Canvas shows it (its card in the Analysis panel). */
export interface SiCard {
  tab: Tab;
  compoundId: string;
  project: string;
  section: string;
  id: string;
  name: string;
  filled: number;
  total: number;
  missing: string[];
  warnings: string[];
  yieldText: string;
  hrms: string;
}

/** What is kept for one open project: its structures as read, its warnings, its report files as read, its thumbnails, and its saves in order. */
interface Kept {
  mols: Map<string, string>;
  warnings: Map<string, SiWarning[]>;
  reportData: Map<string, Promise<ReportData>>;
  reportMatches: Map<string, Match | null>;
  /** Its structures are being read. */
  loading: boolean;
  /** Small pictures of attached files by path, and the object URLs made for them. */
  thumbs: Map<string, Promise<string | null>>;
  urls: string[];
  /** Its changes, one after another (never rejected). */
  queue: Promise<void>;
  /** Its figure, table and scheme labels as last worked out (null: not yet), for mentions of ones that are gone. */
  labels: SiLabels | null;
  /** The warnings about the project as a whole (duplicate labels, broken mentions in section texts…), as last worked out. */
  projectWarnings: ProjectWarning[];
  /** Something other than one compound's values changed since they were worked out; they are being worked out; asked for again meanwhile. */
  stale: boolean;
  busy: boolean;
  timer: number;
}

type Pick = { kind: 'project' } | { kind: 'section'; id: string } | { kind: 'compound'; id: string } | { kind: 'scheme'; id: string } | { kind: 'spectra'; id: string; section: string } | { kind: 'references' } | { kind: 'manuscript' } | { kind: 'warnings' } | { kind: 'dashboard' };

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

/** A small icon (the same line drawings as the mockups). */
const ICON: Record<string, string> = {
  section: '<path d="M3 6.5h7l2 2h9v11H3z"/>',
  flask: '<path d="M9 2.5h6M10 2.5v6l-5.5 10a1.5 1.5 0 0 0 1.3 2.2h12.4a1.5 1.5 0 0 0 1.3-2.2L14 8.5v-6"/><path d="M7 15h10"/>',
  page: '<path d="M6 2.5h8l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-17a1 1 0 0 1 1-1z"/><path d="M14 2.5v4h4"/>',
  scheme: '<polygon points="5,8 8,9.7 8,13.3 5,15 2,13.3 2,9.7"/><path d="M10 11.5h5M13.5 10l1.5 1.5-1.5 1.5"/><polygon points="19,8 22,9.7 22,13.3 19,15 16,13.3 16,9.7"/>',
  spectrum: '<path d="M2.5 20.5h19"/><path d="M4 20V18M7 20v-9M8.5 20v-6M12 20v-14M13.5 20v-4M17 20v-8M19 20v-3"/>',
  xray: '<ellipse cx="7" cy="8" rx="3" ry="2"/><ellipse cx="17" cy="9" rx="2.6" ry="3.2"/><ellipse cx="11" cy="17" rx="3.2" ry="2.2"/><path d="M9.6 9.2 10.6 14.8M14.5 9.2 7.8 7.8M15.6 11.6 13.2 15.6"/>',
  grid: '<rect x="3.5" y="4" width="17" height="16" rx="1.5"/><path d="M3.5 9h17M3.5 14.5h17M9.5 4v16"/>',
  refs: '<path d="M5 4h11a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2z"/><path d="M5 18a2 2 0 0 1 2-2h11"/>',
  check: '<path d="M4 12.5l5 5 11-11"/>',
  warn: '<path d="M12 3 22 20H2z"/><path d="M12 9.5v5M12 17.2v.3"/>',
  flag: '<path d="M5 21V3.5M5 4h11l-2 4 2 4H5"/>',
  open: '<circle cx="12" cy="12" r="5"/>',
  chev: '<path d="M8 10l4 4 4-4"/>',
  si: '<path d="M6.5 2.75h8l4.5 4.5v12.5a1.5 1.5 0 0 1-1.5 1.5h-11a1.5 1.5 0 0 1-1.5-1.5v-15.5a1.5 1.5 0 0 1 1.5-1.5z"/><text x="12" y="17.2" font-size="7.2" font-weight="700" text-anchor="middle" stroke="none" fill="currentColor">SI</text>',
};
const svg = (k: string, s = 14): string => `<svg class="si-ic" viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg>`;

/** The ribbon: what each button does is its data-si command. */
const RIBBON = `
  <div class="rb-tabs" role="tablist">
    <button role="tab" data-si-tab="home" aria-selected="true">Home</button>
    <button role="tab" data-si-tab="insert" aria-selected="false">Insert</button>
    <button role="tab" data-si-tab="table" aria-selected="false" class="rb-context" hidden title="Shown while you are in a table">Table Layout</button>
    <button role="tab" data-si-tab="figure" aria-selected="false" class="rb-context" hidden title="Shown while a figure is selected">Picture Format</button>
    <button role="tab" data-si-tab="xray" aria-selected="false" class="rb-context" hidden title="Shown on an X-ray structure's page">Crystal Structure</button>
    <button role="tab" data-si-tab="attach" aria-selected="false" class="rb-context" hidden title="Shown on an Attachment section's page">Attachment</button>
    <button role="tab" data-si-tab="refs" aria-selected="false" class="rb-context" hidden title="Shown on the References page">References</button>
    <button role="tab" data-si-tab="ms" aria-selected="false" class="rb-context" hidden title="Shown on the Manuscript Check page">Manuscript Check</button>
    <button role="tab" data-si-tab="dash" aria-selected="false" class="rb-context" hidden title="Shown on the Dashboard and on a Data section's page">Dashboard</button>
    <button role="tab" data-si-tab="scheme" aria-selected="false" class="rb-context" hidden title="Shown on a scheme page">Scheme</button>
    <button role="tab" data-si-tab="spectrum" aria-selected="false" class="rb-context" hidden title="Shown on a compound's spectra page">Spectrum</button>
  </div>
  <div class="rb-panel" data-si-panel="insert" hidden>
    <div class="rb-group"><div class="rb-row">
      <button class="rb-big" data-si="import-si" data-ic="get-data" title="Import SI: read a Supporting Information (Word or PDF) and import its general procedures, compounds, sections, figures, tables and references, after checking them in a review window. One step of Undo"><span class="rb-icon">⇩</span>Import SI…</button>
    </div><div class="rb-label">Import</div></div>
    <div class="rb-group"><div class="rb-row">
      <button class="rb-big" data-si="new-table" data-ic="table" title="Add a table at the end of the Custom section's text (3 × 3, the first row its header); type its caption in the text"><span class="rb-icon">▦</span>Table</button>
    </div><div class="rb-label">Tables</div></div>
    <div class="rb-group"><div class="rb-row">
      <button class="rb-big" data-si="new-figure" data-ic="picture" title="A figure from a picture file (PNG, JPG, SVG or PDF), at the end of the Custom section's text; type its caption in the text"><span class="rb-icon">▣</span>Picture</button>
      <button class="rb-big" data-si="new-figure-draw" data-ic="structure" title="A figure drawn with the drawing tools (a structure or scheme you can draw again), at the end of the Custom section's text"><span class="rb-icon">⌬</span>Draw Structure</button>
      <div class="rb-col">
        <button data-si="new-figure-paste" title="A figure from the copied picture or drawing (ChemDraw or Chemweave drawings stay vector pictures you can draw again)">Paste Picture</button>
        <button data-si="new-figure-compound" title="A figure of a compound's structure, its caption mentioning the compound">Compound…</button>
      </div>
    </div><div class="rb-label">Figures</div></div>
    <div class="rb-group"><div class="rb-row">
      <button class="rb-big" data-si="new-scheme" data-ic="smart-scheme" title="A new scheme page in the selected Data section (after the selected compound): starting materials, steps with their conditions, and products that can be compounds with IDs and data pages"><span class="rb-icon">⇶</span>Scheme Page</button>
      <div class="rb-col">
        <button data-si="to-scheme" title="Change the selected compound to a reaction scheme: a scheme page takes its place, with the compound (its data and ID kept) as the product of its first step">Change to Reaction Scheme…</button>
        <button data-si="out-of-scheme" title="Move the selected compound off its scheme page, to right after the scheme page; the box that showed it keeps a copy of its structure">Move Out of Scheme</button>
        <button data-si="into-scheme" title="Move the selected compound into a scheme page (listed after the compounds its boxes show; mark a box as it in the scheme to show it there)">Move Into Scheme…</button>
      </div>
    </div><div class="rb-label">Schemes</div></div>
    <div class="rb-group"><div class="rb-row">
      <button class="rb-big" data-si="add-spectra" data-ic="chart-line" title="Add spectra (PDFs or pictures) to the selected compound"><span class="rb-icon">⩘</span>Spectra</button>
      <div class="rb-col">
        <button data-si="paste-spectrum" data-ic="paste" title="Paste a spectrum copied in Mnova (or a copied picture or PDF) onto the selected compound; one click chooses its type. Ctrl+V on the compound's Spectra field does the same">Paste Spectrum</button>
        <button data-si="add-nmr-report" title="Another NMR peak report on the selected compound (another nucleus, or another solvent)">NMR Report</button>
        <button data-si="add-hrms-report" title="Add the mass spectrometer's report files (PDF, CSV/TXT or Excel peak list, mzML, mzXML, MGF, JCAMP-DX, netCDF, a picture) to the selected compound: the found m/z is read from them">HRMS Report…</button>
      </div>
      <div class="rb-col">
        <button data-si="add-files" data-ic="insert-object" title="Add other files (PDFs or pictures) to the selected compound">Files…</button>
        <button data-si="add-stored" title="Store files with the selected compound (raw NMR data, .mnova files, HRMS spectra, photos…), kept in its private folder and never printed">Stored Files…</button>
      </div>
      <div class="rb-col">
        <button data-si="add-field" title="Add a field (melting point, Rf, IR, optical rotation…, or a custom one) to the selected compound, or to the selected section's list of fields">Field…</button>
        <button data-si="new-gp" title="A new general procedure in the selected Data section (or the selected compound's): its text prints once at the start of the section, and its compounds get its sentence">General Procedure</button>
      </div>
    </div><div class="rb-label">Compound Data</div></div>
    <div class="rb-group"><div class="rb-row">
      <div class="rb-col">
        <button data-si="add-author" title="Add an author to the cover page (on the project's page)">Author</button>
        <button data-si="add-affiliation" title="Add an affiliation to the cover page, with the next free letter">Affiliation</button>
      </div>
    </div><div class="rb-label">Cover Page</div></div>
    <div class="rb-group"><div class="rb-row">
      <button class="rb-big" data-si="symbol" data-ic="symbol" title="Type a symbol (°, Å, ±, Greek letters, arrows…) where you are typing"><span class="rb-icon">Ω</span>Symbol</button>
    </div><div class="rb-label">Symbols</div></div>
  </div>
  <div class="rb-panel" data-si-panel="table" hidden>
    <div class="rb-group"><div class="rb-row">
      <div class="rb-col">
        <button data-si-tbl="row-above" title="A new row above the selected cells">Insert Above</button>
        <button data-si-tbl="row-below" title="A new row below the selected cells">Insert Below</button>
      </div>
      <div class="rb-col">
        <button data-si-tbl="col-left" title="A new column to the left of the selected cells">Insert Left</button>
        <button data-si-tbl="col-right" title="A new column to the right of the selected cells">Insert Right</button>
      </div>
      <div class="rb-col">
        <button data-si-tbl="del-rows" data-ic="delete" title="Delete the selected rows">Delete Rows</button>
        <button data-si-tbl="del-cols" title="Delete the selected columns">Delete Columns</button>
      </div>
      <div class="rb-col">
        <button data-si-tbl="del-table" title="Delete the table and its caption (it goes to the project's Trash)">Delete Table</button>
      </div>
    </div><div class="rb-label">Rows and Columns</div></div>
    <div class="rb-group"><div class="rb-row">
      <div class="rb-col">
        <button data-si-tbl="merge" title="Merge Cells: join the selected cells (Shift+click selects a block) into one; their texts are joined and the first picture kept">Merge Cells</button>
        <button data-si-tbl="split" title="Split a merged cell back into single cells">Split Cells</button>
      </div>
      <div class="rb-col">
        <label class="rb-field" title="How many rows at the top are the header (a rule under them; repeated on a new page)">Header Rows <input type="number" class="rb-num" data-si-field="head" min="0" max="9" /></label>
      </div>
    </div><div class="rb-label">Merge</div></div>
    <div class="rb-group"><div class="rb-row">
      <div class="rb-col">
        <button data-si-tbl="align-left" data-ic="align-left" title="Align the selected cells' text left (a whole column: the column)">Left</button>
        <button data-si-tbl="align-center" data-ic="align-hcenter" title="Center the selected cells' text (a whole column: the column)">Center</button>
        <button data-si-tbl="align-right" data-ic="align-right" title="Align the selected cells' text right (a whole column: the column)">Right</button>
      </div>
    </div><div class="rb-label">Alignment</div></div>
    <div class="rb-group"><div class="rb-row">
      <button class="rb-big" data-si-tbl="picture" data-ic="picture" title="Put a picture file (PNG, JPG, SVG or PDF) in the selected cell, above its text"><span class="rb-icon">▣</span>Picture</button>
      <button class="rb-big" data-si-tbl="draw-structure" data-ic="structure" title="Draw a structure or scheme for the selected cell with the drawing tools (a picture made here is drawn again)"><span class="rb-icon">⌬</span>Draw Structure</button>
      <div class="rb-col">
        <button data-si-tbl="paste-picture" title="Paste the copied picture or drawing (ChemDraw or Chemweave, kept as a vector picture you can draw again) into the selected cell">Paste Picture</button>
        <button data-si-tbl="compound" title="Put a compound's structure in the selected cell, with its ID under it">Compound…</button>
        <button data-si-tbl="remove-picture" title="Take the picture out of the selected cell (its file stays in images/)">Remove Picture</button>
      </div>
      <div class="rb-col">
        <label class="rb-field" title="The picture's printed width (empty: its own size, never wider than the text)">Width <input type="number" class="rb-num" data-si-field="width" min="0" step="0.1" placeholder="own" /> cm</label>
      </div>
    </div><div class="rb-label">Cell Picture</div></div>
  </div>
  <div class="rb-panel" data-si-panel="figure" hidden>
    <div class="rb-group"><div class="rb-row">
      <button class="rb-big" data-si-fig="picture" data-ic="picture" title="Change Picture: a picture file (PNG, JPG, SVG or PDF) in place of the figure's"><span class="rb-icon">▣</span>Change Picture</button>
      <button class="rb-big" data-si-fig="draw-structure" data-ic="structure" title="Draw the figure with the drawing tools (a picture made here is drawn again; double-click the figure does the same)"><span class="rb-icon">⌬</span>Draw Structure</button>
      <div class="rb-col">
        <button data-si-fig="paste-picture" title="The copied picture or drawing in place of the figure's">Paste Picture</button>
        <button data-si-fig="compound" title="A compound's structure in place of the figure's">Compound…</button>
      </div>
    </div><div class="rb-label">Picture</div></div>
    <div class="rb-group"><div class="rb-row">
      <div class="rb-col">
        <label class="rb-field" title="The figure's printed width (empty: its own size, never wider than the text)">Width <input type="number" class="rb-num" data-si-field="fig-width" min="0" step="0.1" placeholder="own" /> cm</label>
      </div>
    </div><div class="rb-label">Size</div></div>
    <div class="rb-group"><div class="rb-row">
      <button class="rb-big" data-si-fig="remove-figure" data-ic="delete" title="Take the figure and its caption out of the text (its picture stays in images/)"><span class="rb-icon">✕</span>Delete Figure</button>
    </div><div class="rb-label">Figure</div></div>
  </div>
  <div class="rb-panel" data-si-panel="attach" hidden>
    <div class="rb-group"><div class="rb-row">
      <button class="rb-big" data-si-attach="choose" data-ic="insert-object" title="Choose File: the PDF or picture printed as this section (a copy is kept in the project folder; the one it replaces goes to the Trash). A file can also be dropped on the preview"><span class="rb-icon">▤</span>Choose File</button>
      <button class="rb-big" data-si-attach="remove" data-ic="delete" title="Remove File: the file goes to the project's Trash (Home ▸ Trash puts it back)"><span class="rb-icon">✕</span>Remove File</button>
    </div><div class="rb-label">File</div></div>
  </div>
  <div class="rb-panel" data-si-panel="xray" hidden>
    <div class="rb-group"><div class="rb-row">
      <button class="rb-big" data-si-xray="choose-cif" data-ic="insert-object" title="Choose CIF: the structure's CIF file (a copy is kept in the project folder; the one it replaces goes to the Trash)"><span class="rb-icon">▤</span>Choose CIF</button>
      <button class="rb-big" data-si-xray="edit" data-ic="structure" title="Edit Structure: turn it, change its style (ORTEP, ball-and-stick…), its labels and what is shown, in the crystal structure window (double-click the structure does the same)"><span class="rb-icon">⌬</span>Edit Structure</button>
    </div><div class="rb-label">Structure</div></div>
    <div class="rb-group"><div class="rb-row">
      <div class="rb-col">
        <button data-si-xray="copy-svg" title="Copy As SVG: the structure as a vector picture, to paste into another program">Copy As SVG</button>
        <button data-si-xray="copy-picture" title="Copy As Picture: a metafile and bitmap on Windows (Word and PowerPoint keep it sharp), a PNG elsewhere">Copy As Picture</button>
        <button data-si-xray="save-picture" title="Save the structure as an SVG or PNG picture">Save as Picture…</button>
      </div>
      <div class="rb-col">
        <button data-si-xray="copy-table" title="Copy the crystal data table as it prints, to paste into Word, Excel or a document">Copy Table</button>
      </div>
    </div><div class="rb-label">Copy and Save</div></div>
  </div>
  <div class="rb-panel" data-si-panel="refs" hidden>
    <div class="rb-group"><div class="rb-row">
      <button class="rb-big" data-si="ref-doi" data-ic="insert-citation" title="Add by DOI: filled in from Crossref (needs the internet); one already on the list is not added twice"><span class="rb-icon">＋</span>Add by DOI</button>
      <div class="rb-col">
        <button data-si="ref-new" title="Add a reference typed in by hand">Add Reference…</button>
        <button data-si="ref-import" title="Add the references of a BibTeX (.bib) or RIS (.ris) file, or a text file of them">Import File…</button>
        <button data-si="cite-library" title="Add references from My Library">From My Library…</button>
      </div>
    </div><div class="rb-label">Add</div></div>
    <div class="rb-group"><div class="rb-row">
      <div class="rb-col">
        <button data-si="ref-edit" title="Edit the selected reference (double-click it does the same): every value can be changed">Edit Reference…</button>
        <button data-si="ref-delete" data-ic="delete" title="Take the selected reference off the list; its citations stay in the text with a warning">Delete Reference</button>
      </div>
    </div><div class="rb-label">Reference</div></div>
  </div>
  <div class="rb-panel" data-si-panel="ms" hidden>
    <div class="rb-group"><div class="rb-row">
      <button class="rb-big" data-si-ms="ms-add" data-ic="file-open" title="Add the manuscript (PDF or Word .docx) and its ChemDraw files (.cdxml) to the project’s manuscript folder; they are never printed"><span class="rb-icon">＋</span>Add Files…</button>
      <div class="rb-col">
        <button data-si-ms="ms-add-doc" title="Add a document open in Chemweave, saved into the manuscript folder as a Word file as it is now">Add Open Document…</button>
        <button data-si-ms="ms-remove" data-ic="delete" title="Move the selected file to the project Trash (Home ▸ Trash, or Undo, puts it back)">Remove File</button>
      </div>
    </div><div class="rb-label">Files</div></div>
    <div class="rb-group"><div class="rb-row">
      <button class="rb-big" data-si-ms="ms-check" data-ic="refresh" title="Read the files again and compare them with the SI"><span class="rb-icon">⟳</span>Check Again</button>
      <div class="rb-col">
        <label class="rb-field" title="Which results the list shows">Show <select data-si-ms="ms-filter">
          <option value="problems">Problems Only</option><option value="notes">Problems and Notes</option><option value="all">All Results</option>
        </select></label>
        <button data-si-ms="ms-dismissed" aria-pressed="false" title="Also list the results you dismissed (select one and click Restore to bring it back)">Show Dismissed</button>
      </div>
    </div><div class="rb-label">Check</div></div>
    <div class="rb-group"><div class="rb-row">
      <div class="rb-col">
        <button data-si-ms="ms-open" title="Open the compound of the selected result at the field concerned (double-click a result does the same)">Open Compound</button>
        <button data-si-ms="ms-dismiss" title="Hide the selected result, with a reason: it comes back if the values it is about change">Dismiss…</button>
        <button data-si-ms="ms-restore" title="Bring back the selected dismissed result">Restore</button>
      </div>
    </div><div class="rb-label">Result</div></div>
  </div>
  <div class="rb-panel" data-si-panel="dash" hidden>
    <div class="rb-group"><div class="rb-row">
      <button class="rb-big" data-si-dash="columns" title="Choose the fields shown as columns (NMR and spectra count as one each)"><span class="rb-icon">▥</span>Columns…</button>
      <div class="rb-col">
        <label class="rb-field" title="Which compounds the dashboard shows">Show <select data-si-dash="filter">
          <option value="all">All Compounds</option><option value="incomplete">Incomplete Only</option><option value="flagged">Flagged Only</option><option value="warnings">With Warnings Only</option>
        </select></label>
        <button data-si-dash="split" aria-pressed="false" title="One NMR column per nucleus and one spectrum column per type, rather than one column each">Split by Nucleus</button>
        <button data-si-dash="compact" aria-pressed="false" title="Icons only, without the structures or the short summaries: more compounds fit">Compact</button>
      </div>
    </div><div class="rb-label">View</div></div>
    <div class="rb-group"><div class="rb-row">
      <div class="rb-col">
        <button data-si-dash="colors" title="The color of each kind of cell (filled, missing, flagged, a warning…), for this project">Status Colors…</button>
        <button data-si-dash="refresh" title="Calculate every compound's state and warnings again">Refresh</button>
      </div>
    </div><div class="rb-label">Dashboard</div></div>
  </div>
  <div class="rb-panel" data-si-panel="spectrum" hidden>
    <div class="rb-group"><div class="rb-row">
      <div class="rb-col">
        <button data-si-spectrum="up" data-ic="move-up" title="Print the selected spectrum file before the one before it">Move Up</button>
        <button data-si-spectrum="down" data-ic="move-down" title="Print the selected spectrum file after the one after it">Move Down</button>
        <button data-si-spectrum="auto" title="Print this compound's spectra in the usual order again (¹H, ¹³C, ¹⁹F, other nuclei, 2D NMR, HPLC/SFC, IR, other)">Automatic Order</button>
      </div>
    </div><div class="rb-label">Order</div></div>
    <div class="rb-group"><div class="rb-row">
      <div class="rb-col">
        <button data-si-spectrum="scope-page" aria-pressed="true" title="The settings below change only this page of the PDF">This Page</button>
        <button data-si-spectrum="scope-file" aria-pressed="false" title="The settings below change every page of the PDF (a page's own settings still win)">Every Page of the File</button>
      </div>
      <div class="rb-col">
        <button data-si-spectrum="reset" data-ic="undo" title="Every setting of this spectrum follows the Spectra section's again (a dragged box stays where it is)">Use Section Settings</button>
        <button data-si-spectrum="reset-place" title="The structure box back in its corner, and the ID and caption back under the structure">Reset Box Position</button>
        <button data-si-spectrum="section" title="The Spectra section's page: how every spectrum is printed unless it says otherwise">Spectra Section…</button>
      </div>
    </div><div class="rb-label">Settings</div></div>
  </div>
  <div class="rb-panel" data-si-panel="scheme" hidden>
    <div class="rb-group"><div class="rb-row">
      <button class="rb-big" data-si-scheme="draw" data-ic="structure" title="Draw the selected box's structure with the drawing tools (double-click a box does the same)"><span class="rb-icon">⌬</span>Draw Structure</button>
      <div class="rb-col">
        <button data-si-scheme="paste" data-ic="paste" title="The copied structure (from ChemDraw or Chemweave) in the selected box">Paste Structure</button>
      </div>
    </div><div class="rb-label">Structure</div></div>
    <div class="rb-group"><div class="rb-row">
      <div class="rb-col">
        <button data-si-scheme="add-start" title="A new starting material (after the selected one)">Add Starting Material</button>
        <button data-si-scheme="add-product" title="A new product of the selected step (after the selected one)">Add Product</button>
        <button data-si-scheme="add-step" title="A new step (an arrow with its conditions and a product) after the selected one">Add Step</button>
      </div>
      <div class="rb-col">
        <button data-si-scheme="move-left" title="Move the selected box left">Move Left</button>
        <button data-si-scheme="move-right" title="Move the selected box right">Move Right</button>
        <button data-si-scheme="step-left" title="Move the selected step (its arrow, conditions and products) before the step before it">Move Step Left</button>
      </div>
      <div class="rb-col">
        <button data-si-scheme="remove" data-ic="delete" title="Take the selected box out of the scheme (its structure goes to the Trash)">Remove</button>
        <button data-si-scheme="remove-step" title="Take the selected step out of the scheme: its arrow, conditions and products">Remove Step</button>
        <button data-si-scheme="step-right" title="Move the selected step after the step after it">Move Step Right</button>
      </div>
    </div><div class="rb-label">Boxes and Steps</div></div>
    <div class="rb-group"><div class="rb-row">
      <button class="rb-big" data-si-scheme="mark-compound" data-ic="si-compound" title="Mark as Compound: the selected box gets a compound page (an ID from the ID table, and data) showing its structure"><span class="rb-icon">◈</span>Mark as Compound</button>
      <div class="rb-col">
        <button data-si-scheme="show-compound" data-ic="link" title="The selected box shows one of this scheme page's compounds">Show Compound…</button>
        <button data-si-scheme="open-compound" title="Open the compound page the selected box shows">Open Compound</button>
        <button data-si-scheme="unlink" title="The selected box stops showing its compound (the compound page stays; the box keeps a copy of the structure)">Unlink</button>
      </div>
    </div><div class="rb-label">Compound</div></div>
    <div class="rb-group"><div class="rb-row">
      <button class="rb-big" data-si-scheme="insert-structure" data-ic="structure" title="Draw a structure to put in the conditions you are typing in (or the selected step's conditions above the arrow); it prints at the Layout's size for structures in the conditions"><span class="rb-icon">⌬</span>Insert Structure</button>
      <div class="rb-col rb-tight">
        <div class="rb-row">
          <button class="rb-icon-btn" data-si-scheme="align" data-arg="left" data-ic="align-left" title="Align the selected conditions left" aria-label="Align Left">⇤</button>
          <button class="rb-icon-btn" data-si-scheme="align" data-arg="center" data-ic="align-hcenter" title="Center the selected conditions" aria-label="Center">↔</button>
          <button class="rb-icon-btn" data-si-scheme="align" data-arg="right" data-ic="align-right" title="Align the selected conditions right" aria-label="Align Right">⇥</button>
        </div>
        <button data-si-scheme="align" data-arg="" title="The selected conditions follow the scheme's Layout">As in Layout</button>
      </div>
    </div><div class="rb-label">Conditions</div></div>
    <div class="rb-group"><div class="rb-row">
      <button class="rb-big" data-si-scheme="layout" data-ic="layout" title="The scheme's layout: text size, arrows, structures in the conditions (70 % to start), IDs and yields, size and fit; for this scheme or every scheme of the project"><span class="rb-icon">▤</span>Layout…</button>
    </div><div class="rb-label">Layout</div></div>
  </div>
  <div class="rb-panel" data-si-panel="home">
    <div class="rb-group"><div class="rb-row">
      <button class="rb-big" data-si="new-compound" data-ic="compound" title="A new compound page in the selected Data section, after the selected compound (Ctrl+Shift+N)"><span class="rb-icon">⬡</span>New Compound</button>
      <button class="rb-big" data-si="new-section" data-ic="section" title="A new section: a Data section holds compounds; a Custom section holds text (and sub-sections); an Attachment section a PDF or picture; an X-ray structure a crystal structure from its CIF"><span class="rb-icon">▤</span>New Section</button>
      <div class="rb-col">
        <button data-si="delete" data-ic="delete" title="Move the selected compound, scheme page or section to the project's Trash (Delete key in the tree); Trash puts it back">Delete</button>
        <button data-si="trash" title="The project's Trash: put deleted sections, compounds, scheme pages and files back, or empty it. Shared with Chem SI Assistant">Trash…</button>
      </div>
      <div class="rb-col">
        <button data-si="rename" title="Rename the selected section or scheme page (F2 in the tree)">Rename</button>
        <button data-si="duplicate" title="Copies of the selected compound or scheme page, with the fields you choose (never its spectra, files, manual ID or flags): to start analogs">Duplicate…</button>
      </div>
      <div class="rb-col">
        <button data-si="move-up" title="Move the selected compound or section up (Alt+↑): compound IDs follow the order. Rows can also be dragged in the tree">▲ Move Up</button>
        <button data-si="move-down" title="Move the selected compound or section down (Alt+↓)">▼ Move Down</button>
        <button data-si="move-to" title="Move the selected compound to another Data section or into or out of a scheme page, or the selected section into or out of a Custom section">Move To…</button>
      </div>
    </div><div class="rb-label">Project</div></div>
    ${fontGroupHtml('si')}
    <div class="rb-group"><div class="rb-row">
      <button class="rb-big" data-si="id-table" data-ic="compound-number" title="The ID table of the selected Data section: compound IDs follow the compounds' order"><span class="rb-icon">#</span>ID Table</button>
      <div class="rb-col">
        <button data-si="fill-pattern" title="Fill the ID table from a pattern: 3a, 3b, 3c… or S1, S2, S3…">Fill from Pattern…</button>
        <button data-si="pages-for-ids" title="A blank compound page for each ID in the table that has none yet">Add Pages for IDs</button>
        <button data-si="manual-id" title="Give the selected compound an ID of its own (it still uses up its row of the table)">Manual ID…</button>
      </div>
    </div><div class="rb-label">Compound IDs</div></div>
    <div class="rb-group"><div class="rb-row">
      <button class="rb-big" data-si="edit-structure" data-ic="structure" title="Draw or change the compound's structure with the drawing tools"><span class="rb-icon">⌬</span>Edit Structure</button>
      <div class="rb-col">
        <button data-si="paste-structure" data-ic="paste" title="The structure copied in ChemDraw or Chemweave (or a molfile) as the compound's structure. Ctrl+V on the structure picture does the same">Paste Structure</button>
        <button data-si="cite-library" data-ic="insert-citation" title="Cite references from My Library in the compound's References field (they join the project's references)">Cite from My Library…</button>
      </div>
      <div class="rb-col">
        <button data-si="from-library" title="A new compound page with a compound from your Compound Library (its structure and name)">From Compound Library…</button>
        <button data-si="to-library" title="Keep the structures of this section's compounds in your Compound Library, with their SI IDs and this project as where they appear">Add to Compound Library</button>
      </div>
      <div class="rb-col">
        <button data-si="name-pubchem" title="Name from PubChem: look the selected compound up in PubChem (by its InChIKey, which is all that is sent, and only when you click) and fill in its IUPAC name, which stays editable. Needs the internet; finds only compounds already in PubChem">Name from PubChem</button>
        <button data-si="structure-to-name" title="Structure to Name: the IUPAC name of the selected compound (or of every compound of the selected Data section that has no name), generated offline. Given only when the name converts back to the same structure; the namer (about 14 MB) downloads on first use">Structure to Name</button>
      </div>
    </div><div class="rb-label">Library</div></div>
    <div class="rb-group"><div class="rb-row">
      <button class="rb-big" data-si="warnings" data-ic="check-structure" title="Every automatic warning in the project (HRMS, NMR, yields, spectra, IDs), by compound: dismiss or restore them"><span class="rb-icon">⚠</span>Warnings</button>
      <button class="rb-big" data-si="spelling" data-ic="spelling" title="Spelling (F7): go to the next misspelled word on this page, with its corrections. Chemistry words, abbreviations (MeOH, CDCl3) and systematic names count as spelled right; right-click an underlined word for the same menu"><span class="rb-icon">✓</span>Spelling</button>
    </div><div class="rb-label">Checks</div></div>
    <div class="rb-group"><div class="rb-row">
      <button class="rb-big" data-si="compile-doc" data-ic="cover-page" title="Make the Supporting Information as a document you can edit: cover, contents, sections, procedures and compound data, laid out as Chem SI Assistant lays it out. The project itself is not changed."><span class="rb-icon">▤</span>Compile to Document</button>
      <button class="rb-big" data-si="compile-pdf" data-ic="export-pdf" title="Compile the Supporting Information and save it as a PDF (it also opens as a document)"><span class="rb-icon">⎙</span>Compile to PDF</button>
      <button class="rb-big" data-si="live-preview" data-ic="print-preview" aria-pressed="true" title="Live Preview (Ctrl+Shift+L): the selected page as it prints, beside it, updated about a second after each change. Spectra are left out (Compile shows them), and page numbers are placeholders"><span class="rb-icon">◧</span>Live Preview</button>
    </div><div class="rb-label">Compile</div></div>
    <div class="rb-group"><div class="rb-row">
      <div class="rb-col">
        <button data-si="apply-fields" title="Give every compound of the section the section's fields, in the section's order">Apply Section Fields</button>
        <button data-si="reload" data-ic="refresh-all" title="Read the project folder again (after changes made in Chem SI Assistant or by a sync)">Reload Project</button>
      </div>
      <div class="rb-col">
        <button data-si="project-settings" title="The project's title and journal style, and the HRMS tolerance">Project Settings…</button>
        <button data-si="snapshot" title="Save Snapshot: the whole project zipped into its snapshots folder, for milestones such as the submitted version (as Chem SI Assistant saves them)">Save Snapshot…</button>
      </div>

    </div><div class="rb-label">Manage</div></div>
  </div>`;

/** Short names for a spectrum's or file's values in its row (their full names are in the tooltip). */
const ATT_SHORT: Record<string, string> = { title: 'Header', struct_caption: 'Caption', label: 'Label' };

/** The extensions a pasted picture, or the original kept beside it, can have. */
const PASTED_EXTS = ['svg', 'png', 'jpg', 'jpeg', 'emf', 'cdxml', 'pdf'];

/** The files offered by Insert ▸ HRMS Report (any file can still be dragged in). */
const REPORT_EXTS = ['pdf', 'csv', 'tsv', 'txt', 'tab', 'asc', 'xy', 'dat', 'prn', 'xlsx', 'mzml', 'mzxml', 'mzdata', 'xml', 'mgf', 'jdx', 'dx', 'jcamp', 'jcm', 'cdf', 'nc', 'png', 'jpg', 'jpeg', 'tif', 'tiff', 'bmp', 'gif', 'svg'];

export class SiMode {
  private pane: HTMLDivElement;
  private ribbon: HTMLDivElement;
  private tree: HTMLDivElement;
  private page: HTMLDivElement;
  private tab: Tab | null = null;
  private report: IdReport | null = null;
  private boxes: SiRichBox[] = [];
  /** Tables', figures' and schemes' labels ("Table S1"), as the compiled SI numbers them. */
  private objLabels = new Map<string, string>();
  /** The numbered label each table and figure gets without a typed one (its Label box's placeholder). */
  private objAutoLabels = new Map<string, string>();
  private labelsRead = false;
  private tables: SiTableEditor[] = [];
  private figures: SiFigureEditor[] = [];
  private shownKey = '';
  private analyzed = new Map<string, { formula: string; mw: number; exact: number } | null>();
  /** What is kept for each project open (two projects in two tabs never share any of it). */
  private keptOf = new WeakMap<SiProject, Kept>();
  private kept(p: SiProject): Kept {
    let k = this.keptOf.get(p);
    if (!k) {
      k = { mols: new Map(), warnings: new Map(), reportData: new Map(), reportMatches: new Map(), loading: false, thumbs: new Map(), urls: [], queue: Promise.resolve(), labels: null, projectWarnings: [], stale: true, busy: false, timer: 0 };
      this.keptOf.set(p, k);
    }
    return k;
  }
  /** The project shown: `mols`, `warnings`, `reportData` and `reportMatches` are its own. */
  private use(p: SiProject): void {
    const k = this.kept(p);
    this.mols = k.mols;
    this.warnings = k.warnings;
    this.reportData = k.reportData;
    this.reportMatches = k.reportMatches;
  }
  /** Compounds' structures as last read (compound id → molfile) of the project shown, and what the checks read from each molfile. */
  private mols = new Map<string, string>();
  private facts = new Map<string, MolFacts | null>();
  /** Every warning of each compound of the project shown (dismissed too), as last worked out. */
  private warnings = new Map<string, SiWarning[]>();
  /** What saves the plain inputs of the page shown, when one holds text not saved yet. */
  private flushers: (() => void)[] = [];
  /** Counts the pages drawn (what a page reads later is dropped when another page has been drawn since). */
  private drawn = 0;
  /** Redraws the compound page's header (ID, name, how complete) in place. */
  private headPaint: (() => void) | null = null;
  /** Dismissed warnings are listed too (with Restore). */
  private showDismissed = false;

  constructor(private host: SiModeHost) {
    const work = document.querySelector('#work')!;
    this.pane = el('div');
    this.pane.id = 'si-pane';
    this.pane.className = 'si-only';
    this.pane.hidden = true;
    this.tree = el('div', 'si-tree');
    this.tree.setAttribute('role', 'tree');
    this.tree.setAttribute('aria-label', 'Sections and compounds');
    this.page = el('div', 'si-page');
    this.live = this.livePane();
    this.pane.append(this.tree, this.page, this.live.el);
    work.append(this.pane);
    this.ribbon = el('div', 'ribbon tabbed si-ribbon si-only');
    this.ribbon.id = 'si-ribbon';
    this.ribbon.setAttribute('role', 'toolbar');
    this.ribbon.setAttribute('aria-label', 'SI Project');
    this.ribbon.hidden = true;
    this.ribbon.innerHTML = RIBBON;
    // the shared Font group (G5-26, R13): what SI text cannot hold is greyed with the reason
    paintCanRun(this.ribbon.querySelectorAll<HTMLButtonElement>('.rb-font-group button[data-si-fmt]'), 'siFmt', (c) => (SI_FONT_OFF.includes(c) ? SI_FONT_REASON : null));
    siFontBoxes(this.ribbon, defaultStyles().Normal);
    // Bold, Italic… show whether the text being typed has them
    document.addEventListener('selectionchange', () => {
      if (this.ribbon.hidden || !this.typing || document.activeElement !== this.typing) return;
      for (const b of this.ribbon.querySelectorAll<HTMLButtonElement>('.rb-font-group button[data-si-fmt]')) {
        const c = b.dataset.siFmt!;
        if (['bold', 'italic', 'underline', 'subscript', 'superscript'].includes(c)) b.setAttribute('aria-pressed', String(document.queryCommandState(c)));
      }
    });
    this.ribbon.querySelector('[data-si="live-preview"]')?.setAttribute('aria-pressed', String(this.liveOn));
    const docRibbon = document.querySelector('#doc-ribbon');
    if (docRibbon) docRibbon.after(this.ribbon); else document.body.prepend(this.ribbon);
    // (the ribbon's buttons leave the typing where it is: formatting and table commands act there)
    this.ribbon.addEventListener('mousedown', (e) => { if ((e.target as HTMLElement).closest('[data-si-fmt], [data-si-tbl], [data-si="symbol"], [data-si="spelling"], [data-si-scheme="align"], [data-si-scheme="insert-structure"]')) e.preventDefault(); });
    this.ribbon.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const tab = t.closest<HTMLElement>('[data-si-tab]');
      if (tab) { this.showRibbonTab(tab.dataset.siTab!); return; }
      const fmt = t.closest<HTMLElement>('[data-si-fmt]');
      if (fmt) { this.format(fmt.dataset.siFmt!); return; }
      if (t.closest('[data-si-font]')) { this.projectSettings('output'); return; }
      const tbl = t.closest<HTMLElement>('[data-si-tbl]');
      if (tbl) { void this.activeTable?.command(tbl.dataset.siTbl!); return; }
      const sp = t.closest<HTMLElement>('[data-si-spectrum]');
      if (sp) { void this.spectraPage?.command(sp.dataset.siSpectrum!); return; }
      const sc = t.closest<HTMLElement>('[data-si-scheme]');
      if (sc) { void this.schemePage?.command(sc.dataset.siScheme!, sc.dataset.arg ?? ''); return; }
      const xr = t.closest<HTMLElement>('[data-si-xray]');
      if (xr) { void this.xrayPage?.command(xr.dataset.siXray!); return; }
      const at = t.closest<HTMLElement>('[data-si-attach]');
      if (at) { if (this.project?.readOnly) { this.host.flash('This SI project is open read-only.'); return; } void (at.dataset.siAttach === 'choose' ? this.attachPage?.choose() : this.attachPage?.remove()); return; }
      const ms = t.closest<HTMLElement>('button[data-si-ms]');
      if (ms) { void this.msCommand(ms.dataset.siMs!); return; }
      const da = t.closest<HTMLElement>('button[data-si-dash]');
      if (da) { void this.dashCommand(da.dataset.siDash!); return; }
      const fig = t.closest<HTMLElement>('[data-si-fig]');
      if (fig) { void this.activeFigure?.command(fig.dataset.siFig!); return; }
      const b = t.closest<HTMLElement>('[data-si]');
      if (b) void this.run(b.dataset.si!);
    });
    this.ribbon.addEventListener('change', (e) => {
      const mf = (e.target as HTMLElement).closest<HTMLSelectElement>('select[data-si-ms]');
      if (mf) { void this.msCommand(mf.dataset.siMs!, mf.value); return; }
      const ds = (e.target as HTMLElement).closest<HTMLSelectElement>('select[data-si-dash]');
      if (ds) { void this.dashCommand(ds.dataset.siDash!, ds.value); return; }
      const f = (e.target as HTMLElement).closest<HTMLInputElement>('[data-si-field]');
      if (f?.dataset.siField === 'fig-width') { void this.activeFigure?.setWidth(Number(f.value)); return; }
      const t = this.activeTable;
      if (!f || !t) return;
      if (f.dataset.siField === 'head') void t.setHeaderRows(Number(f.value));
      else void t.setPictureWidth(Number(f.value));
    });
    // the Table Layout tab shows while a table's cell is being typed in; the last box typed in takes symbols and formatting
    this.pane.addEventListener('focusin', (e) => {
      const target = e.target as HTMLElement;
      const box = target.closest<HTMLElement>('.si-rich');
      if (box) this.typing = box;
      const card = target.closest<HTMLElement>('.si-table-card');
      const t = card ? this.tables.find((x) => x.el === card) ?? null : null;
      if (t) this.tableChosen(t);
      else if (!target.closest('.si-table-card')) this.tableChosen(null);
      const fcard = target.closest<HTMLElement>('.si-figure-card');
      this.figureChosen(fcard ? this.figures.find((x) => x.el === fcard) ?? null : null);
    });
    document.addEventListener('selectionchange', () => {
      const sel = getSelection();
      if (sel?.rangeCount && this.typing?.contains(sel.anchorNode)) this.typingAt = sel.getRangeAt(0).cloneRange();
    });
    this.pane.addEventListener('keydown', (e) => this.key(e));
  }

  get project(): SiProject | null { return this.tab?.si ?? null; }

  /** The table whose cell was last picked (the Table Layout tab acts on it). */
  private activeTable: SiTableEditor | null = null;
  /** The scheme page shown (the Scheme tab acts on it). */
  private schemePage: SiSchemePage | null = null;
  private spectraPage: SiSpectraPage | null = null;
  /** The X-ray structure page shown (the Crystal Structure tab acts on it). */
  private xrayPage: SiXrayPage | null = null;
  /** The figure last picked (the Picture Format tab acts on it). */
  private activeFigure: SiFigureEditor | null = null;
  /** The SI text box last typed in, and where in it. */
  private typing: HTMLElement | null = null;
  private typingAt: Range | null = null;

  private showRibbonTab(name: string): void {
    for (const b of this.ribbon.querySelectorAll<HTMLElement>('[data-si-tab]')) b.setAttribute('aria-selected', String(b.dataset.siTab === name));
    for (const p of this.ribbon.querySelectorAll<HTMLElement>('[data-si-panel]')) p.hidden = p.dataset.siPanel !== name;
  }

  /** A table's cell picked (or none): the Table Layout tab shows (or goes), with that table's state. */
  private tableChosen(t: SiTableEditor | null): void {
    const tab = this.ribbon.querySelector<HTMLElement>('[data-si-tab="table"]')!;
    if (t === this.activeTable && !tab.hidden === !!t) { if (t) this.tableState(t); return; }
    this.activeTable = t;
    tab.hidden = !t;
    if (!t && tab.getAttribute('aria-selected') === 'true') this.showRibbonTab('home');
    if (t) this.tableState(t);
  }

  /** An X-ray structure's page shown (or none): the Crystal Structure tab shows (or goes). */
  /** A scheme page shown (or none): the Scheme tab shows (or goes), its commands greyed out when they don't apply to what is picked. */
  private schemeShown(x: SiSchemePage | null): void {
    const tab = this.ribbon.querySelector<HTMLElement>('[data-si-tab="scheme"]')!;
    this.schemePage = x;
    tab.hidden = !x;
    if (!x) { if (tab.getAttribute('aria-selected') === 'true') this.showRibbonTab('home'); return; }
    const st = x.state;
    const off: Record<string, boolean> = {
      draw: !st.box, paste: !st.box, 'move-left': !st.canLeft, 'move-right': !st.canRight, remove: !st.box,
      'remove-step': !st.step, 'step-left': !st.stepLeft, 'step-right': !st.stepRight, 'mark-compound': !st.box || st.linked,
      'show-compound': !st.box || st.linked, 'open-compound': !st.linked, unlink: !st.linked,
    };
    for (const b of this.ribbon.querySelectorAll<HTMLButtonElement>('[data-si-scheme]')) {
      b.disabled = !!off[b.dataset.siScheme!];
      if (b.dataset.siScheme === 'align') b.setAttribute('aria-pressed', String(b.dataset.arg === st.align && !!x.picked && x.picked.kind === 'step'));
    }
  }

  /** A compound's spectra page shown (or none): the Spectrum tab shows (or goes), its commands greyed out when they don't apply. */
  private spectraShown(x: SiSpectraPage | null): void {
    const tab = this.ribbon.querySelector<HTMLElement>('[data-si-tab="spectrum"]')!;
    this.spectraPage = x;
    tab.hidden = !x;
    if (!x) { if (tab.getAttribute('aria-selected') === 'true') this.showRibbonTab('home'); return; }
    const st = x.state;
    const ro = !!this.project?.readOnly;
    const off: Record<string, boolean> = { up: !st.up || ro, down: !st.down || ro, auto: !st.manual || ro, 'scope-page': !st.several, 'scope-file': !st.several, reset: !st.own || ro, 'reset-place': !st.moved || ro };
    for (const b of this.ribbon.querySelectorAll<HTMLButtonElement>('[data-si-spectrum]')) {
      const c = b.dataset.siSpectrum!;
      b.disabled = !!off[c];
      if (c === 'scope-page' || c === 'scope-file') b.setAttribute('aria-pressed', String((c === 'scope-file') === (st.scope === 'file')));
    }
  }

  private spectraCompoundPage(out: HTMLElement, c: SiCompound, sectionId: string): void {
    const p = this.project!;
    let section: SiSection | null = null;
    try { section = p.section(sectionId); } catch { /* gone: the defaults */ }
    const page = new SiSpectraPage({
      project: p, compound: c, section,
      flash: (m, ms) => this.host.flash(m, ms),
      idOf: (x) => this.idOf(x),
      contentsOf: (m) => this.host.contentsOf(m),
      sizeOf: (x) => this.host.sizeOf(x),
      pictureOf: (m) => this.host.pictureOf(m),
      pdfPages: (b) => import('../render/pdf-page').then((m) => m.pdfPages(b)),
      contentBox: (src) => import('../render/pdf-page').then((m) => m.pictureContentBox(src)),
      act: (f) => this.act(f, false),
      chosen: (x) => { if (x === this.spectraPage) this.spectraShown(x); },
      openSection: () => this.go({ kind: 'section', id: sectionId }),
    });
    out.append(page.el);
    this.spectraShown(page);
  }

  private schemeCard(out: HTMLElement, k: SiScheme): void {
    const p = this.project!;
    const page = new SiSchemePage({
      project: p,
      scheme: k,
      flash: (m, ms) => this.host.flash(m, ms),
      label: this.label,
      mentionable: this.mentionable,
      contentsOf: (m) => this.host.contentsOf(m),
      molfileOf: (c) => this.host.molfileOf(c),
      pictureOf: (m) => this.host.pictureOf(m),
      drawingSvg: (c) => this.host.drawingFiles(c)?.svg ?? null,
      editStructure: (c, t, done) => this.host.editStructure(c, t, done),
      readClipboard: () => this.host.readClipboard(),
      idOf: (c) => this.idOf(c),
      chosen: (x) => { if (x === this.schemePage) this.schemeShown(x); },
      // (a scheme page's action as one named step of Undo, after the saves on their way)
      step: (label, f) => this.change(p, label, f),
      redraw: () => { for (const c of k.children) this.forgetStructure(c); this.shownKey = ''; this.refresh(); },
      openCompound: (id) => this.go({ kind: 'compound', id }),
    });
    out.append(page.el);
    this.schemeShown(page);
  }

  /** The Manuscript Check page shown (its ribbon tab acts on it), and what it keeps per project. */
  private msPage: SiManuscriptPage | null = null;
  private lastPageKind = '';
  private msStates = new WeakMap<SiProject, ManuscriptState>();
  private msState(p: SiProject): ManuscriptState {
    let st = this.msStates.get(p);
    if (!st) { st = newManuscriptState(); this.msStates.set(p, st); }
    return st;
  }
  private msShown(x: SiManuscriptPage | null): void {
    const tab = this.ribbon.querySelector<HTMLElement>('[data-si-tab="ms"]')!;
    this.msPage = x;
    tab.hidden = !x;
    if (!x && tab.getAttribute('aria-selected') === 'true') this.showRibbonTab('home');
    if (!x || !this.project) return;
    const st = this.msState(this.project);
    this.ribbon.querySelector<HTMLSelectElement>('select[data-si-ms="ms-filter"]')!.value = st.filter;
    this.ribbon.querySelector<HTMLElement>('[data-si-ms="ms-dismissed"]')!.setAttribute('aria-pressed', String(st.showDismissed));
  }
  private async msCommand(cmd: string, value = ''): Promise<void> {
    if (!this.msPage) return;
    await this.msPage.command(cmd, value);
    if (cmd === 'ms-dismissed' && this.project) this.ribbon.querySelector<HTMLElement>('[data-si-ms="ms-dismissed"]')!.setAttribute('aria-pressed', String(this.msState(this.project).showDismissed));
  }
  /** The last manuscript check's result, worked out once from what was read last time (for the tree's count and the Warnings page). */
  private msWarming = new WeakSet<SiProject>();
  private msWarm(p: SiProject): void {
    const st = this.msState(p);
    if (st.result || this.msWarming.has(p)) return;
    this.msWarming.add(p);
    void cachedResult(p, { facts: (m) => this.host.siFacts(m) }).then((r) => {
      if (!r || st.result) return;
      st.result = r;
      if (this.project === p) this.renderTree();
    });
  }

  private attachPage: SiAttachmentPage | null = null;
  private attachShown(x: SiAttachmentPage | null): void {
    const tab = this.ribbon.querySelector<HTMLElement>('[data-si-tab="attach"]')!;
    this.attachPage?.dispose();
    this.attachPage = x;
    tab.hidden = !x;
    if (!x && tab.getAttribute('aria-selected') === 'true') this.showRibbonTab('home');
  }

  private xrayShown(x: SiXrayPage | null): void {
    const tab = this.ribbon.querySelector<HTMLElement>('[data-si-tab="xray"]')!;
    this.xrayPage = x;
    tab.hidden = !x;
    if (!x && tab.getAttribute('aria-selected') === 'true') this.showRibbonTab('home');
  }

  /** A figure picked (or none): the Picture Format tab shows (or goes), with that figure's width. */
  private figureChosen(f: SiFigureEditor | null): void {
    const tab = this.ribbon.querySelector<HTMLElement>('[data-si-tab="figure"]')!;
    this.activeFigure = f;
    tab.hidden = !f;
    if (!f && tab.getAttribute('aria-selected') === 'true') this.showRibbonTab('home');
    if (!f) return;
    const w = this.ribbon.querySelector<HTMLInputElement>('[data-si-field="fig-width"]')!;
    const st = f.state;
    w.value = st.width ? String(st.width) : '';
  }

  private tableState(t: SiTableEditor): void {
    if (t !== this.activeTable) return;
    const st = t.state;
    const head = this.ribbon.querySelector<HTMLInputElement>('[data-si-field="head"]')!;
    head.value = String(st.headRows);
    head.max = String(st.rows);
    const w = this.ribbon.querySelector<HTMLInputElement>('[data-si-field="width"]')!;
    w.value = st.width ? String(st.width) : '';
    w.disabled = st.width === null;
    for (const b of this.ribbon.querySelectorAll<HTMLButtonElement>('[data-si-tbl="remove-picture"]')) b.disabled = st.width === null;
  }

  /** Bold, italic, underline, subscript or superscript on the text being typed (the ribbon's Font buttons). */
  private format(cmd: string): void {
    if (SI_FONT_OFF.includes(cmd)) { this.host.flash(SI_FONT_REASON, 6000); return; }
    if (!this.restoreTyping()) { this.host.flash('Click in a text box first (a procedure, a report, a section’s text or a table’s cell).'); return; }
    if (cmd === 'clear') { document.execCommand('removeFormat'); return; }
    if (cmd === 'formula') { this.formulaStyle(); return; }
    document.execCommand(cmd);
  }

  /** Formula style on the selected text: numbers lowered (CH₂Cl₂), charges raised (PF₆⁻), as the other modes do. */
  private formulaStyle(): void {
    const sel = getSelection();
    if (!sel?.rangeCount || sel.isCollapsed) { this.host.flash('Select the formula first (CH2Cl2, PF6-), then Formula style.'); return; }
    // (a mention, citation or structure in the selection is left as it is: plain text only)
    if (sel.getRangeAt(0).cloneContents().querySelector(':not(b, i, u, sub, sup, strong, em, span:not([class]), br)')) {
      this.host.flash('Select plain text only: Formula style leaves compound mentions and citations as they are.');
      return;
    }
    // only the numbers and charges are wrapped, where they are: bold, italic and underline round them stay (F5b-R04)
    const copy = document.createElement('div');
    copy.append(sel.getRangeAt(0).cloneContents());
    const all = document.createRange();
    all.selectNodeContents(copy);
    if (!formulaStyleRange(all)) { this.host.flash('Nothing to change: the selection has no numbers or charges to lower or raise.'); return; }
    // (put back as typing is, so Ctrl+Z takes it back)
    document.execCommand('insertHTML', false, copy.innerHTML);
  }

  /** Put the typing back where it was in the last SI text box (false when there is none). */
  private restoreTyping(): boolean {
    const box = this.typing;
    if (!box?.isConnected) return false;
    if (document.activeElement !== box) box.focus();
    const r = this.typingAt;
    if (r && box.contains(r.startContainer)) { const sel = getSelection()!; sel.removeAllRanges(); sel.addRange(r); }
    return true;
  }

  /** Type text (a symbol) where the person was typing; false when no SI text box was being typed in. */
  insertText(text: string): boolean {
    if (!this.restoreTyping()) { this.host.flash('Click in a text box first, then choose the symbol.'); return false; }
    document.execCommand('insertText', false, text);
    return true;
  }

  private get pick(): Pick {
    const st = this.tab?.sheetState as { pick?: Pick } | null;
    return st?.pick ?? { kind: 'project' };
  }
  private set pick(p: Pick) {
    if (this.tab) this.tab.sheetState = { pick: p };
  }

  /** Show this tab's project (null: another kind of tab shows). */
  show(tab: Tab | null): void {
    // (what was being typed in the tab left is saved to its own project, in the background)
    if (this.tab && this.tab !== tab) void this.commitAll();
    this.tab = tab && tab.si ? tab : null;
    this.pane.hidden = this.ribbon.hidden = !this.tab;
    this.showZoom(!!this.tab);
    if (!this.tab) return;
    this.use(this.tab.si!);
    this.shownKey = '';
    this.refresh();
    void this.loadDictionary();
  }

  private dictFor: SiProject | null = null;
  /** The project's dictionary.txt, for the spelling and formatting checks (read again after a change, or Undo). */
  private async loadDictionary(again = false): Promise<void> {
    const p = this.project;
    if (!p) { setSiDictionary(null); return; }
    if (!again && this.dictFor === p) return;
    this.dictFor = p;
    const words = await dictionaryWords(p.folder);
    if (this.project !== p) return;
    setSiDictionary({
      words,
      readOnly: p.readOnly,
      add: async (word) => {
        let added = false;
        await this.act(async () => { added = await addDictionaryWord(p.folder, word); }, false);
        return added;
      },
    });
  }

  /**
   * Save what is being typed (text boxes, plain inputs, table cells). The promise is done when
   * every change of the project shown has been written to its folder.
   */
  commitAll(): Promise<void> {
    const p = this.project;
    for (const f of this.flushers) f();
    for (const b of [...this.boxes, ...(this.xrayPage?.boxes ?? []), ...(this.front?.boxes ?? []), ...(this.schemePage?.boxes ?? [])]) b.commit();
    const others: Promise<unknown>[] = [...this.tables.map((t) => t.commit()), ...this.figures.map((f) => f.settled())];
    if (this.front) others.push(this.front.settled());
    if (!p) return Promise.all(others).then(() => {}, () => {});
    // (the editors' own saves join the project's queue, so they are waited for after the page has gone too)
    const k = this.kept(p);
    k.queue = Promise.all([k.queue, ...others]).then(() => {}, () => {});
    return k.queue;
  }

  /** Done when every change made to a project so far is in its folder (the project shown: what is being typed too). */
  saved(p: SiProject | null = this.project): Promise<void> {
    if (!p) return Promise.resolve();
    return p === this.project ? this.commitAll() : this.kept(p).queue;
  }

  /** A project's tab closed: what was kept for it goes. */
  closed(p: SiProject): void {
    const k = this.keptOf.get(p);
    if (!k) return;
    for (const u of k.urls) URL.revokeObjectURL(u);
    clearTimeout(k.timer);
    this.keptOf.delete(p);
  }

  /** The pick, when what it picked is gone (deleted, or taken back by Undo): the project's page. */
  private keepPick(): void {
    const p = this.project!;
    const pick = this.pick;
    const there = pick.kind === 'compound' ? p.compounds.some((c) => c.id === pick.id)
      : pick.kind === 'section' ? p.sections.some((s) => s.id === pick.id)
      : pick.kind === 'scheme' ? p.schemes.some((k) => k.id === pick.id)
      : pick.kind === 'spectra' ? p.compounds.some((c) => c.id === pick.id)
      : true;
    if (!there) this.pick = { kind: 'project' };
  }

  /** Everything again: the tree, the page, the status bar (`only`: a change to this compound's values alone). */
  refresh(only?: SiCompound): void {
    const p = this.project;
    if (!p) return;
    this.keepPick();
    this.report = p.idReport();
    this.check(only);
    this.renderTree();
    const key = JSON.stringify(this.pick);
    if (key !== this.shownKey) { this.shownKey = key; this.renderPage(); this.liveSoon(150); } else { this.relabel(); this.liveSoon(); }
    this.paintWarnings();
    this.status();
    this.projectChecksSoon(p);
  }

  /**
   * The labels and the project's own warnings are worked out again when something other than one
   * compound's values changed (never on a field's keystrokes): at once when the Warnings page or
   * the Dashboard shows, else once changes have stopped for a moment.
   */
  private projectChecksSoon(p: SiProject): void {
    const k = this.kept(p);
    if (!k.stale || k.busy) return;
    clearTimeout(k.timer);
    const shown = this.pick.kind === 'warnings' || this.pick.kind === 'dashboard';
    k.timer = window.setTimeout(() => void this.projectChecks(p), shown || !k.labels ? 0 : 1500);
  }

  /** Work out a project's labels and its own warnings (from its folder, after the saves on their way), then show them. */
  private async projectChecks(p: SiProject): Promise<void> {
    const k = this.keptOf.get(p);
    if (!k || k.busy) return;
    k.busy = true;
    k.stale = false;
    try {
      await this.pendingOf(p);
      const labels = await computeLabels(p, {}, p.idReport());
      const list = await projectWarnings(p, labels);
      if (this.keptOf.get(p) !== k) return;
      const sig = (l: SiLabels | null): string => (l ? JSON.stringify(l.items.map((i) => [i.kind, i.id, i.label])) : '');
      const labelsChanged = sig(labels) !== sig(k.labels);
      const changed = labelsChanged || JSON.stringify(list) !== JSON.stringify(k.projectWarnings);
      k.labels = labels;
      k.projectWarnings = list;
      if (!changed || this.project !== p) return;
      // (a figure, table or scheme came or went: the compounds that mention one are checked again)
      if (labelsChanged) this.check();
      this.renderTree();
      this.paintWarnings();
      this.status();
      this.dashRedraw?.();
      if (this.pick.kind === 'warnings') { this.shownKey = JSON.stringify(this.pick); this.renderPage(); }
    } catch (e) {
      console.warn('SI project warnings could not be calculated', e);
    } finally {
      k.busy = false;
      if (k.stale && this.project === p) this.projectChecksSoon(p);
    }
  }

  /** The project's own warnings as last worked out. */
  private get projectWarningsNow(): ProjectWarning[] { return this.project ? this.kept(this.project).projectWarnings : []; }

  /** The status bar's line again (the window sets its own when a tab comes to the front). */
  showStatus(): void { this.status(); }

  // ---------------------------------------------------------------- checks

  /** Work out every compound's warnings again (those whose structure is still being read keep the ones they had). */
  private check(only?: SiCompound): void {
    const p = this.project!;
    let waiting = false;
    const seen = new Set<string>();
    // (a compound's own values changed: the others' warnings stand, once every compound has been checked)
    const one = !!only && p.compounds.includes(only) && p.compounds.every((c) => this.warnings.has(c.id));
    for (const c of one ? [only!] : p.compounds) {
      seen.add(c.id);
      let facts: MolFacts | null = null;
      if (p.hasStructure(c)) {
        const mol = this.mols.get(c.id);
        if (mol === undefined || !this.facts.has(mol)) { waiting = true; continue; }
        facts = this.facts.get(mol) ?? null;
      }
      try { this.warnings.set(c.id, allWarnings(p, c, this.report!, facts, this.reportMatches.get(c.id) ?? null, this.kept(p).labels)); } catch (e) { console.warn('SI checks failed for', c.id, e); this.warnings.set(c.id, []); }
    }
    if (!one) for (const id of [...this.warnings.keys()]) if (!seen.has(id)) this.warnings.delete(id);
    if (waiting) void this.loadFacts();
  }

  /** Read the structures not read yet, and what the checks need from them (off the main thread), then check again. */
  private async loadFacts(): Promise<void> {
    const p = this.project;
    if (!p) return;
    const k = this.kept(p);
    // (each project reads its own: one being read in another tab doesn't hold this one up)
    if (k.loading) return;
    k.loading = true;
    try {
      await this.readFacts(p);
    } catch (e) {
      console.warn('SI structures could not be read', e);
    } finally {
      k.loading = false;
    }
    if (this.project === p) { this.refresh(); this.dashRedraw?.(); }
  }

  /** Read a project's structures not read yet, and what the checks need from them. */
  private async readFacts(p: SiProject): Promise<void> {
    const mols = this.kept(p).mols;
    for (const c of [...p.compounds]) {
      if (!p.hasStructure(c) || mols.has(c.id)) continue;
      // (one that can't be read is checked as having none, and the others are still read)
      mols.set(c.id, await p.readStructure(c).catch((e) => { console.warn('SI structure not read', c.id, e); return ''; }));
    }
    const todo = [...new Set([...mols.values()].filter((m) => !this.facts.has(m)))];
    if (!todo.length) return;
    await this.fetchFacts(todo);
  }

  /**
   * Ask the engine for structures' facts and keep them. When it can't answer (it is restarting, it
   * failed to load, or one structure broke it) each structure is asked on its own, so one bad
   * structure doesn't take the others' checks with it; a structure still without an answer is
   * checked with that said where its formula would show, and is asked again once the engine is
   * ready (engineReady). A failure is never kept as if it were the structure's facts.
   */
  private async fetchFacts(todo: string[]): Promise<void> {
    const got = await this.host.siFacts(todo).catch(() => null);
    if (got) { todo.forEach((m, i) => this.facts.set(m, got[i] ?? null)); return; }
    for (const m of todo) {
      const one = await this.host.siFacts([m]).then((r) => r[0] ?? null, (e: unknown) => e instanceof Error ? e : new Error(String(e)));
      if (one instanceof Error && one.message === ENGINE_SKIPPED) {
        // (a structure that broke the engine is left out for the session: not asked again)
        this.facts.set(m, unreadableFacts(`No formula or masses: ${one.message}`));
      } else if (one instanceof Error) {
        this.facts.set(m, unreadableFacts(`No formula or masses for now: ${one.message.replace(/\.?$/, '.')} The checks that need the structure are run again once the chemistry engine is ready.`));
        this.factsFailed.add(m);
      } else this.facts.set(m, one);
    }
  }
  /** Structures whose facts the engine couldn't give: asked again when it is ready. */
  private factsFailed = new Set<string>();

  /**
   * The chemistry engine is ready (at start-up, or after a restart): what it couldn't answer
   * before is asked again, and the open project checked again.
   */
  engineReady(): void {
    for (const m of this.factsFailed) this.facts.delete(m);
    const had = this.factsFailed.size > 0;
    this.factsFailed.clear();
    // (nothing failed, as at an ordinary start-up: no redraw, which could take the focus from a field)
    if (!this.project || !had) return;
    this.warnings.clear();
    this.shownKey = '';
    this.refresh();
  }

  // ---------------------------------------------------------------- for the Canvas (layout C)

  /** The compounds of these SI projects whose structure is each SMILES (RDKit's), as the Canvas's SI card and right-click menu want them. */
  async compoundsFor(tabs: Tab[], smiles: string[]): Promise<Map<string, SiCard[]>> {
    const out = new Map<string, SiCard[]>();
    const want = new Set(smiles.filter(Boolean));
    for (const t of tabs) {
      const p = t.si;
      if (!p) continue;
      await this.readFacts(p);
      let report: IdReport | null = null;
      for (const c of p.compounds) {
        const f = this.factsOf(c, p);
        const smi = f?.info?.smiles;
        if (!smi || !want.has(smi)) continue;
        report ??= p.idReport();
        out.set(smi, [...(out.get(smi) ?? []), this.card(t, c, report, f)]);
      }
    }
    return out;
  }

  /** What the Canvas's SI card says about a compound. */
  private card(tab: Tab, c: SiCompound, report: IdReport, facts: MolFacts | null): SiCard {
    const p = tab.si!;
    const k = p.completion(c);
    let warnings: SiWarning[] = [];
    try { warnings = allWarnings(p, c, report, facts, this.kept(p).reportMatches.get(c.id) ?? null, this.kept(p).labels).filter((w) => !isDismissed(c, w)); } catch { /* (shown as none) */ }
    const v = valuesOf(c);
    const part = (key: string, sub: string): string => { const x = v[key]; return x && typeof x === 'object' && !Array.isArray(x) ? partText((x as Json)[sub]).trim() : ''; };
    const pct = part('yield', 'percent'), mass = part('yield', 'mass'), unit = part('yield', 'mass_unit');
    const yieldText = [pct ? `${pct}%` : '', mass ? `(${mass} ${unit || 'mg'})` : ''].filter(Boolean).join(' ');
    const state = part('physical_state', 'text');
    let hrms = '';
    const [r] = (() => { try { return compoundHrms(p, c, facts); } catch { return [null, '']; } })();
    if (r) {
      const mono = monoisotopic(r);
      hrms = `${adductDisplay(partText((v.hrms as Json | undefined)?.adduct) || '[M+H]+')} ${mono.mz.toFixed(4)}${r.ppm !== null ? ` (${r.ppm >= 0 ? '+' : '−'}${Math.abs(r.ppm).toFixed(1)} ppm)` : ''}`;
    }
    return {
      tab, compoundId: c.id, project: p.title, section: (() => { try { return p.section(c.sectionId).name; } catch { return ''; } })(),
      id: displayId(report, c.id), name: compoundName(c), filled: k.filled, total: k.total, missing: k.missing,
      warnings: warnings.map((w) => w.message), yieldText: [yieldText, state].filter(Boolean).join(' · '), hrms,
    };
  }

  /** The Data sections of an SI tab's project, with the compound each ID would land on (for "as 2b"). */
  dataSectionsOf(tab: Tab): { id: string; name: string; ids: Map<string, string> }[] {
    const p = tab.si;
    if (!p) return [];
    const report = p.idReport();
    return p.dataSections.map((s) => ({ id: s.id, name: s.name, ids: new Map(compoundsOf(s).map((c) => [displayId(report, c.id), c.id])) }));
  }

  /** A structure drawn on a Canvas, as a new compound page at the end of a Data section (null: it couldn't be saved). */
  async addFromCanvas(tab: Tab, sectionId: string, molfile: string): Promise<{ id: string; label: string } | null> {
    const p = tab.si;
    if (!p) return null;
    try {
      await this.saved(p);
      const j = journalOf(p.folder);
      const make = async (): Promise<SiCompound> => { const made = await p.addCompound(sectionId); await p.setStructure(made, molfile); return made; };
      const c = await (j ? j.step('Add from Canvas', make) : make());
      this.forgetStructure(c, p);
      if (this.tab === tab) { this.shownKey = ''; this.refresh(); }
      return { id: c.id, label: displayId(p.idReport(), c.id) };
    } catch (e) {
      this.host.flash(e instanceof SiProjectError ? e.message : `Could not add the compound: ${e instanceof Error ? e.message : String(e)}`, 8000);
      return null;
    }
  }

  /** Put a Canvas structure on an existing compound page (its structure before is replaced). */
  async replaceFromCanvas(tab: Tab, compoundId: string, molfile: string): Promise<boolean> {
    const p = tab.si;
    const c = p?.compounds.find((x) => x.id === compoundId);
    if (!p || !c) return false;
    try {
      await this.saved(p);
      const j = journalOf(p.folder);
      await (j ? j.step('Replace Structure', () => p.setStructure(c, molfile)) : p.setStructure(c, molfile));
      this.forgetStructure(c, p);
      if (this.tab === tab) { this.shownKey = ''; this.refresh(); }
      return true;
    } catch (e) {
      this.host.flash(e instanceof SiProjectError ? e.message : `Could not change the structure: ${e instanceof Error ? e.message : String(e)}`, 8000);
      return false;
    }
  }

  /** Open a compound's page when its tab next shows. */
  pickCompound(tab: Tab, compoundId: string): void {
    tab.sheetState = { pick: { kind: 'compound', id: compoundId } };
    if (this.tab === tab) this.refresh();
  }

  /** A compound's structure changed (or the folder was read again): read it again. */
  private forgetStructure(c?: SiCompound, p: SiProject | null = this.project): void {
    if (!p) return;
    const k = this.kept(p);
    k.stale = true;
    if (c) k.mols.delete(c.id); else { k.mols.clear(); k.reportData.clear(); k.reportMatches.clear(); this.forgetThumbs(p); }
  }

  private activeWarnings(c: SiCompound): SiWarning[] { return (this.warnings.get(c.id) ?? []).filter((w) => !isDismissed(c, w)); }
  private dismissedWarnings(c: SiCompound): SiWarning[] { return (this.warnings.get(c.id) ?? []).filter((w) => isDismissed(c, w)); }
  private factsOf(c: SiCompound, p: SiProject | null = this.project): MolFacts | null {
    const mol = (p ? this.kept(p).mols : this.mols).get(c.id);
    return mol === undefined ? null : this.facts.get(mol) ?? null;
  }

  /** One warning: its text, and Dismiss… (or, dismissed, why and Restore). */
  private warningLine(c: SiCompound, w: SiWarning, field = ''): HTMLElement {
    const p = this.project!;
    const dismissed = isDismissed(c, w);
    const line = el('div', `si-warn${dismissed ? ' dismissed' : ''}`);
    line.innerHTML = svg('warn', 13);
    const said = field && w.field !== ID_KEY && !w.message.toLowerCase().startsWith(field.toLowerCase());
    const text = el('span', 'si-warn-text', (said ? field + ': ' : '') + w.message);
    line.append(text);
    if (dismissed) {
      const d = ((c.data.dismissed ?? {}) as Record<string, Json>)[w.key] ?? {};
      const why = partText(d.reason).trim();
      text.title = `Dismissed${partText(d.by) ? ' by ' + partText(d.by) : ''}${partText(d.at) ? ' on ' + partText(d.at).slice(0, 10) : ''}${why ? ': ' + why : ''}`;
      if (why) line.append(el('span', 'si-warn-why', `(${why})`));
    }
    if (!p.readOnly) {
      const b = el('button', 'si-link', dismissed ? 'Restore' : 'Dismiss…');
      b.type = 'button';
      b.title = dismissed ? 'Show this warning again' : 'Hide this warning for this compound (it comes back if the data it is about changes)';
      b.addEventListener('click', async () => {
        if (dismissed) { await this.act(() => p.restoreWarning(c, w.key)); return; }
        const got = await ask('Dismiss Warning', [{ name: 'reason', label: 'Why is this OK? (optional, saved with the project)', value: '', placeholder: 'e.g. rotamers: two signals for one carbon' }], { ok: 'Dismiss', lines: [[w.message, '']] });
        if (got) await this.act(() => p.dismissWarning(c, w, got.reason));
      });
      line.append(b);
    }
    return line;
  }

  /** The warnings on the compound page shown, in place (typing in a field changes them without drawing the page again). */
  private paintWarnings(): void {
    const c = this.currentCompound();
    if (!c || this.pick.kind !== 'compound') return;
    const list = this.showDismissed ? this.warnings.get(c.id) ?? [] : this.activeWarnings(c);
    const boxes = new Map([...this.page.querySelectorAll<HTMLElement>('.si-fwarn[data-key]')].map((b) => [b.dataset.key!, b]));
    const byField = new Map<string, SiWarning[]>();
    for (const w of list) {
      const at = boxes.has(w.field) ? w.field : '';
      byField.set(at, [...(byField.get(at) ?? []), w]);
    }
    for (const [key, box] of boxes) {
      const here = byField.get(key) ?? [];
      box.replaceChildren(...here.map((w) => this.warningLine(c, w, key === '' ? this.fieldName(c, w.field) : '')));
      box.hidden = !here.length;
    }
    const n = this.dismissedWarnings(c).length;
    const chip = this.page.querySelector<HTMLButtonElement>('.si-dismissed-chip');
    if (chip) {
      chip.hidden = !n;
      chip.textContent = `${n} dismissed`;
      chip.setAttribute('aria-pressed', String(this.showDismissed));
      chip.classList.toggle('on', this.showDismissed);
    }
    const calc = this.page.querySelector<HTMLElement>('.si-calc');
    if (calc) this.paintHrms(c, calc);
  }

  /** How a field is named in a warning list ("ID" for the compound's ID). */
  private fieldName(c: SiCompound, key: string): string {
    if (key === ID_KEY) return 'ID';
    if (key === 'structure') return 'Structure';
    const e = fieldsOf(c).find((x) => x.key === key);
    const def = e ? fieldDef(e) : null;
    return (def?.label ?? key).replace(/ \(private, never printed\)$/, '');
  }

  private relabel(): void {
    for (const b of this.boxes) b.relabel();
    for (const t of this.tables) t.relabel();
    // the header's ID, name and completion count, in place (the fields being typed in stay as they are)
    this.headPaint?.();
  }

  /** Every save on its way to a project's folder (the shown page's editors' own too) has landed. */
  private pendingOf(p: SiProject): Promise<void> {
    const mine: Promise<unknown>[] = p === this.project ? [...this.tables.map((t) => t.settled()), ...this.figures.map((f) => f.settled()), ...(this.front ? [this.front.settled()] : [])] : [];
    return Promise.all([this.kept(p).queue, ...mine]).then(() => {}, () => {});
  }

  /** Number the tables, figures and schemes again (after the page is drawn), and show mentions of them with their labels. */
  private async readLabels(): Promise<void> {
    const p = this.project;
    if (!p) return;
    // (asked for while they are being read: read once more after, so a page drawn meanwhile gets them)
    if (this.labelsRead) { this.labelsAgain = true; return; }
    this.labelsRead = true;
    try {
      await this.pendingOf(p);
      const { labels: got, auto } = await objectLabelSets(p);
      if (this.project !== p) return;
      this.objLabels = got;
      this.objAutoLabels = auto;
      for (const b of this.boxes) b.relabel();
      for (const t of this.tables) { t.relabel(); t.setTitle(got.get(t.id) ?? '', auto.get(t.id) ?? ''); }
      for (const f of this.figures) f.setTitle(got.get(f.id) ?? '', auto.get(f.id) ?? '');
    } catch { /* (the kinds' names show instead) */ } finally {
      this.labelsRead = false;
      if (this.labelsAgain) { this.labelsAgain = false; void this.readLabels(); }
    }
  }
  private labelsAgain = false;

  private idOf(c: SiCompound): string { return this.report ? displayId(this.report, c.id) : 'ID?'; }

  /** How a link shows in text: a compound by its ID; citations by their numbers in the project's list. */
  private label = (ref: string): string => {
    const p = this.project;
    if (!p) return '?';
    if (ref.startsWith(MENTION)) {
      const id = ref.slice(MENTION.length);
      const c = p.compounds.find((x) => x.id === id);
      if (c) return this.idOf(c);
      // a table's, figure's or scheme's label, as the compiled SI numbers them
      const kind = OBJECT_WORDS[id.slice(0, 2)];
      if (kind) return this.objLabels.get(id) ?? kind;
      return id.startsWith('c-') ? '(deleted compound)' : id;
    }
    if (ref.startsWith(CITE)) {
      const ids = ref.slice(CITE.length).split(',');
      return '[' + ids.map((id) => { const i = p.references.findIndex((r) => r.id === id); return i >= 0 ? String(i + 1) : '?'; }).join(',') + ']';
    }
    return '▣';
  };

  private mentionable = (): { id: string; label: string; text: string }[] => {
    const p = this.project;
    if (!p) return [];
    const objects = [...this.objLabels].filter(([id]) => OBJECT_WORDS[id.slice(0, 2)]).map(([id, label]) => ({ id, label, text: OBJECT_WORDS[id.slice(0, 2)].toLowerCase() }));
    return [...p.compounds.map((c) => ({ id: c.id, label: this.idOf(c), text: compoundName(c) })), ...objects];
  };

  private status(): void {
    const p = this.project;
    if (!p) return;
    const flags = p.compounds.reduce((n, c) => n + Object.keys(flagsOf(c)).length, 0);
    const warns = p.compounds.reduce((n, c) => n + this.activeWarnings(c).length, 0) + this.projectWarningsNow.length;
    const s = this.currentSection();
    let lead = p.title;
    if (s?.type === 'data') {
      const cs = compoundsOf(s);
      const done = cs.filter((c) => { const k = p.completion(c); return k.filled === k.total; }).length;
      lead = `${s.name}: ${done} of ${cs.length} compound${cs.length === 1 ? '' : 's'} complete`;
    }
    const bits = [lead, `${flags} flag${flags === 1 ? '' : 's'}`, `${warns} warning${warns === 1 ? '' : 's'}`, p.readOnly ? 'Open read-only' : 'Every change is saved to the project folder'];
    this.host.hint(bits.join(' · '));
  }

  private currentSection(): SiSection | null {
    const p = this.project;
    if (!p) return null;
    const pick = this.pick;
    try {
      if (pick.kind === 'section') return p.section(pick.id);
      if (pick.kind === 'compound') return p.section(p.compound(pick.id).sectionId);
      if (pick.kind === 'scheme') return p.section(p.scheme(pick.id).sectionId);
      if (pick.kind === 'spectra') return p.section(pick.section);
    } catch { /* gone */ }
    return null;
  }

  private currentCompound(): SiCompound | null {
    const p = this.project, pick = this.pick;
    if (!p || pick.kind !== 'compound') return null;
    return p.compounds.find((c) => c.id === pick.id) ?? null;
  }

  private go(pick: Pick): void {
    // (a page whose editors save by themselves: a table's or figure's label, the cover, a scheme, an X-ray structure)
    if (this.project && (this.tables.length || this.figures.length || this.front || this.schemePage || this.xrayPage || this.attachPage || this.msPage)) this.kept(this.project).stale = true;
    void this.commitAll();
    this.pick = pick;
    this.refresh();
  }

  // ---------------------------------------------------------------- the tree

  private renderTree(): void {
    const p = this.project!;
    const pick = this.pick;
    const pickKey = JSON.stringify(pick);
    // what each row shows (the rows are only made again when one of them changed)
    interface RowSpec { depth: number; icon: string; text: string; sel: Pick; title?: string; cls?: string; cid?: string }
    const specs: RowSpec[] = [];
    const row = (depth: number, icon: string, text: string, sel: Pick, more: Partial<RowSpec> = {}): void => { specs.push({ depth, icon, text, sel, ...more }); };
    row(0, svg('si', 16), p.title, { kind: 'project' }, { cls: 'si-root' });
    row(1, svg('grid', 15), 'Dashboard', { kind: 'dashboard' }, { title: 'How far along the project is, and every compound’s data at a glance' });
    const compoundRow = (c: SiCompound, depth: number): void => {
      const k = p.completion(c);
      const flagged = Object.keys(flagsOf(c)).length > 0;
      const active = this.activeWarnings(c);
      const tip = active.map((w) => w.message).join('\n').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
      const icon = flagged ? `<span class="si-st flag" title="Flagged for checking">${svg('flag')}</span>` : active.length ? `<span class="si-st warn" title="${tip}">${svg('warn')}</span>`
        : k.filled === k.total ? `<span class="si-st ok" title="Every required field is filled in">${svg('check')}</span>` : `<span class="si-st" title="Missing: ${k.missing.join(', ').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')}">${svg('open')}</span>`;
      row(depth, icon, compoundName(c) || 'unnamed compound', { kind: 'compound', id: c.id }, { cid: this.idOf(c) });
    };
    const walk = (list: SiSection[], depth: number): void => {
      for (const s of list) {
        const icon = svg(s.type === 'data' ? 'flask' : s.type === 'spectra' ? 'spectrum' : s.type === 'xray' ? 'xray' : 'page', 15);
        row(depth, icon, s.name, { kind: 'section', id: s.id }, { title: `${TYPE_LABELS[s.type] ?? s.type} section` });
        if (s.type === 'data') {
          for (const it of s.items) {
            if (it.kind === 'scheme') {
              row(depth + 1, svg('scheme'), String(it.data.name || 'Scheme'), { kind: 'scheme', id: it.id }, { title: 'A scheme page: its reaction scheme, and its compounds under it', cls: 'si-scheme' });
              for (const c of it.children) compoundRow(c, depth + 2);
            } else compoundRow(it, depth + 1);
          }
        }
        if (s.type === 'spectra') {
          // each compound with spectra: its spectra page
          for (const c of p.compounds) {
            if (!spectrumItems(c).some(([, i]) => i.file)) continue;
            row(depth + 1, svg('spectrum', 13), compoundName(c) || 'unnamed compound', { kind: 'spectra', id: c.id, section: s.id }, { cid: this.idOf(c), title: 'This compound’s spectra as they print: drag the structure box, and set this spectrum’s own look' });
          }
        }
        walk(s.children, depth + 1);
      }
    };
    walk(p.top, 1);
    this.msWarm(p);
    const msProblems = (() => { const r = this.msState(p).result; return r ? problemsOf(r).length : 0; })();
    row(1, svg('check', 15), `Manuscript Check${msProblems ? ` (${msProblems})` : ''}`, { kind: 'manuscript' }, { cls: msProblems > 0 ? 'si-has-warn' : '', title: 'Compare the manuscript (PDF, Word or a Chemweave document) and its ChemDraw files with the SI' });
    row(1, svg('refs', 15), `References (${p.references.length})`, { kind: 'references' });
    const total = p.compounds.reduce((n, c) => n + this.activeWarnings(c).length, 0) + this.projectWarningsNow.length;
    row(1, svg('warn', 15), `Warnings (${total})`, { kind: 'warnings' }, { cls: total > 0 ? 'si-has-warn' : '', title: 'Every automatic warning in the project, by compound' });

    const mark = (r: HTMLElement): void => {
      const on = r.dataset.sel === pickKey;
      r.classList.toggle('on', on);
      r.setAttribute('aria-selected', String(on));
      r.tabIndex = on ? 0 : -1;
    };
    const sig = JSON.stringify([p.readOnly, specs]);
    if (this.treeFor === p && this.treeSig === sig && this.tree.childElementCount === specs.length) {
      // nothing but the pick changed: the rows stay (and the keys stay on the row they were on)
      for (const r of this.tree.children) mark(r as HTMLElement);
      return;
    }
    const hadKeys = this.tree.contains(document.activeElement);
    const rows = specs.map((x) => {
      const r = el('div', 'si-row');
      r.setAttribute('role', 'treeitem');
      r.style.paddingLeft = `${6 + x.depth * 14}px`;
      r.innerHTML = x.icon;
      const t = el('span', 'si-row-text');
      if (x.cid !== undefined) t.append(el('b', 'si-cid', x.cid), document.createTextNode(' ' + x.text)); else t.textContent = x.text;
      r.append(t);
      if (x.title) r.title = x.title;
      if (x.cls) r.classList.add(x.cls);
      r.dataset.sel = JSON.stringify(x.sel);
      mark(r);
      const sel = x.sel;
      r.addEventListener('click', () => this.go(sel));
      if (sel.kind === 'section' || sel.kind === 'compound' || sel.kind === 'scheme') this.treeRowActions(r, sel);
      return r;
    });
    this.tree.replaceChildren(...rows);
    this.treeFor = p;
    this.treeSig = sig;
    // (the row that had the keys was made again: they go to the row picked, so the next key still works)
    if (hadKeys) this.tree.querySelector<HTMLElement>('.si-row.on')?.focus({ preventScroll: true });
  }
  /** The tree as last drawn: its project, and what its rows showed. */
  private treeFor: SiProject | null = null;
  private treeSig = '';

  // ---------------------------------------------------------------- pages

  private renderPage(): void {
    // (a contextual tab open before stays open when the page drawn again has it)
    const keep = this.ribbon.querySelector<HTMLElement>('[data-si-tab][aria-selected="true"]')?.dataset.siTab ?? '';
    void this.commitAll();
    this.drawn++;
    this.flushers = [];
    this.headPaint = null;
    for (const t of this.tables) t.dispose();
    for (const f of this.figures) f.dispose();
    this.boxes = [];
    this.tables = [];
    this.figures = [];
    this.tableChosen(null);
    this.figureChosen(null);
    this.xrayShown(null);
    this.attachShown(null);
    this.schemeShown(null);
    this.spectraShown(null);
    this.front = null;
    this.ribbon.querySelector<HTMLElement>('[data-si-tab="refs"]')!.hidden = this.pick.kind !== 'references';
    this.msShown(null);
    this.dashRedraw = null;
    const p = this.project!;
    const pick = this.pick;
    const out = el('div', 'si-sheet');
    if (p.warnings.length && pick.kind === 'project') {
      const w = el('div', 'si-warnings');
      for (const m of p.warnings) w.append(el('p', '', m));
      out.append(w);
    }
    if (pick.kind === 'compound') {
      const c = this.currentCompound();
      if (c) this.compoundPage(out, c);
      else this.pick = { kind: 'project' };
    } else if (pick.kind === 'section') {
      try { this.sectionPage(out, p.section(pick.id)); } catch { this.pick = { kind: 'project' }; }
    } else if (pick.kind === 'scheme') {
      try { this.schemeCard(out, p.scheme(pick.id)); } catch { this.pick = { kind: 'project' }; }
    } else if (pick.kind === 'spectra') {
      const c = p.compounds.find((x) => x.id === pick.id);
      if (c) this.spectraCompoundPage(out, c, pick.section); else this.pick = { kind: 'project' };
    } else if (pick.kind === 'references') this.referencesPage(out);
    else if (pick.kind === 'manuscript') this.manuscriptPage(out);
    else if (pick.kind === 'warnings') this.warningsPage(out);
    else if (pick.kind === 'dashboard') this.dashboardPage(out);
    if (this.pick.kind === 'project') this.projectPage(out);
    this.dashShown();
    this.lockFields(out);
    this.page.replaceChildren(out);
    if (keep && this.ribbon.querySelector<HTMLElement>(`[data-si-tab="${keep}"]`)?.hidden === false) this.showRibbonTab(keep);
    // (the Manuscript Check tab comes forward when its page is first shown: its commands are the page's only ones)
    if (this.pick.kind === 'manuscript' && this.lastPageKind !== 'manuscript') this.showRibbonTab('ms');
    this.lastPageKind = this.pick.kind;
    void this.readLabels();
  }

  private projectPage(out: HTMLElement): void {
    const p = this.project!;
    const card = el('div', 'si-card');
    const h = el('h2', 'si-title', p.title);
    addInfo(h, 'An SI project is a folder Chem SI Assistant reads and writes too: changes made here are saved to its files at once, and open there as they are. Select a section or a compound on the left.');
    card.append(h);
    const rows: [string, string][] = [
      ['Folder', p.folder.where],
      ['Journal style', String(p.settings.journal_style ?? 'ACS')],
      ['Sections', String(p.sections.length)],
      ['Compounds', String(p.compounds.length)],
      ['References', String(p.references.length)],
    ];
    if (p.savedBy) rows.push(['Last saved by', `version ${p.savedBy}`]);
    const t = el('table', 'si-facts');
    for (const [a, b] of rows) { const tr = el('tr'); tr.append(el('th', '', a), el('td', '', b)); t.append(tr); }
    card.append(t);
    if (!p.sections.length) card.append(el('p', 'muted', 'No sections yet: New Section makes one (a Data section holds compounds).'));
    out.append(card);
    const front = new SiFrontPage({
      project: p,
      flash: (m, ms) => this.host.flash(m, ms),
      label: this.label,
      mentionable: this.mentionable,
      titleChanged: () => { if (this.tab) { this.tab.name = p.title; this.host.changed(); } this.renderTree(); },
      redraw: () => { this.shownKey = ''; this.refresh(); },
    });
    this.front = front;
    out.append(front.el);
  }

  /** The front matter page shown (Insert ▸ Author and Affiliation add to it). */
  private front: SiFrontPage | null = null;

  /** The reference picked on the References page (the References tab's Edit and Delete act on it). */
  private refPicked = '';

  private manuscriptPage(out: HTMLElement): void {
    const p = this.project!;
    const page = new SiManuscriptPage({
      project: p,
      flash: (m, ms) => this.host.flash(m, ms),
      pickFiles: (l, x) => this.host.pickFiles(l, x),
      openDocuments: () => this.host.openDocuments(),
      smiles: (m) => this.host.smiles(m),
      facts: (m) => this.host.siFacts(m),
      act: async (label, f) => {
        try {
          await this.commitAll();
          await this.change(p, label, f);   // (in the project's queue, as one step of Undo)
        } catch (e) {
          this.host.flash(e instanceof SiProjectError ? e.message : `Could not save the change: ${e instanceof Error ? e.message : String(e)}`, 8000);
        }
        this.refresh();
      },
      openAt: (c, field) => this.openAt(c, field),
      resultChanged: () => { if (this.project === p) { this.renderTree(); if (this.pick.kind === 'warnings') { this.shownKey = ''; this.refresh(); } } },
    }, this.msState(p));
    out.append(page.el);
    this.msShown(page);
  }

  private referencesPage(out: HTMLElement): void {
    const p = this.project!;
    const card = el('div', 'si-card');
    const h = el('h2', 'si-title', 'References');
    addInfo(h, 'The project’s references (references.json). Only the references cited are printed, numbered in order of first citation in the journal style’s format. The References tab adds them by DOI, by hand, from a BibTeX or RIS file or from My Library; double-click one to edit it.');
    card.append(h);
    const list = el('div', 'si-refs');
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', 'References');
    const rows: HTMLElement[] = [];
    p.references.forEach((r, i) => {
      const id = String(r.id);
      const row = el('div', 'si-ref-row');
      row.setAttribute('role', 'option');
      row.tabIndex = 0;
      row.dataset.ref = id;
      const authors = Array.isArray(r.authors) ? (r.authors as string[]).join('; ') : '';
      const text = el('div', 'si-ref-text', [authors, r.title, [r.journal, r.year, r.volume, r.pages].filter(Boolean).join(', '), r.doi ? `DOI: ${r.doi}` : ''].map((x) => String(x ?? '').trim().replace(/\.$/, '')).filter(Boolean).join('. '));
      const uses = el('div', 'si-ref-uses muted', '');
      row.append(el('span', 'si-ref-n', String(i + 1)), text, uses);
      const pick = (): void => { this.refPicked = id; for (const x of rows) x.setAttribute('aria-selected', String(x === row)); };
      row.addEventListener('mousedown', pick);
      row.addEventListener('focus', pick);
      row.addEventListener('dblclick', () => void this.run('ref-edit'));
      row.setAttribute('aria-selected', String(id === this.refPicked));
      rows.push(row);
      list.append(row);
    });
    if (!p.references.length) card.append(el('p', 'muted si-note', 'No references yet: References ▸ Add by DOI, or From My Library.'));
    card.append(list);
    out.append(card);
    void p.referenceUses().then((uses) => {
      for (const row of rows) {
        const u = uses.get(row.dataset.ref!);
        const where = [...(u?.compounds ?? []).map((cid) => { const c = p.compounds.find((x) => x.id === cid); return c ? this.idOf(c) : '??'; }), ...(u?.texts ?? [])];
        row.querySelector<HTMLElement>('.si-ref-uses')!.textContent = where.length ? `Cited in ${where.join(', ')}` : 'Not cited: not printed';
      }
    });
  }

  /** A reference of references.json as the reference windows have it, and back. */
  private static refOf(r: Json): Reference { return cleanRef(r as Partial<Record<keyof Reference, unknown>>); }
  private static refJson(r: Reference): Json {
    // (text typed over the automatic one is kept in a key of its own; SI Assistant reads past it)
    return { id: r.id, type: r.type, authors: [...r.authors], title: r.title, journal: r.journal, year: r.year, volume: r.volume, issue: r.issue, pages: r.pages, doi: r.doi, url: r.url, publisher: r.publisher, note: r.note, ...(r.typed ? { typed: r.typed } : {}) };
  }

  /** The References tab's commands. */
  private async references(cmd: string): Promise<void> {
    const p = this.project!;
    const taken = new Set(p.references.map((r) => String(r.id)));
    const add = async (refs: Reference[]): Promise<void> => {
      let added = 0;
      await this.act(async () => {
        for (const r of refs) { const n = p.references.length; this.refPicked = await p.addReference({ ...SiMode.refJson(r), id: undefined }); if (p.references.length > n) added++; }
      });
      const same = refs.length - added;
      this.host.flash(`${added ? `Added ${added} reference${added === 1 ? '' : 's'}` : 'Nothing new was added'}${same ? `; ${same} ${same === 1 ? 'was' : 'were'} on the list already (same DOI)` : ''}.`);
    };
    if (cmd === 'ref-doi') {
      const got = await ask('Add by DOI', [{ name: 'doi', label: 'DOI', value: '', placeholder: '10.1021/acs.orglett.0c01234, or several on lines of their own', type: 'textarea' }], { ok: 'Add', note: 'Each is filled in from Crossref (needs the internet). Check them on the list after.' });
      const dois = (got?.doi ?? '').split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
      if (!dois.length) return;
      this.host.flash(`Looking up ${dois.length === 1 ? 'the DOI' : `${dois.length} DOIs`} on Crossref…`, 15000);
      const found: Reference[] = [];
      const failed: string[] = [];
      for (const d of dois) { try { found.push(await fetchDoi(d)); } catch (e) { failed.push(`${d} (${e instanceof Error ? e.message : String(e)})`); } }
      if (found.length) await add(found);
      if (failed.length) this.host.flash(`Could not look up ${failed.join('; ')}. Add ${failed.length === 1 ? 'it' : 'them'} by hand with Add Reference.`, 8000);
    } else if (cmd === 'ref-new') {
      const r = await editReference(blankRef('article', newRefId(taken)), 'Add Reference', 'acs', (doi) => fetchDoi(doi));
      if (r) await add([r]);
    } else if (cmd === 'ref-import') {
      const [f] = await this.host.pickFiles('References (BibTeX, RIS or text)', ['bib', 'ris', 'txt']);
      if (!f) return;
      const refs = parseReferenceText(new TextDecoder().decode(f.bytes));
      if (!refs.length) { this.host.flash(`No references were found in ${f.name}.`); return; }
      await add(refs);
    } else {
      const r = p.reference(this.refPicked);
      if (!r) { this.host.flash('Click a reference on the list first.'); return; }
      if (cmd === 'ref-edit') {
        const got = await editReference(SiMode.refOf(r), 'Edit Reference', 'acs', (doi) => fetchDoi(doi));
        if (got) await this.act(() => p.updateReference({ ...SiMode.refJson(got), id: r.id }));
      } else if (cmd === 'ref-delete') {
        const uses = (await p.referenceUses()).get(String(r.id));
        const n = (uses?.compounds.length ?? 0) + (uses?.texts.length ?? 0);
        const go = await askChoice('Delete Reference', n ? `It is cited in ${n} place${n === 1 ? '' : 's'}. The citations stay in the text and are flagged (Warnings) until you cite another or add it back.` : 'It is not cited anywhere.', [{ value: 'go', label: 'Delete', primary: true }, { value: 'no', label: 'Cancel' }], 'no');
        if (go === 'go') { await this.act(() => p.deleteReference(String(r.id))); this.refPicked = ''; }
      }
    }
  }

  private sectionPage(out: HTMLElement, s: SiSection): void {
    const p = this.project!;
    const card = el('div', 'si-card');
    const h = el('div', 'si-head-row');
    const name = el('input', 'si-name-input');
    name.value = s.name;
    name.setAttribute('aria-label', 'Section name');
    this.bind(name, () => void this.act(() => p.renameSection(s.id, name.value)), false);
    h.append(name, el('span', 'si-chip', `${TYPE_LABELS[s.type] ?? s.type} section`));
    card.append(h);
    out.append(card);
    if (s.type === 'data') {
      this.dashboardCard(out, s);
      this.idTableCard(out, s);
      this.fieldsCard(out, s);
      this.gpCard(out, s);
    } else if (s.type === 'text') this.textCard(out, s); else if (s.type === 'spectra') this.spectraCard(out, s);
    else if (s.type === 'xray') this.xrayCard(out, s);
    else if (s.type === 'file') {
      const page = new SiAttachmentPage({
        project: p, section: s, flash: (m, ms) => this.host.flash(m, ms), pickFiles: (l, x) => this.host.pickFiles(l, x),
        pdfPages: (b) => import('../render/pdf-page').then((m) => m.pdfPages(b)),
        redraw: () => { this.shownKey = ''; this.refresh(); },
      });
      out.append(page.el);
      this.attachShown(page);
    } else {
      out.append(el('p', 'muted si-note', `${TYPE_LABELS[s.type] ?? s.type} sections are edited in Chem SI Assistant for now; they are kept as they are here.`));
    }
  }

  /**
   * A Data section's general procedures: each one's name, title, text (printed once at the start
   * of the section under "Name: Title") and the sentence its compounds get, its {placeholders}
   * filled on each compound's Experimental procedure field. Insert ▸ General Procedure adds one.
   */
  private gpCard(out: HTMLElement, s: SiSection): void {
    const p = this.project!;
    const gps = p.generalProcedures(s);
    const card = el('div', 'si-card');
    const h = el('h3', 'si-sub', 'General procedures');
    addInfo(h, 'Printed once at the start of the section, each under its heading “Name: Title” (in the contents). A compound chooses one in its Experimental procedure field and gets its compound sentence there: {GP}, {scale}, {yield}, {product} and {purification} fill themselves in; any other {placeholder} (such as {starting material}) gets a box to type in on the compound. Insert ▸ General Procedure adds one; a deleted one goes to the Trash.');
    card.append(h);
    if (!gps.length) card.append(el('p', 'muted si-note', 'None yet: Insert ▸ General Procedure adds one.'));
    gps.forEach((gp, i) => {
      const id = String(gp.id);
      const box = el('div', 'si-gp');
      const top = el('div', 'si-gp-top');
      const name = el('input', 'si-gp-name');
      name.value = partText(gp.name);
      name.setAttribute('aria-label', 'Name');
      name.placeholder = 'General Procedure A';
      this.bind(name, () => void this.act(() => p.updateGeneralProcedure(id, { name: name.value.trim() }), false));
      const title = el('input', 'si-gp-title');
      title.value = partText(gp.title);
      title.setAttribute('aria-label', 'Title');
      title.placeholder = 'Title (optional), e.g. Reduction of aryl methyl ketones';
      this.bind(title, () => void this.act(() => p.updateGeneralProcedure(id, { title: title.value.trim() }), false));
      const users = p.gpUsers(id);
      const used = el('span', 'muted si-gp-users', users.length ? `Used by ${users.map((c) => this.idOf(c)).join(', ')}` : 'Not used yet');
      const up = el('button', 'si-mini', '▲');
      up.type = 'button';
      up.title = 'Move up (the order they print in)';
      up.disabled = i === 0;
      up.addEventListener('click', () => void this.act(() => p.moveGeneralProcedure(id, -1)));
      const down = el('button', 'si-mini', '▼');
      down.type = 'button';
      down.title = 'Move down';
      down.disabled = i === gps.length - 1;
      down.addEventListener('click', () => void this.act(() => p.moveGeneralProcedure(id, 1)));
      const rm = el('button', 'si-mini', '✕');
      rm.type = 'button';
      rm.title = 'Delete the general procedure (to the Trash; compounds using it keep the choice, with a warning)';
      rm.addEventListener('click', () => void (async () => {
        const msg = users.length ? `${users.length} compound${users.length === 1 ? ' uses' : 's use'} it (${users.map((c) => this.idOf(c)).join(', ')}); they keep the choice and get a warning until you choose another.` : 'It goes to the project’s Trash, where Chem SI Assistant can restore it.';
        const go = await askChoice(`Delete ${partText(gp.name) || 'General Procedure'}`, msg, [{ value: 'go', label: 'Delete', primary: true }, { value: 'no', label: 'Cancel' }], 'no');
        if (go === 'go') await this.act(() => p.deleteGeneralProcedure(id));
      })());
      top.append(name, title, used, up, down, rm);
      const textLab = el('div', 'si-gp-label', 'Procedure');
      const textBox = new SiRichBox('', { label: this.label, mentionable: this.mentionable, changed: (v) => void this.act(() => p.writeGpText(id, v), false, undefined, () => textBox) }, true, 'The procedure as it prints under its heading: To a solution of {starting material} in…');
      this.boxes.push(textBox);
      void p.readGpText(s, id).then((t) => textBox.set(t)).catch(() => { /* (shown empty) */ });
      const sentLab = el('div', 'si-gp-label', 'Compound sentence');
      addInfo(sentLab, 'What each compound made by this procedure prints at the start of its procedure. {GP} is this procedure’s name; {scale}, {yield}, {product} and {purification} come from the compound’s fields; other {placeholders} are typed on the compound.');
      const sentence = new SiRichBox(partText(gp.sentence), { label: this.label, mentionable: this.mentionable, changed: (v) => void this.act(() => p.updateGeneralProcedure(id, { sentence: v }), false, undefined, () => sentence) }, false, 'Prepared according to {GP} from {starting material} ({scale}).');
      this.boxes.push(sentence);
      box.append(top, textLab, textBox.el, sentLab, sentence.el);
      card.append(box);
    });
    out.append(card);
  }

  /**
   * A Custom section's text, and an editor for each of its tables (in the text's order). New
   * Table adds one at the end of the text, its caption on the line under it; Ctrl+clicking a
   * table's or figure's caption line in the text goes to its editor.
   */
  private textCard(out: HTMLElement, s: SiSection): void {
    const p = this.project!;
    const t = el('div', 'si-card');
    const th = el('div', 'si-head-row');
    const h = el('h3', 'si-sub', 'Text');
    addInfo(h, 'The section’s text. Lines starting with # are headings. Mention a compound, table or figure with @ (it prints as its ID or label). A table shows as its caption here, and is edited under the text (Insert ▸ Table adds one).');
    th.append(h);
    t.append(th);
    out.append(t);
    const drawn = this.drawn;
    void this.pendingOf(p).then(() => p.readSectionText(s)).then(async (text) => {
      // (another page was drawn while the text was read: this one is gone)
      if (drawn !== this.drawn || this.project !== p) return;
      const box = new SiRichBox(text, {
        label: this.label, mentionable: this.mentionable,
        changed: (v) => void this.act(() => p.writeSectionText(s, v), false, undefined, () => box),
        pasteObject: (e, place) => void this.pasteFigure(s, e, place),
      }, true, 'Type the section’s text');
      this.boxes.push(box);
      t.append(box.el);
      // the tables and figures under the text, in its order
      let nt = 0, nf = 0;
      const editors = parseMarkup(text).flatMap((x): (SiTableEditor | SiFigureEditor)[] => {
        if (x.table) return [new SiTableEditor(this.tableHost(s), x.table, this.objLabels.get(x.table) ?? `Table ${++nt} of the section`)];
        if (x.figure) return [new SiFigureEditor(this.figureHost(s), x.figure, this.objLabels.get(x.figure) ?? `Figure ${++nf} of the section`)];
        return [];
      });
      for (const e of editors) {
        e.setTitle('', this.objAutoLabels.get(e.id) ?? '');
        out.append(e.el);
        if (e instanceof SiTableEditor) { this.tables.push(e); await e.load(); } else this.figures.push(e);
        if (drawn !== this.drawn) return;
      }
      this.lockFields(out);
      const made = editors.find((x) => x.id === this.focusTable);
      if (made) {
        this.focusTable = '';
        made.focus();
        if (made instanceof SiTableEditor) { this.tableChosen(made); this.showRibbonTab('table'); } else { this.figureChosen(made); this.showRibbonTab('figure'); }
      }
      // Ctrl+click (⌘-click) on a table's or figure's caption line goes to it, as a link in Word does
      // (not a double-click, which selects a word of the caption, and starts a triple-click's line)
      box.el.addEventListener('click', (e) => {
        if (!(e.ctrlKey || e.metaKey)) return;
        const id = (e.target as HTMLElement).closest<HTMLElement>('[data-table]')?.dataset.table;
        const fig = (e.target as HTMLElement).closest<HTMLElement>('[data-figure]')?.dataset.figure;
        const to = editors.find((x) => x.id === (id ?? fig));
        if (!to) return;
        e.preventDefault();
        to.focus();
      });
    }).catch((e) => { if (drawn === this.drawn) t.append(el('p', 'muted si-note', `The section’s text could not be read: ${e instanceof Error ? e.message : String(e)}`)); });
  }

  private tableHost(s: SiSection): ConstructorParameters<typeof SiTableEditor>[0] {
    const p = this.project!;
    return {
      project: p,
      section: s,
      flash: (m) => this.host.flash(m),
      label: this.label,
      mentionable: this.mentionable,
      pickFiles: (l, x) => this.host.pickFiles(l, x),
      editStructure: (c, title, done) => this.host.editStructure(c, title, done),
      drawingFiles: (d) => this.host.drawingFiles(d),
      contentsOfCdxml: (x) => this.host.contentsOfCdxml(x),
      readClipboard: (e) => this.host.readClipboard(e),
      contentsOf: (m) => this.host.contentsOf(m),
      selectionChanged: (t) => this.tableState(t),
      remove: (t) => this.removeObject(s, 'table', t.id),
      pickCompound: async () => {
        const list = p.compounds.filter((c) => p.hasStructure(c));
        const [c] = await pickFromList('Compound', list, (x) => this.idOf(x), (x) => compoundName(x), 'No compound has a structure yet.');
        return c ? { id: c.id, mol: await p.readStructure(c) } : null;
      },
    };
  }

  private figureHost(s: SiSection): ConstructorParameters<typeof SiFigureEditor>[0] {
    return {
      ...this.tableHost(s),
      chosen: (f) => { this.tableChosen(null); this.figureChosen(f); },
      remove: (f) => this.removeObject(s, 'figure', f.id),
    };
  }

  /**
   * A new figure at the end of a Custom section's text, its picture from a file, the drawing
   * tools, the clipboard or a compound (nothing is made when none is given).
   */
  private async newFigure(s: SiSection, how: 'picture' | 'draw' | 'paste' | 'compound'): Promise<void> {
    const p = this.project!;
    await this.commitAll();
    const pics = new SiPictures(this.tableHost(s));
    let rel: string | null = null, caption = 'Caption of the figure';
    try {
      if (how === 'picture') rel = await pics.fromFile('Picture for the figure');
      else if (how === 'paste') rel = await pics.fromClipboard();
      else if (how === 'draw') rel = await pics.draw('', 'Figure');
      else {
        const got = await pics.fromCompound();
        if (got) { rel = got.rel; caption = `Structure of **@{${got.id}}**`; }
      }
    } catch (e) { this.host.flash(`The picture could not be added: ${e instanceof Error ? e.message : String(e)}`); return; }
    if (!rel) return;
    const id = newId('f');
    await this.act(async () => {
      const figs = (s.data.figures && typeof s.data.figures === 'object' && !Array.isArray(s.data.figures) ? s.data.figures : (s.data.figures = {})) as Json;
      figs[id] = { file: rel };
      await p.saveSection(s);
      const text = (await p.readSectionText(s)).replace(/\s+$/, '');
      await p.writeSectionText(s, `${text ? text + '\n' : ''}!figure{${id}} ${caption}`);
    });
    this.focusTable = id;
  }

  /**
   * Ctrl+V of a drawing or picture in a Custom section's text: a new figure (as Insert ▸ Paste
   * Picture makes) on the caret's line, or after it.
   */
  private async pasteFigure(s: SiSection, e: ClipboardEvent, place: (para: Paragraph) => string): Promise<void> {
    const p = this.project;
    if (!p) return;
    // (read while the paste event lasts: its clipboard data is gone after it)
    const reading = this.clipboard(e);
    const pics = new SiPictures(this.tableHost(s));
    let rel: string | null = null;
    try {
      const got = await reading;
      if (!got) return;
      rel = await pics.fromPasted(got);
      if (!rel && got.kind !== 'picture') this.host.flash('The clipboard has no picture or drawing. Copy a structure in ChemDraw or Chemweave, or a picture, first.');
    } catch (err) { this.host.flash(`The picture could not be added: ${err instanceof Error ? err.message : String(err)}`); return; }
    if (!rel || this.project !== p) return;
    const id = newId('f');
    const text = place(parseMarkup(`!figure{${id}} Caption of the figure`)[0]);
    const file = rel;
    // (the figure gets the focus when the page is drawn again with it)
    this.focusTable = id;
    await this.act(async () => {
      const figs = (s.data.figures && typeof s.data.figures === 'object' && !Array.isArray(s.data.figures) ? s.data.figures : (s.data.figures = {})) as Json;
      figs[id] = { file };
      await p.saveSection(s);
      await p.writeSectionText(s, text);
    });
  }

  /** A figure or table taken out of a Custom section's text with its caption; its file goes to the Trash. */
  private async removeObject(s: SiSection, kind: 'figure' | 'table', id: string): Promise<void> {
    const p = this.project!;
    await this.commitAll();
    const what = this.objLabels.get(id) ?? (kind === 'figure' ? 'the figure' : 'the table');
    const go = await askChoice(`Delete ${kind === 'figure' ? 'Figure' : 'Table'}`, `Delete ${what} and its caption? ${kind === 'figure' ? 'Its picture goes' : 'It goes'} to the project’s Trash, where Chem SI Assistant can restore it.`, [{ value: 'go', label: 'Delete', primary: true }, { value: 'no', label: 'Cancel' }], 'no');
    if (go !== 'go') return;
    await this.act(() => p.deleteTextObject(s, kind, id));
  }

  /**
   * Structure to Name: each compound's checked IUPAC name in its Name field. One compound's name
   * replaces what is there (after asking); for a section only empty names are filled.
   */
  /** Ribbon ▸ Name from PubChem: the compound's IUPAC name from PubChem (SI Assistant's "Look up name (PubChem)"). */
  private async nameFromPubChem(c: SiCompound | null): Promise<void> {
    const p = this.project!;
    if (!c) { this.host.flash('Select a compound first: its name is looked up by its structure.'); return; }
    if (!p.hasStructure(c)) { this.host.flash('Add a structure first: the name is looked up by the structure.'); return; }
    await this.readFacts(p);
    const mol = this.mols.get(c.id);
    const facts = mol ? this.facts.get(mol) ?? null : null;
    if (!facts) { this.host.flash('This structure could not be read, so it can’t be looked up.', 6000); return; }
    if (!(await SiMode.pubchemOk())) return;
    this.host.flash('Looking the structure up in PubChem…', 10000);
    const got = await lookupName(facts.inchikey ?? '', facts.pieces.length || 1);
    // (the lookup takes up to 10 s: the name is for the structure it was asked for, in this project)
    if (!this.sameStructure(p, c, mol!)) { this.host.flash('The structure changed (or another project is showing) while PubChem was asked, so its name was not used. Look it up again.', 8000); return; }
    if (got.status === 'error' || got.status === 'not_found') { await ask('Name from PubChem', [], { ok: 'OK', noCancel: true, note: got.message }); return; }
    const v = valuesOf(c).name;
    const now = v && typeof v === 'object' && !Array.isArray(v) ? String((v as Json).text ?? '') : '';
    if (got.status === 'no_stereo') {
      const go = await askChoice('Name from PubChem', `${got.message}\n\nPubChem’s name: ${got.name}`, [{ value: 'no', label: 'Cancel' }, { value: 'yes', label: now ? 'Replace the Name' : 'Use It', primary: true }], 'no');
      if (go !== 'yes') return;
    } else if (now && now !== got.name) {
      const go = await askChoice('Name from PubChem', `Replace the name “${now}” with PubChem’s name “${got.name}”?`, [{ value: 'no', label: 'Keep Mine' }, { value: 'yes', label: 'Replace', primary: true }], 'no');
      if (go !== 'yes') return;
    }
    if (!this.sameStructure(p, c, mol!)) { this.host.flash('The structure changed (or another project is showing) meanwhile, so PubChem’s name was not used. Look it up again.', 8000); return; }
    await this.act(() => p.setValue(c, 'name', { ...(v && typeof v === 'object' && !Array.isArray(v) ? v : {}), text: got.name, from_pubchem: { cid: got.cid, name: got.name, stereo: got.status === 'found' } }));
    this.host.flash(got.message, 6000);
  }

  /** Whether a compound in a project still has the structure (molfile) some slow work started from, in the project showing. */
  private sameStructure(p: SiProject, c: SiCompound, mol: string): boolean {
    return this.project === p && p.compounds.includes(c) && this.kept(p).mols.get(c.id) === mol;
  }

  private static pubchemAsked = false;
  /** The note before the first lookup of a session: only the InChIKey is sent (false: cancelled). */
  private static async pubchemOk(): Promise<boolean> {
    let skip = false;
    try { skip = localStorage.getItem('si.pubchem.skipNote') === '1'; } catch { /* (no storage) */ }
    if (skip || SiMode.pubchemAsked) return true;
    const go = await askChoice('Name from PubChem', 'To look up the name, the structure’s InChIKey (a short code calculated from the structure) is sent to PubChem, a public database of the US National Institutes of Health. Nothing else is sent. PubChem only knows compounds that are already public: look up an unpublished compound only if you are happy for its InChIKey to be sent.', [
      { value: 'cancel', label: 'Cancel' },
      { value: 'always', label: 'Look Up, Don’t Ask Again' },
      { value: 'go', label: 'Look Up', primary: true },
    ], 'cancel');
    if (go === 'cancel') return false;
    SiMode.pubchemAsked = true;
    if (go === 'always') try { localStorage.setItem('si.pubchem.skipNote', '1'); } catch { /* (no storage) */ }
    return true;
  }

  private async structureToName(list: SiCompound[]): Promise<void> {
    const p = this.project!;
    const todo = list.filter((c) => p.hasStructure(c));
    if (!todo.length) { this.host.flash(list.length ? 'Draw the compound’s structure first.' : 'Select a compound, or a Data section with unnamed compounds.'); return; }
    if (todo.length === 1 && compoundName(todo[0])) {
      const go = await askChoice('Structure to Name', `Replace the name “${compoundName(todo[0])}” with the structure’s IUPAC name?`, [{ value: 'go', label: 'Replace Name', primary: true }, { value: 'no', label: 'Cancel' }], 'no');
      if (go !== 'go') return;
    }
    let named = 0, why = '';
    for (const c of todo) {
      const mol = await p.readStructure(c).catch(() => '');
      const got = await this.host.nameStructure(mol).catch((e: unknown) => ({ ok: false as const, message: e instanceof Error ? e.message : String(e) }));
      if (this.project !== p) { this.host.flash('Another project is showing now, so Structure to Name stopped. Run it again.', 6000); return; }
      // (a structure redrawn while it was named keeps its own name: the new name was for the old drawing)
      if (!p.compounds.includes(c) || (await p.readStructure(c).catch(() => '')) !== mol) { why = 'The structure changed while it was being named, so the name was not used.'; continue; }
      if (!got.ok) { why = got.message; continue; }
      const v = valuesOf(c).name;
      await this.act(() => p.setValue(c, 'name', { ...(v && typeof v === 'object' && !Array.isArray(v) ? v : {}), text: capitalizeName(got.name) }));
      named++;
    }
    if (todo.length === 1) this.host.flash(named ? 'Named from its structure; you can change the name.' : why || 'No name found.', named ? 3000 : 6000);
    else this.host.flash(`Named ${named} of ${todo.length} compounds${named < todo.length ? '; the others have no name the namer could confirm' : ''}.`, 6000);
  }

  /** A new table at the end of a Custom section's text. */
  private async newTable(s: SiSection): Promise<void> {
    const p = this.project!;
    if (p.readOnly) { this.host.flash('This SI project is open read-only.'); return; }
    await this.commitAll();
    const id = newId('t');
    await this.act(async () => {
      await p.writeTable(s, newTable(id));
      const text = (await p.readSectionText(s)).replace(/\s+$/, '');
      await p.writeSectionText(s, `${text ? text + '\n' : ''}!table{${id}} Caption of the table`);
    });
    this.focusTable = id;
  }
  /** A table or figure just made: its editor is picked once it shows. */
  private focusTable = '';

  /**
   * An X-ray structure section's page: the structure as it prints (SI Assistant's stored view),
   * the caption it gets and whether its crystal data table prints. The CIF, view and captions are
   * chosen in Chem SI Assistant for now.
   */
  private xrayCard(out: HTMLElement, s: SiSection): void {
    const p = this.project!;
    const page = new SiXrayPage({
      project: p,
      section: s,
      flash: (m, ms) => this.host.flash(m, ms),
      pickFiles: (l, x) => this.host.pickFiles(l, x),
      label: this.label,
      mentionable: this.mentionable,
      compounds: () => p.compounds.map((c) => ({ id: c.id, label: `${this.idOf(c)} ${compoundName(c)}`.trim() })),
      idOf: (id) => { const c = p.compounds.find((x) => x.id === id); return c ? this.idOf(c) : '??'; },
      redraw: () => { this.shownKey = ''; this.refresh(); },
      copyRich: (t, h) => this.host.copyRich(t, h),
      change: (f) => this.change(p, 'Edit', f),
    });
    this.xrayPage = page;
    out.append(page.el);
    this.xrayShown(page);
  }

  /**
   * The Spectra section's page: how spectra are set out when compiled (SI Assistant's defaults,
   * SPEC §13k.12), saved in its section.json as SI Assistant saves them. A spectrum's own settings
   * (changed in SI Assistant on its compound's spectra page) win over these.
   */
  private spectraCard(out: HTMLElement, s: SiSection): void {
    const p = this.project!;
    const now = sectionDefaults(s);
    const save = (key: keyof SpectrumLayout, value: unknown): void => void this.act(async () => {
      const next: Record<string, unknown> = {};
      const cur = { ...sectionDefaults(s), [key]: value } as Record<string, unknown>;
      for (const k of Object.keys(SPECTRA_DEFAULTS)) next[k] = cur[k];
      s.data.defaults = next;
      await p.saveSection(s);
    }, false);
    const card = el('div', 'si-card');
    const h = el('h3', 'si-sub', 'How spectra are printed');
    addInfo(h, 'Every compound’s spectra (its Spectra field, and Additional files set to “Spectra section”) are printed here, compound by compound, each with its header line and the compound’s structure and ID on it. A spectrum’s own settings, set on its compound’s spectra page (under this section in the list), win over these.');
    card.append(h);
    const row = (title: string): HTMLElement => { const r = el('div', 'si-parts si-spectra-row'); r.append(el('span', 'si-spectra-group', title)); card.append(r); return r; };
    const choice = (r: HTMLElement, label: string, key: keyof SpectrumLayout, options: [string, string][], tip: string): void => {
      const cell = el('label', 'si-part');
      cell.title = tip;
      cell.append(el('span', 'si-plabel', label));
      const sel = el('select');
      for (const [v, t] of options) { const o = el('option', '', t); o.value = v; sel.append(o); }
      sel.value = String(now[key]);
      sel.addEventListener('change', () => save(key, key === 'per_page' ? Number(sel.value) : sel.value));
      cell.append(sel);
      r.append(cell);
    };
    const tick = (r: HTMLElement, label: string, key: keyof SpectrumLayout, tip: string): void => {
      const cell = el('label', 'si-part');
      cell.title = tip;
      const box = el('input');
      box.type = 'checkbox';
      box.checked = !!now[key];
      box.addEventListener('change', () => save(key, box.checked));
      cell.append(box, el('span', '', label));
      r.append(cell);
    };
    const num = (r: HTMLElement, label: string, key: keyof SpectrumLayout, min: number, max: number, k: number, tip: string, suffix = ''): void => {
      const cell = el('label', 'si-part');
      cell.title = tip;
      cell.append(el('span', 'si-plabel', label));
      const box = el('input', 'si-num');
      box.type = 'number';
      box.min = String(min);
      box.max = String(max);
      box.value = String(Math.round(Number(now[key]) * k * 100) / 100);
      this.bind(box, () => { const v = Number(box.value); if (Number.isFinite(v)) save(key, v / k); }, false);
      cell.append(box);
      if (suffix) cell.append(el('span', 'si-plabel', suffix));
      r.append(cell);
    };
    const color = (r: HTMLElement, label: string, key: keyof SpectrumLayout, tip: string): void => {
      const cell = el('label', 'si-part');
      cell.title = tip;
      cell.append(el('span', 'si-plabel', label));
      const box = el('input');
      box.type = 'color';
      box.value = String(now[key]);
      box.addEventListener('change', () => save(key, box.value));
      cell.append(box);
      r.append(cell);
    };
    const pages = row('Pages');
    choice(pages, 'Spectra per page', 'per_page', [['1', '1'], ['2', '2'], ['4', '4']], 'Two are stacked on a portrait page and side by side on a landscape one; four make a 2 × 2 grid.');
    choice(pages, 'Orientation', 'orientation', [['portrait', 'Portrait'], ['landscape', 'Landscape']], 'Spectra pages can be turned landscape; the rest of the SI stays portrait.');
    tick(pages, 'Header line', 'header_line', 'The line above each spectrum, e.g. “2a — ¹H NMR (400 MHz, CDCl₃)”, from its peak report (or the header typed for it).');
    tick(pages, 'Auto-crop', 'auto_crop', 'Cut the white margins round each spectrum and scale it to fill its place (the axes are kept; only blank white is cut).');
    tick(pages, 'Frame', 'spectrum_frame', 'A frame round each spectrum.');
    const box = row('Structure and ID');
    tick(box, 'Show', 'struct_box', 'The compound’s structure and ID on a box over each spectrum (Org. Lett. asks for spectra labeled with both).');
    choice(box, 'Position', 'corner', [['top-left', 'Top left'], ['top-right', 'Top right'], ['bottom-left', 'Bottom left'], ['bottom-right', 'Bottom right']], 'The corner of the spectrum the box goes in (a box dragged on its spectra page stays where it was put).');
    num(box, 'Structure size', 'struct_scale', 25, 400, 100, '100 % is the structure’s own size, no larger than 1.5 × 1.1 in.', '%');
    num(box, 'ID size', 'id_size', 0, 24, 1, 'The ID’s size in points; 0 is the text size.', 'pt');
    tick(box, 'Bold ID', 'id_bold', 'The ID in bold.');
    tick(box, 'Caption', 'caption', 'A caption under the structure, e.g. “¹H NMR (CDCl₃, 500 MHz)”, from the peak report (or the caption typed for the spectrum).');
    color(box, 'Background', 'struct_bg', 'The box’s background, so the structure reads over the spectrum.');
    tick(box, 'Frame', 'struct_frame', 'A frame round the box.');
    const hrms = row('HRMS');
    tick(hrms, 'Print HRMS reports', 'hrms_reports', 'Each compound’s HRMS report files (PDFs, pictures and text files), after the spectra in a sub-section “HRMS reports”. A compound can say otherwise in its HRMS field.');
    // spectra with settings of their own
    const own = p.compounds.reduce((n, c) => n + spectrumItems(c).filter(([, i]) => i.layout || i.pages).length, 0);
    if (own) {
      const reset = el('button', 'si-btn', `Apply Defaults to All Spectra (${own})…`);
      reset.type = 'button';
      reset.title = 'Remove every spectrum’s own settings and dragged places, so all of them follow the settings above';
      reset.addEventListener('click', () => void (async () => {
        const go = await askChoice('Apply Defaults to All Spectra', `${own} spectrum file${own === 1 ? ' has' : 's have'} settings of ${own === 1 ? 'its' : 'their'} own (and perhaps a structure box dragged to a place of ${own === 1 ? 'its' : 'their'} own). They will all follow the settings above.`, [{ value: 'go', label: 'Apply Defaults', primary: true }, { value: 'no', label: 'Cancel' }], 'no');
        if (go !== 'go') return;
        await this.act(async () => {
          for (const c of p.compounds) {
            let touched = false;
            for (const [, i] of spectrumItems(c)) if (i.layout || i.pages) { delete i.layout; delete i.pages; touched = true; }
            if (touched) await p.saveCompound(c);
          }
        });
      })());
      card.append(reset);
    }
    out.append(card);
  }

  private idTableCard(out: HTMLElement, s: SiSection): void {
    const p = this.project!;
    const card = el('div', 'si-card');
    const h = el('h3', 'si-sub', 'ID table');
    addInfo(h, 'Row 1 is the first compound’s ID, row 2 the second’s, and so on: moving compounds renumbers them. A Manual ID on a compound replaces its ID but still uses up its row.');
    card.append(h);
    const table = idTableOf(s);
    const cs = compoundsOf(s);
    const grid = el('div', 'si-idgrid');
    const n = Math.max(table.length + 1, cs.length, 3);
    for (let i = 0; i < n; i++) {
      const r = el('div', 'si-idrow');
      const input = el('input');
      input.value = table[i] ?? '';
      input.setAttribute('aria-label', `ID for row ${i + 1}`);
      this.bind(input, () => {
        const next = idTableOf(s).slice();
        while (next.length <= i) next.push('');
        next[i] = input.value.trim();
        while (next.length && !next[next.length - 1]) next.pop();
        void this.act(() => p.setIdTable(s.id, next));
      }, false);
      const c = cs[i];
      const warn = this.report?.tableWarnings.get(cellKey(s.id, i));
      r.append(el('span', 'si-rown', String(i + 1)), input, el('span', 'si-idwho', c ? `${compoundName(c) || 'unnamed compound'}${idOverride(c) ? ` (Manual ID ${idOverride(c)})` : ''}` : ''));
      r.append(warn ? el('span', 'si-chip warn', warn) : el('span'));
      grid.append(r);
    }
    card.append(grid);
    out.append(card);
  }

  private fieldsCard(out: HTMLElement, s: SiSection): void {
    const p = this.project!;
    const card = el('div', 'si-card');
    const h = el('h3', 'si-sub', 'Fields of new compounds');
    addInfo(h, 'The fields a new compound page of this section gets, in this order. Required fields count toward a page being complete. Insert ▸ Field… adds one; Home ▸ Apply Section Fields gives them to the compounds already there.');
    card.append(h);
    const entries = defaultFieldsOf(s);
    const list = el('div', 'si-fieldlist');
    entries.forEach((e, i) => {
      const def = fieldDef(e);
      const r = el('div', 'si-fieldrow');
      const req = el('input');
      req.type = 'checkbox';
      req.checked = !!e.required;
      req.title = 'Required';
      req.addEventListener('change', () => {
        const next = entries.map((x, j) => (j === i ? { ...x, required: req.checked } : x));
        void this.act(() => p.setDefaultFields(s.id, next));
      });
      const up = el('button', 'si-mini', '▲');
      up.type = 'button';
      up.title = 'Move up';
      up.disabled = i === 0;
      up.addEventListener('click', () => { const next = entries.slice(); [next[i - 1], next[i]] = [next[i], next[i - 1]]; void this.act(() => p.setDefaultFields(s.id, next)); });
      const rm = el('button', 'si-mini', '✕');
      rm.type = 'button';
      rm.title = 'Take off the list';
      rm.addEventListener('click', () => void this.act(() => p.setDefaultFields(s.id, entries.filter((_, j) => j !== i))));
      const lab = el('label', 'si-fieldname');
      lab.append(req, ...fieldLabelNodes(def?.label ?? e.key));
      r.append(lab, up, rm);
      list.append(r);
    });
    card.append(list);
    out.append(card);
  }

  // ---------------------------------------------------------------- a compound's page

  private compoundPage(out: HTMLElement, c: SiCompound): void {
    const p = this.project!;
    const s = p.section(c.sectionId);
    const required = new Set(defaultFieldsOf(s).filter((e) => e.required).map((e) => e.key));
    // the header: structure, ID and name, formula and masses
    const head = el('div', 'si-card si-cpd-head');
    const pic = el('button', 'si-struct');
    pic.type = 'button';
    pic.title = 'Edit Structure: draw it with the drawing tools';
    pic.addEventListener('click', () => this.editStructure(c));
    pic.addEventListener('paste', (e) => { e.preventDefault(); void this.pasteStructure(c, e); });
    const info = el('div', 'si-cpd-info');
    const line = el('div', 'si-cpd-title');
    const cid = el('b', 'si-cid'), cname = el('span', 'si-cpd-name');
    line.append(cid, cname);
    const facts = el('div', 'si-cpd-facts muted', p.hasStructure(c) ? '' : 'No structure yet.');
    const chips = el('div', 'si-chips');
    const done = el('span', 'si-chip');
    const idChip = el('button', 'si-chip si-chip-btn');
    // (drawn again in place after each change, so the fields being typed in are never made again)
    this.headPaint = (): void => {
      cid.textContent = this.idOf(c);
      cname.textContent = compoundName(c) || 'unnamed compound';
      const k = p.completion(c);
      done.className = `si-chip ${k.filled === k.total ? 'ok' : ''}`;
      done.textContent = `${k.filled} / ${k.total} required`;
      done.title = k.missing.length ? 'Missing: ' + k.missing.join(', ') : '';
      idChip.textContent = idOverride(c) ? `Manual ID ${idOverride(c)}` : 'ID from table';
    };
    this.headPaint();
    idChip.type = 'button';
    idChip.title = 'Change the compound’s ID (a Manual ID, or the one in its section’s ID table)';
    idChip.addEventListener('click', () => void this.run('manual-id'));
    const shown = el('button', 'si-chip si-chip-btn si-dismissed-chip');
    shown.type = 'button';
    shown.hidden = true;
    shown.title = 'Show the warnings dismissed for this compound (with Restore), or hide them again';
    shown.addEventListener('click', () => { this.showDismissed = !this.showDismissed; this.paintWarnings(); });
    chips.append(done, idChip, shown);
    if (c.schemeId) {
      // (SI Assistant's scheme note: whether its structure prints with its data or in the scheme)
      const k2 = p.scheme(c.schemeId);
      const drawn = allBoxes(k2).some(([b]) => b.compound === c.id);
      const sch = el('button', 'si-chip si-chip-btn', `Scheme “${String(k2.data.name || 'Scheme')}”`);
      sch.type = 'button';
      sch.title = drawn ? 'Part of this scheme page: its structure is not printed with its data (the scheme is). Click to open the scheme.' : 'Part of this scheme page, not drawn in the scheme: its structure is printed with its data. Click to open the scheme.';
      sch.addEventListener('click', () => this.go({ kind: 'scheme', id: k2.id }));
      chips.append(sch);
    }
    const headWarn = el('div', 'si-fwarn si-head-warn');
    headWarn.dataset.key = '';
    headWarn.hidden = true;
    info.append(line, facts);
    head.append(pic, info, chips, headWarn);
    out.append(head);
    if (p.hasStructure(c)) void this.fillStructure(c, pic, facts);
    else pic.innerHTML = '<span class="muted">Draw<br>structure</span>';

    const card = el('div', 'si-card si-fields');
    for (const e of fieldsOf(c)) {
      const def = fieldDef(e);
      if (!def || def.kind === 'structure') continue;
      card.append(this.fieldRow(c, def, required.has(def.key)));
    }
    const unknown = fieldsOf(c).filter((e) => !fieldDef(e)).map((e) => e.key);
    if (unknown.length) card.append(el('p', 'muted si-note', `Kept as they are (made by a newer Chem SI Assistant): ${unknown.join(', ')}.`));
    out.append(card);
  }

  private async fillStructure(c: SiCompound, pic: HTMLElement, facts: HTMLElement): Promise<void> {
    const p = this.project!;
    const mol = await p.readStructure(c).catch(() => null);
    if (mol === null) { pic.textContent = 'Structure'; facts.textContent = 'The structure file could not be read.'; return; }
    const shown = this.host.pictureOf(mol);
    if (shown) pic.innerHTML = shown; else pic.textContent = 'Structure';
    const key = mol;
    // (no answer from the engine, as while it loads or restarts, is not kept: the page is drawn again when it is ready)
    if (!this.analyzed.has(key)) { const got = await this.host.analyze(mol).then((r) => r, () => undefined); if (got !== undefined) this.analyzed.set(key, got); }
    const a = this.analyzed.get(key);
    if (a) {
      facts.replaceChildren();
      facts.append(formulaNode(a.formula), document.createTextNode(` · MW ${a.mw.toFixed(2)} · Exact mass ${a.exact.toFixed(4)}`));
    }
  }

  private fieldRow(c: SiCompound, def: FieldDef, required: boolean): HTMLElement {
    const p = this.project!;
    const row = el('div', 'si-field');
    row.dataset.key = def.key;
    const lab = el('div', 'si-flabel');
    lab.append(...fieldLabelNodes(def.label.replace(/ \(private, never printed\)$/, '')));
    if (required) lab.append(el('span', 'si-req', '*'));
    if (def.description) addInfo(lab, def.description);
    const body = el('div', 'si-fbody');
    const flag = el('button', 'si-flag');
    flag.type = 'button';
    const f = flagsOf(c)[def.key];
    flag.innerHTML = svg('flag');
    flag.classList.toggle('on', !!f);
    flag.title = f ? `Flagged${f.by ? ' by ' + f.by : ''}: ${partText(f.comment) || '(no comment)'}. Click to take the flag off.` : 'Flag this field for checking';
    flag.setAttribute('aria-pressed', String(!!f));
    flag.addEventListener('click', async () => {
      if (f) { await this.act(() => p.setFlag(c, def.key, false)); return; }
      const got = await ask('Flag for Checking', [{ name: 'comment', label: 'What to check', value: '', placeholder: 'e.g. Rf measured in the wrong eluent' }], { ok: 'Flag' });
      if (got) await this.act(() => p.setFlag(c, def.key, true, got.comment.trim()));
    });
    row.append(lab, body, flag);
    if (def.kind === 'parts') this.partsEditor(body, c, def);
    if (def.key === 'hrms') this.hrmsExtra(body, c);
    else if (def.kind === 'richtext' || def.kind === 'notes') {
      if (def.key === 'procedure') this.procedureEditor(body, c);
      else this.textBox(body, c, def.key, def.kind === 'notes' ? 'Private notes (never printed)' : '');
    } else if (def.kind === 'nmr') this.nmrEditor(body, c);
    else if (def.kind === 'citations') this.citationsEditor(body, c);
    else if (def.kind === 'attachments') this.attachmentsEditor(body, c, def);
    else if (def.kind === 'private') body.append(this.storedBox(c));
    const warn = el('div', 'si-fwarn');
    warn.dataset.key = def.key;
    warn.hidden = true;
    body.append(warn);
    return row;
  }

  // ---------------------------------------------------------------- spectra and files

  /**
   * A compound's Spectra or Additional files: each file with a small picture of it (a PDF's first
   * page, a picture itself), its name and its values (a spectrum's type, header and caption; a
   * file's caption, placement and label), with ▲ to move it up and ✕ to take it off (to the Trash).
   * Files are added with Insert ▸ Spectra or Files.
   */
  private attachmentsEditor(body: HTMLElement, c: SiCompound, def: FieldDef): void {
    const p = this.project!;
    const list = (): Json[] => (Array.isArray(valuesOf(c)[def.key]) ? (valuesOf(c)[def.key] as Json[]) : []).filter((x) => x && typeof x === 'object' && !Array.isArray(x));
    const items = list();
    const wrap = el('div', 'si-att-list');
    if (!items.length) wrap.append(el('span', 'muted', def.key === 'spectra' ? 'None yet: copy one in Mnova, click here and press Ctrl+V, or Insert ▸ Spectra.' : 'None yet: Insert ▸ Files adds them.'));
    if (def.key === 'spectra') {
      // (a paste target: click the list, then Ctrl+V; the text boxes inside keep their own paste)
      wrap.tabIndex = 0;
      wrap.title = 'Click here, then Ctrl+V to paste a spectrum copied in Mnova';
      wrap.addEventListener('paste', (e) => { if ((e.target as HTMLElement).closest('input, textarea, [contenteditable="true"]')) return; e.preventDefault(); void this.pasteSpectrum(c, e); });
    }
    items.forEach((it, i) => {
      const file = partText(it.file);
      const row = el('div', 'si-att');
      const thumb = el('div', 'si-att-thumb');
      void this.thumbnail(p.attachmentPath(c, def, file)).catch(() => null).then((src) => {
        if (src) { const img = el('img'); img.src = src; img.alt = file; thumb.append(img); }
        else thumb.textContent = file.slice(file.lastIndexOf('.') + 1).toUpperCase() || 'FILE';
      });
      const info = el('div', 'si-att-info');
      const name = el('div', 'si-att-name', file || 'file');
      name.title = file;
      info.append(name);
      const parts = el('div', 'si-parts');
      for (const part of def.itemParts ?? []) {
        const cell = el('label', 'si-part');
        const short = ATT_SHORT[part.key] ?? part.label?.replace(/ \(empty = automatic\)$/, '') ?? part.key;
        cell.append(el('span', 'si-plabel', short));
        const now = partText(it[part.key]);
        let input: HTMLInputElement | HTMLSelectElement;
        if (part.kind === 'choice') {
          const sel = el('select');
          sel.add(new Option(part.default ? '' : '(not set)', ''));
          for (const ch of part.choices ?? []) sel.add(new Option(part.choiceLabels?.[ch] ?? ch, ch));
          if (part.default) sel.options[0].remove();
          if (now && !(part.choices ?? []).includes(now)) sel.add(new Option(now, now));
          sel.value = now || String(part.default ?? '');
          input = sel;
        } else {
          const inp = el('input');
          inp.value = now;
          const auto = part.key === 'struct_caption' ? captionText(c, { ...it, struct_caption: '' }) : part.key === 'title' && def.key === 'spectra' ? headerParts(c, { ...it, title: '' }, this.idOf(c), 1).join('') : '';
          inp.placeholder = auto ? `auto: ${auto}` : part.label?.includes('automatic') ? 'automatic' : part.placeholder ?? '';
          input = inp;
          cell.classList.add('si-att-wide');
        }
        if (part.label?.includes('automatic')) cell.title = `${part.label}`;
        input.setAttribute('aria-label', `${file} ${short}`);
        const save = (): void => void this.act(async () => {
          if (p.readOnly) throw new SiProjectError('This SI project is open read-only.');
          const all = list();
          const target = all.find((x) => x.file === file);
          if (!target) return;
          const v = input.value.trim();
          if (v) target[part.key] = v; else delete target[part.key];
          await p.setValue(c, def.key, all);
        }, false, c);
        if (input instanceof HTMLInputElement) this.bind(input, save); else input.addEventListener('change', save);
        cell.append(input);
        parts.append(cell);
      }
      info.append(parts);
      const tools = el('div', 'si-att-tools');
      const up = el('button', 'si-mini', '▲');
      up.type = 'button';
      up.title = 'Move up (the order they print in)';
      up.disabled = i === 0;
      up.addEventListener('click', () => void this.act(async () => {
        const all = list();
        const k = all.findIndex((x) => x.file === file);
        if (k > 0) { [all[k - 1], all[k]] = [all[k], all[k - 1]]; await p.setValue(c, def.key, all); }
      }));
      const del = el('button', 'si-mini', '✕');
      del.type = 'button';
      del.title = 'Remove this file (it goes to the Trash)';
      del.addEventListener('click', async () => {
        const go = await askChoice(`Remove ${file}`, 'The file goes to the project’s Trash with its values, so it can be put back.', [{ value: 'go', label: 'Remove', primary: true }, { value: 'no', label: 'Cancel' }], 'no');
        if (go === 'go') await this.act(async () => { await p.removeAttachment(c, def, file); this.forgetThumbs(p); });
      });
      tools.append(up, del);
      row.append(thumb, info, tools);
      wrap.append(row);
    });
    body.append(wrap);
  }

  /** A small picture of an attached file (a PDF's first page, a picture), kept while the project is open; null for other files. */
  private thumbnail(path: string): Promise<string | null> {
    const p = this.project!;
    const k = this.kept(p);
    let got = k.thumbs.get(path);
    if (!got) {
      got = (async () => {
        const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
        const mime = PICTURE_MIME[ext];
        if (ext !== 'pdf' && !mime) return null;
        const bytes = await p.folder.readBytes(path).catch(() => null);
        if (!bytes) return null;
        if (mime) {
          const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
          // (given back when the project closes, or its files change: forgetThumbs)
          if (this.keptOf.get(p) === k && k.thumbs.get(path) === got) k.urls.push(url); else { URL.revokeObjectURL(url); return null; }
          return url;
        }
        const { pdfFirstPage } = await import('../render/pdf-page');
        return (await pdfFirstPage(bytes))?.src ?? null;
      })();
      k.thumbs.set(path, got);
    }
    return got;
  }

  /** A project's files changed (one added, removed, put back or replaced): its small pictures are made again when next shown. */
  private forgetThumbs(p: SiProject): void {
    const k = this.keptOf.get(p);
    if (!k) return;
    const old = k.urls;
    k.urls = [];
    k.thumbs = new Map();
    // (pictures on the page now have loaded theirs; a moment's grace for one still loading)
    setTimeout(() => { for (const u of old) URL.revokeObjectURL(u); }, 2000);
  }

  // ---------------------------------------------------------------- HRMS

  /** Under the HRMS boxes: M (a salt's piece, or a typed formula) and the calculated m/z with the error. */
  private hrmsExtra(body: HTMLElement, c: SiCompound): void {
    const p = this.project!;
    const value = (): Json => { const v = valuesOf(c).hrms; return v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {}; };
    const line = el('div', 'si-parts si-hrms-m');
    const mIs = el('label', 'si-part si-species');
    mIs.append(el('span', 'si-plabel', 'M is'));
    const sel = el('select');
    sel.setAttribute('aria-label', 'M is');
    sel.addEventListener('change', () => void this.act(async () => { await p.setPart(c, 'hrms', 'species', sel.value); if (await this.syncFound(c)) await p.saveCompound(c); }, false, c));
    mIs.append(sel);
    const fcell = el('label', 'si-part');
    fcell.append(el('span', 'si-plabel', 'M formula'));
    const formula = el('input');
    formula.value = partText(value().formula);
    formula.setAttribute('aria-label', 'M formula');
    formula.title = 'Type M’s formula to use instead of the structure’s (the adduct is still applied). Leave empty to use the structure.';
    this.bind(formula, () => void this.act(async () => { await p.setPart(c, 'hrms', 'formula', formula.value.trim()); if (await this.syncFound(c)) await p.saveCompound(c); }, false, c));
    fcell.append(formula);
    line.append(mIs, fcell);
    const calc = el('div', 'si-calc muted');
    const note = el('div', 'si-found-note muted');
    note.hidden = true;
    body.append(line, calc, note, this.reportsBox(c));
  }

  /** The species choice and the calculated line, from the compound as it is now. */
  private paintHrms(c: SiCompound, calc: HTMLElement): void {
    const p = this.project!;
    const value = ((): Json => { const v = valuesOf(c).hrms; return v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {}; })();
    const facts = this.factsOf(c);
    const waiting = p.hasStructure(c) && !this.mols.has(c.id);
    this.paintReports(c);
    // M is: only for a structure in pieces (a salt)
    const sel = calc.parentElement?.querySelector<HTMLSelectElement>('.si-species select');
    const auto = (() => { try { return hrmsSpecies(facts, { species: value.species ?? '' }); } catch { return null; } })();
    if (sel) {
      const cell = sel.closest<HTMLElement>('.si-species')!;
      cell.hidden = !auto?.choices;
      if (auto?.choices && auto.automatic) {
        const opts = [new Option(`Automatic (${auto.automatic[1]})`, ''), ...auto.choices.map(([k, label]) => new Option(label, k))];
        opts[0].title = 'The largest piece that is not a common counter-ion (halide, BF₄⁻, PF₆⁻, OTf⁻, NTf₂⁻, TFA⁻, BArF⁻, Na⁺, K⁺, NBu₄⁺…); the largest piece if all are.';
        sel.replaceChildren(...opts);
        sel.value = auto.key;
      }
      const input = calc.parentElement?.querySelector<HTMLInputElement>('.si-hrms-m input');
      if (input) {
        input.placeholder = auto ? `auto: ${speciesLabel(auto.info)}` : 'e.g. C12H13NO';
        input.classList.toggle('si-manual', !!partText(value.formula).trim());
      }
    }
    calc.classList.remove('bad');
    calc.title = '';
    if (waiting) { calc.textContent = 'Calculating the expected m/z…'; return; }
    let sp;
    try { sp = hrmsSpecies(facts, value); } catch (e) { calc.textContent = e instanceof ChemError ? e.message : String(e); calc.classList.add('bad'); return; }
    if (!sp) {
      calc.textContent = facts?.generic.length ? `The structure has a generic atom (${facts.generic.join(', ')}): type M’s formula to calculate the expected m/z.` : 'Add a structure (or type M’s formula) to calculate the expected m/z.';
      return;
    }
    const [r, problem] = compoundHrms(p, c, facts);
    if (!r) { calc.textContent = problem || ''; calc.classList.toggle('bad', !!problem); return; }
    const mono = monoisotopic(r);
    const adduct = partText(value.adduct) || '[M+H]+';
    calc.replaceChildren();
    calc.append('Calcd for ', formulaNode(mono.formula));
    if (sp.manual) {
      const differs = auto && !sameFormula(auto.info.counts, sp.info.counts) ? ` (structure gives ${auto.info.formula})` : '';
      calc.append(el('span', 'si-manual-mark', ' ✎'));
      calc.title = `M formula typed by hand${differs}.`;
    }
    calc.append(` ${adductDisplay(adduct)}: `, el('b', '', mono.mz.toFixed(4)));
    if (r.found !== null && r.ppm !== null) {
      const peak = r.matched && r.matched !== mono ? ` (compared with the ${r.matched.mz.toFixed(4)} peak, ${r.matched.formula})` : '';
      const ppm = `${r.ppm >= 0 ? '+' : ''}${r.ppm.toFixed(1)} ppm`;
      const bad = outOfTolerance(r);
      calc.append(`; found ${r.found.toFixed(4)}${peak} · Δ `, el('span', bad ? 'si-bad' : 'si-good', bad ? `${ppm} (outside ±${r.tolerance} ppm)` : `${ppm} ✓`));
    }
    const shownPeaks = r.peaks.filter((x) => x.abundance >= 5).slice(0, 6);
    addInfo(calc, `Isotope pattern (m/z): ${shownPeaks.map((x) => `${x.mz.toFixed(4)} (${x.abundance.toFixed(1)}%)`).join(', ')}`);
  }

  // ---------------------------------------------------------------- the live preview (SI Assistant §13k.8)

  private live: { el: HTMLElement; host: HTMLElement; state: HTMLElement; empty: HTMLElement; view: DocView | null; shown: string } = null!;
  private liveOn = true;
  private liveTimer = 0;
  private liveBusy = false;
  private liveAgain = false;

  /** The pane on the right: "Live Preview" with its state, zoom and ▸ to fold it to a strip. */
  private livePane(): typeof this.live {
    try { this.liveOn = localStorage.getItem('si.livePreview') !== 'off'; } catch { /* (on) */ }
    const wrap = el('div', 'si-live');
    const strip = el('button', 'si-live-strip', 'Live Preview');
    strip.type = 'button';
    strip.title = 'Show the live preview (Ctrl+Shift+L)';
    strip.addEventListener('click', () => this.setLive(true));
    const grip = el('div', 'si-live-grip');
    grip.title = 'Drag to change the preview’s width';
    grip.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      grip.setPointerCapture(e.pointerId);
      const right = this.pane.getBoundingClientRect().right;
      const move = (ev: PointerEvent): void => { const w = Math.round(Math.max(240, Math.min(900, right - ev.clientX))); this.pane.style.setProperty('--si-live-w', `${w}px`); };
      const up = (): void => {
        grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up);
        try { localStorage.setItem('si.livePreviewWidth', this.pane.style.getPropertyValue('--si-live-w')); } catch { /* (not kept) */ }
        this.live.view?.resize();
      };
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', up);
    });
    try { const w = localStorage.getItem('si.livePreviewWidth'); if (w) this.pane.style.setProperty('--si-live-w', w); } catch { /* (default) */ }
    const head = el('div', 'si-live-head');
    const title = el('span', 'si-live-title', 'Live Preview');
    const state = el('span', 'si-live-state muted');
    const btn = (text: string, tip: string, f: () => void): HTMLButtonElement => {
      const b = el('button', 'si-mini si-live-btn', text);
      b.type = 'button';
      b.title = tip;
      b.setAttribute('aria-label', tip);
      b.addEventListener('click', f);
      return b;
    };
    // (its zoom is the status bar's, at the right end as in every mode: G5-34)
    head.append(title, state, el('span', 'si-live-gap'),
      btn('▸', 'Hide the live preview (Ctrl+Shift+L)', () => this.setLive(false)));
    addInfo(head, 'The selected page, laid out as it prints in the SI, about a second after each change. Spectra are left out (Compile shows them), and page numbers are placeholders: Compile gives the real ones.');
    const host = el('div', 'si-live-host');
    const empty = el('div', 'si-live-empty muted');
    wrap.append(strip, grip, head, host, empty);
    wrap.classList.toggle('off', !this.liveOn);
    this.pane.classList.toggle('si-live-off', !this.liveOn);
    return { el: wrap, host, state, empty, view: null, shown: '' };
  }

  private zoomBar: StatusZoom | null = null;
  /** DocView's 100% (its ACTUAL; doc-view itself loads only with the preview). */
  private static readonly ACTUAL = 96 / 72;

  /** The status bar's zoom slider, percent and Page Width at its right end, as in the other
   *  modes (G5-34): they zoom the Live Preview, and are dimmed while it is hidden. */
  private showZoom(on: boolean): void {
    if (!this.zoomBar) {
      const side = document.querySelector('#status-side');
      if (!side || !on) return;
      this.zoomBar = statusZoom({
        get: () => ((this.live.view?.zoom ?? SiMode.ACTUAL) / SiMode.ACTUAL) * 100,
        set: (pct) => { const v = this.live.view; if (v) { v.setZoom((pct / 100) * SiMode.ACTUAL); v.redraw(); } },
        fit: { label: 'Page Width', icon: FIT_WIDTH_ICON, run: () => { this.live.view?.fitWidth(); this.live.view?.redraw(); } },
        refocus: () => { /* (the typing stays where it was) */ },
        min: 20, max: 300,
      });
      this.zoomBar.el.id = 'si-statusbar';
      this.zoomBar.el.classList.add('si-only');
      side.before(this.zoomBar.el);
    }
    this.zoomBar.el.hidden = !on;
    const live = on && this.liveOn && !!this.live.view;
    this.zoomBar.el.classList.toggle('si-zoom-off', !live);
    for (const b of this.zoomBar.el.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button, input')) {
      b.disabled = !live;
      b.title = live ? b.getAttribute('aria-label') ?? '' : 'Zoom: show the Live Preview to zoom it (Ctrl+Shift+L)';
    }
    if (live) this.zoomBar.show();
  }

  /** Show or fold the live preview (remembered on this computer). */
  private setLive(on: boolean): void {
    this.liveOn = on;
    try { localStorage.setItem('si.livePreview', on ? 'on' : 'off'); } catch { /* (not kept) */ }
    this.live.el.classList.toggle('off', !on);
    this.pane.classList.toggle('si-live-off', !on);
    this.ribbon.querySelector('[data-si="live-preview"]')?.setAttribute('aria-pressed', String(on));
    if (on) { this.live.shown = ''; this.liveSoon(0); }
    this.showZoom(!!this.tab);
  }

  /** What the live preview shows for the selected page; null for a page it doesn't show (a Data section's overview, the lists). */
  private liveTarget(): SiPreviewTarget | null {
    const p = this.project!;
    const pick = this.pick;
    if (pick.kind === 'compound') {
      const c = p.compounds.find((x) => x.id === pick.id);
      // (on a scheme page the preview is the whole scheme page)
      return c?.schemeId ? { kind: 'scheme', id: c.schemeId } : c ? { kind: 'compound', id: c.id } : null;
    }
    if (pick.kind === 'scheme') return { kind: 'scheme', id: pick.id };
    if (pick.kind === 'project') return { kind: 'front' };
    if (pick.kind === 'section') {
      const s = p.sections.find((x) => x.id === pick.id);
      return s && s.type !== 'data' && s.type !== 'spectra' ? { kind: 'section', id: s.id } : null;
    }
    return null;
  }

  /** Update the live preview in `ms` (edits close together make one update). */
  private liveSoon(ms = 1000): void {
    if (!this.liveOn || !this.project) return;
    clearTimeout(this.liveTimer);
    this.liveTimer = window.setTimeout(() => void this.liveUpdate(), ms);
  }

  private async liveUpdate(): Promise<void> {
    if (this.liveBusy) { this.liveAgain = true; return; }
    const p = this.project;
    if (!p || !this.liveOn) return;
    const target = this.liveTarget();
    const L = this.live;
    const key = JSON.stringify(target);
    if (!target) {
      L.shown = '';
      L.host.hidden = true;
      L.empty.hidden = false;
      L.empty.textContent = this.pick.kind === 'section' ? 'A Data section’s page has no live preview: select one of its compounds, or Compile to see it all.' : 'This page has no live preview.';
      L.state.textContent = '';
      return;
    }
    this.liveBusy = true;
    L.state.textContent = 'Updating…';
    L.state.title = '';
    try {
      // (the saves on their way land first: the preview reads the folder)
      await this.pendingOf(p);
      if (this.project !== p) return;
      const got = await compileSi(p, {
        contentsOf: (m) => this.host.contentsOf(m), sizeOf: (c) => this.host.sizeOf(c), facts: (ms) => this.cachedFacts(ms),
        // (a PDF's first page, kept for the next update: the preview compiles often)
        pdfPages: (b, most) => import('../render/pdf-page').then((m) => m.pdfPagesKept(b, most ?? 1)),
      }, target);
      if (this.project !== p) return;
      const blank = !got.doc.runs.some((r) => r.text.trim()) && !Object.keys(got.doc.objects).length;
      L.host.hidden = blank;
      L.empty.hidden = !blank;
      L.empty.textContent = blank ? 'Nothing to show yet.' : '';
      if (!blank) await this.liveShow({ ...got.doc, drawingStyle: { ...this.host.siStyle() } }, key);
      const n = got.notes.length;
      L.state.textContent = n ? `Up to date · ${n} note${n === 1 ? '' : 's'}` : 'Up to date';
      L.state.title = got.notes.join('\n');
    } catch (e) {
      L.state.textContent = '⚠ Not updated';
      L.state.title = e instanceof Error ? e.message : String(e);
    } finally {
      this.liveBusy = false;
      if (this.liveAgain) { this.liveAgain = false; this.liveSoon(0); }
    }
  }

  /** The structures' facts, read once for each structure (the preview compiles often). */
  private async cachedFacts(ms: string[]): Promise<(MolFacts | null)[]> {
    const todo = [...new Set(ms.filter((m) => m && !this.facts.has(m)))];
    if (todo.length) await this.fetchFacts(todo);
    return ms.map((m) => (m ? this.facts.get(m) ?? null : null));
  }

  /** Show a compiled page in the pane: the same page updated keeps its scroll and zoom; another one fits the width. */
  private async liveShow(doc: DocText, key: string): Promise<void> {
    const [{ DocView }, { DocFile }] = await Promise.all([import('./doc-view'), import('../document/doc-file')]);
    const L = this.live;
    if (!L.view) L.view = new DocView(L.host);
    const v = L.view;
    const same = L.shown === key;
    const top = v.scroller.scrollTop, left = v.scroller.scrollLeft;
    v.file = new DocFile(doc);
    v.resize();
    if (same) { v.sizeSpace(); v.scroller.scrollTop = top; v.scroller.scrollLeft = left; }
    else { v.fitWidth(); v.scroller.scrollTop = 0; }
    v.redraw();
    L.shown = key;
    this.showZoom(!!this.tab);
  }

  // ---------------------------------------------------------------- HRMS report files (§13n.3)

  /** A report file larger than this is not copied into the project (it would have to be held in memory whole). */
  private static readonly MAX_REPORT_COPY_BYTES = 1024 * 1024 * 1024;

  /** Each report file being read, by its path (each is read once at a time). */
  private reportData = new Map<string, Promise<ReportData>>();
  /** Each compound's value for Found from its reports, once worked out (for the "differs" warning). */
  private reportMatches = new Map<string, Match | null>();

  private readReportFile(c: SiCompound, file: string): Promise<ReportData> {
    const path = [c.folder, HRMS_DIR, file].filter(Boolean).join('/');
    let got = this.reportData.get(path);
    if (!got) {
      // (read once while it is being read; remembered by readReportFile until the file changes)
      const dir = [c.folder, HRMS_DIR].filter(Boolean).join('/');
      got = readReportFile(this.project!.folder, dir, file, async (b) => (await import('../render/pdf-page')).pdfText(b));
      this.reportData.set(path, got);
      void got.finally(() => { if (this.reportData.get(path) === got) this.reportData.delete(path); });
    }
    return got;
  }

  /** Whether the compound's structure has been read (or it has none). */
  private factsReady(c: SiCompound): boolean {
    if (!this.project!.hasStructure(c)) return true;
    const mol = this.mols.get(c.id);
    return mol !== undefined && this.facts.has(mol);
  }

  /** The reports' value for the Found box (null: none close enough, or no expected m/z); undefined while the structure is still being read. */
  private async reportMatch(c: SiCompound): Promise<Match | null | undefined> {
    const p = this.project!;
    const items = reportItems(c);
    if (!items.length) return null;
    if (!this.factsReady(c)) return undefined;
    const v = valuesOf(c).hrms;
    const value = v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {};
    let peaks: Peak[] | null = null;
    try {
      const sp = hrmsSpecies(this.factsOf(c), value);
      peaks = sp ? hrmsCalc(sp.info, partText(value.adduct), '', hrmsTolerance(p.settings)).peaks : null;
    } catch (e) { if (!(e instanceof ChemError)) throw e; }
    if (!peaks?.length) return null;
    const reports = await Promise.all(items.map((i) => this.readReportFile(c, String(i.file))));
    return chooseMatch(reports, peaks, hrmsTolerance(p.settings));
  }

  /**
   * Fill the Found box from the reports when it is empty or still holds the value filled from a
   * report before, or clear such a value that no longer fits (in the stored value, not saved). A
   * typed value is never changed. Whether the value changed.
   */
  private async syncFound(c: SiCompound): Promise<boolean> {
    const v = valuesOf(c).hrms;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
    const value = v as Json;
    if (!reportItems(c).length && !(FOUND_FROM_KEY in value)) return false;
    const m = await this.reportMatch(c);
    if (m === undefined) return false;
    this.reportMatches.set(c.id, m);
    const before = JSON.stringify(value);
    updateFound(value, m);
    return JSON.stringify(value) !== before;
  }

  /** Under the HRMS boxes: the instrument's report files, what was read from each, and whether they print. */
  private reportsBox(c: SiCompound): HTMLElement {
    const p = this.project!;
    const box = el('div', 'si-reports');
    box.tabIndex = 0;
    box.title = 'Drag report files here, or click here and press Ctrl+V to paste files copied in File Explorer or Finder';
    const items = reportItems(c);
    const head = el('div', 'si-reports-head');
    head.append(el('span', 'si-plabel', 'Report files'));
    addInfo(head, 'The files the instrument software made: a PDF report, CSV/TXT or Excel peak list, mzML/mzXML/mzData, MGF, JCAMP-DX, netCDF, a picture, or the raw data. A copy is kept in the compound’s hrms folder. The found m/z is read from PDF, text, table and data files: it fills the Found box when that is empty (a value you type is never changed).');
    box.append(head);
    if (!items.length) box.append(el('div', 'muted si-reports-empty', 'None yet: Insert ▸ HRMS Report, or drag files here.'));
    for (const it of items) {
      const file = String(it.file);
      const row = el('div', 'si-report');
      const name = el('span', 'si-report-name', file);
      name.title = file;
      const what = el('span', 'si-report-what muted', 'Reading…');
      void this.readReportFile(c, file).then((d) => {
        what.textContent = d.message;
        what.title = d.message;
        what.classList.toggle('si-bad', !d.readable || !d.mz.length);
        if (!d.readable && /not found|missing/i.test(d.message)) name.textContent = `⚠ ${file} (missing)`;
      });
      const rm = el('button', 'si-x', '✕');
      rm.type = 'button';
      rm.title = 'Remove (moves it to the project Trash)';
      rm.disabled = p.readOnly;
      rm.addEventListener('click', () => {
        this.reportData.delete([c.folder, HRMS_DIR, file].filter(Boolean).join('/'));
        void this.act(() => p.removeHrmsReport(c, file, async () => { await this.syncFound(c); }));
      });
      row.append(name, what, rm);
      box.append(row);
    }
    if (items.length) {
      const pr = el('label', 'si-part si-reports-print');
      pr.append(el('span', 'si-plabel', 'Print in the SI'));
      const sel = el('select');
      const spectra = p.sections.find((s) => s.type === 'spectra') ?? null;
      const on = sectionDefaults(spectra, p.settings).hrms_reports;
      sel.append(new Option(`As the Spectra section says (${on ? 'print' : 'don’t print'})`, ''), new Option('Print them', 'yes'), new Option('Don’t print them', 'no'));
      const own = (valuesOf(c).hrms as Json | undefined)?.[PRINT_KEY];
      sel.value = own === true ? 'yes' : own === false ? 'no' : '';
      sel.disabled = p.readOnly;
      sel.title = 'Printed in the Spectra section, in its sub-section “HRMS reports” after all the spectra. The Spectra section’s page sets this for every compound (off unless you turn it on).';
      sel.addEventListener('change', () => void this.act(() => p.setHrmsPrint(c, sel.value === 'yes' ? true : sel.value === 'no' ? false : null), false));
      pr.append(sel);
      box.append(pr);
    }
    box.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); box.classList.add('si-drop'); } });
    box.addEventListener('dragleave', () => box.classList.remove('si-drop'));
    box.addEventListener('drop', (e) => {
      box.classList.remove('si-drop');
      const files = [...(e.dataTransfer?.files ?? [])];
      if (!files.length) return;
      e.preventDefault();
      void this.addReports(c, files);
    });
    box.addEventListener('paste', (e) => {
      if ((e.target as HTMLElement).closest('input, select, textarea')) return;
      const files = [...(e.clipboardData?.files ?? [])];
      if (!files.length) return;
      e.preventDefault();
      void this.addReports(c, files);
    });
    return box;
  }

  /** Store additional files and folders: each stored file with its note; drag files here, or Ctrl+V files copied in File Explorer or Finder. */
  private storedBox(c: SiCompound): HTMLElement {
    const p = this.project!;
    const box = el('div', 'si-reports si-stored');
    box.tabIndex = 0;
    box.title = 'Drag files here, or click here and press Ctrl+V to paste files copied in File Explorer or Finder';
    const v = valuesOf(c).private_files;
    const items = (Array.isArray(v) ? v : []).filter((i): i is Json => !!i && typeof i === 'object' && !Array.isArray(i));
    if (!items.length) box.append(el('div', 'muted si-reports-empty', 'None yet: Insert ▸ Stored Files…, or drag files here.'));
    for (const it of items) {
      const file = partText(it.file);
      const row = el('div', 'si-report');
      const name = el('span', 'si-report-name', it.kind === 'folder' ? `${file}/` : file);
      name.title = it.kind === 'folder' ? `Folder: ${file}` : file;
      void p.folder.exists(`${c.folder}/${PRIVATE_DIR}/${file}`).then((there) => { if (!there) { name.textContent = `⚠ ${file} (missing)`; name.classList.add('si-bad'); } }, () => {});
      const note = el('input');
      note.value = partText(it.note);
      note.placeholder = 'Note';
      note.setAttribute('aria-label', `Note for ${file}`);
      note.disabled = p.readOnly;
      this.bind(note, () => void this.act(() => p.setPrivateNote(c, file, note.value.trim()), false, c));
      const rm = el('button', 'si-x', '✕');
      rm.type = 'button';
      rm.title = 'Remove (moves it to the project Trash)';
      rm.disabled = p.readOnly;
      rm.addEventListener('click', () => void this.act(() => p.removePrivateItem(c, file)));
      row.append(name, note, rm);
      box.append(row);
    }
    box.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); box.classList.add('si-drop'); } });
    box.addEventListener('dragleave', () => box.classList.remove('si-drop'));
    box.addEventListener('drop', (e) => {
      box.classList.remove('si-drop');
      const files = [...(e.dataTransfer?.files ?? [])];
      if (!files.length) return;
      e.preventDefault();
      void this.addStored(c, files);
    });
    box.addEventListener('paste', (e) => {
      if ((e.target as HTMLElement).closest('input, select, textarea')) return;
      const files = [...(e.clipboardData?.files ?? [])];
      if (!files.length) return;
      e.preventDefault();
      void this.addStored(c, files);
    });
    return box;
  }

  /** Copy files into the compound's private/ folder and list them under Store additional files and folders (never printed). */
  private async addStored(c: SiCompound, files: (File | { name: string; bytes: Uint8Array })[]): Promise<void> {
    const p = this.project!;
    if (p.readOnly) { this.host.flash('This project is open read-only.'); return; }
    const sizeOf = (f: File | { name: string; bytes: Uint8Array }): number => (f instanceof File ? f.size : f.bytes.length);
    const tooLarge = files.filter((f) => sizeOf(f) > SiMode.MAX_REPORT_COPY_BYTES);
    if (tooLarge.length) this.host.flash(`${tooLarge.map((f) => `${f.name} (${(sizeOf(f) / 1e9).toFixed(1)} GB)`).join(', ')}: too large to copy into the project, so not added.`, 10000);
    const todo = files.filter((f) => sizeOf(f) <= SiMode.MAX_REPORT_COPY_BYTES);
    if (!todo.length) return;
    const failed: string[] = [];
    await this.act(async () => {
      if (!fieldKeys(c).includes('private_files')) await p.addField(c, { key: 'private_files' });
      // (one file at a time, so that only one is in memory)
      for (const f of todo) {
        let bytes: Uint8Array;
        try { bytes = f instanceof File ? new Uint8Array(await f.arrayBuffer()) : f.bytes; } catch (e) { failed.push(`${f.name} (${e instanceof Error ? e.message : String(e)})`); continue; }
        await p.addPrivateFile(c, f.name, bytes);
      }
    });
    if (failed.length) this.host.flash(`Could not read ${failed.join(', ')}, so it was not added. Check that the file is on this computer (not online-only) and not open in another program, then add it again.`, 10000);
  }

  /** Copy report files into the compound's hrms folder and list them; Found is filled from them when it is empty. */
  private async addReports(c: SiCompound, files: (File | { name: string; bytes: Uint8Array })[]): Promise<void> {
    const p = this.project!;
    if (p.readOnly) { this.host.flash('This project is open read-only.'); return; }
    // (one file at a time, so that only one is in memory; one too large to copy is left out with a note)
    const sizeOf = (f: File | { name: string; bytes: Uint8Array }): number => (f instanceof File ? f.size : f.bytes.length);
    const tooLarge = files.filter((f) => sizeOf(f) > SiMode.MAX_REPORT_COPY_BYTES);
    if (tooLarge.length) this.host.flash(`${tooLarge.map((f) => `${f.name} (${(sizeOf(f) / 1e9).toFixed(1)} GB)`).join(', ')}: too large to copy into the project, so not added. Keep the raw data where it is, and add a report exported from the instrument software (PDF or CSV) instead.`, 10000);
    const todo = files.filter((f) => sizeOf(f) <= SiMode.MAX_REPORT_COPY_BYTES);
    if (!todo.length) return;
    const big = todo.filter((f) => sizeOf(f) > MAX_REPORT_BYTES && !vendorRawKind(f.name));
    if (big.length) this.host.flash(`${big.map((f) => f.name).join(', ')}: kept, but too large to read numbers from.`, 6000);
    if (!fieldKeys(c).includes('hrms')) await p.addField(c, { key: 'hrms' });
    const failed: string[] = [];
    await this.act(async () => {
      for (const f of todo) {
        let bytes: Uint8Array;
        try { bytes = f instanceof File ? new Uint8Array(await f.arrayBuffer()) : f.bytes; } catch (e) { failed.push(`${f.name} (${e instanceof Error ? e.message : String(e)})`); continue; }
        await p.addHrmsReport(c, f.name, bytes, async () => { await this.syncFound(c); });
      }
    });
    if (failed.length) this.host.flash(`Could not read ${failed.join(', ')}, so it was not added. Check that the file is on this computer (not online-only) and not open in another program, then add it again.`, 10000);
    const v = valuesOf(c).hrms as Json | undefined;
    if (v && foundIsFromReport(v)) this.host.flash(`Found m/z ${String(v.found)} filled from ${String((v[FOUND_FROM_KEY] as Json).file)}.`);
  }

  /** The found-m/z note and the "differs" warning, once the reports are read; fills Found when it should be. */
  private paintReports(c: SiCompound): void {
    const p = this.project!;
    const note = this.page.querySelector<HTMLElement>('.si-found-note');
    if (!note) return;
    if (!reportItems(c).length) { note.hidden = true; this.reportMatches.delete(c.id); return; }
    const shownFor = this.pick;
    void this.reportMatch(c).then(async (m) => {
      if (m === undefined || this.pick !== shownFor) return;
      const before = this.reportMatches.get(c.id);
      this.reportMatches.set(c.id, m);
      const value = (valuesOf(c).hrms ?? {}) as Json;
      // filled again when the structure, adduct or M changed (or a file came back from the Trash)
      if (!p.readOnly && updateFound(structuredClone(value), m)) {
        // (in place: the page's fields, perhaps being typed in, are not made again)
        await this.act(async () => { if (await this.syncFound(c)) await p.saveCompound(c); }, false, c);
        return;
      }
      if ((before?.file ?? null) !== (m?.file ?? null) || before?.mz !== m?.mz || before === undefined) { this.check(); this.paintWarnings(); return; }
      const fin = this.page.querySelector<HTMLInputElement>('input[aria-label="HRMS Found m/z"]');
      if (fin && document.activeElement !== fin) fin.value = partText(value.found);
      const tol = hrmsTolerance(p.settings);
      let text = '';
      if (foundIsFromReport(value)) text = `Found m/z from the report ${String((value[FOUND_FROM_KEY] as Json).file)}; type over it to use a different value.`;
      else if (!m) text = `No m/z within ±${tol} ppm of the expected ion was found in the report files.`;
      else {
        const found = parseNumber(partText(value.found));
        if (found === null) text = `The reports give ${m.mz.toFixed(4)} (${m.file}).`;
        else text = Math.abs(((found - m.mz) / m.mz) * 1e6) > tol ? `Your value is kept; the report ${m.file} gives ${m.mz.toFixed(4)}.` : `Your value; the report ${m.file} gives ${m.mz.toFixed(4)}.`;
      }
      note.textContent = text;
      note.hidden = !text;
    });
  }

  // ---------------------------------------------------------------- the Warnings page

  // ---------------------------------------------------------------- dashboards

  /** Draws the dashboard shown again in place (once the structures are read), without the rest of the page. */
  private dashRedraw: (() => void) | null = null;

  private dashFacts(): DashboardFacts {
    const p = this.project!;
    const sub = (t: string): string => t.replace(/\d/g, (d) => '₀₁₂₃₄₅₆₇₈₉'[Number(d)]);
    return {
      idOf: (c) => this.idOf(c),
      warnings: (c) => this.activeWarnings(c),
      label: this.label,
      formula: (c) => {
        if (!p.hasStructure(c)) return null;
        const f = this.factsOf(c);
        return f ? { formula: sub(f.info?.formula ?? ''), generic: f.generic } : { formula: '', generic: [] };
      },
      hrmsPpm: (c) => { try { return compoundHrms(p, c, this.factsOf(c))[0]?.ppm ?? null; } catch { return null; } },
    };
  }

  /** What the Dashboard tab acts on: the project's dashboard, or the Data section shown. */
  private dashTarget(): { scope: Scope; holder: Json; viewKey: string; save: () => Promise<void> } | null {
    const p = this.project;
    if (!p) return null;
    const pick = this.pick;
    if (pick.kind === 'dashboard') return { scope: projectScope(p), holder: p.settings, viewKey: 'project_dashboard', save: () => p.saveSettings() };
    if (pick.kind === 'section') {
      try {
        const s = p.section(pick.id);
        if (s.type === 'data') return { scope: sectionScope(s), holder: s.data, viewKey: 'dashboard', save: () => p.saveSection(s) };
      } catch { /* gone */ }
    }
    return null;
  }

  private gridOptions(scope: Scope, showSection: boolean): GridOptions {
    const p = this.project!;
    return {
      project: p, scope, showSection, rows: buildRows(p, scope, this.dashFacts()), colors: statusColors(p.settings),
      picture: (c) => { const m = this.mols.get(c.id); return m ? this.host.pictureOf(m) : null; },
      open: (c, key) => this.openAt(c, key),
    };
  }

  private get waitingForFacts(): boolean {
    const p = this.project!;
    return this.kept(p).loading || p.compounds.some((c) => !this.warnings.has(c.id));
  }

  /** A Data section's dashboard, at the top of its page. */
  private dashboardCard(out: HTMLElement, s: SiSection): void {
    const slot = el('div', 'si-dash-slot');
    const draw = (): void => { slot.replaceChildren(sectionDashboard(this.gridOptions(sectionScope(s), false), this.waitingForFacts)); };
    draw();
    this.dashRedraw = draw;
    out.append(slot);
  }

  /** The project's Dashboard page: its progress, then every compound. */
  private dashboardPage(out: HTMLElement): void {
    const p = this.project!;
    const slot = el('div', 'si-dash-slot');
    const draw = (): void => {
      const o = this.gridOptions(projectScope(p), true);
      const bySection: [SiSection, Row[]][] = p.dataSections.map((s) => [s, o.rows.filter((r) => r.compound.sectionId === s.id)]);
      const grid = el('div', 'si-card si-dash-card');
      const head = el('div', 'si-card-head');
      head.append(el('h3', 'si-sub', 'Every compound'), el('span', 'muted si-dash-sum', summaryText(o.rows)));
      grid.append(head, dashboardGrid(o));
      if (this.waitingForFacts) grid.append(el('p', 'muted si-note', 'Still reading some structures…'));
      slot.replaceChildren(projectSummaryCard({
        summary: summarize(p, bySection, this.projectWarningsNow),
        openSection: (s) => this.go({ kind: 'section', id: s.id }),
        openWarnings: () => this.go({ kind: 'warnings' }),
      }), grid);
    };
    draw();
    this.dashRedraw = draw;
    out.append(slot);
  }

  /** The Dashboard tab shows on the Dashboard and on a Data section's page, with the view's choices. */
  private dashShown(): void {
    const tab = this.ribbon.querySelector<HTMLElement>('[data-si-tab="dash"]')!;
    const t = this.dashTarget();
    tab.hidden = !t;
    if (!t) { if (tab.getAttribute('aria-selected') === 'true') this.showRibbonTab('home'); return; }
    this.ribbon.querySelector<HTMLSelectElement>('select[data-si-dash="filter"]')!.value = filterOf(t.scope);
    this.ribbon.querySelector<HTMLElement>('[data-si-dash="split"]')!.setAttribute('aria-pressed', String(isSplit(t.scope)));
    this.ribbon.querySelector<HTMLElement>('[data-si-dash="compact"]')!.setAttribute('aria-pressed', String(isCompact(t.scope)));
  }

  private async dashCommand(cmd: string, value = ''): Promise<void> {
    const p = this.project;
    const t = this.dashTarget();
    if (!p || !t) return;
    if (cmd === 'refresh') { this.forgetStructure(); this.warnings.clear(); this.shownKey = ''; this.refresh(); return; }
    if (p.readOnly) { this.host.flash('This SI project is open read-only: the dashboard’s choices can’t be saved.'); this.dashShown(); return; }
    const change = async (f: () => void): Promise<void> => {
      await this.act(async () => { f(); await t.save(); }, false);
      this.dashRedraw?.();
      this.dashShown();
    };
    if (cmd === 'filter') await change(() => setView(t.holder, 'filter', value, t.viewKey));
    else if (cmd === 'split') await change(() => setView(t.holder, 'split_nuclei', !isSplit(t.scope), t.viewKey));
    else if (cmd === 'compact') await change(() => setView(t.holder, 'compact', !isCompact(t.scope), t.viewKey));
    else if (cmd === 'columns') {
      const all = availableColumns(t.scope);
      const chosen = new Set(chosenColumns(t.scope));
      const got = await ask('Columns', all.map((k) => ({ name: k, label: fieldLabel(t.scope, k), value: String(chosen.has(k)), type: 'checkbox' as const })), {
        ok: 'Show Columns', note: 'The fields shown as columns, besides the structure, ID and name. A field added later shows unless it is unchecked here.',
      });
      if (!got) return;
      const keep = all.filter((k) => got[k] === 'true');
      await change(() => { if (keep.length === all.length) { const v = t.holder[t.viewKey]; if (v && typeof v === 'object') delete (v as Json).columns; } else setView(t.holder, 'columns', keep, t.viewKey); });
    } else if (cmd === 'colors') {
      const body = statusColorsBody(statusColors(p.settings));
      const got = await ask('Status Colors', [], { ok: 'Use Colors', note: 'The color of each kind of dashboard cell, for this project (Chem SI Assistant uses the same). Cells are tinted lightly so their text stays readable.', body: body.el });
      if (!got) return;
      const colors = body.read();
      await this.act(async () => { storeStatusColors(p.settings, colors); await p.saveSettings(); }, false);
      this.dashRedraw?.();
    }
  }

  /** Open a compound's page at one of its fields ('' for the top). */
  private openAt(c: SiCompound, key: string): void {
    this.go({ kind: 'compound', id: c.id });
    if (!key) return;
    requestAnimationFrame(() => {
      const row = this.page.querySelector<HTMLElement>(`.si-field[data-key="${CSS.escape(key)}"]`);
      if (!row) return;
      row.scrollIntoView({ block: 'center' });
      row.querySelector<HTMLElement>('input, select, textarea, [contenteditable="true"], button')?.focus({ preventScroll: true });
      row.classList.add('si-flash');
      setTimeout(() => row.classList.remove('si-flash'), 1200);
    });
  }

  /** Where a project warning is: how the Warnings page names the place, and what opens it. */
  private placeOf(w: ProjectWarning): { id: string; name: string; open: (() => void) | null } {
    const p = this.project!;
    const [kind, id] = w.place;
    if (kind === 'front') return { id: '', name: id === 'cover' ? 'Cover page' : 'General Information', open: () => this.go({ kind: 'project' }) };
    if (kind === 'references') return { id: '', name: 'References', open: () => this.go({ kind: 'references' }) };
    if (kind === 'section') {
      const s = p.sections.find((x) => x.id === id);
      if (s) return { id: '', name: s.name, open: () => this.go({ kind: 'section', id }) };
    }
    if (kind === 'scheme') {
      const k = p.schemes.find((x) => x.id === id);
      if (k) return { id: '', name: `Scheme page “${String(k.data.name || 'Scheme')}”`, open: () => this.go({ kind: 'scheme', id }) };
    }
    if (kind === 'compound') {
      const c = p.compounds.find((x) => x.id === id);
      if (c) return { id: this.idOf(c), name: compoundName(c) || 'unnamed compound', open: () => this.openAt(c, w.field) };
    }
    return { id: '', name: 'The project', open: null };
  }

  private warningsPage(out: HTMLElement): void {
    const p = this.project!;
    const card = el('div', 'si-card si-warn-list');
    const head = el('div', 'si-card-head');
    const h = el('h2', 'si-title', 'Warnings');
    addInfo(h, 'The automatic checks of every compound (HRMS, NMR, yields, spectra, IDs, general procedures), as Chem SI Assistant makes them. Warnings never block anything: dismiss those that don’t apply, with a reason. A dismissed warning comes back if the data it is about changes, and dismissals are shared with SI Assistant.');
    const show = el('label', 'si-check');
    const box = el('input');
    box.type = 'checkbox';
    box.checked = this.showDismissed;
    box.addEventListener('change', () => { this.showDismissed = box.checked; this.shownKey = ''; this.refresh(); });
    show.append(box, document.createTextNode(' Show dismissed'));
    head.append(h, show);
    card.append(head);
    let any = false;
    // the project's own warnings first, each under where it is (they are about the project, not one compound's data, so there is nothing to dismiss: SI Assistant lists them the same way)
    const own = this.projectWarningsNow;
    if (own.length) {
      any = true;
      card.append(el('h3', 'si-sub', 'Project'));
      const groups = new Map<string, ProjectWarning[]>();
      for (const w of own) groups.set(w.place.join(':'), [...(groups.get(w.place.join(':')) ?? []), w]);
      for (const list of groups.values()) {
        const at = this.placeOf(list[0]);
        const who = el(at.open ? 'button' : 'div', 'si-warn-cpd');
        if (who instanceof HTMLButtonElement) { who.type = 'button'; who.title = 'Open this page'; }
        if (at.id) who.append(el('b', 'si-cid', at.id), document.createTextNode(' ' + at.name)); else who.textContent = at.name;
        if (at.open) who.addEventListener('click', at.open);
        card.append(who);
        for (const w of list) {
          const line = el('div', 'si-warn si-warn-project');
          line.innerHTML = svg('warn', 13);
          line.append(el('span', 'si-warn-text', w.message));
          card.append(line);
        }
      }
    }
    for (const s of p.dataSections) {
      const rows: HTMLElement[] = [];
      for (const c of compoundsOf(s)) {
        const list = this.showDismissed ? this.warnings.get(c.id) ?? [] : this.activeWarnings(c);
        if (!list.length) continue;
        const who = el('button', 'si-warn-cpd');
        who.type = 'button';
        who.title = 'Open this compound';
        who.append(el('b', 'si-cid', this.idOf(c)), document.createTextNode(' ' + (compoundName(c) || 'unnamed compound')));
        who.addEventListener('click', () => this.go({ kind: 'compound', id: c.id }));
        rows.push(who, ...list.map((w) => this.warningLine(c, w, this.fieldName(c, w.field))));
      }
      if (!rows.length) continue;
      any = true;
      card.append(el('h3', 'si-sub', s.name), ...rows);
    }
    const ms = this.msState(p).result;
    const msList = ms ? ms.findings.filter((f) => f.status === 'problem' || (this.showDismissed && f.status === 'dismissed')) : [];
    if (msList.length) {
      any = true;
      const head3 = el('h3', 'si-sub', 'Manuscript Check');
      const go = el('button', 'si-link', 'Open the Manuscript Check');
      go.type = 'button';
      go.addEventListener('click', () => this.go({ kind: 'manuscript' }));
      card.append(head3, ...msList.map((f) => this.msWarningLine(f)), go);
    }
    if (this.kept(p).loading || p.compounds.some((c) => !this.warnings.has(c.id))) card.append(el('p', 'muted si-note', 'Still reading some structures…'));
    else if (!any) card.append(el('p', 'muted si-note', this.showDismissed ? 'No warnings.' : 'No warnings to look at.'));
    out.append(card);
  }

  /** A manuscript check result on the Warnings page: click it to open the compound at the field concerned. */
  private msWarningLine(f: MsFinding): HTMLElement {
    const line = el('div', `si-warn${f.status === 'dismissed' ? ' dismissed' : ''}`);
    line.innerHTML = svg('warn', 13);
    line.append(el('span', 'si-warn-text', f.message));
    const c = this.project!.compounds.find((x) => x.id === f.compound_id);
    if (c) {
      const b = el('button', 'si-link', 'Open');
      b.type = 'button';
      b.title = 'Open the compound at the field concerned';
      b.addEventListener('click', () => this.openAt(c, ({ structure: 'structure', yield: 'yield', ee: 'ee', dr: 'dr', name: 'name', conditions: 'procedure', deviation: 'procedure' } as Record<string, string>)[f.kind] ?? ''));
      line.append(b);
    }
    return line;
  }

  private partsEditor(body: HTMLElement, c: SiCompound, def: FieldDef): void {
    const p = this.project!;
    const v = valuesOf(c)[def.key];
    const value = v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {};
    const wrap = el('div', 'si-parts');
    for (const part of def.parts ?? []) {
      const cell = el('label', 'si-part');
      if (part.label && (def.parts?.length ?? 0) > 1) cell.append(el('span', 'si-plabel', part.label));
      const now = partText(value[part.key]);
      let input: HTMLInputElement | HTMLSelectElement;
      if (part.kind === 'choice') {
        const sel = el('select');
        sel.add(new Option('', ''));
        for (const ch of part.choices ?? []) sel.add(new Option(part.choiceLabels?.[ch] ?? ch, ch));
        if (now && !(part.choices ?? []).includes(now)) sel.add(new Option(now, now));
        sel.value = now;
        input = sel;
      } else {
        const inp = el('input');
        inp.value = now;
        if (part.placeholder) inp.placeholder = part.placeholder;
        if (part.kind === 'number') { inp.inputMode = 'decimal'; inp.classList.add('si-num'); }
        if (part.kind === 'combo') {
          const listId = `si-dl-${def.key}-${part.key}`;
          let dl = document.getElementById(listId) as HTMLDataListElement | null;
          if (!dl) { dl = el('datalist'); dl.id = listId; document.body.append(dl); }
          const used = this.usedValues(def, part);
          dl.replaceChildren(...learnedChoices(part, used).map((x) => new Option(x, x)));
          inp.setAttribute('list', listId);
        }
        input = inp;
      }
      input.setAttribute('aria-label', `${def.label}${part.label ? ' ' + part.label : ''}`);
      const save = (): void => void this.act(async () => {
        await p.setPart(c, def.key, part.key, input.value);
        if (def.key === 'hrms' && await this.syncFound(c)) await p.saveCompound(c);
      }, false, c);
      if (input instanceof HTMLInputElement) this.bind(input, save); else input.addEventListener('change', save);
      cell.append(input);
      if (part.suffix) cell.append(el('span', 'si-suffix', part.suffix));
      wrap.append(cell);
    }
    body.append(wrap);
    // a name filled in from PubChem says so, while it is unchanged
    const nv = valuesOf(c)[def.key];
    const from = def.key === 'name' && nv && typeof nv === 'object' && !Array.isArray(nv) ? (nv as Json).from_pubchem : null;
    if (from && typeof from === 'object' && !Array.isArray(from) && (from as Json).name === (nv as Json).text) {
      const f = from as Json;
      const note = el('div', 'muted si-note si-pubchem-note', 'Name from PubChem');
      const cid = Number(f.cid);
      if (cid > 0) {
        const a = el('a', '', `CID ${cid}`);
        a.href = PUBCHEM_PAGE + cid;
        a.addEventListener('click', (e) => { e.preventDefault(); void import('./links-ui').then(({ followLink }) => followLink(a.href)); });
        note.append(' ', a);
      }
      note.append(f.stereo === false ? ': found without stereochemistry, so check the stereodescriptors. It can be edited.' : '. It can be edited.');
      body.append(note);
    }
  }

  private usedValues(def: FieldDef, part: Part): string[] {
    const p = this.project!;
    if (!part.learn) return [];
    const out = p.usedPartValues(def.key, part.key);
    for (const also of part.learnAlso ?? []) { const [f, k] = also.split('.'); out.push(...p.usedPartValues(f, k)); }
    return out;
  }

  private textBox(body: HTMLElement, c: SiCompound, key: string, placeholder = ''): void {
    const p = this.project!;
    const box = new SiRichBox(p.compoundText(c, key), { label: this.label, mentionable: this.mentionable, changed: (t) => void this.act(() => p.writeCompoundText(c, key, t), false, c, () => box) }, true, placeholder);
    this.boxes.push(box);
    body.append(box.el);
  }

  private procedureEditor(body: HTMLElement, c: SiCompound): void {
    const p = this.project!;
    const gps = p.dataSections.flatMap((x) => p.generalProcedures(x));
    const v = valuesOf(c).procedure;
    const choice = v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {};
    const gpId = partText(choice.gp);
    if (gps.length) {
      const r = el('label', 'si-part');
      r.append(el('span', 'si-plabel', 'General procedure'));
      const sel = el('select');
      sel.add(new Option('None (type the procedure)', ''));
      for (const gp of gps) sel.add(new Option(partText(gp.name) || 'General procedure', partText(gp.id)));
      sel.value = gpId;
      sel.addEventListener('change', () => void this.act(() => p.setValue(c, 'procedure', { ...choice, gp: sel.value, values: (choice.values as Json) ?? {} })));
      r.append(sel);
      body.append(r);
    }
    const gp = p.compoundGp(c);
    if (!gp) { this.textBox(body, c, 'procedure', 'Type the experimental procedure'); return; }
    // one box per word in {braces} of the general procedure's sentence; the automatic ones show what they become
    const vals = (choice.values && typeof choice.values === 'object' ? choice.values : {}) as Json;
    const AUTO: Record<string, string> = { gp: partText(gp.name), product: this.idOf(c), scale: this.autoScale(c), yield: this.autoYield(c), purification: this.autoPurification(c) };
    const wrap = el('div', 'si-parts');
    const seen = new Set<string>();
    for (const m of partText(gp.sentence).matchAll(/\{([^{}]+)\}/g)) {
      const name = m[1].trim();
      const k = name.toLowerCase().split(/\s+/).join(' ');
      if (seen.has(k) || k === 'gp') continue;
      seen.add(k);
      const stored = Object.keys(vals).find((x) => x.toLowerCase().split(/\s+/).join(' ') === k) ?? name;
      const cell = el('label', 'si-part si-gp-part');
      cell.append(el('span', 'si-plabel', name));
      const box = new SiRichBox(partText(vals[stored]), {
        label: this.label, mentionable: this.mentionable,
        // (from the compound as it is when saved: the other boxes' values typed since the page was drawn are kept)
        changed: (t) => void this.act(() => {
          const now = valuesOf(c).procedure;
          const cur = now && typeof now === 'object' && !Array.isArray(now) ? (now as Json) : {};
          const curVals = (cur.values && typeof cur.values === 'object' && !Array.isArray(cur.values) ? cur.values : {}) as Json;
          return p.setValue(c, 'procedure', { ...cur, values: { ...curVals, [stored]: t } });
        }, false, c),
      }, false, AUTO[k] ? `auto: ${AUTO[k]}` : '');
      this.boxes.push(box);
      cell.append(box.el);
      wrap.append(cell);
    }
    body.append(wrap);
  }

  private autoScale(c: SiCompound): string {
    const v = valuesOf(c).scale as Json | undefined;
    const n = v ? partText(v.value).trim() : '';
    return n ? `${n} ${partText(v!.unit).trim() || 'mmol'}` : '';
  }
  private autoYield(c: SiCompound): string {
    const v = valuesOf(c).yield as Json | undefined;
    const n = v ? partText(v.percent).trim() : '';
    return n ? `${n}%` : '';
  }
  private autoPurification(c: SiCompound): string {
    const v = valuesOf(c).purification as Json | undefined;
    if (!v || !partText(v.method).trim()) return '';
    const inside = [partText(v.phase).trim(), partText(v.eluent).trim()].filter(Boolean).join(', ');
    return partText(v.method).trim() + (inside ? ` (${inside})` : '');
  }

  private nmrEditor(body: HTMLElement, c: SiCompound): void {
    const p = this.project!;
    const reports = (Array.isArray(valuesOf(c).nmr) ? valuesOf(c).nmr : []) as Json[];
    const save = (): Promise<void> => p.setValue(c, 'nmr', reports);
    for (const r of reports) {
      const line = el('div', 'si-nmr');
      const sel = el('select');
      for (const n of NUCLEI) sel.add(new Option(nucleusLabel(n), n));
      const nuc = partText(r.nucleus);
      if (nuc && !(NUCLEI as readonly string[]).includes(nuc)) sel.add(new Option(nuc, nuc));
      sel.value = nuc;
      sel.setAttribute('aria-label', 'Nucleus');
      sel.addEventListener('change', () => void this.act(() => { r.nucleus = sel.value; return save(); }, false, c));
      const box = new SiRichBox(partText(r.text), { label: this.label, changed: (t) => void this.act(() => { if (p.readOnly) return save(); r.text = t; return save(); }, false, c) }, false, `${nucleusLabel(nuc || '1H')} NMR (400 MHz, CDCl3) δ …`);
      this.boxes.push(box);
      const rm = el('button', 'si-mini', '✕');
      rm.type = 'button';
      rm.title = 'Remove this report';
      rm.addEventListener('click', () => void this.act(() => { if (!p.readOnly) reports.splice(reports.indexOf(r), 1); return save(); }));
      line.append(sel, box.el, rm);
      body.append(line);
    }
  }

  private citationsEditor(body: HTMLElement, c: SiCompound): void {
    const p = this.project!;
    const v = valuesOf(c).references;
    const value = (v && typeof v === 'object' && !Array.isArray(v) ? v : { text: '', refs: [] }) as Json;
    const refs = Array.isArray(value.refs) ? (value.refs as string[]) : [];
    const live = (): Json => { const now = valuesOf(c).references; return (now && typeof now === 'object' && !Array.isArray(now) ? now : value) as Json; };
    const box = new SiRichBox(partText(value.text), { label: this.label, changed: (t) => void this.act(() => p.setValue(c, 'references', { ...live(), text: t }), false, c) }, false);
    this.boxes.push(box);
    body.append(box.el);
    const chips = el('div', 'si-chips');
    for (const id of refs) {
      const r = p.reference(id);
      const n = p.references.findIndex((x) => x.id === id) + 1;
      const chip = el('span', 'si-chip', r ? `[${n}] ${shortRef(r)}` : `${id} (not in the project’s references)`);
      const x = el('button', 'si-x', '✕');
      x.type = 'button';
      x.title = 'Take this citation out';
      x.addEventListener('click', () => void this.act(() => { const now = live(); return p.setValue(c, 'references', { ...now, refs: (Array.isArray(now.refs) ? (now.refs as string[]) : []).filter((y) => y !== id) }); }));
      chip.append(x);
      chips.append(chip);
    }
    body.append(chips);
  }

  // ---------------------------------------------------------------- commands

  /** Run a change to the project, then show it; a problem is said, not thrown. */
  /**
   * `f` must not wait for another `act` (or `commitAll`) itself: a project's changes run one
   * after another, each written before the next starts, so two saves of one file can't cross.
   * `only`: the change is to this compound's values alone (the other compounds aren't checked again).
   */
  private act(f: () => Promise<unknown>, redraw = true, only?: SiCompound, typed?: () => SiRichBox): Promise<void> {
    const p = this.project;
    if (!p) return Promise.resolve();
    const k = this.kept(p);
    const rev = p.revision;
    const run = k.queue.then(async () => {
      const j = journalOf(p.folder);
      let failed = false;
      try {
        if (p.revision !== rev) throw new SiProjectError(READ_AGAIN);
        await (j ? j.step('Edit', f) : f());
      } catch (e) {
        failed = true;
        this.host.flash(e instanceof SiProjectError ? e.message : `Could not save the change: ${e instanceof Error ? e.message : String(e)}`, 8000);
        // (a text box's save: the page is not drawn again from the folder, which would take away what was typed;
        // the text stays in its box, to be saved again when the box is left, or copied when the project is read-only now)
        if (typed && p.revision === rev && this.project === p) {
          k.stale = true;
          if (p.readOnly) this.lockPage(); else typed().unsaved();
          return;
        }
      }
      // (the project of another tab by now: its page is drawn when its tab shows)
      // (anything but one compound's own values: labels and the project's warnings may have changed)
      if (!only || failed) k.stale = true;
      if (this.project !== p) return;
      if (redraw || failed) this.shownKey = '';
      try { this.refresh(failed || redraw ? undefined : only); } catch (e) { console.error('SI page could not be drawn', e); }
    });
    k.queue = run.then(() => {}, () => {});
    return k.queue;
  }

  /**
   * A change to a project's files made by a page of its own (a scheme page, an X-ray structure's),
   * or from outside the tab: in the project's queue with every other change, as one step of
   * Undo. Its failure is the caller's to say. `f` must not wait for the queue itself.
   */
  change<T>(p: SiProject, label: string, f: () => Promise<T>): Promise<T> {
    const rev = p.revision;
    return this.queued(p, () => {
      if (p.revision !== rev) throw new SiProjectError(READ_AGAIN);
      const j = journalOf(p.folder);
      return j ? j.step(label, f) : f();
    });
  }

  /** `f` in a project's queue: after the changes on their way, before any made later. */
  private queued<T>(p: SiProject, f: () => Promise<T>): Promise<T> {
    const k = this.kept(p);
    const run = k.queue.then(f);
    k.queue = run.then(() => {}, () => {});
    return run;
  }

  /** The project shown became read-only while open: its page's fields are locked where they are (what is typed in them stays, to be copied). */
  readOnlyNow(p: SiProject): void {
    if (this.project !== p) return;
    this.lockPage();
    try { this.refresh(); } catch (e) { console.error('SI page could not be drawn', e); }
  }

  private lockPage(): void {
    if (!this.project?.readOnly) return;
    this.lockFields(this.page);
    for (const x of this.page.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea')) x.disabled = true;
    for (const x of this.page.querySelectorAll<HTMLElement>('.si-rich')) x.contentEditable = 'false';
  }

  /**
   * A plain input saved as it is typed in: 0.7 s after the last key (`live`), when it is left,
   * and by commitAll (a tab switched or closed, the window closing) while it still has the keys.
   * Inputs whose change draws the page again are not `live`.
   */
  private bind(input: HTMLInputElement, save: () => void, live = true): void {
    let last = input.value;
    let timer = 0;
    const flush = (): void => {
      clearTimeout(timer);
      timer = 0;
      if (input.value === last) return;
      last = input.value;
      save();
    };
    if (live) input.addEventListener('input', () => { clearTimeout(timer); timer = window.setTimeout(flush, 700); });
    input.addEventListener('change', flush);
    this.flushers.push(flush);
  }

  /** A read-only project's fields can be read and copied, not changed. */
  private lockFields(root: HTMLElement): void {
    if (!this.project?.readOnly) return;
    for (const x of root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('.si-fields input, .si-fields select, .si-fields .si-mini, .si-fields .si-x, .si-name-input, .si-idgrid input, .si-fieldlist input, .si-fieldlist button, .si-gp input, .si-gp button, .si-spectra-row input, .si-spectra-row select')) x.disabled = true;
    for (const x of root.querySelectorAll<HTMLElement>('.si-fields .si-rich, .si-gp .si-rich')) x.contentEditable = 'false';
  }

  private key(e: KeyboardEvent): void {
    const inText = (e.target as HTMLElement).closest('input, select, textarea, [contenteditable="true"]');
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'n') { e.preventDefault(); void this.run('new-compound'); return; }
    if (e.key === 'F7' && !e.shiftKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); void this.run('spelling'); return; }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'l') { e.preventDefault(); this.setLive(!this.liveOn); return; }
    // (in a text box or a list, Alt and the arrows are the box's own keys)
    if (inText) return;
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); void this.run(e.key === 'ArrowUp' ? 'move-up' : 'move-down'); return; }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const rows = [...this.tree.querySelectorAll<HTMLElement>('.si-row')];
      const at = rows.findIndex((r) => r.classList.contains('on'));
      const next = rows[Math.max(0, Math.min(rows.length - 1, at + (e.key === 'ArrowUp' ? -1 : 1)))];
      if (next) { e.preventDefault(); next.click(); this.tree.querySelector<HTMLElement>('.si-row.on')?.focus(); }
    }
  }

  /** Home ▸ Delete (Delete in the tree): the selected compound, scheme page or section goes to the project's Trash, after asking. */
  private async deletePicked(): Promise<void> {
    const p = this.project!;
    const pick = this.pick;
    const yes = (title: string, text: string): Promise<boolean> => askChoice(title, `${text} Home ▸ Trash (or Chem SI Assistant's Trash) can put it back.`, [{ value: 'keep', label: 'Cancel' }, { value: 'delete', label: 'Delete', primary: true }], 'keep').then((x) => x === 'delete');
    if (pick.kind === 'compound') {
      const c = p.compound(pick.id);
      const k = c.schemeId ? p.scheme(c.schemeId) : null;
      if (!(await yes('Delete Compound', `Move ${this.idOf(c)} ${compoundName(c) || 'unnamed compound'} to the project's Trash? The compounds after it take the IDs before them.${k ? ' Its box in the scheme keeps a copy of its structure.' : ''}`))) return;
      const sec = p.section(c.sectionId);
      const list: { kind: 'compound' | 'scheme'; id: string }[] = k ? k.children : sec.items;
      const i = list.indexOf(c);
      await this.act(async () => {
        await p.deleteCompound(c.id);
        const next = list[Math.min(i, list.length - 1)];
        this.pick = next ? { kind: next.kind, id: next.id } : k ? { kind: 'scheme', id: k.id } : { kind: 'section', id: sec.id };
      });
      return;
    }
    if (pick.kind === 'scheme') {
      const k = p.scheme(pick.id);
      const n = k.children.length;
      if (!(await yes('Delete Scheme Page', `Move the scheme page “${String(k.data.name || 'Scheme')}”${n ? ` with its ${n} compound page${n > 1 ? 's' : ''}` : ''} to the project's Trash?`))) return;
      const sec = p.section(k.sectionId);
      const i = sec.items.indexOf(k);
      await this.act(async () => {
        await p.deleteScheme(k.id);
        const next = sec.items[Math.min(i, sec.items.length - 1)];
        this.pick = next ? { kind: next.kind, id: next.id } : { kind: 'section', id: sec.id };
      });
      return;
    }
    if (pick.kind === 'section') {
      const sec = p.section(pick.id);
      const subs = p.subtree(sec).length - 1;
      const comps = compoundsUnder(p, sec.id);
      const what = [subs ? `${subs} sub-section${subs > 1 ? 's' : ''}` : '', comps ? `${comps} compound${comps > 1 ? 's' : ''}` : ''].filter(Boolean).join(' and ');
      if (!(await yes('Delete Section', `Move the section “${sec.name}”${what ? ` with its ${what}` : ''} to the project's Trash?`))) return;
      const list = sec.parentId ? p.section(sec.parentId).children : p.top;
      const i = list.indexOf(sec);
      await this.act(async () => {
        await p.deleteSection(sec.id);
        const next = list[Math.min(i, list.length - 1)];
        this.pick = next ? { kind: 'section', id: next.id } : sec.parentId ? { kind: 'section', id: sec.parentId } : { kind: 'project' };
      });
      return;
    }
    this.host.flash('Select a compound, scheme page or section to delete.');
  }

  /** Home ▸ Duplicate: copies of the selected compound or scheme page, with the fields chosen. */
  private async duplicate(): Promise<void> {
    const p = this.project!;
    const pick = this.pick;
    if (pick.kind !== 'compound' && pick.kind !== 'scheme') { this.host.flash('Select a compound or scheme page to duplicate.'); return; }
    const c = pick.kind === 'compound' ? p.compound(pick.id) : null;
    const k = pick.kind === 'scheme' ? p.scheme(pick.id) : null;
    const sources = c ? [c] : k!.children;
    const fields = new Map<string, FieldDef>(), never = new Map<string, string>();
    for (const x of sources) {
      for (const d of copyableFields(x)) if (!fields.has(d.key)) fields.set(d.key, d);
      for (const d of neverCopiedFields(x)) never.set(d.key, d.label);
    }
    const what = c ? `${this.idOf(c)} ${compoundName(c) || 'unnamed compound'}`.trim() : `“${String(k!.data.name || 'Scheme')}”`;
    const got = await ask(`Duplicate ${c ? 'Compound' : 'Scheme Page'}`, [
      { name: 'copies', label: 'Number of copies', value: '1', type: 'number', min: 1, max: MAX_COPIES },
      { name: 'place', label: 'Where the copies go', value: 'end', options: [{ value: 'end', label: 'At the end of the section (nothing is renumbered)' }, { value: 'after', label: c?.schemeId ? 'Right after the scheme page (later IDs move up)' : 'Right after the original (later IDs move up)' }] },
      ...(fields.size ? [{ name: '_h', label: 'Copy the contents of these fields', value: '', type: 'heading' as const, help: 'Copies get the same fields; the ones not checked start empty.' }] : []),
      ...[...fields.values()].map((d) => ({ name: `f:${d.key}`, label: d.label, value: 'true', type: 'checkbox' as const })),
    ], { ok: 'Duplicate', note: `Copies of ${what}${k ? ' with its drawing and its compounds' : ''}.${never.size ? ` Never copied: ${[...never.values()].join(', ')}, the manual ID and flags (they belong to the original).` : ' Never copied: attached files, the manual ID and flags.'}` });
    if (!got) return;
    const keys = [...fields.keys()].filter((key) => got[`f:${key}`] === 'true');
    await this.act(async () => {
      const n = checkCopies(Math.round(Number(got.copies)));
      const place = got.place === 'after' ? 'after' : 'end';
      const made = c ? await duplicateCompound(p, c, keys, n, place) : await duplicateScheme(p, k!, keys, n, place);
      if (made[0]) this.pick = { kind: made[0].kind, id: made[0].id };
      this.host.flash(`Made ${made.length} cop${made.length === 1 ? 'y' : 'ies'} of ${what}.`);
    });
  }

  /** Home ▸ Rename (F2 in the tree): the selected section or scheme page. */
  private async renamePicked(): Promise<void> {
    const p = this.project!;
    const pick = this.pick;
    if (pick.kind === 'compound') { this.host.flash('A compound’s name is its Name field, on its page.'); return; }
    if (pick.kind !== 'section' && pick.kind !== 'scheme') { this.host.flash('Select a section or scheme page to rename.'); return; }
    const k = pick.kind === 'scheme' ? p.scheme(pick.id) : null;
    const sec = pick.kind === 'section' ? p.section(pick.id) : null;
    const now = k ? String(k.data.name || '') : sec!.name;
    const got = await ask(k ? 'Rename Scheme Page' : 'Rename Section', [{ name: 'name', label: 'Name', value: now }], { ok: 'Rename' });
    if (!got || !got.name.trim() || got.name.trim() === now) return;
    await this.act(async () => {
      if (k) { k.data.name = got.name.trim(); await p.saveScheme(k); } else await p.renameSection(sec!.id, got.name);
    });
    this.shownKey = '';
    this.refresh();
  }

  /** A compound of a scheme page moved off it, to right after the scheme page (its box keeps a copy of its structure). */
  private async moveOutOfScheme(id: string): Promise<void> {
    const p = this.project!;
    const c = p.compound(id);
    if (!c.schemeId) return;
    const k = p.scheme(c.schemeId);
    const sec = p.section(k.sectionId);
    await p.moveCompound(c.id, sec.id, sec.items.indexOf(k) + 1);
    this.pick = { kind: 'compound', id: c.id };
  }

  /** Insert ▸ Change to Reaction Scheme…: the selected compound becomes the product of a new scheme page in its place. */
  private async toScheme(): Promise<void> {
    const p = this.project!;
    const pick = this.pick;
    const c = pick.kind === 'compound' ? p.compound(pick.id) : null;
    if (!c) { this.host.flash('Select a compound page to change to a reaction scheme.'); return; }
    if (c.schemeId) { this.host.flash('This compound is already on a scheme page.'); return; }
    const go = await askChoice('Change to Reaction Scheme', `Make a scheme page for ${this.idOf(c)} ${compoundName(c) || 'this compound'}? The compound becomes the product of the scheme's first step (its data and ID are kept). You can then draw the scheme and add the other compounds in it.`, [{ value: 'no', label: 'Cancel' }, { value: 'yes', label: 'Change', primary: true }], 'no');
    if (go !== 'yes') return;
    await this.act(async () => { const k = await p.convertToScheme(c.id); this.pick = { kind: 'scheme', id: k.id }; });
  }

  /** Home ▸ Move To: a compound or scheme page to another Data section (a compound also into or out of a scheme page); a section into a Custom section, or to the top level. */
  private async moveTo(onlySchemes = false): Promise<void> {
    const p = this.project!;
    const pick = this.pick;
    if (onlySchemes && pick.kind !== 'compound') { this.host.flash('Select a compound to move into a scheme page.'); return; }
    if (pick.kind === 'compound' || pick.kind === 'scheme') {
      const item = pick.kind === 'compound' ? p.compound(pick.id) : p.scheme(pick.id);
      const options: { value: string; label: string }[] = [];
      if (item.kind === 'compound' && item.schemeId && !onlySchemes) options.push({ value: `out:${item.schemeId}`, label: `Out of the scheme (after the scheme page, in “${p.section(item.sectionId).name}”)` });
      for (const x of p.dataSections) if (x.id !== item.sectionId && !onlySchemes) options.push({ value: `s:${x.id}`, label: `The Data section “${x.name}”` });
      if (item.kind === 'compound') for (const k of p.schemes) if (k.id !== item.schemeId) options.push({ value: `k:${k.id}`, label: `The scheme page “${String(k.data.name || 'Scheme')}” (${p.section(k.sectionId).name})` });
      if (!options.length) { this.host.flash(onlySchemes ? 'There is no other scheme page to move it into (Insert ▸ Scheme Page makes one).' : 'There is no other Data section to move it to.'); return; }
      const got = await ask(onlySchemes ? 'Move Into Scheme' : 'Move To', [{ name: 'to', label: 'Move to', value: options[0].value, options }], { ok: 'Move', note: 'It goes at the end there; compound IDs follow the new order. A compound leaving a scheme page leaves a copy of its structure in the box that showed it; one moved into a scheme page is listed after the compounds its boxes show.' });
      if (!got) return;
      const [how, id] = [got.to.slice(0, got.to.indexOf(':')), got.to.slice(got.to.indexOf(':') + 1)];
      if (how === 'out') { await this.act(() => this.moveOutOfScheme(item.id)); return; }
      if (how === 'k') { const k = p.scheme(id); await this.act(() => p.moveCompound(item.id, k.sectionId, k.children.length, k.id)); return; }
      const to = p.section(id);
      await this.act(() => (item.kind === 'compound' ? p.moveCompound(item.id, to.id, to.items.length) : p.moveScheme(item.id, to.id, to.items.length)));
      return;
    }
    if (pick.kind === 'section') {
      const sec = p.section(pick.id);
      if (sec.type === 'xray' && sec.data.anchored) { this.host.flash('This X-ray structure is shown under its compound; move it from its page (Crystal Structure ▸ Under the Compound).'); return; }
      const inside = new Set(p.subtree(sec).map((x) => x.id));
      const height = (x: SiSection): number => 1 + Math.max(0, ...x.children.map(height));
      const options = [{ value: '', label: 'The top level' }, ...p.sections.filter((x) => x.type === 'text' && !inside.has(x.id) && x.id !== sec.parentId && p.depth(x) + height(sec) <= MAX_SECTION_DEPTH).map((x) => ({ value: x.id, label: `Inside “${x.name}”` }))].filter((o) => o.value || sec.parentId);
      if (!options.length) { this.host.flash('There is no Custom section this section can go into (sections go at most 3 levels deep).'); return; }
      const got = await ask('Move To', [{ name: 'to', label: 'Where', value: options[0].value, options }], { ok: 'Move', note: 'It goes at the end, with its sub-sections.' });
      if (!got) return;
      const list = got.to ? p.section(got.to).children : p.top;
      await this.act(() => p.moveSection(sec.id, list.length, got.to || null));
      return;
    }
    this.host.flash('Select a compound, scheme page or section to move.');
  }

  /** A tree row's right-click menu, F2 and Delete keys, and dragging it to another place. */
  private treeRowActions(r: HTMLElement, sel: Pick): void {
    r.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (JSON.stringify(sel) !== JSON.stringify(this.pick)) this.go(sel);
      this.treeMenu(sel, e.clientX, e.clientY);
    });
    r.addEventListener('keydown', (e) => {
      if (e.key === 'F2') { e.preventDefault(); void this.run('rename'); }
      else if (e.key === 'Delete') { e.preventDefault(); void this.run('delete'); }
    });
    if (this.project?.readOnly) return;
    r.draggable = true;
    r.addEventListener('dragstart', (e) => {
      SiMode.dragging = sel;
      e.dataTransfer?.setData('application/x-chemweave-si-row', JSON.stringify(sel));
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      r.classList.add('si-dragging');
    });
    r.addEventListener('dragend', () => { SiMode.dragging = null; r.classList.remove('si-dragging'); this.clearDrop(); });
    const place = (e: DragEvent) => {
      const drag = SiMode.dragging;
      if (!drag) return null;
      const box = r.getBoundingClientRect();
      return this.dropPlace(drag, sel, (e.clientY - box.top) / Math.max(1, box.height));
    };
    r.addEventListener('dragover', (e) => {
      const got = place(e);
      this.clearDrop();
      if (!got) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      r.classList.add(`si-drop-${got.where}`);
    });
    r.addEventListener('dragleave', () => r.classList.remove('si-drop-before', 'si-drop-after', 'si-drop-in'));
    r.addEventListener('drop', (e) => {
      const got = place(e);
      this.clearDrop();
      if (!got) return;
      e.preventDefault();
      const moved = SiMode.dragging!;
      SiMode.dragging = null;
      void this.act(async () => { await got.run(); this.pick = moved; });
    });
  }
  private static dragging: Pick | null = null;
  private clearDrop(): void {
    for (const x of this.tree.querySelectorAll('.si-drop-before, .si-drop-after, .si-drop-in')) x.classList.remove('si-drop-before', 'si-drop-after', 'si-drop-in');
  }

  /** The tree's right-click menu for a row (it is picked first). */
  private treeMenu(sel: Pick, x: number, y: number): void {
    const p = this.project!;
    const ro = p.readOnly;
    const items: ([string, () => void, boolean?] | null)[] = [];
    const run = (cmd: string) => (): void => { void this.run(cmd); };
    if (sel.kind === 'section') {
      const sec = p.section(sel.id);
      if (sec.type === 'data') items.push(['New Compound', run('new-compound'), !ro], ['New Scheme Page', run('new-scheme'), !ro], null);
      items.push(['New Section…', run('new-section'), !ro], null);
      items.push(['Rename…', run('rename'), !ro], ['Move Up', run('move-up'), !ro], ['Move Down', run('move-down'), !ro], ['Move To…', run('move-to'), !ro], null, ['Delete', run('delete'), !ro && sec.type !== 'spectra']);
    } else if (sel.kind === 'compound' || sel.kind === 'scheme') {
      const inScheme = sel.kind === 'compound' && !!p.compound(sel.id).schemeId;
      if (sel.kind === 'scheme') items.push(['Rename…', run('rename'), !ro]);
      items.push(['Duplicate…', run('duplicate'), !ro], null);
      items.push(['Move Up', run('move-up'), !ro], ['Move Down', run('move-down'), !ro], ['Move To…', run('move-to'), !ro]);
      if (inScheme) items.push(['Move Out of Scheme', run('out-of-scheme'), !ro]);
      else if (sel.kind === 'compound') items.push(['Change to Reaction Scheme…', run('to-scheme'), !ro]);
      items.push(null, ['Delete', run('delete'), !ro]);
    } else return;
    items.push(null, ['Trash…', run('trash')]);
    popupMenu(x, y, items);
  }

  /**
   * Where a row dragged in the tree would go if dropped on `target` at `frac` of its height:
   * before or after it, or (a section on a Custom section's middle, an item on a Data section) inside it.
   */
  private dropPlace(drag: Pick, target: Pick, frac: number): { where: 'before' | 'after' | 'in'; run: () => Promise<void> } | null {
    const p = this.project!;
    if (JSON.stringify(drag) === JSON.stringify(target)) return null;
    if (drag.kind === 'section' && target.kind === 'section') {
      const s = p.section(drag.id), t = p.section(target.id);
      if (s.type === 'xray' && s.data.anchored) return null;
      if (p.subtree(s).includes(t)) return null;
      const height = (x: SiSection): number => 1 + Math.max(0, ...x.children.map(height));
      const canIn = t.type === 'text' && p.depth(t) + height(s) <= MAX_SECTION_DEPTH;
      const where = canIn && frac > 0.3 && frac < 0.7 ? 'in' : frac < 0.5 ? 'before' : 'after';
      if (where === 'in') return { where, run: () => p.moveSection(s.id, t.children.length, t.id) };
      const parent = t.parentId ? p.section(t.parentId) : null;
      if (parent && p.depth(parent) + height(s) > MAX_SECTION_DEPTH) return null;
      const list = parent ? parent.children : p.top;
      const at = list.indexOf(t) + (where === 'after' ? 1 : 0);
      return { where, run: () => p.moveSection(s.id, at, parent?.id ?? null) };
    }
    if (drag.kind === 'compound' || drag.kind === 'scheme') {
      const item = drag.kind === 'compound' ? p.compound(drag.id) : p.scheme(drag.id);
      const move = (to: string, at: number, scheme: string | null = null) => (): Promise<void> => (item.kind === 'compound' ? p.moveCompound(item.id, to, at, scheme) : p.moveScheme(item.id, to, at));
      if (target.kind === 'section') {
        const t = p.section(target.id);
        return t.type === 'data' ? { where: 'in', run: move(t.id, t.items.length) } : null;
      }
      if (target.kind === 'compound' || target.kind === 'scheme') {
        const t = target.kind === 'compound' ? p.compound(target.id) : p.scheme(target.id);
        // a compound dropped on the middle of a scheme page's row goes into it (after its compounds)
        if (item.kind === 'compound' && t.kind === 'scheme') {
          // (a scheme page's own compounds are listed right under its row: a drop on the row's lower part
          // goes into the scheme, never past its compounds; one of its own compounds stays where it is)
          const low = t.children.length ? frac >= 0.3 : frac > 0.3 && frac < 0.7;
          if (low) return item.schemeId === t.id ? null : { where: 'in', run: move(t.sectionId, t.children.length, t.id) };
        }
        const where = frac < 0.5 ? 'before' : 'after';
        if (t.kind === 'compound' && t.schemeId) {
          // among a scheme page's compounds (only compounds go there)
          if (item.kind !== 'compound') return null;
          const k = p.scheme(t.schemeId);
          return { where, run: move(k.sectionId, k.children.indexOf(t) + (where === 'after' ? 1 : 0), k.id) };
        }
        const sec = p.section(t.sectionId);
        return { where, run: move(sec.id, sec.items.indexOf(t) + (where === 'after' ? 1 : 0)) };
      }
    }
    return null;
  }

  /** Compile the project into a document (SI Assistant's layout), opened in a tab of its own; what was left out is said after. */
  private async compile(pdf: boolean): Promise<void> {
    const p = this.project;
    if (!p) return;
    this.host.flash('Compiling the SI…', 1500);
    let got;
    try {
      // (what is being typed, and every save on its way, is in the folder before it is read)
      await this.commitAll();
      got = await compileSi(p, {
        contentsOf: (m) => this.host.contentsOf(m), sizeOf: (c) => this.host.sizeOf(c), facts: (m) => this.host.siFacts(m),
        pdfPages: (b, most) => import('../render/pdf-page').then((m) => m.pdfPages(b, most)),
        contentBox: (src) => import('../render/pdf-page').then((m) => m.pictureContentBox(src)),
      });
    } catch (e) {
      this.host.flash(`Could not compile the SI: ${e instanceof Error ? e.message : String(e)}`, 6000);
      return;
    }
    await this.host.openCompiled(got.doc, `${p.title} SI`, pdf);
    if (got.notes.length) {
      await ask('Compile Notes', [], { noCancel: true, ok: 'OK', note: `The SI was compiled. ${got.notes.length === 1 ? 'One thing' : `${got.notes.length} things`} to know:`, points: got.notes });
    }
  }

  /**
   * SI Project ▸ Import SI…: a Word or PDF SI read, its general procedures, compounds, sections,
   * figures, tables and references shown in the review window, and what is kept written into
   * this project (or a new one) as one Undo step (SI Assistant's File ▸ Import SI…).
   */
  /** An SI is being imported (read, reviewed or written): a second import waits for it. */
  private importing = false;

  private async importSi(): Promise<void> {
    if (this.importing) { this.host.flash('An SI is being imported already. Wait for it to finish, then import the next one.'); return; }
    this.importing = true;
    try { await this.importSiNow(); } finally { this.importing = false; }
  }

  private async importSiNow(): Promise<void> {
    const [f] = await this.host.pickFiles('Supporting Information (Word or PDF)', ['docx', 'pdf']);
    if (!f) return;
    await this.commitAll();
    const [{ readSiFile }, I, { askImport, importSummary, importProgress }, { applyPlan }, { emfToSvg }] = await Promise.all([
      import('../si/si-import-read'), import('../si/si-import'), import('./si-import-dialog'), import('../si/si-import-apply'), import('../render/emf-read'),
    ]);
    // A window of its own from here to the end: the project can't be changed while the SI is read
    // and written (a change would become part of the import's Undo step), and reading can be cancelled.
    const busy = importProgress(`Import SI: ${f.name}`);
    let pdf: import('../si/si-import-pdf').PdfPages | null = null;
    try {
      busy.say(`Reading “${f.name}”…`);
      let read;
      try {
        read = await readSiFile(f.name, f.bytes, (done, total) => { busy.say(`Reading “${f.name}”: ${done} of ${total}`); return !busy.cancelled; });
      } catch (e) {
        busy.close();
        this.host.flash(`“${f.name}” could not be read: ${e instanceof Error ? e.message : String(e)}`, 8000);
        return;
      }
      if (busy.cancelled || read.stopped) return;
      if (read.error) { busy.hide(); await ask('Import SI', [], { noCancel: true, ok: 'OK', note: read.error }); return; }
      busy.say('Finding the compounds…');
      await new Promise((r) => setTimeout(r, 0));
      const plan = I.analyse(read.paras);
      if (plan.objects?.length) {
        // Word: structures from the SI's ChemDraw drawings (by their labels, or a compound's own
        // drawing), then its Mnova spectra, each matched to its compound
        const [{ assignStructures }, { wordSpectra }, { loadCdxmlReader, cdxmlMolfile }] = await Promise.all([import('../si/si-import-structures'), import('../si/si-import-spectra'), import('../si/ms-read')]);
        await loadCdxmlReader();
        const tools = { facts: (ms: string[]) => this.host.siFacts(ms).catch(() => ms.map(() => null)), molfileOf: cdxmlMolfile };
        busy.say('Reading the structures and spectra…');
        await new Promise((r) => setTimeout(r, 0));
        try { await assignStructures(plan, tools); } catch { /* the structures can still be drawn by hand */ }
        if (busy.cancelled) return;
        try { plan.spectra = await wordSpectra(plan, tools); } catch { /* the spectra can still be added by hand */ }
      } else if (read.kind === 'pdf' && read.data) {
        // PDF: each compound's drawing, the sections' figures and tables, and the spectrum pages cut out as pictures
        const [{ PdfPages, addPictures, addFigures }, { pdfSpectra }] = await Promise.all([import('../si/si-import-pdf'), import('../si/si-import-spectra')]);
        pdf = await PdfPages.open(read.data);
        if (pdf) {
          try {
            await addPictures(pdf, plan, (d, t) => { busy.say(`Cutting out the structures: ${d} of ${t}`); return !busy.cancelled; });
            busy.say('Cutting out the figures and tables…');
            await addFigures(pdf, plan, () => !busy.cancelled);
            plan.spectra = await pdfSpectra(pdf, plan, read.spectrum_pages, (d, t) => { busy.say(`Cutting out the spectra: page ${d} of ${t}`); return !busy.cancelled; });
          } catch { /* what was cut out stands; the rest can be added by hand */ }
        }
      }
      if (busy.cancelled) return;
      busy.hide();
      if (!plan.compounds.length && !plan.gps.length && !plan.sections.length) {
        await ask('Import SI', [], { noCancel: true, ok: 'OK', note: `No compounds, general procedures or sections were recognized in “${f.name}”. Compounds are found by a heading with the name and ID, such as “1-Phenylethanol (2a).”, followed by its data.`, points: read.notes });
        return;
      }
      const p = this.project;
      const thePdf = pdf;
      const choice = await askImport(plan, read, {
        pictureOf: (m) => this.host.pictureOf(m),
        analyze: (m) => this.host.analyze(m),
        dataSections: p && !p.readOnly ? p.dataSections.map((s) => ({ id: s.id, name: s.name })) : null,
        canMakeProject: !!this.host.newSiProject,
        afterOutline: thePdf ? async (pl) => { await import('../si/si-import-pdf').then((m) => m.addFigures(thePdf, pl)); } : undefined,
      });
      pdf?.close();
      pdf = null;
      if (!choice) return;
      const target = choice.newProject ? await this.host.newSiProject?.() ?? null : p;
      if (!target) return;
      if (target.readOnly) { this.host.flash('This SI project is open read-only.'); return; }
      // (a drawing's or a Mnova spectrum's EMF as an SVG, its EMF kept beside it to convert again)
      const fromEmf = async (emf: Uint8Array): Promise<[Uint8Array, string, Uint8Array | null, string] | null> => {
        const svg = emfToSvg(emf);
        return svg ? [new TextEncoder().encode(svg.svg), '.svg', emf, '.emf'] : null;
      };
      await this.commitAll();
      journalOf(target.folder)?.settle();
      busy.canCancel(false);        // (from here it is one Undo step: Edit ▸ Undo takes it back)
      busy.say('Writing the compounds and sections…');
      busy.show();
      let result;
      try {
        result = await applyPlan(target, plan, read.file_name, {
          mode: choice.mode, sectionId: choice.sectionId,
          pictureFor: fromEmf, figureFor: fromEmf, spectrumFor: fromEmf,
          factsOf: async (m) => (await this.host.siFacts([m]))[0] ?? null,
          progress: (_d, _t, text) => busy.say(text),
        });
      } catch (e) {
        busy.close();
        this.host.flash(`The import stopped: ${e instanceof Error ? e.message : String(e)}. What was written so far is one step of Edit ▸ Undo.`, 10000);
        return;
      } finally {
        this.forgetStructure();
        this.labelsRead = false;
        this.shownKey = '';
        this.refresh();
        this.host.changed();
      }
      busy.close();
      await ask('Import SI', [], { noCancel: true, ok: 'OK', note: `Imported “${read.file_name}”. Edit ▸ Undo takes the whole import back.`, points: importSummary(result, plan) });
    } finally {
      pdf?.close();
      busy.close();
    }
  }

  /** Commands that change nothing themselves (Trash… makes a step of each thing done in it). */
  private static NO_STEP = new Set(['import-si', 'trash', 'reload', 'snapshot', 'project-settings', 'warnings', 'compile-doc', 'compile-pdf', 'spelling', 'live-preview']);

  /** A ribbon command, as one step of Undo (named as on its button). */
  async run(cmd: string): Promise<void> {
    const p = this.project;
    if (!p) return;
    try {
      const j = !SiMode.NO_STEP.has(cmd) ? journalOf(p.folder) : null;
      if (!j) { await this.command(cmd); return; }
      // (what was typed is saved as its own step first, so Undo takes the command back alone)
      await this.commitAll();
      if (this.project !== p) return;
      j.settle();
      await j.step(this.commandName(cmd), () => this.command(cmd));
    } catch (e) {
      this.host.flash(e instanceof SiProjectError ? e.message : `${this.commandName(cmd)} did not finish: ${e instanceof Error ? e.message : String(e)}`, 8000);
      if (this.project === p) { this.shownKey = ''; try { this.refresh(); } catch { /* (said already) */ } }
    }
  }

  /** What Undo calls a command: its button's name ("Undo Duplicate"). */
  private commandName(cmd: string): string {
    const b = this.ribbon?.querySelector<HTMLElement>(`[data-si="${cmd}"]`);
    const text = b ? [...b.childNodes].filter((n) => !(n instanceof HTMLElement && n.classList.contains('rb-icon'))).map((n) => n.textContent ?? '').join('').replace(/[…\s]+$/u, '').trim() : '';
    return text || ({ delete: 'Delete', rename: 'Rename', 'move-up': 'Move Up', 'move-down': 'Move Down', 'new-compound': 'New Compound', 'manual-id': 'Manual ID', 'ref-edit': 'Edit Reference' } as Record<string, string>)[cmd] || 'Change';
  }

  /** The name of the step Undo (or Redo) would take back: null with none. */
  history(redo: boolean): string | null {
    const j = this.project && !this.project.readOnly ? journalOf(this.project.folder) : null;
    return j ? j.history(redo) : null;
  }

  /** Edit ▸ Undo (Ctrl+Z) and Redo: the project's files as they were before (or after) the step; a typed change not yet saved is saved first. */
  undo(redo = false): Promise<void> {
    // (one at a time: Ctrl+Z held down never starts an Undo while another is putting files back)
    // (nothing is typed on the page until it is drawn again: its fields are of the project as it was before)
    this.undos++;
    this.page.inert = true;
    const run = this.undoing.then(() => this.undoNow(redo)).finally(() => { if (--this.undos === 0) this.page.inert = false; });
    this.undoing = run.then(() => {}, () => {});
    return run;
  }
  private undoing: Promise<void> = Promise.resolve();
  private undos = 0;

  private async undoNow(redo: boolean): Promise<void> {
    const p = this.project;
    const j = p ? journalOf(p.folder) : null;
    if (!p || !j) return;
    if (p.readOnly) { this.host.flash('This SI project is open read-only.'); return; }
    await this.commitAll();
    if (this.project !== p) return;
    let label: string | null = null;
    try {
      // (in the project's queue, with the folder read again: no change runs between the files put back and the page drawn from them;
      // the lock is checked once, before: a check that failed half-way would leave the step half put back)
      label = await this.queued(p, async () => {
        const got = await p.whileSure(() => (redo ? j.redo() : j.undo()));
        if (got !== null) {
          try { await p.reload(); } catch (e) { this.host.flash(`The project could not be read again: ${e instanceof Error ? e.message : String(e)}`, 8000); }
        }
        return got;
      });
    } catch (e) {
      this.host.flash(e instanceof Error ? e.message : String(e), 9000);
      return;
    }
    if (label === null) { this.host.flash(redo ? 'Nothing to redo.' : 'Nothing to undo.'); return; }
    this.forgetStructure(undefined, p);
    if (this.project !== p) return;
    this.shownKey = '';
    this.refresh();
    void this.loadDictionary(true);
    this.host.changed();
    this.host.flash(`${redo ? 'Redid' : 'Undid'} ${label}.`, 2500);
    // (keys go on to the tree, for the next Ctrl+Z)
    if (!this.pane.contains(document.activeElement)) (this.tree.querySelector<HTMLElement>('.si-row.on') ?? this.tree).focus({ preventScroll: true });
  }

  private async command(cmd: string): Promise<void> {
    const p = this.project;
    if (!p) return;
    if (p.readOnly && !['reload', 'project-settings', 'warnings', 'compile-doc', 'compile-pdf', 'trash'].includes(cmd)) { this.host.flash('This SI project is open read-only.'); return; }
    await this.commitAll();
    if (this.project !== p) return;
    const s = this.currentSection();
    const c = this.currentCompound();
    const data = s?.type === 'data' ? s : null;
    const needData = (): SiSection | null => {
      if (data) return data;
      const only = p.dataSections;
      if (only.length === 1) return only[0];
      this.host.flash(only.length ? 'Select a Data section (or a compound in one) first.' : 'Make a Data section first: New Section ▸ Data section.');
      return null;
    };
    switch (cmd) {
      case 'new-table': {
        let sec = s;
        while (sec && sec.type !== 'text' && sec.parentId) sec = p.section(sec.parentId);
        if (sec?.type !== 'text') { this.host.flash('Select a Custom section (one with text) for the table.'); return; }
        await this.newTable(sec);
        return;
      }
      case 'new-figure':
      case 'new-figure-draw':
      case 'new-figure-paste':
      case 'new-figure-compound': {
        let sec = s;
        while (sec && sec.type !== 'text' && sec.parentId) sec = p.section(sec.parentId);
        if (sec?.type !== 'text') { this.host.flash('Select a Custom section (one with text) for the figure.'); return; }
        await this.newFigure(sec, cmd === 'new-figure' ? 'picture' : (cmd.slice(11) as 'draw' | 'paste' | 'compound'));
        return;
      }
      case 'new-gp': {
        const d = needData();
        if (!d) return;
        await this.act(async () => { await p.addGeneralProcedure(d.id); this.pick = { kind: 'section', id: d.id }; });
        return;
      }
      case 'add-author':
      case 'add-affiliation':
        if (this.pick.kind !== 'project' || !this.front) { this.pick = { kind: 'project' }; this.shownKey = ''; this.refresh(); }
        this.front?.add(cmd === 'add-author' ? 'author' : 'affiliation');
        return;
      case 'symbol':
        this.host.openSymbols();
        return;
      case 'new-scheme': {
        const d = needData();
        if (!d) return;
        const at = c && c.sectionId === d.id && !c.schemeId ? d.items.indexOf(c) + 1 : undefined;
        await this.act(async () => { const made = await p.addScheme(d.id, at); this.pick = { kind: 'scheme', id: made.id }; });
        return;
      }
      case 'new-compound': {
        const d = needData();
        if (!d) return;
        const at = c && c.sectionId === d.id && !c.schemeId ? d.items.indexOf(c) + 1 : undefined;
        await this.act(async () => { const made = await p.addCompound(d.id, at); this.pick = { kind: 'compound', id: made.id }; });
        return;
      }
      case 'new-section': {
        // inside the Custom section picked (a sub-section), or after the selected section
        let top = s;
        while (top?.parentId) top = p.section(top.parentId);
        const canNest = !!s && s.type === 'text' && p.depth(s) < MAX_SECTION_DEPTH;
        const fields: Parameters<typeof ask>[1] = [
          { name: 'type', label: 'Kind', value: 'data', options: [{ value: 'data', label: 'Data section (compounds)' }, { value: 'text', label: 'Custom section (text)' }, { value: 'file', label: 'Attachment section (a PDF or picture)' }, { value: 'xray', label: 'X-ray structure (a crystal structure from its CIF)' }] },
          { name: 'name', label: 'Name', value: '', placeholder: 'e.g. Synthesis and Characterization' },
        ];
        if (canNest) fields.push({ name: 'where', label: 'Where', value: 'after', options: [{ value: 'after', label: `After “${top!.name}”` }, { value: 'inside', label: `Inside “${s!.name}” (a sub-section)` }] });
        const got = await ask('New Section', fields, { ok: 'Make Section' });
        if (!got || !got.name.trim()) return;
        const inside = canNest && got.where === 'inside';
        const at = inside ? undefined : top ? p.top.indexOf(top) + 1 : undefined;
        await this.act(async () => {
          const made = await p.addSection(got.type as 'data' | 'text' | 'file' | 'xray', got.name.trim(), at, inside ? s!.id : null);
          // (an X-ray structure made with a compound picked shows that compound)
          if (made.type === 'xray' && c) { made.data.compound = c.id; await p.saveSection(made); }
          this.pick = { kind: 'section', id: made.id };
        });
        return;
      }
      case 'delete': await this.deletePicked(); return;
      case 'rename': await this.renamePicked(); return;
      case 'move-to': await this.moveTo(); return;
      case 'into-scheme': await this.moveTo(true); return;
      case 'out-of-scheme': {
        if (!c?.schemeId) { this.host.flash('Select a compound of a scheme page.'); return; }
        await this.act(() => this.moveOutOfScheme(c.id));
        return;
      }
      case 'to-scheme': await this.toScheme(); return;
      case 'duplicate': await this.duplicate(); return;
      case 'snapshot': {
        const got = await ask('Save Snapshot', [{ name: 'label', label: 'Name', value: '', placeholder: 'e.g. submitted' }], { ok: 'Save Snapshot', note: 'The whole project is zipped into its snapshots folder, named with today’s date and time and this name. Snapshots and build files are left out.' });
        if (!got) return;
        this.host.flash('Saving the snapshot…', 1500);
        await this.act(async () => { const path = await saveSnapshot(p, got.label); this.host.flash(`Saved the snapshot ${path}.`, 5000); }, false);
        return;
      }
      case 'trash':
        await openTrash(p, (message) => { this.forgetStructure(); this.shownKey = ''; this.refresh(); this.host.changed(); this.host.flash(message, 3000); });
        return;
      case 'move-up':
      case 'move-down': {
        const step = cmd === 'move-up' ? -1 : 1;
        if (c) {
          const [sid, kid, i] = p.position(c);
          const size = kid ? p.scheme(kid).children.length : p.section(sid).items.length;
          const j = i + step;
          if (j < 0 || j >= size) return;
          await this.act(() => p.moveCompound(c.id, sid, step > 0 ? j + 1 : j, kid));
          if (kid && p.position(c)[2] === i) this.host.flash('A scheme page’s compounds follow the order of their boxes: move the box in the scheme instead.', 4000);
        } else if (s) {
          const list = s.parentId ? p.section(s.parentId).children : p.top;
          const i = list.indexOf(s), j = i + step;
          if (j < 0 || j >= list.length) return;
          await this.act(() => p.moveSection(s.id, step > 0 ? j + 1 : j, s.parentId));
        }
        return;
      }
      case 'id-table': {
        const d = needData();
        if (d) this.go({ kind: 'section', id: d.id });
        return;
      }
      case 'fill-pattern': {
        const d = needData();
        if (!d) return;
        const got = await ask('Fill from Pattern', [
          { name: 'prefix', label: 'Starts with', value: '', placeholder: 'e.g. 3 or S' },
          { name: 'style', label: 'Then', value: 'letters', options: [{ value: 'letters', label: 'letters (a, b, c…)' }, { value: 'numbers', label: 'numbers (1, 2, 3…)' }] },
          { name: 'start', label: 'From', value: 'a', placeholder: 'a or 1' },
          { name: 'count', label: 'How many', value: String(Math.max(compoundsOf(d).length, 1)), type: 'number', min: 1, max: 999 },
        ], { ok: 'Fill', note: 'The ID table gets this many IDs, from row 1. Manual IDs on compounds stay as they are.' });
        if (!got) return;
        let ids: string[];
        try { ids = patternIds(got.prefix.trim(), got.style as 'letters' | 'numbers', got.start.trim(), Math.max(0, Math.round(Number(got.count) || 0))); } catch (e) { this.host.flash(e instanceof Error ? e.message : String(e)); return; }
        await this.act(() => p.setIdTable(d.id, ids));
        return;
      }
      case 'pages-for-ids': {
        const d = needData();
        if (!d) return;
        const ids = p.idsWithoutPages(d);
        if (!ids.length) { this.host.flash('Every ID in the table has a compound page already.'); return; }
        await this.act(async () => { for (const _ of ids) await p.addCompound(d.id); });
        this.host.flash(`Added ${ids.length} compound page${ids.length === 1 ? '' : 's'}: ${ids.join(', ')}.`);
        return;
      }
      case 'manual-id': {
        if (!c) { this.host.flash('Select a compound first.'); return; }
        const got = await ask('Compound ID', [{ name: 'id', label: 'Manual ID', value: idOverride(c), placeholder: 'empty: the ID from the section’s table' }], { ok: 'Set ID', note: 'A Manual ID replaces the compound’s ID, but it still uses up its row of the ID table, so the compounds after it keep theirs.' });
        if (got) await this.act(() => p.setIdOverride(c, got.id));
        return;
      }
      case 'edit-structure':
        if (!c) { this.host.flash('Select a compound first.'); return; }
        this.editStructure(c);
        return;
      case 'from-library': await this.fromLibrary(needData()); return;
      case 'to-library': {
        const list = c ? [c] : data ? compoundsOf(data) : p.compounds;
        await this.toLibrary(list);
        return;
      }
      case 'cite-library': await this.citeFromLibrary(this.pick.kind === 'references' ? null : c); return;
      case 'ref-doi': case 'ref-new': case 'ref-import': case 'ref-edit': case 'ref-delete': await this.references(cmd); return;
      case 'name-pubchem': await this.nameFromPubChem(c); return;
      case 'structure-to-name': await this.structureToName(c ? [c] : data ? compoundsOf(data).filter((x) => !compoundName(x)) : []); return;
      case 'add-field': {
        // the selected compound gets the field; a Data section picked gets it on its list of fields
        if (!c && data && this.pick.kind === 'section') {
          const entries = defaultFieldsOf(data);
          const got = await this.chooseField(entries.map((e) => e.key));
          if (got) await this.act(() => p.setDefaultFields(data.id, [...entries, { ...got, required: false }]));
          return;
        }
        if (!c) { this.host.flash('Select a compound, or a Data section to change its list of fields.'); return; }
        const got = await this.chooseField(fieldKeys(c));
        if (got) await this.act(() => p.addField(c, got));
        return;
      }
      case 'add-stored': {
        if (!c) { this.host.flash('Select a compound first.'); return; }
        if (p.readOnly) { this.host.flash('This project is open read-only.'); return; }
        const files = await this.host.pickFiles('Files to store', []);
        if (files.length) await this.addStored(c, files);
        return;
      }
      case 'add-spectra':
      case 'add-files': {
        if (!c) { this.host.flash('Select a compound first.'); return; }
        const key = cmd === 'add-spectra' ? 'spectra' : 'files';
        if (!fieldKeys(c).includes(key)) await p.addField(c, { key });
        await this.addFiles(c, ALL_FIELDS.get(key)!);
        return;
      }
      case 'add-hrms-report': {
        if (!c) { this.host.flash('Select a compound first.'); return; }
        const files = await this.host.pickFiles('HRMS reports', REPORT_EXTS);
        if (files.length) await this.addReports(c, files);
        return;
      }
      case 'live-preview':
        this.setLive(!this.liveOn);
        return;
      case 'paste-spectrum':
        if (!c) { this.host.flash('Select a compound first.'); return; }
        await this.pasteSpectrum(c);
        return;
      case 'paste-structure':
        if (!c) { this.host.flash('Select a compound first.'); return; }
        await this.pasteStructure(c);
        return;
      case 'add-nmr-report': {
        if (!c) { this.host.flash('Select a compound first.'); return; }
        const reports = (Array.isArray(valuesOf(c).nmr) ? valuesOf(c).nmr : []) as Json[];
        const used = new Set(reports.map((r) => partText(r.nucleus)));
        const nucleus = (['1H', '13C', '19F', '31P'] as const).find((n) => !used.has(n)) ?? '1H';
        if (!fieldKeys(c).includes('nmr')) await p.addField(c, { key: 'nmr' });
        await this.act(() => p.setValue(c, 'nmr', [...reports, { id: newId('r'), nucleus, label: '', text: '' }]));
        return;
      }
      case 'apply-fields': {
        const d = needData();
        if (!d) return;
        let n = 0;
        await this.act(async () => { n = await p.applyDefaultFields(d.id); });
        this.host.flash(n ? `Updated the fields of ${n} compound page${n === 1 ? '' : 's'}.` : 'Every compound page has the section’s fields already.');
        return;
      }
      case 'warnings':
        this.go({ kind: 'warnings' });
        return;
      case 'spelling':
        if (!nextMisspelled(this.page)) this.host.flash(typingPrefs.spelling ? 'No misspelled words on this page.' : 'The spelling check is off (Edit ▸ Typing and Spelling).');
        return;
      case 'compile-doc':
      case 'compile-pdf':
        await this.compile(cmd === 'compile-pdf');
        return;
      case 'import-si': await this.importSi(); return;
      case 'reload':
        this.forgetStructure();
        await this.act(() => p.reload());
        this.host.changed();
        this.host.flash('Read the project folder again.');
        return;
      case 'project-settings':
        this.projectSettings();
        return;
    }
  }

  /** Home ▸ Project Settings: the project's settings window (at a page: output, headings, page, labels, structures, schemes). */
  projectSettings(page?: string): void {
    const p = this.project;
    if (!p) return;
    import('./si-settings').then(({ siSettingsWindow }) => siSettingsWindow(p, {
      save: (change) => this.act(async () => {
        if (p.readOnly) { this.host.flash('This SI project is open read-only.'); return; }
        await change();
        await p.saveSettings();
        // (structures and schemes are drawn again in the style chosen)
        this.forgetStructure();
        this.host.changed();
      }),
      chooseDrawingStyle: (current, note) => this.host.chooseDrawingStyle(current, note),
      dictionaryChanged: () => void this.loadDictionary(true),
    }, page), (e: unknown) => this.host.flash(`Could not open the settings: ${String(e)}`));
  }

  /** Pick one of the library's fields (or make one), leaving out those the page has. */
  private async chooseField(have: string[]): Promise<FieldEntry | null> {
    const options = [...CORE_FIELDS, ...LIBRARY_FIELDS].filter((f) => !have.includes(f.key) && f.kind !== 'structure').map((f) => ({ value: f.key, label: f.label }));
    options.push({ value: '+custom', label: 'A custom field…' });
    const got = await ask('Add Field', [{ name: 'key', label: 'Field', value: options[0]?.value ?? '+custom', options }], { ok: 'Add' });
    if (!got) return null;
    if (got.key !== '+custom') return { key: got.key };
    const own = await ask('Custom Field', [
      { name: 'label', label: 'Name', value: '', placeholder: 'e.g. Purity' },
      { name: 'type', label: 'Kind', value: 'short_text', options: [{ value: 'short_text', label: 'Short text' }, { value: 'long_text', label: 'Long text' }, { value: 'number_unit', label: 'Number with unit' }, { value: 'file', label: 'File(s)' }] },
    ], { ok: 'Add' });
    if (!own || !own.label.trim()) return null;
    const key = 'custom_' + own.label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30);
    if (ALL_FIELDS.has(key) || have.includes(key)) { this.host.flash('There is a field with that name already.'); return null; }
    return { key, custom: { label: own.label.trim(), type: own.type } };
  }

  private editStructure(c: SiCompound): void {
    const p = this.project!;
    if (p.readOnly) { this.host.flash('This SI project is open read-only.'); return; }
    void p.readStructure(c).then((mol) => {
      const contents = mol ? this.host.contentsOf(mol) : null;
      this.host.editStructure(contents, `${this.idOf(c)} ${compoundName(c) || 'Structure'}`.trim(), (got) => {
        if (!got) return;
        if (!got.atoms.length) { this.host.flash('Nothing was drawn, so the structure is as it was.'); return; }
        const m = this.host.molfileOf(got);
        if (!m.molblock) { this.host.flash(m.problem ?? 'The drawing could not be read as a structure.'); return; }
        void this.act(async () => { await p.setStructure(c, m.molblock!); this.forgetStructure(c); });
      });
    });
  }

  /** The clipboard read (or a paste event's), with a message when it can't be. */
  private async clipboard(e?: ClipboardEvent): Promise<Pasted | null> {
    try { return await this.host.readClipboard(e); } catch (err) { this.host.flash(`The clipboard could not be read: ${err instanceof Error ? err.message : String(err)}`); return null; }
  }

  /** Paste ▸ a spectrum (Mnova's metafile kept beside its SVG; a PDF or picture as it is), its type picked with one click. */
  private async pasteSpectrum(c: SiCompound, e?: ClipboardEvent): Promise<void> {
    const p = this.project!;
    if (p.readOnly) { this.host.flash('This SI project is open read-only.'); return; }
    await this.commitAll();
    const got = await this.clipboard(e);
    if (!got) return;
    let main: { ext: string; bytes: Uint8Array } | null = null;
    let original: Uint8Array | null = null;
    let how: Parameters<typeof keptLine>[0] = 'picture';
    if (got.kind === 'picture') {
      if (got.mime === 'image/x-emf') {
        const { emfToSvg } = await import('../render/emf-read');
        const svg = emfToSvg(got.bytes);
        if (svg) { main = { ext: 'svg', bytes: new TextEncoder().encode(svg.svg) }; original = got.bytes; how = svg.vectors > 0 ? 'svg' : 'emf-picture'; }
        else { this.host.flash('The copied spectrum could not be read. Copy it in Mnova again (Enhanced Windows Metafile), or save it as a PDF and add it with Insert ▸ Spectra.', 8000); return; }
      } else if (got.mime === 'application/pdf') { main = { ext: 'pdf', bytes: got.bytes }; how = 'pdf'; }
      else if (got.mime === 'image/svg+xml') { main = { ext: 'svg', bytes: got.bytes }; how = 'svg'; }
      else {
        const ext = got.mime === 'image/jpeg' ? 'jpg' : got.mime === 'image/png' ? 'png' : '';
        const bytes = ext ? got.bytes : await pngOf(got.bytes, got.mime);
        if (!bytes) { this.host.flash('The copied picture could not be read.'); return; }
        main = { ext: ext || 'png', bytes };
      }
    } else if (got.kind === 'drawing') {
      const files = this.host.drawingFiles(got.doc);
      if (files) { main = { ext: 'svg', bytes: new TextEncoder().encode(files.svg) }; how = 'svg'; }
    }
    if (!main) { this.host.flash('The clipboard has no spectrum. Copy the spectrum in Mnova (or a PDF or picture) first, then paste.', 6000); return; }
    const guess = guessPastedType(c);
    const type = await askChoice<string>(`Paste Spectrum into ${this.idOf(c)}`, 'What kind of spectrum is it? (Enter takes the outlined guess.)',
      [...SPECTRUM_TYPES.map((t) => ({ value: t as string, label: PASTE_TYPE_LABELS[t], primary: t === guess })), { value: '', label: 'Cancel' }], '');
    if (!type) return;
    const m = main;
    await this.act(async () => {
      const def = ALL_FIELDS.get('spectra')!;
      if (!fieldKeys(c).includes('spectra')) await p.addField(c, { key: 'spectra' });
      const subdir = def.subdir || 'spectra';
      const stem = pastedStem(type);
      // (a name whose stem no picture there has, whatever its extension: the pasted original, an .emf or
      // .cdxml of the same stem, is never one that belongs to another spectrum; as SI Assistant names them)
      const taken = async (base: string): Promise<boolean> => {
        for (const x of new Set([m.ext, ...PASTED_EXTS])) if (await p.folder.exists(`${c.folder}/${subdir}/${base}.${x}`)) return true;
        return false;
      };
      let base = stem;
      for (let n = 2; await taken(base); n++) base = `${stem} (${n})`;
      const name = `${base}.${m.ext}`;
      const file = await p.addAttachment(c, subdir, name, m.bytes);
      const item: Json = { file, type, title: '', struct_caption: '' };
      if (original) item.original = await p.addAttachment(c, subdir, file.replace(/\.[^.]+$/, '.emf'), original);
      const list = (Array.isArray(valuesOf(c).spectra) ? valuesOf(c).spectra : (valuesOf(c).spectra = [])) as Json[];
      list.push(item);
      await p.saveCompound(c);
      this.forgetThumbs(p);
    });
    this.host.flash(`Pasted a ${PASTE_TYPE_LABELS[type as keyof typeof PASTE_TYPE_LABELS] ?? type} spectrum into ${this.idOf(c)}. ${keptLine(how)}`, 6000);
  }

  /** Paste ▸ the copied structure (ChemDraw, Chemweave, or a molfile) as the compound's structure. */
  private async pasteStructure(c: SiCompound, e?: ClipboardEvent): Promise<void> {
    const p = this.project!;
    if (p.readOnly) { this.host.flash('This SI project is open read-only.'); return; }
    const got = await this.clipboard(e);
    if (!got) return;
    let molblock: string | null = null;
    if (got.kind === 'drawing') {
      const m = this.host.molfileOf(got.doc.contents());
      if (!m.molblock) { this.host.flash(m.problem ?? 'The copied drawing could not be read as one structure.', 6000); return; }
      molblock = m.molblock;
    } else if (got.kind === 'text' && got.text.includes('M  END')) {
      const contents = this.host.contentsOf(got.text);
      molblock = contents ? this.host.molfileOf(contents).molblock : null;
    }
    if (!molblock) { this.host.flash('The clipboard has no structure. Copy one in ChemDraw or Chemweave first, then paste.', 6000); return; }
    if (p.hasStructure(c)) {
      const go = await askChoice('Paste Structure', `Replace ${this.idOf(c)}’s structure with the copied one? (Edit ▸ Undo puts it back.)`, [{ value: 'go', label: 'Replace', primary: true }, { value: 'no', label: 'Cancel' }], 'no');
      if (go !== 'go') return;
    }
    const mol = molblock;
    await this.act(async () => { await p.setStructure(c, mol); this.forgetStructure(c); });
  }

  private async addFiles(c: SiCompound, def: FieldDef): Promise<void> {
    const p = this.project!;
    const files = await this.host.pickFiles(def.key === 'spectra' ? 'Spectra (PDF or pictures)' : 'Files (PDF or pictures)', ['pdf', 'png', 'jpg', 'jpeg', 'tif', 'tiff', 'svg']);
    if (!files.length) return;
    await this.act(async () => {
      const list = (Array.isArray(valuesOf(c)[def.key]) ? valuesOf(c)[def.key] : (valuesOf(c)[def.key] = [])) as Json[];
      for (const f of files) {
        const name = await p.addAttachment(c, def.subdir || 'files', f.name, f.bytes);
        const item: Json = def.key === 'spectra' ? { file: name, type: guessSpectrum(name), title: '', struct_caption: '' } : { file: name, caption: '', placement: 'inline', label: '' };
        list.push(item);
      }
      await p.saveCompound(c);
      this.forgetThumbs(p);
    });
  }

  // ---------------------------------------------------------------- libraries

  private async structureIn(c: SiCompound): Promise<{ molfile: string; smiles: string; formula: string; mw: number; drawing?: Contents; label: string; name: string } | null> {
    const p = this.project!;
    const mol = await p.readStructure(c);
    if (!mol) return null;
    const [smiles, a] = await Promise.all([this.host.smiles(mol), this.host.analyze(mol)]);
    if (!smiles) return null;
    return { molfile: mol, smiles, formula: a?.formula ?? '', mw: a?.mw ?? 0, drawing: this.host.contentsOf(mol) ?? undefined, label: this.idOf(c) === 'ID?' ? '' : this.idOf(c), name: compoundName(c) };
  }

  /** Keep these compounds' structures in the Compound Library, with their SI IDs, and this project as where they appear. */
  private async toLibrary(list: SiCompound[]): Promise<void> {
    const p = this.project!;
    const ins = (await Promise.all(list.map((c) => this.structureIn(c)))).filter((x): x is NonNullable<typeof x> => !!x);
    if (!ins.length) { this.host.flash('None of these compounds has a structure yet.'); return; }
    const lib = await this.host.library();
    const { addStructures } = await import('./compound-library');
    const { noteMentions } = await import('../library/library');
    let added = 0, known = 0;
    lib.change((d) => {
      const got = addStructures(d, ins, p.folder.where);
      added = got.added.length;
      known = got.known.length;
      return noteMentions(got.lib, p.folder.where, ins.map((x) => ({ smiles: x.smiles, ...(x.label ? { label: x.label } : {}) })));
    });
    this.host.flash(`Compound Library: ${added} added${known ? `, ${known} already there` : ''}. Each lists this SI project as where it appears.`, 6000);
  }

  /** A new compound page with a compound from the Compound Library. */
  private async fromLibrary(d: SiSection | null): Promise<void> {
    const p = this.project!;
    if (!d) return;
    const lib = await this.host.library();
    const picked = await pickFromList<LibCompound>('From Compound Library', lib.now.compounds, (x) => `${x.label ? x.label + '  ' : ''}${x.name || x.formula}`, (x) => `${x.formula} · MW ${x.mw ? x.mw.toFixed(2) : '?'}`, 'Your Compound Library is empty: Add to Compound Library (here, or from a drawing) keeps structures there.');
    if (!picked.length) return;
    await this.act(async () => {
      let last: SiCompound | null = null;
      for (const x of picked) {
        const made = await p.addCompound(d.id, undefined, x.name);
        if (x.molfile) await p.setStructure(made, x.molfile);
        last = made;
      }
      if (last) this.pick = { kind: 'compound', id: last.id };
    });
  }

  /** Cite references from My Library in a compound's References field (they join the project's references). */
  private async citeFromLibrary(c: SiCompound | null): Promise<void> {
    const p = this.project!;
    const lib = await this.host.library();
    const picked = await pickFromList<LibReference>('Cite from My Library', lib.now.references, (r) => r.title || r.doi || 'Untitled', (r) => [r.authors[0], r.journal, r.year].filter(Boolean).join(', '), 'My Library has no references yet: add them in References ▸ My Library.');
    if (!picked.length) return;
    await this.act(async () => {
      const ids: string[] = [];
      for (const r of picked) {
        const ref: Json = { type: r.type, authors: r.authors, title: r.title, journal: r.journal, year: r.year, volume: r.volume, issue: r.issue, pages: r.pages, doi: r.doi, url: r.url, publisher: r.publisher, note: r.note };
        ids.push(await p.addReference(ref));
      }
      if (c) {
        if (!fieldKeys(c).includes('references')) await p.addField(c, { key: 'references' });
        const v = valuesOf(c).references as Json;
        const refs = Array.isArray(v.refs) ? (v.refs as string[]) : [];
        await p.setValue(c, 'references', { ...v, refs: [...refs, ...ids.filter((i) => !refs.includes(i))] });
      }
    });
    if (!c) this.host.flash(`Added to the project’s references: ${picked.length}.`);
  }
}

/** A formula with its numbers set low: C9H12O2 → C₉H₁₂O₂. */
function formulaNode(f: string): Node {
  const span = el('span', 'si-formula');
  for (const part of f.split(/(\d+)/)) {
    if (!part) continue;
    if (/^\d+$/.test(part)) span.append(el('sub', '', part)); else span.append(document.createTextNode(part));
  }
  return span;
}

function shortRef(r: Json): string {
  const a = Array.isArray(r.authors) && r.authors.length ? String(r.authors[0]).split(',')[0] : '';
  return [a && (Array.isArray(r.authors) && r.authors.length > 1 ? `${a} et al.` : a), partText(r.journal), partText(r.year)].filter(Boolean).join(', ') || partText(r.title) || partText(r.doi);
}

/** "2b_13C.pdf" is a ¹³C NMR spectrum. */
function guessSpectrum(name: string): string {
  const m = /(?:^|[^0-9])(1H|13C|19F|31P|11B)(?:[^0-9]|$)/i.exec(name);
  if (m) return m[1].toUpperCase();
  if (/hplc|sfc/i.test(name)) return 'HPLC/SFC';
  if (/\bir\b/i.test(name)) return 'IR';
  return '1H';
}

/** Check items in a list (searchable); resolves with those checked (none when cancelled). */
/** A mention's kind from its id's start, for tables, figures and schemes. */
const OBJECT_WORDS: Record<string, string> = { 't-': 'Table', 'f-': 'Figure', 'k-': 'Scheme' };

function pickFromList<T>(title: string, items: T[], main: (x: T) => string, sub: (x: T) => string, empty: string): Promise<T[]> {
  return new Promise((resolve) => {
    const d = el('dialog', 'ask si-pick');
    const form = el('form');
    form.method = 'dialog';
    form.append(el('h2', '', title));
    const search = el('input');
    search.type = 'search';
    search.placeholder = 'Search';
    search.setAttribute('aria-label', 'Search');
    const list = el('div', 'si-pick-list');
    const chosen = new Set<T>();
    const fill = (): void => {
      const q = search.value.trim().toLowerCase();
      const rows = items.filter((x) => !q || (main(x) + ' ' + sub(x)).toLowerCase().includes(q)).slice(0, 400).map((x) => {
        const l = el('label', 'si-pick-row');
        const box = el('input');
        box.type = 'checkbox';
        box.checked = chosen.has(x);
        box.addEventListener('change', () => { if (box.checked) chosen.add(x); else chosen.delete(x); ok.disabled = !chosen.size; });
        l.append(box, el('span', '', main(x)), el('small', 'muted', sub(x)));
        return l;
      });
      list.replaceChildren(...(rows.length ? rows : [el('p', 'muted', items.length ? 'Nothing matches.' : empty)]));
    };
    search.addEventListener('input', fill);
    const buttons = el('div', 'ask-buttons');
    const ok = el('button', 'primary', 'Add');
    ok.value = 'ok';
    ok.disabled = true;
    const cancel = el('button', '', 'Cancel');
    cancel.value = 'cancel';
    buttons.append(cancel, ok);
    form.append(search, list, buttons);
    d.append(form);
    document.body.append(d);
    d.addEventListener('close', () => { d.remove(); resolve(d.returnValue === 'ok' ? [...chosen] : []); });
    fill();
    d.showModal();
    search.focus();
  });
}

