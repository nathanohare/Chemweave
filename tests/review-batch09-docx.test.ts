// @vitest-environment jsdom
//
// Code review 2026-11-26, batch 09: Word (.docx) reading and writing. Word files are built here
// from WordprocessingML as ECMA-376 part 1 (5th edition) describes it; the sections cited are
// that standard's. Findings: F111 F112 F113 F114 F115 F116 F117 F118 F119 F559 F562 F563 F564
// F565 F566 F567 F568 F569 F571 F573.

import { describe, it, expect } from 'vitest';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { readDocx, writeDocx, type DocxDeps } from '../src/io/docx';
import { newDocument, type DocText } from '../src/document/document';
import * as rt from '../src/richtext';
import type { TableCell } from '../src/model';

const NSS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const deps: DocxDeps = { async picture() { return null; } };
const u8 = (s: string) => new Uint8Array(strToU8(s));
// a 1 × 1 PNG (signature, IHDR, IDAT, IEND)
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));

/** A Word file: its body, with other parts (by path, each given a relationship of its type from the document). */
function wordFile(body: string, parts: { path: string; type: string; xml: string | Uint8Array }[] = [], sect = '<w:sectPr/>'): Uint8Array {
  const rels = parts.map((p, i) => `<Relationship Id="rIdX${i}" Type="${R}${p.type}" Target="${p.path.replace(/^word\//, '')}"/>`).join('');
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': u8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/></Types>'),
    '_rels/.rels': u8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}officeDocument" Target="word/document.xml"/></Relationships>`),
    'word/document.xml': u8(`<?xml version="1.0"?><w:document ${NSS}><w:body>${body}${sect}</w:body></w:document>`),
    'word/_rels/document.xml.rels': u8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`),
  };
  for (const p of parts) files[p.path] = typeof p.xml === 'string' ? u8(p.xml) : p.xml;
  return zipSync(files);
}
const rid = (parts: { path: string }[], path: string) => `rIdX${parts.findIndex((p) => p.path === path)}`;
const P = (text: string, ppr = '') => `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const TBL = (text: string) => `<w:tbl><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`;
const REF = (mark: string, shown: string) => `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> REF ${mark} \\h </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>${shown}</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`;
const textBox = (inner: string, fill = '') => `<w:r><w:drawing><wp:inline><wp:extent cx="914400" cy="457200"/><wp:docPr id="7" name="Text Box 7"/><a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="457200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${fill}</wps:spPr><wps:txbx><w:txbxContent>${inner}</w:txbxContent></wps:txbx><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
const THEME = `<?xml version="1.0"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="T"><a:themeElements><a:clrScheme name="T"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="FF0000"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="T"><a:majorFont><a:latin typeface="Calibri Light"/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`;
const docXml = async (t: DocText, d: DocxDeps = deps) => unzipSync(await writeDocx(t, d));

describe('Word paragraphs and sections (F111, F114, F115)', () => {
  it('starts a section once at a paragraph with a line break in it, not at each of its lines', async () => {
    const body = P('One', '<w:sectPr><w:type w:val="nextPage"/></w:sectPr>') + '<w:p><w:r><w:t>Chapter 2</w:t><w:br/><w:t>Methods</w:t></w:r></w:p>';
    const { doc } = await readDocx(wordFile(body));
    expect(rt.plainText(doc.runs)).toBe('One\nChapter 2\nMethods');
    expect(doc.paras[1].section).toBeDefined();
    expect(doc.paras[2].soft).toBe(true);
    expect(doc.paras[2].section).toBeUndefined();
  });

  it('keeps a page break paragraph between two tables', async () => {
    const { doc } = await readDocx(wordFile(TBL('A') + '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' + TBL('B') + P('after')));
    expect(doc.paras.some((p) => p.pageBreak)).toBe(true);
  });

  it('keeps a section break before a table of its own that has a title', async () => {
    const d = newDocument();
    const table = { cols: [100, 100], head: 1, lines: 'acs' as const, title: [{ text: 'Table 1. Conditions' }], rows: [[{ runs: [{ text: 'a' }] }, { runs: [{ text: 'b' }] }]] };
    const t: DocText = {
      ...d,
      runs: [{ text: 'Portrait\n' }, { obj: 1, text: '￼' }],
      paras: [{}, { section: { kind: 'nextPage', page: { ...d.page, w: d.page.h, h: d.page.w } } }],
      // a drawn table (a drawing that is one table), saved as Word's table with its title above it
      objects: { 1: { kind: 'drawing', contents: { atoms: [], bonds: [], captions: [], arrows: [], shapes: [{ id: 1, kind: 'table', x1: 0, y1: 0, x2: 200, y2: 40, table }] } } },
    };
    const { doc } = await readDocx(await writeDocx(t, deps));
    // the title's paragraph is the table's again, with the section break it started
    expect(rt.plainText(doc.runs).startsWith('Portrait\n￼')).toBe(true);
    expect(doc.paras[1].section?.kind).toBe('nextPage');
    // (the landscape section: the page is wider than tall)
    expect(doc.paras[1].section!.page!.w).toBeGreaterThan(doc.paras[1].section!.page!.h);
    const dr = Object.values(doc.objects).find((o) => o.kind === 'drawing');
    const shape = dr?.kind === 'drawing' ? dr.contents.shapes[0] : undefined;
    expect(rt.plainText(shape?.table?.title ?? [])).toBe('Table 1. Conditions');
  });
});

describe('Word cross-references and notes (F112, F563)', () => {
  it('keeps the text Word showed for a cross-reference in a text box', async () => {
    const body = `<w:p><w:bookmarkStart w:id="0" w:name="_Ref1"/><w:r><w:t>Methods and materials</w:t></w:r><w:bookmarkEnd w:id="0"/></w:p>`
      + `<w:p>${textBox(`<w:p><w:r><w:t xml:space="preserve">see </w:t></w:r>${REF('_Ref1', 'Section 2.1')}</w:p>`)}</w:p>`;
    const { doc } = await readDocx(wordFile(body));
    const box = Object.values(doc.objects).find((o) => o.kind === 'textbox');
    expect(box?.kind === 'textbox' && rt.plainText(box.runs)).toBe('see Section 2.1');
  });

  const notes = (inner: string) => ({ path: 'word/footnotes.xml', type: 'footnotes', xml: `<?xml version="1.0"?><w:footnotes ${NSS}><w:footnote w:id="1"><w:p>${inner}</w:p></w:footnote></w:footnotes>` });

  it('keeps the text Word showed for a cross-reference in a footnote', async () => {
    const body = `<w:p><w:bookmarkStart w:id="0" w:name="_Ref2"/><w:r><w:t>Figure 2</w:t></w:r><w:bookmarkEnd w:id="0"/></w:p><w:p><w:r><w:t>Text</w:t></w:r><w:r><w:footnoteReference w:id="1"/></w:r></w:p>`;
    const { doc } = await readDocx(wordFile(body, [notes(`<w:r><w:t xml:space="preserve">see </w:t></w:r>${REF('_Ref2', 'Figure 2')}`)]));
    const note = Object.values(doc.objects).find((o) => o.kind === 'note');
    expect(note?.kind === 'note' && rt.plainText(note.runs)).toBe('see Figure 2');
  });

  it('says so when an equation in a footnote is left out', async () => {
    const body = '<w:p><w:r><w:t>Text</w:t></w:r><w:r><w:footnoteReference w:id="1"/></w:r></w:p>';
    const { warnings } = await readDocx(wordFile(body, [notes('<w:r><w:t xml:space="preserve">x is </w:t></w:r><m:oMath><m:r><m:t>x</m:t></m:r></m:oMath>')]));
    expect(warnings.some((w) => /footnotes and endnotes were left out/.test(w))).toBe(true);
  });
});

describe('Word shapes (F113)', () => {
  const theme = { path: 'word/theme/theme1.xml', type: 'theme', xml: THEME };

  it('reads a theme colour fill from the document\'s theme', async () => {
    const { doc } = await readDocx(wordFile(`<w:p>${textBox(P('Hi'), '<a:solidFill><a:schemeClr val="accent1"/></a:solidFill>')}</w:p>`, [theme]));
    const box = Object.values(doc.objects).find((o) => o.kind === 'textbox');
    expect(box?.kind === 'textbox' && box.fill).toBe('#4472c4');
  });

  it('works in a theme colour\'s darker shade (lumMod)', async () => {
    // accent2 is FF0000 (hue 0, saturation 100%, luminance 50%); lumMod 50% (20.1.2.3.20) takes
    // its luminance to 25%: rgb(50%, 0, 0), #800000
    const { doc } = await readDocx(wordFile(`<w:p>${textBox(P('Hi'), '<a:solidFill><a:schemeClr val="accent2"><a:lumMod val="50000"/></a:schemeClr></a:solidFill>')}</w:p>`, [theme]));
    const box = Object.values(doc.objects).find((o) => o.kind === 'textbox');
    expect(box?.kind === 'textbox' && box.fill).toBe('#800000');
  });
});

describe('Word paragraphs, columns and pictures (F559, F562, F564, F566)', () => {
  it('reads w:dropCap="none" as no drop cap, so the frame\'s alignment stands', async () => {
    const { doc } = await readDocx(wordFile(P('Right', '<w:framePr w:dropCap="none" w:xAlign="right" w:wrap="around" w:vAnchor="text" w:hAnchor="margin"/>')));
    expect(doc.paras[0].align).toBe('right');
  });

  it('says so when a section has more than four columns', async () => {
    const { warnings } = await readDocx(wordFile(P('Six'), [], '<w:sectPr><w:cols w:num="6" w:space="360"/></w:sectPr>'));
    expect(warnings.some((w) => /more than four columns/.test(w))).toBe(true);
  });

  const anchored = (relFrom: string, offEmu: number, embed: string) => `<w:p><w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="1" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>914400</wp:posOffset></wp:positionH><wp:positionV relativeFrom="${relFrom}"><wp:posOffset>${offEmu}</wp:posOffset></wp:positionV><wp:extent cx="914400" cy="914400"/><wp:wrapNone/><wp:docPr id="3" name="Picture 3"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="p.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${embed}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p>`;

  it('places a picture set from the top margin from the page\'s top edge', async () => {
    const parts = [{ path: 'word/media/image1.png', type: 'image', xml: PNG }];
    // 182880 EMU = 0.2 in = 14.4 pt (914400 EMU an inch, 20.1.2.1)
    const { doc } = await readDocx(wordFile(anchored('topMargin', 182880, rid(parts, 'word/media/image1.png')), parts));
    const pic = Object.values(doc.objects).find((o) => o.kind === 'picture');
    expect(pic?.kind === 'picture' && pic.float).toMatchObject({ yFrom: 'page', y: 14.4 });
  });

  it('says so when a picture\'s file is missing or in a format that can\'t be shown', async () => {
    const parts = [{ path: 'word/media/image1.wdp', type: 'image', xml: new Uint8Array([0x49, 0x49, 0xbc, 0x01, 0, 0, 0, 0]) }];
    const { warnings } = await readDocx(wordFile(anchored('page', 0, rid(parts, 'word/media/image1.wdp')), parts));
    expect(warnings.some((w) => /can't be shown here/.test(w))).toBe(true);
  });
});

