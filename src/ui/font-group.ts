// The Font group, one for every mode (retrospective audit G5-26; style guide S17: the same command
// has the same control, picture and place everywhere). Two rows, as Word's:
//   Font  Size  A⁺  A⁻  Clear Formatting
//   B  I  U  abc  x₂  x²  C₉H₈  Text Color
// and then what only that mode has, at the end (Document: Small Caps and Highlight, Show/Hide ¶;
// Presentation: character spacing; Spreadsheet: Borders and Fill Color; Canvas: (R) stereo
// italics), and the ⬊ for the Font settings in the corner. Each mode keeps its own way of running
// the controls (its data-* attributes and ids); only the controls, their order, pictures and tips
// are shared. The Canvas ribbon builds its group in text-bar.ts from the same FONT_ROWS and FONT_LOOK.

export type FontControl = 'font' | 'size' | 'grow' | 'shrink' | 'clear' | 'bold' | 'italic' | 'underline' | 'strike' | 'sub' | 'sup' | 'formula' | 'color';
export type FontMode = 'document' | 'slides' | 'sheet';

/** The controls of the Font group, row by row, in order. */
export const FONT_ROWS: readonly (readonly FontControl[])[] = [
  ['font', 'size', 'grow', 'shrink', 'clear'],
  ['bold', 'italic', 'underline', 'strike', 'sub', 'sup', 'formula', 'color'],
];

/** Each button's picture and tip, the same in every mode. */
export const FONT_LOOK: Record<Exclude<FontControl, 'font' | 'size'>, { html: string; title: string }> = {
  grow: { html: 'A<sup>+</sup>', title: 'Increase Font Size' },
  shrink: { html: 'A<sup>−</sup>', title: 'Decrease Font Size' },
  clear: { html: 'A<span class="rb-eraser">⌫</span>', title: 'Clear All Formatting' },
  bold: { html: '<b>B</b>', title: 'Bold (Ctrl+B)' },
  italic: { html: '<i>I</i>', title: 'Italic (Ctrl+I)' },
  underline: { html: '<u>U</u>', title: 'Underline (Ctrl+U)' },
  strike: { html: '<s>abc</s>', title: 'Strikethrough: a line through the text' },
  sub: { html: 'x<sub>2</sub>', title: 'Subscript' },
  sup: { html: 'x<sup>2</sup>', title: 'Superscript' },
  formula: { html: 'C₉H₈', title: 'Formula style: numbers lowered (CH₂Cl₂), charges raised' },
  color: { html: '<span>A</span>', title: 'Text Color' },
};

/** The sizes offered in every mode's size box (any size can be typed). */
export const FONT_SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 44, 48, 54, 60, 72, 96];
export const FONT_SIZE_LIST = 'font-size-list';

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
      color: { attr: 'data-sh', value: 'text-colour' },
    },
    extra: [
      '',
      '<button class="rb-sq" data-sh="borders" title="Borders">▦</button><button class="rb-sq rb-colour" data-sh="fill-colour" title="Fill Color"><span>▨</span><span class="sw"></span></button>',
    ],
    launcher: { attr: 'data-sh', value: 'format-cells', tip: 'Format Cells (Ctrl+1): the number format, alignment, font, border and fill of the selected cells, in the side panel' },
  },
};

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const at = (b: Bind) => (b.value === undefined ? b.attr : `${b.attr}="${esc(b.value)}"`);

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
  const pressable = c !== 'grow' && c !== 'shrink' && c !== 'clear';
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
