// @vitest-environment jsdom
//
// A slide's objects that name each other across the parts a slide is saved in (deck/split-slide.ts:
// texts, plain shapes, connectors, drawings), kept through PowerPoint: the slide's links tag
// names them by the ids saved on each part, and they are found again on reading
// (pptx-read.ts restoreLinks), with what was deleted in PowerPoint dropping out (standing rule R3).
// Also a plain shape's own settings in its tag, with PowerPoint's own look, outline, name and Show
// winning where they were changed there, and a video's settings PowerPoint keeps nowhere of its own. Slides are
// built here in code; the PNG is a bare signature and header written by hand to the PNG
// specification (W3C, 2003), enough for its size to be read.

import { describe, it, expect } from 'vitest';
import { Doc, type Arrow, type Contents } from '../src/model';
import { Deck } from '../src/deck/deck';
import { writePptx, type PptxOptions } from '../src/io/pptx-write';
import { readPptx } from '../src/io/pptx-read';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 40, 0, 0, 0, 30]);
const PNG_URL = `data:image/png;base64,${btoa(String.fromCharCode(...PNG))}`;
const opts: PptxOptions = { async picture(d) { const b = d.bounds(); return b ? { png: PNG, svg: '<svg xmlns="http://www.w3.org/2000/svg"/>', box: b } : null; }, async svgToPng() { return PNG; } };
const ARROW: Omit<Arrow, 'id'> = { tail: { x: 0, y: 200 }, head: { x: 80, y: 200 }, headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'solid', noGo: false, equilibrium: false, sweep: 0, headLength: 6, headWidth: 1.5 };

/**
 * Saved to PowerPoint and read back; `edit` changes the saved parts first, as PowerPoint writes
 * them after a change made there (review F7b-R02, R07: simulated, not made in PowerPoint).
 */
async function trip(d: Doc, edit?: (parts: Record<string, string>) => void): Promise<Contents> {
  const deck = Deck.design(new Doc(), { w: 720, h: 405 });
  const slide = new Doc();
  slide.restoreContents(d.contents());
  let bytes = await writePptx({ size: deck.size, master: deck.master, slides: [{ layout: 'blank', doc: slide, notes: '' }] }, opts);
  if (edit) bytes = edited(bytes, edit);
  return readPptx(bytes).slides[0].contents;
}

function edited(bytes: Uint8Array, edit: (parts: Record<string, string>) => void): Uint8Array {
  const files = unzipSync(bytes);
  const text: Record<string, string> = {};
  for (const [n, b] of Object.entries(files)) if (/\.(xml|rels)$/.test(n)) text[n] = strFromU8(b);
  edit(text);
  for (const [n, t] of Object.entries(text)) files[n] = strToU8(t);
  return zipSync(files);
}

/** The slide's shape (p:sp) whose Selection Pane name is `name`, changed by `fix`. */
const onShape = (parts: Record<string, string>, name: string, fix: (sp: string) => string) => {
  const k = 'ppt/slides/slide1.xml';
  parts[k] = parts[k].replace(new RegExp(`<p:sp><p:nvSpPr><p:cNvPr id="\\d+" name="${name}"[\\s\\S]*?</p:sp>`), fix);
};

describe('links between a slide\'s parts (R3)', () => {
  it('keep a frame\'s members and a reagent arrow\'s step through PowerPoint', async () => {
    const d = new Doc();
    d.bulk(() => {
      const box = d.addShape({ kind: 'rect', x1: 300, y1: 100, x2: 360, y2: 140 });
      const c = d.addCaption({ x: 300, y: 60, runs: [{ text: 'a note' }], justify: 'left' });
      const main = d.addArrow({ ...ARROW });
      d.addArrow({ ...ARROW, tail: { x: 0, y: 260 }, head: { x: 80, y: 260 }, reagentFor: main.id });
      d.addShape({ kind: 'rect', x1: 280, y1: 40, x2: 380, y2: 160, frame: { atoms: [], captions: [c.id], arrows: [], shapes: [box.id], padX: 4, padY: 4, fit: false } });
    });
    const back = await trip(d);
    const frame = back.shapes.find((s) => s.frame)?.frame;
    const box = back.shapes.find((s) => !s.frame && s.kind === 'rect');
    expect(frame?.shapes).toEqual([box!.id]);
    expect(frame?.captions).toEqual([back.captions[0].id]);
    const feeder = back.arrows.find((r) => r.reagentFor !== undefined);
    expect(back.arrows.map((r) => r.id)).toContain(feeder?.reagentFor);
    expect(feeder?.reagentFor).not.toBe(feeder?.id);
  });
});

describe('a frame whose member was deleted in PowerPoint (review F7b-R07)', () => {
  const framed = () => {
    const d = new Doc();
    d.bulk(() => {
      const box = d.addShape({ kind: 'rect', x1: 300, y1: 100, x2: 360, y2: 140, name: 'Member box' });
      const c = d.addCaption({ x: 300, y: 60, runs: [{ text: 'a note' }], justify: 'left' });
      d.addShape({ kind: 'rect', x1: 280, y1: 40, x2: 380, y2: 160, name: 'The frame', frame: { atoms: [], captions: [c.id], arrows: [], shapes: [box.id], padX: 4, padY: 4, fit: false } });
    });
    return d;
  };
  it('keeps the members still there, and names nothing else', async () => {
    const back = await trip(framed(), (p) => onShape(p, 'Member box', () => ''));
    const frame = back.shapes.find((s) => s.frame);
    expect(frame?.frame?.shapes).toEqual([]);
    expect(frame?.frame?.captions).toEqual([back.captions[0].id]);
    const noText = await trip(framed(), (p) => { const k = 'ppt/slides/slide1.xml'; p[k] = p[k].replace(/<p:sp>(?:(?!<\/p:sp>)[\s\S])*?a note[\s\S]*?<\/p:sp>/, ''); });
    const f2 = noText.shapes.find((s) => s.frame);
    expect(noText.captions).toHaveLength(0);
    expect(f2?.frame?.captions).toEqual([]);
    expect(f2?.frame?.shapes).toEqual([noText.shapes.find((s) => s.name === 'Member box')!.id]);
  });
});

