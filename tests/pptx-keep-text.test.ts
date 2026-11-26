// @vitest-environment jsdom
//
// PowerPoint text keeps on saving what this program doesn't model, while the looks it goes with
// are unchanged here (audit G2-03, G2-05, G2-06, G2-07, G2-08, G2-21, G2-22). The deck is built
// here with PowerPoint's element names (ECMA-376 part 1, 21.1.2 DrawingML text); it isn't a file
// saved by PowerPoint.

import { describe, it, expect } from 'vitest';
import { Doc, type Caption } from '../src/model';
import { writePptx, type PptxOptions } from '../src/io/pptx-write';
import { readPptx } from '../src/io/pptx-read';
import { Package, NS, REL } from '../src/io/ooxml';
import { unzipSync, strFromU8 } from 'fflate';

const opts: PptxOptions = { async picture() { return null; }, async svgToPng() { return new Uint8Array(); } };
const X = `xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}"`;
const H = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const E = 12700;
const GRP = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>';

/** A one-slide deck with these shapes on its slide, a hyperlink relationship rId9 from it. */
function deck(shapes: string): Uint8Array {
  const pkg = new Package();
  const ct = (t: string) => `application/vnd.openxmlformats-officedocument.${t}+xml`;
  pkg.relate('', REL.officeDocument, 'ppt/presentation.xml');
  const P = 'ppt/presentation.xml';
  const mRel = pkg.relate(P, REL.slideMaster, 'slideMasters/slideMaster1.xml');
  const sRel = pkg.relate(P, REL.slide, 'slides/slide1.xml');
  pkg.add(P, `${H}<p:presentation ${X}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="${mRel}"/></p:sldMasterIdLst><p:sldIdLst><p:sldId id="256" r:id="${sRel}"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`, ct('presentationml.presentation.main'));
  pkg.relate('ppt/slideMasters/slideMaster1.xml', REL.theme, '../theme/theme1.xml');
  pkg.add('ppt/theme/theme1.xml', `${H}<a:theme xmlns:a="${NS.a}" name="Office Theme"><a:themeElements><a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:hlink><a:srgbClr val="0563C1"/></a:hlink></a:clrScheme>` +
    `<a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light"/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`, ct('theme'));
  const lRel = pkg.relate('ppt/slideMasters/slideMaster1.xml', REL.slideLayout, '../slideLayouts/slideLayout1.xml');
  pkg.add('ppt/slideMasters/slideMaster1.xml', `${H}<p:sldMaster ${X}><p:cSld><p:spTree>${GRP}</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="${lRel}"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`, ct('presentationml.slideMaster'));
  pkg.relate('ppt/slideLayouts/slideLayout1.xml', REL.slideMaster, '../slideMasters/slideMaster1.xml');
  pkg.add('ppt/slideLayouts/slideLayout1.xml', `${H}<p:sldLayout ${X} type="blank"><p:cSld name="Blank"><p:spTree>${GRP}</p:spTree></p:cSld></p:sldLayout>`, ct('presentationml.slideLayout'));
  const S = 'ppt/slides/slide1.xml';
  pkg.relate(S, REL.slideLayout, '../slideLayouts/slideLayout1.xml');
  pkg.relate(S, REL.hyperlink, 'https://pubchem.ncbi.nlm.nih.gov/', true, 'rId9');
  pkg.add(S, `${H}<p:sld ${X}><p:cSld><p:spTree>${GRP}${shapes}</p:spTree></p:cSld></p:sld>`, ct('presentationml.slide'));
  return pkg.build();
}

let nextId = 10;
/** A text box at (x, y) EMU, w × h, with this bodyPr and paragraphs. */
const textBox = (paras: string, bodyPr = '<a:bodyPr wrap="square" rtlCol="0"><a:spAutoFit/></a:bodyPr>', at = [914400, 914400, 4000000, 1500000]) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${nextId++}" name="TextBox"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${at[0]}" y="${at[1]}"/><a:ext cx="${at[2]}" cy="${at[3]}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>` +
  `<p:txBody>${bodyPr}<a:lstStyle/>${paras}</p:txBody></p:sp>`;
