// @vitest-environment jsdom
//
// Slide Master view (review round 2, finding 15): the master and each layout as pages edited like
// slides. The master's text look flows to every layout that doesn't set its own; a layout's own
// look flows to new slides and to the placeholders of slides with it; things drawn on the master
// or a layout are on every slide with it; closing the view is one undo step.

import { describe, it, expect } from 'vitest';
import { Doc, type Caption } from '../src/model';
import { Deck, defaultMaster, deckLayouts, layoutDef, placeRefs, refsBoxRect, textStyles, phFmt, placeholderRect } from '../src/deck/deck';
import { MASTER_PAGE, PAGE_PROMPTS, refsCaption } from '../src/deck/master-view';
import { blankRef, type Reference } from '../src/document/references';
import { unzipSync, strFromU8 } from 'fflate';
import { writePptx, type PptxOptions } from '../src/io/pptx-write';
import { readPptx } from '../src/io/pptx-read';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 40, 0, 0, 0, 30]);
const opts: PptxOptions = { async picture() { return null; }, async svgToPng() { return PNG; } };
const save = (d: Deck) => writePptx(d.outOfView(() => ({ size: d.size, master: d.master, settings: d.settings, slides: d.slides.map((s, i) => ({ id: s.id, layout: s.layout, doc: d.docOf(i), notes: s.notes, ownItems: s.ownItems, refs: s.refs, refLook: s.refLook })) })), opts);
function reopen(bytes: Uint8Array): Deck {
  const got = readPptx(bytes);
  const d = new Deck(new Doc());
  d.load(got.slides.map((s) => d.makeSlide(s.layout, s.contents, s.notes, s, got.master)), got.size, got.master, got.sections, got.settings);
  return d;
}

function deck(): Deck {
  const d = Deck.blank(new Doc());
  d.attach();
  d.addSlide('title-content');
  d.addSlide('two-content');
  return d;
}

const ph = (doc: Doc, kind: Caption['ph'], k = 0) => [...doc.captions.values()].filter((c) => c.ph === kind).sort((a, b) => a.x - b.x)[k];
/** Set the formatting of every run of a placeholder on the page being edited, as the ribbon does. */
function format(d: Deck, kind: Caption['ph'], patch: Record<string, unknown>, k = 0): void {
  const c = ph(d.host, kind, k);
  d.host.edit('Format', () => d.host.updateCaption(c.id, { runs: c.runs.map((r) => ({ ...r, ...patch })) }));
}
const goTo = (d: Deck, layout: string) => d.go(d.slides.findIndex((s) => s.layout === layout));

