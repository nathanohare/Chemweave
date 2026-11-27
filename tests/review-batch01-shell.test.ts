// Code review 2026-11-26, batch 01 (the app shell: paste, drop, Batch Convert and command plumbing).
// main.ts runs the whole app when imported, so these read its source: each fix must stay in
// place (each check fails on the code the review found). Behavior that lives in other files is
// tested for real in review-batch01-units.test.ts.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';

const main = readFileSync(join(__dirname, '..', 'src/main.ts'), 'utf8').replace(/\r\n/g, '\n');

/** The text of a top-level function (or of what starts with `start`), to its closing brace. */
function body(name: string, start = `function ${name}(`): string {
  const at = main.indexOf(start);
  expect(at, name).toBeGreaterThan(-1);
  return main.slice(at, main.indexOf('\n}\n', at) + 2);
}
/** The text of a listener or other block starting with `start`, to the first line that is `end`. */
function block(start: string, end = '\n});\n'): string {
  const at = main.indexOf(start);
  expect(at, start).toBeGreaterThan(-1);
  return main.slice(at, main.indexOf(end, at) + end.length);
}
/** One entry of the COMMANDS table, `'name': ...` up to the next entry at the same depth. */
function command(name: string): string {
  const at = main.indexOf(`\n  '${name}': `);
  expect(at, name).toBeGreaterThan(-1);
  const next = main.slice(at + 1).search(/\n {2}'[a-z0-9-]+': /);
  return main.slice(at, at + 1 + next);
}
/** A function of main.ts made runnable, with what it uses from the rest of the app passed in. */
function runnable<T>(src: string, name: string, deps: Record<string, unknown>): T {
  const js = ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  return new Function(...Object.keys(deps), `${js}; return ${name};`)(...Object.values(deps)) as T;
}

describe('F018, F019: drops and pastes the SI Project took are not done again on the drawing behind it', () => {
  // (what the window does with each file and each paste is tested in review-batch01-units.test.ts)
  it('the window drop listener always cancels a file drop, and leaves files a drop zone took', () => {
    const b = block("window.addEventListener('drop', (e) => {");
    expect(b.indexOf('e.preventDefault()')).toBeLessThan(b.indexOf('if (filesTaken(e)) return;'));
    expect(b.indexOf('if (filesTaken(e)) return;')).toBeLessThan(b.indexOf('dropFiles('));
    expect(body('dropFiles', 'async function dropFiles(')).toContain('fileDropAction(f.name, !!mime, where)');
  });
  it('every SI Project drop zone that uses the files says so', () => {
    for (const f of ['src/ui/si-mode.ts', 'src/ui/si-manuscript.ts', 'src/ui/si-attachment.ts']) {
      const src = readFileSync(join(__dirname, '..', f), 'utf8');
      const uses = src.split("addEventListener('drop'").length - 1;
      const files = src.split('dataTransfer?.files').length - 1;
      expect(src.split('markFilesTaken(e);').length - 1, f).toBe(files);
      expect(uses, f).toBeGreaterThanOrEqual(files);
    }
  });
  it('the window paste listener asks pasteTarget', () => {
    const b = block("window.addEventListener('paste', (e) => {");
    expect(b).toContain('const to = pasteTarget({ typing: isTyping(e.target)');
    expect(b).toContain('taken: e.defaultPrevented, si: siActive()');
    expect(b.indexOf("if (to === 'none') return;")).toBeLessThan(b.indexOf('e.preventDefault()'));
  });
});