const run = (t: string, rPr = '<a:rPr lang="en-US" sz="1800" dirty="0"/>') => `<a:r>${rPr}<a:t>${t}</a:t></a:r>`;

async function save(bytes: Uint8Array, edit?: (c: Caption[]) => void): Promise<string> {
  const back = readPptx(bytes);
  const doc = new Doc();
  doc.restoreContents(back.slides[0].contents);
  if (edit) edit([...doc.captions.values()]);
  const out = await writePptx({ size: back.size, master: back.master, slides: [{ layout: 'blank', doc, notes: '' }] }, opts);
  return strFromU8(unzipSync(out)['ppt/slides/slide1.xml']);
}
const parasOf = (xml: string, text: string) => {
  const sp = [...xml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)].map((m) => m[0]).find((x) => x.includes(text))!;
  return { sp, ps: [...sp.matchAll(/<a:p>[\s\S]*?<\/a:p>/g)].map((m) => m[0]) };
};

describe('PowerPoint paragraphs (G2-03, G2-06)', () => {
  it('keeps line spacing per paragraph, not per box', async () => {
    const paras = `<a:p><a:pPr><a:lnSpc><a:spcPct val="150000"/></a:lnSpc></a:pPr>${run('One')}</a:p><a:p>${run('Two')}</a:p><a:p>${run('Three')}</a:p>`;
    const { ps } = parasOf(await save(deck(textBox(paras))), 'One');
    expect(ps[0]).toContain('<a:spcPct val="150000"/>');
    expect(ps[1]).not.toContain('150000');
    expect(ps[2]).not.toContain('150000');
  });

  it('keeps tab stops, the bullet\'s colour and size, right to left, font alignment, distributed text, a level and margins', async () => {
    const paras =
      `<a:p><a:pPr marL="342900" indent="-342900" rtl="0" fontAlgn="base" defTabSz="457200"><a:buClr><a:srgbClr val="FF0000"/></a:buClr><a:buSzPct val="150000"/><a:buFont typeface="Arial"/><a:buChar char="•"/><a:tabLst><a:tab pos="1828800" algn="dec"/></a:tabLst></a:pPr>${run('Bulleted')}</a:p>` +
      `<a:p><a:pPr algn="dist" lvl="2"/>${run('Spread')}</a:p>`;
    const { ps } = parasOf(await save(deck(textBox(paras))), 'Bulleted');
    expect(ps[0]).toContain('marL="342900"');
    expect(ps[0]).toContain('indent="-342900"');
    expect(ps[0]).toContain('fontAlgn="base"');
    expect(ps[0]).toContain('defTabSz="457200"');
    expect(ps[0]).toContain('<a:buClr><a:srgbClr val="FF0000"/></a:buClr><a:buSzPct val="150000"/>');
    expect(ps[0]).toContain('<a:tabLst><a:tab pos="1828800" algn="dec"/></a:tabLst>');
    // (ECMA-376 21.1.2.2.7: the bullet's colour and size before its font, tab stops after the bullet)
    expect(ps[0].indexOf('<a:buClr>')).toBeLessThan(ps[0].indexOf('<a:buFont'));
    expect(ps[0].indexOf('<a:buChar')).toBeLessThan(ps[0].indexOf('<a:tabLst>'));
    expect(ps[1]).toContain('algn="dist"');
    expect(ps[1]).toContain('lvl="2"');
  });

  it('writes the margins afresh once the list is changed here', async () => {
    const paras = `<a:p><a:pPr marL="342900" indent="-342900"><a:buFont typeface="Arial"/><a:buChar char="•"/></a:pPr>${run('Bulleted')}</a:p>`;
    const xml = await save(deck(textBox(paras)), (cs) => { const c = cs.find((x) => x.runs.some((r) => r.text === 'Bulleted'))!; c.paras = [{ list: 'number' }]; });
    expect(parasOf(xml, 'Bulleted').ps[0]).not.toContain('marL="342900"');
  });
});

