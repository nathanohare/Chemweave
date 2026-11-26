/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';

// The web version (GitHub Pages) has no server to send a Content-Security-Policy header, so its
// pages carry one of their own: only the app's own scripts run (nothing written into a file the
// person opens can run as a script and read the AI key kept in this browser). The desktop app
// gets its policy from src-tauri/tauri.conf.json instead, so its build leaves this out.
// connect-src stays open to https: and this computer because an OpenAI-compatible AI model can be
// at any address the person types in.
const WEB_CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "media-src 'self' data: blob:",
  "connect-src 'self' data: blob: https: http://localhost:* http://127.0.0.1:*",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

function webCsp(): Plugin {
  return {
    name: 'web-csp',
    apply: 'build',
    transformIndexHtml(html) {
      if (process.env.TAURI_ENV_PLATFORM) return html;
      return html.replace('<meta charset="utf-8" />', `<meta charset="utf-8" />\n  <meta http-equiv="Content-Security-Policy" content="${WEB_CSP}" />`);
    },
  };
}

// The web version's build: each build has its own id, written to version.json beside the page so a
// page that is already open can tell a newer version has been published (src/ui/web-update.ts).
// The web build's files carry a stamp of their contents in their names (app-1a2b3c4d.js), so a page
// opened before a new version was published keeps loading the files of its own version, which the
// Web version workflow keeps on the site for a while (scripts/keep-old-web-files.mjs), instead of
// a same-named file of the new version that no longer fits it. The desktop app keeps plain names:
// it never has two versions at once.
const WEB = !process.env.TAURI_ENV_PLATFORM;
const BUILD_ID = `${(process.env.GITHUB_SHA ?? 'local').slice(0, 12)}-${Date.now().toString(36)}`;
const STAMP = WEB ? '-[hash]' : '';

// (the id goes in the pages, not the code, so two builds of the same code have the same file names)
function webVersion(): Plugin {
  return {
    name: 'web-version',
    apply: 'build',
    transformIndexHtml(html) {
      if (!WEB) return html;
      return html.replace('<meta charset="utf-8" />', `<meta charset="utf-8" />\n  <meta name="chemweave-build" content="${BUILD_ID}" />`);
    },
    generateBundle() {
      if (!WEB) return;
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD_ID }) + '\n' });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [webCsp(), webVersion()],
  // The desktop app's development mode expects this exact port (src-tauri/tauri.conf.json).
  // docs/ holds the README pictures; the picture scripts write there while the page is open, so don't reload it
  server: { port: 5173, strictPort: true, watch: { ignored: ['**/docs/**'] } },
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    rollupOptions: {
      // the app, and the audience's window for presenter view
      input: { app: 'index.html', audience: 'audience.html' },
      output: { entryFileNames: `[name]${STAMP}.js`, assetFileNames: `[name]${STAMP}[extname]`, chunkFileNames: `[name]${STAMP}.js` },
    },
  },
  worker: { format: 'iife', rollupOptions: { output: { entryFileNames: `[name]${STAMP}.js` } } },
  // Tests run on UTC, as on the Checks machines, so tests with clock times (Word comment dates)
  // give the same answer on a computer in any time zone. A test about time zones sets its own.
  // The real-file suites (tests/real-files.ts) are counted when skipped, and the count printed at the end.
  test: { env: { TZ: 'UTC' }, globalSetup: ['tests/setup/real-files-summary.ts'] },
});
