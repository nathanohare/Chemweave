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
  'W-FLD-22': { finding: 'F-W-016', note: 'a table of figures field (TOC \\c "Figure") in the middle of a paragraph is moved into a paragraph of its own, styled Table of Figures, and marked dirty' },
  'W-FLD-24': { finding: 'F-W-016', note: 'an INDEX field in the middle of a paragraph is moved into a paragraph of its own, styled Index 1, with \\z "1033" added, and marked dirty' },
};
