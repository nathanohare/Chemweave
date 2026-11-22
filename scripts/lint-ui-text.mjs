// Checks the words people read in Chemweave: command names, tooltips, menus, dialog text, status
// messages and Undo step names. It fails on the wording the style guide (docs/ui-style.md) rules
// out and on chemical formulas written flat where the app should show real subscripts and charges.
//
//   node scripts/lint-ui-text.mjs            lists every problem (exit code 1 if any)
//   node scripts/lint-ui-text.mjs --all      also lists the known ones (KNOWN_UI_TEXT below)
//   node scripts/lint-ui-text.mjs --prune    deletes known lines whose text has been fixed
//   node scripts/lint-ui-text.mjs --write    re-records the known list (only after a merge; see that file)
//
// tests/ui-text-lint.test.ts runs the same check on every pull request.
//
// What is read (comments, code names and file-format keywords such as w:color are left alone):
//   - in index.html and audience.html: the text between tags and the title, aria-label,
//     placeholder, alt, data-info and data-tip attributes (not class names, ids or other data-* values);
//   - in src/**/*.ts, every string literal and template that has words with spaces between them
//     (that is how UI text looks; keys, ids and format keywords do not), wherever it is: menus,
//     right-click menus, ribbon labels, toasts, dialogs, errors, status text;
//   - and single-word strings in a UI position: the value of a property such as name, label,
//     title, text or tooltip (UI_PROPS); something assigned to .title, .textContent or .innerHTML;
//     an argument of flash(), popupMenu(), an Undo step name (doc.edit('Name', …)), new Error()
//     and the other helpers listed in UI_CALLS. A literal joined into such a value
//     (a ? 'x' : 'y', 'x' + n, a template) counts too.
// Strings that look like identifiers (no space, and lower case or with - _ . : /), markup
// attributes (x="y"), CSS and console messages are skipped.
//
// Problems that were already in the app are listed one by one in lint-ui-text-known.mjs; the
// check fails on any other problem, and on a listed one that has been fixed (delete its line, or
// run with --prune).
//
// No packages beyond TypeScript's parser, which the repository already has.

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { KNOWN_UI_TEXT } from './lint-ui-text-known.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------------------------
// The rules

/** Words the style guide replaces, with the rule and the word to use instead. Case-insensitive. */
export const BANNED = [
  { re: /\bpicked\b/i, rule: 'S26', use: 'selected' },
  // Excel's own command "Pick From Drop-down List" keeps its name; class names such as grid-pick are not words
  { re: /(?<![-\w])pick(?:s|ing)?(?![-\w])(?! From Drop-down List)/i, rule: 'S26', use: 'select (objects, cells, slides) or choose (options, files)' },
  { re: /\byour turn\b|(?<![-\w])turn(?:s|ed|ing)? (?:(?:it|them|the [a-z-]+|a [a-z-]+|this|each [a-z-]+) )?(?:by \d|by [a-z]+ degrees|\d+ ?°|around|round (?:the|its|an?)\b|clockwise|anticlockwise|counterclockwise|counter-clockwise)/i, rule: 'S26', use: 'rotate (or "next", for a turn in a sequence)' },
  { re: /(?<![-\w])turn(?:s|ed|ing)? (?:(?:the|a|an|this|that|each|every|its|their) (?:[a-z-]+ )?)?(?:molecules?|structures?|selection|rings?|drawings?|objects?|shapes?|pictures?|images?|groups?|bonds?|fragments?|arrows?|labels?|captions?|charts?|text box(?:es)?|it|them)\b(?! (?:on|off|in|into|out|up|down|over|to (?:a|an)|back)\b)|\bturned (?:with|to read|to match|to its|in 3-D)\b|\bEach is turned\b|\bNothing to turn\b/i, rule: 'S26', use: 'rotate' },
  { re: /\b[Uu]ntick|\b[Tt]icked\b|\btick (?:it|a|the|what|each|this|them|to)\b|\btick(?:-| )?box(?:es)?\b|\btick list\b|(?<![-\w])Tick\b/, rule: 'S26', use: 'check / uncheck, or check box' },
  { re: /\bcarets?\b/i, rule: 'S70', use: 'cursor' },
  // another program ("the program that made it") is fine
  { re: /\bthe program\b(?! (?:that|which) (?:made|wrote|saved|created|exported))/i, rule: 'S70', use: 'Chemweave' },
  { re: /\byour own\b|\bmy own\b/i, rule: 'S70', use: 'custom' },
  { re: /\b(?:the|its|their|new|same|default) (?:plain )?looks?\b(?! (?:up|for|at|in|like|right|wrong|broken|different|the same)\b)|\b(?:number format|format|style|colors?|fonts?) and looks?\b|\band look of\b|\blooks? of (?:the|a|its|their|each|every)\b/i, rule: 'S70', use: 'style or formatting, not look' },
  { re: /\btoggl(?:e|es|ed|ing)\b/i, rule: 'S64', use: 'a checkable command named for what it turns on (Snap to Objects)' },
  { re: /\bwork(?:s|ed|ing)? out\b/i, rule: 'S26', use: 'calculate' },
  { re: /\bby itself\b/i, rule: 'S26', use: 'automatically' },
  { re: /\bfor good\b/i, rule: 'S70', use: 'permanently' },
];

