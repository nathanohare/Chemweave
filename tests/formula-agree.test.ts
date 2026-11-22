// @vitest-environment jsdom
//
// Formula style shows the same everywhere (review F2b-R01): the drawing and Documents, a Word
// file, a PowerPoint text box and copied HTML all read a formula run across the runs of its own
// paragraph, by ChemDraw's rule (tests/richtext.test.ts). Before, Word and PowerPoint read each
// run alone and the editor read the whole text, so a sign could be up in one and down in another.
//
// Chemistry: sodium acetate written CH₃CO₂⁻Na⁺ (PubChem CID 517045); azide N₃⁻ (PubChem CID 33558).

import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { writeDocx, type DocxDeps } from '../src/io/docx';
import { paragraphsXml } from '../src/io/pptx-write';
import { runsHtml } from '../src/text/html';
import { newDocument, paraFromStyle, runStyleOf, type DocText } from '../src/document/document';
import { arialWidth } from '../src/text-metrics';
import * as rt from '../src/richtext';
import type { TextRun } from '../src/model';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const deps: DocxDeps = { async picture() { return null; }, async svgToPng() { return PNG; } };
const measure = (t: string, s: number, _f: string, st: string) => arialWidth(t, s, /bold/.test(st));

// three paragraphs: two hyphens in a name first (which must not make the later signs names),
// then sodium acetate split over two runs, then azide
const f = (text: string): TextRun => ({ text, formula: true });
const RUNS: TextRun[] = [{ text: 'Red-Al, then Me-Al\n' }, f('CH3CO2-Na'), f('+'), { text: '\n' }, f('N3-')];
const EXPECTED = ['Red-Al, then Me-Al', 'CH_3CO_2^-Na^+', 'N_3^-'];

const mark = (text: string, pos: string | null | undefined) => (pos === 'sub' ? `_${text}` : pos === 'sup' ? `^${text}` : text);

describe('formula style agrees in every place it is shown or written (review F2b-R01)', () => {
  it('in the drawing and Documents (the whole text\'s runs)', () => {
    const runs = rt.normalizeRuns(RUNS.map((r) => ({ ...r })));
    let out = '';
    runs.forEach((r, k) => {
      if (r.formula) for (const p of rt.formulaRunParts(runs, k)) out += mark(p.text, p.pos);
      else out += r.text;
    });
    expect(out.split('\n')).toEqual(EXPECTED);
  });

  it('in copied HTML (each paragraph\'s runs)', () => {
    const paras = [[RUNS[0]], [RUNS[1], RUNS[2]], [RUNS[4]]].map((rs) => rs.map((r) => ({ ...r, text: r.text.replace('\n', '') })));
    const shown = paras.map((rs) => {
      const doc = new DOMParser().parseFromString(`<div>${runsHtml(rs)}</div>`, 'text/html');
      let out = '';
      const walk = (n: Node) => { for (const c of [...n.childNodes]) { if (c.nodeType === 3) out += c.textContent; else { const tag = (c as Element).tagName; out += tag === 'SUB' ? `_${c.textContent}` : tag === 'SUP' ? `^${c.textContent}` : ''; if (tag !== 'SUB' && tag !== 'SUP') walk(c); } } };
      walk(doc.body);
      return out;
    });
    expect(shown).toEqual(EXPECTED);
  });

  it('in a Word file', async () => {
    const d = newDocument();
    const n = runStyleOf(d.styles.Normal);
    const t: DocText = { ...d, runs: rt.normalizeRuns(RUNS.map((r) => ({ ...n, ...r }))), paras: [0, 1, 2].map(() => paraFromStyle(d.styles.Normal, {})) };
    const xml = strFromU8(unzipSync(await writeDocx(t, deps))['word/document.xml']);
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const shown = [...doc.getElementsByTagNameNS(W, 'body')[0].getElementsByTagNameNS(W, 'p')].map((p) =>
      [...p.getElementsByTagNameNS(W, 'r')].map((r) => {
        const va = r.getElementsByTagNameNS(W, 'vertAlign')[0]?.getAttributeNS(W, 'val');
        const text = [...r.getElementsByTagNameNS(W, 't')].map((x) => x.textContent).join('');
        return mark(text, va === 'subscript' ? 'sub' : va === 'superscript' ? 'sup' : null);
      }).join('')).filter((s) => s);
    expect(shown).toEqual(EXPECTED);
  });

  it('in a PowerPoint text box', () => {
    const xml = paragraphsXml({ id: 1, x: 0, y: 0, runs: RUNS, justify: 'left' }, null, 18, measure);
    const doc = new DOMParser().parseFromString(`<x xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${xml}</x>`, 'application/xml');
    const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
    const shown = [...doc.getElementsByTagNameNS(A, 'p')].map((p) =>
      [...p.getElementsByTagNameNS(A, 'r')].map((r) => {
        const bl = Number(r.getElementsByTagNameNS(A, 'rPr')[0]?.getAttribute('baseline') ?? 0);
        return mark(r.getElementsByTagNameNS(A, 't')[0].textContent ?? '', bl < 0 ? 'sub' : bl > 0 ? 'sup' : null);
      }).join(''));
    expect(shown).toEqual(EXPECTED);
  });
});