describe('Slide Master view', () => {
  it('shows the master, then each layout, with PowerPoint\'s prompts, and opens at the slide\'s layout', () => {
    const d = deck();
    expect(d.current!.layout).toBe('two-content');
    d.openMasterView();
    expect(d.inMasterView).toBe(true);
    expect(d.slides.map((s) => s.layout)).toEqual([MASTER_PAGE, 'title', 'title-content', 'two-content', 'title-only', 'blank']);
    expect(d.current!.layout).toBe('two-content');
    d.go(0);
    expect(ph(d.host, 'title').runs[0].text).toBe(PAGE_PROMPTS.title[0]);
    expect(ph(d.host, 'body').runs[0].text).toBe(PAGE_PROMPTS.body.join('\n'));
    expect(d.layoutUses('title-content')).toBe(1);
    d.closeMasterView();
    expect(d.inMasterView).toBe(false);
    expect(d.slides).toHaveLength(3);
  });

  it('gives every layout the master\'s title font, but not a layout with a font of its own', () => {
    const d = deck();
    d.openMasterView();
    goTo(d, 'title-only');
    format(d, 'title', { font: 'Georgia' });
    d.go(0);
    format(d, 'title', { font: 'Verdana', size: 40 });
    expect(d.master.titleFont).toBe('Verdana');
    // the other layouts' pages follow at once (their text base is the master's)
    const tc = d.slides.findIndex((s) => s.layout === 'title-content');
    expect(d.docOf(tc).textStyles!.title!.font).toBe('Verdana');
    d.closeMasterView();
    expect(d.master.titleFont).toBe('Verdana');
    expect(d.master.titleSize).toBe(40);
    expect(layoutDef(d.master, 'title-only').fmt?.title).toEqual({ font: 'Georgia' });
    expect(textStyles(d.master, 'title-content').title.font).toBe('Verdana');
    expect(textStyles(d.master, 'title-only').title.font).toBe('Georgia');
    // a slide with the layout shows its look
    d.go(1);
    expect(d.host.textStyles!.title!.font).toBe('Verdana');
  });

  it('keeps a layout\'s boxes where they are when the master\'s text size changes', () => {
    const d = deck();
    d.openMasterView();
    const tc = d.slides.findIndex((s) => s.layout === 'title-content');
    const before = placeholderRect(ph(d.docOf(tc), 'title'), d.docOf(tc).textStyles!.title);
    d.go(0);
    format(d, 'title', { size: 54 });
    const after = placeholderRect(ph(d.docOf(tc), 'title'), d.docOf(tc).textStyles!.title);
    expect(after.y1).toBeCloseTo(before.y1, 6);
    d.closeMasterView();
    expect(layoutDef(d.master, 'title-content').boxes[0].y).toBeCloseTo(0.05, 3);
  });

  it('moves the layouts\' boxes that are where the master\'s are with it', () => {
    const d = deck();
    d.openMasterView();
    d.go(0);
    const t = ph(d.host, 'title');
    d.host.edit('Move', () => d.host.updateCaption(t.id, { y: t.y + 27 }));
    d.closeMasterView();
    // Title and Content and Two Content had their titles where the master's is; Title Slide didn't
    expect(layoutDef(d.master, 'title-content').boxes[0].y).toBeCloseTo(0.1, 3);
    expect(layoutDef(d.master, 'two-content').boxes[0].y).toBeCloseTo(0.1, 3);
    expect(layoutDef(d.master, 'title').boxes[0].y).toBeCloseTo(0.387, 3);
  });

  it('gives a layout its own paragraph look, which new slides and its slides\' placeholders take', () => {
    const d = deck();
    d.openMasterView();
    goTo(d, 'title-content');
    const b = ph(d.host, 'body');
    d.host.edit('Spacing', () => d.host.updateCaption(b.id, { lineSpacing: 1.5, paras: b.paras!.map((p) => ({ ...p, list: undefined, spaceAfter: 6 })) }));
    d.closeMasterView();
    expect(layoutDef(d.master, 'title-content').fmt?.body).toEqual({ lineSpacing: 1.5, spaceAfter: 6, bullet: 'none' });
    expect(phFmt(d.master, 'two-content', 'body').lineSpacing).toBe(1);
    // the existing slide with the layout follows
    d.go(1);
    const sb = ph(d.host, 'body');
    expect(sb.lineSpacing).toBe(1.5);
    expect(sb.paras?.[0]).toEqual({ spaceAfter: 6 });
    // and a new one
    d.addSlide('title-content');
    expect(ph(d.host, 'body').paras?.[0]).toEqual({ spaceAfter: 6 });
  });

  it('lets the master\'s paragraph look flow to layouts that don\'t set it', () => {
    const d = deck();
    d.openMasterView();
    d.go(0);
    const b = ph(d.host, 'body');
    d.host.edit('Spacing', () => d.host.updateCaption(b.id, { lineSpacing: 1.2 }));
    const tc = d.slides.findIndex((s) => s.layout === 'two-content');
    expect(ph(d.docOf(tc), 'body').lineSpacing).toBe(1.2);
    expect(ph(d.docOf(tc), 'body', 1).lineSpacing).toBe(1.2);
    d.closeMasterView();
    expect(d.master.phFmt?.body).toEqual({ lineSpacing: 1.2 });
    expect(layoutDef(d.master, 'two-content').fmt).toBeUndefined();
    expect(phFmt(d.master, 'two-content', 'body').lineSpacing).toBe(1.2);
  });

  it('keeps what is drawn on a layout as its items, and closing is one undo step', () => {
    const d = deck();
    const before = JSON.stringify(d.master);
    d.openMasterView();
    goTo(d, 'title-content');
    d.host.edit('Shape', () => d.host.addShape({ kind: 'rect', x1: 10, y1: 500, x2: 100, y2: 530, color: '#c05428', fill: '#c05428', width: 1 } as never));
    d.closeMasterView();
    expect(layoutDef(d.master, 'title-content').items?.shapes).toHaveLength(1);
    // not on the slide itself
    d.go(1);
    expect(d.host.shapes.size).toBe(0);
    d.undo();
    expect(JSON.stringify(d.master)).toBe(before);
  });

  it('adds, duplicates, renames and deletes layouts; slides of a deleted one get Title and Content', () => {
    const d = deck();
    d.openMasterView();
    goTo(d, 'title-only');
    d.insertLayout();
    const id = d.current!.layout;
    expect(d.pageLayout()!.name).toBe('Custom Layout');
    d.setLayoutMeta({ name: 'Scheme' });
    d.duplicateLayout();
    expect(d.pageLayout()!.name).toBe('Scheme copy');
    expect(d.deleteLayout()).toBe(true);
    goTo(d, 'title');
    expect(d.deleteLayout()).toBe(false);
    d.closeMasterView();
    expect(layoutDef(d.master, id).name).toBe('Scheme');
    expect(d.master.layouts!.filter((l) => l.id.startsWith('u'))).toHaveLength(1);
  });

  it('saves the deck\'s own slides while the view is open', () => {
    const d = deck();
    d.openMasterView();
    const n = d.outOfView(() => d.slides.map((s, i) => [s.layout, d.docOf(i).captions.size]));
    expect(n).toEqual([['title', 2], ['title-content', 2], ['two-content', 3]]);
    expect(d.slides[0].layout).toBe(MASTER_PAGE);
  });

  it('undoes changes made in the view on their pages', () => {
    const d = deck();
    d.openMasterView();
    d.go(0);
    format(d, 'title', { font: 'Verdana' });
    expect(d.master.titleFont).toBe('Verdana');
    d.undo();
    expect(d.master.titleFont).toBe(defaultMaster().titleFont);
  });

  it('saves the looks and items to PowerPoint\'s master and layouts, and reads them back', async () => {
    const d = deck();
    d.openMasterView();
    d.go(0);
    format(d, 'title', { font: 'Georgia', italic: true });
    const b = ph(d.host, 'body');
    d.host.edit('Spacing', () => d.host.updateCaption(b.id, { lineSpacing: 1.2 }));
    d.host.edit('Shape', () => d.host.addShape({ kind: 'rect', x1: 0, y1: 520, x2: 960, y2: 540, color: '#c05428', fill: '#c05428', width: 1 } as never));
    goTo(d, 'title-content');
    format(d, 'title', { size: 30, color: '#1d3557' });
    d.closeMasterView();
    const bytes = await save(d);
    const files = unzipSync(bytes);
    const master = strFromU8(files['ppt/slideMasters/slideMaster1.xml']);
    expect(master).toMatch(/<p:titleStyle><a:lvl1pPr[^>]*><a:lnSpc><a:spcPct val="100000"\/><\/a:lnSpc>.*?<a:defRPr sz="3600" b="1" i="1"/);
    expect(master).toMatch(/<p:bodyStyle><a:lvl1pPr[^>]*><a:lnSpc><a:spcPct val="120000"\/>/);
    // the master's bar is a shape in the master, behind its placeholders
    expect(master.indexOf('<a:srgbClr val="C05428"/>')).toBeGreaterThan(0);
    expect(master.indexOf('<a:srgbClr val="C05428"/>')).toBeLessThan(master.indexOf('type="title"'));
    const layouts = Object.keys(files).filter((f) => /slideLayouts\/slideLayout\d+\.xml$/.test(f)).map((f) => strFromU8(files[f]));
    const tc = layouts.find((x) => x.includes('type="obj"'))!;
    expect(tc).toMatch(/<a:lstStyle><a:lvl1pPr algn="l"><a:defRPr sz="3000"><a:solidFill><a:srgbClr val="1D3557"\/>/);
    const back = reopen(bytes);
    expect(back.master.titleFont).toBe('Georgia');
    expect(back.master.phFmt).toEqual({ title: { italic: true }, body: { lineSpacing: 1.2 } });
    expect(layoutDef(back.master, 'title-content').fmt).toEqual({ title: { size: 30, color: '#1d3557' } });
    expect(back.master.items?.shapes).toHaveLength(1);
    // and the slides aren't given the master's bar as their own
    expect(back.slides.every((s) => s.doc.shapes.size === 0)).toBe(true);
  });
});