/** "Hotkeys" only for the ChemDraw-style one-key atom and bond keys (S82); "keyboard shortcuts" otherwise. */
export function hotkeyMisuse(text) {
  const m = text.match(/\bhot[- ]?keys?\b/i);
  if (!m) return null;
  return /\b(?:atoms?|bonds?|key sets?|key-set|ChemDraw|one-key|elements?)\b/i.test(text) ? null : m[0];
}


/**
 * British spellings (UI rule 2, S29). Whole words only, so "colors" passes and a proper name can
 * still be written in KNOWN_UI_TEXT. Chemistry names IUPAC spells the British way (aluminium,
 * caesium) are not listed.
 */
export const BRITISH = [
  /\b(colour|behaviour|favour|favourite|flavour|honour|labour|neighbour|harbour|armour|humour|rumour)(s|ed|ing|ite|ites|ful|less)?\b/i,
  /\b(centre|centred|centres|centring|metre|metres|litre|litres|millilitre|millilitres|fibre|fibres|theatre)\b/i,
  /\b(grey|greys|greyed|greyish|greyscale|greyscales)\b/i,
  /\b(organis|italicis|realis|recognis|normalis|optimis|customis|minimis|maximis|initialis|visualis|summaris|prioritis|categoris|standardis|synchronis|authoris|finalis|serialis|capitalis|emphasis|memoris|characteris|utilis|apologis|criticis|specialis|localis|personalis|randomis|parametris|symbolis|digitis|stabilis|neutralis|crystallis|polymeris|ionis|isomeris|racemis|epimeris|aromatis)(e|ed|es|ing|ation|ations|er|ers)\b/i,
  /\b(analys|catalys|hydrolys|paralys|dialys|electrolys|photolys|pyrolys)(e|ed|es|ing)\b/i,
  /\bsulph(ur|urs|ate|ates|ide|ides|ite|ites|onyl|onate|onates|oxide|oxides|one|ones|onic|uric|urous|onamide|onamides)\b/i,
  /\b(judgement|judgements|whilst|amongst|towards)\b/i,
  /\b(catalogue|catalogues|dialogue|dialogues|programme|programmes|artefact|artefacts|licence|licences|cheque|cheques)\b/i,
  /\b(labelled|labelling|modelled|modelling|travelled|travelling|cancelled|cancelling|levelled|levelling|signalled|signalling|totalled|totalling)\b/i,
  /\b(anticlockwise)\b/i,
];

/** The element symbols, for spotting a formula written flat. */
export const ELEMENTS = new Set(('H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr '
  + 'Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt '
  + 'Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og D').split(' '));

/**
 * Group abbreviations chemists write inside formulas (Et₃N, PPh₃, NBu₄⁺, OTf⁻, CO₂Me, Pd₂(dba)₃).
 * Several are also element symbols (Pr, Ac, Ts); that does not matter here.
 */
export const GROUPS = new Set(['Me', 'Et', 'Pr', 'iPr', 'nPr', 'Bu', 'nBu', 'tBu', 'sBu', 'iBu', 'Ph', 'Bn', 'Bz', 'Ac', 'Ts', 'Tf', 'Ms', 'Ns', 'Cy',
  'Boc', 'Cbz', 'Fmoc', 'Piv', 'Tol', 'Mes', 'Tr', 'TMS', 'TBS', 'TES', 'TIPS', 'TBDPS', 'Ar',
  'dba', 'cod', 'acac', 'py', 'bpy', 'phen', 'dppf', 'dppe', 'dppp', 'tmeda', 'Cp', 'Ad']);
const TOKENS = [...ELEMENTS, ...GROUPS].sort((a, b) => b.length - a.length);

/**
 * Splits a word into element symbols and groups with counts, or null when it isn't a formula.
 * Brackets are allowed and may carry a count: "CDCl3" -> C D Cl3, "Ca(OH)2" -> Ca ( O H ) 2.
 * Each part is { sym, n, group }; a bracket's count is a part { sym: ')', n }.
 */
export function formulaParts(word) {
  const parts = [];
  let i = 0;
  let depth = 0;
  while (i < word.length) {
    const ch = word[i];
    if (ch === '(' || ch === '[') { depth++; parts.push({ sym: ch, n: '' }); i++; continue; }
    if (ch === ')' || ch === ']') {
      if (!depth--) return null;
      const n = /[\d₀-₉]*/y; n.lastIndex = i + 1;
      const d = n.exec(word)[0];
      parts.push({ sym: ch, n: d });
      i += 1 + d.length;
      continue;
    }
    const tok = TOKENS.find((t) => word.startsWith(t, i));
    if (!tok) return null;
    const n = /[\d₀-₉]*/y; n.lastIndex = i + tok.length;
    const d = n.exec(word)[0];
    parts.push({ sym: tok, n: d, group: GROUPS.has(tok) && !ELEMENTS.has(tok) });
    i += tok.length + d.length;
  }
  return depth ? null : parts;
}

