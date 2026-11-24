// @vitest-environment jsdom
// A figure drawn again keeps its own style. A ChemDraw drawing pasted into a figure is kept as
// CDXML with its document style (here labels of 7 pt on bonds of 10.08 pt, ACS 1996 at 70%);
// drawing it again in the project's style (10 pt labels) drew its labels too big against its
// bonds, in the drawing window and in the picture saved after (Nate, 2026-11-23).

import { describe, expect, it } from 'vitest';
import { SiPictures, type SiPictureHost } from '../src/ui/si-picture';
import { readCdxml } from '../src/io/cdxml';
import type { Contents, Doc } from '../src/model';
import type { DocStyle } from '../src/style';

// (a CDXML file's own style: the attributes on its root, as ChemDraw writes them)
const CDXML = `<?xml version="1.0" encoding="UTF-8" ?>
<CDXML BondLength="10.08" LabelSize="7" CaptionSize="7" LineWidth="0.42" BoldWidth="1.4" HashSpacing="1.75" MarginWidth="1.12" BondSpacing="18">
<page id="1"><fragment id="2">
<n id="3" p="10 10"/><n id="4" p="20.08 10"/>
<b id="5" B="3" E="4"/>
</fragment></page></CDXML>`;

function host(): { h: SiPictureHost; edits: (DocStyle | undefined)[]; saves: (DocStyle | undefined)[] } {
  const edits: (DocStyle | undefined)[] = [];
  const saves: (DocStyle | undefined)[] = [];
  const h = {
    project: {
      readSectionFile: async (_s: unknown, rel: string) => (rel === 'images/fig.cdxml' ? new TextEncoder().encode(CDXML) : null),
      addSectionPicture: async (_s: unknown, name: string) => `images/${name}`,
    },
    section: {},
    flash: () => {},
    pickFiles: async () => [],
    editStructure: (c: Contents | null, _t: string, done: (c: Contents | null) => void, style?: DocStyle) => { edits.push(style); done(c); },
    drawingFiles: (_d: Contents | Doc, style?: DocStyle) => { saves.push(style); return { svg: '<svg/>', cdxml: '<CDXML/>' }; },
    contentsOfCdxml: (text: string) => { const d = readCdxml(text).doc; return { contents: d.contents(), style: { ...d.style } }; },
    readClipboard: async () => ({ kind: 'none' }),
    pickCompound: async () => null,
    contentsOf: () => null,
  } as unknown as SiPictureHost;
  return { h, edits, saves };
}

describe('SI figure drawn again', () => {
  it('opens in the drawing’s own style and saves its picture in it', async () => {
    const { h, edits, saves } = host();
    const got = await new SiPictures(h).draw('images/fig.svg', 'Figure');
    expect(got).toBe('images/structure.svg');
    expect(edits[0]?.labelSize).toBe(7);
    expect(edits[0]?.bondLength).toBe(10.08);
    expect(saves[0]?.labelSize).toBe(7);
  });

  it('a new drawing takes the project’s style', async () => {
    const { h, edits } = host();
    let asked = false;
    (h as { editStructure: SiPictureHost['editStructure'] }).editStructure = (_c, _t, done, style) => { asked = true; edits.push(style); done(null); };
    expect(await new SiPictures(h).draw('', 'Figure')).toBeNull();
    expect(asked).toBe(true);
    expect(edits[0]).toBeUndefined();
  });
});
