// Builds the GitHub wiki (github.com/nathanohare/Chemweave/wiki) from the user guide in docs/.
//
//   node scripts/build-wiki.mjs <out dir>     writes the wiki pages into <out dir> (a clone of
//                                              Chemweave.wiki.git) and removes pages it no longer makes
//   node scripts/build-wiki.mjs --check       builds into a temporary folder and only reports links
//                                              and pictures that lead nowhere (exit code 1 if any)
//
// docs/ stays the one place the guide is written. The wiki is a copy laid out for browsing: a
// sidebar, the long Canvas page split into shorter pages, a short "On this page" list on long
// pages, previous and next links at the foot of every page, and an A to Z list of every topic.
// A line `<!-- index: Smart Scheme, catalytic cycle -->` under a heading in docs/ adds those words
// to the A to Z list, pointing at that heading (the comment itself shows nowhere). Links between guide pages are pointed at the matching
// wiki page and heading, pictures at the files in docs/images on the main branch, and links to
// other files in the repository at those files on GitHub. Each page ends with a link to the file
// it came from, because edits made on the wiki itself are replaced the next time it is built
// (.github/workflows/wiki.yml rebuilds it after each merge into main that changes docs/).
//
// No packages: Node's own modules only, so the workflow needs no `npm ci`.

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync, unlinkSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname, resolve, relative, posix } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = process.env.GITHUB_REPOSITORY || 'nathanohare/Chemweave';
const BRANCH = 'main';
const BLOB = `https://github.com/${REPO}/blob/${BRANCH}/`;
const TREE = `https://github.com/${REPO}/tree/${BRANCH}/`;
const RAW = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/`;
const WEB_APP = 'https://nathanohare.github.io/Chemweave/';

/**
 * The wiki's pages, in sidebar order. `src` is the file in the repository the page is made from;
 * `group` is the sidebar heading it is listed under. A page with `split` keeps the text before its
 * first `##` heading and sends the listed `##` sections to pages of their own; a `##` section that
 * no sub-page lists stays on the main page (so a new section in docs/ is never lost), and the
 * build says so, so it can be given a home.
 */
export const PAGES = [
  { name: 'Home', src: 'docs/README.md', label: 'Home' },
  { name: 'Getting-Started', src: 'docs/guide/getting-started.md', label: 'Getting started', group: 'Start here' },
  { name: 'Keyboard-and-Mouse', src: 'docs/guide/keyboard-and-mouse.md', label: 'Keyboard and mouse', group: 'Start here' },
  {
    name: 'Canvas', src: 'docs/guide/drawing.md', label: 'Canvas', group: 'The modes',
    split: [
      { name: 'Canvas-Ribbon', label: 'Ribbon', sections: ['The Canvas ribbon'] },
      { name: 'Canvas-Toolbox', label: 'Toolbox', sections: ['The toolbox', 'Keyboard shortcuts on atoms and bonds'] },
      { name: 'Canvas-Text-and-Captions', label: 'Text and captions', sections: ['Text and captions'] },
      { name: 'Canvas-Moving-and-Rotating', label: 'Moving and rotating', sections: ['Rotating a structure in perspective', 'Moving, rotating and the Format menu'] },
      { name: 'Canvas-Chemistry-Menu', label: 'Chemistry menu and warnings', sections: ['The Chemistry menu', 'Warnings'] },
      { name: 'Canvas-Reactions-and-Schemes', label: 'Reactions and schemes', sections: ['Reactions and schemes'] },
      { name: 'Canvas-Page-and-Styles', label: 'Page, styles and colors', sections: ['Drawing styles', 'Navigating the page', 'The page', 'Reading Mode', 'Colors and palettes'] },
      { name: 'Canvas-Analysis-Panel', label: 'Analysis panel', sections: ['The Analysis panel', 'Mass fragmentation'] },
      { name: 'Canvas-Pictures-and-References', label: 'Pictures, hand drawings and references', sections: ['Structures from pictures and hand drawings', 'Pictures and tables', 'References as text'] },
      { name: 'Canvas-Toolboxes', label: 'Toolboxes and right-click menu', sections: ['Toolboxes', 'The right-click menu'] },
    ],
  },
  { name: 'Presentation', src: 'docs/guide/slides.md', label: 'Presentation', group: 'The modes' },
  { name: 'Spreadsheet', src: 'docs/guide/sheets.md', label: 'Spreadsheet', group: 'The modes' },
  { name: 'Document', src: 'docs/guide/documents.md', label: 'Document', group: 'The modes' },
  { name: 'Design', src: 'docs/guide/design.md', label: 'Design', group: 'The modes' },
  { name: 'SI-Project', src: 'docs/guide/si-project.md', label: 'SI Project', group: 'The modes' },
  { name: 'Libraries', src: 'docs/guide/libraries.md', label: 'Libraries and Find Structure', group: 'Everything else' },
  { name: 'Files-and-Sharing', src: 'docs/guide/files-and-sharing.md', label: 'Files and sharing', group: 'Everything else' },
  { name: 'Troubleshooting', src: 'docs/guide/troubleshooting.md', label: 'Troubleshooting', group: 'Everything else' },
  { name: 'Feedback', src: 'docs/guide/feedback.md', label: 'Feedback, problems and ideas', group: 'Everything else' },
  { name: 'For-Developers', src: 'docs/developers.md', label: 'For developers', group: 'Everything else' },
];

