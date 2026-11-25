// How bulky the tertiary phosphines and phosphites of the Ligand Library are: the Tolman cone
// angle and the percent buried volume (%Vbur), each value with the source it comes from. Shown
// in the Ligand Library's details, with the source behind an "i".
//
// Both measures put the metal 2.28 Å from phosphorus. Cone angles are Tolman's, from
// space-filling models; %Vbur is the share of a sphere around the metal that the ligand fills.

/** Where a value comes from. */
export interface StericSource {
  /** Short form for a tip: Tolman, Chem. Rev. 1977. */
  short: string;
  /** Full reference. */
  full: string;
  doi?: string;
}

/** C. A. Tolman's review: Table I lists the cone angles. */
export const TOLMAN_1977: StericSource = {
  short: 'Tolman, Chem. Rev. 1977',
  full: 'C. A. Tolman, Steric effects of phosphorus ligands in organometallic chemistry and homogeneous catalysis, Chem. Rev. 1977, 77, 313–348 (Table I)',
  doi: '10.1021/cr60307a002',
};

/**
 * The textbook table that puts cone angles and %Vbur side by side. Its %Vbur values are cited to
 * it because the paper they were first given in could not be checked; the likely one is
 * H. Clavier and S. P. Nolan, Chem. Commun. 2010, 46, 841.
 */
export const MFT_2014: StericSource = {
  short: 'Miessler, Fischer and Tarr, 2014',
  full: 'G. L. Miessler, P. J. Fischer and D. A. Tarr, Inorganic Chemistry, 5th ed., Pearson, 2014, Table 14.1',
};

export interface StericValue {
  value: number;
  source: StericSource;
  /** What is unusual about this value. */
  note?: string;
}

export interface LigandSterics {
  /** Tolman cone angle, in degrees. */
  cone?: StericValue;
  /** A cone angle suggested by %Vbur, where Tolman's is thought too small (the phosphites). */
  coneAlt?: StericValue;
  /** Percent buried volume. */
  vbur?: StericValue;
}

const tolman = (value: number): StericValue => ({ value, source: TOLMAN_1977 });
const mft = (value: number, note?: string): StericValue => ({ value, source: MFT_2014, ...(note ? { note } : {}) });
const FREE = 'from the crystal structure of the free ligand';

/** By Ligand Library id. */
export const LIGAND_STERICS: Readonly<Record<string, LigandSterics>> = {
  pf3: { cone: tolman(104) },
  pome3: { cone: tolman(107), coneAlt: mft(128), vbur: mft(26.4, 'from the crystal structure of its gold complex, (MeO)₃P–AuCl') },
  poet3: { cone: tolman(109) },
  pme3: { cone: tolman(118), vbur: mft(22.2, FREE) },
  poph3: { cone: tolman(128), coneAlt: mft(155), vbur: mft(30.7, FREE) },
  pet3: { cone: tolman(132), vbur: mft(27.8, FREE) },
  pmeph2: { cone: tolman(136) },
  pph3: { cone: tolman(145), vbur: mft(29.6, FREE) },
  pcy3: { cone: tolman(170), vbur: mft(31.8, FREE) },
  ptbu3: { cone: tolman(182), vbur: mft(36.7, FREE) },
  pc6f53: { cone: tolman(184), vbur: mft(37.3, FREE) },
  potol3: { cone: tolman(194), vbur: mft(41.4, FREE) },
  pmes3: { cone: tolman(212), vbur: mft(47.6, FREE) },
};

/** The ligand's cone angle and %Vbur, if the library has them. */
export const stericsOf = (id: string): LigandSterics | undefined => LIGAND_STERICS[id];

/** The text of the "i" beside a cone angle: what it is and where it comes from. */
export function coneInfo(s: LigandSterics): string {
  if (!s.cone) return '';
  let t = `Tolman cone angle, with the metal 2.28 Å from P. Source: ${s.cone.source.full}.`;
  if (s.coneAlt) t += ` Tolman's angle may be too small for a phosphite: %Vbur suggests ${s.coneAlt.value}° (${s.coneAlt.source.full}).`;
  return t;
}

/** The text of the "i" beside a %Vbur: what it is and where it comes from. */
export function vburInfo(s: LigandSterics): string {
  if (!s.vbur) return '';
  const how = s.vbur.note ? `, ${s.vbur.note}` : '';
  return `Percent buried volume (%Vbur): the share of a sphere around the metal (2.28 Å from P) that the ligand fills${how}. Source: ${s.vbur.source.full}.`;
}
