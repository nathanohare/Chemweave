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

  // review F1-R03: the usual option forms of the route keywords (Gaussian 16 User's Reference, CCSD
  // and MP4 keyword pages: CCSD(T,FC), CCSD=(T,MaxCyc=N), QCISD(T,Full), MP4(SDQ), MP4(DQ))
  const triples = [' E2 =    -0.2645323017D+00 EUMP2 =    -0.76275278793D+02', ' DE(Corr)= -0.27D+00 E(CORR)=     -76.320000000', ' CCSD(T)= -0.76332141577D+02'];
  for (const route of ['#p ccsd(t,full)/cc-pvtz', '#p CCSD(T,FC)/cc-pVTZ', '#p ccsd=(t,maxcyc=100)/cc-pvtz', '#p ccsd(full,t)/cc-pvtz']) {
    it(`reads the CCSD(T) energy for "${route}"`, () => {
      const r = readQmOutput(log(route, triples), 'h2o.log')!;
      expect(r.scf).toBeCloseTo(-76.332141577, 9);
      expect(r.energyFrom).toBe('CCSD(T)');
    });
  }
  it('reads QCISD(T) with options, and names a QCISD job QCISD', () => {
    const r = readQmOutput(log('#p qcisd(t,full)/cc-pvtz', [' QCISD(T)= -0.76331000000D+02']), 'h2o.log')!;
    expect(r.scf).toBeCloseTo(-76.331, 6);
    expect(r.energyFrom).toBe('QCISD(T)');
    const q = readQmOutput(log('#p qcisd/cc-pvtz', [' DE(Corr)= -0.27D+00 E(CORR)=     -76.300000000']), 'h2o.log')!;
    expect(q.energyFrom).toBe('QCISD');
    expect(q.scf).toBeCloseTo(-76.3, 6);
  });
  it('reads CCSD with options as CCSD', () => {
    const r = readQmOutput(log('#p ccsd(full)/cc-pvtz', [' DE(Corr)= -0.27D+00 E(CORR)=     -76.320000000']), 'h2o.log')!;
    expect(r.energyFrom).toBe('CCSD');
    expect(r.scf).toBeCloseTo(-76.32, 6);
  });
  it('reads MP4(SDQ) and MP4(DQ) energies from their own lines', () => {
    const body = [' UMP4(DQ)=  -0.76290000000D+02', ' UMP4(SDQ)= -0.76295000000D+02'];
    expect(readQmOutput(log('#p mp4(sdq)/cc-pvtz', body), 'h2o.log')!.scf).toBeCloseTo(-76.295, 6);
    expect(readQmOutput(log('#p mp4(dq)/cc-pvtz', body), 'h2o.log')!.scf).toBeCloseTo(-76.29, 6);
  });
  it('says so, never passing the SCF energy off as the answer, when the method is not read here', () => {
    const bd = readQmOutput(log('#p bd(t)/cc-pvtz', []), 'h2o.log')!;
    expect(bd.missing).toBe('BD');
    expect(bd.energyFrom).toBeUndefined();
    // a route not recognised, and a correlated energy in the log that doesn't say whose it is
    const odd = readQmOutput(log('#p xmethod/cc-pvtz', [' DE(Corr)= -0.27D+00 E(CORR)=     -76.320000000']), 'h2o.log')!;
    expect(odd.missing).toBe('XMETHOD');
    expect(odd.scf).toBeCloseTo(-76.0107465, 7);
    // plain DFT: nothing to say
    expect(readQmOutput(log('#p b3lyp/6-31g(d)', []), 'h2o.log')!.missing).toBeUndefined();
  });

  // review F1b-R09: the other ways the Gaussian 16 User's Reference allows (CCSD=T, the option
  // written with "="; MP4=SDQ) and the open-shell forms UCCSD, ROCCSD, UQCISD of the CCSD and
  // QCISD keyword pages
  for (const route of ['#p ccsd=t/cc-pvtz', '#p CCSD = T/cc-pVTZ', '#p uccsd(t)/cc-pvtz', '#p roccsd(t)/cc-pvtz', '#p UCCSD(T,FC)/cc-pVTZ', '#p uccsd=t/cc-pvtz']) {
    it(`reads the CCSD(T) energy for "${route}"`, () => {
      const r = readQmOutput(log(route, triples), 'oh.log')!;
      expect(r.scf).toBeCloseTo(-76.332141577, 9);
      expect(r.energyFrom).toBe('CCSD(T)');
      expect(r.missing).toBeUndefined();
    });
  }
  it('reads UCCSD as CCSD and UQCISD(T) as QCISD(T)', () => {
    const c = readQmOutput(log('#p uccsd/cc-pvtz', [' DE(Corr)= -0.27D+00 E(CORR)=     -76.320000000']), 'oh.log')!;
    expect(c.energyFrom).toBe('CCSD');
    expect(c.scf).toBeCloseTo(-76.32, 6);
    const q = readQmOutput(log('#p uqcisd(t)/cc-pvtz', [' QCISD(T)= -0.76331000000D+02']), 'oh.log')!;
    expect(q.energyFrom).toBe('QCISD(T)');
    expect(q.scf).toBeCloseTo(-76.331, 6);
  });
  it('reads MP4=SDQ, MP4=(SDQ) and MP4=DQ from their own lines, not as MP4(SDTQ)', () => {
    const body = [' UMP4(DQ)=  -0.76290000000D+02', ' UMP4(SDQ)= -0.76295000000D+02', ' UMP4(SDTQ)= -0.76299000000D+02'];
    const sdq = readQmOutput(log('#p mp4=sdq/cc-pvtz', body), 'h2o.log')!;
    expect(sdq.energyFrom).toBe('MP4(SDQ)');
    expect(sdq.scf).toBeCloseTo(-76.295, 6);
    expect(readQmOutput(log('#p mp4=(sdq)/cc-pvtz', body), 'h2o.log')!.scf).toBeCloseTo(-76.295, 6);
    expect(readQmOutput(log('#p mp4=dq/cc-pvtz', body), 'h2o.log')!.scf).toBeCloseTo(-76.29, 6);
    expect(readQmOutput(log('#p mp4/cc-pvtz', body), 'h2o.log')!.scf).toBeCloseTo(-76.299, 6);
  });
  it('reads a CCSD(T) or QCISD(T) line the route doesn\'t name, rather than only noting it', () => {
    const r = readQmOutput(log('#p xmethod/cc-pvtz', [' CCSD(T)= -0.76332141577D+02']), 'h2o.log')!;
    expect(r.scf).toBeCloseTo(-76.332141577, 9);
    expect(r.energyFrom).toBe('CCSD(T)');
    expect(r.missing).toBeUndefined();
    const q = readQmOutput(log('#p xmethod/cc-pvtz', [' QCISD(T)= -0.76331000000D+02']), 'h2o.log')!;
    expect(q.energyFrom).toBe('QCISD(T)');
  });
  // review F1b-R15: only the method is looked at, not every word of the route (made-up routes)
  it('says nothing for a DFT job whose route has a word that names another method elsewhere', () => {
    for (const route of ['#p opt b3lyp/6-31g(d) bd', '#p b3lyp/6-31g(d) opt w1 cid', '#p opt iop(3/124=40) m062x/def2tzvp g1']) {
      const r = readQmOutput(log(route, []), 'h2o.log')!;
      expect(r.missing, route).toBeUndefined();
      expect(r.scf).toBeCloseTo(-76.0107465, 7);
    }
    // and the method itself is still noted
    expect(readQmOutput(log('#p opt cisd/6-31g(d)', []), 'h2o.log')!.missing).toBe('CISD');
  });

  // review F1c-R06: the fallback never guesses
  it('reads ROCBS-QB3 as the composite, not its CCSD(T) step', () => {
    const r = readQmOutput(log('#p rocbs-qb3', [' CCSD(T)= -0.75600000000D+02', ' CBS-QB3 (0 K)=              -75.712000 CBS-QB3 Energy=              -75.709000',
      ' CBS-QB3 Enthalpy=           -75.708000 CBS-QB3 Free Energy=        -75.731000']), 'oh.log')!;
    expect(r.energyFrom).toBe('ROCBS-QB3 (0 K)');
    expect(r.scf).toBeCloseTo(-75.712, 6);
    expect(r.free).toBeCloseTo(-75.731, 6);
  });
  it('a DFT job with a CCSD(T) line in its log keeps its SCF energy and says why', () => {
    const r = readQmOutput(log('#p opt freq b3lyp/6-31g(d)', [' Sum of electronic and thermal Free Energies=        -76.390000', ' CCSD(T)= -0.76332141577D+02']), 'h2o.log')!;
    expect(r.scf).toBeCloseTo(-76.0107465, 7);
    expect(r.energyFrom).toBeUndefined();
    expect(r.note).toBe('The log also has a CCSD(T) energy that its route (b3lyp) doesn\'t ask for: not used.');
  });
  it('a log of two jobs (B3LYP opt and freq, then a CCSD(T) single point): each number from its own job, with a note', () => {
    const text = [
      log('#p opt freq b3lyp/6-31g(d)', [' Sum of electronic and thermal Enthalpies=           -76.385000', ' Sum of electronic and thermal Free Energies=        -76.390000']),
      ' ----------------------------------------------------------------------',
      ' #p ccsd(t)/cc-pvtz geom=check guess=read',
      ' ----------------------------------------------------------------------',
      ' SCF Done:  E(RHF) =  -76.0570000     A.U. after    9 cycles',
      ' CCSD(T)= -0.76332141577D+02',
      ' Normal termination of Gaussian 16 at Mon Nov  2 06:10:00 2026.',
    ].join('\n');
    const r = readQmOutput(text, 'h2o.log')!;
    expect(r.scf).toBeCloseTo(-76.332141577, 9);
    expect(r.energyFrom).toBe('CCSD(T)');
    expect(r.free).toBeCloseTo(-76.39, 6);
    expect(r.enthalpy).toBeCloseTo(-76.385, 6);
    expect(r.theory).toBe(`${readQmOutput(log('#p ccsd(t)/cc-pvtz', []), 'x.log')!.theory}//${readQmOutput(log('#p opt freq b3lyp/6-31g(d)', []), 'x.log')!.theory}`);
    expect(r.note).toMatch(/^The CCSD\(T\) energy is from job 2 of the log \(.+\); the enthalpy and free energy are from job 1 \(.+\)\.$/);
  });
  it('the steps Gaussian runs itself inside one job (GenChk) stay one job', () => {
    const text = [
      log('#p opt freq b3lyp/6-31g(d)', []),
      ' ----------------------------------------------------------------------',
      ' #P Geom=AllCheck Guess=TCheck SCRF=Check GenChk RB3LYP/6-31G(d) Freq',
      ' ----------------------------------------------------------------------',
      ' SCF Done:  E(RB3LYP) =  -76.4089533     A.U. after    1 cycles',
      ' Sum of electronic and thermal Free Energies=        -76.390000',
      ' Normal termination of Gaussian 16 at Mon Nov  2 06:10:00 2026.',
    ].join('\n');
    const r = readQmOutput(text, 'h2o.log')!;
    expect(r.scf).toBeCloseTo(-76.4089533, 7);
    expect(r.free).toBeCloseTo(-76.39, 6);
    expect(r.note).toBeUndefined();
  });
  // review F1c-R10: a space inside the method's options
  it('notes a method with a space in its options', () => {
    expect(readQmOutput(log('#p cisd(maxcyc=50, conver=8)/6-31g(d)', []), 'h2o.log')!.missing).toBe('CISD');
  });
});

