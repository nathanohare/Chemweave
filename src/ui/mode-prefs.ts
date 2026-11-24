// Settings for the document and sheet views, kept apart from their code so start-up needn't load it.

/** The document's settings boxes (Paragraph, Style, Page Setup, Header and Footer). */
export type DocBoxKey = 'para' | 'style' | 'page' | 'hf';
export const DOC_BOXES: DocBoxKey[] = ['para', 'style', 'page', 'hf'];

/** The boxes pinned open in the side panel (kept with the settings). */
export const docBoxPrefs: { pinned: DocBoxKey[]; changed?: () => void } = { pinned: [] };

export function parseDocPins(raw: unknown): DocBoxKey[] {
  return Array.isArray(raw) ? DOC_BOXES.filter((k) => raw.includes(k)) : [];
}

/** View > Ruler in documents. */
export const docRulerPrefs: { shown: boolean; changed?: () => void } = { shown: false };

/** View > Formula Bar in sheets. */
export const formulaBarPrefs: { shown: boolean; changed?: () => void } = { shown: true };

/** Document pages (Settings ▸ Preferences): crop marks at the text's corners, and the white space between pages (a double-click between pages hides or shows it). */
export const docPagePrefs: { cropMarks: boolean; whiteSpace: boolean; changed?: () => void } = { cropMarks: false, whiteSpace: true };

/**
 * The SI Live Preview (Settings ▸ Preferences): the rest of the SI washed out beside the page
 * chosen; a field's text lit up with a shade (or Word's content-control brackets); the person's
 * own text (typed where no field is) with a dotted underline and a flag (or an amber shade and a bar).
 */
/** How the SI Live Preview marks its text (Preferences ▸ SI Live Preview). */
export interface SiPreviewLook {
  /** Everything but the page chosen washed out, a bar beside it. */
  dim: boolean;
  /** A field's text lit up with a tint and its name, or with brackets. */
  link: 'tint' | 'bracket';
  /** Text no field holds: an amber dotted underline and a flag in the margin, or an amber fill and a bar. */
  custom: 'underline' | 'fill';
}
export const DEFAULT_SI_PREVIEW: SiPreviewLook = { dim: true, link: 'tint', custom: 'underline' };
export function parseSiPreviewLook(v: unknown): SiPreviewLook {
  const r = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  return { dim: r.dim !== false, link: r.link === 'bracket' ? 'bracket' : 'tint', custom: r.custom === 'fill' ? 'fill' : 'underline' };
}
export const siPreviewPrefs: SiPreviewLook & { changed?: () => void } = { ...DEFAULT_SI_PREVIEW };
