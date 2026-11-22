// Reading the results of quantum chemistry jobs (Gaussian .log/.out, ORCA .out) for energy
// diagrams: the energy (free energy when a frequency job ran, else the electronic energy), how
// many imaginary frequencies there are (one: a transition state), the level of theory from the
// route line or input, and the last geometry. Read from the plain text the programs write.

export interface QmAtom { el: string; x: number; y: number; z: number }

export interface QmResult {
  program: 'Gaussian' | 'ORCA';
  /** The name the job goes by (the file's name without its extension). */
  name: string;
  /**
   * Energies in hartree, where the output gives them. `scf` is the electronic energy at the job's
   * own level: the SCF energy for HF and DFT, the method's own final energy for post-HF methods
   * (MP2, CCSD(T)…), double hybrids and ONIOM, and the 0 K energy of a composite method (CBS-QB3,
   * G4…), whose free energy and enthalpy are its own too, not the lower-level frequency job's.
   */
  scf: number | null;
  enthalpy: number | null;
  free: number | null;
  /** Imaginary frequencies (null: no frequency job). */
  imaginary: number | null;
  /** The level of theory, written the way papers do (B3LYP-D3(BJ)/def2-TZVP, SMD(THF)). */
  theory: string;
  atoms: QmAtom[];
  /** The job did not finish normally. */
  unfinished: boolean;
  /** Where `scf` came from when it isn't the SCF energy (MP2, CCSD(T), CBS-QB3 (0 K), ONIOM extrapolated). */
  energyFrom?: string;
  /** The route asks for a post-HF, double-hybrid, composite or ONIOM energy that the output doesn't give, so `scf` is the SCF energy only. */
  missing?: string;
  /**
   * Something the reader wants the user to know about where the numbers came from: a log of several
   * jobs whose energy and thermal values come from different jobs, or an energy line the route
   * doesn't name, not used (review F1c-R06).
   */
  note?: string;
}

/** Hartree in each unit the diagram offers. */
export const HARTREE: Record<string, number> = { 'kcal/mol': 627.509474, 'kJ/mol': 2625.499639, eV: 27.211386 };

const ELEMENTS = ['X', 'H', 'He', 'Li', 'Be', 'B', 'C', 'N', 'O', 'F', 'Ne', 'Na', 'Mg', 'Al', 'Si', 'P', 'S', 'Cl', 'Ar', 'K', 'Ca', 'Sc', 'Ti', 'V', 'Cr', 'Mn', 'Fe', 'Co', 'Ni', 'Cu', 'Zn', 'Ga', 'Ge', 'As', 'Se', 'Br', 'Kr', 'Rb', 'Sr', 'Y', 'Zr', 'Nb', 'Mo', 'Tc', 'Ru', 'Rh', 'Pd', 'Ag', 'Cd', 'In', 'Sn', 'Sb', 'Te', 'I', 'Xe', 'Cs', 'Ba', 'La', 'Ce', 'Pr', 'Nd', 'Pm', 'Sm', 'Eu', 'Gd', 'Tb', 'Dy', 'Ho', 'Er', 'Tm', 'Yb', 'Lu', 'Hf', 'Ta', 'W', 'Re', 'Os', 'Ir', 'Pt', 'Au', 'Hg', 'Tl', 'Pb', 'Bi'];

