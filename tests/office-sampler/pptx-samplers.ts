/** The PowerPoint samplers, and the checks on them that fail today (see tests/office-sampler/harness.ts). */
import { type Sampler, type Finding } from './kit';
import { pptxText } from './pptx-text';
import { pptxMasters } from './pptx-masters';
import { pptxShapes } from './pptx-shapes';
import { pptxFormat } from './pptx-format';
import { pptxObjects } from './pptx-objects';
import { pptxShow } from './pptx-show';

export const PPTX_SAMPLERS: Sampler[] = [pptxMasters, pptxText, pptxShapes, pptxFormat, pptxObjects, pptxShow];

/** Chemweave's own tags differ between two saves of the same file (see F-P-001). */
const TAGS = 'the second save differs only in Chemweave\'s own tag parts (ppt/tags/*.xml, CHEMILLUSTRATOR_TEXT/SHAPE/GEO): unrounded caption positions (y 75.10000000000001 against 75.1), the shape JSON\'s key order ("kind" first, then not) and the shapes\' sid numbers';

export const PPTX_FINDINGS: Record<string, Finding> = {
  // masters, layouts, presentation
  'pptx-masters.pptx:second-save': { scope: /^ppt\/tags\/tag\d+\.xml:/, finding: 'F-P-001', note: TAGS },
  'P-MST-48': { finding: 'F-P-003', note: 'slide size A4 (sldSz cx 10692000, cy 7560000) is saved as cx 10693400, cy 7556500 (rounded to whole points, 842 × 595 pt); type="A4" is kept' },
  // text
  'pptx-text.pptx:second-save': { scope: /^ppt\/tags\/tag\d+\.xml:/, finding: 'F-P-001', note: TAGS },
  // shapes
  'pptx-shapes.pptx:second-save': { scope: /^ppt\/tags\/tag\d+\.xml:/, finding: 'F-P-005', note: TAGS },
  'P-GEO-68': { finding: 'F-P-007', note: 'a roundRect with <a:gd name="adj" fmla="val 30000"/> is saved with an empty <a:avLst/>: the corner size goes back to the default 16667' },
  'P-CXN-04': { finding: 'F-P-008', note: 'every line or connector with an arrowhead is saved as an arrow named "Straight Arrow Connector N": its cNvPr name (with the item id) is lost, so the item cannot be found again (its tailEnd triangle is written)' },
  'P-CXN-05': { finding: 'F-P-008', note: 'arrow connector saved as "Straight Arrow Connector N" (name lost; see F-P-008)' },
  'P-CXN-06': { finding: 'F-P-008', note: 'arrow connector saved as "Straight Arrow Connector N" (name lost); the head-end-only arrowhead is written as a tailEnd with the ends swapped' },
  'P-CXN-07': { finding: 'F-P-008', note: 'arrow connector saved as "Straight Arrow Connector N" (name lost; see F-P-008)' },
  'P-CXN-08': { finding: 'F-P-008', note: 'arrow connector saved as "Straight Arrow Connector N" (name lost); tailEnd type="arrow" is written' },
  'P-CXN-17': { finding: 'F-P-008', note: 'a flipped arrow connector is saved as "Straight Arrow Connector N" (name lost; see F-P-008)' },
  'P-GRP-02': { finding: 'F-P-009', note: 'a group\'s own name ("P-GRP-02 named group") is saved as "Group N"; every grpSp is renamed' },
  // fills, lines, effects
  'pptx-format.pptx:second-save': { scope: /^ppt\/tags\/tag\d+\.xml:/, finding: 'F-P-010', note: TAGS },
  'P-LIN-15': { finding: 'F-P-011', note: 'a plain box (no text) with prstDash sysDot (Round Dot) and a 3 pt outline is saved with prstDash "dash" and w="15240" (1.2 pt)' },
  // objects
  'pptx-objects.pptx:second-save': { scope: /^ppt\/(tags\/tag\d+\.xml|slides\/slide\d+\.xml|embeddings\/Microsoft_Excel_Worksheet\d+\.xlsx):/, finding: 'F-P-012', note: 'the second save moves the linked picture (P-LNK-20) to the back of the links slide (first in spTree), so the slide\'s relationships are numbered differently; the embedded chart workbooks (ppt/embeddings/Microsoft_Excel_Worksheet*.xlsx) carry a new docProps/core.xml time each save; and the tag parts differ as in F-P-001' },
  'P-TBL-12': { finding: 'F-P-013', note: 'table cell borders of 2 pt (lnL/lnR/lnT/lnB w="25400") are saved as w="15240" (1.2 pt)' },
  'P-LNK-20': { finding: 'F-P-014', note: 'a hyperlink on a picture (cNvPr hlinkClick to https://example.com/picture) is saved without it: <p:cNvPr id="22" name="P-LNK-20 linked picture"/>' },
  // slide show
  'pptx-show.pptx:second-save': { scope: /^ppt\/tags\/tag\d+\.xml:/, finding: 'F-P-015', note: TAGS },
};