const INDEX_PAGE = { name: 'All-Topics', label: 'All topics, A to Z' };

// ---------------------------------------------------------------------------------------------
// Markdown helpers

/** The text a heading shows, without Markdown marks, links or HTML tags. */
export function headingText(md) {
  return md
    .replace(/<[^>]+>/g, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(\*|_)(.+?)\1/g, '$2')
    .trim();
}

/**
 * The id GitHub gives a heading (the part after # in a link to it), as github-slugger makes it:
 * lower case, punctuation and symbols dropped (letters, digits, `-` and `_` kept, in any script),
 * each space made a `-`. `seen` counts ids already used on the page: a repeat gets -1, -2, ...
 */
export function slug(text, seen) {
  let s = headingText(text).toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '').replace(/ /g, '-');
  if (seen) { // github-slugger's own numbering
    const base = s;
    while (seen.has(s)) {
      seen.set(base, seen.get(base) + 1);
      s = `${base}-${seen.get(base)}`;
    }
    seen.set(s, 0);
  }
  return s;
}

/** Splits a file into lines and marks the ones inside ``` code blocks, where nothing is changed. */
function lines(md) {
  const out = [];
  let fence = null;
  for (const text of md.replace(/\r\n/g, '\n').split('\n')) {
    const m = /^\s*(`{3,}|~{3,})/.exec(text);
    if (fence) {
      out.push({ text, code: true });
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null;
    } else if (m) {
      out.push({ text, code: true });
      fence = m[1];
    } else {
      out.push({ text, code: false });
    }
  }
  return out;
}

/** A line that only adds words to the A to Z list: `<!-- index: one, two -->`. */
const INDEX_WORDS = /^\s*<!--\s*index:\s*(.*?)\s*-->\s*$/i;

/**
 * The headings of some lines: level, text and their id on a page made of exactly these lines.
 * `words` are the extra A to Z entries given by `<!-- index: ... -->` lines under the heading.
 */
function headings(ls) {
  const seen = new Map();
  const out = [];
  ls.forEach((l, i) => {
    if (l.code) return;
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(l.text);
    if (m) { out.push({ line: i, level: m[1].length, text: headingText(m[2]), id: slug(m[2], seen), words: [] }); return; }
    const w = INDEX_WORDS.exec(l.text);
    if (w && out.length) out[out.length - 1].words.push(...w[1].split(',').map((x) => x.trim()).filter(Boolean));
  });
  return out;
}

/**
 * A docs page ends with a rule and a line "Next: [page] · [page] ...", for readers on GitHub and
 * in the app. The wiki has its sidebar and its own previous / next links, so that ending is left
 * out here (on a split page it would otherwise land on the last sub-page only).
 */
function dropNextLine(body) {
  let end = body.length;
  while (end && body[end - 1].text.trim() === '') end--;
  if (!end || body[end - 1].code || !/^Next:\s/.test(body[end - 1].text)) return body;
  end--;
  while (end && body[end - 1].text.trim() === '') end--;
  if (end && /^(-{3,}|\*{3,}|_{3,})\s*$/.test(body[end - 1].text)) end--;
  return body.slice(0, end);
}

// ---------------------------------------------------------------------------------------------
// Building

/**
 * Makes every page. Returns { files: {name: text}, warnings: [...] }. `root` is the repository
 * folder (tests point it at a folder of their own).
 */
export function buildWiki(root = ROOT, pages = PAGES) {
  const warnings = [];
  const out = []; // { name, label, src, lines, parent?, group?, children? }

  // 1. Cut each source file into its wiki pages.
  for (const p of pages) {
    const path = join(root, p.src);
    if (!existsSync(path)) { warnings.push(`${p.src}: file not found, page ${p.name} left out`); continue; }
    const ls = lines(readFileSync(path, 'utf8'));
    const hs = headings(ls);
    // the page title is the wiki page's name, so the file's own # title is left out
    const h1 = hs.find((h) => h.level === 1);
    const body = dropNextLine(ls.map((l, i) => ({ ...l, srcLine: i })).filter((l, i) => !(h1 && i === h1.line)));
    if (!p.split) { out.push({ ...p, lines: body }); continue; }

    const h2s = hs.filter((h) => h.level === 2);
    const sectionOf = new Map(); // h2 text -> lines of that section
    h2s.forEach((h, k) => {
      const end = k + 1 < h2s.length ? h2s[k + 1].line : ls.length;
      sectionOf.set(h.text, body.filter((l) => l.srcLine >= h.line && l.srcLine < end));
    });
    const firstH2 = h2s.length ? h2s[0].line : ls.length;
    const main = { ...p, lines: body.filter((l) => l.srcLine < firstH2), children: [] };
    out.push(main);
    const used = new Set();
    for (const c of p.split) {
      const cl = [];
      for (const s of c.sections) {
        if (!sectionOf.has(s)) { warnings.push(`${p.src}: no "## ${s}" section for page ${c.name}`); continue; }
        if (cl.length && cl[cl.length - 1].text.trim() !== '') cl.push({ text: '', code: false });
        cl.push(...sectionOf.get(s));
        used.add(s);
      }
      const child = { name: c.name, label: c.label, src: p.src, lines: cl, parent: main };
      main.children.push(child);
      out.push(child);
    }
    for (const h of h2s) {
      if (used.has(h.text)) continue;
      warnings.push(`${p.src}: "## ${h.text}" is not given a page in scripts/build-wiki.mjs, so it stays on ${p.name}`);
      main.lines.push({ text: '', code: false }, ...sectionOf.get(h.text));
    }
  }

  // 2. Where every heading of every source file ended up: "docs/guide/drawing.md#warnings" ->
  //    "Canvas-Chemistry-Menu#warnings". Ids are worked out twice: as GitHub numbers them in the
  //    whole source file (what links in docs/ use) and on the wiki page they land on.
  const target = new Map();
  for (const p of pages) if (out.some((o) => o.src === p.src)) target.set(p.src, p.name);
  const srcIds = new Map(); // src -> Map(srcLine -> id in the source file)
  for (const p of pages) {
    const path = join(root, p.src);
    if (!existsSync(path)) continue;
    srcIds.set(p.src, new Map(headings(lines(readFileSync(path, 'utf8'))).map((h) => [h.line, h.id])));
  }
  for (const page of out) {
    page.headings = headings(page.lines);
    for (const h of page.headings) {
      const srcLine = page.lines[h.line].srcLine;
      const srcId = srcIds.get(page.src)?.get(srcLine);
      if (srcId !== undefined) target.set(`${page.src}#${srcId}`, `${page.name}#${h.id}`);
    }
  }

  // "see Orbitals below" stops being true when the section it means went to another page.
  for (const page of out) {
    if (!page.parent) continue;
    const elsewhere = new Map(); // heading text (lower case) -> the sibling page it is on
    for (const sib of page.parent.children) {
      if (sib === page) continue;
      for (const h of sib.headings) elsewhere.set(h.text.toLowerCase(), sib);
    }
    const here = new Set(page.headings.map((h) => h.text.toLowerCase()));
    for (const l of page.lines) {
      if (l.code) continue;
      for (const m of l.text.matchAll(/\bsee (?:the )?([^.;:()\[\]]{2,60}?) (below|above)\b/gi)) {
        const name = headingText(m[1]).toLowerCase();
        if (elsewhere.has(name) && !here.has(name)) {
          warnings.push(`${page.src} (${page.name}): "${m[0]}" but "${m[1]}" is on the page ${elsewhere.get(name).name}: make it a link instead`);
        }
      }
    }
  }

  // 3. Write each page, its links pointed at wiki pages, pictures and files on GitHub.
  const files = {};
  const order = out.filter((p) => p.name !== 'Home'); // reading order: the sidebar's, sub-pages after their page
  for (const page of out) {
    const fix = (url) => fixLink(url, page.src, target, root, warnings, page.name);
    // one entry for each line of the page (an index-words line is null: it is left out once the headings are placed)
    const text = page.lines.map((l) => (l.code ? l.text : INDEX_WORDS.test(l.text) ? null : fixLine(l.text, fix)));
    const k = order.indexOf(page);
    files[page.name] = finishPage(page, text, k > 0 ? order[k - 1] : null, k >= 0 ? order[k + 1] ?? null : order[0] ?? null);
  }
  files[INDEX_PAGE.name] = indexPage(out);
  files._Sidebar = sidebar(out);
  files._Footer = `[▶ Try Chemweave in your browser](${WEB_APP}) · [Download](https://github.com/${REPO}/releases/latest) · [Report a problem or ask for a feature](Feedback)\n`;
  return { files, warnings };
}

