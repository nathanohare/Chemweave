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

  it('keeps a vertical box\'s size', async () => {
    const vertical = textBox(`<a:p>${run('Down')}</a:p>`, '<a:bodyPr vert="vert270" wrap="square" rtlCol="0"/>', [5000000, 500000, 800000, 3000000]);
    const { sp } = parasOf(await save(deck(vertical)), 'Down');
    expect(off(sp).slice(2)).toEqual([800000, 3000000]);
    expect(sp).toContain('vert="vert270"');
  });
});
