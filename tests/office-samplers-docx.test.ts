// @vitest-environment jsdom
//
// The Word samplers (tests/office-sampler/docx-*.ts): files built here in code, each sampling one
// area of the format item by item, checked as built, after Chemweave's open and save, and after a
// second save. What is checked, and how findings are kept, is in tests/office-sampler/harness.ts.
// OFFICE_SAMPLER_OUT=<folder> writes them out for the comparison in Office (docs/developers.md).

import { vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: async () => { throw new Error('no disk here'); } }));

import { samplerSuite } from './office-sampler/harness';
import { DOCX_SAMPLERS, DOCX_FINDINGS } from './office-sampler/docx-samplers';

samplerSuite('docx', DOCX_SAMPLERS, DOCX_FINDINGS);
