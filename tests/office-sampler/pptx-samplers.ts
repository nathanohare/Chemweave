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
  // fills, lines, effects
  'pptx-format.pptx:second-save': { scope: /^ppt\/tags\/tag\d+\.xml:/, finding: 'F-P-010', note: TAGS },
  // objects
  'pptx-objects.pptx:second-save': { scope: /^ppt\/tags\/tag\d+\.xml:/, finding: 'F-P-001', note: TAGS },
  'P-TBL-12': { finding: 'F-P-013', note: 'table cell borders of 2 pt (lnL/lnR/lnT/lnB w="25400") are saved as w="15240" (1.2 pt)' },
  // slide show
  'pptx-show.pptx:second-save': { scope: /^ppt\/tags\/tag\d+\.xml:/, finding: 'F-P-015', note: TAGS },
};