/** Points the links and pictures on one line at their wiki or GitHub addresses. Text in `code` is left alone. */
function fixLine(text, fix) {
  return text
    .split(/(`+[^`]*`+)/)
    .map((part, i) => (i % 2 ? part : part
      .replace(/(\]\()(<[^>]*>|[^)\s]+)((?:\s+"[^"]*")?\))/g, (_, a, url, b) => a + fix(url.replace(/^<|>$/g, '')) + b)
      .replace(/(<(?:img|a|source)\b[^>]*?\b(?:src|href)=")([^"]+)(")/g, (_, a, url, b) => a + fix(url) + b)))
    .join('');
}

const PICTURE = /\.(png|gif|jpe?g|svg|webp|mp4|webm)$/i;

function fixLink(url, src, target, root, warnings, pageName) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return url; // https:, mailto: ...
  const hash = url.indexOf('#');
  const path = hash >= 0 ? url.slice(0, hash) : url;
  const anchor = hash >= 0 ? url.slice(hash + 1) : '';
  const file = path ? posix.normalize(posix.join(posix.dirname(src), path)) : src;

  if (target.has(file)) {
    if (!anchor) return target.get(file);
    const t = target.get(`${file}#${decodeURIComponent(anchor).toLowerCase()}`);
    if (t) return t;
    warnings.push(`${src} (${pageName}): link to "${url}": ${file} has no heading with the id #${anchor}`);
    return target.get(file);
  }
  if (file.startsWith('..')) { warnings.push(`${src}: link "${url}" points outside the repository`); return url; }
  const onDisk = join(root, file);
  if (!existsSync(onDisk)) warnings.push(`${src} (${pageName}): link to "${url}": ${file} does not exist`);
  if (PICTURE.test(file)) return RAW + file;
  const dir = existsSync(onDisk) && statSync(onDisk).isDirectory();
  return (dir ? TREE : BLOB) + file + (anchor ? `#${anchor}` : '');
}

