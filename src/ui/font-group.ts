// The Font group, one for every mode (retrospective audit G5-26; style guide S17: the same command
// has the same control, picture and place everywhere). Two rows, as Word's:
//   Font  Size  A⁺  A⁻  Clear Formatting
//   B  I  U  abc  x₂  x²  C₉H₈  Text Color
// and then what only that mode has, at the end (Document: Small Caps and Highlight, Show/Hide ¶;
// Presentation: character spacing; Spreadsheet: Borders and Fill Color; Canvas: (R) stereo
// italics), and the ⬊ for the Font settings in the corner. Each mode keeps its own way of running
// the controls (its data-* attributes and ids); only the controls, their order, pictures and tips
// are shared. The Canvas ribbon builds its group in text-bar.ts from the same FONT_ROWS and FONT_LOOK.
// The SI tab has the same group too (review of F5, R13), with Symbol (Ω) at the end; SI text keeps
// only bold, italic, underline, subscript and superscript (the journal style sets its font, size
// and color), so the other controls are greyed there with that reason (SI_FONT_REASON).

/** Why the SI tab's font, size, strikethrough and color controls are greyed. */
export const SI_FONT_REASON = 'Text on the SI page takes its font, size and color from the journal style (Project Settings ▸ Output). To change them for some words, select them in the Live Preview.';
/** The SI Font group controls SI text cannot hold. */
export const SI_FONT_OFF: readonly string[] = ['font', 'size', 'grow', 'shrink', 'strike', 'color'];

export type FontControl = 'font' | 'size' | 'grow' | 'shrink' | 'clear' | 'bold' | 'italic' | 'underline' | 'strike' | 'sub' | 'sup' | 'formula' | 'charges' | 'color';
export type FontMode = 'document' | 'slides' | 'sheet' | 'si';

/** The controls of the Font group, row by row, in order. */
export const FONT_ROWS: readonly (readonly FontControl[])[] = [
  ['font', 'size', 'grow', 'shrink', 'clear'],
  ['bold', 'italic', 'underline', 'strike', 'sub', 'sup', 'formula', 'charges', 'color'],
];

/**
 * Each button's picture and tip, the same in every mode. A picture made of symbols (A⁺, x₂, C₉H₈) is
 * an icon, not words: it is hidden from screen readers, which read the button's name instead.
 */
export const FONT_LOOK: Record<Exclude<FontControl, 'font' | 'size'>, { html: string; title: string }> = {
  grow: { html: '<span aria-hidden="true">A<sup>+</sup></span>', title: 'Increase Font Size' },
  shrink: { html: '<span aria-hidden="true">A<sup>−</sup></span>', title: 'Decrease Font Size' },
  clear: { html: '<span aria-hidden="true">A<span class="rb-eraser">⌫</span></span>', title: 'Clear All Formatting' },
  bold: { html: '<b>B</b>', title: 'Bold (Ctrl+B)' },
  italic: { html: '<i>I</i>', title: 'Italic (Ctrl+I)' },
  underline: { html: '<u>U</u>', title: 'Underline (Ctrl+U)' },
  strike: { html: '<s>abc</s>', title: 'Strikethrough: a line through the text' },
  sub: { html: '<span aria-hidden="true">x<sub>2</sub></span>', title: 'Subscript' },
  sup: { html: '<span aria-hidden="true">x<sup>2</sup></span>', title: 'Superscript' },
  formula: { html: '<span aria-hidden="true">C₉H₈</span>', title: 'Formula style: numbers lowered (CH₂Cl₂), charges raised' },
  charges: { html: '<span aria-hidden="true">X<sup>2+</sup></span>', title: 'Raise Charge Digits: in the selected ions, the charge\'s digits go up with the sign (Fe₃⁺ → Fe³⁺, SO₄₂⁻ → SO₄²⁻; NH₄⁺ stays)' },
  color: { html: '<span>A</span>', title: 'Text Color' },
};

/** Raise Charge Digits, beside Formula style in every mode: its picture and tip. */
export const CHARGES_LOOK = FONT_LOOK.charges;

/** The sizes offered in every mode's size box (any size can be typed). */
export const FONT_SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 44, 48, 54, 60, 72, 96];
export const FONT_SIZE_LIST = 'font-size-list';

