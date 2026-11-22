// Word's document settings (settings.xml) this program doesn't set, kept from the file read and
// written back in their place (audit G2-15): the compatibility options besides the mode (table
// style font sizes, OpenType features, mirrored indents...), m:mathPr (the default equation
// font and breaks), themeFontLang, clrSchemeMapping, decimalSymbol, listSeparator, rsids and
// the rest. ECMA-376 part 1, 17.15.1.78 (settings) gives their order.

import { elementXml } from './kept-parts';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const M_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const W14_NS = 'http://schemas.microsoft.com/office/word/2010/wordml';
const W15_NS = 'http://schemas.microsoft.com/office/word/2012/wordml';

/** CT_Settings's children in their order (17.15.1.78); m:mathPr goes by its own name. */
export const SETTINGS_ORDER = [
  'writeProtection', 'view', 'zoom', 'removePersonalInformation', 'removeDateAndTime', 'doNotDisplayPageBoundaries', 'displayBackgroundShape',
  'printPostScriptOverText', 'printFractionalCharacterWidth', 'printFormsData', 'embedTrueTypeFonts', 'embedSystemFonts', 'saveSubsetFonts',
  'saveFormsData', 'mirrorMargins', 'alignBordersAndEdges', 'bordersDoNotSurroundHeader', 'bordersDoNotSurroundFooter', 'gutterAtTop',
  'hideSpellingErrors', 'hideGrammaticalErrors', 'activeWritingStyle', 'proofState', 'formsDesign', 'attachedTemplate', 'linkStyles',
  'stylePaneFormatFilter', 'stylePaneSortMethod', 'documentType', 'mailMerge', 'revisionView', 'trackRevisions', 'doNotTrackMoves',
  'doNotTrackFormatting', 'documentProtection', 'autoFormatOverride', 'styleLockTheme', 'styleLockQFSet', 'defaultTabStop', 'autoHyphenation',
  'consecutiveHyphenLimit', 'hyphenationZone', 'doNotHyphenateCaps', 'showEnvelope', 'summaryLength', 'clickAndTypeStyle', 'defaultTableStyle',
  'evenAndOddHeaders', 'bookFoldRevPrinting', 'bookFoldPrinting', 'bookFoldPrintingSheets', 'drawingGridHorizontalSpacing',
  'drawingGridVerticalSpacing', 'displayHorizontalDrawingGridEvery', 'displayVerticalDrawingGridEvery', 'doNotUseMarginsForDrawingGridOrigin',
  'drawingGridHorizontalOrigin', 'drawingGridVerticalOrigin', 'doNotShadeFormData', 'noPunctuationKerning', 'characterSpacingControl',
  'printTwoOnOne', 'strictFirstAndLastChars', 'noLineBreaksAfter', 'noLineBreaksBefore', 'savePreviewPicture', 'doNotValidateAgainstSchema',
  'saveInvalidXml', 'ignoreMixedContent', 'alwaysShowPlaceholderText', 'doNotDemarcateInvalidXml', 'saveXmlDataOnly', 'useXSLTWhenSaving',
  'saveThroughXslt', 'showXMLTags', 'alwaysMergeEmptyNamespace', 'updateFields', 'hdrShapeDefaults', 'footnotePr', 'endnotePr', 'compat',
  'docVars', 'rsids', 'mathPr', 'attachedSchema', 'themeFontLang', 'clrSchemeMapping', 'doNotIncludeSubdocsInStats', 'doNotAutoCompressPictures',
  'forceUpgrade', 'captions', 'readModeInkLockDown', 'smartTagType', 'schemaLibrary', 'shapeDefaults', 'doNotEmbedSmartTags', 'decimalSymbol',
  'listSeparator',
];
const ORDER = new Map(SETTINGS_ORDER.map((n, i) => [n, i]));

/**
 * Settings written from this program's own (or kept another way: docVars, the document ids),
 * and those that would be wrong once the text is changed here (proofState: spelling checked;
 * a template or mail merge by relationship, not carried).
 */
const OURS = new Set(['zoom', 'displayBackgroundShape', 'embedTrueTypeFonts', 'saveSubsetFonts', 'trackRevisions', 'documentProtection', 'defaultTabStop',
  'autoHyphenation', 'consecutiveHyphenLimit', 'hyphenationZone', 'doNotHyphenateCaps', 'evenAndOddHeaders', 'characterSpacingControl',
  'footnotePr', 'endnotePr', 'compat', 'docVars', 'proofState', 'attachedTemplate', 'mailMerge']);

/** What settings.xml had that isn't written here (see KeptParts.settings). */
export interface KeptSettings {
  /** WordprocessingML (and m:mathPr) children, by name, as written. */
  w: { n: string; xml: string }[];
  /** Word 2010's and 2013's (w14, w15) children in their order, '' where the document ids were. */
  ext: string[];
  /** w:compat's children other than the compatibility mode. */
  compat?: string;
}

const strip = (s: string) => s.replace(/ xmlns:w="[^"]*"/g, '');
const hasRel = (el: Element): boolean => Array.from(el.attributes).some((a) => a.namespaceURI === R_NS) || Array.from(el.children).some(hasRel);

/** The settings this program doesn't set, from the file's w:settings (null when nothing). */
export function readKeptSettings(root: Element | null | undefined): KeptSettings | null {
  if (!root) return null;
  const k: KeptSettings = { w: [], ext: [] };
  for (const el of Array.from(root.children)) {
    const n = el.localName, ns = el.namespaceURI;
    if (ns === W_NS && n === 'compat') {
      const rest = Array.from(el.children).filter((c) => !(c.localName === 'compatSetting' && c.getAttributeNS(W_NS, 'name') === 'compatibilityMode'));
      if (rest.length) k.compat = rest.map((c) => strip(elementXml(c))).join('');
    } else if ((ns === W_NS || (ns === M_NS && n === 'mathPr')) && ORDER.has(n) && !OURS.has(n) && !hasRel(el)) k.w.push({ n, xml: strip(elementXml(el)) });
    // (only Word 2010's and 2013's, which the part names as ignorable: others' would need declaring so)
    else if (ns === W14_NS || ns === W15_NS) {
      if (n === 'docId') { if (!k.ext.includes('')) k.ext.push(''); } else k.ext.push(elementXml(el));
    }
  }
  return k.w.length || k.ext.some(Boolean) || k.compat ? k : null;
}

/**
 * The settings' children: this program's own (each by its name, as [name, xml]) with those kept
 * from the file put among them in the order the standard gives, then Word 2010's and 2013's
 * with the document ids (`ids`) where the file had them.
 */
export function settingsChildren(ours: [string, string][], kept: KeptSettings | null | undefined, ids: string): string {
  const out = ours.filter(([, x]) => x).map(([n, x]) => ({ i: ORDER.get(n) ?? SETTINGS_ORDER.length, x }));
  for (const w of kept?.w ?? []) {
    const i = ORDER.get(w.n)!;
    const at = out.findIndex((o) => o.i > i);
    out.splice(at < 0 ? out.length : at, 0, { i, x: w.xml });
  }
  const ext = kept?.ext.length ? kept.ext.map((x) => x || ids).join('') + (kept.ext.includes('') ? '' : ids) : ids;
  return out.map((o) => o.x).join('') + ext;
}