/**
 * "On this page" list, the previous and next pages in reading order (`prev`, `next`), and the line
 * saying where the page comes from. `text` has one entry for each line of the page (null: left out).
 */
function finishPage(page, text, prev, next) {
  const hs = page.headings;
  const h2 = hs.filter((h) => h.level === 2);
  const h3 = hs.filter((h) => h.level === 3);
  const link = (h) => `[${h.text}](#${h.id})`;
  let toc = null;
  if (page.name !== 'Home') {
    if (h2.length >= 4) {
      toc = [`**On this page:** ${h2.map(link).join(' · ')}`];
    } else if (h2.length + h3.length >= 4) {
      if (h2.length <= 1) {
        toc = [`**On this page:** ${h3.map(link).join(' · ')}`];
      } else { // a few main sections with sub-sections: a line for each main section
        toc = ['**On this page**', ''];
        h2.forEach((h, k) => {
          const end = k + 1 < h2.length ? h2[k + 1].line : Infinity;
          const subs = h3.filter((x) => x.line > h.line && x.line < end);
          toc.push(`- ${link(h)}${subs.length ? `: ${subs.map(link).join(' · ')}` : ''}`);
        });
      }
    }
  }
  let body = [...text];
  if (toc) {
    // after the opening paragraphs, just before the first heading
    const at = Math.max(0, text.findIndex((t, i) => hs.some((h) => h.line === i)));
    body = [...text.slice(0, at), ...toc, '', ...text.slice(at)];
  }
  body = body.filter((t) => t !== null);
  if (page.children?.length) {
    body.push('', '## Pages in this section', '');
    for (const c of page.children) {
      // its ## and ### headings in order, less the first ## (which the page's label already names)
      const shown = c.headings.filter((h, k) => (h.level === 2 && k > 0) || h.level === 3);
      const links = shown.map((h) => `[${h.text}](${c.name}#${h.id})`).join(', ');
      body.push(`- **[${c.label}](${c.name})**${links ? `: ${links}` : ''}`);
    }
  }
  // previous page · the page this one is part of · next page
  const nav = [];
  if (prev) nav.push(`← [${prev.label}](${prev.name})`);
  if (page.parent && page.parent !== prev) nav.push(`[${page.parent.label}](${page.parent.name})`);
  if (next) nav.push(`[${next.label}](${next.name}) →`);
  const navLine = nav.join(' · ');
  if (navLine) body = page.parent ? [navLine, '', ...body, '', navLine] : [...body, '', navLine];
  while (body.length && body[0].trim() === '') body.shift();
  while (body.length && body[body.length - 1].trim() === '') body.pop();
  body.push('', '---', '', `<sub>This page is made from [${page.src}](${BLOB}${page.src}) in the repository. To change it, edit that file: the wiki is rebuilt from it after each update, which replaces edits made here.</sub>`, '');
  return body.join('\n');
}

