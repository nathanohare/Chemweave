// @vitest-environment jsdom
//
// Fix phase F8a, item 7 (F7b-R13): a label's own "not raised" R digit wins over Settings ▸ Drawing ▸
// R numbers raised, so R1 that ChemDraw wrote on the line shows on the line here and saves on the
// line, and no settings tag is needed for it. The file is typed here in ChemDraw's CDXML layout
// (never a file ChemDraw made: CONTRIBUTING).

import { describe, it, expect } from 'vitest';
import { readCdxml } from '../src/io/cdxml';
import { writeCdxml } from '../src/io/cdxml-write';
import { labelLook, labelPieces, labelPrefs } from '../src/chem/labels';
import { MORE_TAG } from '../src/io/cdxml-more';
import { Doc } from '../src/model';

const FLAT_R1 = '<?xml version="1.0" encoding="UTF-8" ?><CDXML LabelFont="3" LabelSize="10" LabelFace="96"><fonttable><font id="3" name="Arial"/></fonttable><page id="1"><fragment id="2">'
  + '<n id="3" p="50 50" NodeType="GenericNickname" GenericNickname="R1"><t id="4" p="46 54"><s font="3" size="10" face="96">R1</s></t></n><n id="5" p="62 57"/>'
  + '<b id="6" B="3" E="5"/></fragment></page></CDXML>';

describe('an R digit ChemDraw wrote on the line', () => {
  it('shows on the line while R numbers raised is on', () => {
    expect(labelPrefs.superscriptR).toBe(true);
    const a = [...readCdxml(FLAT_R1).doc.atoms.values()].find((x) => x.label === 'R1')!;
    expect(a.supDigits).toBe(false);
    expect(labelPieces('R1', labelLook(a).supDigits).filter((p) => p.sup)).toEqual([]);
  });
  it('saves on the line, with no settings tag', () => {
    const xml = writeCdxml(readCdxml(FLAT_R1).doc);
    expect(xml).toMatch(/face="96">R1<\/s>/);
    expect(xml).not.toContain(MORE_TAG);
  });
  // (review F8a-R07: an R number inside a longer label, as ChemDraw writes OR1 and CO2R1 on the line)
  const labelled = (text: string) => FLAT_R1.replace('NodeType="GenericNickname" GenericNickname="R1"', '').replace('face="96">R1<', `face="96">${text}<`);
  for (const text of ['OR1', 'CO2R1']) {
    it(`${text} on the line shows and saves on the line, with no settings tag`, () => {
      const d = readCdxml(labelled(text)).doc;
      const a = [...d.atoms.values()].find((x) => x.label === text)!;
      expect(a.supDigits, text).toBe(false);
      expect(labelPieces(text, labelLook(a).supDigits).filter((p) => p.sup)).toEqual([]);
      const xml = writeCdxml(d);
      expect(xml).not.toContain(MORE_TAG);
      expect(readCdxml(xml).doc.atoms.size).toBe(2);
      expect([...readCdxml(xml).doc.atoms.values()].find((x) => x.label === text)!.supDigits).toBe(false);
    });
  }
  it('a label drawn here (no choice of its own) still follows the setting, raised, with no tag', () => {
    const d = new Doc();
    d.bulk(() => { const a = d.addAtom(0, 0, 6, { label: 'R1' }), b = d.addAtom(14.4, 0); d.addBond(a.id, b.id); });
    const xml = writeCdxml(d);
    expect(xml).toMatch(/>R<\/s><s [^>]*face="(?:64|96|32)"[^>]*>1<\/s>|>R<\/s><s[^>]*>1<\/s>/);
    expect(xml).not.toContain(MORE_TAG);
  });
});
