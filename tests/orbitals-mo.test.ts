import { describe, expect, it } from 'vitest';
import { MO_ATOMS, MO_MOLECULES, MO_TWO_ATOMS, fromMolecule, moMolecule, setMolecule, drawMo, electronLook, electronsFree, fillElectrons, fillProblems, fitWidth, fromAtoms, fromChoices, fromOf, fromValue, MO_CUSTOM, moCaptionRoles, moColumnAt, moEnergyAt, moLevelAt, moSides, nextElectrons, setSides, withLevel, hund, moCounts, roomBeside, mixOf, moPlain, parseMarkup, sources, toMarkup, toRelative, toRich, type MoSpec } from '../src/design/mo';
import { orbitalShapes } from '../src/chem/orbitals';
import { Doc } from '../src/model';
import { ACS_1996 } from '../src/style';
import { POINTS } from '../src/editor/arrange';
import { newPlate, putPlate } from '../src/design/plates';

describe('orbitals', () => {
  it('draws a p orbital as two lobes meeting at the atom, one each way', () => {
    const [back, front] = orbitalShapes({ kind: 'p', look: 'shaded', angle: 0, size: 20 }, { x: 100, y: 100 });
    expect(front.geo).toBe('orbLobe');
    // the front lobe above the atom, the back one below (turned half round)
    expect((front.y1 + front.y2) / 2).toBeCloseTo(90);
    expect((back.y1 + back.y2) / 2).toBeCloseTo(110);
    expect(back.rot).toBe(180);
    expect(front.fillColor).not.toBe(back.fillColor);
  });

  it('draws hybrids with a small back lobe, d orbitals with four', () => {
    const sp3 = orbitalShapes({ kind: 'sp3', look: 'colour', angle: 90, size: 20 }, { x: 0, y: 0 });
    expect(sp3[0].x2 - sp3[0].x1).toBeLessThan(sp3[1].x2 - sp3[1].x1);
    expect(orbitalShapes({ kind: 'd', look: 'outline', angle: 0, size: 20 }, { x: 0, y: 0 }).length).toBe(4);
    expect(orbitalShapes({ kind: 'dz2', look: 'shaded', angle: 0, size: 20 }, { x: 0, y: 0 })[0].kind).toBe('oval');
  });
});

