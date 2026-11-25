/** The Excel samplers, and the checks on them that fail today (see tests/office-sampler/harness.ts). */
import { type Sampler, type Finding } from './kit';
import { xlsxNumbers, xlsxDates1904 } from './xlsx-numbers';
import { xlsxCells } from './xlsx-cells';
import { xlsxLayout } from './xlsx-layout';
import { xlsxFormulas } from './xlsx-formulas';
import { xlsxData } from './xlsx-data';
import { xlsxCf } from './xlsx-cf';
import { xlsxNotes } from './xlsx-notes';
import { xlsxObjects } from './xlsx-objects';
import { xlsxPrint } from './xlsx-print';

export const XLSX_SAMPLERS: Sampler[] = [xlsxNumbers, xlsxDates1904, xlsxCells, xlsxLayout, xlsxFormulas, xlsxData, xlsxCf, xlsxNotes, xlsxObjects, xlsxPrint];

export const XLSX_FINDINGS: Record<string, Finding> = {
  'xlsx-layout.xlsx:second-save': { scope: /^(xl\/worksheets\/sheet\d+\.xml|customXml\/item1\.xml):/, finding: 'F-X-004', note: 'row 7, which Excel fitted to its wrapped text (ht="45" without customHeight): the first save writes <row r="7" ht="45" customHeight="1"> and lists it in autoRows of customXml/item1.xml; reopening clears that height and the second save writes <row r="7"> with no height (the harness measures no row heights: deps.rowHeights)' },
};
