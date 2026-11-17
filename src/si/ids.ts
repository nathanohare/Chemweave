// Permanent internal IDs and folder names in an SI project, made the way Chem SI Assistant
// makes them (core/ids.py), so folders made here and there look alike.
// Internal IDs never change, unlike the compound IDs printed in the SI ("3g"): folder names
// and cross-references (mentions, citations) are built from them.

/** A new internal ID such as "s-7f3a2c91": a letter for the kind, then eight hex digits. */
export function newId(prefix: string): string {
  const b = new Uint8Array(4);
  crypto.getRandomValues(b);
  return `${prefix}-${[...b].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

/** Windows' device names (CON, aux.png, com1…): Windows may refuse a file or folder called that. */
const DEVICE = /^(con|prn|aux|nul|conin\$|conout\$|(com|lpt)[0-9¹²³])$/i;

export function isDeviceName(name: string): boolean {
  return DEVICE.test(name.split('.', 1)[0].replace(/ +$/, ''));
}

/** "aux.png" becomes "aux_.png", "con" becomes "con_"; any other name is left as it is. */
export function avoidDeviceName(name: string): string {
  if (!isDeviceName(name)) return name;
  const base = name.split('.', 1)[0].replace(/ +$/, '');
  return base + '_' + name.slice(base.length);
}

/** A short folder-safe name from a display name: "1-(4-Methoxyphenyl)ethan-1-ol" → "1-4-methoxyphenyl-ethan-1-ol". */
export function slugify(name: string, maxLen = 40): string {
  // accents are dropped (é → e); any other character outside A–Z and 0–9 (β, –) separates
  const text = name.normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
  return avoidDeviceName(text.slice(0, maxLen).replace(/-+$/, '') || 'untitled');
}

/** A file name the person typed, made legal on Windows, macOS and Linux and kept readable. */
export function safeFilename(name: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^[ .]+|[ .]+$/g, '');
  return avoidDeviceName(cleaned || 'file');
}