describe('F020: a pasted reaction stays selected whole', () => {
  it('its arrow and + signs stay selected with its structures before it is kept on the page', () => {
    const b = body('pasteReaction', 'async function pasteReaction(');
    expect(b).not.toContain('selectNewAtoms(made)');
    expect(b).toMatch(/selectPastedReaction\(made, caps, arrows\);\s*\n\s*await keepPasteInside\(\)/);
    const sel = body('selectPastedReaction');
    expect(sel).toMatch(/captions: new Set\(captions\.filter/);
    expect(sel).toMatch(/arrows: new Set\(arrows\.filter/);
  });
});

describe('F021: a slide guide being dragged is drawn where it is dragged', () => {
  it('the slide page draws the dragged view while a guide is dragged', () => {
    expect(main).toContain('const v = guideDrag?.view ?? d.settings.view;');
  });
});

describe('F022: Fit Keyframe to Selection keeps the keyframe\'s own settings', () => {
  it('the new framing is merged into the keyframe, not put in its place', () => {
    expect(main).toContain('const key = { ...k.c.keys[k.i], ...keyframeAround(box, k.d.size), id: k.c.keys[k.i].id };');
  });
});

describe('F023: a burst of pictures loading is one redraw', () => {
  it('the picture-loaded listener waits for the burst before repainting the slide list', () => {
    const b = block('onImageReady(() => {');
    expect(b).toMatch(/if \(imagesReadyTimer\) return;/);
    expect(b.indexOf('setTimeout')).toBeLessThan(b.indexOf('slideList.refreshAll()'));
  });
});

describe('F024: Drawing Style changes the default for new files only when its box was changed', () => {
  it('the default is cleared only when the file\'s style was the default (the box was ticked)', () => {
    const b = body('drawingStyleCommand', 'const got = await editDrawingStyle({');
    expect(b).toContain('else if (modeStyleFor(mode) === current.name) {');
    expect(b).not.toContain('|| modeStyleFor(mode) === got.style.name) {');
  });
});

describe('F025, F026: Batch Convert', () => {
  const b = body('batchConvert', 'async function batchConvert(');
  it('offers a SMILES list as a .smi file, not .zip', () => {
    expect(b).toContain("const saveAs = format === 'smi' ? 'smi' : 'zip';");
    expect(b).toContain('withExtension(files[0].name, saveAs)');
    expect(b).not.toContain("withExtension(files[0].name, 'zip') : 'converted.zip', format === 'smi'");
  });
  it('into a folder, never writes over a file already there', () => {
    expect(b).toContain('const taken = (name: string) => pathExists(inFolder(name));');
    expect(b).toContain('const name = await freeBatchName(o.stem, format, used, taken);');
    expect(b).toContain("await freeBatchName('converted', 'smi', used, taken)");
    expect(b).not.toContain('`${folder}/converted.smi`');
  });
});

describe('F027: Picture Style redraws and marks the file changed', () => {
  it('finishes typing first and calls editor.changed() after its edit', () => {
    const b = body('setPictureStyle');
    expect(b.indexOf('finishTyping()')).toBeLessThan(b.indexOf("doc.edit('Picture style'"));
    expect(b.indexOf('editor.changed()')).toBeGreaterThan(b.indexOf("doc.edit('Picture style'"));
  });
});

describe('F028: clearing the selection stops an analysis still running from filling the panel', () => {
  it('the empty-selection path moves the run count on', () => {
    const b = body('runAnalysis', 'async function runAnalysis(');
    const empty = b.slice(b.indexOf('if (!frags.length) {'));
    expect(empty.slice(0, empty.indexOf('return;'))).toContain('analysisSeq++');
  });
});

describe('F029: Outline View remakes only the slide being edited', () => {
  it('each frame after a change refreshes the current slide, and waits for a drag to end', () => {
    expect(main).toContain('if (outlineView.shown && doc.version !== outlineSeen && !editor.dragging) { outlineSeen = doc.version; outlineView.refresh(deckNow()?.index ?? 0); }');
  });
});

describe('F304: Cut deletes what it copied', () => {
  it('copies a snapshot of the selection, checks the drawing after the copy and deletes that snapshot', () => {
    const b = body('cut', 'async function cut(');
    const wait = b.indexOf('await copyDrawing(doc, took)');
    expect(wait).toBeGreaterThan(-1);
    expect(b.slice(0, wait)).toContain("sameDrawing('The cut', 'done')");
    const after = b.slice(wait);
    expect(after.indexOf('if (here.left()) return;')).toBeLessThan(after.indexOf('editor.deleteSelection()'));
    expect(after.indexOf('editor.sel = { atoms: keep(took.atoms')).toBeLessThan(after.indexOf('editor.deleteSelection()'));
  });
});

describe('F306, F307: the 3-D Model\'s Place on Page', () => {
  const b = body('show3dModel', 'async function show3dModel(');
  it('works only on the drawing and the structure the model was built from', () => {
    expect(b.indexOf("sameDrawing('The 3-D view', 'placed')")).toBeLessThan(b.indexOf('await model3d.build'));
    const place = b.slice(b.indexOf("viewer3d.show(m, '3-D Model', async (v) => {"));
    expect(place.indexOf('if (here.left()) return;')).toBeLessThan(place.indexOf("doc.edit('3-D Rotation'"));
    expect(place).toMatch(/compoundKey\(doc\.fragmentOf\(root\)\) !== key\) \{ flash\('The structure has changed/);
  });
  it('takes back the rotation only while it is still the last change', () => {
    const place = b.slice(b.indexOf("doc.edit('3-D Rotation'"));
    expect(place).toContain('const placed = doc.topStep, history = deckNow()?.historyLength;');
    const undo = place.indexOf('editor.undo()');
    expect(place.slice(0, undo)).toContain('if (!here.left() && doc.topStep === placed && deckNow()?.historyLength === history) {');
  });
  it('compares what the structure is, not its wedges or places, so a placed view can be placed again', () => {
    // a key built the way compoundKey builds it, on a drawing made here
    const atoms = new Map([[1, { z: 6, label: null, charge: 0, isotope: 0 }], [2, { z: 8, label: null, charge: 0, isotope: 0 }]]);
    const bonds = new Map([[5, { a1: 1, a2: 2, order: 1, display: 'plain' }]]);
    const doc = { atoms, bonds, adj: new Map([[1, [5]], [2, [5]]]) };
    const key = runnable<(ids: Iterable<number>) => string>(body('compoundKey'), 'compoundKey', { doc });
    const before = key([1, 2]);
    bonds.get(5)!.display = 'wedge';
    expect(key([1, 2])).toBe(before);
    atoms.get(2)!.z = 7;
    expect(key([1, 2])).not.toBe(before);
  });
});

describe('F308: a picture being placed goes when another tab or slide comes up', () => {
  it('its pointer handlers end the placement, without swallowing the click, once the drawing changed', () => {
    const b = body('placeWithPointer');
    expect(b).toContain('const gone = () => ws.active !== tab || doc.contentsKey !== key0;');
    expect(b).toMatch(/const move = \(e: PointerEvent\) => \{ if \(gone\(\)\) done\(null\);/);
    const down = b.slice(b.indexOf('const down = '));
    expect(down.indexOf('if (gone()) { done(null); return; }')).toBeLessThan(down.indexOf('e.preventDefault()'));
  });
});

describe('F309: a linked Newman projection left waiting is worked out when its drawing shows again', () => {
  it('the delayed run and the run after the conformer search keep it for its own drawing', () => {
    expect(block('editor.onNewmanStale = (frames) => {', '\n};\n')).toContain('if (doc.contentsKey !== key) newmanWhenShown(key, id);');
    const redo = body('redoNewman', 'async function redoNewman(');
    expect(redo.indexOf('if (doc.contentsKey !== key) { newmanWhenShown(key, id); return; }')).toBeLessThan(redo.indexOf('editor.putNewmanProjection'));
    expect(block('editor.onFrame = () => {', '\n};\n')).toContain('redoWaitingNewman();');
  });
});

describe('F310: two asks for one structure\'s name run the namer once', () => {
  it('a second ask while the first runs gets the same answer', async () => {
    let runs = 0;
    let finish!: () => void;
    const confirmedName = () => { runs++; return new Promise((res) => { finish = () => res({ ok: true, name: 'ethanol' }); }); };
    const nameStates = new Map(), namesRunning = new Map();
    const nameOf = runnable<(s: string, m: string) => Promise<{ kind: string; name?: string }>>(body('nameOf'), 'nameOf', { nameStates, namesRunning, namer: { ready: true }, confirmedName, nameTools: {} });
    const a = nameOf('CCO', 'mol'), b = nameOf('CCO', 'mol');
    await Promise.resolve();
    finish();
    expect(await a).toEqual({ kind: 'found', name: 'ethanol' });
    expect(await b).toEqual({ kind: 'found', name: 'ethanol' });
    expect(runs).toBe(1);
    await Promise.resolve();
    expect(namesRunning.size).toBe(0);
  });
});

describe('F311: Lock Structures turns on only where structures can be locked', () => {
  it('outside slides it says why and does not press the button', () => {
    const b = body('toggleStructureLock');
    expect(b.indexOf("if (!slides && !structuresLocked) { flash('Lock Structures works on slides")).toBeLessThan(b.indexOf('structuresLocked = !structuresLocked'));
  });
});

describe('F312: Action Settings is offered for the shapes it works on', () => {
  it('the can-run check leaves out every data frame, as actionSettings does', () => {
    const at = main.indexOf("case 'action-settings': {");
    const c = main.slice(at, main.indexOf('}\n', main.indexOf('return ok', at)));
    expect(c).toContain("s.kind === 'geo' && !isDataFrame(s)");
    expect(c).not.toContain('!s.diagram && !s.energy');
  });
});

describe('F313, F319: commands that wait on the chemistry engine check the drawing after it', () => {
  const guarded = (b: string, wait: string, use: string) => {
    const w = b.indexOf(wait);
    expect(w, wait).toBeGreaterThan(-1);
    expect(b.slice(0, w)).toContain('sameDrawing(');
    const after = b.slice(w);
    expect(after.indexOf('here.left()'), wait).toBeGreaterThan(-1);
    expect(after.indexOf('here.left()'), wait).toBeLessThan(after.indexOf(use));
  };
  it('Expand Label after loading the ligands and after each SMILES', () => {
    const b = body('expandLabel', 'async function expandLabel(');
    guarded(b, 'await loadFullLigands()', 'editor.expandableLabels()');
    guarded(b, 'await chem.smilesToMol(', 'editor.expandLabels(');
  });
  it('Number Compounds after the structure keys', () => guarded(body('numberCompounds', 'async function numberCompounds('), 'await structureKeys()', 'editor.numberCompounds('));
  it('Clean Up Structure, Smart Clean and Clean Up Options after the engine layouts', () => {
    guarded(body('cleanUpStructures', 'async function cleanUpStructures('), 'await engineLayouts()', 'editor.cleanUp(');
    guarded(body('smartClean', 'async function smartClean('), 'await engineLayouts()', 'editor.smartCleanScheme(');
    guarded(body('cleanUpChoices', 'async function cleanUpChoices('), 'await engineLayouts()', 'editor.cleanUpChoices(');
  });
  it('Contract Label after looking up the built-in names', () => guarded(body('contractLabel', 'async function contractLabel('), 'await builtInNamesFor(', 'editor.contractLabel('));
  it('Orient Like First after comparing the structures', () => guarded(body('orientLikeFirst', 'async function orientLikeFirst('), 'await chem.common(', 'doc.atoms.get('));
});

describe('F314: Map Atoms is one undo step, and changes the box look only when it maps', () => {
  it('the look is put in the drawing inside the Map Atoms edit, after the check for a step', () => {
    const b = body('mapAtomsCommand', 'async function mapAtomsCommand(');
    expect(b).not.toContain('setMapLook(');
    expect(b).not.toContain('mapFormatCommand(');
    const none = b.indexOf("if (!res.steps) { flash('No reaction step to map");
    const edit = b.indexOf("doc.edit('Map Atoms', () => {");
    expect(none).toBeGreaterThan(-1);
    expect(edit).toBeGreaterThan(none);
    expect(b.slice(edit)).toMatch(/^doc\.edit\('Map Atoms', \(\) => \{\n\s*if \(look\) putMapLook\(look\.look, look\.box\);/);
  });
});

describe('F315: Name to Structure skips a text box deleted during its lookup', () => {
  it('reads each text box again before placing its structure', () => {
    const b = body('nameToStructure', 'async function nameToStructure(');
    const edit = b.slice(b.indexOf("doc.edit('Name to Structure'"));
    expect(edit).toMatch(/const cap = doc\.captions\.get\(f\.cap\.id\);\s*\n\s*if \(!cap\) continue;\s*\n\s*const box = renderer\.captionBox\(cap\);/);
  });
});

describe('F316: Copy as Molfile Text on an empty drawing says why instead of copying an empty molfile', () => {
  it('checks for atoms before copying', () => {
    const b = body('copyMolfile');
    expect(b.indexOf('if (!atoms.length) { flash(WHY.copy);')).toBeLessThan(b.indexOf('toMolfile('));
  });
});

describe('F317: the Scale window reads its boxes with scaleFactor', () => {
  it('uses the shared reading of the Size and bond length boxes', () => {
    const b = body('scaleDialog', 'async function scaleDialog(');
    expect(b).toContain('const f = scaleFactor(r.pct, r.len, shown, L);');
  });
});

describe('F320, F321: Orient Like First', () => {
  it('a failed comparison is said once, not followed by "Nothing to rotate"', () => {
    const b = body('orientLikeFirst', 'async function orientLikeFirst(');
    expect(b).toContain("if (!pairs) { flash('Could not compare the structures.'); return 'failed'; }");
    expect(command('orient-like')).toMatch(/if \(m === 'failed' \|\| m === 'left'\) return;/);
  });
  it('the turns are made by the caller: Clean Up and Orient Reaction turns and tidies in one undo step', () => {
    expect(body('orientLikeFirst', 'async function orientLikeFirst(')).not.toContain('editor.reorient(');
    const c = command('clean-up-reaction-orient');
    // (Editor.cleanUpAndOrient, one undo step: review-batch01-units.test.ts)
    expect(c).toContain('const tidied = editor.cleanUpAndOrient(moves);');
    expect(c).toContain("else if (tidied === 'fitted') flash(");
    // (turned but nothing else to tidy is not "nothing to clean up")
    expect(c).toContain('if (!tidied && !turned');
  });
});

describe('F322: the Undo button after a stereo-inverting flip undoes only the flip', () => {
  it('undoes only while nothing has changed since the flip', () => {
    const b = body('flipped');
    expect(b).toContain('const still = () => doc.contentsKey === key && doc.topStep === step && deckNow()?.historyLength === history;');
    expect(b).toContain('run: () => { if (still()) undo(); else flash(');
  });
});

describe('F324: Clear Timings and Clear Narration act on the slides picked where they show', () => {
  it('reads the picked slides through pickedSlides (Slide Sorter\'s own in Slide Sorter)', () => {
    const b = body('clearTargets');
    expect(b).toContain('pickedSlides()');
    expect(b).not.toContain('slideList.picked');
  });
});

describe('F325, F326: narration recorded while rehearsing', () => {
  const b = block('presenter.onRehearsed = (r) => {', '\n  };\n');
  it('is not put in a presentation closed while the recordings were read', () => {
    const closed = b.indexOf('if (!ws.tabs.some((t) => t.deck === d))');
    expect(closed).toBeGreaterThan(b.indexOf('await recordingToWav'));
    expect(closed).toBeLessThan(b.indexOf("d.editSlides('Record Narration'"));
  });
  it('joins the narration and the timings into one undo step', () => {
    expect(b.indexOf('history = d.historyLength;')).toBeLessThan(b.indexOf("d.editSlides('Record Narration'"));
    expect(b.indexOf("d.joinSince(history, 'Record Slide Show Timings')")).toBeGreaterThan(b.indexOf('d.setTimings('));
  });
});

describe('F327: Print splits each canvas slide once', () => {
  it('the slides\' pages are kept and read again for each keyframe', () => {
    const b = body('printNow', 'async function printNow(');
    expect(b).toContain('const slide = (i: number, k = 0) => { const p = pagesOf(i)[k];');
    expect(b).toContain('deck.slides.flatMap((_, i) => pagesOf(i).map(');
  });
});

describe('F328: Export Picture with a keyframe picked that is gone', () => {
  it('takes the last keyframe there is, and says so when there is none', () => {
    const b = body('exportPicture', 'async function exportPicture(');
    expect(b).toContain('const at = split[Math.min(deck.current?.canvas ? canvasKeys.picked(deck) : 0, split.length - 1)];');
    expect(b).toContain("if (!at) { flash('There is nothing to export yet.'); return; }");
  });
});

describe('F329: CDXML text on the clipboard that can\'t be read is pasted as text', () => {
  it('no paste path reads clipboard CDXML without catching what the reader throws', () => {
    expect(main).not.toContain('drawingOf(readCdxml(text).doc)');
    const read = runnable<(t: string) => unknown>(body('cdxmlOnClipboard'), 'cdxmlOnClipboard', { readCdxml: () => { throw new Error('not CDXML'); } });
    expect(read('<?xml version="1.0"?><CDXML><page')).toBeNull();
  });
});

describe('F330: Add to SI Project with several structures is one undo step', () => {
  it('the structures are added inside one journal step', () => {
    const b = body('addStructureToSi', 'async function addStructureToSi(');
    expect(b).toContain("await (j ? j.step('Add from Canvas', addAll) : addAll());");
  });
});

describe('F331: every SI project changed reaches the documents linked to it', () => {
  it('changes to two projects close together both reach the documents', async () => {
    const calls: (string | null)[] = [];
    let timer: (() => void) | null = null;
    const window = { setTimeout: (f: () => void) => { timer = f; return 1; } };
    const deps = { siBump: () => {}, siChangedPaths: new Set<string | null>(), window, clearTimeout: () => {}, docModeLoading: true, docMode: { siChanged: (p: string | null) => calls.push(p) }, siChangeTimer: 0 };
    const src = body('siChanged').replace(/\bsiChangeTimer = /, 'deps.siChangeTimer = ');
    const siChanged = runnable<(p: string | null) => void>(src, 'siChanged', { ...deps, deps });
    siChanged('A.chemsi');
    siChanged('B.chemsi');
    timer!();
    expect(calls).toEqual(['A.chemsi', 'B.chemsi']);
    calls.length = 0;
    siChanged('A.chemsi');
    siChanged(null);
    timer!();
    expect(calls).toEqual([null]);
  });
});

describe('F332: Text Guides on a mix of plain reaction arrows and other arrows', () => {
  it('decides for each arrow against its own default', () => {
    expect(command('text-guides')).toContain('editor.setArrowGuides(ids, on, plainReactionArrow);');
  });
});

describe('F334: the Feedback page picture keeps to 2000 px a side', () => {
  it('uses pagePictureDpi, which has no floor', () => {
    expect(main).toContain('const dpi = pagePictureDpi(side);');
    expect(main).not.toContain('Math.max(48, (2000 / side) * 72)');
  });
});

describe('F335: changing Outline the Rest of a Group redraws', () => {
  it('asks for a redraw when the option changed', () => {
    expect(main).toContain("if (editor.options.groupOutline !== (r.groupOutline === 'true')) { editor.options.groupOutline = r.groupOutline === 'true'; editor.requestOverlay(); }");
  });
});

describe('F336: a descriptor text box whose structure can\'t be weighed is not sent again and again', () => {
  it('the structure tried is remembered and skipped until it changes', () => {
    const b = body('refreshDescriptors', 'async function refreshDescriptors(');
    expect(b.indexOf('if (descriptorFailed.get(drawing)?.get(c.id) === sig) continue;')).toBeLessThan(b.indexOf('await weighed(atoms)'));
    // (only what the engine answered it can't weigh: not loaded yet, or stopped, is asked again)
    expect(b).toMatch(/if \(!r\) \{\n.*\n\s*if \(!refused\) continue;\n\s*const tried = descriptorFailed\.get\(drawing\)/);
    const w = body('weighed', 'async function weighed(');
    expect(w).toContain("if (!chem.ready || !atoms.size) return { r: null, refused: false };");
    expect(w).toContain('{ r: null, refused: !!r }');
  });
});

describe('F338: Check Structure steps through the problems the Warnings box lists', () => {
  it('both read one list, text boxes included', () => {
    expect(body('checkStructure')).toContain('for (const w of drawingProblems()) {');
    expect(body('updateWarnings')).toContain('const list = drawingProblems();');
    const p = body('drawingProblems');
    expect(p).toContain('labelWarnings');
    expect(p).toContain('captionChemWarning(');
    expect(body('checkStructure')).toContain("w.kind === 'bond' ? editor.sel.bonds : editor.sel.captions");
  });
  it('a text box\'s problem is gone to when it is the only one', () => {
    const revealed: [string, number][] = [];
    const flashed: string[] = [];
    const deps = {
      drawingProblems: () => [{ kind: 'caption', id: 7, text: ['BF4 is an ion: give it its charge (BF4⁻).'] }],
      ignoredProblems: () => 0,
      flash: (m: string) => flashed.push(m),
      editor: { sel: { atoms: new Set(), bonds: new Set(), captions: new Set() }, reveal: (k: string, id: number) => revealed.push([k, id]) },
    };
    runnable<() => void>(body('checkStructure'), 'checkStructure', deps)();
    expect(revealed).toEqual([['caption', 7]]);
    expect(flashed[0]).toMatch(/^1 of 1: BF4/);
  });
  it('a text box with two problems is one stop, so pressing again moves on to the next problem', () => {
    const revealed: [string, number][] = [];
    const sel = { atoms: new Set<number>(), bonds: new Set<number>(), captions: new Set<number>() };
    const deps = {
      drawingProblems: () => [{ kind: 'atom', id: 1, text: ['Too many bonds.'] }, { kind: 'caption', id: 7, text: ['Two structures share this number.'] }, { kind: 'caption', id: 7, text: ['Give the ion its charge.'] }],
      ignoredProblems: () => 0,
      flash: () => {},
      // (reveal selects what it shows, as the editor's does)
      editor: { sel, reveal: (k: string, id: number) => { revealed.push([k, id]); sel.atoms.clear(); sel.captions.clear(); (k === 'atom' ? sel.atoms : sel.captions).add(id); } },
    };
    const check = runnable<() => void>(body('checkStructure'), 'checkStructure', deps);
    check(); check(); check();
    expect(revealed).toEqual([['atom', 1], ['caption', 7], ['atom', 1]]);
  });
});

describe('F339, F340: Reading Mode and Format Favorites read through their helpers', () => {
  it('Reading Mode keeps the palette picked when it is named', () => {
    expect(body('darkColours', 'async function darkColours(')).toContain('readingPaletteToKeep(');
  });
  it('Rename of a favorite never removes another favorite', () => {
    const at = main.indexOf("['Rename…', async () => {");
    const b = main.slice(at, main.indexOf('\n    }],', at));
    expect(b).not.toContain('favorites.filter((x) => x.name !== name)');
    expect(b).toContain('renamedFavorite(favorites, f.name, name)');
  });
});
