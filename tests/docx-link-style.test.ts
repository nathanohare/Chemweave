// @vitest-environment jsdom
//
// Word's link styles (Hyperlink, FollowedHyperlink) on a link's words come back as those styles
// when the file is saved here, written as Word writes them (not in its Quick Styles gallery),
// rather than as plain blue underlined text.

import { describe, it, expect } from 'vitest';
import { styleXml } from './xml-text';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { readDocx, writeDocx, type DocxDeps } from '../src/io/docx';
import type { DocText } from '../src/document/document';
import type { TextRun } from '../src/model';
import * as rt from '../src/richtext';
import { removeLink } from '../src/links';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const deps: DocxDeps = { async picture() { return { png: PNG, w: 10, h: 10 }; }, async svgToPng() { return PNG; } };

/** Word's own link styles, as Word writes them. */
const STYLES = `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>` +
  `<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/><w:unhideWhenUsed/></w:style>` +
  `<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:basedOn w:val="DefaultParagraphFont"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:rPr><w:color w:val="0563C1" w:themeColor="hyperlink"/><w:u w:val="single"/></w:rPr></w:style>` +
  `<w:style w:type="character" w:styleId="FollowedHyperlink"><w:name w:val="FollowedHyperlink"/><w:basedOn w:val="DefaultParagraphFont"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/><w:rPr><w:color w:val="954F72" w:themeColor="followedHyperlink"/><w:u w:val="single"/></w:rPr></w:style>`;

function docx(): Uint8Array {
  const body = `<w:p><w:r><w:t xml:space="preserve">See </w:t></w:r><w:hyperlink r:id="rIdL" w:history="1"><w:r><w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr><w:t>the site</w:t></w:r></w:hyperlink>` +
    `<w:r><w:t xml:space="preserve"> and </w:t></w:r><w:hyperlink r:id="rIdL" w:history="1"><w:r><w:rPr><w:rStyle w:val="FollowedHyperlink"/></w:rPr><w:t>the page seen</w:t></w:r></w:hyperlink></w:p>`;
  return zipSync({
    '[Content_Types].xml': new Uint8Array(strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>')),
    '_rels/.rels': new Uint8Array(strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}officeDocument" Target="word/document.xml"/></Relationships>`)),
    'word/_rels/document.xml.rels': new Uint8Array(strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdS" Type="${R}styles" Target="styles.xml"/><Relationship Id="rIdL" Type="${R}hyperlink" Target="https://example.org/" TargetMode="External"/></Relationships>`)),
    'word/styles.xml': new Uint8Array(strToU8(`<?xml version="1.0"?><w:styles ${W}>${STYLES}</w:styles>`)),
    'word/document.xml': new Uint8Array(strToU8(`<?xml version="1.0"?><w:document ${W}><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body></w:document>`)),
  });
}

describe("Word's link styles", () => {
  it('are kept on the words, and written as Word writes them', async () => {
    const t = (await readDocx(docx())).doc as DocText;
    expect(t.runs.find((r) => r.text === 'the site')).toMatchObject({ cstyle: 'Hyperlink', underline: true, link: 'https://example.org/' });
    expect(t.runs.find((r) => r.text === 'the page seen')).toMatchObject({ cstyle: 'FollowedHyperlink', underline: true });
    const files = unzipSync(await writeDocx(t, deps));
    const doc = strFromU8(files['word/document.xml']);
    expect(doc).toMatch(/<w:hyperlink [^>]*><w:r><w:rPr><w:rStyle w:val="Hyperlink"\/>/);
    expect(doc).toContain('<w:rStyle w:val="FollowedHyperlink"/>');
    const styles = strFromU8(files['word/styles.xml']);
    const style = (id: string) => styleXml(styles, id, 'character');
    // one of each, Word's own (not custom, not in the Quick Styles gallery), with its look
    expect(styles.match(/w:styleId="Hyperlink"/g)).toHaveLength(1);
    expect(style('Hyperlink')).toContain('<w:name w:val="Hyperlink"/>');
    expect(style('Hyperlink')).toContain('<w:uiPriority w:val="99"/><w:unhideWhenUsed/>');
    expect(style('Hyperlink')).toContain('<w:u w:val="single"/>');
    expect(style('FollowedHyperlink')).toContain('<w:semiHidden/><w:unhideWhenUsed/>');
    for (const id of ['Hyperlink', 'FollowedHyperlink']) {
      expect(style(id)).not.toContain('customStyle');
      expect(style(id)).not.toContain('<w:qFormat/>');
    }
    // the run has the style's look from the style (no colour or underline of its own); the style keeps its theme colour
    const own = /<w:rStyle w:val="Hyperlink"\/>((?:(?!<\/w:rPr>).)*)<\/w:rPr><w:t[^>]*>the site/.exec(doc);
    expect(own).not.toBeNull();
    expect(own![1]).not.toMatch(/<w:color|<w:u /);
    expect(style('Hyperlink')).toContain('w:themeColor="hyperlink"');
    // Word's own: not one to delete in the Styles pane
    expect(t.charStyles?.Hyperlink?.custom).toBeFalsy();
    // and read again: the same
    const again = (await readDocx(zipSync(files))).doc as DocText;
    expect(again.runs.find((r) => r.text === 'the site')).toMatchObject({ cstyle: 'Hyperlink', link: 'https://example.org/' });
    expect(again.runs.find((r) => r.text === 'the page seen')).toMatchObject({ cstyle: 'FollowedHyperlink' });
  });

  /** The document saved and opened again, and the run with this text in it. */
  const reread = async (t: DocText, text: string) => (await readDocx(await writeDocx(t, deps))).doc.runs.find((r: TextRun) => r.text.includes(text))!;

  it('are left by text typed just after a link, after a save too', async () => {
    const t = (await readDocx(docx())).doc as DocText;
    const at = rt.plainText(t.runs).indexOf('the site') + 'the site'.length;
    const runs = rt.replaceRange(t.runs, at, at, [{ ...rt.typingStyle(t.runs, at, at, {}), text: ' typed' }]);
    const typed = runs.find((r) => r.text.includes('typed'))!;
    expect(typed.cstyle).toBeUndefined();
    const back = await reread({ ...t, runs }, 'typed');
    expect(back.cstyle).toBeUndefined();
    expect(back.link).toBeUndefined();
    expect(back.color).toBeUndefined();
    expect(back.underline).toBeFalsy();
  });

  it('are taken off with the link (Remove Link), after a save too', async () => {
    const t = (await readDocx(docx())).doc as DocText;
    const from = rt.plainText(t.runs).indexOf('the site');
    const runs = removeLink(t.runs, from, from + 'the site'.length);
    const back = await reread({ ...t, runs }, 'the site');
    expect(back.cstyle).toBeUndefined();
    expect(back.link).toBeUndefined();
    expect(back.color).toBeUndefined();
    expect(back.underline).toBeFalsy();
  });
});
