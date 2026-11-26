// Puts native ONNX Runtime beside the desktop app, for the structure reader's picture encoder
// (src-tauri/src/recognise_native.rs loads it from ort/ when first needed). Run by
// .github/workflows/desktop.yml before the build, which then bundles ort/ through
// src-tauri/tauri.ort.conf.json. A build without it still works: the reader keeps its
// WebAssembly encoder.
//
// Microsoft's CPU build of ONNX Runtime (MIT licence), taken from its official NuGet package and
// checked against the SHA-256 below before anything is used. On Windows the library needs the
// Visual C++ runtime (msvcp140, vcruntime140), which a computer may not have; its four DLLs are
// copied beside it from the build machine's Visual Studio redistributable folder (Microsoft lets
// apps carry them), and recognise_native.rs points Windows at that folder while loading.
//
//   node scripts/fetch-onnxruntime.mjs windows|linux [nupkg already downloaded]
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const VERSION = '1.31.1';
export const SHA256 = '6871ccbc97f3d5bdb4095a1dcec33aa78d56f6ed8de5980ef5fa1d9f2e7c679a';
export const URL_ = `https://api.nuget.org/v3-flatcontainer/microsoft.ml.onnxruntime/${VERSION}/microsoft.ml.onnxruntime.${VERSION}.nupkg`;
const OUT = 'src-tauri/ort';

/** The files each platform's app takes from the package, and their names beside the app. */
export const FILES = {
  windows: { 'runtimes/win-x64/native/onnxruntime.dll': 'onnxruntime.dll', LICENSE: 'LICENSE.txt', 'ThirdPartyNotices.txt': 'ThirdPartyNotices.txt' },
  linux: { 'runtimes/linux-x64/native/libonnxruntime.so': 'libonnxruntime.so', LICENSE: 'LICENSE.txt', 'ThirdPartyNotices.txt': 'ThirdPartyNotices.txt' },
};

/** The platform's files from the package's bytes, after checking them. */
export async function extract(nupkg, platform) {
  const want = FILES[platform];
  if (!want) throw new Error(`No ONNX Runtime for ${platform}`);
  const sum = createHash('sha256').update(nupkg).digest('hex');
  if (sum !== SHA256) throw new Error(`The ONNX Runtime package is not the one expected (SHA-256 ${sum})`);
  const { unzipSync } = await import('fflate');
  const got = unzipSync(nupkg, { filter: (f) => f.name in want });
  const out = {};
  for (const [from, to] of Object.entries(want)) {
    if (!got[from]?.length) throw new Error(`${from} is missing from the ONNX Runtime package`);
    out[to] = got[from];
  }
  return out;
}

/** The Visual C++ runtime DLLs onnxruntime.dll imports. */
export const CRT = ['msvcp140.dll', 'msvcp140_1.dll', 'vcruntime140.dll', 'vcruntime140_1.dll'];

/** The x64 Visual C++ runtime folder of a Visual Studio install under `roots` (newest first), or null. */
export function findCrt(roots = ['C:/Program Files/Microsoft Visual Studio', 'C:/Program Files (x86)/Microsoft Visual Studio']) {
  const ls = (d) => { try { return readdirSync(d); } catch { return []; } };
  const found = [];
  for (const root of roots) for (const year of ls(root)) for (const edition of ls(join(root, year))) {
    const msvc = join(root, year, edition, 'VC', 'Redist', 'MSVC');
    for (const ver of ls(msvc)) for (const crt of ls(join(msvc, ver, 'x64'))) {
      const dir = join(msvc, ver, 'x64', crt);
      if (/^Microsoft\.VC\d+\.CRT$/.test(crt) && CRT.every((n) => existsSync(join(dir, n)))) found.push({ ver, dir });
    }
  }
  const num = (v) => v.split('.').map(Number);
  found.sort((a, b) => { const x = num(a.ver), y = num(b.ver); for (let i = 0; i < 4; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0); return 0; });
  return found[0]?.dir ?? null;
}

async function download() {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(URL_);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return new Uint8Array(await r.arrayBuffer());
    } catch (e) {
      if (i >= 4) throw new Error(`Could not download ONNX Runtime: ${e.message}`);
      console.log(`Download failed (${e.message}); trying again in ${i * 10} s`);
      await new Promise((ok) => setTimeout(ok, i * 10000));
    }
  }
}

const run = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (run) {
  const [platform, local] = process.argv.slice(2);
  const files = await extract(local ? readFileSync(local) : await download(), platform);
  mkdirSync(OUT, { recursive: true });
  for (const [name, bytes] of Object.entries(files)) {
    writeFileSync(`${OUT}/${name}`, bytes);
    console.log(`${OUT}/${name} (${bytes.length} bytes)`);
  }
  if (platform === 'windows') {
    const crt = process.env.VC_CRT_DIR || findCrt();
    if (!crt) throw new Error('No Visual C++ runtime folder (VC/Redist/MSVC/*/x64/Microsoft.VC*.CRT) on this machine; set VC_CRT_DIR');
    for (const n of CRT) copyFileSync(join(crt, n), `${OUT}/${n}`);
    console.log(`Visual C++ runtime from ${crt}`);
  }
}
