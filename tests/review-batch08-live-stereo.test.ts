// @vitest-environment jsdom
// Review batch 08, F403: labels worked out from a structure as it was before an edit made while
// the engine was busy are not shown on the edited structure, not even for a moment.
import { beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { Doc } from '../src/model';
import { stereoTags } from '../src/chem/stereo';
import { LiveStereo, type StereoJob } from '../src/chem/live-stereo';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let RDKit: any;
beforeAll(async () => { RDKit = await createRequire(import.meta.url)('@rdkit/rdkit')(); }, 30000);

const L = 14.4;

describe('live stereo labels', () => {
  it('skips a result for a structure edited while it was worked out', async () => {
    // CHFClBr drawn with F up, Cl lower left and Br lower right on a wedge: (R) as drawn, (S) with
    // the wedge hashed (CIP priorities Br > Cl > F > H, IUPAC 2013 Recommendations P-92.1; seen with
    // H at the back, Br → Cl → F runs clockwise)
    const doc = new Doc();
    let c = 0, wedge = 0;
    doc.bulk(() => {
      const ca = doc.addAtom(0, 0, 6);
      const f = doc.addAtom(0, -L, 9), cl = doc.addAtom(-L * 0.866, L / 2, 17), br = doc.addAtom(L * 0.866, L / 2, 35);
      doc.addBond(ca.id, f.id); doc.addBond(ca.id, cl.id);
      wedge = doc.addBond(ca.id, br.id, 1, 'wedge').id;
      c = ca.id;
    });
    let first = true;
    const live = new LiveStereo(doc, async (jobs: StereoJob[]) => {
      const out = jobs.map((j) => stereoTags(RDKit, j.molblock, j.skip));
      if (first) {
        // the structure is edited while the engine works on it
        first = false;
        doc.begin('flip');
        doc.updateBond(wedge, { display: 'hashWedge' });
        doc.commit();
      }
      return out;
    });
    const seen: (string | null | undefined)[] = [];
    live.onChange = () => seen.push(live.atom(c));
    await live.update();
    expect(live.atom(c)).toBe('S');
    expect(seen).not.toContain('R');
  });
});
