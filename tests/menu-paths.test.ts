// @vitest-environment jsdom
//
// Every menu path written in the program's messages and in the User Guide ("Insert ▸ Slides ▸
// New Canvas Slide") leads to a real menu item, so a menu regrouped later (review of F5, F5b-R02)
// can't leave messages pointing at places that no longer exist. A path that names a ribbon tab
// (Insert, View) and then one of its buttons is a ribbon path and is left alone; anything past a
// command (Edit ▸ Settings… ▸ AI Model) is inside its window.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { INSERT_MENU, renderMenu } from '../src/commands/registry';

const ROOT = join(__dirname, '..');
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');
const TOP = ['File', 'Edit', 'View', 'Insert', 'Format', 'Chemistry', 'Help'];

const norm = (s: string) => s.replace(/\*+|`|…|\.\.\.|▾|"|“|”/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim().toLowerCase();

const page = new DOMParser().parseFromString(read('index.html'), 'text/html');
renderMenu(page.getElementById('insert-menu')!, INSERT_MENU);
const menus = new Map([...page.querySelectorAll<HTMLElement>('header > .menu-wrap')].map((w) => [w.querySelector(':scope > button')!.textContent!.trim(), w.querySelector<HTMLElement>(':scope > .menu')!]));

/** Ribbon tab names and button labels, from index.html and the ribbons built in code. */
const ribbonCode = readdirSync(join(ROOT, 'src/ui')).filter((f) => /ribbon|font-group|si-mode|doc-mode|sheet-mode|animation-ui|dashboard-ui/.test(f)).map((f) => read(`src/ui/${f}`)).join('\n');
const tabs = new Set([...page.querySelectorAll('[role=tab]')].map((t) => norm(t.textContent!)).concat(['home', 'draw', 'structure', 'arrange', 'text', 'object', 'insert', 'view', 'review', 'data', 'design', 'chemistry']));
const ribbonLabels = new Set([
  ...[...page.querySelectorAll('.ribbon button, .rb-group')].flatMap((b) => {
    const t = b.cloneNode(true) as HTMLElement;
    t.querySelectorAll('.rb-icon, svg').forEach((i) => i.remove());
    return [norm(t.textContent!), norm(b.getAttribute('aria-label') ?? ''), norm((b.getAttribute('title') ?? '').split(/[:(]/)[0])];
  }),
  ...[...ribbonCode.matchAll(/>([^<>{}$`]{2,60})<\/(?:button|span|div)>/g)].map((m) => norm(m[1])),
  ...[...ribbonCode.matchAll(/(?:name|label|title|aria-label)[=:]\s*['"]([^'"]{2,60})['"]/g)].map((m) => norm(m[1].split(/[:(]/)[0])),
].filter(Boolean));

/** The label of a menu row: its own text, without the key shown beside it. */
const label = (el: Element) => {
  const b = el.matches('.submenu') ? el.querySelector(':scope > button')! : el;
  const t = b.cloneNode(true) as HTMLElement;
  t.querySelector('kbd')?.remove();
  return norm(t.textContent!);
};
/** One step down a menu: the row whose label the segment starts with (the guide's sentence can carry on after the name). */
function step(list: Element, seg: string, last: boolean): Element | null {
  const s = norm(seg);
  const rows = [...list.children].filter((c) => c.matches('button[data-cmd], .submenu'));
  return rows.find((r) => label(r) === s)
    ?? rows.find((r) => s.startsWith(label(r) + ' ') || s.startsWith(label(r) + '('))
    ?? (last ? rows.find((r) => label(r).startsWith(s) && s.length >= 4) : undefined)
    ?? null;
}
/** Other programs' menus the guide sends you to (the Finder's File ▸ Get Info; Office's document properties). */
const OTHER_PROGRAMS = ['File ▸ Get Info', 'File ▸ Properties ▸ Custom'];

/** Why a path leads nowhere, or null when it leads to a menu item (or is a ribbon path). */
function broken(path: string): string | null {
  if (OTHER_PROGRAMS.includes(path)) return null;
  const segs = path.split('▸').map((s) => s.trim()).filter(Boolean);
  let list: Element | undefined = menus.get(segs[0]);
  if (!list || segs.length < 2) return null;
  for (let i = 1; i < segs.length; i++) {
    const row = step(list, segs[i], i === segs.length - 1);
    if (!row) {
      if (i === 1 && tabs.has(norm(segs[0])) && [...ribbonLabels].some((l) => l.length > 1 && (norm(segs[1]) === l || norm(segs[1]).startsWith(l + ' ')))) return null;
      return `no "${segs[i]}" in ${segs.slice(0, i).join(' ▸ ')}`;
    }
    if (!row.matches('.submenu')) return null; // a command: what follows is inside its window
    list = row.querySelector(':scope > .menu')!;
  }
  return null;
}

/** Menu paths in a text: a top menu's name, then ▸ and names, up to the end of the phrase. */
function paths(text: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`(?<![\\w-])(${TOP.join('|')})((?:\\s*▸\\s*[^▸\\n.,;:!?'"\`<>|\\]\\[]+?)+)(?=\\*\\*|[.,;:!?'"\`<>|\\]\\[\\n]|\\s+(?:and|or|to|in|on|for|adds|makes|shows|opens|then|with|lists|is|are)\\s|$)`, 'g');
  for (const m of text.matchAll(re)) {
    // a bracket the path is inside of ends it: "(Insert ▸ Shapes)"
    let p = (m[1] + m[2]).replace(/\*+/g, '');
    let depth = 0;
    for (let i = 0; i < p.length; i++) {
      if (p[i] === '(') depth++;
      else if (p[i] === ')' && --depth < 0) { p = p.slice(0, i); break; }
    }
    out.push(p.trim());
  }
  return out;
}
/** The program's text without its comments (a comment's path is a note to the reader, not a message). */
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1').replace(/<!--[\s\S]*?-->/g, '');

function files(dir: string, ext: RegExp): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((f) => {
    const p = `${dir}/${f}`;
    return statSync(join(ROOT, p)).isDirectory() ? files(p, ext) : ext.test(f) ? [p] : [];
  });
}

describe('menu paths in messages and the User Guide (F5b-R02)', () => {
  it('finds paths and resolves them through submenus and into windows', () => {
    expect(paths('Use **Insert ▸ Slides ▸ New Canvas Slide** to start.')).toEqual(['Insert ▸ Slides ▸ New Canvas Slide']);
    expect(broken('Insert ▸ Slides ▸ New Canvas Slide')).toBeNull();
    expect(broken('Edit ▸ Settings… ▸ AI Model')).toBeNull();
    expect(broken('Insert ▸ Presentation ▸ New Canvas Slide')).toMatch(/no "Presentation"/);
    expect(broken('Edit ▸ Presentation ▸ Copy Slides')).toMatch(/no "Presentation"/);
  });

  it('every path in docs/guide leads somewhere', () => {
    const bad: string[] = [];
    for (const f of files('docs/guide', /\.md$/)) for (const p of paths(read(f))) { const why = broken(p); if (why) bad.push(`${f}: ${p} (${why})`); }
    expect(bad).toEqual([]);
  });

  it('every path in the program leads somewhere', () => {
    const bad: string[] = [];
    for (const f of [...files('src', /\.ts$/), 'index.html']) for (const p of paths(code(read(f)))) { const why = broken(p); if (why) bad.push(`${f}: ${p} (${why})`); }
    expect(bad).toEqual([]);
  });
});