describe('PowerPoint runs (G2-07, G2-08, G2-21, G2-22)', () => {
  const rich = `<a:p>` +
    run('dbl', '<a:rPr lang="en-US" sz="1800" u="dbl" strike="dblStrike" dirty="0"/>') +
    run('grad', '<a:rPr lang="en-US" sz="1800" dirty="0"><a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="FF0000"/></a:gs><a:gs pos="100000"><a:srgbClr val="0000FF"/></a:gs></a:gsLst><a:lin ang="0" scaled="1"/></a:gradFill><a:effectLst><a:glow rad="63500"><a:srgbClr val="FFFF00"/></a:glow></a:effectLst></a:rPr>') +
    run('theme', '<a:rPr lang="en-US" sz="1800" altLang="ja-JP" noProof="1" kern="1200" dirty="0"><a:latin typeface="+mj-lt"/><a:ea typeface="MS Mincho"/><a:sym typeface="Symbol"/></a:rPr>') +
    run('raised', '<a:rPr lang="en-US" sz="1800" baseline="14000" dirty="0"/>') +
    run('link', '<a:rPr lang="en-US" sz="1800" dirty="0"><a:hlinkClick r:id="rId9"/></a:rPr>') +
    `</a:p>`;
  const rPrOf = (xml: string, t: string) => new RegExp(`<a:rPr(?:(?!<a:rPr)[\\s\\S])*?<a:t>${t}</a:t>`).exec(xml)?.[0] ?? '';

  it('keeps underline and strikethrough kinds, gradient fills, glow, theme and East Asian fonts, kerning, custom baselines', async () => {
    const xml = await save(deck(textBox(rich)));
    const dbl = rPrOf(xml, 'dbl');
    expect(dbl).toContain('u="dbl"');
    expect(dbl).toContain('strike="dblStrike"');
    const grad = rPrOf(xml, 'grad');
    expect(grad).toContain('<a:gradFill>');
    expect(grad).not.toContain('<a:solidFill>');
    expect(grad).toContain('<a:glow rad="63500">');
    const theme = rPrOf(xml, 'theme');
    expect(theme).toContain('<a:latin typeface="+mj-lt"/>');
    expect(theme).toContain('<a:ea typeface="MS Mincho"/>');
    expect(theme).toContain('<a:sym typeface="Symbol"/>');
    expect(theme).not.toContain('<a:cs ');
    expect(theme).toContain('altLang="ja-JP"');
    expect(theme).toContain('noProof="1"');
    expect(theme).toContain('kern="1200"');
    expect(rPrOf(xml, 'raised')).toContain('baseline="14000"');
    // (read by Word's names, so the kinds go to documents too)
    const back = readPptx(deck(textBox(rich))).slides[0].contents.captions![0].runs.find((r) => r.text === 'dbl')!;
    expect(back).toMatchObject({ underline: true, ukind: 'double', strike: true, dstrike: true });
  });

  it('writes an underline kind and double strikethrough from a document as PowerPoint names them', async () => {
    const xml = await save(deck(textBox(`<a:p>${run('plain', '<a:rPr lang="en-US" sz="1800" dirty="0"/>')}</a:p>`)), (cs) => {
      cs[0].runs = cs[0].runs.map((r) => ({ ...r, underline: true, ukind: 'wave', strike: true, dstrike: true }));
    });
    expect(rPrOf(xml, 'plain')).toContain('u="wavy"');
    expect(rPrOf(xml, 'plain')).toContain('strike="dblStrike"');
  });

  it('leaves a link with no colour of its own to follow the theme\'s link colour', async () => {
    const link = rPrOf(await save(deck(textBox(rich))), 'link');
    expect(link).toContain('<a:hlinkClick');
    expect(link).not.toContain('<a:solidFill>');
    expect(link).not.toContain('u="sng"');
    expect(link).not.toContain('hlinkClr');
  });

  it('writes a run afresh where its look was changed here', async () => {
    const xml = await save(deck(textBox(rich)), (cs) => {
      const c = cs[0];
      c.runs = c.runs.map((r) => (r.text.includes('dbl') ? { ...r, underline: false, strike: false } : r.text.includes('grad') ? { ...r, color: '#00aa00' } : r));
    });
    expect(rPrOf(xml, 'dbl')).not.toContain('u=');
    const grad = rPrOf(xml, 'grad');
    expect(grad).not.toContain('<a:gradFill>');
    expect(grad).toContain('00AA00');
  });
});