// Review round 2, finding 18: what is drawn on the master and layouts is locked on slides, with
// Unlock Layout Items on This Slide (right-click) and Lock Layout Items on the Slide Master tab.
describe('Layout items on slides', () => {
  const bar = (color: string, y = 520) => ({ kind: 'rect', x1: 0, y1: y, x2: 960, y2: y + 20, color, fill: color, width: 1 }) as never;
  /** A deck whose master has a bar, and whose Two Content layout has one of its own. */
  function withItems(): Deck {
    const d = deck();
    d.openMasterView();
    d.go(0);
    d.host.edit('Shape', () => d.host.addShape(bar('#c05428')));
    goTo(d, 'two-content');
    d.host.edit('Shape', () => d.host.addShape(bar('#1d3557', 0)));
    d.closeMasterView();
    return d;
  }
  const colors = (doc: Doc) => [...doc.shapes.values()].map((x) => x.color).sort();

  it('unlocks them on one slide as its own copies, in one undo step, and locks them again', () => {
    const d = withItems();
    d.go(2);
    expect(d.host.shapes.size).toBe(0);
    expect(d.setOwnItems([2], true)).toBe(1);
    expect(colors(d.host)).toEqual(['#1d3557', '#c05428']);
    expect(d.page().ownItems).toBe(true);
    // the other slides keep theirs locked
    expect(d.slides[1].ownItems).toBeUndefined();
    d.undo();
    expect(d.host.shapes.size).toBe(0);
    expect(d.page().ownItems).toBeUndefined();
    d.redo();
    expect(d.host.shapes.size).toBe(2);
    // a copy moved on the slide stays as the slide's own when they are locked again
    const moved = [...d.host.shapes.values()].find((x) => x.color === '#c05428')!;
    d.host.edit('Move', () => d.host.updateShape(moved.id, { y1: 300, y2: 320 }));
    d.setOwnItems([2], false);
    expect(colors(d.host)).toEqual(['#c05428']);
    expect(d.slides[2].ownItems).toBeUndefined();
  });

  it('swaps the layout\'s copies when an unlocked slide changes layout', () => {
    const d = withItems();
    d.go(2);
    d.setOwnItems([2], true);
    d.setLayout('title-content', 2);
    expect(colors(d.host)).toEqual(['#c05428']);
    d.setLayout('two-content', 2);
    expect(colors(d.host)).toEqual(['#1d3557', '#c05428']);
  });

  it('unlocks every slide (and new ones) with the Slide Master tab\'s switch, also from the view', () => {
    const d = withItems();
    d.setItemsLocked(false);
    expect(d.master.itemsUnlocked).toBe(true);
    expect(d.slides.every((s) => s.ownItems)).toBe(true);
    d.go(0);
    expect(colors(d.host)).toEqual(['#c05428']);
    d.addSlide('two-content');
    expect(d.current!.ownItems).toBe(true);
    expect(colors(d.host)).toEqual(['#1d3557', '#c05428']);
    // locked again in Slide Master view: applied to the slides when it closes, one step
    d.openMasterView();
    d.setItemsLocked(true);
    d.closeMasterView();
    expect(d.master.itemsUnlocked).toBeUndefined();
    expect(d.slides.every((s) => !s.ownItems)).toBe(true);
    for (let i = 0; i < d.slides.length; i++) { d.go(i); expect(d.host.shapes.size).toBe(0); }
    d.undo();
    expect(d.master.itemsUnlocked).toBe(true);
    expect(d.slides.every((s) => s.ownItems)).toBe(true);
  });

  it('saves an unlocked slide with a copy of its layout without the items, and reads it back', async () => {
    const d = withItems();
    d.setOwnItems([2], true);
    const bytes = await save(d);
    const files = unzipSync(bytes);
    const n = deckLayouts(d.master).length;
    const variant = strFromU8(files[`ppt/slideLayouts/slideLayout${n + 1}.xml`]);
    expect(variant).toContain('name="Two Content (Unlocked Items)"');
    expect(variant).toContain('showMasterSp="0"');
    expect(variant).not.toContain('1D3557');
    expect(strFromU8(files['ppt/slides/_rels/slide3.xml.rels'])).toContain(`slideLayout${n + 1}.xml`);
    expect(strFromU8(files['ppt/slides/_rels/slide2.xml.rels'])).not.toContain(`slideLayout${n + 1}.xml`);
    const back = reopen(bytes);
    expect(deckLayouts(back.master)).toHaveLength(n);
    expect(back.slides[2].layout).toBe('two-content');
    expect(back.slides[2].ownItems).toBe(true);
    expect(back.slides[2].doc.shapes.size).toBe(2);
    expect(back.slides[1].ownItems).toBeUndefined();
    expect(back.master.items?.shapes).toHaveLength(1);
  });
});

