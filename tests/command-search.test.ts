// Search Commands: finding a command by part of its name.

import { describe, it, expect } from 'vitest';
import { matchScore, searchCommands, uniqueCommands } from '../src/ui/command-search';

const items = [
  { id: 'cmd:save', label: 'Save', place: 'File menu' },
  { id: 'cmd:save-as', label: 'Save As…', place: 'File menu' },
  { id: 'cmd:save-workspace-as', label: 'Save Workspace As…', place: 'File menu' },
  { id: 'cmd:clean-up', label: 'Clean Up Structure', place: 'Structure menu' },
  { id: 'cmd:clean-up-reaction', label: 'Clean Up Reaction', place: 'Structure menu', more: 'Tidy a scheme' },
  { id: 'tool:bond-wedge', label: 'Wedge bond', place: 'Drawing tools' },
  { id: 'sh:cell-bold', label: 'Bold', place: 'Home tab' },
];
const labels = (q: string, recent: string[] = []) => searchCommands(items, q, recent).map((i) => i.label);

describe('search commands', () => {
  it('finds commands by the start of any word, shortest name first', () => {
    expect(labels('save')).toEqual(['Save', 'Save As…', 'Save Workspace As…']);
    expect(labels('clean react')).toEqual(['Clean Up Reaction']);
    expect(labels('wedge')).toEqual(['Wedge bond']);
    expect(labels('react')[0]).toBe('Clean Up Reaction');
  });

  it('also looks at where a command lives and its tool tip, after its name', () => {
    expect(labels('tidy')).toEqual(['Clean Up Reaction']);
    expect(labels('drawing')).toEqual(['Wedge bond']);
    expect(labels('structure')).toEqual(['Clean Up Structure', 'Clean Up Reaction']);
  });

  it('finds nothing when a word matches nothing', () => {
    expect(labels('save zebra')).toEqual([]);
    expect(matchScore(items[0], 'xyz')).toBeNull();
  });

  it('with nothing typed lists everything, the ones used lately first', () => {
    expect(labels('', ['sh:cell-bold', 'cmd:clean-up'])).toEqual(['Bold', 'Clean Up Structure', 'Save', 'Save As…', 'Save Workspace As…', 'Clean Up Reaction', 'Wedge bond']);
  });

  it('puts a name typed in full, then an everyday command, before rarer ones', () => {
    const more = [
      { id: 'cmd:copy-inchi', label: 'Copy as InChI', place: 'Edit menu' },
      { id: 'cmd:copy', label: 'Copy', place: 'Edit menu' },
      { id: 'cmd:copy-smiles', label: 'Copy SMILES', place: 'Edit menu' },
    ];
    expect(searchCommands(more, 'copy').map((c) => c.label)[0]).toBe('Copy');
    expect(searchCommands(more, 'copy smiles').map((c) => c.label)[0]).toBe('Copy SMILES');
  });

  it('lists a command once when it is in a menu and on the ribbon', () => {
    expect(uniqueCommands([{ id: 'cmd:a', n: 1 }, { id: 'cmd:b', n: 2 }, { id: 'cmd:a', n: 3 }])).toEqual([{ id: 'cmd:a', n: 1 }, { id: 'cmd:b', n: 2 }]);
  });
});

describe('former names', () => {
  it('finds a renamed command by its old name', () => {
    const items = [
      { id: 'cmd:distribute-h', label: 'Distribute Horizontally', place: 'Object menu' },
      { id: 'cmd:hotkeys', label: 'Keyboard Shortcuts…', place: 'Edit menu' },
      { id: 'cmd:define-nickname', label: 'Define Abbreviation…', place: 'Structure ▸ Abbreviations and Templates' },
    ];
    expect(searchCommands(items, 'space evenly').map((i) => i.id)).toEqual(['cmd:distribute-h']);
    expect(searchCommands(items, 'hotkeys').map((i) => i.id)).toEqual(['cmd:hotkeys']);
    expect(searchCommands(items, 'nickname').map((i) => i.id)).toEqual(['cmd:define-nickname']);
  });
});

describe('former names of the Blank items (review of F5, R15)', () => {
  const blanks = ['Canvas', 'Document', 'Presentation', 'Spreadsheet', 'Design'].map((m) => ({ id: `cmd:new-${m.toLowerCase()}`, label: `Blank ${m}`, place: 'File ▸ New' }));
  const find = (q: string) => searchCommands(blanks, q).map((i) => i.label);
  it('each old word finds only its own item', () => {
    expect(find('posters')).toEqual(['Blank Design']);
    expect(find('slideshow')).toEqual(['Blank Presentation']);
    expect(find('dashboards')).toEqual(['Blank Spreadsheet']);
    expect(find('chemistry')).toEqual(['Blank Canvas']);
    expect(find('text')).toEqual(['Blank Document']);
  });
});

describe('names written with subscripts', () => {
  const methyls = { id: 'cmd:terminal-methyls', label: 'Terminal Methyls as CH₃', place: 'Structure menu' };
  it('finds them by the plain text typed on a keyboard, and by the subscripts too', () => {
    expect(matchScore(methyls, 'ch3')).not.toBeNull();
    expect(matchScore(methyls, 'CH₃')).not.toBeNull();
    expect(matchScore(methyls, 'methyls as ch3')).toBeGreaterThan(matchScore(methyls, 'methyls')!);
    expect(searchCommands([...items, methyls], 'ch3').map((i) => i.id)).toEqual(['cmd:terminal-methyls']);
    expect(matchScore({ id: 'x', label: 'Show NH₄⁺ Charges', place: '' }, 'nh4+')).not.toBeNull();
  });
});