describe('PowerPoint text box frames (G2-05)', () => {
  const anchored = textBox(`<a:p>${run('Centred')}</a:p>`, '<a:bodyPr wrap="square" lIns="91440" tIns="45720" rIns="91440" bIns="45720" anchor="ctr" rtlCol="0"/>', [914400, 500000, 4000000, 1500000]);
  const off = (sp: string) => /<a:off x="(\d+)" y="(\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"\/>/.exec(sp)!.slice(1).map(Number);

  it('keeps a fixed box\'s size, place, anchor and margins', async () => {
    const { sp } = parasOf(await save(deck(anchored)), 'Centred');
    expect(off(sp)).toEqual([914400, 500000, 4000000, 1500000]);
    expect(sp).toContain('anchor="ctr"');
    expect(sp).toContain('lIns="91440"');
    expect(sp).not.toContain('<a:spAutoFit/>');
  });

  it('moves the kept frame with its text', async () => {
    const xml = await save(deck(anchored), (cs) => { cs[0].x += 10; cs[0].y += 20; });
    expect(off(parasOf(xml, 'Centred').sp)).toEqual([914400 + 10 * E, 500000 + 20 * E, 4000000, 1500000]);
  });

  it('keeps the anchor and margins of a box resized here, its extent changed by as much', async () => {
    const xml = await save(deck(anchored), (cs) => { cs[0].wrap = cs[0].wrap! + 50; if (cs[0].boxH !== undefined) cs[0].boxH += 30; });
    const { sp } = parasOf(xml, 'Centred');
    const [x, y, w, h] = off(sp);
    expect([x, y]).toEqual([914400, 500000]);
    expect(w).toBe(4000000 + 50 * E);
    expect(h).toBe(1500000 + 30 * E);
    expect(sp).toContain('anchor="ctr"');
    expect(sp).toContain('lIns="91440"');
  });

  it('fits a box that grows with its text to its text once the text is changed here, and leaves it as it was while not (review F2-R02)', async () => {
    const auto = (t: string, wrap = 'square', w = 4000000) => textBox(`<a:p>${run(t)}</a:p>`, `<a:bodyPr wrap="${wrap}" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0"><a:spAutoFit/></a:bodyPr>`, [914400, 500000, w, 369332]);
    // untouched: the frame exactly as read
    expect(off(parasOf(await save(deck(auto('Grows'))), 'Grows').sp)).toEqual([914400, 500000, 4000000, 369332]);
    // eight lines: taller, from the top of the text
    const longer = await save(deck(auto('Grows')), (cs) => { cs[0].runs = [{ ...cs[0].runs[0], text: 'Grows\n2\n3\n4\n5\n6\n7\n8' }]; });
    const [x, y, w, h] = off(parasOf(longer, 'Grows').sp);
    expect([x, w]).toEqual([914400, 4000000]);
    expect(h).toBeGreaterThan(369332 * 6);
    expect(Math.abs(y - 500000)).toBeLessThan(2 * E);
    // made bigger: taller too
    const bigger = await save(deck(auto('Grows')), (cs) => { cs[0].runs = cs[0].runs.map((r) => ({ ...r, size: 60 })); });
    expect(off(parasOf(bigger, 'Grows').sp)[3]).toBeGreaterThan(369332 * 2.5);
    // a box that doesn't wrap: as wide as its longer line
    const wide = await save(deck(auto('Short', 'none', 900000)), (cs) => { cs[0].runs = [{ ...cs[0].runs[0], text: 'A much longer line of text than before' }]; });
    expect(off(parasOf(wide, 'longer').sp)[2]).toBeGreaterThan(900000 * 3);
    // (its anchor, margins and AutoFit as read)
    expect(parasOf(wide, 'longer').sp).toContain('lIns="91440"');
    expect(parasOf(wide, 'longer').sp).toContain('<a:spAutoFit/>');
  });

  it('keeps a vertical box\'s size', async () => {
    const vertical = textBox(`<a:p>${run('Down')}</a:p>`, '<a:bodyPr vert="vert270" wrap="square" rtlCol="0"/>', [5000000, 500000, 800000, 3000000]);
    const { sp } = parasOf(await save(deck(vertical)), 'Down');
    expect(off(sp).slice(2)).toEqual([800000, 3000000]);
    expect(sp).toContain('vert="vert270"');
  });

  it('puts a vertical or turned box back where it was when saved again (office sampler F-P-004)', async () => {
    for (const [vert, rot] of [['vert', 0], ['vert270', 0], ['', 1800000], ['vert', 5400000]] as const) {
      const at = [304800, 292100, 2819400, 1003300];
      const box = textBox(`<a:p>${run('Sideways')}</a:p>`, `<a:bodyPr${vert ? ` vert="${vert}"` : ''} wrap="square" rtlCol="0"><a:spAutoFit/></a:bodyPr>`, at)
        .replace('<a:xfrm>', rot ? `<a:xfrm rot="${rot}">` : '<a:xfrm>');
      // saved, read and saved again: the frame as it was, and the text where it was read
      const once = readPptx(await saveBytes(deck(box)));
      const twice = readPptx(await saveBytes(deck(box), 2));
      const cap = (r: ReturnType<typeof readPptx>) => r.slides[0].contents.captions!.find((c) => c.runs.some((x) => x.text === 'Sideways'))!;
      const first = readPptx(deck(box));
      for (const r of [once, twice]) {
        expect(cap(r).x).toBeCloseTo(cap(first).x, 1);
        expect(cap(r).y).toBeCloseTo(cap(first).y, 1);
      }
      const xml = strFromU8(unzipSync(await saveBytes(deck(box), 2))['ppt/slides/slide1.xml']);
      expect(off(parasOf(xml, 'Sideways').sp)).toEqual(at);
    }
  });
});

