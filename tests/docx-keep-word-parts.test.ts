// @vitest-environment jsdom
//
// Saving a Word file keeps what Word had that isn't edited here (audit G2-12 to G2-15, G2-07,
// G2-09 to G2-11). The files are built here as Word writes them (ECMA-376 part 1 element names);
// none is a file saved by Word.

import { describe, it, expect } from 'vitest';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { readDocx, writeDocx, type DocxDeps } from '../src/io/docx';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W = `xmlns:w="${W_NS}"`;
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const deps: DocxDeps = { async picture() { return null; } };
const u8 = (s: string) => new Uint8Array(strToU8(s));

export interface WordParts { body: string; styles?: string; numbering?: string; settings?: string; header?: string }

/** A Word file with the parts given (styles, numbering, settings and a header as their root's contents). */
export function wordFile(p: WordParts): Uint8Array {
  const rels: string[] = [];
  const files: Record<string, Uint8Array> = {};
  const part = (name: string, type: string, xml: string) => { rels.push(`<Relationship Id="rId${rels.length + 1}" Type="${R}${type}" Target="${name}"/>`); files[`word/${name}`] = u8(xml); };
  if (p.styles !== undefined) part('styles.xml', 'styles', `<?xml version="1.0"?><w:styles ${W}>${p.styles}</w:styles>`);
  if (p.numbering !== undefined) part('numbering.xml', 'numbering', `<?xml version="1.0"?><w:numbering ${W}>${p.numbering}</w:numbering>`);
  if (p.settings !== undefined) part('settings.xml', 'settings', `<?xml version="1.0"?><w:settings ${W} xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">${p.settings}</w:settings>`);
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
