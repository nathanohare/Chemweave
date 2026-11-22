// @vitest-environment jsdom
//
// The accessibility check (scripts/a11y-check.mjs, standing rule R10): how it reads WCAG 2.5.3
// (Label in Name) for buttons whose picture has letters in it, and that its known list stays empty.
import { describe, expect, it } from 'vitest';
import { labelInNameStill, compareA11y } from '../scripts/a11y-check.mjs';
import { KNOWN_A11Y } from '../scripts/a11y-known.mjs';

const still = (html: string) => {
  document.body.innerHTML = html;
  document.body.firstElementChild!.id = 'b';
  return labelInNameStill('#b');
};

describe('Label in Name (WCAG 2.5.3)', () => {
  it('leaves out the letters of an icon', () => {
    // the "Aa" of the Styles icon, an <svg> hidden from screen readers
    expect(still('<button aria-label="Styles"><svg aria-hidden="true"><text>Aa</text></svg><span>Styles ▾</span></button>')).toBe(false);
    // a ring tool's size drawn in its picture
    expect(still('<button aria-label="Cyclopropane"><svg aria-hidden="true"><text>3</text></svg></button>')).toBe(false);
    // a picture made of symbols, marked as an icon
    expect(still('<button aria-label="Increase Font Size"><span aria-hidden="true">A<sup>+</sup></span></button>')).toBe(false);
    expect(still('<button aria-label="Knowledge Base"><svg aria-hidden="true"><text>i</text></svg><span>Knowledge<br>Base</span></button>')).toBe(false);
  });

  it('still finds a name that leaves out the visible words', () => {
    expect(still('<button aria-label="No structures to check"><span aria-hidden="true">✓</span><span>No problems</span></button>')).toBe(true);
    expect(still('<button aria-label="No problems: no structures to check"><span aria-hidden="true">✓</span><span>No problems</span></button>')).toBe(false);
    // words hidden with aria-hidden still count: hiding a real label does not pass
    expect(still('<button aria-label="Delete"><span aria-hidden="true">Save file</span></button>')).toBe(true);
    expect(still('<button aria-label="Remove"><span aria-hidden="true">Go On</span></button>')).toBe(true);
    // symbols not marked as an icon count too
    expect(still('<button aria-label="Increase Font Size">A<sup>+</sup></button>')).toBe(true);
  });
});

describe('the known list', () => {
  it('is empty: every problem found when the check was added has been fixed', () => {
    expect(KNOWN_A11Y).toEqual([]);
    expect(compareA11y(['axe x: y'], KNOWN_A11Y).fresh).toEqual(['axe x: y']);
  });
});