/**
 * A size typed in a Font group's size box: the number, or the warning to show when it is not one
 * the mode takes (Excel takes 1 to 409 points). The box then shows the real size again.
 */
export function typedSize(text: string, min: number, max: number): number | string {
  const n = Number(text.trim().replace(/\s*pt$/i, ''));
  return text.trim() !== '' && n >= min && n <= max ? n : `Type a font size from ${min} to ${max} points.`;
}

/** How a mode runs a control: the attribute (and its value) its code looks for, and a mode's own tip. */
interface Bind { attr: string; value?: string; tip?: string }
interface ModeFont {
  controls: Record<FontControl, Bind>;
  /** The group's own attributes (Presentation's text groups are found by data-sl-text). */
  group?: Record<string, string>;
  /** What only this mode has, at the end of each row (HTML). */
  extra: [string, string];
  launcher: Bind & { tip: string };
}

const MODES: Record<FontMode, ModeFont> = {
  document: {
    controls: {
      font: { attr: 'id', value: 'doc-font', tip: 'Font (type any installed font)' },
      size: { attr: 'id', value: 'doc-size' },
      grow: { attr: 'data-doc', value: 'font-bigger' },
      shrink: { attr: 'data-doc', value: 'font-smaller' },
      clear: { attr: 'data-doc', value: 'clear-formatting', tip: 'Clear All Formatting: the selected text and its paragraphs go back to plain Normal text (links, comments and formulas stay)' },
      bold: { attr: 'data-doc', value: 'doc-bold' },
      italic: { attr: 'data-doc', value: 'doc-italic' },
      underline: { attr: 'data-doc', value: 'doc-underline' },
      strike: { attr: 'data-doc', value: 'doc-strike' },
      sub: { attr: 'data-doc', value: 'doc-sub', tip: 'Subscript (Ctrl+=)' },
      sup: { attr: 'data-doc', value: 'doc-sup', tip: 'Superscript (Ctrl+Shift+=)' },
      formula: { attr: 'data-doc', value: 'doc-formula' },
      charges: { attr: 'data-doc', value: 'doc-raise-charges' },
      color: { attr: 'id', value: 'doc-colour' },
    },
    extra: [
      '<button class="rb-sq" data-doc="show-marks" aria-pressed="false" title="Show/Hide ¶ (Ctrl+Shift+8): show paragraph marks, spaces and tabs. They show on screen only, never in print or a saved file">¶</button>',
      '<button class="rb-sq" data-doc="doc-small-caps" aria-pressed="false" title="Small Caps (Ctrl+Shift+K): lower-case letters as smaller capitals">A<small>BC</small></button>'
      + '<span class="rb-split"><button class="rb-sq rb-hl" data-doc="doc-highlight" aria-pressed="false" title="Highlight the selected text in the color under the letters (click again to remove it)"><span class="hl-ab">ab</span><span id="doc-hl-bar" class="hl-bar"></span></button>'
      + '<button class="rb-sq rb-drop" data-doc="doc-highlight-menu" title="Highlight colors">▾</button></span>',
    ],
    launcher: { attr: 'data-doc', value: 'font-box', tip: 'Font settings: Change Case, All Caps, character spacing and kerning, and text effects (fill, outline, shadow)' },
  },
  slides: {
    group: { 'data-sl-text': '' },
    controls: {
      font: { attr: 'data-tx', value: 'font', tip: 'Font of the selected text, or of each selected text box (type any installed font)' },
      size: { attr: 'data-tx', value: 'size' },
      grow: { attr: 'data-sl-fmt', value: 'grow' },
      shrink: { attr: 'data-sl-fmt', value: 'shrink' },
      clear: { attr: 'data-sl-fmt', value: 'clear', tip: 'Clear All Formatting: back to plain text in the box\'s own font and size' },
      bold: { attr: 'data-sl-fmt', value: 'bold' },
      italic: { attr: 'data-sl-fmt', value: 'italic' },
      underline: { attr: 'data-sl-fmt', value: 'underline' },
      strike: { attr: 'data-sl-fmt', value: 'strike' },
      sub: { attr: 'data-sl-fmt', value: 'sub', tip: 'Subscript (Ctrl+=)' },
      sup: { attr: 'data-sl-fmt', value: 'sup', tip: 'Superscript (Ctrl+Shift+=)' },
      formula: { attr: 'data-sl-fmt', value: 'formula' },
      charges: { attr: 'data-sl-fmt', value: 'charges' },
      color: { attr: 'data-tx', value: 'colour' },
    },
    extra: [
      '',
      '<select data-tx="spacing" title="Character spacing" aria-label="Character spacing"><option value="-3">Very Tight</option><option value="-1.5">Tight</option><option value="0">Normal</option><option value="3">Loose</option><option value="6">Very Loose</option><option value="more">More Spacing…</option><option value="" hidden>Other</option></select>',
    ],
    launcher: { attr: 'data-tx', value: 'font-box', tip: 'Font settings: Change Case (Sentence case., lowercase, UPPERCASE, Capitalize Each Word, tOGGLE cASE)' },
  },
  sheet: {
    controls: {
      font: { attr: 'id', value: 'sh-font', tip: 'Font of the selected cells (type any installed font). Cells with no font of their own are in the theme\'s body font' },
      size: { attr: 'id', value: 'sh-size' },
      grow: { attr: 'data-sh', value: 'font-bigger' },
      shrink: { attr: 'data-sh', value: 'font-smaller' },
      clear: { attr: 'data-sh', value: 'clear-formats', tip: 'Clear All Formatting: the selected cells lose their formatting (their contents stay)' },
      bold: { attr: 'data-sh', value: 'cell-bold' },
      italic: { attr: 'data-sh', value: 'cell-italic' },
      underline: { attr: 'data-sh', value: 'cell-underline' },
      strike: { attr: 'data-sh', value: 'cell-strike', tip: 'Strikethrough (Ctrl+5): a line through the text of the selected cells' },
      sub: { attr: 'data-sh', value: 'cell-sub', tip: 'Subscript: the text of the selected cells lowered' },
      sup: { attr: 'data-sh', value: 'cell-sup', tip: 'Superscript: the text of the selected cells raised' },
      formula: { attr: 'data-sh', value: 'format-chem' },
      charges: { attr: 'data-sh', value: 'cell-raise-charges', tip: 'Raise Charge Digits: in the selected cells\' ions (or the selected text while typing), the charge\'s digits go up with the sign (Fe₃⁺ → Fe³⁺, SO₄₂⁻ → SO₄²⁻; NH₄⁺ stays)' },
      color: { attr: 'data-sh', value: 'text-colour' },
    },
    extra: [
      '',
      '<button class="rb-sq" data-sh="borders" title="Borders">▦</button><button class="rb-sq rb-colour" data-sh="fill-colour" title="Fill Color"><span>▨</span><span class="sw"></span></button>',
    ],
    launcher: { attr: 'data-sh', value: 'format-cells', tip: 'Format Cells (Ctrl+1): the number format, alignment, font, border and fill of the selected cells, in the side panel' },
  },
  si: {
    controls: {
      font: { attr: 'data-si-fmt', value: 'font', tip: 'Font' },
      size: { attr: 'data-si-fmt', value: 'size' },
      grow: { attr: 'data-si-fmt', value: 'grow' },
      shrink: { attr: 'data-si-fmt', value: 'shrink' },
      clear: { attr: 'data-si-fmt', value: 'clear', tip: 'Clear All Formatting: the selected text loses its bold, italic, underline, subscript and superscript' },
      bold: { attr: 'data-si-fmt', value: 'bold' },
      italic: { attr: 'data-si-fmt', value: 'italic' },
      underline: { attr: 'data-si-fmt', value: 'underline' },
      strike: { attr: 'data-si-fmt', value: 'strike' },
      sub: { attr: 'data-si-fmt', value: 'subscript', tip: 'Subscript (Ctrl+=)' },
      sup: { attr: 'data-si-fmt', value: 'superscript', tip: 'Superscript (Ctrl+Shift+=)' },
      formula: { attr: 'data-si-fmt', value: 'formula', tip: 'Formula style: numbers in the selected text lowered (CH₂Cl₂), charges raised' },
      charges: { attr: 'data-si-fmt', value: 'charges' },
      color: { attr: 'data-si-fmt', value: 'color' },
    },
    extra: [
      '',
      '<button class="rb-sq" data-si="symbol" title="Symbol: type °, Å, ±, Greek letters, arrows… where you are typing" aria-label="Symbol">Ω</button>',
    ],
    launcher: { attr: 'data-si-font', value: 'settings', tip: 'Project Settings ▸ Output: the journal style sets the font and size of SI text' },
  },
};

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const at = (b: Bind) => (b.value === undefined ? b.attr : `${b.attr}="${esc(b.value)}"`);