describe('slide number fields (office sampler F-P-004)', () => {
  const fld = '<a:fld id="{11111111-2222-3333-4444-555555555555}" type="slidenum"><a:rPr lang="en-US" sz="1800" dirty="0"/><a:t>1</a:t></a:fld>';
  const ids = (bytes: Uint8Array) => [...strFromU8(unzipSync(bytes)['ppt/slides/slide1.xml']).matchAll(/<a:fld id="([^"]+)"/g)].map((m) => m[1]);

  it('numbers them the same in every save, saves made at the same time too', async () => {
    const file = deck(textBox(`<a:p>${run('Page ')}${fld}</a:p><a:p>${fld}</a:p><a:p>${fld}</a:p>`));
    const one = ids(await saveBytes(file));
    expect(one).toHaveLength(3);
    expect(new Set(one).size).toBe(3);
    expect(ids(await saveBytes(file, 2))).toEqual(one);
    const [x, y] = await Promise.all([saveBytes(file), saveBytes(file)]);
    expect(ids(x)).toEqual(one);
    expect(ids(y)).toEqual(one);
  });
});

/** The deck saved this many times, each time from the last save as read. */
async function saveBytes(bytes: Uint8Array, times = 1): Promise<Uint8Array> {
  for (let i = 0; i < times; i++) {
    const back = readPptx(bytes);
    const doc = new Doc();
    doc.restoreContents(back.slides[0].contents);
    bytes = await writePptx({ size: back.size, master: back.master, slides: [{ layout: 'blank', doc, notes: '' }] }, opts);
  }
  return bytes;
}

