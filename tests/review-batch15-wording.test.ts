// @vitest-environment jsdom
//
// Review batch 15: wording and small-fix findings in Canvas, chemistry, SI and shell screens
// (ui-style S26, S27, S29, S70, UI rule 3). Each test reads what a person reads.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { COMMAND_NAMES } from '../src/editor/keymap';
import { BEVELS } from '../src/render/shape-fx';
import { CYCLE_PRESETS } from '../src/chem/cycles';
import { DIAGRAM_LAYOUTS } from '../src/design/diagrams';
import { ENERGY_PRESETS } from '../src/design/energy';
import { minusText } from '../src/ui/minus-text';
import { torsionText } from '../src/ui/newman-dialog';
import { sampleSpectrumData, spectrumSvg } from '../src/ui/nmr-spectrum';
import { casHtml } from '../src/ui/cas-panel';
import { pubchemHtml } from '../src/ui/pubchem-panel';
import { MAX_FILE_BYTES, reportListing, reportWithoutReading } from '../src/si/ms-reports';
import { statusColorsBody } from '../src/ui/si-dashboard';
import { STATUS_KEYS } from '../src/si/dashboard';
import { hideTip } from '../src/ui/toolboxes';
import { MemoryFolder } from '../src/si/folder';
import { SiProject } from '../src/si/project';
import { listTrash, restoreFromTrash } from '../src/si/trash';
import { CORE_FIELDS, LIBRARY_FIELDS } from '../src/si/fields';

describe('command names (F374, F375)', () => {
  it('write the nuclei with raised numbers, as S27 asks', () => {
    expect(COMMAND_NAMES['nmr-1h']).toBe('NMR: Show ¹H');
    expect(COMMAND_NAMES['nmr-13c']).toBe('NMR: Show ¹³C');
  });
  it('are Title Case names, not sentences', () => {
    expect(COMMAND_NAMES['zoom-in']).toBe('Zoom In');
    expect(COMMAND_NAMES['ui-scale-out']).toBe('Interface Size: Smaller');
    expect(COMMAND_NAMES['ui-scale-reset']).toBe('Interface Size: Reset to 100%');
    expect(COMMAND_NAMES['edit-note']).toBe('Edit Note');
    expect(COMMAND_NAMES['make-figures']).toBe('Make All Structures Figures…');
  });
});

describe('American spelling and Office names in what is shown (F394, F427, F429, F912)', () => {
  it('the Wacker cycle blurb says reoxidizes', () => {
    const wacker = CYCLE_PRESETS.find((p) => p.id === 'wacker')!;
    expect(wacker.blurb).toContain('reoxidizes Pd(0)');
    expect(wacker.blurb).not.toMatch(/ise/);
  });
  it('the Block list sample says Characterization', () => {
    expect(DIAGRAM_LAYOUTS.find((l) => l.id === 'blocks')!.sample).toContain('Characterization');
  });
  it('the catalyzed pathway is named catalyzed', () => {
    const names = ENERGY_PRESETS.find((p) => p.id === 'catalysed')!.data.paths.map((p) => p.name);
    expect(names).toEqual(['uncatalyzed', 'catalyzed']);
  });
  it('the first Bevel is Office\'s Circle', () => {
    expect(BEVELS[0]).toEqual({ id: 'circle', name: 'Circle' });
  });
});

describe('minus signs (F740, F748)', () => {
  it('minusText puts U+2212 in front of a negative number only', () => {
    expect(minusText(-60)).toBe('\u221260');
    expect(minusText('-0.5')).toBe('\u22120.5');
    expect(minusText(60)).toBe('60');
  });
  it('a negative torsion in the Newman list uses it', () => {
    const c = { view: { dihedral: -60 } } as unknown as Parameters<typeof torsionText>[0];
    expect(torsionText(c).startsWith('\u221260°')).toBe(true);
  });
  it('the ppm axis and the cursor label use it', () => {
    const d = sampleSpectrumData(400, false);
    const svg = spectrumSvg(d, { w: 600, h: 200, hi: 1, lo: -1, labels: false, hotRow: null, cursor: -0.25 });
    expect(svg).toContain('>\u22120.4<');
    expect(svg).toContain('>\u22120.250<');
    expect(svg).not.toMatch(/>-\d/);
  });
});

