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
  'W-CHR-79': { finding: 'F-W-002', note: 'the Hyperlink character style is flattened into direct formatting (color and underline); w:rStyle is gone' },
  'W-PAR-75': { finding: 'F-W-006', note: 'the paragraph mark\'s run properties (w:pPr/w:rPr) are dropped' },
  'W-STY-06': { finding: 'F-W-007', note: 'a basedOn chain is flattened: Sampler Leaf is saved based on Normal, with its ancestors\' properties copied into it' },
  'W-STY-11': { finding: 'F-W-010', note: 'a character style based on another is flattened onto Default Paragraph Font, and its dotted underline is saved as single' },
  'W-STY-12': { finding: 'F-W-011', note: 'a paragraph style\'s numbering (w:numPr in the style) is moved onto each paragraph as direct numbering and removed from the style' },
  'W-BRK-01': { finding: 'F-W-015', note: 'a page break inside a paragraph is saved as two paragraphs, the second with pageBreakBefore (looks the same; the w:br is gone)' },
  'W-FLD-22': { finding: 'F-W-016', note: 'a table of figures field (TOC \\c "Figure") in the middle of a paragraph is moved into a paragraph of its own, styled Table of Figures, and marked dirty' },
  'W-FLD-24': { finding: 'F-W-016', note: 'an INDEX field in the middle of a paragraph is moved into a paragraph of its own, styled Index 1, with \\z "1033" added, and marked dirty' },
  'docx-fields-notes.docx:second-save': { scope: /^word\/(document|styles)\.xml:/, finding: 'F-W-018', note: 'not the same file on a second save: the legacy text form field\'s bookmark (Text1) moves to the start of its paragraph, and the TOC 1 style is rewritten (uiPriority 39 and unhideWhenUsed become uiPriority 29 and qFormat, with keepNext and spacing added)' },
  'W-WRP-02': { finding: 'F-W-021', note: 'every square wrap is saved with wrapText="largest", so "text on the left only" (and bothSides) is lost' },
  'docx-styles-lists.docx:second-save': { scope: /^word\/styles\.xml:/, finding: 'F-W-012', note: 'not the same file on a second save: a style\'s empty <w:pPr></w:pPr> comes back as <w:pPr/> (the list style\'s, whose numPr was dropped)' },
};
