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

const CR = 'a carriage return in a cell\'s text is written as a raw CR ("line one\\r\\nline two") instead of _x000D_, so XML line-end handling reads it back as "line one\\nline two": the CR is gone';

export const XLSX_FINDINGS: Record<string, Finding> = {
  'xlsx-data.xlsx:integrity': { scope: /sortCondition@dxfId=/, finding: 'F-X-010', note: 'the saved workbook keeps a sort by cell color (sortState sortCondition dxfId="4", sheet "X-FLT-16 Sort color") but writes no dxfs (<dxfs count="0">), so the sort points at a format that isn\'t there and Excel refuses to open the whole file' },
  'X-RTX-15': { finding: 'F-X-002', note: CR },
  'xlsx-cells.xlsx:second-save': { scope: /^xl\/sharedStrings\.xml:/, finding: 'F-X-002', note: `xl/sharedStrings.xml: ${CR}; the second save writes "line one\\nline two"` },
  'X-LAY-18': { finding: 'F-X-003', note: 'the collapsed summary column N has no <col> in the save (L:M are written hidden with outlineLevel="1", N not at all), so its collapsed="1" is gone' },
  'xlsx-layout.xlsx:second-save': { scope: /^(xl\/worksheets\/sheet\d+\.xml|customXml\/item1\.xml):/, finding: 'F-X-004', note: 'row 7, which Excel fitted to its wrapped text (ht="45" without customHeight): the first save writes <row r="7" ht="45" customHeight="1"> and lists it in autoRows of customXml/item1.xml; reopening clears that height and the second save writes <row r="7"> with no height (the harness measures no row heights: deps.rowHeights)' },
  'X-FRM-41': { finding: 'F-X-005', note: '_xlfn.SINGLE(Data!B2:B2) inside a dynamic array formula is saved as _xlfn.SINGLE((Data!B2:B2)): read as @(…) and given another pair of brackets when written' },
  'xlsx-formulas.xlsx:second-save': { scope: /^xl\/(worksheets\/sheet\d+|workbook)\.xml:/, finding: 'F-X-005', note: 'B41: each save adds another pair of brackets inside SINGLE (_xlfn.SINGLE((…)), then _xlfn.SINGLE(((…)))); also xl/workbook.xml: the second save adds fullCalcOnLoad="1" to calcPr, which the first save (of a file with Excel\'s values) left off' },
  'X-VAL-04': { finding: 'F-X-006', note: 'a formula whose value is empty text is saved with no type and no value (<c r="B46"><f>IF(TRUE,"","x")</f></c>) instead of t="str" with an empty <v>' },
  'X-TBL-12': { finding: 'F-X-007', note: 'of the 14 tables on the Tables sheet only the first keeps its <autoFilter> (its filter buttons); tables 2-14 are saved without one' },
  'xlsx-data.xlsx:second-save': { scope: /^customXml\/item1\.xml:/, finding: 'F-X-008', note: 'customXml/item1.xml: a filter\'s range is written {"r1","c1","r2","c2"} by the first save and {"r1","c1","c2","r2"} by the second (key order), so the two saves differ' },
  'xlsx-notes.xlsx:second-save': { scope: /^xl\/(comments\d+|persons\/person|threadedComments\/threadedComment\d+)\.xml:/, finding: 'F-X-009', note: 'every save makes new GUIDs for the threaded comments (id, parentId), the people (xl/persons/person.xml id, personId) and the legacy copies\' tc= author names in xl/comments1.xml, so no two saves are the same' },
};
