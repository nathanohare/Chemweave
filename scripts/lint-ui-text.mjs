// Checks the words people read in Chemweave: command names, tooltips, menus, dialog text, status
// messages and Undo step names. It fails on the wording the style guide (docs/ui-style.md) rules
// out and on chemical formulas written flat where the app should show real subscripts and charges.
//
//   node scripts/lint-ui-text.mjs            lists every problem (exit code 1 if any)
//   node scripts/lint-ui-text.mjs --all      also lists the known ones (KNOWN_UI_TEXT below)
//
// tests/ui-text-lint.test.ts runs the same check on every pull request.
//
// Only user-visible strings are read, so code identifiers, comments, file-format keywords (CDXML
// attribute names, OOXML tags such as w:color) and test data are left alone:
//   - in index.html and audience.html: the text between tags and the title, aria-label,
//     placeholder and alt attributes (not class names, ids or data-* values);
//   - in src/**/*.ts: string literals in a UI position, that is the value of a property such as
//     title, label, tip or help; something assigned to .title, .textContent, .placeholder or
//     .innerHTML; or an argument of flash(), alert(), confirm(), setAttribute('title', …),
//     an Undo step name (doc.edit('Name', …)) and the other helpers listed in UI_CALLS.
//     A literal joined into such a value (a ? 'x' : 'y', 'x' + n, a template) counts too.
// Strings that look like identifiers (no space, and lower case or with - _ . : /) are skipped.
//
// No packages beyond TypeScript's parser, which the repository already has.

import { readFileSync, readdirSync, statSync } from 'node:fs';
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
  { re: /\byour turn\b|\bturn(?:s|ed|ing)? (?:(?:it|them|the [a-z-]+|a [a-z-]+|this|each [a-z-]+) )?(?:by \d|by [a-z]+ degrees|\d+ ?°|around|round (?:the|its|an?)\b|clockwise|anticlockwise|counterclockwise|counter-clockwise)/i, rule: 'S26', use: 'rotate (or "next", for a turn in a sequence)' },
  { re: /\bcarets?\b/i, rule: 'S70', use: 'cursor' },
  { re: /\bthe program\b/i, rule: 'S70', use: 'Chemweave' },
  { re: /\byour own\b/i, rule: 'S70', use: 'custom' },
  { re: /\btoggle[sd]?\b/i, rule: 'S64', use: 'a checkable command named for what it turns on (Snap to Objects)' },
  { re: /\bwork(?:s|ed|ing)? out\b/i, rule: 'S26', use: 'calculate' },
  { re: /\bby itself\b/i, rule: 'S26', use: 'automatically' },
];

/**
 * British spellings (UI rule 2, S29). Whole words only, so "colors" passes and a proper name can
 * still be written in KNOWN_UI_TEXT. Chemistry names IUPAC spells the British way (aluminium,
 * caesium) are not listed.
 */
export const BRITISH = [
  /\b(colour|behaviour|favour|favourite|flavour|honour|labour|neighbour|harbour|armour|humour|rumour)(s|ed|ing|ite|ites|ful|less)?\b/i,
  /\b(centre|centred|centres|centring|metre|metres|litre|litres|millilitre|millilitres|fibre|fibres|theatre)\b/i,
  /\b(grey|greys|greyed|greyish)\b/i,
  /\b(organis|realis|recognis|normalis|optimis|customis|minimis|maximis|initialis|visualis|summaris|prioritis|categoris|standardis|synchronis|authoris|finalis|serialis|capitalis|emphasis|memoris|characteris|utilis|apologis|criticis|specialis|localis|personalis|randomis|parametris|symbolis|digitis|stabilis|neutralis|crystallis|polymeris|ionis|isomeris|racemis|epimeris|aromatis)(e|ed|es|ing|ation|ations|er|ers)\b/i,
  /\banalys(e|ed|es|ing)\b/i,
  /\b(catalogue|catalogues|dialogue|dialogues|programme|programmes|artefact|artefacts|licence|licences|cheque|cheques)\b/i,
  /\b(labelled|labelling|modelled|modelling|travelled|travelling|cancelled|cancelling|levelled|levelling|signalled|signalling|totalled|totalling)\b/i,
  /\b(anticlockwise)\b/i,
];

/** The element symbols, for spotting a formula written flat. */
export const ELEMENTS = new Set(('H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr '
  + 'Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt '
  + 'Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og D').split(' '));

/** Splits a word into element symbols with counts, or null when it isn't one. "CDCl3" -> C D Cl3. */
export function formulaParts(word) {
  const parts = [];
  const re = /([A-Z][a-z]?)(\d*)/y;
  let i = 0;
  while (i < word.length) {
    re.lastIndex = i;
    const m = re.exec(word);
    if (!m) return null;
    let sym = m[1];
    let n = m[2];
    // a two-letter match that isn't an element may be one letter then the next symbol ("Co" vs "CO" is fine; "Cn" is an element)
    if (!ELEMENTS.has(sym)) {
      if (sym.length === 2 && ELEMENTS.has(sym[0])) { sym = sym[0]; n = ''; re.lastIndex = i + 1; } else return null;
      const d = /\d*/y; d.lastIndex = i + 1; n = d.exec(word)[0];
      i = i + 1 + n.length;
    } else i = re.lastIndex;
    parts.push({ sym, n });
  }
  return parts;
}

