/** The Word samplers, and the checks on them that fail today (see tests/office-sampler/harness.ts). */
import { type Sampler, type Finding } from './kit';
import { docxText } from './docx-text';
import { docxParagraphs } from './docx-paragraphs';
import { docxStylesLists } from './docx-styles-lists';
import { docxTables } from './docx-tables';
import { docxSections } from './docx-sections';
import { docxFieldsNotes } from './docx-fields-notes';
import { docxObjects } from './docx-objects';

export const DOCX_SAMPLERS: Sampler[] = [docxText, docxParagraphs, docxStylesLists, docxTables, docxSections, docxFieldsNotes, docxObjects];

export const DOCX_FINDINGS: Record<string, Finding> = {
};