// Review round 2, finding 17: a layout's References placeholder, its tick list on slides, and
// citations in the text that tick their references and show the slide's numbers.
describe('References placeholder and citations', () => {
  const ref = (n: number, doi: string): Reference => ({ ...blankRef('article'), id: `r-${n}`, authors: [`Author${n}, A.`], title: `Paper ${n}`, journal: 'Org. Lett.', year: '2019', volume: '21', pages: `${n}00–${n}05`, doi });
  /** A deck whose Title and Content layout has a References placeholder. */
  function withBox(): Deck {
    const d = deck();
    d.openMasterView();
    goTo(d, 'title-content');
    d.host.edit('Refs', () => d.host.addCaption(refsCaption({ x: 0.05, y: 0.8, w: 0.6, h: 0.08 }, d.master, d.size)));
    d.closeMasterView();
    return d;
  }
  const cites = (doc: Doc) => [...doc.captions.values()].flatMap((c) => c.runs.filter((r) => r.cite).map((r) => `${r.cite}:${r.text}${r.sup ? '^' : ''}`));

  it('keeps the box as the layout\'s, not as an item, and shows it again in the view', () => {
    const d = withBox();
    const def = layoutDef(d.master, 'title-content');
    expect(def.refsBox).toEqual({ x: 0.05, y: 0.8, w: 0.6, h: 0.08 });
    expect(def.items).toBeUndefined();
    expect(refsBoxRect(d.master, 'title-content', d.size)).toEqual({ x1: 48, y1: 432, x2: 624, y2: 475.2 });
    d.openMasterView();
    goTo(d, 'title-content');
    expect([...d.host.captions.values()].filter((c) => c.refsBox)).toHaveLength(1);
    d.closeMasterView();
    expect(layoutDef(d.master, 'title-content').refsBox).toEqual(def.refsBox);
  });

  it('lists the slide\'s references in the box', () => {
    const d = withBox();
    d.tickRef(1, ref(1, '10.1/a'));
    const placed = placeRefs(d.page(1), (t, size) => t.length * size * 0.5)!;
    expect(placed.x).toBe(48);
    expect(placed.top).toBe(432);
    expect(placed.w).toBe(576);
  });

  it('ticks a library reference on the slide, adding it to the presentation once, in one undo step', () => {
    const d = withBox();
    const a = ref(1, '10.1/a');
    expect(d.tickRef(1, a)).toBe('r-1');
    expect(d.references.map((r) => r.id)).toEqual(['r-1']);
    expect(d.slides[1].refs).toEqual(['r-1']);
    // the same paper from another file (another id, the same DOI) is the one already listed
    expect(d.tickRef(2, { ...a, id: 'r-other' })).toBe('r-1');
    expect(d.references).toHaveLength(1);
    d.tickRef(1, a, false);
    expect(d.slides[1].refs).toBeUndefined();
    d.undo();
    expect(d.slides[1].refs).toEqual(['r-1']);
  });

  it('numbers citations in the text as the slide\'s lines are numbered, and renumbers them', () => {
    const d = withBox();
    d.go(1);
    d.host.edit('Text', () => d.host.addCaption({ x: 50, y: 200, justify: 'left', runs: [{ text: 'Aryl bromides' }, { text: '*', cite: 'r-2' }, { text: ' and chlorides' }, { text: '*', cite: 'r-1' }] }));
    // citing turns on numbers for the slide's lines, in the style's look (ACS: raised)
    d.tickRef(1, ref(2, '10.1/b'), true, true);
    d.tickRef(1, ref(1, '10.1/a'), true, true);
    expect(d.slides[1].refLook?.numbering).toBe('slide');
    expect(cites(d.host)).toEqual(['r-2:1^', 'r-1:2^']);
    expect(d.citedOn(1)).toEqual(new Set(['r-1', 'r-2']));
    // the order of the slide's references changes: the numbers follow
    d.setSlideRefs([1], ['r-1', 'r-2']);
    expect(cites(d.host)).toEqual(['r-2:2^', 'r-1:1^']);
    // a reference taken off the slide: its citation shows [?]
    d.tickRef(1, ref(2, '10.1/b'), false);
    expect(cites(d.host)).toEqual(['r-2:[?]^', 'r-1:1^']);
    d.undo();
    expect(cites(d.host)).toEqual(['r-2:2^', 'r-1:1^']);
  });

  it('saves the box and the citations to PowerPoint and reads them back', async () => {
    const d = withBox();
    d.go(1);
    d.host.edit('Text', () => d.host.addCaption({ x: 50, y: 200, justify: 'left', runs: [{ text: 'Yields' }, { text: '*', cite: 'r-1' }] }));
    d.tickRef(1, ref(1, '10.1/a'), true, true);
    const back = reopen(await save(d));
    expect(layoutDef(back.master, 'title-content').refsBox).toEqual({ x: 0.05, y: 0.8, w: 0.6, h: 0.08 });
    expect(back.slides[1].refs).toEqual(['r-1']);
    expect(cites(back.docOf(1))).toEqual(['r-1:1^']);
  });
});
