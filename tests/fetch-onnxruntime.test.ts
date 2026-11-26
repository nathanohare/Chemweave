// scripts/fetch-onnxruntime.mjs: native ONNX Runtime for the structure reader is taken from the
// package only when the package is exactly the one expected.

import { describe, it, expect } from 'vitest';
// @ts-expect-error a plain JavaScript script
import { extract, FILES, SHA256, URL_, VERSION, CRT, findCrt } from '../scripts/fetch-onnxruntime.mjs';
import { zipSync } from 'fflate';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('fetching ONNX Runtime', () => {
  it('refuses a package that is not the one expected', async () => {
    const fake = zipSync({ 'runtimes/win-x64/native/onnxruntime.dll': new Uint8Array([1]), LICENSE: new Uint8Array([2]) });
    await expect(extract(fake, 'windows')).rejects.toThrow(/not the one expected/);
  });

  it('knows only the platforms the app bundles it for', async () => {
    expect(Object.keys(FILES).sort()).toEqual(['linux', 'windows']);
    await expect(extract(new Uint8Array(), 'macos')).rejects.toThrow(/No ONNX Runtime for macos/);
  });

  it('asks Microsoft\'s NuGet package for the version it checks', () => {
    expect(SHA256).toMatch(/^[0-9a-f]{64}$/);
    expect(URL_).toBe(`https://api.nuget.org/v3-flatcontainer/microsoft.ml.onnxruntime/${VERSION}/microsoft.ml.onnxruntime.${VERSION}.nupkg`);
  });

  it('finds the newest Visual C++ runtime folder with all four DLLs', () => {
    const root = mkdtempSync(join(tmpdir(), 'vs-'));
    const make = (ver: string, crt: string, names: string[]) => {
      const d = join(root, '2022', 'Enterprise', 'VC', 'Redist', 'MSVC', ver, 'x64', crt);
      mkdirSync(d, { recursive: true });
      for (const n of names) writeFileSync(join(d, n), 'x');
      return d;
    };
    make('14.38.33135', 'Microsoft.VC143.CRT', CRT);
    const newest = make('14.44.35112', 'Microsoft.VC143.CRT', CRT);
    make('14.50.1', 'Microsoft.VC143.CRT', CRT.slice(1)); // newer but incomplete
    make('14.44.35112', 'Microsoft.VC143.OpenMP', CRT); // not the C++ runtime
    expect(findCrt([root])).toBe(newest);
    expect(findCrt([join(root, 'nothing')])).toBe(null);
  });

  it('ships the licence and third-party notices of ONNX Runtime with it', () => {
    for (const p of ['windows', 'linux'] as const) {
      expect(Object.values(FILES[p])).toContain('LICENSE.txt');
      expect(Object.values(FILES[p])).toContain('ThirdPartyNotices.txt');
    }
  });

  it('bundles what the build fetches, under the names the app loads', () => {
    // tauri.ort.conf.json bundles ort/; recognise_native.rs loads onnxruntime.dll / libonnxruntime.so from it
    const conf = JSON.parse(readFileSync('src-tauri/tauri.ort.conf.json', 'utf8'));
    expect(conf.bundle.resources).toEqual({ 'ort/*': 'ort/' });
    const rust = readFileSync('src-tauri/src/recognise_native.rs', 'utf8');
    expect(rust).toContain(`"${FILES.windows['runtimes/win-x64/native/onnxruntime.dll']}"`);
    expect(rust).toContain(`"${FILES.linux['runtimes/linux-x64/native/libonnxruntime.so']}"`);
    expect(rust).toContain('join("ort")');
  });
});