/**
 * Words that look like formulas but are not: cell references, keys, file and product names, and
 * assay values. Single-letter elements with a count (H2, N2, O2, I2) are not flagged at all: they
 * are also cell references (H2 is a cell), so the check cannot tell them apart and leaves them.
 */
const NOT_FORMULA = /^(?:[A-Z]\d+|F\d{1,2}|H\d|MP\d|B3LYP|SN[12]|S[NE][12]'?|E[12]|CYP\d\w*|COVID\d+|Win\d+|UTF\d+|PDF\d?|ISO\d+|PEG\d+|(?:IC|EC|ED|LD|GI|CC|TD)50|USB\d?|CSS\d?|HTML\d?|HDF\d|H\d{3}[A-Za-z]{0,2}|ES\d+|P\d{3})$/;

/**
 * Formulas written flat (S27): an element symbol or group followed by digits, as in CH4, H2O,
 * CDCl3, Cl2, Et3N or Pd(PPh3)4, and a charge written as a bare + or − after a formula or a
 * bracket, as in Na+, BF4-, OTf- or [M+H]+.
 */
export function flatFormulas(text) {
  const out = [];
  // subscript counts (₀–₉) are read as part of the word, so NH₃+ is found as a charge written flat
  for (const m of text.matchAll(/[\[(]*[A-Za-z0-9₀-₉()[\]]+[+\-−]?/g)) {
    let raw = m[0];
    let w = raw;
    let charge = '';
    // a sign followed by a letter or digit is not a charge (U+00B0, Ctrl+Z, N-methyl)
    if (/[+\-−]$/.test(w) && !/^[A-Za-z0-9]/.test(text.slice(m.index + raw.length))) { charge = w.slice(-1); w = w.slice(0, -1); }
    else if (/[+\-−]$/.test(w)) { w = w.slice(0, -1); raw = w; }
    // brackets that belong to the sentence, not the formula: "(e.g. H2O)" or "(CH2Cl2)"
    let core = w;
    for (;;) {
      const open = (core.match(/[([]/g) || []).length, close = (core.match(/[)\]]/g) || []).length;
      if (open > close && /^[([]/.test(core)) core = core.slice(1);
      else if (close > open && /[)\]]$/.test(core)) core = core.slice(0, -1);
      else if (/^\(.*\)$|^\[.*\]$/.test(core) && formulaParts(core.slice(1, -1)) && !/[)\]]\d/.test(core.slice(1, -1).replace(/^.*[([]/, ''))) core = core.slice(1, -1);
      else break;
    }
    if (!core || NOT_FORMULA.test(core)) continue;
    const parts = /^[A-Z([]/.test(core) ? formulaParts(core) : null;
    const atoms = parts?.filter((p) => p.sym !== '(' && p.sym !== '[') ?? [];
    const hasDigit = atoms.some((p) => /\d/.test(p.n)); // a count written flat
    const hasCount = atoms.some((p) => p.n);
    const hasGroup = atoms.some((p) => p.group);
    const letters = atoms.filter((p) => /[A-Za-z]/.test(p.sym));
    const flat = parts && hasDigit && (letters.length >= 2 || (letters.length === 1 && letters[0].sym.length >= 2));
    if (flat) { out.push(charge ? core + charge : core); continue; }
    if (charge) {
      // a bare charge: after a formula with a digit or a group (BF4-, OTf-), or + / − after an ion or a bracket (Na+, [M+H]+)
      const bracket = /[\])]$/.test(w) && /^[\[(]/.test(w);
      if (parts && (hasCount || hasGroup)) out.push(raw);
      else if (charge !== '-' && (bracket || (parts && letters.length <= 3 && core.length <= 4 && !/^[CAXYZ]$/.test(core)))) out.push(raw);
    }
  }
  // the end of the text, where the regular expression above may have cut "[M+H]+" in two
  const m = text.match(/\[[A-Za-z0-9+\-−]+\][+\-−](?=$|[\s,.;:)])/g);
  if (m) for (const x of m) if (!out.some((o) => x.endsWith(o))) out.push(x);
  return out;
}

/**
 * A SMILES string (typed input that can't have subscripts): one word of SMILES characters with an
 * atom map ([NH2:1]) or two ring closures on aromatic atoms (c1ccccc1), as in [NH2:1]c1ccc(*)cc1.
 */
export function isSmiles(word) {
  const w = word.replace(/^[("“]+|[)"”,.;:]+$/g, '');
  if (!/^[A-Za-z0-9@+\-[\]()=#$:.\/\\%*]+$/.test(w)) return false;
  return /\[[A-Za-z0-9@+\-]+:\d+\]/.test(w) || /[cnosp]\d.*[cnosp(]\S*?[cnosp]\d/.test(w) || /^[A-Za-z]*[cnosp]1[cnosp]+.*[cnosp]1/.test(w);
}

/** "ChemDraw" in a command's name (S82): say "ChemDraw-style" instead. File type names may keep it. */
export function chemdrawInCommand(label) {
  // a file or object type keeps the name (ChemDraw XML drawings (.cdxml), ChemDraw objects), and so
  // does a phrase about the other program (as in ChemDraw, from ChemDraw); only a name made of it fails
  const t = label.replace(/\bChemDraw (objects?|XML|drawings?|files?|style sheets?)\b/gi, '').replace(/\b(as in|like|for|from|in|into|to|with|than) ChemDraw\b/g, '');
  if (/\.cdx|\bCDX(ML)?\b/.test(label)) return [];
  return /ChemDraw(?!-style|-like)/.test(t) ? ['ChemDraw'] : [];
}

/** Every problem in one user-visible string. `command` true for a command's name (menu item, ribbon button). */
export function checkText(text, { command = false, input = false } = {}) {
  const out = [];
  const t = text.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/\s+/g, ' ');
  for (const b of BANNED) {
    const m = t.match(b.re);
    if (m) out.push({ rule: b.rule, found: m[0], use: b.use });
  }
  const hot = hotkeyMisuse(t);
  if (hot) out.push({ rule: 'S82', found: hot, use: '"keyboard shortcuts" (hotkeys are only the one-key atom and bond keys)' });
  for (const re of BRITISH) {
    const m = t.match(re);
    if (m) out.push({ rule: 'UI rule 2', found: m[0], use: 'American spelling' });
  }
  // Formulas the person types are shown flat on purpose: a placeholder (a format hint), a
  // before → after example, and what goes inside a formula's quotes or brackets (HRMS(B2,"[M+Na]+")).
  // A SMILES string is not a formula and can't have subscripts.
  const prose = input || /→/.test(t) ? '' : t.replace(/"[^"]*"|“[^”]*”/g, ' ').replace(/\b[A-Z][A-Z0-9.]+\([^)]*\)/g, ' ')
    .split(/(\s+)/).map((w) => (isSmiles(w) ? ' ' : w)).join('');
  for (const f of flatFormulas(prose)) out.push({ rule: 'S27', found: f, use: 'real subscripts and raised charges (chemRuns / ₀–₉ ⁺ ⁻)' });
  if (command) for (const c of chemdrawInCommand(t)) out.push({ rule: 'S82', found: c, use: '"ChemDraw-style", or the format name' });
  return out;
}

// ---------------------------------------------------------------------------------------------
// Finding the user-visible strings

/** Properties whose value people read (an object's key, or a DOM property assigned). */
export const UI_PROPS = new Set(['title', 'label', 'tip', 'tooltip', 'help', 'hint', 'placeholder', 'textContent', 'innerText',
  'ariaLabel', 'message', 'blurb', 'about', 'heading', 'description', 'innerHTML', 'caption', 'confirmLabel', 'okLabel', 'cancelLabel', 'emptyText',
  'name', 'text', 'note', 'desc', 'summary', 'info', 'status', 'detail', 'subtitle', 'group', 'tab', 'menu', 'value', 'alt', 'header', 'footer', 'legend']);
/** Functions whose string arguments people read. */
export const UI_CALLS = new Set(['flash', 'alert', 'confirm', 'prompt', 'showStatus', 'setStatus', 'showToolStatus', 'notice', 'onNotice',
  'edit', 'button', 'btn', 'row', 'check', 'Option', 'ask', 'askText', 'heading', 'section', 'labelled', 'FloatBox', 'setGroup', 'menuItem', 'infoTip', 'warn',
  'popupMenu', 'contextMenu', 'showMenu', 'el', 'c', 'act', 'item', 'cmd', 'say', 'set', 'ToolWindow', 'Error', 'toast', 'notify', 'h', 'tag', 'span', 'div',
  'option', 'opt', 'radio', 'tab', 'group', 'field', 'input', 'select', 'link', 'dialog', 'showDialog', 'openDialog', 'register', 'add', 'push']);
/** Calls whose strings people never see. */
const HIDDEN_CALLS = /^(?:console\.\w+|require|import|querySelector(?:All)?|getElementById|closest|matches|addEventListener|removeEventListener|dispatchEvent|getAttribute|setAttribute|removeAttribute|hasAttribute|toggleAttribute|getPropertyValue|setProperty|createElement(?:NS)?|getItem|setItem|removeItem|postMessage|fetch|RegExp|describe|it|test|expect)$/;
/**
 * Properties whose text the person types: a placeholder (a format hint). Banned words are still
 * checked. (An input's starting value can be shown text too, so it is checked; the few that are
 * typed formulas are in ALLOWED.)
 */
const INPUT_PROPS = new Set(['placeholder']);
/** Calls that take an atom's or bond's own data (a label is drawn as chemistry, with real subscripts). */
const MODEL_CALLS = /^(?:add|update|set|new)(?:Atom|Bond)s?$/;
function modelCall(obj) {
  const c = obj && ts.isObjectLiteralExpression(obj) ? obj.parent : null;
  if (!c || !ts.isCallExpression(c) || !c.arguments.includes(obj)) return false;
  const e = c.expression;
  const name = ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : '';
  return MODEL_CALLS.test(name);
}
/** Command names: these properties and calls hold a command's own name (S82 applies). */
const COMMAND_PROPS = new Set(['label']);
/** A command name is short and has no sentence in it (a tooltip or a dialog's text is not one). */
const commandLike = (t) => t.length <= 40 && !/[:.,;]\s|[.:]$/.test(t);
const ATTRS = new Set(['title', 'aria-label', 'placeholder', 'alt', 'data-info', 'data-tip']);

function looksLikeId(s) {
  if (/\s/.test(s)) return false;
  return /^[a-z0-9]/.test(s) || /[-_.:/#=<>{}]/.test(s);
}

/** The text of an HTML snippet that people read: text between tags, and title / aria-label / placeholder / alt values. */
export function htmlText(html) {
  const out = [];
  const h = html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style|svg)\b[\s\S]*?<\/\1>/gi, ' ');
  for (const m of h.matchAll(/\s(title|aria-label|placeholder|alt|data-info|data-tip)\s*=\s*("([^"]*)"|'([^']*)')/gi)) out.push({ text: m[3] ?? m[4] ?? '', attr: m[1] });
  const bare = h.replace(/<[^>]*>/g, '\n');
  for (const line of bare.split('\n')) if (line.trim()) out.push({ text: line.trim() });
  return out;
}

/** Whether a literal sits where its text is shown: walks up through ?:, +, ??, ||, (), templates and arrays. */
function uiContext(node) {
  let n = node;
  for (let depth = 0; depth < 8 && n.parent; depth++) {
    const p = n.parent;
    if (ts.isConditionalExpression(p) && (p.whenTrue === n || p.whenFalse === n)) { n = p; continue; }
    if (ts.isBinaryExpression(p) && [ts.SyntaxKind.PlusToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(p.operatorToken.kind)) { n = p; continue; }
    if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken && p.right === n) { n = p; continue; }
    if (ts.isParenthesizedExpression(p) || ts.isAsExpression(p) || ts.isTemplateSpan(p) || ts.isTemplateExpression(p) || ts.isArrayLiteralExpression(p) || ts.isSatisfiesExpression?.(p)) { n = p; continue; }
    if (ts.isPropertyAssignment(p) && p.initializer === n) {
      const k = p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : '';
      if (!UI_PROPS.has(k)) return null;
      // an atom's or bond's own data, such as doc.updateAtom(id, { label: 'CO2Et' }): drawn as chemistry, not shown as written
      if (modelCall(p.parent)) return null;
      return { command: COMMAND_PROPS.has(k), input: INPUT_PROPS.has(k) };
    }
    if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.EqualsToken && p.right === n) {
      const l = p.left;
      if (ts.isPropertyAccessExpression(l) && UI_PROPS.has(l.name.text)) return { command: false, input: INPUT_PROPS.has(l.name.text) };
      return null;
    }
    if ((ts.isCallExpression(p) || ts.isNewExpression(p)) && p.arguments?.includes(n)) {
      const e = p.expression;
      const name = ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : '';
      if (name === 'setAttribute') {
        const a0 = p.arguments[0];
        return a0 !== n && a0 && ts.isStringLiteral(a0) && ATTRS.has(a0.text) ? { command: false, input: a0.text === 'placeholder' } : null;
      }
      if (UI_CALLS.has(name)) return { command: name === 'button' || name === 'btn' || name === 'menuItem' };
      return null;
    }
    return null;
  }
  return null;
}

/** Whether a literal is an argument of a call whose strings people never see (console.log, querySelector, …), or an import. */
function hiddenContext(node) {
  for (let n = node, depth = 0; n.parent && depth < 8; n = n.parent, depth++) {
    const p = n.parent;
    if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isImportTypeNode?.(p) || ts.isLiteralTypeNode(p) || ts.isExternalModuleReference?.(p)) return true;
    if ((ts.isCallExpression(p) || ts.isNewExpression(p)) && p.arguments?.includes(n)) {
      const e = p.expression;
      const name = ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? (ts.isIdentifier(e.expression) && e.expression.text === 'console' ? 'console.' + e.name.text : e.name.text) : '';
      return HIDDEN_CALLS.test(name);
    }
    if (ts.isElementAccessExpression(p) && p.argumentExpression === n) return true;
    // class names (el.className = 'menu popup-menu colour-menu', { className: '…' })
    if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.EqualsToken && p.right === n && ts.isPropertyAccessExpression(p.left) && p.left.name.text === 'className') return true;
    if (ts.isPropertyAssignment(p) && p.initializer === n && p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && p.name.text === 'className') return true;
    if (ts.isCaseClause(p) || (ts.isBinaryExpression(p) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(p.operatorToken.kind))) return true;
    if (ts.isPropertyAssignment(p) || ts.isVariableDeclaration(p) || ts.isReturnStatement(p) || ts.isBlock(p)) return false;
  }
  return false;
}

/** Text with words separated by spaces, as UI text has (keys, ids and format keywords do not). */
const WORDS = /[A-Za-z]{2,}[^\S\n]+[A-Za-z(]/;
/** Markup attributes, CSS and code in a string: not text people read as written. */
function codeLike(t) {
  return /\w[\w:-]*\s*=\s*["'{]/.test(t) // x="y"
    || /(?:^|[;{\s])[a-z-]+\s*:\s*[^;]+;/.test(t) // CSS declarations
    || /\b\d+(?:px|pt|em|rem|vh|vw)\b.*\b(?:solid|dashed|dotted|none|auto)\b|\b(?:solid|dashed|dotted)\b.*\d+(?:px|pt)/.test(t)
    || /=>|\bfunction\b|\breturn\b|\bconst\b|\bvar\(|^\s*[@.#][\w-]+\s*[{,]/.test(t)
    || /^\s*(?:M|m)\s*-?\d/.test(t) // an SVG path
    || dataLike(t);
}

/** A data table (one row a line, | between fields, shown through its own renderer), class names, or hex colors. */
function dataLike(t) {
  return /(?:[^|\n]*\|){3,}[^|\n]*(?:\n|$)/.test(t) || /^(?:[a-z][a-z0-9]*(?:-[a-z0-9]+)+\s*)+$/.test(t) || /^(?:#?[0-9A-Fa-f]{6}\s+){2,}/.test(t);
}

/** The user-visible strings of one TypeScript file: [{ text, line, command }]. */
export function tsStrings(source, fileName = 'x.ts') {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const out = [];
  const add = (node, text) => {
    let ctx = uiContext(node);
    const html = /<[a-z][^>]*>/i.test(text);
    if (!ctx) {
      // any other string with words in it, wherever it is: right-click menus, toasts, errors, …
      if (!(WORDS.test(text) || html) || hiddenContext(node)) return;
      ctx = { command: false, input: false, broad: true };
    }
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
    const pieces = html ? htmlText(text) : [{ text }];
    for (const { text: p, attr } of pieces) {
      const t = p.trim();
      if (!t || looksLikeId(t)) continue;
      if (ctx.broad ? !WORDS.test(t) || codeLike(t) : dataLike(t)) continue;
      out.push({ text: p, line, command: ctx.command && commandLike(t), input: !!ctx.input || attr === 'placeholder' });
    }
  };
  const visit = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) add(node, node.text);
    else if (ts.isTemplateExpression(node)) {
      // the literal parts, with each ${…} read as a space
      add(node, [node.head.text, ...node.templateSpans.map((s) => ' ' + s.literal.text)].join(''));
      // literals inside the ${…} parts are found by the walk below, with the template as their context
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** The user-visible strings of an HTML page: [{ text, line, command }]. */
export function pageStrings(html) {
  const out = [];
  const lines = html.split('\n');
  let inSkip = false;
  lines.forEach((ln, i) => {
    // whole <script> / <style> / <svg> blocks are skipped across lines
    let s = ln;
    if (inSkip) { const e = s.search(/<\/(script|style|svg)>/i); if (e < 0) return; s = s.slice(e); inSkip = false; }
    if (/<(script|style|svg)\b/i.test(s) && !/<\/(script|style|svg)>/i.test(s)) { s = s.slice(0, s.search(/<(script|style|svg)\b/i)); inSkip = true; }
    const command = /role="menuitem"|<button\b/.test(s);
    for (const x of htmlText(s)) {
      const t = x.text.trim();
      if (!t || looksLikeId(t) && !/^[A-Z]/.test(t)) continue;
      out.push({ text: t, line: i + 1, command: command && !x.attr && commandLike(t), input: x.attr === 'placeholder' });
    }
  });
  return out;
}

/** The files read: the two HTML pages and every TypeScript file in src/ except third-party code and type files. */
export function uiFiles(root = ROOT) {
  const files = ['index.html', 'audience.html'];
  const walk = (dir) => {
    for (const f of readdirSync(join(root, dir))) {
      const rel = `${dir}/${f}`;
      if (statSync(join(root, rel)).isDirectory()) { if (!['src/vendor'].includes(rel)) walk(rel); }
      else if (rel.endsWith('.ts') && !rel.endsWith('.d.ts')) files.push(rel);
    }
  };
  walk('src');
  return files;
}

/**
 * Text that breaks a rule on purpose, each with the reason. `file` and `text` (a piece of the
 * string; with `exact`, the whole string) must both match; `re` instead of `text` matches any
 * string of the file, and `prefix` makes `file` a folder. Keep this short: fix the text instead
 * where you can.
 */
export const ALLOWED = [
  { file: 'index.html', text: 'tOGGLE cASE', why: "Office's own name for this Change Case choice (UI rule 1 wins over S64 here)." },
  { file: 'src/ui/font-group.ts', text: 'tOGGLE cASE', why: "Office's own name for this Change Case choice (UI rule 1 wins over S64 here)." },
  { file: 'src/ui/diagram-dialog.ts', text: 'Formulas are subscripted automatically (CO2)', why: 'shows what is typed before it is subscripted' },
  { file: 'src/ui/typing-dialog.ts', text: 'CH2Cl2 becomes CH₂Cl₂', why: 'shows what is typed before it is subscripted' },
  { file: 'src/ui/si-mode.ts', text: 'Select the formula first (CH2Cl2, PF6-)', why: 'the plain typed text that Formula style turns into a formula' },
  { file: 'src/ui/property-dialog.ts', text: 'any adduct can be typed, such as [M+H]+', why: 'the adduct as it is typed into this box' },
  { file: 'src/ui/font-box.ts', text: 'tOGGLE cASE', why: "Office's own name for this Change Case choice (UI rule 1 wins over S64 here)." },
  { file: 'src/editor/editor.ts', text: 'Hotkey', exact: true, why: 'the Undo step for a ChemDraw-style atom or bond key, which S82 calls a hotkey' },
  // Whole files (from the wording lint of 2026-11-16): search words, Excel's own help, and template text a person replaces
  { file: 'src/ui/command-search.ts', re: /./, why: 'former names and other words, so old words still find commands' },
  { file: 'src/text/symbol-table.ts', re: /tick/i, why: "the ✓ symbol's search words" },
  { file: 'src/sheet/fn-help.ts', re: /./, why: "Excel's own function help" },
  { file: 'src/design/', prefix: true, re: /./, why: 'template text a person replaces' },
  { file: 'src/document/templates.ts', re: /./, why: 'template text a person replaces' },
  // Formulas the person types, shown flat because that is what they type (S27 is about how text is shown)
  { file: 'index.html', text: 'make every CH2Cl2 a formula', why: 'describes plain typed text that Replace turns into a formula' },
  { file: 'src/ui/style-panel.ts', text: 'Formulas are subscripted automatically (H2O', why: 'shows what is typed before it is subscripted' },
  { file: 'src/ui/si-settings.ts', text: 'Solvents are recognized however the NMR report writes them', why: 'quotes how reports write solvent names' },
  { file: 'src/ui/nmr-panel.ts', text: 'paste a list such as 1H NMR', why: 'an example of the text to paste' },
  { file: 'src/ui/sheet-mode.ts', text: 'or a formula such as C10H12N2O', why: 'a formula typed into a spreadsheet function' },
  { file: 'src/sheet/isotopes.ts', text: 'a formula such as C10H12N2O', why: 'a formula typed into a spreadsheet function' },
  { file: 'src/ui/property-dialog.ts', text: '(any adduct can be typed)', why: 'the adducts as they are typed into this box' },
  // An input's starting value that is typed text: an adduct is typed flat, and parsed as typed
  { file: 'src/ui/property-dialog.ts', text: '[M+H]+', exact: true, why: "the Ion box's starting value, typed text that parseAdduct reads" },
  { file: 'src/ui/sheet-mode.ts', text: '[M+H]+', exact: true, why: "the Isotope Pattern window's Ion box starting value, typed text that parseAdduct reads" },
  // Data that happens to sit under a `label` key but is drawn as chemistry text, not shown as written
  { file: 'src/main.ts', text: 'CH3', exact: true, why: "a Newman preview's group label, drawn with real subscripts, and the Terminal methyls option's stored value (its label is CH₃)" },
  { file: 'src/chem/analysis.ts', text: '-CH2- (ring)', exact: true, why: "a Joback group's key in the JOBACK table; the Properties tooltip shows it with real subscripts (jobackGroupList in analysis-panel.ts)" },
  // Proper names keep their own spelling (S29)
  { file: 'src/kb/glossary.ts', text: 'Classification, Labelling and Packaging', why: 'the title of EU Regulation (EC) No 1272/2008 (CLP), a proper name' },
  // Text sent to an AI model, never shown
  { file: 'src/recognise/reader.ts', text: 'Expand abbreviations (Ph, OMe, Boc, Ts, TBS, CO2Et) into atoms.', why: 'part of the instructions sent to the AI model that reads a drawing (AI_SYSTEM); the person never sees it' },
];

// Problems that were in the app when this check was added are listed in lint-ui-text-known.mjs.
export { KNOWN_UI_TEXT };

/** A known problem is matched by its file, the word found and the whole string (spaces collapsed). */
export const keyOf = (file, found, text) => `${file}\t${found}\t${text.replace(/\s+/g, ' ').trim()}`;

/** Known problems whose string no longer has that problem: the text was fixed, so the line goes. */
export function staleKnown(problems = lintRepo()) {
  const found = new Set(problems.map((p) => keyOf(p.file, p.found, p.text)));
  return KNOWN_UI_TEXT.filter((k) => !found.has(keyOf(k.file, k.found, k.text)));
}

const KNOWN_HEADER = `// Problems in user-visible text that were in Chemweave when scripts/lint-ui-text.mjs was added
// (2026-11-22; widened the same day to every string with words in it). Each is a real problem
// against docs/ui-style.md, listed one by one (file, the word found, the whole string) so the
// check can run on every pull request while they are fixed. Fix the text and delete its line (or
// run node scripts/lint-ui-text.mjs --prune); the test fails while a fixed line is still here.
// Never add a line for new text: fix the text, or for a deliberate exception add it to ALLOWED in
// lint-ui-text.mjs with the reason. --write re-records the whole list; use it only after merging
// branches that each changed UI text, and check the diff adds nothing new. Every listed problem
// was fixed on 2026-11-22 and the list is empty: keep it so.
`;

function writeKnown(list) {
  const seen = new Set();
  const rows = [];
  for (const k of list) {
    const text = k.text.replace(/\s+/g, ' ').trim();
    const key = keyOf(k.file, k.found, text);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(`  ${JSON.stringify({ file: k.file, found: k.found, text })},`);
  }
  writeFileSync(join(ROOT, 'scripts/lint-ui-text-known.mjs'), `${KNOWN_HEADER}export const KNOWN_UI_TEXT = [\n${rows.map((r) => r + '\n').join('')}];\n`);
  return rows.length;
}

/** Every problem in the repository: [{ file, line, text, rule, found, use, known }]. */
export function lintRepo(root = ROOT) {
  const out = [];
  const known = new Set(KNOWN_UI_TEXT.map((k) => keyOf(k.file, k.found, k.text)));
  for (const file of uiFiles(root)) {
    const src = readFileSync(join(root, file), 'utf8');
    const strings = file.endsWith('.html') ? pageStrings(src) : tsStrings(src, file);
    for (const s of strings) {
      for (const p of checkText(s.text, { command: s.command, input: s.input })) {
        if (ALLOWED.some((a) => (a.prefix ? file.startsWith(a.file) : a.file === file) && (a.re ? a.re.test(s.text) : a.exact ? s.text.trim() === a.text : s.text.includes(a.text)))) continue;
        out.push({ file, line: s.line, text: s.text.replace(/\s+/g, ' ').trim(), ...p, known: known.has(keyOf(file, p.found, s.text)) });
      }
    }
  }
  return out;
}

/** One line per problem, for the terminal and the test's failure message. */
export function describeProblem(p) {
  const text = p.text.length > 140 ? p.text.slice(0, 137) + '…' : p.text;
  return `${p.file}:${p.line}  ${p.rule}: "${p.found}" (use ${p.use})  in: ${text}`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const all = process.argv.includes('--all');
  if (process.argv.includes('--stale') || process.argv.includes('--prune')) {
    const stale = staleKnown();
    for (const k of stale) console.log(`fixed, remove from lint-ui-text-known.mjs: ${k.file}  "${k.found}"  in: ${k.text}`);
    if (process.argv.includes('--prune') && stale.length) {
      const gone = new Set(stale.map((k) => keyOf(k.file, k.found, k.text)));
      writeKnown(KNOWN_UI_TEXT.filter((k) => !gone.has(keyOf(k.file, k.found, k.text))));
      console.log(`${stale.length} line(s) deleted from lint-ui-text-known.mjs.`);
    } else console.log(`${stale.length} known problem(s) no longer found.`);
    process.exit(0);
  }
  if (process.argv.includes('--write')) {
    const n = writeKnown(lintRepo());
    console.log(`${n} problem(s) written to lint-ui-text-known.mjs.`);
    process.exit(0);
  }
  const json = process.argv.includes('--json');
  const problems = lintRepo();
  const shown = all ? problems : problems.filter((p) => !p.known);
  if (json) console.log(JSON.stringify(shown.map(({ file, found, text }) => ({ file, found, text: text.slice(0, 120) })), null, 1));
  else for (const p of shown) console.log((p.known ? '(known) ' : '') + describeProblem(p));
  const fresh = problems.filter((p) => !p.known).length;
  console.log(`${fresh} problem(s) in user-visible text${all ? `, ${problems.length - fresh} known` : ''}. Rules: docs/ui-style.md.`);
  process.exit(fresh ? 1 : 0);
}

