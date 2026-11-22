// @vitest-environment jsdom
//
// CDX properties this program doesn't know are kept when a CDX file is opened and saved as CDX
// again (audit G1-08). The CDX is written here from CDXML, with a property spliced in after the
// file header as CambridgeSoft's CDX format documentation lays properties out (2-byte tag,
// 2-byte length, data); 0x0BB4 is one of the document properties ChemDraw 25 writes that this
// program has no name for. The bytes are made up.

import { describe, it, expect } from 'vitest';
import { Doc } from '../src/model';
import { cdxmlToCdx, cdxToCdxml } from '../src/io/cdx';
import { readCdxml } from '../src/io/cdxml';
import { writeCdxml } from '../src/io/cdxml-write';

const HEADER = 28;
const DATA = [0x46, 0x6f, 0x72, 0x6d, 0x75, 0x6c, 0x61, 0x3a]; // "Formula:"

/** A CDX file of one ethane with an unknown document property in it. */
function cdxWithUnknown(): Uint8Array {
  const d = new Doc();
  d.bulk(() => { const a = d.addAtom(0, 0), b = d.addAtom(14, 0); d.addBond(a.id, b.id); });
  const cdx = cdxmlToCdx(writeCdxml(d, { name: 't.cdxml' }));
  const prop = [0xb4, 0x0b, DATA.length, 0, ...DATA];
  const out = new Uint8Array(cdx.length + prop.length);
  out.set(cdx.subarray(0, HEADER), 0);
  out.set(prop, HEADER);
  out.set(cdx.subarray(HEADER), HEADER + prop.length);
  return out;
}

const holds = (bytes: Uint8Array) => {
  const want = [0xb4, 0x0b, DATA.length, 0, ...DATA];
  for (let i = 0; i + want.length <= bytes.length; i++) if (want.every((x, k) => bytes[i + k] === x)) return true;
  return false;
};

describe('CDX properties not known here (G1-08)', () => {
  it('are kept from CDX to CDXML and back', () => {
    const xml = cdxToCdxml(cdxWithUnknown());
    expect(xml).toContain('ChemIllustratorCdx0BB4="466F726D756C613A"');
    expect(holds(cdxmlToCdx(xml))).toBe(true);
  });
  it('are kept when the file is opened and saved as CDX, changed or not', () => {
    const { doc } = readCdxml(cdxToCdxml(cdxWithUnknown()));
    expect(holds(cdxmlToCdx(writeCdxml(doc, { name: 't.cdx', cdx: true })))).toBe(true);
    doc.edit('Add', () => { doc.addAtom(28, 0); });
    expect(holds(cdxmlToCdx(writeCdxml(doc, { name: 't.cdx', cdx: true })))).toBe(true);
  });
  it('are left out of a CDXML file, where they mean nothing to ChemDraw', () => {
    const { doc } = readCdxml(cdxToCdxml(cdxWithUnknown()));
    expect(writeCdxml(doc, { name: 't.cdxml' })).not.toContain('ChemIllustratorCdx');
  });
});
