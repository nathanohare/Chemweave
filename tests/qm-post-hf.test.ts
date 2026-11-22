// @vitest-environment jsdom
//
// Gaussian logs beyond DFT (audit G1-16): the energy of a post-HF method (MP2, CCSD(T)), a double
// hybrid, a composite method (CBS-QB3, G4) or ONIOM is the method's own final energy, not the SCF
// (HF reference) energy, and a composite's free energy is its own, not its B3LYP frequency job's.
// The lines are written in the form Gaussian 16 prints them (Foresman and Frisch, "Exploring
// Chemistry with Electronic Structure Methods", 3rd ed., Gaussian Inc., 2015, chapters 6 and 7);
// the numbers are made up for the test, each kind different so the right one is checked.

import { describe, expect, it } from 'vitest';
import { readQmOutput } from '../src/chem/qm-output';

const log = (route: string, body: string[], done = true) => [
  ' Entering Gaussian System, Link 0=g16',
  ' Gaussian, Inc.  All Rights Reserved.',
  ' ----------------------------------------------------------------------',
  ` ${route}`,
  ' ----------------------------------------------------------------------',
  ' SCF Done:  E(RHF) =  -76.0107465     A.U. after   10 cycles',
  ...body,
  done ? ' Normal termination of Gaussian 16 at Mon Nov  2 06:00:00 2026.' : '',
].join('\n');

describe('Gaussian energies beyond SCF', () => {
  it('reads MP2\'s EUMP2 (Fortran D exponent), not the HF energy', () => {
    const r = readQmOutput(log('#p mp2/aug-cc-pvtz', [' E2 =    -0.2645323017D+00 EUMP2 =    -0.76275278793D+02']), 'h2o.log')!;
    expect(r.scf).toBeCloseTo(-76.275278793, 9);
    expect(r.energyFrom).toBe('MP2');
    expect(r.missing).toBeUndefined();
  });

  it('reads CCSD(T)= rather than the MP2 step before it', () => {
    const r = readQmOutput(log('#p ccsd(t)/cc-pvtz', [' E2 =    -0.2645323017D+00 EUMP2 =    -0.76275278793D+02', ' CCSD(T)= -0.76332141577D+02']), 'h2o.log')!;
    expect(r.scf).toBeCloseTo(-76.332141577, 9);
    expect(r.energyFrom).toBe('CCSD(T)');
  });

  it('reads a double hybrid\'s whole energy (SCF Done leaves out its MP2-like part)', () => {
    const r = readQmOutput(log('#p b2plypd3/def2tzvp', [' E2(B2PLYPD3) =    -0.1043765230D+00 E(B2PLYPD3) =    -0.76402115870D+02']), 'h2o.log')!;
    expect(r.scf).toBeCloseTo(-76.40211587, 8);
    expect(r.energyFrom).toBe('B2PLYPD3');
  });

  it('reads the ONIOM extrapolated energy', () => {
    const r = readQmOutput(log('#p oniom(b3lyp/6-31g(d):pm6) opt', [' ONIOM: extrapolated energy =    -232.123456789']), 'big.log')!;
    expect(r.scf).toBeCloseTo(-232.123456789, 9);
    expect(r.energyFrom).toBe('ONIOM extrapolated');
  });

  it('takes a composite method\'s own 0 K energy, enthalpy and free energy, not its B3LYP frequency job\'s', () => {
    const body = [
      ' Sum of electronic and thermal Enthalpies=           -76.380000',
      ' Sum of electronic and thermal Free Energies=        -76.400000',
      ' CBS-QB3 (0 K)=          -76.337396 CBS-QB3 Energy=          -76.334561',
      ' CBS-QB3 Enthalpy=       -76.333617 CBS-QB3 Free Energy=     -76.355045',
    ];
    const r = readQmOutput(log('#p cbs-qb3', body), 'h2o.log')!;
    expect(r.scf).toBeCloseTo(-76.337396, 6);
    expect(r.enthalpy).toBeCloseTo(-76.333617, 6);
    expect(r.free).toBeCloseTo(-76.355045, 6);
    expect(r.energyFrom).toBe('CBS-QB3 (0 K)');
    const g4 = readQmOutput(log('#p g4', [' G4(0 K)=              -76.382524 G4 Energy=              -76.379689', ' G4 Enthalpy=           -76.378745 G4 Free Energy=        -76.400165']), 'h2o.log')!;
    expect(g4.scf).toBeCloseTo(-76.382524, 6);
    expect(g4.free).toBeCloseTo(-76.400165, 6);
  });

  it('says when the route asks for a post-HF energy the log doesn\'t give, and keeps the SCF one', () => {
    const r = readQmOutput(log('#p ccsd(t)/cc-pvtz', [], false), 'cut.log')!;
    expect(r.scf).toBeCloseTo(-76.0107465, 7);
    expect(r.missing).toBe('CCSD(T)');
    expect(r.energyFrom).toBeUndefined();
  });

  it('leaves a DFT job as it was: the SCF energy', () => {
    const r = readQmOutput(log('#p opt freq b3lyp/6-31g(d)', [' SCF Done:  E(RB3LYP) =  -76.4089533     A.U. after    8 cycles']), 'h2o.log')!;
    expect(r.scf).toBeCloseTo(-76.4089533, 7);
    expect(r.energyFrom).toBeUndefined();
    expect(r.missing).toBeUndefined();
  });
});
