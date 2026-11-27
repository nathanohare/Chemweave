// @vitest-environment jsdom
//
// Code review 2026-11-26, batch 02: reading structures from pictures.
//   F182: groups the reader wrote as [Ts], [Ac], [Pr], [Ar] or [Y] became tennessine, actinium,
//         praseodymium, argon or yttrium atoms.
//   F827: a narrow letter (I) was taken for a stroke when measuring labels.
//   F828: a reader worker that failed after it was ready left every read waiting for ever.
//   F829: an AI answer without JSON gave its first English word as the SMILES; JSON with a single
//         backslash (a stereo bond) gave nothing.
//   F830, F831, F832: caption words: NaCI not made NaCl, CIP made ClP, S10 and C10H21 given an O.

import { describe, it, expect, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: async (cmd: string, a: { name?: string }) => {
    if (cmd === 'pack_read') return new TextEncoder().encode(a.name === 'vocab.json' ? '{}' : 'x').buffer;
    throw new Error('unexpected ' + cmd);
  },
}));

import { parseSymbol } from '../src/recognise/to-drawing';
import { glyphAt } from '../src/recognise/measure';
import { localReader, parseAiAnswer } from '../src/recognise/reader';
import { chemWord } from '../src/recognise/scheme-extras';
import type { Pixels } from '../src/recognise/picture';

describe('F182: group symbols that are also elements', () => {
  it('reads them as labels when they stand alone', () => {
    for (const s of ['[Ts]', '[Ac]', '[Pr]', '[Ar]', '[Y]']) expect(parseSymbol(s)).toEqual({ label: s.slice(1, -1), charge: 0, aromatic: false, h: 0 });
    // real elements stay elements: chlorine, a charged nitrogen, carbon-13
    expect(parseSymbol('[Cl]').z).toBe(17);
    expect(parseSymbol('[NH+]')).toMatchObject({ z: 7, charge: 1, h: 1 });
    expect(parseSymbol('[13CH3]')).toMatchObject({ z: 6, isotope: 13, h: 3 });
  });
});

describe('F827: a capital I is a letter', () => {
  const blank = (w: number, h: number): Pixels => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(255) });
  const fill = (p: Pixels, x1: number, y1: number, x2: number, y2: number) => {
    for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) { const i = (y * p.width + x) * 4; p.data[i] = p.data[i + 1] = p.data[i + 2] = 0; }
  };
  it('finds a 2 × 9 px stem, and still refuses a bond-long stroke', () => {
    const p = blank(60, 60);
    fill(p, 20, 20, 21, 28); // I: 2 wide, 9 tall, with a bond 20 px long
    expect(glyphAt(p, [20.5, 24], 7, 20)).toMatchObject({ w: 2, h: 9 });
    const q = blank(60, 60);
    fill(q, 20, 20, 21, 38); // a line 19 px long: a bond, not a letter
    expect(glyphAt(q, [20.5, 29], 7, 20)).toBeNull();
  });

  it('takes a stem as tall as the other letters, and not a short stub', () => {
    const p = blank(60, 60);
    fill(p, 20, 20, 21, 28); // I: 9 tall, as tall as the labels' letters
    expect(glyphAt(p, [20.5, 24], 7, 20, 9)).toMatchObject({ w: 2, h: 9 });
    const q = blank(60, 60);
    fill(q, 20, 20, 20, 24); // a 1 × 5 px stub (a hash of a hashed bond) among 9 px letters
    expect(glyphAt(q, [20, 22], 7, 20)).toMatchObject({ w: 1, h: 5 }); // (with nothing to go by)
    expect(glyphAt(q, [20, 22], 7, 20, 9)).toBeNull();
  });
});

describe('F828: a reader that stops after it is ready', () => {
  it('fails the reads waiting for it, and the next read starts it again', async () => {
    const made: { onmessage: ((e: { data: unknown }) => void) | null; onerror: ((e: { message?: string }) => void) | null; terminated: boolean }[] = [];
    class FakeWorker {
      onmessage: ((e: { data: unknown }) => void) | null = null;
      onerror: ((e: { message?: string }) => void) | null = null;
      terminated = false;
      constructor() { made.push(this); }
      postMessage(m: { type: string }) { if (m.type === 'init') queueMicrotask(() => this.onmessage?.({ data: { type: 'ready' } })); }
      terminate() { this.terminated = true; }
    }
    vi.stubGlobal('Worker', FakeWorker);
    const pixels = { width: 1, height: 1, data: new Uint8ClampedArray(4) };
    const reading = localReader.read(pixels);
    await vi.waitFor(() => expect(made).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 0));
    made[0].onerror!({ message: 'out of memory' });
    await expect(reading).rejects.toThrow(/stopped unexpectedly/);
    expect(made[0].terminated).toBe(true);
    void localReader.read(pixels).catch(() => {});
    await vi.waitFor(() => expect(made).toHaveLength(2));
    vi.unstubAllGlobals();
  });
});