describe('buttons (F680, F770)', () => {
  it('the CAS retry says Try Again in both states, and the caption button is Title Case', () => {
    expect(casHtml({ kind: 'none', message: 'x' } as never, 0).row).toContain('>Try Again<');
    expect(casHtml({ kind: 'found', cas: ['64-17-5'], from: 'PubChem', name: 'ethanol' } as never, 0).button).toContain('>CAS Caption<');
  });
  const found = {
    cid: 702, title: 'Ethanol', iupac: 'ethanol', cas: ['64-17-5'], meltingPoint: ['-114 °C'], boilingPoint: [], density: [],
    hazards: { signal: 'Danger', pictograms: [], statements: [{ code: 'H225', text: 'Highly flammable' }] },
  };
  it('the PubChem caption buttons are Title Case', () => {
    const html = pubchemHtml({ kind: 'found', c: found } as never, 0);
    for (const b of ['>Name Caption<', '>CAS Caption<', '>Hazards Caption<']) expect(html).toContain(b);
  });
  it('the PubChem helper sentence sits behind an "i", not on a line of its own (F769)', () => {
    const html = pubchemHtml({ kind: 'found', c: found } as never, 0);
    expect(html).not.toContain('<p class="muted small">Measured values');
    expect(html).toContain('data-info="Measured values as each source reports them."');
  });
});

describe('Status Colors (F961)', () => {
  it('clicking the words "No color" toggles that row\'s check box', () => {
    const colors = Object.fromEntries(STATUS_KEYS.map((k) => [k, '#336699'])) as never;
    const { el, read } = statusColorsBody(colors);
    document.body.append(el);
    const row = el.querySelector('.si-dash-color')!;
    expect(row.tagName).toBe('DIV');
    const none = row.querySelector<HTMLInputElement>('input[type=checkbox]')!;
    const label = none.closest('label')!;
    expect(label.classList.contains('si-dash-none')).toBe(true);
    expect(none.checked).toBe(false);
    label.click();
    expect(none.checked).toBe(true);
    expect(Object.values(read())[0]).toBe('');
  });
});

describe('HRMS report listing (F930, F933)', () => {
  it('a file over the size limit says it is too large, not damaged', () => {
    const big = { length: MAX_FILE_BYTES + 1 } as unknown as Uint8Array;
    const [lines] = reportListing(big, 'huge.txt');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/too large/);
    expect(lines[0]).not.toMatch(/damaged/);
  });
  it('raw-data messages say Chemweave, not "this program"', () => {
    const m = reportWithoutReading('sample.raw', { folder: false })!;
    expect(m.message).toContain("Chemweave can't read");
    expect(m.message).not.toContain('this program');
  });
});

describe('Trash (F958)', () => {
  const FIXTURE = join(__dirname, 'fixtures', 'si-example');
  function folder(): MemoryFolder {
    const f = new MemoryFolder('Example project');
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (name !== 'README.md') f.files.set(relative(FIXTURE, p).split('\\').join('/'), new Uint8Array(readFileSync(p)));
      }
    };
    walk(FIXTURE);
    return f;
  }
  it('a known kind that can\'t be put back is "This <kind>", with a singular "It"', async () => {
    const f = folder();
    const p = await SiProject.open(f);
    f.files.set('trash/20261101-120000-aaaa/entry.json', new TextEncoder().encode('{"kind": "scheme_file", "name": "paper.png", "item": "paper.png"}'));
    f.files.set('trash/20261101-120000-aaaa/paper.png', new Uint8Array([1]));
    const [e] = await listTrash(p);
    await expect(restoreFromTrash(p, e.id)).rejects.toThrow(/^This scheme picture can't be put back here\. It is still/);
  });
  it('an unknown kind is "This kind of item", not "items"', async () => {
    const f = folder();
    const p = await SiProject.open(f);
    f.files.set('trash/20261101-120000-bbbb/entry.json', new TextEncoder().encode('{"kind": "hologram", "name": "x", "item": "x"}'));
    f.files.set('trash/20261101-120000-bbbb/x', new Uint8Array([1]));
    const [e] = await listTrash(p);
    await expect(restoreFromTrash(p, e.id)).rejects.toThrow(/^This kind of item can't be put back here\. It is still/);
  });
});

describe('placeholders show real subscripts (F923)', () => {
  it('the spectrum and optical rotation placeholders', () => {
    const all = JSON.stringify([CORE_FIELDS, LIBRARY_FIELDS]);
    expect(all).toContain('¹H NMR (400 MHz, CDCl₃)');
    expect(all).toContain('¹H NMR (CDCl₃, 400 MHz)');
    expect(all).toContain('"placeholder":"CHCl₃"');
    expect(all).not.toMatch(/placeholder":"[^"]*(CDCl3|CHCl3)/);
  });
});

describe('a renamed toolbox\'s close button (F816)', () => {
  it('names the toolbox it hides', () => {
    expect(hideTip('Chem')).toBe('Hide Chem (View ▸ Toolboxes shows it again)');
  });
});