/**
 * The SI tab's font box, size box and text color, which SI text cannot change: disabled, with the
 * reason as their tip, and the boxes showing the SI text's own font and size (review F5b-R08).
 */
export function siFontBoxes(root: ParentNode, normal: { font?: string; size?: number }): void {
  for (const el of root.querySelectorAll<HTMLInputElement>('.rb-font-group input[data-si-fmt]')) {
    el.disabled = true;
    (el.closest('label') ?? el).title = SI_FONT_REASON;
    if (el.dataset.siFmt === 'font') el.value = normal.font ?? '';
    if (el.dataset.siFmt === 'size') el.value = normal.size === undefined ? '' : String(normal.size);
  }
}

/** One control's HTML in a mode. */
function control(mode: FontMode, c: FontControl): string {
  const b = MODES[mode].controls[c];
  if (c === 'font') return `<input ${at(b)} class="rb-text rb-font" list="ci-fonts" spellcheck="false" aria-label="Font" title="${esc(b.tip ?? 'Font')}" />`;
  if (c === 'size') return `<input ${at(b)} class="rb-text rb-num" list="${FONT_SIZE_LIST}" spellcheck="false" aria-label="Font size" title="Font size in points" />`;
  const look = FONT_LOOK[c];
  const tip = esc(b.tip ?? look.title);
  if (c === 'color') {
    // a picker in the label (Document, Presentation), or a button that opens the colors (Spreadsheet)
    return b.attr === 'data-sh'
      ? `<button class="rb-sq rb-colour" ${at(b)} title="${tip}" aria-label="Text Color">${look.html}<span class="sw"></span></button>`
      : `<label class="rb-sq rb-colour" title="${tip}">${look.html}<input ${at(b)} type="color" aria-label="Text Color" /></label>`;
  }
  const pressable = c !== 'grow' && c !== 'shrink' && c !== 'clear' && c !== 'charges';
  return `<button class="rb-sq" ${at(b)}${pressable ? ' aria-pressed="false"' : ''} title="${tip}" aria-label="${esc(look.title.replace(/ \(.*$/, '').replace(/:.*$/, ''))}">${look.html}</button>`;
}

