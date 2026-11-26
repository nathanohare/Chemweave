// Puts native ONNX Runtime beside the desktop app, for the structure reader's picture encoder
// (src-tauri/src/recognise_native.rs loads it from ort/ when first needed). Run by
// .github/workflows/desktop.yml before the build, which then bundles ort/ through
// src-tauri/tauri.ort.conf.json. A build without it still works: the reader keeps its
// WebAssembly encoder.
//
// Microsoft's CPU build of ONNX Runtime (MIT licence), taken from its official NuGet package and
// checked against the SHA-256 below before anything is used.
//
//   node scripts/fetch-onnxruntime.mjs windows|linux [nupkg already downloaded]
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const VERSION = '1.31.1';
export const SHA256 = '6871ccbc97f3d5bdb4095a1dcec33aa78d56f6ed8de5980ef5fa1d9f2e7c679a';
export const URL_ = `https://api.nuget.org/v3-flatcontainer/microsoft.ml.onnxruntime/${VERSION}/microsoft.ml.onnxruntime.${VERSION}.nupkg`;
const OUT = 'src-tauri/ort';

/** The files each platform's app takes from the package, and their names beside the app. */
export const FILES = {
  windows: { 'runtimes/win-x64/native/onnxruntime.dll': 'onnxruntime.dll', LICENSE: 'LICENSE.txt' },
  linux: { 'runtimes/linux-x64/native/libonnxruntime.so': 'libonnxruntime.so', LICENSE: 'LICENSE.txt' },
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
}