describe('Word comments (F565)', () => {
  it('keeps an emoji whole when a comment is on it', async () => {
    const comments = { path: 'word/comments.xml', type: 'comments', xml: `<?xml version="1.0"?><w:comments ${NSS}><w:comment w:id="0" w:author="A" w:date="2026-01-01T00:00:00Z"><w:p><w:r><w:t>Nice</w:t></w:r></w:p></w:comment></w:comments>` };
    const { doc } = await readDocx(wordFile('<w:p><w:r><w:t xml:space="preserve">great 👍</w:t></w:r><w:r><w:commentReference w:id="0"/></w:r></w:p>', [comments]));
    expect(rt.plainText(doc.runs)).toBe('great 👍');
    // no run holds half of the emoji's surrogate pair
    for (const r of doc.runs) expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(r.text)).toBe(false);
    expect(doc.runs.find((r) => r.cmt)?.text).toBe('👍');
  });
});

describe('Word tables (F567, F568)', () => {
  it('reads percentage cell widths (w:type="pct", fiftieths of a percent) as shares of the text width', async () => {
    const tbl = '<w:tbl><w:tblPr/><w:tr><w:tc><w:tcPr><w:tcW w:w="2500" w:type="pct"/></w:tcPr><w:p><w:r><w:t>a</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:w="2500" w:type="pct"/></w:tcPr><w:p><w:r><w:t>b</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
    const { doc } = await readDocx(wordFile(tbl + P('after')));
    const tb = Object.values(doc.objects).find((o) => o.kind === 'table');
    if (tb?.kind !== 'table') throw new Error('no table');
    const textW = doc.page.w - doc.page.left - doc.page.right;
    // 2500 fiftieths of a percent = 50%
    expect(tb.table.cols[0]).toBeCloseTo(textW / 2, 0);
    expect(tb.table.cols[1]).toBeCloseTo(textW / 2, 0);
  });

  it('gives a cell merged down its last row\'s bottom line only', async () => {
    const cell = (vm: string, bottom: boolean, text = '') => `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/><w:vMerge${vm ? ` w:val="${vm}"` : ''}/>${bottom ? '<w:tcBorders><w:bottom w:val="single" w:sz="8" w:space="0" w:color="000000"/></w:tcBorders>' : ''}</w:tcPr><w:p>${text ? `<w:r><w:t>${text}</w:t></w:r>` : ''}</w:p></w:tc>`;
    const other = (t: string) => `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>${t}</w:t></w:r></w:p></w:tc>`;
    const tbl = `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid><w:tr>${cell('restart', false, 'M')}${other('1')}</w:tr><w:tr>${cell('', true)}${other('2')}</w:tr><w:tr>${cell('', false)}${other('3')}</w:tr></w:tbl>`;
    const { doc } = await readDocx(wordFile(tbl + P('after')));
    const tb = Object.values(doc.objects).find((o) => o.kind === 'table');
    if (tb?.kind !== 'table') throw new Error('no table');
    const owner: TableCell = tb.table.rows[0][0];
    expect(owner.rowSpan).toBe(3);
    expect(owner.borders?.bottom).toBeUndefined();
  });
});