function sidebar(out) {
  const s = ['**[Chemweave user guide](Home)**', ''];
  let group = null;
  for (const p of out) {
    if (p.parent || p.name === 'Home') continue;
    if (p.group !== group) { group = p.group; s.push('', `**${group}**`, ''); }
    s.push(`- [${p.label}](${p.name})`);
    for (const c of p.children ?? []) s.push(`  - [${c.label}](${c.name})`);
  }
  s.push('', `[${INDEX_PAGE.label}](${INDEX_PAGE.name})`, '');
  return s.join('\n');
}

/**
 * How a topic is written in the A to Z list: a first word in small letters gets a capital
 * ("toolbox" → "Toolbox"), while one with capitals of its own (iPad, macOS, pKa) is left as it is.
 */
export function indexText(key) {
  const first = key.split(/[\s-]/)[0];
  return first.length > 1 && /^\p{Ll}+$/u.test(first) ? key[0].toUpperCase() + key.slice(1) : key;
}

/**
 * Every ##, ### and #### heading in the guide, and the words given under a heading with
 * `<!-- index: ... -->`, sorted A to Z ("The" and "A" at the start not counted). Beside each is
 * its page, and for a sub-heading the section it is in, so that a short heading ("Labels") says
 * what it is about.
 */
function indexPage(out) {
  const entries = [];
  const seen = new Set();
  for (const p of out) {
    if (p.name === 'Home' || p.name === 'For-Developers') continue;
    const page = p.parent ? `${p.parent.label}: ${p.label}` : p.label;
    let section = null;
    for (const h of p.headings) {
      if (h.level < 2 || h.level > 4 || h.text === 'Pages in this section') continue;
      if (h.level === 2) section = h.text;
      const inSection = h.level > 2 && section && !page.toLowerCase().endsWith(section.toLowerCase().replace(/^(the|a|an)\s+/, ''));
      const where = inSection ? `${page} › ${section}` : page;
      const link = `${p.name}#${h.id}`;
      for (const [n, t] of [h.text, ...h.words].entries()) {
        const key = t.replace(/^(the|a|an)\s+/i, '');
        if (seen.has(`${key.toLowerCase()}|${link}`)) continue;
        seen.add(`${key.toLowerCase()}|${link}`);
        entries.push({ key, text: n === 0 ? indexText(key) : key, link, where });
      }
    }
  }
  entries.sort((a, b) => a.key.localeCompare(b.key, 'en', { sensitivity: 'base', numeric: true }) || a.where.localeCompare(b.where));
  const letterOf = (e) => (/^[a-z]/i.test(e.key) ? e.key[0].toUpperCase() : '0–9');
  const letters = [...new Set(entries.map(letterOf))];
  const s = ['Every topic in the guide, A to Z. Ctrl+F (Cmd+F on a Mac) finds a word on this page.', '', letters.map((l) => `[${l}](#${slug(l)})`).join(' · '), ''];
  for (const l of letters) {
    s.push(`## ${l}`, '');
    for (const e of entries.filter((x) => letterOf(x) === l)) s.push(`- [${e.text}](${e.link}) <sub>${e.where}</sub>`);
    s.push('');
  }
  s.push('---', '', `<sub>Made from the headings of the pages in docs/ in the repository, and the index words written under them.</sub>`, '');
  return s.join('\n');
}