describe('PowerPoint boxes that grow with their text, turned, vertical or not wrapping (review F2b-R02, F2b-R03)', () => {
  /** A "resize to fit text" box: turned `rot` (60000ths of a degree), its text direction, wrap and alignment. */
  const fitBox = (t: string, at: number[], { rot = 0, vert = '', wrap = 'square', algn = 'l' } = {}) =>
    `<p:sp><p:nvSpPr><p:cNvPr id="${nextId++}" name="TextBox"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm${rot ? ` rot="${rot}"` : ''}><a:off x="${at[0]}" y="${at[1]}"/><a:ext cx="${at[2]}" cy="${at[3]}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>` +
    `<p:txBody><a:bodyPr${vert ? ` vert="${vert}"` : ''} wrap="${wrap}" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0"><a:spAutoFit/></a:bodyPr><a:lstStyle/><a:p><a:pPr algn="${algn}"/>${run(t)}</a:p></p:txBody></p:sp>`;
  const frame = (xml: string) => /<a:off x="(-?\d+)" y="(-?\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"\/>/.exec(parasOf(xml, 'txBox').sp)!.slice(1).map(Number);
  const retype = (text: string) => (cs: Caption[]) => { cs[0].runs = [{ ...cs[0].runs[0], text }]; };
  const AT = [3000000, 500000, 2000000, 369332];

  it('places a turned box so that its text starts where it did, and never moves one left as read', async () => {
    // a y-axis label turned 270°: retyped "AAA" as "AAB", the frame keeps its place (it moved about
    // 5 cm down before); the corner where the text starts is at (3815334, 1684666) EMU both times
    const label = deck(fitBox('AAA', AT, { rot: 16200000 }));
    expect(frame(await save(label))).toEqual([3000000, 500000, 2000000, 369332]);
    expect(frame(await save(label, retype('AAB')))).toEqual([3004501, 495500, 2000000, 378333]);
    // three lines: taller in its own frame, growing away from where the text starts
    expect(frame(await save(label, retype('AAA\nB\nC')))).toEqual([3278821, 221180, 2000000, 926973]);
    // turned 90° (it went off the slide, y −1476497, before)
    const down = deck(fitBox('AAA', AT, { rot: 5400000 }));
    expect(frame(await save(down))).toEqual([3000000, 500000, 2000000, 369332]);
    expect(frame(await save(down, retype('AAA\nB\nC')))).toEqual([2721180, 221180, 2000000, 926973]);
    // turned 10°: the corner where the text starts stays at (3047259, 329157)
    const tilted = deck(fitBox('AAA', AT, { rot: 600000 }));
    expect(frame(await save(tilted))).toEqual([3000000, 500000, 2000000, 369332]);
    expect(frame(await save(tilted, retype('AAA\nB\nC')))).toEqual([2951583, 495764, 2000000, 926973]);
  });

  it('grows a box of text running up across its lines, from the side the text starts on', async () => {
    // vert270: lines stack left to right, so the frame gets wider from its left edge and keeps its
    // height (the length its text runs along); before, it moved 4.6 cm down and took the stack as its height
    const up = deck(fitBox('AAA', [3000000, 500000, 369332, 2000000], { vert: 'vert270' }));
    expect(frame(await save(up))).toEqual([3000000, 500000, 369332, 2000000]);
    const xml = await save(up, retype('AAA\nB\nC'));
    expect(frame(xml)).toEqual([3000000, 500000, 926973, 2000000]);
    expect(parasOf(xml, 'txBox').sp).toContain('vert="vert270"');
  });

  it('fits a box that does not wrap to its longer line, growing from its alignment side', async () => {
    const at = [3000000, 500000, 700000, 369332];
    const longer = retype('A much longer line');
    // left: from its left edge; centred: both sides, its middle staying at x 3350000; right: leftward,
    // its right edge staying at x 3700000. One line each (before, centred and right-aligned boxes
    // kept their width and stacked the line, 700000 × 3121533)
    expect(frame(await save(deck(fitBox('AAA', at, { wrap: 'none' })), longer))).toEqual([3000000, 500000, 2075917, 378333]);
    expect(frame(await save(deck(fitBox('AAA', at, { wrap: 'none', algn: 'ctr' })), longer))).toEqual([2312042, 500000, 2075917, 378333]);
    expect(frame(await save(deck(fitBox('AAA', at, { wrap: 'none', algn: 'r' })), longer))).toEqual([1624083, 500000, 2075917, 378333]);
    // and as read while untouched
    expect(frame(await save(deck(fitBox('AAA', at, { wrap: 'none', algn: 'ctr' }))))).toEqual(at);
  });
});