describe('Word headers (F569)', () => {
  it('reads a later section\'s own first-page header when its main header is linked', async () => {
    const hdr = (text: string) => `<?xml version="1.0"?><w:hdr ${NSS}>${P(text)}</w:hdr>`;
    const parts = [{ path: 'word/header1.xml', type: 'header', xml: hdr('Main header') }, { path: 'word/header2.xml', type: 'header', xml: hdr('Own first page') }];
    const sect1 = `<w:sectPr><w:headerReference w:type="default" r:id="${rid(parts, 'word/header1.xml')}"/></w:sectPr>`;
    const body = P('Part one', sect1) + P('Part two');
    const sect2 = `<w:sectPr><w:headerReference w:type="first" r:id="${rid(parts, 'word/header2.xml')}"/><w:titlePg/></w:sectPr>`;
    const { doc } = await readDocx(wordFile(body, parts, sect2));
    const hf = doc.paras.map((p) => p.section).find((s) => s)?.hf;
    expect(hf?.firstPage).toBe(true);
    expect(hf?.first?.header.join('') ?? rt.plainText(hf?.bodies?.firstHeader?.runs ?? [])).toContain('Own first page');
    // (its main header is still the one before's)
    expect(hf?.header.join('')).toContain('Main header');
  });
});

describe('Word settings and run properties (F571, F573)', () => {
  it('writes back the file\'s own default tab stop', async () => {
    const settings = { path: 'word/settings.xml', type: 'settings', xml: `<?xml version="1.0"?><w:settings ${NSS}><w:defaultTabStop w:val="360"/></w:settings>` };
    const { doc } = await readDocx(wordFile(P('tabbed'), [settings]));
    const out = strFromU8((await docXml(doc))['word/settings.xml']);
    expect(out).toContain('<w:defaultTabStop w:val="360"/>');
  });

  it('writes w:position after w:color, w:spacing and w:kern, before w:sz (17.3.2.28 CT_RPr)', async () => {
    const d = newDocument();
    const t: DocText = { ...d, runs: [{ text: 'up', raise: 3, color: '#c00000', spacing: 1, size: 14 }], paras: [{}] };
    const xml = strFromU8((await docXml(t))['word/document.xml']);
    const rpr = /<w:r><w:rPr>(.*?)<\/w:rPr><w:t[^>]*>up</.exec(xml)?.[1] ?? '';
    const at = (tag: string) => rpr.indexOf(`<w:${tag} `);
    expect(at('position')).toBeGreaterThan(at('color'));
    expect(at('position')).toBeGreaterThan(at('spacing'));
    expect(at('position')).toBeLessThan(at('sz'));
  });
});