/** Writes the pages into `dir` and deletes .md pages there that the guide no longer makes. */
export function writeWiki(dir, files) {
  for (const f of readdirSync(dir)) {
    if (f.endsWith('.md') && !(f.slice(0, -3) in files)) unlinkSync(join(dir, f));
  }
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, `${name}.md`), text);
}

// ---------------------------------------------------------------------------------------------

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = process.argv[2];
  if (!arg) {
    console.error('usage: node scripts/build-wiki.mjs <wiki folder> | --check');
    process.exit(2);
  }
  const { files, warnings } = buildWiki();
  for (const w of warnings) console.warn(`warning: ${w}`);
  if (arg === '--check') {
    const tmp = mkdtempSync(join(tmpdir(), 'wiki-'));
    writeWiki(tmp, files);
    rmSync(tmp, { recursive: true, force: true });
    console.log(`${Object.keys(files).length} wiki pages, ${warnings.length} warning(s)`);
    process.exit(warnings.length ? 1 : 0);
  }
  if (!existsSync(arg)) { console.error(`${arg}: folder not found`); process.exit(2); }
  writeWiki(arg, files);
  console.log(`wrote ${Object.keys(files).length} wiki pages to ${relative(process.cwd(), arg) || '.'}${warnings.length ? `, ${warnings.length} warning(s)` : ''}`);
}