/** Which program wrote this text, if either. */
export function qmProgram(text: string): QmResult['program'] | null {
  if (/Gaussian, Inc\.|Entering Gaussian System|^\s*#[pPnNtT]?\s/m.test(text.slice(0, 20000)) && /SCF Done:|Standard orientation:|Input orientation:/.test(text)) return 'Gaussian';
  if (/\* O   R   C   A \*|O   R   C   A|FINAL SINGLE POINT ENERGY/.test(text)) return 'ORCA';
  return null;
}

/** Read one output file. Null when it is neither program's output. */
export function readQmOutput(text: string, fileName = ''): QmResult | null {
  const program = qmProgram(text);
  if (!program) return null;
  const name = fileName.replace(/^.*[\\/]/, '').replace(/\.(log|out|txt)$/i, '');
  return program === 'Gaussian' ? readGaussian(text, name) : readOrca(text, name);
}

const last = (text: string, re: RegExp): RegExpExecArray | null => {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  let m: RegExpExecArray | null, out: RegExpExecArray | null = null;
  while ((m = g.exec(text))) out = m;
  return out;
};
const num = (m: RegExpExecArray | null): number | null => (m ? Number(m[1]) : null);
/** The last match of `re` on a line that has `key` (found from the end, so a long log isn't searched through). */
const lastAt = (text: string, key: string, re: RegExp): RegExpExecArray | null => {
  const at = text.lastIndexOf(key);
  return at < 0 ? null : re.exec(text.slice(at, at + 400));
};

// ---------------------------------------------------------------- Gaussian

/**
 * The final energies Gaussian prints for methods beyond SCF, as its output writes them (Gaussian 16
 * User's Reference, and Foresman and Frisch, "Exploring Chemistry with Electronic Structure
 * Methods", 3rd ed., 2015): the route keyword that asks for it, its name, and the line holding it.
 * Fortran D exponents (-0.11531345437D+03) are read as E. Checked in this order, so a CCSD(T) job's
 * MP2 step is not taken for its answer.
 */
const E = '(-?\\d+\\.\\d+(?:[DE][+-]?\\d+)?)';
const line = (key: string) => new RegExp(`${key.replace(/[()]/g, '\\$&')}\\s*${E}`);
// (a method with options: ccsd(t,full), CCSD(T,FC), ccsd=(t,maxcyc=100), ccsd=t, qcisd(t,full),
// mp4(sdq), mp4=sdq; the (T) is the option t among the others; with the open-shell forms UCCSD and
// ROCCSD; review F1-R03, F1b-R09)
const SHELL = '(?:r|u|ro)?';
const withT = (m: string) => new RegExp(`\\b${SHELL}${m}(?:-t\\b|\\s*=\\s*t\\b|\\s*=?\\s*\\([^)]*\\bt\\b)`, 'i');
const plain = (m: string) => new RegExp(`\\b${SHELL}${m}\\b`, 'i');
const mp4 = (opt: string) => new RegExp(`\\b${SHELL}mp4\\s*(?:=\\s*\\(?|\\()\\s*${opt}\\b`, 'i');
const POST_SCF: { route: RegExp; name: string; key: string; re: RegExp }[] = [
  { route: /\boniom\b/i, name: 'ONIOM extrapolated', key: 'ONIOM: extrapolated energy', re: new RegExp(`ONIOM: extrapolated energy\\s*=\\s*${E}`) },
  { route: withT('ccsd'), name: 'CCSD(T)', key: 'CCSD(T)=', re: line('CCSD(T)=') },
  { route: withT('qcisd'), name: 'QCISD(T)', key: 'QCISD(T)=', re: line('QCISD(T)=') },
  { route: plain('ccsd'), name: 'CCSD', key: 'E(CORR)=', re: new RegExp(`E\\(CORR\\)=\\s*${E}`, 'i') },
  { route: plain('qcisd'), name: 'QCISD', key: 'E(CORR)=', re: new RegExp(`E\\(CORR\\)=\\s*${E}`, 'i') },
  { route: mp4('sdq'), name: 'MP4(SDQ)', key: 'UMP4(SDQ)=', re: line('UMP4(SDQ)=') },
  { route: mp4('dq'), name: 'MP4(DQ)', key: 'UMP4(DQ)=', re: line('UMP4(DQ)=') },
  { route: new RegExp(`\\b${SHELL}mp4`, 'i'), name: 'MP4', key: 'UMP4(SDTQ)=', re: line('UMP4(SDTQ)=') },
  { route: plain('mp3'), name: 'MP3', key: 'EUMP3=', re: line('EUMP3=') },
  { route: /\b[ru]?o?mp2\b/i, name: 'MP2', key: 'EUMP2 =', re: line('EUMP2 =') },
  // a double hybrid's SCF energy leaves out its MP2-like part: "E2(B2PLYP) = … E(B2PLYP) = …"
  { route: /\b(b2plyp|mpw2plyp|b2gpplyp|dsdpbep86|pbe0dh|pbeqidh)/i, name: 'double hybrid', key: 'E2(', re: new RegExp(`E2\\([^)]*\\)\\s*=\\s*-?\\d+\\.\\d+(?:[DE][+-]?\\d+)?\\s+E\\([^)]*\\)\\s*=\\s*${E}`) },
];
/**
 * Methods whose energy is not the SCF energy and which are not read here (CISD, Brueckner doubles,
 * EOM, SAC-CI, MP5, CCD, CEPA…), and lines a correlated method prints: with either and no method
 * read above, the result says the method's energy was not read, rather than passing the SCF
 * (HF reference) energy off as the answer.
 */
const OTHER_CORR = /\b(cisd|cid|bd|eom-?\w*|sac-ci|mp5|ccd|lccd|cepa\w*|dlpno\w*|lpno\w*|cbs-\w+|g[1-4]\w*|w1\w*|casmp2|caspt2|mrci)\b/i;
const CORR_LINE = /E\(CORR\)=|EUMP2 =|EUMP3=|UMP4\(|CCSD\(T\)=|QCISD\(T\)=|ONIOM: extrapolated/i;
/** Composite methods: "CBS-QB3 (0 K)=", "G4(0 K)=", and their own "Enthalpy=" and "Free Energy=". */
const COMPOSITE = /\b((?:ro)?cbs-qb3|cbs-4m|cbs-apno|g4mp2|g4|g3mp2|g3b3|g3|g2mp2|g2|g1|w1u|w1bd|w1ro)\b/i;
const fortran = (m: RegExpExecArray | null): number | null => (m ? Number(m[1].replace(/D/i, 'E')) : null);

/**
 * A route's words, split at spaces outside brackets (cisd(maxcyc=50, conver=8)/6-31g(d) is one word).
 */
function routeWords(route: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = '';
  for (const ch of route) {
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (/\s/.test(ch) && depth === 0) { if (cur) out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * The method of a route: the word before the basis set's "/" (IOp(…/…) aside), or the whole route
 * when there is none, as for G4 or CBS-QB3 (review F1b-R15, F1c-R10).
 */
function routeMethod(route: string): string {
  const w = routeWords(route).find((x) => x.includes('/') && !/^iop\b/i.test(x));
  return w ? w.slice(0, w.indexOf('/')) : route;
}

/** HF and density functionals (the usual Gaussian keywords): an SCF method, whose energy is the SCF energy. */
const SCF_METHOD = /^(?:r|u|ro)?(?:hf|b3lyp|b3pw91|b3p86|blyp|bp86|pbe\w*|pw91\w*|m0\w*|m1\w*|mn1\w*|sogga\w*|wb97\w*|cam-b3lyp|lc-\w+|b97\w*|tpss\w*|revtpss|apfd|x3lyp|bmk|o3lyp|hse\w*|hcth\w*|svwn\w*|lsda|b1lyp|mpw\w*|scan|r2scan\w*|am1|pm[367]|dftb\w*|n12\w*)$/i;

/**
 * The jobs of a Gaussian log (--Link1-- jobs, each with its own route), at each route section;
 * the steps Gaussian runs itself inside one job (opt then freq, a composite's steps) have GenChk
 * in their route and stay with their job. A composite method's log is one job.
 */
function gaussianJobs(text: string): string[] {
  const starts: number[] = [];
  const re = /^ ?-{5,}\r?\n([ \t]*#[^\n]*)/gm;
  let routeEnd = -1;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const at = m.index + m[0].length - m[1].length;
    // a title that starts with "#" (it sits between dashes too): only the route's closing dashes and
    // Gaussian's link list ("1/18=20,19=15/1,3;") come between the route and it (review F1d-R07)
    if (routeEnd >= 0) {
      const close = /\n ?-{5,}[^\n]*/g;
      close.lastIndex = routeEnd;
      const c = close.exec(text);
      if (c && c.index < m.index && text.slice(c.index + c[0].length, m.index).split(/\r?\n/).every((l) => /^\s*$|^ ?-{5,}\s*$|^ ?\d+\/\S*;\s*$/.test(l))) continue;
    }
    routeEnd = at + m[1].length;
    if (/\bGenChk\b/i.test(m[1])) continue;
    starts.push(at);
  }
  if (starts.length < 2 || COMPOSITE.exec(routeMethod(gaussianRoute(text).replace(/^#\w?\s*/, '')))) return [text];
  return starts.map((at, i) => text.slice(i ? at : 0, starts[i + 1] ?? text.length));
}

/**
 * A Gaussian log: each job read on its own (gaussianJob). With several jobs (an optimization and
 * frequencies, then a single point at a higher level), the energy is the last job's that has one,
 * the enthalpy, free energy and imaginary frequencies the last frequency job's; when these are two
 * jobs at different levels, the level reads "energy level//frequency level" and a note says which
 * number came from which job (review F1c-R06). Nothing is taken from one job as if it were another's.
 */
function readGaussian(text: string, name: string): QmResult {
  const jobs = gaussianJobs(text);
  if (jobs.length < 2) return readGaussianJob(text, name);
  const parts = jobs.map((t) => readGaussianJob(t, name));
  // the energy: the last job's at a correlated level (MP2, CCSD(T), a composite…) if there is one,
  // else the last job's; never a higher level's dropped without a word (review F1d-R05)
  const rank = (p: QmResult) => (p.scf === null ? -1 : p.energyFrom ? 1 : 0);
  const top = Math.max(...parts.map(rank));
  const eAt = parts.map((p) => rank(p) === top && top >= 0).lastIndexOf(true);
  const tAt = parts.map((p) => p.free !== null || p.enthalpy !== null).lastIndexOf(true);
  const e = parts[eAt >= 0 ? eAt : parts.length - 1];
  const out: QmResult = { ...e, unfinished: !/Normal termination of Gaussian/.test(text.slice(-4000)) };
  if (!out.atoms.length) out.atoms = [...parts].reverse().find((p) => p.atoms.length)?.atoms ?? [];
  if (tAt >= 0 && tAt !== eAt) {
    const t = parts[tAt];
    out.enthalpy = t.enthalpy; out.free = t.free; out.imaginary = t.imaginary;
    const what = e.energyFrom ?? 'electronic';
    if (t.theory !== e.theory) {
      out.theory = `${e.theory}//${t.theory}`;
      out.note = `The ${what} energy is from job ${eAt + 1} of the log (${e.theory || 'its route'}); the enthalpy and free energy are from job ${tAt + 1} (${t.theory || 'its route'}).`;
    }
  }
  // (another job's correlated energy, at another level, that isn't the one taken)
  const level = (p: QmResult) => `${p.energyFrom ?? ''} ${p.theory}`;
  const unused = parts.flatMap((p, i) => (i !== eAt && rank(p) === 1 && level(p) !== level(e) ? [`The log also has ${article(p.energyFrom!)} ${p.energyFrom} energy (${p.theory || 'its route'}) in job ${i + 1}: not used; the energy is job ${eAt + 1}'s.`] : []));
  const lastE = parts.map((p) => p.scf !== null).lastIndexOf(true);
  const later = top === 1 && lastE > eAt && !(tAt >= 0 && tAt !== eAt && parts[tAt].theory !== e.theory)
    ? [`The ${e.energyFrom} energy is from job ${eAt + 1} of the log (${e.theory || 'its route'}), not from the last job (${parts[lastE].theory || 'its route'}).`] : [];
  const notes = [out.note, ...later, ...unused, ...parts.filter((p) => p !== e).map((p) => p.note)].filter(Boolean);
  if (notes.length) out.note = [...new Set(notes)].join(' ');
  return out;
}

/** "a" or "an" before a method's name read letter by letter (an MP2, an ONIOM, a CCSD(T), a G4). */
const article = (name: string) => (/^[AEFHILMNORSX]/.test(name) ? 'an' : 'a');

/** One Gaussian job (a whole log, or one --Link1-- job of it). */
function readGaussianJob(text: string, name: string): QmResult {
  let scf = num(lastAt(text, 'SCF Done:', /SCF Done:\s+E\([^)]*\)\s*=\s*(-?\d+\.\d+)/));
  let free = num(lastAt(text, 'Sum of electronic and thermal Free Energies=', /Sum of electronic and thermal Free Energies=\s*(-?\d+\.\d+)/));
  let enthalpy = num(lastAt(text, 'Sum of electronic and thermal Enthalpies=', /Sum of electronic and thermal Enthalpies=\s*(-?\d+\.\d+)/));
  const routeLine = gaussianRoute(text);
  let energyFrom: string | undefined, missing: string | undefined, note: string | undefined;
  // only the route's method is looked at, so a word elsewhere in the route (a G1, a W1, a BD) sets nothing off
  const route = routeLine.replace(/^#\w?\s*/, '');
  const method = routeMethod(route);
  const comp = COMPOSITE.exec(method);
  if (comp) {
    // the composite's own energies; its frequency job's free energy is at the lower level
    const label = comp[1].toLowerCase() === 'cbs-4m' ? 'CBS-4' : comp[1].toUpperCase();
    // (the open-shell ROCBS-QB3 prints its energies under either name)
    const esc = /CBS-QB3$/.test(label) ? '(?:RO)?CBS-QB3' : label.replace(/[-()]/g, '\\$&');
    const at = (key: string, re: RegExp) => { const i = text.lastIndexOf(key); return i < 0 ? null : fortran(re.exec(text.slice(Math.max(0, i - 40), i + 200))); };
    const e0 = at('(0 K)=', new RegExp(`${esc}\\s*\\(0 K\\)=\\s*(-?\\d+\\.\\d+)`));
    if (e0 !== null) {
      scf = e0; energyFrom = `${label} (0 K)`;
      enthalpy = at(' Enthalpy=', new RegExp(`${esc}\\s+Enthalpy=\\s*(-?\\d+\\.\\d+)`));
      free = at(' Free Energy=', new RegExp(`${esc}\\s+Free Energy=\\s*(-?\\d+\\.\\d+)`));
    } else missing = label;
  } else {
    const p = POST_SCF.find((x) => x.route.test(routeLine));
    if (p) {
      const e = fortran(lastAt(text, p.key, p.re));
      if (e !== null) { scf = e; energyFrom = p.name === 'double hybrid' ? (/E\(([^)]*)\)\s*=/.exec(text.slice(text.lastIndexOf('E2(')))?.[1] ?? p.name) : p.name; }
      else missing = p.name;
    } else {
      // a method not read here: say so (never the SCF energy as if it were the method's)
      const other = OTHER_CORR.exec(method);
      // a method this reader doesn't know, but a log that names its answer: the CCSD(T) or QCISD(T)
      // line. Never for an HF or DFT job (its energy is the SCF energy): that line is another job's,
      // and is noted, not used (review F1c-R06).
      const scfJob = SCF_METHOD.test(method.replace(/\(.*$/, '').replace(/-d\w*$/i, ''));
      const found = other ? undefined : [POST_SCF[2], POST_SCF[1]].find((x) => new RegExp(`(?:^|[^A-Z])${x.key.replace(/[()]/g, '\\$&')}`, 'm').test(text));
      const e = found ? fortran(lastAt(text, found.key, found.re)) : null;
      if (found && e !== null && !scfJob) { scf = e; energyFrom = found.name; }
      else if (found && e !== null) note = `The log also has a ${found.name} energy that its route (${method}) doesn't ask for: not used.`;
      else if (other) missing = other[1].toUpperCase();
      else if (CORR_LINE.test(text) && !scfJob) missing = (method || 'post-SCF').toUpperCase();
    }
  }
  // the last frequency job: the negative frequencies it lists
  let imaginary: number | null = null;
  const freqAt = text.lastIndexOf('Harmonic frequencies');
  if (freqAt >= 0) imaginary = [...text.slice(freqAt).matchAll(/Frequencies --\s+([^\n]+)/g)].flatMap((m) => m[1].trim().split(/\s+/).map(Number)).filter((f) => f < 0).length;
  const atoms = gaussianGeometry(text);
  return {
    program: 'Gaussian', name, scf, enthalpy, free, imaginary,
    theory: routeLine ? gaussianTheory(routeLine) : '', atoms, unfinished: !/Normal termination of Gaussian/.test(text.slice(-4000)),
    ...(energyFrom ? { energyFrom } : {}), ...(missing ? { missing } : {}), ...(note ? { note } : {}),
  };
}

/** The first route section (# line and its continuations), as one line. */
export function gaussianRoute(text: string): string {
  // found without splitting the whole file into lines (a long optimization's log runs to tens of MB)
  const at = /^[ \t]*#/m.exec(text)?.index;
  if (at === undefined) return '';
  const lines = text.slice(at, at + 8000).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*#/.test(lines[i])) continue;
    let r = lines[i].trim();
    for (let j = i + 1; j < lines.length && !/^\s*-{5,}/.test(lines[j]); j++) r += lines[j].replace(/^\s/, '');
    return r;
  }
  return '';
}

const pretty: Record<string, string> = {
  b3lyp: 'B3LYP', m062x: 'M06-2X', m06: 'M06', m06l: 'M06-L', wb97xd: 'ωB97X-D', wb97x: 'ωB97X', 'wb97x-d3': 'ωB97X-D3', 'wb97x-v': 'ωB97X-V', 'wb97m-v': 'ωB97M-V',
  pbe0: 'PBE0', pbe1pbe: 'PBE0', pbe: 'PBE', bp86: 'BP86', tpss: 'TPSS', tpssh: 'TPSSh', b97d: 'B97-D', b97d3: 'B97-D3', mn15: 'MN15', camb3lyp: 'CAM-B3LYP', 'cam-b3lyp': 'CAM-B3LYP',
  hf: 'HF', mp2: 'MP2', ccsd: 'CCSD', 'ccsd(t)': 'CCSD(T)', 'dlpno-ccsd(t)': 'DLPNO-CCSD(T)', r2scan: 'r²SCAN', 'r2scan-3c': 'r²SCAN-3c', b3lyp3c: 'B3LYP-3c', 'pbeh-3c': 'PBEh-3c', b2plyp: 'B2PLYP', revpbe: 'revPBE',
  'b3lyp-d3': 'B3LYP-D3', 'b3lyp-d3bj': 'B3LYP-D3(BJ)', 'b3lyp-d4': 'B3LYP-D4', 'pbe0-d3bj': 'PBE0-D3(BJ)', 'b97-3c': 'B97-3c', 'gfn2-xtb': 'GFN2-xTB', xtb2: 'GFN2-xTB',
};

/** A functional or method as papers write it. */
function methodName(m: string): string {
  const k = m.toLowerCase().replace(/^[ru]o?(?=[a-z])/, (p) => (pretty[m.toLowerCase().slice(p.length)] ? '' : p));
  return pretty[k] ?? pretty[m.toLowerCase()] ?? m.toUpperCase();
}

/** A basis set as papers write it. */
function basisName(b: string): string {
  const l = b.toLowerCase();
  if (l === 'gen' || l === 'genecp') return 'mixed basis';
  if (/^def2/.test(l)) return 'def2-' + l.replace(/^def2-?/, '').toUpperCase().replace(/^MA-/, 'ma-');
  if (/^ma-def2/.test(l)) return 'ma-def2-' + l.replace(/^ma-def2-?/, '').toUpperCase();
  if (/^(aug-)?cc-p/.test(l)) return l.replace(/cc-p(c?w?c?v)(\w)z/, (_, v: string, z: string) => `cc-p${v.toUpperCase()}${z.toUpperCase()}Z`);
  if (/^\d-\d+/.test(l)) return l.replace(/g/, 'G');
  return b;
}

const solventName = (s: string): string => {
  const l = s.toLowerCase().replace(/["']/g, '');
  const known: Record<string, string> = { thf: 'THF', tetrahydrofuran: 'THF', water: 'water', h2o: 'water', dichloromethane: 'CH₂Cl₂', ch2cl2: 'CH₂Cl₂', dcm: 'CH₂Cl₂', toluene: 'toluene', benzene: 'benzene', acetonitrile: 'MeCN', mecn: 'MeCN', ch3cn: 'MeCN', methanol: 'MeOH', ch3oh: 'MeOH', ethanol: 'EtOH', dmso: 'DMSO', dimethylsulfoxide: 'DMSO', dmf: 'DMF', 'n,n-dimethylformamide': 'DMF', chloroform: 'CHCl₃', chcl3: 'CHCl₃', diethylether: 'Et₂O', hexane: 'hexane', 'n-hexane': 'hexane', '1,4-dioxane': 'dioxane', dioxane: 'dioxane', acetone: 'acetone' };
  return known[l] ?? l;
};

/** "#p opt freq b3lyp/6-31g(d) empiricaldispersion=gd3bj scrf=(smd,solvent=thf)" → "B3LYP-D3(BJ)/6-31G(d), SMD(THF)". */
export function gaussianTheory(route: string): string {
  const r = route.replace(/^#\w?\s*/, '');
  const mb = /(?:^|\s)([^\s=/]+)\/([^\s=]+)/.exec(r);
  let method = mb ? methodName(mb[1]) : '';
  const basis = mb ? basisName(mb[2]) : '';
  const disp = /empiricaldispersion\s*=\s*\(?\s*(gd3bj|gd3|gd2|pfd)/i.exec(r)?.[1].toLowerCase();
  if (disp && method) method += disp === 'gd3bj' ? '-D3(BJ)' : disp === 'gd3' ? '-D3' : disp === 'gd2' ? '-D2' : '';
  const scrf = /scrf\s*=\s*\(?([^)\s]*)\)?/i.exec(r)?.[1] ?? (/\bscrf\b/i.test(r) ? '' : null);
  let solv = '';
  if (scrf !== null) {
    const model = /\bsmd\b/i.test(scrf) ? 'SMD' : /\bcpcm\b/i.test(scrf) ? 'CPCM' : 'PCM';
    const s = /solvent\s*=\s*([^,)\s]+)/i.exec(scrf)?.[1] ?? 'water';
    solv = `${model}(${solventName(s)})`;
  }
  return [method && basis ? `${method}/${basis}` : method, solv].filter(Boolean).join(', ');
}

/** The last Standard orientation (or Input orientation) in Å. */
function gaussianGeometry(text: string): QmAtom[] {
  const at = Math.max(text.lastIndexOf('Standard orientation:'), text.lastIndexOf('Input orientation:'));
  if (at < 0) return [];
  const lines = text.slice(at).split(/\r?\n/);
  const out: QmAtom[] = [];
  let dashes = 0;
  for (const l of lines.slice(1)) {
    if (/^\s*-{10,}/.test(l)) { if (++dashes === 3) break; continue; }
    if (dashes < 2) continue;
    const p = l.trim().split(/\s+/).map(Number);
    if (p.length >= 6 && p.every(Number.isFinite)) out.push({ el: ELEMENTS[p[1]] ?? 'X', x: p[3], y: p[4], z: p[5] });
  }
  return out;
}

// ---------------------------------------------------------------- ORCA

const ORCA_JOB = /^(opt|optts|freq|numfreq|anfreq|tightscf|verytightscf|extremescf|loosescf|normalscf|tightopt|verytightopt|looseopt|rijcosx|ri|rijk|ri-jk|nori|defgrid\d|grid\d|finalgrid\d|nofinalgrid|def2\/j|def2\/jk|autoaux|slowconv|veryslowconv|kdiis|soscf|nososcf|nopop|miniprint|smallprint|normalprint|largeprint|printbasis|pal\d+|uks|rks|uhf|rhf|sp|engrad|irc|scants|xyzfile|keepdens|moread|noautostart|frozencore|nofrozencore|tightpno|normalpno|loosepno|[\w-]+\/c)$/i;

function readOrca(text: string, name: string): QmResult {
  const scf = num(last(text, /FINAL SINGLE POINT ENERGY\s+(-?\d+\.\d+)/));
  const free = num(last(text, /Final Gibbs free energy\s+\.\.\.\s+(-?\d+\.\d+)/));
  const enthalpy = num(last(text, /Total Enthalpy\s+\.\.\.\s+(-?\d+\.\d+)/));
  const fAt = text.lastIndexOf('VIBRATIONAL FREQUENCIES');
  const imaginary = fAt < 0 ? null : (text.slice(fAt, text.indexOf('NORMAL MODES', fAt) > 0 ? text.indexOf('NORMAL MODES', fAt) : undefined).match(/\*\*\*imaginary mode\*\*\*/g) ?? []).length;
  const input = [...text.matchAll(/^\|\s*\d+>\s*(.*)$/gm)].map((m) => m[1]);
  return { program: 'ORCA', name, scf, enthalpy, free, imaginary, theory: orcaTheory(input), atoms: orcaGeometry(text), unfinished: !/ORCA TERMINATED NORMALLY/.test(text.slice(-4000)) };
}

/** The input file's lines (as echoed in the output) → the level of theory. */
export function orcaTheory(input: string[]): string {
  const words = input.filter((l) => /^\s*!/.test(l)).flatMap((l) => l.replace(/^\s*!/, '').replace(/#.*$/, '').trim().split(/\s+/)).filter(Boolean);
  let method = '', basis = '', disp = '', solv = '';
  for (const w of words) {
    const l = w.toLowerCase();
    if (ORCA_JOB.test(l)) continue;
    if (/^d3bj$/.test(l)) { disp = '-D3(BJ)'; continue; }
    if (/^d3(zero)?$/.test(l)) { disp = '-D3'; continue; }
    if (/^d4$/.test(l)) { disp = '-D4'; continue; }
    const s = /^c?pcm\((.+)\)$/.exec(l) ?? /^smd\((.+)\)$/.exec(l);
    if (s) { solv = `${l.startsWith('smd') ? 'SMD' : 'CPCM'}(${solventName(s[1])})`; continue; }
    if (/^(def2|ma-def2|(aug-)?cc-p|6-31|6-311|sto-|pcseg|x2c-|sarc)/.test(l)) { if (!basis) basis = basisName(w); continue; }
    if (!method) method = methodName(w);
  }
  const block = input.join('\n');
  const smd = /smd\s+true/i.test(block) ? /smdsolvent\s+"([^"]+)"/i.exec(block)?.[1] : undefined;
  if (smd) solv = `SMD(${solventName(smd)})`;
  // composite methods (r²SCAN-3c, B97-3c) bring their own basis
  const head = method + disp;
  return [head && basis && !/-3c$/.test(method) ? `${head}/${basis}` : head, solv].filter(Boolean).join(', ');
}

function orcaGeometry(text: string): QmAtom[] {
  const at = text.lastIndexOf('CARTESIAN COORDINATES (ANGSTROEM)');
  if (at < 0) return [];
  const out: QmAtom[] = [];
  for (const l of text.slice(at).split(/\r?\n/).slice(2)) {
    const p = l.trim().split(/\s+/);
    if (p.length !== 4 || !/^[A-Z][a-z]?$/.test(p[0])) break;
    const [x, y, z] = p.slice(1).map(Number);
    if (![x, y, z].every(Number.isFinite)) break;
    out.push({ el: p[0], x, y, z });
  }
  return out;
}

// ---------------------------------------------------------------- for the diagram

/** The energy a diagram uses from a result: free energy when every file has one, else the SCF energy. */
export function pickEnergy(results: QmResult[]): { kind: 'free' | 'scf'; quantity: string } {
  return results.length && results.every((r) => r.free !== null) ? { kind: 'free', quantity: 'ΔG' } : { kind: 'scf', quantity: 'ΔE' };
}

/** A species' name from its file: a transition state (one imaginary frequency) gets its ‡. */
export function speciesName(r: QmResult): string {
  let n = r.name.replace(/^\d+[-_ .]+(?=\D)/, '').replace(/[_-]?(opt|freq|optfreq|sp|ts-?opt|final)$/i, '').replace(/^ts(\d*)$/i, (_, d: string) => `TS${d}`);
  if (!n) n = r.name;
  return r.imaginary === 1 && !n.endsWith('‡') ? n + '‡' : n;
}