describe('a box changed in PowerPoint (review F7b-R02)', () => {
  const box = (more: Partial<Doc['shapes'] extends Map<number, infer S> ? S : never> = {}) => {
    const d = new Doc();
    d.bulk(() => d.addShape({ kind: 'rect', x1: 10, y1: 10, x2: 90, y2: 50, name: 'Box 1', pattern: 'hatch', ...more }));
    return d;
  };
  it('takes PowerPoint\'s Change Shape (rectangle to oval)', async () => {
    const s = (await trip(box(), (p) => onShape(p, 'Box 1', (sp) => sp.replace('prst="rect"', 'prst="ellipse"')))).shapes[0];
    expect(s.kind).toBe('oval');
    expect(s.pattern).toBe('hatch');
  });
  it('takes a corner rounded in PowerPoint', async () => {
    const s = (await trip(box(), (p) => onShape(p, 'Box 1', (sp) => sp.replace(/<a:prstGeom prst="rect">[\s\S]*?<\/a:prstGeom>/, '<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 30000"/></a:avLst></a:prstGeom>')))).shapes[0];
    expect(s.rounded).toBe(true);
    // (30% of the short side, 40 pt: PowerPoint's adj is in hundred-thousandths of it, ECMA-376 Part 1, 20.1.10.56 roundRect)
    expect(s.radius).toBeCloseTo(12, 5);
  });
  it('takes Show from PowerPoint\'s Selection Pane, and a rename there', async () => {
    const s = (await trip(box({ hidden: true }), (p) => onShape(p, 'Box 1', (sp) => sp.replace(/ hidden="(1|true)"/, '').replace('name="Box 1"', 'name="Renamed"')))).shapes[0];
    expect(s.hidden).toBeFalsy();
    expect(s.name).toBe('Renamed');
  });
  it('keeps a name given here that looks like PowerPoint\'s own while PowerPoint shows it', async () => {
    expect((await trip(box({ name: 'Rectangle 7' }))).shapes[0].name).toBe('Rectangle 7');
  });
  it('puts nothing of the wrong kind on it from a damaged tag', async () => {
    const s = (await trip(box(), (p) => {
      const k = Object.keys(p).find((n) => n.startsWith('ppt/tags/') && p[n].includes('CHEMILLUSTRATOR_SHAPE'))!;
      p[k] = p[k].replace(/val="[^"]*"/, `val="${JSON.stringify({ v: 1, s: { kind: 'rect', color: 5, bogus: 'x', frame: { shapes: [1] }, dashed: 'yes', pattern: 'hatch' } }).replace(/"/g, '&quot;')}"`);
    })).shapes[0] as unknown as Record<string, unknown>;
    expect([s.kind, s.pattern]).toEqual(['rect', 'hatch']);
    expect(s.color).not.toBe(5);
    expect([s.bogus, s.frame, s.dashed]).toEqual([undefined, undefined, undefined]);
  });
});

describe('a plain shape\'s own settings (R3)', () => {
  it('come back with its name and hidden', async () => {
    const d = new Doc();
    d.bulk(() => d.addShape({ kind: 'rect', x1: 10, y1: 10, x2: 90, y2: 50, name: 'Box 1', hidden: true }));
    const s = (await trip(d)).shapes[0];
    expect([s.name, s.hidden]).toEqual(['Box 1', true]);
  });
});

describe('a video\'s settings PowerPoint keeps nowhere of its own (R3)', () => {
  it('come back with its length and Rewind after Playing', async () => {
    const d = new Doc();
    d.bulk(() => d.addShape({ kind: 'picture', x1: 0, y1: 0, x2: 160, y2: 90, src: PNG_URL, video: { src: 'data:video/mp4;base64,AAAA', length: 12.5, rewind: true } }));
    const v = (await trip(d)).shapes.find((s) => s.video)?.video;
    expect([v?.length, v?.rewind]).toEqual([12.5, true]);
  });
});

describe('a slide\'s own Footer switch on a master with no footer text (R3)', () => {
  for (const footer of [true, false]) {
    it(`comes back ${footer ? 'on' : 'off'}`, async () => {
      const deck = Deck.design(new Doc(), { w: 720, h: 405 });
      expect(deck.master.footer.trim()).toBe('');
      const back = readPptx(await writePptx({ size: deck.size, master: deck.master, slides: [{ layout: 'blank', doc: new Doc(), notes: '', hf: { footer } }] }, opts));
      expect(back.slides[0].hf?.footer).toBe(footer);
    });
  }
  it('takes a footer put on the slide in PowerPoint since', async () => {
    const deck = Deck.design(new Doc(), { w: 720, h: 405 });
    const bytes = await writePptx({ size: deck.size, master: deck.master, slides: [{ layout: 'blank', doc: new Doc(), notes: '', hf: { footer: false } }] }, opts);
    const ftr = '<p:sp><p:nvSpPr><p:cNvPr id="90" name="Footer Placeholder 89"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="ftr" sz="quarter" idx="11"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>made up footer</a:t></a:r></a:p></p:txBody></p:sp>';
    const back = readPptx(edited(bytes, (p) => { const k = 'ppt/slides/slide1.xml'; p[k] = p[k].replace('</p:spTree>', `${ftr}</p:spTree>`); }));
    expect(back.slides[0].hf?.footer).toBe(true);
  });
});