describe('MO diagrams', () => {
  it('fills levels by Hund\'s rule', () => {
    expect(hund(3, 4)).toEqual([2, 1, 1]);
    expect(hund(2, 2)).toEqual([1, 1]);
    expect(hund(1, 3)).toEqual([2]);
    expect(hund(2, 0)).toEqual([0, 0]);
  });

  it('joins a molecular orbital to the atomic orbitals it is made from', () => {
    const n2 = fromAtoms('N', 'N')!;
    const sigma = n2.levels.find((l) => moPlain(l.label) === 'σ2s')!;
    expect(sources(n2.levels, sigma).map((l) => l.column)).toEqual(['left', 'right']);
  });

  it('draws one in a frame that keeps its levels', () => {
    const doc = new Doc();
    doc.style = { ...ACS_1996 };
    let id = 0;
    doc.edit('MO', () => { id = putPlate(doc, POINTS, newPlate('mo', doc.style.bondLength), { x: 0, y: 0 }); });
    const f = doc.shapes.get(id)!;
    expect(f.plate?.kind).toBe('mo');
    // H2: four levels (one line each) and four dashed lines
    const lines = f.frame!.shapes.map((s) => doc.shapes.get(s)!).filter((s) => s.kind === 'line');
    expect(lines.filter((s) => s.dashed).length).toBe(4);
    expect(lines.filter((s) => !s.dashed).length).toBe(4);
  });

  it('keeps names as rich text that reads back the same', () => {
    const parts = [{ text: 'σ' }, { text: '*', sup: true }, { text: '2s', sub: true }, { text: ' a_b^c\\' }];
    expect(parseMarkup(toMarkup(parts))).toEqual(parts);
    expect(parseMarkup('σ^*_{2p}')).toEqual([{ text: 'σ' }, { text: '*', sup: true }, { text: '2p', sub: true }]);
    expect(moPlain('φ_{A}')).toBe('φA');
  });

  it('turns an older diagram into rich text that draws the same', () => {
    const old = { titles: ['N', 'N_2', 'H2O'] as [string, string, string], axis: true, levels: [
      { column: 'left' as const, label: 'φ_A', e: 0, n: 1, electrons: 1 },
      { column: 'middle' as const, label: 'σ_{2s}', e: -1, n: 1, electrons: 2, from: 'φ_A' },
    ] };
    const rich = toRich(old);
    expect(rich.rich).toBe(true);
    expect(parseMarkup(rich.titles[1])).toEqual([{ text: 'N' }, { text: '2', sub: true }]);
    expect(parseMarkup(rich.titles[2])).toEqual([{ text: 'H' }, { text: '2', sub: true }, { text: 'O' }]);
    expect(sources(rich.levels, rich.levels[1]).length).toBe(1);
    // the older form still finds its atomic orbitals
    expect(sources(old.levels, old.levels[1]).length).toBe(1);
  });

  it('works out how each molecular orbital mixes', () => {
    const n2 = fromAtoms('N', 'N')!;
    const mix = (name: string) => mixOf(n2.levels, n2.levels.find((l) => moPlain(l.label) === name)!);
    expect(mix('σ2s')).toEqual({ left: 's', right: 's', sym: 'σ', bonding: true });
    expect(mix('σ*2s')).toEqual({ left: 's', right: 's', sym: 'σ', bonding: false });
    expect(mix('π2p')).toEqual({ left: 'p', right: 'p', sym: 'π', bonding: true });
    expect(mix('σ*2p')).toEqual({ left: 'p', right: 'p', sym: 'σ', bonding: false });
    // a hybrid with a p orbital, and HF's nonbonding F orbitals (one side only)
    const cf = fromAtoms('sp3', '2p')!;
    expect(mixOf(cf.levels, cf.levels.find((l) => l.column === 'middle')!)).toEqual({ left: 'sp3', right: 'p', sym: 'σ', bonding: true });
    const hf = fromAtoms('H', 'F')!;
    expect(mixOf(hf.levels, hf.levels.find((l) => moPlain(l.label) === 'π')!)).toEqual({ left: null, right: 'p', sym: 'π', bonding: true });
    // no σ or π in the name: above the atomic orbitals is out of phase
    const blank: MoSpec = { titles: ['A', 'AB', 'B'], axis: true, rich: true, relative: true, levels: [
      { column: 'left', label: 'φ_{A}', e: 0.62, n: 1, electrons: 1 }, { column: 'right', label: 'φ_{B}', e: 0.31, n: 1, electrons: 1 },
      { column: 'middle', label: 'ψ_{1}', e: 0, n: 1, electrons: 2, from: 'φA, φB' }, { column: 'middle', label: 'ψ_{2}', e: 1, n: 1, electrons: 0, from: 'φA, φB' },
    ] };
    expect(blank.levels.filter((l) => l.column === 'middle').map((l) => mixOf(blank.levels, l)?.bonding)).toEqual([true, false]);
  });

  it('draws the mixing pictures and sized electrons when asked', () => {
    const doc = new Doc();
    doc.style = { ...ACS_1996 };
    const plate = newPlate('mo', doc.style.bondLength);
    const plain = new Doc();
    plain.style = { ...ACS_1996 };
    let a = 0, b = 0;
    plain.edit('MO', () => { a = putPlate(plain, POINTS, plate, { x: 0, y: 0 }); });
    doc.edit('MO', () => { b = putPlate(doc, POINTS, { ...plate, mo: { ...plate.mo!, pictures: true, arrowSize: 14 } }, { x: 0, y: 0 }); });
    const shapes = (d: Doc, id: number) => d.shapes.get(id)!.frame!.shapes.length;
    // H2: two s spheres, one merged σ and two spheres for σ*
    expect(shapes(doc, b) - shapes(plain, a)).toBe(5);
    // H2's electrons: one arrow on each atom, a pair in σ, all 14 pt tall (the energy arrow is the other)
    const arrows = doc.shapes.get(b)!.frame!.arrows.map((a) => doc.arrows.get(a)!).filter((a) => a.tail.x === a.head.x && Math.abs(a.tail.y - a.head.y) < 20);
    expect(arrows.length).toBe(4);
    expect(arrows.every((a) => Math.abs(Math.abs(a.tail.y - a.head.y) - 14) < 1e-6)).toBe(true);
  });

  it('grows and shrinks the electrons with the diagram', () => {
    const style = { captionSize: 10, lineWidth: 0.6, bondLength: 14.4 };
    const spec = fromAtoms('H', 'H')!;
    const at = electronLook(spec, style, 14 * 14.4, 12 * 14.4);
    expect(at.tall).toBeCloseTo(10);
    expect(electronLook(spec, style, 28 * 14.4, 24 * 14.4).tall).toBeCloseTo(20);
    // set at one size, they keep their proportion when it changes
    const set = { ...spec, arrowSize: 12, arrowWidth: 1, arrowGap: 2, arrowAt: 100 };
    expect(electronLook(set, style, 100, 100)).toEqual({ tall: 12, thick: 1, lift: 2 });
    expect(electronLook(set, style, 50, 50)).toEqual({ tall: 6, thick: 0.5, lift: 1 });
  });

  it('measures the room beside the molecule only against levels it could crowd', () => {
    const mid = [{ x1: 100, y1: 0, x2: 140, y2: 10 }];
    // a level right beside it counts by its sideways gap
    expect(roomBeside(mid, [{ x1: 40, y1: 2, x2: 90, y2: 8 }], [])).toBe(10);
    // one far below it is not crowding it, however close it is sideways
    expect(roomBeside(mid, [{ x1: 40, y1: 100, x2: 98, y2: 106 }], [])).toBeCloseTo(Math.hypot(2, 90), 6);
    // overlapping is negative
    expect(roomBeside(mid, [], [{ x1: 130, y1: 0, x2: 160, y2: 10 }])).toBe(-10);
    expect(roomBeside([], [{ x1: 0, y1: 0, x2: 1, y2: 1 }], [])).toBeUndefined();
  });

  it('finds the width that leaves the room asked for', () => {
    // room grows a quarter as fast as the width here, and is 10 at 200
    const w = fitWidth((x) => 10 + (x - 200) / 4, 200, 25);
    expect(w).toBeCloseTo(260, 0);
    expect(fitWidth(() => undefined, 200, 25)).toBe(200);
  });

  it('keeps energies as relative positions, 0 at the bottom and 1 at the top', () => {
    for (const [a, b] of [['H', 'H'], ['N', 'N'], ['C', 'O'], ['H', 'F'], ['sp3', 'F'], ['2p', '2p']]) {
      const spec = fromAtoms(a, b)!, es = spec.levels.map((l) => l.e);
      expect(spec.relative, a + b).toBe(true);
      expect(Math.min(...es), a + b).toBe(0);
      expect(Math.max(...es), a + b).toBe(1);
    }
    // a level at 0.25 is drawn a quarter of the way up the box, whatever the other levels are
    const doc = new Doc();
    doc.style = { ...ACS_1996 };
    const spec: MoSpec = { titles: ['', '', ''], axis: false, rich: true, relative: true, levels: [{ column: 'left', label: '', e: 0.25, n: 1, electrons: 0 }] };
    let ids: number[] = [];
    doc.edit('MO', () => { ids = drawMo(doc, POINTS, spec, { x: 0, y: 100 }, 200, 80).shapes; });
    expect(doc.shapes.get(ids[0])!.y1).toBeCloseTo(100 + 0.75 * 80);
  });

  it('opens a diagram saved with energies in other units, drawn where it was', () => {
    const old: MoSpec = { titles: ['H', 'H_{2}', 'H'], axis: false, rich: true, levels: [
      { column: 'left', label: '1s', e: -13.6, n: 1, electrons: 1 }, { column: 'right', label: '1s', e: -13.6, n: 1, electrons: 1 },
      { column: 'middle', label: 'σ', e: -18.4, n: 1, electrons: 2, from: '1s' }, { column: 'middle', label: 'σ^{*}', e: -7.6, n: 1, electrons: 0, from: '1s' },
    ] };
    const now = toRelative(old);
    expect(now.levels.map((l) => l.e)).toEqual([0.444, 0.444, 0, 1]);
    expect(toRelative(now)).toBe(now);
    const ys = (spec: MoSpec) => {
      const doc = new Doc();
      doc.style = { ...ACS_1996 };
      let ids: number[] = [];
      doc.edit('MO', () => { ids = drawMo(doc, POINTS, spec, { x: 0, y: 0 }, 200, 170).shapes; });
      return ids.map((i) => doc.shapes.get(i)!).map((s) => [s.y1, s.y2]).flat();
    };
    const a = ys(old), b = ys(now);
    expect(b.length).toBe(a.length);
    // to within the rounding of the positions (a thousandth of the height)
    a.forEach((y, i) => expect(Math.abs(y - b[i])).toBeLessThan(0.1));
    // every level at one energy was drawn in the middle
    expect(toRelative({ ...old, levels: old.levels.map((l) => ({ ...l, e: 3 })) }).levels.every((l) => l.e === 0.5)).toBe(true);
  });

  it('fills a diagram from two atoms', () => {
    // Bond orders and unpaired electrons: "Homonuclear Diatomic Molecules", LibreTexts Inorganic
    // Chemistry (after Miessler, Fischer and Tarr, Inorganic Chemistry, 5th ed., Pearson 2014),
    // https://chem.libretexts.org/Courses/Centre_College/CHE_332%3A_Inorganic_Chemistry/04%3A_Molecular_Orbitals/4.02%3A_Molecular_Orbital_Theory_of_Diatomic_Molecules/4.2.02%3A_Homonuclear_Diatomic_Molecules
    // B2 [σ(2s)² σ*(2s)² π(2p)²] bond order 1, paramagnetic; C2 bond order 2; N2 bond order 3;
    // O2 bond order 2 with two unpaired electrons; F2 bond order 1.
    const order = (a: string, b = a, e?: number) => moCounts(fromAtoms(a, b, e)!.levels);
    // the same page: H2 bond order 1, He2 0, Li2 1, Be2 0; B2's π(2p)² is one electron in each of the two π orbitals (paramagnetic)
    expect([order('H').bondOrder, order('He').bondOrder, order('Li').bondOrder, order('Be').bondOrder]).toEqual([1, 0, 1, 0]);
    expect(order('B')).toMatchObject({ bondOrder: 1, unpaired: 2 });
    expect(order('C').bondOrder).toBe(2);
    expect(order('N').bondOrder).toBe(3);
    expect(order('O')).toMatchObject({ bondOrder: 2, unpaired: 2 });
    expect(order('F').bondOrder).toBe(1);
    // the same page: π(2p) below σ(2p) up to and including N2, σ(2p) below π(2p) from O2 on
    const at = (a: string, name: string) => fromAtoms(a, a)!.levels.find((l) => moPlain(l.label) === name)!.e;
    for (const a of ['B', 'C', 'N']) expect(at(a, 'π2p'), a).toBeLessThan(at(a, 'σ2p'));
    for (const a of ['O', 'F']) expect(at(a, 'σ2p'), a).toBeLessThan(at(a, 'π2p'));
    // as many molecular orbitals as atomic orbitals, and the electrons the atoms gave
    for (const [a, b] of [['N', 'N'], ['C', 'O'], ['H', 'F'], ['F', 'H'], ['H', 'H'], ['H', 'He']]) {
      const c = moCounts(fromAtoms(a, b)!.levels);
      expect(c.moOrbitals, a + b).toBe(c.atomOrbitals);
      expect(c.moElectrons, a + b).toBe(c.atomElectrons);
    }
    // the electrons can be set: one more or fewer than the atoms' (an ion), never more than there is room for
    expect(order('O', 'O', 13).moElectrons).toBe(13);
    expect(order('H', 'H', 9).moElectrons).toBe(4);
    // "Heteronuclear Diatomic Molecules" (same book and site, 4.2.03): in HF the F 2s and two F 2p
    // orbitals are nonbonding, and H 1s with F 2p makes σ and σ*: one bond
    const hf = fromAtoms('H', 'F')!;
    expect(hf.levels.filter((l) => l.column === 'middle' && l.fromSide === 'right').map((l) => l.n)).toEqual([1, 2]);
    expect(moCounts(hf.levels).bondOrder).toBe(1);
    expect(hf.atoms).toEqual({ left: 'H', right: 'F', mixing: true });
    // single orbitals: two p orbitals side by side make π and π* (ethylene), a hybrid and a p orbital σ and σ*
    expect(fromAtoms('2p', '2p')!.levels.filter((l) => l.column === 'middle').map((l) => moPlain(l.label))).toEqual(['π', 'π*']);
    expect(fromAtoms('sp3', '2p')!.levels.filter((l) => l.column === 'middle').map((l) => moPlain(l.label))).toEqual(['σ', 'σ*']);
    expect(moCounts(fromAtoms('2p', '2p')!.levels)).toMatchObject({ bondOrder: 1, unpaired: 0, moOrbitals: 2, atomOrbitals: 2 });
    expect(fromAtoms('Xx', 'F')).toBeNull();
  });

  it('puts bonding orbitals below and antibonding ones above the atoms\' orbitals, for every pair', () => {
    // "Bonding molecular orbitals are more stable than the atomic orbitals" and "Antibonding
    // molecular orbitals are less stable than the atomic orbitals" (the homonuclear page above,
    // 4.2.02). For CO, 4.2.03 adds that mixing lowers 2σ* and raises 3σ, so those two are left out.
    const atoms = MO_ATOMS.filter((a) => !a.orbital && a.orbitals.some((o) => o.n === 3 && o.electrons > 0)).map((a) => a.id);
    for (const a of atoms) for (const b of atoms) {
      // each side's s orbital (one) and p set (three): 2s and 2p, or 3s and 3p from sodium on
      const spec = fromAtoms(a, b)!, side = (n: number) => spec.levels.filter((l) => l.column !== 'middle' && l.n === n).map((l) => l.e);
      expect(side(1).length, a + b).toBe(2);
      expect(side(3).length, a + b).toBe(2);
      const mid = spec.levels.filter((l) => l.column === 'middle').sort((x, y) => x.e - y.e);
      const pi = mid.filter((l) => l.n === 2);
      expect(mid[0].e, `${a}${b} lowest σ`).toBeLessThanOrEqual(Math.min(...side(1)));
      expect(pi[0].e, `${a}${b} π`).toBeLessThan(Math.min(...side(3)));
      expect(pi[1].e, `${a}${b} π*`).toBeGreaterThan(Math.max(...side(3)));
      expect(mid[mid.length - 1].e, `${a}${b} highest σ*`).toBeGreaterThan(pi[1].e);
    }
    // every pair of choices: as many molecular orbitals as atomic orbitals, and the atoms' electrons
    for (const a of MO_ATOMS) for (const b of MO_ATOMS) {
      const c = moCounts(fromAtoms(a.id, b.id)!.levels);
      expect(c.moOrbitals, a.id + b.id).toBe(c.atomOrbitals);
      expect(c.moElectrons, a.id + b.id).toBe(c.atomElectrons);
    }
    // CO: Miessler, Fischer and Tarr, Inorganic Chemistry, 5th ed. (Pearson, 2014), section 5.3.1
    // and Figure 5.13: 2σ, 2σ*, 1π, then the 3σ HOMO ("the 3σ is higher than the 1π levels"); the
    // LUMOs are 1π*; "four bonding pairs and one antibonding pair for a net bond order of 3"
    const co = fromAtoms('C', 'O')!, mos = co.levels.filter((l) => l.column === 'middle').sort((x, y) => x.e - y.e);
    expect(mos.filter((l) => l.electrons > 0).map((l) => moPlain(l.label))).toEqual(['2σ', '2σ*', '1π', '3σ']);
    expect(moPlain(mos.find((l) => l.electrons === 0)!.label)).toBe('1π*');
    expect(moCounts(co.levels).bondOrder).toBe(3);
    // LiF (the same book, section 5.3.2 and Figure 5.14): Li 2s and F 2pz make the bonding
    // orbital, which takes Li's electron; everything else on F stays as it was: one bond
    // The figure names them plainly, bottom to top: σ, σ, π, σ*.
    const lif = fromAtoms('Li', 'F')!, bond = lif.levels.find((l) => l.column === 'middle' && l.fromSide === 'each' && l.electrons > 0)!;
    expect(lif.levels.filter((l) => l.column === 'middle' && l.fromSide !== 'left').sort((x, y) => x.e - y.e).map((l) => moPlain(l.label))).toEqual(['σ', 'σ', 'π', 'σ*']);
    expect(sources(lif.levels, bond).map((l) => `${l.column} ${l.label}`)).toEqual(['left 2s', 'right 2p']);
    expect(lif.levels.filter((l) => l.column === 'middle' && l.fromSide === 'right').map((l) => [l.n, l.electrons])).toEqual([[1, 2], [2, 4]]);
    expect(moCounts(lif.levels)).toMatchObject({ bondOrder: 1, unpaired: 0 });
    expect(bond.e).toBeLessThan(lif.levels.find((l) => l.column === 'right' && l.label === '2p')!.e);
    // helium beside a second-row atom: nothing mixes, no bond; H beside Li mixes with Li 2s (Li has no 2p electrons)
    expect(moCounts(fromAtoms('He', 'O')!.levels).bondOrder).toBe(0);
    const lih = fromAtoms('Li', 'H')!;
    expect(moCounts(lih.levels)).toMatchObject({ bondOrder: 1, unpaired: 0 });
    expect(sources(lih.levels, lih.levels.find((l) => moPlain(l.label) === '2σ')!).map((l) => l.label)).toEqual(['2s', '1s']);
    // one orbital on its own is titled X (left) or Y (right), never an element's symbol
    expect(fromAtoms('B', 'sp3')!.titles).toEqual(['B', 'B–Y', 'Y']);
    expect(fromAtoms('2p', '2p')!.titles).toEqual(['X', 'X–Y', 'Y']);
  });

  it('fills a diagram from neon and the third-row atoms', () => {
    // Orbital potential energies (eV): J. B. Mann, T. L. Meek and L. C. Allen, J. Am. Chem. Soc.
    // 2000, 122, 2780, as tabulated in Miessler, Fischer and Tarr, Inorganic Chemistry, 5th ed.
    // (Pearson, 2014), Table 5.2: Ne 2s −48.47, 2p −21.59; Na 3s −5.14; Cl 3s −25.23, 3p −13.67.
    const orb = (id: string) => MO_ATOMS.find((a) => a.id === id)!.orbitals.map((o) => [o.label, o.e]);
    expect(orb('Ne')).toEqual([['2s', -48.47], ['2p', -21.59]]);
    expect(orb('Cl')).toEqual([['3s', -25.23], ['3p', -13.67]]);
    expect(orb('Na')[0]).toEqual(['3s', -5.14]);
    // "the valence atomic orbitals involved in bonding are the 3s and 3p orbitals" for P2, whose
    // MOs are "analogous to those from the second row": Brown et al., Chemistry: The Central
    // Science, 15th ed. (Pearson), exercise 9.83(a) and its worked guidance
    const p2 = fromAtoms('P', 'P')!;
    expect(p2.levels.filter((l) => l.column === 'left').map((l) => l.label)).toEqual(['3s', '3p']);
    expect(p2.levels.filter((l) => l.column === 'middle').map((l) => moPlain(l.label)).sort()).toEqual(['π*3p', 'π3p', 'σ*3p', 'σ*3s', 'σ3p', 'σ3s'].sort());
    // OpenStax Chemistry 2e, section 8.4: "Be2 and Ne2 molecules would have a bond order of 0"
    expect(moCounts(fromAtoms('Ne', 'Ne')!.levels).bondOrder).toBe(0);
    // every pair with a third-row atom: as many molecular orbitals as atomic orbitals, and the atoms' electrons
    for (const a of ['Na', 'Mg', 'Al', 'Si', 'P', 'S', 'Cl', 'Ar']) for (const b of MO_ATOMS) {
      const c = moCounts(fromAtoms(a, b.id)!.levels);
      expect(c.moOrbitals, a + b.id).toBe(c.atomOrbitals);
      expect(c.moElectrons, a + b.id).toBe(c.atomElectrons);
    }
    // numbering (a convention, not a measured value): with a third-row atom only the drawn
    // orbitals are counted, from 1σ; atoms up to neon keep the book's 2σ start (CO above)
    expect(fromAtoms('Cl', 'F')!.levels.filter((l) => l.column === 'middle').sort((x, y) => x.e - y.e).map((l) => moPlain(l.label))[0]).toBe('1σ');
    // H beside an atom with p electrons is named plainly, as Miessler, Fischer and Tarr, 5th ed.,
    // label HF's orbitals (Example 5.3 and its figure: σ for F 2s, then σ, π and σ*, no numbers)
    expect(fromAtoms('H', 'Cl')!.levels.filter((l) => l.column === 'middle').map((l) => moPlain(l.label)).sort()).toEqual(['π', 'σ', 'σ', 'σ*'].sort());
    expect(fromAtoms('H', 'F')!.levels.filter((l) => l.column === 'middle').sort((x, y) => x.e - y.e).map((l) => moPlain(l.label))).toEqual(['σ', 'σ', 'π', 'σ*']);
    // the π-below-σ default for a third-row molecule is unsourced: the check box changes it
    const cl2 = fromAtoms('Cl', 'Cl')!;
    const flipped = setSides(cl2, { mixing: !cl2.atoms!.mixing });
    const at = (spec: MoSpec, name: string) => spec.levels.find((l) => moPlain(l.label) === name)!.e;
    expect(at(flipped, 'π3p') < at(flipped, 'σ3p')).toBe(!(at(cl2, 'π3p') < at(cl2, 'σ3p')));
    // a full p set (Ne, Ar) beside sodium is not drawn as the ionic pattern
    expect(fromAtoms('Na', 'Ar')!.levels.some((l) => l.fromSide === 'each')).toBe(false);
  });

  it('adds an electron per click and says when the filling breaks the aufbau principle', () => {
    expect([0, 1, 2, 3, 4].map((electrons) => nextElectrons({ n: 2, electrons }))).toEqual([1, 2, 3, 4, 0]);
    const n2 = fromAtoms('N', 'N')!;
    expect(fillProblems(n2.levels)).toEqual([]);
    // one electron lifted from σ2p to π*2p: σ2p has room below an occupied level
    const at = (name: string) => n2.levels.find((l) => moPlain(l.label) === name)!;
    at('σ2p').electrons = 1;
    at('π*2p').electrons = 1;
    const bad = fillProblems(n2.levels);
    expect(bad.map((b) => [moPlain(b.empty.label), moPlain(b.filled.label)])).toEqual([['σ2p', 'π*2p']]);
    // the atoms' own levels are not judged
    expect(fillProblems(n2.levels.filter((l) => l.column !== 'middle'))).toEqual([]);
  });

  it('changes a side to an atom, an orbital or custom', () => {
    const o2 = { ...fromAtoms('O', 'O')!, labelBack: 'white' as const, pictures: true };
    // another atom: filled in again, the look kept
    const no = setSides(o2, { left: 'N' });
    expect(no.atoms).toEqual({ left: 'N', right: 'O', mixing: true });
    expect(no.labelBack).toBe('white');
    expect(no.pictures).toBe(true);
    expect(moCounts(no.levels).moElectrons).toBe(11);
    // the order of the p set changed for the same atoms: the electrons in the molecule stay (here O2 with 13)
    const superoxide = fillElectrons(o2, 13);
    const mixed = setSides(superoxide, { mixing: true });
    expect(moCounts(mixed.levels).moElectrons).toBe(13);
    const at = (spec: MoSpec, name: string) => spec.levels.find((l) => moPlain(l.label) === name)!.e;
    expect(at(mixed, 'π2p')).toBeLessThan(at(mixed, 'σ2p'));
    // custom on one side: nothing is worked out again, and every level of that side and the molecule is set by hand
    const custom = setSides(o2, { right: MO_CUSTOM });
    expect(custom.atoms).toEqual({ left: 'O', right: MO_CUSTOM, mixing: false });
    expect(custom.levels.length).toBe(o2.levels.length);
    expect(custom.levels.filter((l) => l.auto).every((l) => l.column === 'left')).toBe(true);
    expect(custom.levels.filter((l) => l.column === 'left').every((l) => l.auto)).toBe(true);
    // a diagram saved before sides could be picked is custom on both
    const { atoms: _a, ...old } = o2;
    expect(moSides(old)).toEqual({ left: MO_CUSTOM, right: MO_CUSTOM, mixing: false });
    // an atom put beside a custom side brings its own orbitals and keeps the rest
    const withH = setSides(custom, { left: 'H' });
    expect(withH.levels.filter((l) => l.column === 'left').map((l) => l.label)).toEqual(['1s']);
    expect(withH.levels.filter((l) => l.column !== 'left').length).toBe(custom.levels.filter((l) => l.column !== 'left').length);
  });

  it('fills a diagram from a ready-made molecule', () => {
    // Miessler, Fischer and Tarr, Inorganic Chemistry, 5th ed. (Pearson, 2014), section 5.4:
    // H2O Figure 5.28 and Table 5.4, NH3 Figure 5.30 (section 5.4.4), CO2 Figures 5.18 and 5.25,
    // BF3 Figures 5.31 and 5.32. Valence electrons: H2O and NH3 8 ("eight valence electrons" /
    // "When eight electrons are put into the lowest energy levels"), CO2 16 ("The 16 valence
    // electrons"), BF3 24 (B 3 + 3 × F 7). The occupied orbitals from the bottom, the HOMO and the
    // LUMO as the figures fill and label them (BF3's LUMO 2a2″ is so marked in Figure 5.32; NH3's
    // HOMO 3a1 and LUMO 4a1 in Figure 5.30; H2O's HOMO is "designated b2").
    const book: Record<string, { electrons: number; occupied: string[]; lumo: string; orbitals: number }> = {
      H2O: { electrons: 8, occupied: ['2a1', '1b1', '3a1', '1b2'], lumo: '4a1', orbitals: 6 },
      NH3: { electrons: 8, occupied: ['2a1', '1e', '3a1'], lumo: '4a1', orbitals: 7 },
      CO2: { electrons: 16, occupied: ['2ag', '2b1u', '3ag', '3b1u', '1b2u, 1b3u', '1b2g, 1b3g'], lumo: '2b2u, 2b3u', orbitals: 12 },
      BF3: { electrons: 24, occupied: ['3a1′', '2e′', '4a1′', '3e′', '1a2″', '4e′', '1e″', '1a2′'], lumo: '2a2″', orbitals: 16 },
    };
    expect(MO_MOLECULES.map((m) => m.id)).toEqual(Object.keys(book));
    for (const [id, want] of Object.entries(book)) {
      const spec = fromMolecule(id)!, c = moCounts(spec.levels);
      const mos = spec.levels.filter((l) => l.column === 'middle').sort((x, y) => x.e - y.e);
      // as many molecular orbitals as the central atom's and the group orbitals together (section 5.4.2, step 6)
      expect(c.moOrbitals, id).toBe(c.atomOrbitals);
      expect(c.moOrbitals, id).toBe(want.orbitals);
      expect(c.moElectrons, id).toBe(want.electrons);
      expect(c.unpaired, id).toBe(0);
      expect(mos.filter((l) => l.electrons > 0).map((l) => moPlain(l.label)), id).toEqual(want.occupied);
      expect(mos.filter((l) => l.electrons > 0).every((l) => l.electrons === 2 * l.n), id).toBe(true);
      expect(moPlain(mos.find((l) => l.electrons === 0)!.label), id).toBe(want.lumo);
      expect(spec.levels.every((l) => l.auto && l.e >= 0 && l.e <= 1), id).toBe(true);
      // every molecular orbital is joined to the orbitals it is made from, each name found
      for (const l of mos) for (const name of (l.from ?? '').split(',')) expect(sources(spec.levels, { ...l, from: name }).length, `${id} ${l.label}: ${name}`).toBe(1);
      expect(fillProblems(spec.levels), id).toEqual([]);
    }
    // what the book joins: H2O's 1b2 is O 2py alone (nonbonding, Table 5.4); CO2's π pair 1b2u/1b3u
    // is C 2p with the B2u and B3u group orbitals (one level of two); BF3's 1a2′ has no boron partner
    const at = (id: string, name: string) => { const s = fromMolecule(id)!; return sources(s.levels, s.levels.find((l) => l.column === 'middle' && moPlain(l.label) === name)!).map((l) => `${l.column} ${moPlain(l.label)}`); };
    expect(at('H2O', '1b2')).toEqual(['left 2p']);
    expect(at('H2O', '1b1')).toEqual(['left 2p', 'right B1']);
    expect(at('CO2', '1b2u, 1b3u')).toEqual(['left 2p', 'right B2u, B3u']);
    expect(at('BF3', '1a2′')).toEqual(['right A2′ (2px)']);
    expect(at('NH3', '2a1')).toEqual(['left 2s', 'right A1']);
    // titles as the book's figures name the columns (Figure 5.25 "2 O", Figure 5.32 "3F")
    expect(fromMolecule('CO2')!.titles).toEqual(['C', 'CO_{2}', '2 O']);
    expect(fromMolecule('BF3')!.titles).toEqual(['B', 'BF_{3}', '3 F']);
    expect(fromMolecule('XX')).toBeNull();
    // drawn: one name per level, no dashed line to nowhere
    const doc = new Doc();
    doc.style = { ...ACS_1996 };
    const bf3 = fromMolecule('BF3')!;
    let made: number[] = [];
    doc.edit('MO', () => { made = drawMo(doc, POINTS, { ...bf3, pictures: true }, { x: 0, y: 0 }, 300, 320).captions; });
    expect(made.length).toBe(moCaptionRoles(bf3).length);
  });

  it('switches between two atoms, a molecule and custom, and keeps the choice when saved', () => {
    const h2 = { ...fromAtoms('H', 'H')!, labelBack: 'white' as const };
    const water = setMolecule(h2, 'H2O');
    expect(water.molecule).toBe('H2O');
    expect(water.atoms).toBeUndefined();
    expect(water.labelBack).toBe('white');
    expect(moCounts(water.levels).moElectrons).toBe(8);
    // an ion: electrons changed by hand stay when the same molecule is chosen again, and Fill Electrons works
    const ion = fillElectrons(water, 7);
    expect(moCounts(ion.levels)).toMatchObject({ moElectrons: 7, unpaired: 1 });
    expect(moCounts(setMolecule(ion, 'H2O').levels).moElectrons).toBe(7);
    expect(moCounts(setMolecule(ion, 'NH3').levels).moElectrons).toBe(8);
    // back to two atoms: the central atom and the outer one, the molecule choice gone
    const back = setMolecule(setMolecule(h2, 'CO2'), MO_TWO_ATOMS);
    expect(back.molecule).toBeUndefined();
    expect(back.atoms).toEqual(fromAtoms('C', 'O')!.atoms);
    expect(back.levels).toEqual(fromAtoms('C', 'O')!.levels);
    expect(back.labelBack).toBe('white');
    expect(setMolecule(fromMolecule('BF3')!, MO_TWO_ATOMS).titles).toEqual(['B', 'BF', 'F']);
    // custom: the levels kept, all set by hand
    const custom = setMolecule(water, MO_CUSTOM);
    expect(custom.molecule).toBeUndefined();
    // neutral water has 8 valence electrons (Miessler, Fischer and Tarr, 5th ed., Figure 5.28): kept, so the Side
    // Panel's charge is still counted from it; pictures asked for earlier do not come back for group orbitals
    expect(custom.neutral).toBe(8);
    expect(setMolecule(setMolecule({ ...h2, pictures: true }, 'BF3'), MO_CUSTOM).pictures).toBeUndefined();
    expect(setSides(custom, { left: 'O' }).neutral).toBeUndefined();
    expect(setMolecule(custom, MO_TWO_ATOMS).neutral).toBeUndefined();
    // a molecule from a later version: Custom still frees every level
    const later = setMolecule({ ...water, molecule: 'ZZ9' }, MO_CUSTOM);
    expect(later.molecule).toBeUndefined();
    expect(later.levels.some((l) => l.auto)).toBe(false);
    // a group orbital named for a degenerate pair renamed: the orbitals made from it follow
    const co2 = fromMolecule('CO2')!, at = co2.levels.findIndex((l) => l.column === 'right' && moPlain(l.label) === 'B2u, B3u');
    const pu = withLevel(co2, at, { label: 'π_{u}' });
    for (const name of ['1b2u, 1b3u', '2b2u, 2b3u']) expect(sources(pu.levels, pu.levels.find((l) => moPlain(l.label) === name)!).map((l) => `${l.column} ${moPlain(l.label)}`)).toEqual(['left 2p', 'right πu']);
    // an orbital made from three names keeps them through the Made From list
    const a1 = water.levels.find((l) => l.column === 'middle' && (l.from ?? '').split(',').length === 3)!;
    expect(fromOf(fromValue(a1)).from!.split(', ').map(moPlain)).toEqual(a1.from!.split(',').map(moPlain));
    expect(custom.atoms).toEqual({ left: MO_CUSTOM, right: MO_CUSTOM, mixing: false });
    expect(custom.levels.map((l) => l.label)).toEqual(water.levels.map((l) => l.label));
    expect(custom.levels.some((l) => l.auto)).toBe(false);
    // a side changed on a molecule's diagram makes it two atoms again
    expect(setSides(water, { left: 'N' }).molecule).toBeUndefined();
    // the choice survives the plate's JSON round trip; a diagram saved before it has none (two atoms) and is unchanged
    expect(JSON.parse(JSON.stringify(water))).toEqual(water);
    expect(moMolecule(JSON.parse(JSON.stringify(water)).molecule)?.id).toBe('H2O');
    const old = JSON.parse(JSON.stringify(h2)) as MoSpec;
    expect(old.molecule).toBeUndefined();
    expect(moMolecule(old.molecule)).toBeUndefined();
    expect(toRelative(old)).toBe(old);
    // dragging a level and renaming keep the molecule
    const i = water.levels.findIndex((l) => moPlain(l.label) === '1b2');
    expect(withLevel(water, i, { e: 0.6, label: 'n' }).molecule).toBe('H2O');
    // a renamed group orbital: the molecular orbitals made from it follow
    const g = water.levels.findIndex((l) => l.column === 'right' && moPlain(l.label) === 'B1');
    const renamed = withLevel(water, g, { label: 'φ_{B}' });
    expect(sources(renamed.levels, renamed.levels.find((l) => moPlain(l.label) === '2b1')!).map((l) => moPlain(l.label))).toEqual(['2p', 'φB']);
    // the pictures (two atoms' orbitals mixing) are not drawn for a molecule
    const draw = (spec: MoSpec) => { const d = new Doc(); d.style = { ...ACS_1996 }; let n = 0; d.edit('MO', () => { n = drawMo(d, POINTS, spec, { x: 0, y: 0 }, 300, 300).shapes.length; }); return n; };
    expect(draw({ ...water, pictures: true })).toBe(draw(water));
    // a plate with a molecule draws
    const doc = new Doc();
    doc.style = { ...ACS_1996 };
    const plate = newPlate('mo', doc.style.bondLength);
    let id = 0;
    doc.edit('MO', () => { id = putPlate(doc, POINTS, { ...plate, mo: water }, { x: 0, y: 0 }); });
    expect(doc.shapes.get(id)!.plate!.mo!.molecule).toBe('H2O');
  });

  it('finds the level under the pointer and the energy at a height', () => {
    const spec = fromAtoms('H', 'H')!;
    const at = { x: 100, y: 50 }, w = 280, h = 200, L = 14.4;
    const sigma = spec.levels.findIndex((l) => moPlain(l.label) === 'σ1s'), star = spec.levels.findIndex((l) => moPlain(l.label) === 'σ*1s');
    // σ is at the bottom (0) and σ* at the top (1), both in the middle column
    expect(moLevelAt(spec, at, w, h, L, { x: 240, y: 249 })).toBe(sigma);
    expect(moLevelAt(spec, at, w, h, L, { x: 240, y: 46 })).toBe(star);
    expect(moLevelAt(spec, at, w, h, L, { x: 240, y: 150 })).toBeNull();
    expect(moLevelAt(spec, at, w, h, L, { x: 100 + 0.14 * 280, y: 50 + (1 - spec.levels[0].e) * 200 - 3 })).toBe(0);
    expect(moEnergyAt(at, h, 250)).toBe(0);
    expect(moEnergyAt(at, h, 50)).toBe(1);
    expect(moEnergyAt(at, h, 200)).toBe(0.25);
    // outside the diagram a dragged level stops at its edge
    expect(moEnergyAt(at, h, 900)).toBe(0);
    expect(moEnergyAt(at, h, -40)).toBe(1);
    expect(moColumnAt(spec, at, w, L, { x: 110, y: 0 })).toBe('left');
    expect(moColumnAt(spec, at, w, L, { x: 370, y: 0 })).toBe('right');
  });

  it('changes one level, and traces a name back to what it names', () => {
    const hf = fromAtoms('H', 'F')!;
    const p = hf.levels.findIndex((l) => l.column === 'right' && l.label === '2p');
    // F 2p renamed: the molecular orbitals made from it follow
    const renamed = withLevel(hf, p, { label: '2p_{z}' });
    expect(renamed.levels.filter((l) => l.from).map((l) => l.from)).toEqual(['2s', '1s, 2pz', '2pz', '1s, 2pz']);
    // electrons never pass two to an orbital, and a level has one to five orbitals
    expect(withLevel(hf, p, { electrons: 99 }).levels[p].electrons).toBe(6);
    expect(withLevel(hf, p, { n: 0 }).levels[p].n).toBe(1);
    expect(withLevel(hf, p, null).levels.length).toBe(hf.levels.length - 1);
    // an atom's own electrons are not for pressing; the molecule's are
    expect(electronsFree(hf.levels[p])).toBe(false);
    expect(electronsFree(hf.levels.find((l) => l.column === 'middle')!)).toBe(true);
    // the captions in the order they are drawn: each named level, then the three titles, then E
    const roles = moCaptionRoles(hf);
    expect(roles.length).toBe(hf.levels.length + 3 + 1);
    expect(roles[0]).toEqual({ level: 0 });
    expect(roles[hf.levels.length]).toEqual({ title: 0 });
    expect(roles[roles.length - 1]).toEqual({ axis: true });
    const doc = new Doc();
    doc.style = { ...ACS_1996 };
    let made: number[] = [];
    doc.edit('MO', () => { made = drawMo(doc, POINTS, hf, { x: 0, y: 0 }, 280, 200).captions; });
    expect(made.length).toBe(roles.length);
    const text = (i: number) => doc.captions.get(made[i])!.runs.map((r) => r.text).join('');
    roles.forEach((r, i) => { if ('level' in r) expect(text(i)).toBe(moPlain(hf.levels[r.level].label)); if ('title' in r) expect(text(i)).toBe(moPlain(hf.titles[r.title])); });
    // made-from choices for a level set by hand
    expect(fromOf(fromValue(hf.levels.find((l) => l.from === '1s, 2p')!))).toEqual({ from: '1s, 2p', fromSide: 'each' });
    expect(fromChoices(hf.levels).map((c) => c.value)).toContain('right|2s');
  });
});
