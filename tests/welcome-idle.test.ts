// The first-start welcome card goes away when drawing starts. That is looked for when the drawing
// changes, not on every screen frame (60 times a second, for as long as the card stays open).
// In a browser it shows at every start until "Don't show this again" is ticked; the desktop app shows it once.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseSettings, exportText, THIS_COMPUTER } from '../src/settings';

// (Windows line endings, as git checks the file out on Windows, read as plain ones)
const main = readFileSync('src/main.ts', 'utf8').replace(/\r\n/g, '\n');
const html = readFileSync('index.html', 'utf8').replace(/\r\n/g, '\n');
const at = main.indexOf('function showWelcome(');
const body = main.slice(at, main.indexOf('\n}\n', at));

describe('the welcome card', () => {
  it('runs no code on each frame while it shows', () => {
    expect(at).toBeGreaterThan(0);
    expect(body).not.toMatch(/requestAnimationFrame|setInterval/);
    // and is put away from the drawing's own change notice
    expect(main).toMatch(/editor\.onChange = \(\) => \{ welcomeWatch\?\.\(\);/);
  });

  it('has a "Don\'t show this again" box, shown only in a browser', () => {
    const card = html.slice(html.indexOf('<section id="welcome"'), html.indexOf('</section>', html.indexOf('<section id="welcome"')));
    expect(card).toMatch(/<label class="[^"]*welcome-never[^"]*" hidden><input type="checkbox"> Don't show this again<\/label>/);
    expect(body).toMatch(/\.welcome-never'\)!\.hidden = !web/);
  });

  it('in a browser, is kept away only by the box, never by closing it', () => {
    // a browser decides on welcomeOff, the desktop app on welcomed
    expect(body).toMatch(/if \(web \? welcomeOff : welcomed\)/);
    // closing stores nothing in a browser; only the box does, as soon as it changes
    expect(body).toMatch(/if \(web\) return;\s*welcomed = true;/);
    expect(body).toMatch(/never\.onchange = \(\) => \{ welcomeOff = never\.checked; storeSettings\(\); \};/);
  });

  it('remembers the choice per computer, off by default', () => {
    expect(parseSettings(null).welcomeOff).toBe(false);
    expect(parseSettings(JSON.stringify({ welcomeOff: true })).welcomeOff).toBe(true);
    expect(THIS_COMPUTER).toContain('welcomeOff');
    expect(exportText(parseSettings(JSON.stringify({ welcomeOff: true })))).not.toMatch(/welcomeOff/);
  });
});