describe('F829: reading an AI model’s answer', () => {
  it('takes the SMILES, not an English word', () => {
    expect(parseAiAnswer('The structure is CC(=O)O').smiles).toBe('CC(=O)O');
    expect(parseAiAnswer('Here it is: CCO.').smiles).toBe('CCO');
    expect(parseAiAnswer('Sorry, there is no structure.').smiles).toBe('');
  });

  it('takes no short English word for a SMILES', () => {
    for (const w of ['No', 'In', 'Is', 'On', 'So', 'No.', 'Is it?']) expect(parseAiAnswer(w).smiles).toBe('');
    expect(parseAiAnswer('It is CO.').smiles).toBe('CO');
  });
  it('reads JSON whose backslash wasn’t doubled', () => {
    expect(parseAiAnswer('{"smiles": "C/C=C\\C", "note": ""}')).toEqual({ smiles: 'C/C=C\\C', note: '' });
    expect(parseAiAnswer('{"smiles": "C/C=C\\\\C", "note": "ok"}')).toEqual({ smiles: 'C/C=C\\C', note: 'ok' });
  });

  it('keeps a lone backslash that JSON read as a control character', () => {
    // "\n1" in the answer is a stereo bond before ring closure 1, not a new line
    expect(parseAiAnswer('{"smiles": "C/C=C\\n1ccccc1", "note": ""}').smiles).toBe('C/C=C\\n1ccccc1');
    expect(parseAiAnswer('{"smiles": "F/C=C\\F", "note": ""}').smiles).toBe('F/C=C\\F');
  });
});

describe('F830, F831, F832: caption words', () => {
  it('puts Cl right after a small letter, and leaves CIP and CIS alone', () => {
    expect(chemWord('NaCI')).toBe('NaCl');
    expect(chemWord('AcCI')).toBe('AcCl');
    expect(chemWord('NaCIO4')).toBe('NaClO4');
    expect(chemWord('CIP')).toBe('CIP');
    expect(chemWord('CIS')).toBe('CIS');
    // as before
    expect(chemWord('HCI')).toBe('HCl');
    expect(chemWord('TBDPSCI')).toBe('TBDPSCl');
    expect(chemWord('CICO,Et')).toBe('ClCO2Et');
  });

  it('still puts Cl before S, P or Si with more after them', () => {
    // chlorosulfonic acid ClSO3H (CAS 7790-94-5), chlorodiphenylphosphine ClPPh2 (CAS 1079-66-9),
    // chlorotrimethylsilane ClSiMe3 (CAS 75-77-4)
    expect(chemWord('CISO3H')).toBe('ClSO3H');
    expect(chemWord('CIPPh2')).toBe('ClPPh2');
    expect(chemWord('CISiMe3')).toBe('ClSiMe3');
  });
  it('gives O for a nought only after a group’s subscript', () => {
    expect(chemWord('S10')).toBe('S10');
    expect(chemWord('C10H21')).toBe('C10H21');
    expect(chemWord('H20')).toBe('H2O');
    expect(chemWord('Et20')).toBe('Et2O');
    expect(chemWord('Ac20')).toBe('Ac2O');
    expect(chemWord('(Boc)20')).toBe('(Boc)2O');
    expect(chemWord('CH30H')).toBe('CH3OH');
  });

  it('still gives O after an element or group with a 2, and none in a formula of C and H', () => {
    // Boc2O, di-tert-butyl dicarbonate (CAS 24424-99-5); silver(I) oxide Ag2O (CAS 20667-12-3);
    // copper(I) oxide Cu2O (CAS 1317-39-1); caesium oxide Cs2O (CAS 20281-00-9); sodium oxide Na2O
    // (CAS 1313-59-3); nitrous oxide N2O (CAS 10024-97-2); diphenyl ether Ph2O (CAS 101-84-8)
    for (const w of ['Boc', 'Ag', 'Cu', 'Cs', 'Na', 'N', 'Ph']) expect(chemWord(`${w}20`)).toBe(`${w}2O`);
    // 1-decene C10H20 (CAS 872-05-9) and 1-nonanol C9H20O (CAS 143-08-8) are real formulas
    expect(chemWord('C10H20')).toBe('C10H20');
    expect(chemWord('C9H20O')).toBe('C9H20O');
  });
});
