// @vitest-environment jsdom
//
// Word's non-breaking hyphen (ECMA-376 Part 1, §17.3.3.18 noBreakHyphen; Ctrl+Shift+-) is read as
// U+2011 and written back as w:noBreakHyphen (F-W-003: it was written as the character in w:t).

import { describe, it, expect } from 'vitest';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { readDocx, writeDocx, type DocxDeps } from '../src/io/docx';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const deps: DocxDeps = { async picture() { return { png: PNG, w: 10, h: 10 }; }, async svgToPng() { return PNG; } };
const wordFile = (body: string) => zipSync({
  '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>'),
  '_rels/.rels': strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}officeDocument" Target="word/document.xml"/></Relationships>`),
  'word/document.xml': strToU8(`<?xml version="1.0"?><w:document ${W}><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body></w:document>`),
});

describe('a non-breaking hyphen (F-W-003)', () => {
  it('is saved as Word\'s own element, through two saves', async () => {
    let { doc } = await readDocx(wordFile('<w:p><w:r><w:t>2</w:t><w:noBreakHyphen/><w:t>methyl and constructor</w:t></w:r></w:p>'));
    for (let i = 0; i < 2; i++) {
      const saved = await writeDocx(doc, deps);
      const xml = strFromU8(unzipSync(saved)['word/document.xml']);
      expect(xml).toMatch(/<w:t xml:space="preserve">2<\/w:t><w:noBreakHyphen\/><w:t xml:space="preserve">methyl and constructor<\/w:t>/);
      expect(xml).not.toContain('\u2011');
      ({ doc } = await readDocx(saved));
    }
  });
});

describe('a non-breaking hyphen in a header and a comment (from the review)', () => {
  const file = () => zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>'),
    '_rels/.rels': strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}officeDocument" Target="word/document.xml"/></Relationships>`),
    'word/_rels/document.xml.rels': strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rH" Type="${R}header" Target="header1.xml"/><Relationship Id="rC" Type="${R}comments" Target="comments.xml"/></Relationships>`),
    'word/header1.xml': strToU8(`<?xml version="1.0"?><w:hdr ${W}><w:p><w:r><w:t>Smith</w:t><w:noBreakHyphen/><w:t>Jones</w:t></w:r></w:p></w:hdr>`),
    'word/comments.xml': strToU8(`<?xml version="1.0"?><w:comments ${W}><w:comment w:id="0" w:author="Nate" w:date="2026-11-25T00:00:00Z"><w:p><w:r><w:t>see 2</w:t><w:noBreakHyphen/><w:t>methyl</w:t></w:r></w:p></w:comment></w:comments>`),
    'word/document.xml': strToU8(`<?xml version="1.0"?><w:document ${W} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p><w:commentRangeStart w:id="0"/><w:r><w:t>Body</w:t></w:r><w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r></w:p><w:sectPr><w:headerReference w:type="default" r:id="rH"/><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body></w:document>`),
  });
  it('keeps them through two saves', async () => {
    let { doc } = await readDocx(file());
    for (let i = 0; i < 2; i++) {
      const saved = unzipSync(await writeDocx(doc, deps));
      const header = Object.entries(saved).find(([p]) => /^word\/header\d+\.xml$/.test(p))!;
      expect(strFromU8(header[1])).toMatch(/Smith<\/w:t><w:noBreakHyphen\/><w:t[^>]*>Jones/);
      expect(strFromU8(saved['word/comments.xml'])).toMatch(/see 2<\/w:t><w:noBreakHyphen\/><w:t[^>]*>methyl/);
      ({ doc } = await readDocx(zipSync(saved)));
    }
  });
});
