// Review batch 08, F406 to F410: Gaussian routes read as Gaussian takes them, and species names
// from file names. Gaussian 16 User's Reference (gaussian.com/route, /scrf, /dft, /keywords):
// the route starts with # and an optional print level (#N, #P, #T) before a space; keywords may
// be shortened as long as they stay unique (EmpiricalDispersion as EM); options go after the
// keyword with or without '=' (SCRF(SMD,Solvent=THF), SCRF=(SMD, Solvent=THF)).
import { describe, expect, it } from 'vitest';
import { gaussianTheory, speciesName, type QmResult } from '../src/chem/qm-output';

const named = (name: string) => speciesName({ name, imaginary: 0 } as QmResult);

describe('Gaussian route', () => {
  it('F406: a method written straight after # keeps its first letter', () => {
    expect(gaussianTheory('#B3LYP/6-31G(d) opt freq')).toBe(gaussianTheory('#p B3LYP/6-31G(d) opt freq'));
    expect(gaussianTheory('#B3LYP/6-31G(d) opt freq')).toMatch(/^B3LYP\//);
    expect(gaussianTheory('#HF/6-31G(d)')).toMatch(/^HF\//);
  });

  it('F407: em=gd3bj is the D3(BJ) dispersion', () => {
    expect(gaussianTheory('#p opt freq b3lyp/def2svp em=gd3bj scrf=(smd,solvent=thf)')).toMatch(/^B3LYP-D3\(BJ\)\//);
    expect(gaussianTheory('#p opt b3lyp/6-31g(d) empiricaldispersion(gd3bj)')).toMatch(/^B3LYP-D3\(BJ\)\//);
  });

  it('F408: scrf options with spaces, or without =', () => {
    expect(gaussianTheory('#p opt freq b3lyp/6-31g(d) scrf(smd,solvent=thf)')).toMatch(/SMD\(THF\)$/);
    expect(gaussianTheory('#p opt freq b3lyp/6-31g(d) scrf=(smd, solvent=thf)')).toMatch(/SMD\(THF\)$/);
    expect(gaussianTheory('#p opt freq b3lyp/6-31g(d) scrf=(pcm,solvent=dichloromethane)')).toMatch(/PCM\(CH₂Cl₂\)$/);
  });
});

describe('species names', () => {
  it('F409: job words go only after a separator, all of them', () => {
    expect(named('Ser-Asp')).toBe('Ser-Asp');
    expect(named('adopt')).toBe('adopt');
    expect(named('INT2_opt_freq')).toBe('INT2');
    expect(named('ts1_opt_freq')).toBe('TS1');
  });

  it('F410: a locant stays; an ordering number goes', () => {
    expect(named('2-naphthol')).toBe('2-naphthol');
    expect(named('1-hexene')).toBe('1-hexene');
    expect(named('01_reactant')).toBe('reactant');
    // ordering numbers with a dash: zero-padded, or before a species word
    expect(named('2-TS1')).toBe('TS1');
    expect(named('3-int')).toBe('int');
    expect(named('01-int1')).toBe('int1');
    expect(named('1-reactant')).toBe('reactant');
  });

  it('F409: a job word glued onto a number goes', () => {
    expect(named('int1opt')).toBe('int1');
    expect(named('7opt')).toBe('7');
  });

  it('F407, F408: a route wrapped over lines (joined with nothing between) still gives the solvent', () => {
    // Gaussian echoes a long route over several lines, which are joined as they come
    expect(gaussianTheory('#p opt freq b3lyp/6-31g(d) empiricaldispersion=gd3bjscrf=(smd,solvent=thf)')).toBe('B3LYP-D3(BJ)/6-31G(d), SMD(THF)');
    expect(gaussianTheory('#p opt freq b3lyp/6-31g(d) scrf=(smd,solvent=thf)em=gd3bj')).toBe('B3LYP-D3(BJ)/6-31G(d), SMD(THF)');
  });
});
