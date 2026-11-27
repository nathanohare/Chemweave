// A font name for an SVG font-family list, quoted so that any name works in it.

/** Text for inside a quoted CSS string (a font name with an apostrophe, O'Brien Sans): CSS 2.1 §4.3.7 and §4.1.3: a quote or backslash goes in after a backslash. */
export const cssString = (t: string): string => t.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

/** A font family name as a quoted CSS string ('Times New Roman', 'O\'Brien Sans'). */
export const cssFamily = (t: string): string => `'${cssString(t)}'`;
