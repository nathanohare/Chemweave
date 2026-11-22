// The New items (Nate's C9, 2026-11-22): File ▸ New, the + button by the file tabs and the start
// view all list the same five, worded as Office words them ("Blank document"), with no parentheses.
// What each holds is in its tooltip. Their former names stay findable in command search
// (command-search.ts FORMER_NAMES).

import type { Tab } from '../workspace';

export interface NewItem {
  /** The command it runs. */
  cmd: string;
  /** The tab mode it makes (for its icon and color). */
  mode: Tab['mode'];
  label: string;
  /** A short line on what it is for (the start view shows it under the name; menus put it in the tooltip). */
  blurb: string;
}

export const NEW_ITEMS: readonly NewItem[] = [
  { cmd: 'new', mode: 'drawing', label: 'Blank canvas', blurb: 'Structures and reaction schemes' },
  { cmd: 'new-document', mode: 'document', label: 'Blank document', blurb: 'Text, as in Word' },
  { cmd: 'new-slides', mode: 'slides', label: 'Blank presentation', blurb: 'Slide show, as in PowerPoint' },
  { cmd: 'new-sheet', mode: 'sheet', label: 'Blank spreadsheet', blurb: 'Tables, charts and dashboards' },
  { cmd: 'new-design', mode: 'design', label: 'Blank design', blurb: 'Posters, graphical abstracts and figures' },
];