/** The Font group of a mode's ribbon, as HTML. */
export function fontGroupHtml(mode: FontMode): string {
  const m = MODES[mode];
  const attrs = Object.entries(m.group ?? {}).map(([k, v]) => (v ? ` ${k}="${esc(v)}"` : ` ${k}`)).join('');
  const rows = FONT_ROWS.map((r, i) => `<div class="rb-pair">${r.map((c) => control(mode, c)).join('')}${m.extra[i]}</div>`).join('');
  return `<div class="rb-group rb-font-group" data-font-mode="${mode}"${attrs}><div class="rb-row"><div class="rb-col rb-fontcol">${rows}</div></div>`
    + `<div class="rb-label">Font</div><button class="rb-launch" ${at(m.launcher)} title="${esc(m.launcher.tip)}" aria-label="Font settings">⬊</button></div>`;
}

/** Put each mode's Font group where index.html has a <div data-font-group="mode"> for it, and the sizes' list once. */
export function installFontGroups(root: Document = document): void {
  if (!root.getElementById(FONT_SIZE_LIST)) {
    const list = root.createElement('datalist');
    list.id = FONT_SIZE_LIST;
    for (const s of FONT_SIZES) list.append(new Option(String(s)));
    root.body.append(list);
  }
  for (const slot of root.querySelectorAll<HTMLElement>('[data-font-group]')) {
    const t = root.createElement('template');
    t.innerHTML = fontGroupHtml(slot.dataset.fontGroup as FontMode);
    slot.replaceWith(t.content);
  }
}
