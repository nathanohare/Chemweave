// @vitest-environment jsdom
//
// Saving a Word file keeps what Word had that isn't edited here (audit G2-12 to G2-15, G2-07,
// G2-09 to G2-11). The files are built here as Word writes them (ECMA-376 part 1 element names);
// none is a file saved by Word.

import { describe, it, expect } from 'vitest';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { readDocx, writeDocx, type DocxDeps } from '../src/io/docx';
import { listInfo } from '../src/text/paragraphs';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W = `xmlns:w="${W_NS}"`;
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const deps: DocxDeps = { async picture() { return null; } };
const u8 = (s: string) => new Uint8Array(strToU8(s));

export interface WordParts { body: string; styles?: string; numbering?: string; settings?: string; header?: string; /** A theme with these major and minor fonts. */ fonts?: [string, string] }

/** A Word file with the parts given (styles, numbering, settings and a header as their root's contents). */
export function wordFile(p: WordParts): Uint8Array {
  const rels: string[] = [];
  const files: Record<string, Uint8Array> = {};
  const part = (name: string, type: string, xml: string) => { rels.push(`<Relationship Id="rId${rels.length + 1}" Type="${R}${type}" Target="${name}"/>`); files[`word/${name}`] = u8(xml); };
  if (p.styles !== undefined) part('styles.xml', 'styles', `<?xml version="1.0"?><w:styles ${W}>${p.styles}</w:styles>`);
  if (p.numbering !== undefined) part('numbering.xml', 'numbering', `<?xml version="1.0"?><w:numbering ${W}>${p.numbering}</w:numbering>`);
  if (p.settings !== undefined) part('settings.xml', 'settings', `<?xml version="1.0"?><w:settings ${W} xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">${p.settings}</w:settings>`);
  if (p.fonts) part('theme/theme1.xml', 'theme', `<?xml version="1.0"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office"><a:themeElements><a:fontScheme name="Office"><a:majorFont><a:latin typeface="${p.fonts[0]}"/></a:majorFont><a:minorFont><a:latin typeface="${p.fonts[1]}"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`);
  let sect = '<w:sectPr/>';
  if (p.header !== undefined) {
    part('header1.xml', 'header', `<?xml version="1.0"?><w:hdr ${W}>${p.header}</w:hdr>`);
    sect = `<w:sectPr><w:headerReference w:type="default" r:id="rId${rels.length}" xmlns:r="${R.slice(0, -1)}"/></w:sectPr>`;
  }
  return zipSync({
    '[Content_Types].xml': u8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/></Types>'),
    '_rels/.rels': u8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}officeDocument" Target="word/document.xml"/></Relationships>`),
    'word/_rels/document.xml.rels': u8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`),
    'word/document.xml': u8(`<?xml version="1.0"?><w:document ${W} xmlns:r="${R.slice(0, -1)}"><w:body>${p.body}${sect}</w:body></w:document>`),
    ...files,
  });
}

export async function roundTrip(p: WordParts): Promise<Record<string, string>> {
  const { doc } = await readDocx(wordFile(p));
  const out = unzipSync(await writeDocx(doc, deps));
  return Object.fromEntries(Object.entries(out).filter(([n]) => n.endsWith('.xml')).map(([n, b]) => [n, strFromU8(b)]));
}

const parse = (t: string) => new DOMParser().parseFromString(t, 'application/xml');
const styleEls = (xml: string) => Array.from(parse(xml).getElementsByTagNameNS(W_NS, 'style'));
const nameOf = (s: Element) => s.getElementsByTagNameNS(W_NS, 'name')[0]?.getAttributeNS(W_NS, 'val') ?? '';

describe('Word styles are kept (G2-12)', () => {
  const styles = '<w:docDefaults/>' +
    '<w:latentStyles w:defLockedState="0" w:defUIPriority="99" w:count="376"><w:lsdException w:name="Normal" w:uiPriority="0" w:qFormat="1"/><w:lsdException w:name="Book Title" w:uiPriority="33"/></w:latentStyles>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
    '<w:style w:type="paragraph" w:customStyle="1" w:styleId="TAAuthor"><w:name w:val="TA_Author"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:tabs><w:tab w:val="left" w:pos="1440"/></w:tabs><w:numPr><w:numId w:val="7"/></w:numPr></w:pPr><w:rPr><w:i/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Header"><w:name w:val="header"/><w:basedOn w:val="Normal"/><w:link w:val="HeaderChar"/><w:pPr><w:tabs><w:tab w:val="center" w:pos="4680"/><w:tab w:val="right" w:pos="9360"/></w:tabs></w:pPr></w:style>' +
    '<w:style w:type="character" w:customStyle="1" w:styleId="HeaderChar"><w:name w:val="Header Char"/><w:basedOn w:val="DefaultParagraphFont"/><w:link w:val="Header"/></w:style>' +
    '<w:style w:type="paragraph" w:styleId="NoSpacing"><w:name w:val="No Spacing"/><w:qFormat/><w:pPr><w:spacing w:after="0"/></w:pPr></w:style>' +
    '<w:style w:type="character" w:styleId="BookTitle"><w:name w:val="Book Title"/><w:rPr><w:b/></w:rPr></w:style>' +
    '<w:style w:type="table" w:styleId="LightList"><w:name w:val="Light List"/><w:tblPr/></w:style>';

  it('keeps unused styles and latent styles as Word had them', async () => {
    const out = await roundTrip({ styles, body: '<w:p><w:r><w:t>Text</w:t></w:r></w:p>' });
    const xml = out['word/styles.xml'];
    const els = styleEls(xml);
    const names = els.map(nameOf);
    for (const n of ['TA_Author', 'header', 'Header Char', 'No Spacing', 'Book Title', 'Light List']) expect(names).toContain(n);
    // no duplicates, and one default paragraph style
    expect(new Set(els.map((e) => `${e.getAttributeNS(W_NS, 'type')}:${e.getAttributeNS(W_NS, 'styleId')}`)).size).toBe(els.length);
    expect(els.filter((e) => e.getAttributeNS(W_NS, 'type') === 'paragraph' && e.getAttributeNS(W_NS, 'default') === '1').length).toBe(1);
    // the pair link, tab stops and the rest as they were
    expect(xml).toContain('<w:link w:val="HeaderChar"/>');
    expect(xml).toContain('<w:tab w:val="left" w:pos="1440"/>');
    // a list the saved file doesn't have is not named
    expect(xml).not.toContain('<w:numId w:val="7"/>');
    // latent styles after the defaults, before the styles (17.7.4.18)
    expect(xml.indexOf('<w:latentStyles')).toBeGreaterThan(xml.indexOf('</w:docDefaults>'));
    expect(xml.indexOf('<w:latentStyles')).toBeLessThan(xml.indexOf('<w:style '));
    expect(parse(xml).getElementsByTagName('parsererror').length).toBe(0);
  });

  it('does not mark Word\'s built-in styles as custom, whatever their id', async () => {
    const body = '<w:p><w:pPr><w:pStyle w:val="NoSpacing"/></w:pPr><w:r><w:t>Tight</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="Header"/></w:pPr><w:r><w:t>Top</w:t></w:r></w:p>';
    const xml = (await roundTrip({ styles, body }))['word/styles.xml'];
    for (const el of styleEls(xml)) {
      const name = nameOf(el);
      if (['No Spacing', 'header', 'Book Title', 'Normal'].includes(name)) expect(el.hasAttributeNS(W_NS, 'customStyle')).toBe(false);
    }
    expect(styleEls(xml).find((e) => nameOf(e) === 'TA_Author')!.getAttributeNS(W_NS, 'customStyle')).toBe('1');
  });

  it('takes Word\'s built-in names from the file\'s own latent styles too (17.7.4.5), not only from the list here', async () => {
    const own = '<w:latentStyles w:defLockedState="0" w:count="2"><w:lsdException w:name="Normal" w:qFormat="1"/><w:lsdException w:name="Smart Link Error" w:uiPriority="99"/></w:latentStyles>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
      '<w:style w:type="paragraph" w:customStyle="1" w:styleId="SmartLinkError"><w:name w:val="Smart Link Error"/><w:basedOn w:val="Normal"/><w:rPr><w:color w:val="FF0000"/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:customStyle="1" w:styleId="Mine"><w:name w:val="My Own"/><w:basedOn w:val="Normal"/><w:rPr><w:i/></w:rPr></w:style>';
    const body = '<w:p><w:pPr><w:pStyle w:val="SmartLinkError"/></w:pPr><w:r><w:t>A</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="Mine"/></w:pPr><w:r><w:t>B</w:t></w:r></w:p>';
    const xml = (await roundTrip({ styles: own, body }))['word/styles.xml'];
    expect(styleEls(xml).find((e) => nameOf(e) === 'Smart Link Error')!.hasAttributeNS(W_NS, 'customStyle')).toBe(false);
    expect(styleEls(xml).find((e) => nameOf(e) === 'My Own')!.getAttributeNS(W_NS, 'customStyle')).toBe('1');
  });

  it('keeps the Header style on a header\'s paragraph, its own tab stops cleared', async () => {
    const out = await roundTrip({ styles, body: '<w:p><w:r><w:t>Text</w:t></w:r></w:p>', header: '<w:p><w:pPr><w:pStyle w:val="Header"/></w:pPr><w:r><w:t>Running head</w:t></w:r></w:p>' });
    const hdr = Object.entries(out).find(([n]) => /^word\/header\d*\.xml$/.test(n))![1];
    expect(hdr).toContain('<w:pStyle w:val="Header"/>');
    expect(hdr).toMatch(/<w:tab w:val="clear" w:pos="(4680|9360)"\/>|<w:tab w:val="center" w:pos="4680"\/><w:tab w:val="right" w:pos="9360"\/>/);
  });

  it('keeps them through a second save', async () => {
    const { doc } = await readDocx(wordFile({ styles, body: '<w:p><w:r><w:t>Text</w:t></w:r></w:p>' }));
    const once = await writeDocx(doc, deps);
    const again = await readDocx(once);
    const xml = strFromU8(unzipSync(await writeDocx(again.doc, deps))['word/styles.xml']);
    const names = styleEls(xml).map(nameOf);
    expect(names.filter((n) => n === 'TA_Author').length).toBe(1);
    expect(names).toContain('Light List');
  });
});

describe('Word underline kinds and double strikethrough (G2-07)', () => {
  it('keeps a double, wavy or coloured underline and a double strikethrough', async () => {
    const r = (rPr: string, t: string) => `<w:r><w:rPr>${rPr}</w:rPr><w:t>${t}</w:t></w:r>`;
    const body = `<w:p>${r('<w:u w:val="double" w:color="FF0000"/>', 'dbl')}${r('<w:u w:val="wave"/>', 'wave')}${r('<w:u w:val="single"/>', 'plain')}${r('<w:dstrike/>', 'gone')}${r('<w:strike/>', 'struck')}</w:p>`;
    const xml = (await roundTrip({ body }))['word/document.xml'];
    const rPrOf = (t: string) => new RegExp(`<w:rPr>((?:(?!<w:rPr>)[\\s\\S])*?)</w:rPr><w:t[^>]*>${t}</w:t>`).exec(xml)?.[1] ?? '';
    expect(rPrOf('dbl')).toContain('<w:u w:val="double" w:color="FF0000"/>');
    expect(rPrOf('wave')).toContain('<w:u w:val="wave"/>');
    expect(rPrOf('plain')).toContain('<w:u w:val="single"/>');
    expect(rPrOf('gone')).toContain('<w:dstrike/>');
    expect(rPrOf('gone')).not.toContain('<w:strike');
    expect(rPrOf('struck')).toContain('<w:strike/>');
  });
});

describe('Word settings are kept (G2-15)', () => {
  it('keeps the compatibility options, equation settings and the rest in the standard\'s order', async () => {
    const settings = '<w:zoom w:percent="120"/><w:proofState w:spelling="clean"/><w:defaultTabStop w:val="720"/><w:characterSpacingControl w:val="doNotCompress"/>' +
      '<w:compat><w:useFELayout/><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/>' +
      '<w:compatSetting w:name="overrideTableStyleFontSizeAndJustification" w:uri="http://schemas.microsoft.com/office/word" w:val="1"/>' +
      '<w:compatSetting w:name="enableOpenTypeFeatures" w:uri="http://schemas.microsoft.com/office/word" w:val="1"/></w:compat>' +
      '<w:rsids><w:rsidRoot w:val="00A1B2C3"/><w:rsid w:val="00A1B2C3"/></w:rsids>' +
      '<m:mathPr><m:mathFont m:val="Cambria Math"/><m:brkBin m:val="before"/></m:mathPr>' +
      '<w:themeFontLang w:val="en-US"/><w:clrSchemeMapping w:bg1="light1" w:t1="dark1" w:bg2="light2" w:t2="dark2" w:accent1="accent1" w:accent2="accent2" w:accent3="accent3" w:accent4="accent4" w:accent5="accent5" w:accent6="accent6" w:hyperlink="hyperlink" w:followedHyperlink="followedHyperlink"/>' +
      '<w:decimalSymbol w:val="."/><w:listSeparator w:val=","/>';
    const xml = (await roundTrip({ settings, body: '<w:p><w:r><w:t>Text</w:t></w:r></w:p>' }))['word/settings.xml'];
    const doc = parse(xml);
    expect(doc.getElementsByTagName('parsererror').length).toBe(0);
    const names = Array.from(doc.documentElement.children).map((e) => e.localName);
    for (const n of ['rsids', 'mathPr', 'themeFontLang', 'clrSchemeMapping', 'decimalSymbol', 'listSeparator']) expect(names).toContain(n);
    // spelling marked as checked is not kept (the text may have changed)
    expect(names).not.toContain('proofState');
    // one zoom, one compat, in the standard's order
    expect(names.filter((n) => n === 'zoom').length).toBe(1);
    const at = (n: string) => names.indexOf(n);
    expect(at('compat')).toBeLessThan(at('rsids'));
    expect(at('rsids')).toBeLessThan(at('mathPr'));
    expect(at('mathPr')).toBeLessThan(at('themeFontLang'));
    expect(at('decimalSymbol')).toBeLessThan(at('listSeparator'));
    expect(at('listSeparator')).toBeLessThan(at('docId'));
    // the compatibility options, the mode once, after the flags
    expect(xml).toContain('<w:compat><w:useFELayout/><w:compatSetting w:name="compatibilityMode"');
    expect(xml.match(/compatibilityMode/g)!.length).toBe(1);
    expect(xml).toContain('w:name="overrideTableStyleFontSizeAndJustification"');
    expect(xml).toContain('<m:mathFont m:val="Cambria Math"/>');
  });
});

describe('Word run properties not modelled here are kept (G2-10)', () => {
  it('keeps emboss, a text border, character scale, an emphasis mark and right to left, each in its place', async () => {
    const body = '<w:p><w:r><w:rPr><w:b/><w:emboss/><w:color w:val="FF0000"/><w:w w:val="150"/><w:bdr w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:rtl/><w:em w:val="dot"/></w:rPr><w:t>odd</w:t></w:r>' +
      '<w:r><w:rPr><w:shadow/></w:rPr><w:t>old</w:t></w:r></w:p>';
    const xml = (await roundTrip({ body }))['word/document.xml'];
    const rPr = /<w:rPr>((?:(?!<w:rPr>)[\s\S])*?)<\/w:rPr><w:t[^>]*>odd<\/w:t>/.exec(xml)![1];
    const names = [...rPr.matchAll(/<w:(\w+)/g)].map((m) => m[1]);
    for (const n of ['emboss', 'w', 'bdr', 'rtl', 'em']) expect(names).toContain(n);
    // in CT_RPr's order (17.3.2.28)
    const order = ['b', 'emboss', 'color', 'w', 'bdr', 'rtl', 'em'];
    expect(names.filter((n) => order.includes(n) && n !== 'bCs')).toEqual(order);
    // Word 97's shadow stays one, not Word 2010's
    const old = /<w:rPr>((?:(?!<w:rPr>)[\s\S])*?)<\/w:rPr><w:t[^>]*>old<\/w:t>/.exec(xml)![1];
    expect(old).toContain('<w:shadow/>');
    expect(old).not.toContain('w14:shadow');
  });
});

describe('East Asian fonts are not made Latin ones (G2-09)', () => {
  it('writes a Latin font without an East Asian font, and an East Asian font with one', async () => {
    const body = '<w:p><w:r><w:rPr><w:rFonts w:ascii="Arial" w:eastAsia="SimSun" w:hAnsi="Arial"/></w:rPr><w:t>Yield 产率</w:t></w:r>' +
      '<w:r><w:rPr><w:rFonts w:ascii="MS Mincho" w:eastAsia="MS Mincho" w:hAnsi="MS Mincho"/></w:rPr><w:t>収率</w:t></w:r></w:p>';
    const xml = (await roundTrip({ body }))['word/document.xml'];
    expect(xml).not.toContain('w:eastAsia="Arial"');
    expect(xml).toContain('<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>');
    expect(xml).toContain('w:eastAsia="MS Mincho"');
  });
});

describe('Word paragraph properties not modelled here are kept (G2-11)', () => {
  it('keeps a drop cap\'s frame, an outline level, right to left and mirrored indents, each in its place', async () => {
    const body = '<w:p><w:pPr><w:keepNext/><w:framePr w:dropCap="drop" w:lines="3" w:wrap="around" w:vAnchor="text" w:hAnchor="text"/><w:bidi/><w:spacing w:after="0"/><w:mirrorIndents/><w:jc w:val="center"/><w:outlineLvl w:val="1"/></w:pPr><w:r><w:t>T</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>he rest</w:t></w:r></w:p>';
    const xml = (await roundTrip({ body }))['word/document.xml'];
    const pPr = /<w:pPr>((?:(?!<w:pPr>)[\s\S])*?)<\/w:pPr><w:r>(?:(?!<\/w:p>)[\s\S])*?<w:t[^>]*>T<\/w:t>/.exec(xml)![1];
    expect(pPr).toContain('<w:framePr w:dropCap="drop" w:lines="3" w:wrap="around" w:vAnchor="text" w:hAnchor="text"/>');
    const names = [...pPr.matchAll(/<w:(\w+)/g)].map((m) => m[1]);
    // in CT_PPrBase's order (17.3.1.26)
    const order = ['keepNext', 'framePr', 'bidi', 'spacing', 'mirrorIndents', 'jc', 'outlineLvl'];
    expect(names.filter((n) => order.includes(n))).toEqual(order);
    // the next paragraph has none of them
    expect(/<w:p>(?:(?!<\/w:p>)[\s\S])*?he rest/.exec(xml)![0]).not.toContain('framePr');
  });
});

describe('Word patterned shading is kept (G2-10)', () => {
  it('writes a patterned shading back as it was, not as a plain fill', async () => {
    const body = '<w:p><w:r><w:rPr><w:shd w:val="pct20" w:color="FF0000" w:fill="FFFF00"/></w:rPr><w:t>dotted</w:t></w:r></w:p>';
    const xml = (await roundTrip({ body }))['word/document.xml'];
    expect(xml).toContain('<w:shd w:val="pct20" w:color="FF0000" w:fill="FFFF00"/>');
    expect(xml).not.toContain('<w:highlight');
  });
});

describe('Word theme colours and fonts are kept (G2-09)', () => {
  const theme = '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:rPr><w:rFonts w:asciiTheme="majorHAnsi" w:hAnsiTheme="majorHAnsi"/><w:color w:val="2F5496" w:themeColor="accent1" w:themeShade="BF"/><w:sz w:val="32"/></w:rPr></w:style>';
  it('writes a run\'s and a style\'s theme colour and font back while they are what the theme gave', async () => {
    const body = '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Results</w:t></w:r></w:p>' +
      '<w:p><w:r><w:rPr><w:color w:val="ED7D31" w:themeColor="accent2"/></w:rPr><w:t>orange</w:t></w:r><w:r><w:rPr><w:rFonts w:asciiTheme="majorHAnsi" w:hAnsiTheme="majorHAnsi"/></w:rPr><w:t>display</w:t></w:r></w:p>';
    const out = await roundTrip({ styles: theme, body, fonts: ['Calibri Light', 'Calibri'] });
    const doc = out['word/document.xml'], styles = out['word/styles.xml'];
    expect(doc).toContain('<w:color w:val="ED7D31" w:themeColor="accent2"/>');
    expect(doc).toContain('<w:rFonts w:asciiTheme="majorHAnsi" w:hAnsiTheme="majorHAnsi"/>');
    const h1 = styleEls(styles).find((e) => nameOf(e) === 'heading 1')!;
    const h1x = new XMLSerializer().serializeToString(h1);
    expect(h1x).toContain('w:themeColor="accent1"');
    expect(h1x).toContain('w:themeShade="BF"');
    expect(h1x).toContain('w:asciiTheme="majorHAnsi"');
  });
});

describe('Word paragraph settings shown another way are written back as Word had them (G2-11)', () => {
  it('keeps contextual spacing, automatic spacing, distributed alignment, bar tabs and each border\'s distance', async () => {
    const styles = '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:after="160"/></w:pPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/></w:style>';
    const p = (pPr: string, t: string) => `<w:p><w:pPr>${pPr}</w:pPr><w:r><w:t>${t}</w:t></w:r></w:p>`;
    const body = p('<w:pStyle w:val="ListParagraph"/><w:contextualSpacing/>', 'one') + p('<w:pStyle w:val="ListParagraph"/><w:contextualSpacing/>', 'two') +
      p('<w:spacing w:before="100" w:beforeAutospacing="1"/>', 'auto') + p('<w:jc w:val="distribute"/>', 'spread') +
      p('<w:tabs><w:tab w:val="bar" w:pos="1440"/><w:tab w:val="left" w:pos="2880"/></w:tabs>', 'bar') +
      p('<w:pBdr><w:top w:val="single" w:sz="4" w:space="1" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="4" w:color="auto"/></w:pBdr>', 'boxed');
    const xml = (await roundTrip({ styles, body }))['word/document.xml'];
    const pPrOf = (t: string) => new RegExp(`<w:pPr>((?:(?!<w:pPr>)[\\s\\S])*?)</w:pPr><w:r>(?:(?!</w:p>)[\\s\\S])*?<w:t[^>]*>${t}</w:t>`).exec(xml)![1];
    expect(pPrOf('one')).toContain('<w:contextualSpacing/>');
    // the spacing after as the style has it, not made none
    expect(pPrOf('one')).not.toMatch(/w:after="0"/);
    expect(pPrOf('auto')).toContain('w:beforeAutospacing="1"');
    expect(pPrOf('spread')).toContain('<w:jc w:val="distribute"/>');
    expect(pPrOf('bar')).toContain('<w:tab w:val="bar" w:pos="1440"/>');
    expect(pPrOf('bar')).toContain('w:pos="2880"');
    expect(pPrOf('boxed')).toMatch(/<w:top [^>]*w:space="1"/);
    expect(pPrOf('boxed')).toMatch(/<w:bottom [^>]*w:space="4"/);
  });
});

describe('Word list definitions are kept while the lists are not changed here (G2-13)', () => {
  // as Word writes a list: the number's own size and underline, the tab after it, its ids (17.9)
  const W15 = 'http://schemas.microsoft.com/office/word/2012/wordml';
  const abs = (id: number, fmt: string, text: string) => `<w:abstractNum w:abstractNumId="${id}" xmlns:w15="${W15}" w15:restartNumberingAfterBreak="0"><w:nsid w:val="1A2B3C4${id}"/><w:multiLevelType w:val="hybridMultilevel"/><w:tmpl w:val="0409000F"/>` +
    `<w:lvl w:ilvl="0" w:tplc="0409000F"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="720"/></w:tabs><w:ind w:left="720" w:hanging="360"/></w:pPr><w:rPr><w:sz w:val="18"/><w:u w:val="single"/></w:rPr></w:lvl></w:abstractNum>`;
  const numbering = abs(0, 'decimal', '%1.') + abs(1, 'lowerLetter', '(%1)') +
    '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>';
  const item = (n: number, t: string) => `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="${n}"/></w:numPr></w:pPr><w:r><w:t>${t}</w:t></w:r></w:p>`;
  const body = item(1, 'first') + item(1, 'second') + item(2, 'third');

  it('writes each of the file\'s lists back as it was, and its items keep using it', async () => {
    const out = await roundTrip({ numbering, body });
    const nb = out['word/numbering.xml'];
    const doc = parse(nb);
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
    // both of the file's definitions, with their number formatting, tab, template codes and ids
    expect(nb.match(/<w:nsid w:val="1A2B3C4[01]"\/>/g)).toHaveLength(2);
    expect(nb.match(/<w:sz w:val="18"\/><w:u w:val="single"\/>/g)).toHaveLength(2);
    expect(nb).toContain('<w:tab w:val="num" w:pos="720"/>');
    expect(nb).toContain('w:tplc="0409000F"');
    expect(nb).toContain('w15:restartNumberingAfterBreak="0"');
    expect(nb).toMatch(/mc:Ignorable="[^"]*\bw15\b/);
    // each item uses its own list again, under the id that list was written with
    const numOf = (t: string) => new RegExp(`<w:numId w:val="(\\d+)"/>(?:(?!</w:p>)[\\s\\S])*?<w:t[^>]*>${t}</w:t>`).exec(out['word/document.xml'])?.[1];
    const absOf = (numId: string) => Array.from(doc.getElementsByTagNameNS(W_NS, 'num')).find((n) => n.getAttributeNS(W_NS, 'numId') === numId)
      ?.getElementsByTagNameNS(W_NS, 'abstractNumId')[0].getAttributeNS(W_NS, 'val');
    const lvlText = (absId: string | null | undefined) => Array.from(doc.getElementsByTagNameNS(W_NS, 'abstractNum')).find((a) => a.getAttributeNS(W_NS, 'abstractNumId') === absId)
      ?.getElementsByTagNameNS(W_NS, 'lvlText')[0].getAttributeNS(W_NS, 'val');
    expect(numOf('first')).toBe(numOf('second'));
    expect(lvlText(absOf(numOf('first')!))).toBe('%1.');
    expect(lvlText(absOf(numOf('third')!))).toBe('(%1)');
    // (ids unique across the part)
    const ids = Array.from(doc.getElementsByTagNameNS(W_NS, 'num')).map((n) => n.getAttributeNS(W_NS, 'numId'));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps them once, save after save', async () => {
    const { doc } = await readDocx(wordFile({ numbering, body }));
    const again = (await readDocx(await writeDocx(doc, deps))).doc;
    const nb = strFromU8(unzipSync(await writeDocx(again, deps))['word/numbering.xml']);
    expect(nb.match(/<w:nsid /g)).toHaveLength(2);
  });

  it('gives a list item changed here a list made here', async () => {
    const { doc } = await readDocx(wordFile({ numbering, body }));
    // the third item made a bulleted one
    const i = doc.paras.findIndex((p) => p.list === 'number' && p.scheme !== undefined);
    doc.paras[i] = { ...doc.paras[i], list: 'bullet', scheme: undefined };
    const out = unzipSync(await writeDocx(doc, deps));
    const xml = strFromU8(out['word/document.xml']);
    const third = /<w:numId w:val="(\d+)"\/>(?:(?!<\/w:p>)[\s\S])*?<w:t[^>]*>third<\/w:t>/.exec(xml)![1];
    // (the file's two lists are written as 1 and 2; lists made here come after them)
    expect(Number(third)).toBeGreaterThan(2);
    const nb = parse(strFromU8(out['word/numbering.xml']));
    const absId = Array.from(nb.getElementsByTagNameNS(W_NS, 'num')).find((n) => n.getAttributeNS(W_NS, 'numId') === third)!.getElementsByTagNameNS(W_NS, 'abstractNumId')[0].getAttributeNS(W_NS, 'val');
    const abs = Array.from(nb.getElementsByTagNameNS(W_NS, 'abstractNum')).find((a) => a.getAttributeNS(W_NS, 'abstractNumId') === absId)!;
    expect(abs.getElementsByTagNameNS(W_NS, 'numFmt')[0].getAttributeNS(W_NS, 'val')).toBe('bullet');
  });
});

describe('Kept Word lists number in Word as they are numbered here after an edit (review F2-R01, F2-R06)', () => {
  const W15 = 'http://schemas.microsoft.com/office/word/2012/wordml';
  const numbering = `<w:abstractNum w:abstractNumId="0" xmlns:w15="${W15}" w15:restartNumberingAfterBreak="0"><w:nsid w:val="0A0B0C0D"/><w:multiLevelType w:val="hybridMultilevel"/>` +
    '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr><w:rPr><w:sz w:val="18"/></w:rPr></w:lvl></w:abstractNum>' +
    '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="0"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="5"/></w:lvlOverride></w:num>';
  const item = (n: number, t: string) => `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="${n}"/></w:numPr></w:pPr><w:r><w:t>${t}</w:t></w:r></w:p>`;
  const plain = (t: string) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;
  type Doc = Awaited<ReturnType<typeof readDocx>>['doc'];
  /** The numbers shown, '' for a paragraph that isn't a numbered item. */
  const shown = (d: Doc) => listInfo(d.paras).map((x, i) => (d.paras[i].list === 'number' ? x.marker : ''));
  /** Saved and opened again: the numbers Word gives (the reader counts as Word does, §17.9). */
  const reopened = async (d: Doc) => shown((await readDocx(await writeDocx(d, deps))).doc);
  /** Every list in the saved file points at the file's own levels (the number's size kept). */
  const allKept = async (d: Doc) => {
    const out = unzipSync(await writeDocx(d, deps));
    const ids = [...strFromU8(out['word/document.xml']).matchAll(/<w:numId w:val="(\d+)"\/>/g)].map((m) => m[1]);
    const nb = parse(strFromU8(out['word/numbering.xml']));
    const absOf = (id: string) => Array.from(nb.getElementsByTagNameNS(W_NS, 'num')).find((n) => n.getAttributeNS(W_NS, 'numId') === id)!.getElementsByTagNameNS(W_NS, 'abstractNumId')[0].getAttributeNS(W_NS, 'val');
    return ids.every((id) => absOf(id) === '0');
  };
  /** The document without paragraph `k` (its text and its line end). */
  const withoutPara = (d: Doc, k: number): Doc => {
    const text = d.runs.map((r) => r.text).join('');
    const lines = text.split('\n');
    lines.splice(k, 1);
    return { ...d, runs: [{ ...d.runs[0], text: lines.join('\n') }], paras: d.paras.filter((_, i) => i !== k) };
  };

  it('keeps the numbers right when a middle item is made plain', async () => {
    const { doc } = await readDocx(wordFile({ numbering, body: item(1, 'a') + item(1, 'b') + item(1, 'c') + item(1, 'd') }));
    doc.paras[1] = { ...doc.paras[1], list: undefined };
    expect(shown(doc)).toEqual(['1.', '', '1.', '2.']);
    expect(await reopened(doc)).toEqual(['1.', '', '1.', '2.']);
    expect(await allKept(doc)).toBe(true);
  });

  it('keeps the numbers right when an item no longer carries on the list', async () => {
    const { doc } = await readDocx(wordFile({ numbering, body: item(1, 'a') + item(1, 'b') + plain('note') + item(1, 'c') + item(1, 'd') }));
    expect(shown(doc)).toEqual(['1.', '2.', '', '3.', '4.']);
    expect(await reopened(doc)).toEqual(['1.', '2.', '', '3.', '4.']);
    doc.paras[3] = { ...doc.paras[3], startAt: undefined };
    expect(shown(doc)).toEqual(['1.', '2.', '', '1.', '2.']);
    expect(await reopened(doc)).toEqual(['1.', '2.', '', '1.', '2.']);
    expect(await allKept(doc)).toBe(true);
  });

  it('keeps the numbers right when the item that set a list\'s start is deleted', async () => {
    const { doc } = await readDocx(wordFile({ numbering, body: item(1, 'a') + item(1, 'b') + plain('note') + item(2, 'e') + item(2, 'f') }));
    expect(shown(doc)).toEqual(['1.', '2.', '', '5.', '6.']);
    const cut = withoutPara(doc, 3);
    expect(shown(cut)).toEqual(['1.', '2.', '', '1.']);
    expect(await reopened(cut)).toEqual(['1.', '2.', '', '1.']);
    expect(await allKept(cut)).toBe(true);
  });

  it('writes an unedited item\'s indent as Word had it, and a changed one as laid out here', async () => {
    const body = '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>a</w:t></w:r></w:p>' +
      '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr><w:ind w:left="1080" w:hanging="360"/></w:pPr><w:r><w:t>b</w:t></w:r></w:p>';
    const { doc } = await readDocx(wordFile({ numbering, body }));
    const pPrOf = (xml: string, t: string) => new RegExp(`<w:pPr>((?:(?!<w:pPr>)[\\s\\S])*?)</w:pPr><w:r>(?:(?!</w:p>)[\\s\\S])*?<w:t[^>]*>${t}</w:t>`).exec(xml)![1];
    let xml = strFromU8(unzipSync(await writeDocx(doc, deps))['word/document.xml']);
    expect(pPrOf(xml, 'a')).not.toContain('<w:ind ');
    expect(pPrOf(xml, 'b')).toContain('<w:ind w:left="1080" w:hanging="360"/>');
    doc.paras[0] = { ...doc.paras[0], indent: (doc.paras[0].indent ?? 0) + 36 };
    xml = strFromU8(unzipSync(await writeDocx(doc, deps))['word/document.xml']);
    expect(pPrOf(xml, 'a')).toContain('<w:ind ');
  });
});