describe('Word pictures (F116)', () => {
  // a WebP file's header (RIFF, its size, WEBP: Google's WebP Container Specification)
  const WEBP = 'data:image/webp;base64,' + btoa('RIFF\x0e\x00\x00\x00WEBPVP8L\x02\x00\x00\x00');
  const t = (): DocText => ({ ...newDocument(), runs: [{ obj: 1, text: '￼' }], paras: [{}], objects: { 1: { kind: 'picture', src: WEBP, w: 36, h: 36 } } });

  it('saves a WebP picture as PNG, never WebP bytes named .png', async () => {
    const files = await docXml(t(), { ...deps, pictureToPng: async () => PNG });
    const media = Object.keys(files).filter((k) => k.startsWith('word/media/'));
    expect(media.length).toBe(1);
    expect(media[0].endsWith('.png')).toBe(true);
    expect([...files[media[0]].subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('leaves a WebP picture out rather than relabel it when it can\'t be made PNG', async () => {
    const files = await docXml(t());
    for (const k of Object.keys(files).filter((x) => x.startsWith('word/media/'))) expect(strFromU8(files[k].subarray(0, 4))).not.toBe('RIFF');
  });
});

describe('Word comments round a contents list (F117)', () => {
  it('closes a comment over a table of contents where its text ends, adding no paragraph at the end', async () => {
    const d = newDocument();
    const t: DocText = {
      ...d,
      runs: [{ text: 'Before ', cmt: '1' }, { text: '\n' }, { obj: 1, text: '￼', cmt: '1' }, { text: '\n' }, { text: 'After', cmt: '1' }, { text: ' end' }],
      paras: [{}, {}, {}],
      objects: { 1: { kind: 'toc', levels: 3 } },
      comments: { 1: { author: 'A', date: '2026-01-01T00:00:00Z', text: 'Check' } },
    };
    const xml = strFromU8((await docXml(t))['word/document.xml']);
    const body = xml.slice(xml.indexOf('<w:body>'), xml.indexOf('<w:sectPr'));
    const paras = body.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? [];
    const last = paras[paras.length - 1];
    // the range ends in the paragraph with "After", which is the last one
    expect(last).toContain('After');
    expect(last).toContain('<w:commentRangeEnd w:id="0"/>');
    expect((body.match(/<w:commentRangeEnd /g) ?? []).length).toBe(1);
  });
});

describe('Word lists in text boxes and headers (F118)', () => {
  it('gives each text box\'s numbered list a Word list of its own', async () => {
    const box = (id: number) => ({ kind: 'textbox' as const, runs: [{ text: 'one\ntwo' }], paras: [{ list: 'number' as const }, { list: 'number' as const }], w: 100, float: { wrap: 'topBottom' as const, x: 0, y: 0, inline: true } });
    void 0;
    const t: DocText = { ...newDocument(), runs: [{ obj: 1, text: '￼' }, { text: '\n' }, { obj: 2, text: '￼' }], paras: [{}, {}], objects: { 1: box(1), 2: box(2) } };
    const xml = strFromU8((await docXml(t))['word/document.xml']);
    const ids = [...xml.matchAll(/<w:numId w:val="(\d+)"\/>/g)].map((m) => m[1]);
    expect(ids.length).toBe(4);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[2]).toBe(ids[3]);
    expect(ids[0]).not.toBe(ids[2]);
  });
});

describe('Word watermarks (F119)', () => {
  it('defines the watermark\'s shape type in each header part that holds one', async () => {
    const d = newDocument();
    const t: DocText = {
      ...d, runs: [{ text: 'Body' }], paras: [{}],
      watermark: { text: 'DRAFT', font: 'Calibri', color: '#c0c0c0', layout: 'diagonal', faded: true },
      hf: { ...d.hf, header: ['Title', '', ''], firstPage: true, first: { header: ['First', '', ''], footer: ['', '', ''] } },
    };
    const files = await docXml(t);
    const headers = Object.keys(files).filter((k) => /^word\/header\d+\.xml$/.test(k)).map((k) => strFromU8(files[k])).filter((x) => x.includes('type="#_x0000_t136"'));
    expect(headers.length).toBeGreaterThan(1);
    for (const h of headers) expect(h).toContain('<v:shapetype id="_x0000_t136"');
  });
});
