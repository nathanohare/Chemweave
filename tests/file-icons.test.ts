// The icon SI project files (.chemsi) show in Explorer, Finder and Linux file managers: every
// platform's installer settings point at icon files that are there, in the sizes each needs, and
// the lists of file types kept in several places stay in step.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { JSDOM } from 'jsdom';
// @ts-expect-error a plain JavaScript script
import { LINUX_SIZES, ICO_SIZES } from '../scripts/make-file-icons.mjs';

const TAURI = 'src-tauri/';
const json = (f: string) => JSON.parse(readFileSync(TAURI + f, 'utf8'));
type Assoc = { ext: string[]; name: string; mimeType: string; role: string; rank: string };

/** The types in src-tauri/src/file_types.rs's TYPES list. */
function rustTypes(): string[] {
  const src = readFileSync(TAURI + 'src/file_types.rs', 'utf8');
  const list = /pub const TYPES[^=]*=\s*&\[([\s\S]*?)\];/.exec(src)![1];
  return [...list.matchAll(/\("([a-z]+)",/g)].map((m) => m[1]);
}

/** A property list (the subset Info.plist files use) as plain values. */
function plist(xml: string): unknown {
  const doc = new JSDOM(xml, { contentType: 'text/xml' }).window.document;
  const value = (el: Element): unknown => {
    const kids = [...el.children];
    switch (el.tagName) {
      case 'dict': {
        const o: Record<string, unknown> = {};
        for (let i = 0; i < kids.length; i += 2) o[kids[i].textContent!] = value(kids[i + 1]);
        return o;
      }
      case 'array': return kids.map(value);
      case 'string': return el.textContent;
      case 'true': return true;
      case 'false': return false;
      default: throw new Error(`plist: ${el.tagName}`);
    }
  };
  return value(doc.documentElement.firstElementChild!);
}

/** The picture sizes in a Windows .ico (its directory: 0 means 256). */
function icoSizes(buf: Buffer): number[] {
  expect(buf.readUInt16LE(2)).toBe(1);
  return Array.from({ length: buf.readUInt16LE(4) }, (_, i) => buf.readUInt8(6 + 16 * i) || 256);
}

/** The parts of a macOS .icns, by their four-letter type. */
function icnsTypes(buf: Buffer): string[] {
  expect(buf.toString('ascii', 0, 4)).toBe('icns');
  expect(buf.readUInt32BE(4)).toBe(buf.length);
  const types: string[] = [];
  for (let at = 8; at < buf.length; at += buf.readUInt32BE(at + 4)) types.push(buf.toString('ascii', at, at + 4));
  return types;
}

/** A PNG's width and height. */
const pngSize = (buf: Buffer) => [buf.readUInt32BE(16), buf.readUInt32BE(20)];

describe('SI project file icon', () => {
  it('Windows: the app carries the icon and writes it to its own folder', () => {
    const src = readFileSync(TAURI + 'src/file_types.rs', 'utf8');
    expect(src).toContain('pub const OWN_ICONS: &[(&str, &str, &[u8])] = &[("chemsi", "chemsi.ico", include_bytes!("../icons/chemsi.ico"))];');
    // the folder in %LOCALAPPDATA% is the app's own (its id), which the uninstaller tidies
    const id = json('tauri.conf.json').identifier;
    expect(src).toContain(`pub const IDENTIFIER: &str = "${id}";`);
    expect(readFileSync(TAURI + 'windows/hooks.nsh', 'utf8')).toContain(`Delete "$LOCALAPPDATA\\${id}\\chemsi.ico"`);
    expect(icoSizes(readFileSync(TAURI + 'icons/chemsi.ico')).sort((a, b) => a - b)).toEqual(ICO_SIZES);
    expect(ICO_SIZES).toEqual(expect.arrayContaining([16, 24, 32, 48, 256]));
  });

  it('Windows: uninstalling forgets every file type the app can register', () => {
    const nsh = readFileSync(TAURI + 'windows/hooks.nsh', 'utf8');
    const forgotten = [...nsh.matchAll(/!insertmacro CI_FORGET_TYPE "([a-z]+)"/g)].map((m) => m[1]);
    expect(forgotten.sort()).toEqual(rustTypes().sort());
  });

  it('macOS: every file type keeps its place, and .chemsi is declared with its icon', () => {
    const conf = json('tauri.macos.conf.json').bundle;
    expect(conf.macOS.infoPlist).toBe('Info.macos.plist');
    expect(conf.macOS.files).toEqual({ 'Resources/chemsi.icns': 'icons/chemsi.icns' });
    const info = plist(readFileSync(TAURI + 'Info.macos.plist', 'utf8')) as Record<string, Record<string, unknown>[]>;
    // the list here replaces the one Tauri writes from fileAssociations, so it must say the same
    const assoc = conf.fileAssociations as Assoc[];
    expect(info.CFBundleDocumentTypes.map((d) => [d.CFBundleTypeExtensions, d.CFBundleTypeName, d.CFBundleTypeRole, d.LSHandlerRank]))
      .toEqual(assoc.map((a) => [a.ext, a.name, a.role, a.rank]));
    expect(assoc.map((a) => a.ext[0]).sort()).toEqual(rustTypes().sort());
    const si = info.CFBundleDocumentTypes.find((d) => (d.CFBundleTypeExtensions as string[])[0] === 'chemsi')!;
    const exported = info.UTExportedTypeDeclarations;
    expect(exported).toHaveLength(1);
    expect(si.LSItemContentTypes).toEqual([exported[0].UTTypeIdentifier]);
    expect(si.CFBundleTypeIconFile).toBe('chemsi.icns');
    expect(exported[0].UTTypeIconFile).toBe('chemsi.icns');
    expect(exported[0].UTTypeTagSpecification).toEqual({
      'public.filename-extension': ['chemsi'],
      'public.mime-type': assoc.find((a) => a.ext[0] === 'chemsi')!.mimeType,
    });
    // the same parts as the app's own icon, which Finder already shows well
    const types = (f: string) => icnsTypes(readFileSync(TAURI + 'icons/' + f)).sort();
    expect(types('chemsi.icns')).toEqual(types('icon.icns'));
  });

  it('Linux: the .deb and .rpm install the file type and its icon in every size', () => {
    const conf = json('tauri.linux.conf.json').bundle;
    const files = conf.linux.deb.files as Record<string, string>;
    expect(conf.linux.rpm.files).toEqual(files);
    const mime = (conf.fileAssociations as Assoc[]).find((a) => a.ext[0] === 'chemsi')!.mimeType;
    const iconName = mime.replace('/', '-');
    for (const px of LINUX_SIZES) {
      const src = files[`/usr/share/icons/hicolor/${px}x${px}/mimetypes/${iconName}.png`];
      expect(src, `${px} px`).toBe(`icons/chemsi-${px}.png`);
      expect(pngSize(readFileSync(TAURI + src))).toEqual([px, px]);
    }
    expect(files[`/usr/share/icons/hicolor/scalable/mimetypes/${iconName}.svg`]).toBe('icons/chemsi.svg');
    for (const src of Object.values(files)) expect(existsSync(TAURI + src), src).toBe(true);
    const xml = new JSDOM(readFileSync(TAURI + files['/usr/share/mime/packages/chemweave.xml'], 'utf8'), { contentType: 'text/xml' }).window.document;
    const type = xml.querySelector('mime-type')!;
    expect(type.getAttribute('type')).toBe(mime);
    expect(type.querySelector('glob')!.getAttribute('pattern')).toBe('*.chemsi');
    expect(type.querySelector('icon')!.getAttribute('name')).toBe(iconName);
    expect(type.querySelector('comment')!.textContent).toBe('Chemweave SI project');
  });
});
