// scripts/fetch-onnxruntime.mjs: native ONNX Runtime for the structure reader is taken from the
// package only when the package is exactly the one expected.

import { describe, it, expect } from 'vitest';
// @ts-expect-error a plain JavaScript script
import { extract, FILES, SHA256, URL_, VERSION } from '../scripts/fetch-onnxruntime.mjs';
import { zipSync } from 'fflate';
import { readFileSync } from 'node:fs';

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