/** Words that look like formulas but are not: cell references, keys, file and product names. */
const NOT_FORMULA = /^(?:[A-Z]\d+|F\d{1,2}|H\d|MP\d|B3LYP|SN[12]|S[NE][12]'?|E[12]|CYP\d\w*|COVID\d+|Win\d+|UTF\d+|PDF\d?|ISO\d+|PEG\d+)$/;

/**
 * Formulas written flat (S27): an element symbol followed by digits, as in CH4, H2O or CDCl3
 * (two or more symbols, so cell references such as C1 and keys such as F5 pass), and a charge
 * written as a bare + or − after a formula or a bracket, as in Na+, BF4- or [M+H]+.
 */
export function flatFormulas(text) {
  const out = [];
  for (const m of text.matchAll(/[\[(]?[A-Za-z0-9()[\]]+[+\-−]?/g)) {
    const raw = m[0];
    let w = raw;
    let charge = '';
    // a sign followed by a letter or digit is not a charge (U+00B0, Ctrl+Z, N-methyl)
    if (/[+\-−]$/.test(w) && !/^[A-Za-z0-9]/.test(text.slice(m.index + raw.length))) { charge = w.slice(-1); w = w.slice(0, -1); }
    else if (/[+\-−]$/.test(w)) w = w.slice(0, -1);
    const core = w.replace(/^[\[(]+|[\])]+$/g, '');
    if (!core || NOT_FORMULA.test(core)) continue;
    const parts = /^[A-Z]/.test(core) && !/[()[\]]/.test(core) ? formulaParts(core) : null;
    const hasDigit = parts?.some((p) => p.n);
    if (parts && parts.length >= 2 && hasDigit) { out.push(raw); continue; }
    if (charge) {
      // a bare charge: after a formula with a digit (BF4-), or + / − after an ion or a bracket (Na+, [M+H]+)
      const bracket = /[\])]$/.test(w) && /^[\[(]/.test(w);
      if (parts && hasDigit) out.push(raw);
      else if (charge !== '-' && (bracket || (parts && parts.length <= 3 && core.length <= 4 && core !== 'C' && core !== 'A'))) out.push(raw);
    }
  }
  // the end of the text, where the regular expression above may have cut "[M+H]+" in two
  const m = text.match(/\[[A-Za-z0-9+\-−]+\][+\-−](?=$|[\s,.;:)])/g);
  if (m) for (const x of m) if (!out.some((o) => x.endsWith(o))) out.push(x);
  return out;
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
  for (const re of BRITISH) {
    const m = t.match(re);
    if (m) out.push({ rule: 'UI rule 2', found: m[0], use: 'American spelling' });
  }
  // Formulas the person types are shown flat on purpose: a placeholder (a format hint), a
  // before → after example, and what goes inside a formula's quotes or brackets (HRMS(B2,"[M+Na]+")).
  const prose = input || /→/.test(t) ? '' : t.replace(/"[^"]*"|“[^”]*”/g, ' ').replace(/\b[A-Z][A-Z0-9.]+\([^)]*\)/g, ' ');
  for (const f of flatFormulas(prose)) out.push({ rule: 'S27', found: f, use: 'real subscripts and raised charges (chemRuns / ₀–₉ ⁺ ⁻)' });
  if (command) for (const c of chemdrawInCommand(t)) out.push({ rule: 'S82', found: c, use: '"ChemDraw-style", or the format name' });
  return out;
}

// ---------------------------------------------------------------------------------------------
// Finding the user-visible strings

/** Properties whose value people read (an object's key, or a DOM property assigned). */
export const UI_PROPS = new Set(['title', 'label', 'tip', 'tooltip', 'help', 'hint', 'placeholder', 'textContent', 'innerText',
  'ariaLabel', 'message', 'blurb', 'about', 'heading', 'description', 'innerHTML', 'caption', 'confirmLabel', 'okLabel', 'cancelLabel', 'emptyText']);
/** Functions whose string arguments people read. */
export const UI_CALLS = new Set(['flash', 'alert', 'confirm', 'prompt', 'showStatus', 'setStatus', 'showToolStatus', 'notice', 'onNotice',
  'edit', 'button', 'btn', 'row', 'check', 'Option', 'ask', 'askText', 'heading', 'section', 'labelled', 'FloatBox', 'setGroup', 'menuItem', 'infoTip', 'warn']);
/** Command names: these properties and calls hold a command's own name (S82 applies). */
const COMMAND_PROPS = new Set(['label']);
/** A command name is short and has no sentence in it (a tooltip or a dialog's text is not one). */
const commandLike = (t) => t.length <= 40 && !/[:.,;]\s|[.:]$/.test(t);
const ATTRS = new Set(['title', 'aria-label', 'placeholder', 'alt']);

function looksLikeId(s) {
  if (/\s/.test(s)) return false;
  return /^[a-z0-9]/.test(s) || /[-_.:/#=<>{}]/.test(s);
}

/** The text of an HTML snippet that people read: text between tags, and title / aria-label / placeholder / alt values. */
export function htmlText(html) {
  const out = [];
  const h = html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style|svg)\b[\s\S]*?<\/\1>/gi, ' ');
  for (const m of h.matchAll(/\s(title|aria-label|placeholder|alt)\s*=\s*("([^"]*)"|'([^']*)')/gi)) out.push({ text: m[3] ?? m[4] ?? '', attr: m[1] });
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
      return UI_PROPS.has(k) ? { command: COMMAND_PROPS.has(k), input: k === 'placeholder' } : null;
    }
    if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.EqualsToken && p.right === n) {
      const l = p.left;
      if (ts.isPropertyAccessExpression(l) && UI_PROPS.has(l.name.text)) return { command: false, input: l.name.text === 'placeholder' };
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

/** The user-visible strings of one TypeScript file: [{ text, line, command }]. */
export function tsStrings(source, fileName = 'x.ts') {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const out = [];
  const add = (node, text) => {
    const ctx = uiContext(node);
    if (!ctx) return;
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
    const pieces = /<[a-z][^>]*>/i.test(text) ? htmlText(text).map((x) => x.text) : [text];
    for (const p of pieces) if (p.trim() && !looksLikeId(p.trim())) out.push({ text: p, line, command: ctx.command && commandLike(p.trim()), input: !!ctx.input });
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
 * string) must both match. Keep this short: fix the text instead where you can.
 */
export const ALLOWED = [
  { file: 'index.html', text: 'tOGGLE cASE', why: "Office's own name for this Change Case choice (UI rule 1 wins over S64 here)." },
  // Formulas the person types, shown flat because that is what they type (S27 is about how text is shown)
  { file: 'index.html', text: 'make every CH2Cl2 a formula', why: 'describes plain typed text that Replace turns into a formula' },
  { file: 'src/ui/style-panel.ts', text: 'Formulas are subscripted automatically (H2O', why: 'shows what is typed before it is subscripted' },
  { file: 'src/ui/si-settings.ts', text: 'Solvents are recognized however the NMR report writes them', why: 'quotes how reports write solvent names' },
  { file: 'src/ui/nmr-panel.ts', text: 'paste a list such as 1H NMR', why: 'an example of the text to paste' },
  { file: 'src/ui/sheet-mode.ts', text: 'or a formula such as C10H12N2O', why: 'a formula typed into a spreadsheet function' },
  { file: 'src/sheet/isotopes.ts', text: 'a formula such as C10H12N2O', why: 'a formula typed into a spreadsheet function' },
  { file: 'src/ui/property-dialog.ts', text: '(any adduct can be typed)', why: 'the adducts as they are typed into this box' },
  // Data that happens to sit under a `label` key but is drawn as chemistry text, not shown as written
  { file: 'src/main.ts', text: 'CH3', exact: true, why: "a Newman preview's group label, drawn with real subscripts" },
];

// Problems that were in the app when this check was added are listed in lint-ui-text-known.mjs.
export { KNOWN_UI_TEXT };

const keyOf = (file, found, text) => `${file}\t${found}\t${text.replace(/\s+/g, ' ').trim().slice(0, 120).trim()}`;

/** Every problem in the repository: [{ file, line, text, rule, found, use, known }]. */
export function lintRepo(root = ROOT) {
  const out = [];
  const known = new Set(KNOWN_UI_TEXT.map((k) => keyOf(k.file, k.found, k.text)));
  for (const file of uiFiles(root)) {
    const src = readFileSync(join(root, file), 'utf8');
    const strings = file.endsWith('.html') ? pageStrings(src) : tsStrings(src, file);
    for (const s of strings) {
      for (const p of checkText(s.text, { command: s.command, input: s.input })) {
        if (ALLOWED.some((a) => a.file === file && (a.exact ? s.text.trim() === a.text : s.text.includes(a.text)))) continue;
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
  if (process.argv.includes('--stale')) {
    const found = new Set(lintRepo().map((p) => keyOf(p.file, p.found, p.text)));
    const stale = KNOWN_UI_TEXT.filter((k) => !found.has(keyOf(k.file, k.found, k.text)));
    for (const k of stale) console.log(`fixed, remove from lint-ui-text-known.mjs: ${k.file}  "${k.found}"  in: ${k.text}`);
    console.log(`${stale.length} known problem(s) no longer found.`);
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