// (coordinators #68)
describe('a text box in a group whose child coordinates differ from its place', () => {
  const frameOf = (xml: string, text: string) => {
    const sp = [...xml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)].map((m) => m[0]).find((x) => x.includes(text))!;
    return /<a:off x="(-?\d+)" y="(-?\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"\/>/.exec(sp)!.slice(1).map(Number);
  };
  /** The groups round the box in the saved slide, as offsets: each group's off minus its chOff (scale 1). */
  const groupShift = (xml: string) => [...xml.matchAll(/<p:grpSpPr><a:xfrm[^>]*><a:off x="(-?\d+)" y="(-?\d+)"\/><a:ext[^>]*\/><a:chOff x="(-?\d+)" y="(-?\d+)"\/>/g)]
    .reduce((s, m) => [s[0] + Number(m[1]) - Number(m[3]), s[1] + Number(m[2]) - Number(m[4])], [0, 0]);
  const group = (inner: string, ext: number[], chExt: number[]) => `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="${nextId++}" name="Group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>`
    + `<p:grpSpPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="${ext[0]}" cy="${ext[1]}"/><a:chOff x="3048000" y="2921000"/><a:chExt cx="${chExt[0]}" cy="${chExt[1]}"/></a:xfrm></p:grpSpPr>`
    + inner + textBox(`<a:p>${run('Partner')}</a:p>`, undefined, [3048000, 4000000, 1000000, 400000]) + '</p:grpSp>';

  it('is saved where it is on the slide, not at its place in the group', async () => {
    const box = textBox(`<a:p>${run('Grouped')}</a:p>`, '<a:bodyPr wrap="square" rtlCol="0"/>', [3048000, 2921000, 2000000, 500000]);
    const xml = await save(deck(group(box, [3000000, 2000000], [3000000, 2000000])));
    const [x, y, cx, cy] = frameOf(xml, 'Grouped');
    const [gx, gy] = groupShift(xml);
    expect([x + gx, y + gy, cx, cy]).toEqual([1000000, 1000000, 2000000, 500000]);
    // (and the same on a second save; the groups written here move nothing)
    const twice = strFromU8(unzipSync(await saveBytes(deck(group(box, [3000000, 2000000], [3000000, 2000000])), 2))['ppt/slides/slide1.xml']);
    expect(frameOf(twice, 'Grouped')).toEqual([x, y, cx, cy]);
    expect(groupShift(twice)).toEqual([0, 0]);
  });

  it('takes the group\'s scale too', async () => {
    const box = textBox(`<a:p>${run('Halved')}</a:p>`, '<a:bodyPr wrap="square" rtlCol="0"/>', [3048000, 2921000, 2000000, 500000]);
    const xml = await save(deck(group(box, [3000000, 2000000], [6000000, 4000000])));
    const [x, y, cx, cy] = frameOf(xml, 'Halved');
    const [gx, gy] = groupShift(xml);
    expect([x + gx, y + gy, cx, cy]).toEqual([1000000, 1000000, 1000000, 250000]);
  });
});
