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
};
