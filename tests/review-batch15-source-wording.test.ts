// Review batch 15: wording that lives inside screens too big to open in a test (the main window's
// Undo step names, dialog titles and buttons; ribbons, windows and tooltips). Each row names the
// file, the wording that was wrong (ui-style S26, S27, S70, UI rule 3) and the wording now there.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (f: string): string => readFileSync(join(__dirname, '..', f), 'utf8');

/** [file, wording that was wrong, wording now there] */
type Row = [string, string, string];

const rows: Record<string, Row[]> = {
  'F305 Undo step names in the main window are Title Case': [
    ['src/main.ts', "'Paste table'", "'Paste Table'"], ['src/main.ts', "'Insert table'", "'Insert Table'"], ['src/main.ts', "'Paste text'", "'Paste Text'"],
    ['src/main.ts', "'Insert chart'", "'Insert Chart'"], ['src/main.ts', "'Delete chart'", "'Delete Chart'"], ['src/main.ts', "'Change chart'", "'Change Chart'"],
    ['src/main.ts', "'Audio playback'", "'Audio Playback'"], ['src/main.ts', "'Insert audio'", "'Insert Audio'"], ['src/main.ts', "'Insert video'", "'Insert Video'"],
    ['src/main.ts', "'Insert slide zoom'", "'Insert Slide Zoom'"], ['src/main.ts', "'Action settings'", "'Action Settings'"],
    ['src/main.ts', "'Insert equation'", "'Insert Equation'"], ['src/main.ts', "'Change equation'", "'Change Equation'"],
    ['src/main.ts', "'Name caption'", "'Name Caption'"], ['src/main.ts', "'Paste reaction'", "'Paste Reaction'"],
  ],
  'F318 buttons, step names and dialog titles in the main window': [
    ['src/main.ts', "'Keep source formatting'", "'Keep Source Formatting'"], ['src/main.ts', "'Add keyframe'", "'Add Keyframe'"],
    ['src/main.ts', "'Keyframe from window'", "'Keyframe from Window'"], ['src/main.ts', "'Fit keyframe to selection'", "'Fit Keyframe to Selection'"],
    ['src/main.ts', "'Canvas heading'", "'Canvas Heading'"], ['src/main.ts', "'Add guide'", "'Add Guide'"], ['src/main.ts', "'Add ID label'", "'Add ID Label'"],
    ['src/main.ts', "'Group salt'", "'Group Salt'"], ['src/main.ts', "'Expand text'", "'Expand Text'"], ['src/main.ts', "'Add charge'", "'Add Charge'"],
    ['src/main.ts', "'Read as chemistry'", "'Read as Chemistry'"], ['src/main.ts', "pickDesignSize('Page size'", "pickDesignSize('Page Size'"],
    ['src/main.ts', 'New Design: page size', 'New Design: Page Size'],
  ],
  'F323 style sheet window title': [['src/main.ts', "'Use this style sheet?'", "'Use This Style Sheet?'"]],
  'F333 Show Terminal Methyls window': [
    ['src/main.ts', "ask('Every structure on the page?'", "ask('Change Every Structure on the Page?'"],
    ['src/main.ts', "ok: 'Change every structure'", "ok: 'Change Every Structure'"],
    ['src/main.ts', 'ask again (Edit > Settings)', 'ask again (Edit ▸ Settings ▸ General)'],
  ],
  'F337 the Problems box in Design does not talk about slides': [['src/main.ts', "tab.mode === 'document' || tab.mode === 'sheet' ? 'Double-click a structure to open it in the drawing tools, where each problem is marked.' : 'Each problem is marked on its slide.'", "tab.mode === 'design' ? 'Each problem is marked on the design.'"]],
  'F341 Document Map has one name': [['src/main.ts', "label: 'Navigator'", "label: 'Document Map'"]],
  'F355, F364, F367 editor step names are Title Case': [
    ['src/editor/editor.ts', "'Bend arrow'", "'Bend Arrow'"], ['src/editor/editor.ts', "'Reshape arc'", "'Reshape Arc'"], ['src/editor/editor.ts', "'Crop picture'", "'Crop Picture'"],
    ['src/editor/editor.ts', "'Fuse ring'", "'Fuse Ring'"], ['src/editor/editor.ts', "'Remove attachment atom'", "'Remove Attachment Atom'"],
    ['src/editor/editor.ts', "'Hapto bond'", "'Add Hapto Bond'"], ['src/editor/editor.ts', "'Variable attachment'", "'Add Variable Attachment'"],
    ['src/editor/editor.ts', "'Clean up arrow'", "'Clean Up Arrow'"], ['src/editor/editor.ts', "'S-shaped arrow'", "'S-Shaped Arrow'"], ['src/editor/editor.ts', "'Single-curve arrow'", "'Single-Curve Arrow'"],
    ['src/editor/editor.ts', "'U-turn arrow'", "'U-Turn Arrow'"], ['src/editor/editor.ts', "'Loop arrow'", "'Loop Arrow'"], ['src/editor/editor.ts', "'Flip arrow bend'", "'Flip Arrow Bend'"],
    ['src/editor/editor.ts', "'Attach to structure'", "'Attach to Structure'"], ['src/editor/editor.ts', "'Homolysis arrows'", "'Homolysis Arrows'"],
    ['src/editor/editor.ts', "'Draw next intermediate'", "'Draw Next Intermediate'"], ['src/editor/editor.ts', "'Real 3-D shape'", "'Real 3-D Shape'"],
    ['src/editor/editor.ts', "'Fit frame'", "'Fit Frame'"], ['src/editor/editor.ts', "'Fill rings'", "'Fill Rings'"], ['src/editor/editor.ts', "'Fill color'", "'Fill Color'"],
    ['src/editor/editor.ts', "'Remove highlight'", "'Remove Highlight'"], ['src/editor/editor.ts', "'Ring fill shadow'", "'Ring Fill Shadow'"],
    ['src/editor/editor.ts', "'Smooth highlight'", "'Smooth Highlight'"], ['src/editor/editor.ts', "'Reaction roles'", "'Reaction Roles'"], ['src/editor/editor.ts', "'Reaction step'", "'Reaction Step'"],
    ['src/editor/editor.ts', "'Label alignment'", "'Label Alignment'"], ['src/editor/editor.ts', "'Format text'", "'Format Text'"], ['src/editor/editor.ts', "'Label font'", "'Label Font'"],
    ['src/editor/editor.ts', "'Bold labels'", "'Bold Labels'"], ['src/editor/editor.ts', "'Text direction'", "'Text Direction'"], ['src/editor/editor.ts', "'Edit caption'", "'Edit Text'"],
    ['src/editor/editor.ts', "'Delete caption'", "'Delete Text'"], ['src/editor/editor.ts', "'Type in shape'", "'Type in Shape'"], ['src/editor/editor.ts', "'Add table row'", "'Add Table Row'"],
    ['src/editor/editor.ts', "'Edit table'", "'Edit Table'"],
  ],
  'F418 the charge setting path is in the order a person clicks it': [['src/chem/species.ts', 'Add their charges (Counterions Typed as Text)', 'Counterions Typed as Text ▸ Add their charges']],
  'F660 Attach Descriptors button': [['src/ui/analysis-panel.ts', '>Attach descriptors</button>', '>Attach Descriptors</button>'], ['src/main.ts', "'Attach descriptors'", "'Attach Descriptors'"]],
  'F661 "automatically", not "by themselves"': [
    ['src/ui/analysis-settings.ts', 'Name structures by themselves', 'Name structures automatically'],
    ['src/ui/analysis-settings.ts', 'on PubChem by themselves', 'on PubChem automatically'],
  ],
  'F668 Arrange Scheme check box keeps its label short': [['src/ui/arrange-dialog.ts', "label('Reagents in and by-products out on small arrows (conditions above go in, below come out)', reagents)", "label('Reagents on Small Arrows', reagents)"]],
  'F669 menu path uses ▸': [['src/ui/assistant-bar.ts', "'Edit > Settings > AI Model'", "'Edit ▸ Settings ▸ AI Model'"]],
  'F683 rotate, not turn': [['src/ui/cleanup-picker.ts', 'Turn or flip them all first', 'Rotate or flip them all first']],
  'F684 More Colors…': [['src/ui/colour-picker.ts', "'More colors…'", "'More Colors…'"], ['src/ui/palette-ui.ts', "'More colors…'", "'More Colors…'"]],
  'F721 Standard Key': [['src/ui/key-board.ts', "'Standard key'", "'Standard Key'"]],
  'F722 Key Views instructions behind an "i"': [['src/ui/key-views.ts', '<p class="muted small">Drag to rotate the structure', "addInfo(form.querySelector('h2'), 'Drag to rotate the structure"]],
  'F738 Mode Colors': [['src/ui/mode-colours.ts', '>Use the standard colors<', '>Reset Colors<'], ['src/ui/mode-colours.ts', 'usual look', 'usual style']],
  'F743 Newman color presets': [
    ['src/ui/newman-settings.ts', '>Largest red<', '>Largest Red<'], ['src/ui/newman-settings.ts', '>Red, blue, black<', '>Red, Blue, Black<'], ['src/ui/newman-settings.ts', '>All black<', '>All Black<'],
  ],
  'F744 abbreviation window title': [['src/ui/nickname-chooser.ts', '<h2>Choose an abbreviation</h2>', '<h2>Choose an Abbreviation</h2>']],
  'F755 Edit Palettes…': [['src/ui/palette-ui.ts', "'Edit palettes…' :", "'Edit Palettes…' :"], ['src/ui/palette-ui.ts', "'aria-label', 'Edit palettes'", "'aria-label', 'Color Palettes'"]],
  'F760 Co-Spot Lane': [['src/ui/plate-dialog.ts', '+ Co-spot lane', '+ Co-Spot Lane']],
  'F768 Insert Property Columns': [
    ['src/ui/property-dialog.ts', '>Insert property columns</h2>', '>Insert Property Columns</h2>'], ['src/ui/property-dialog.ts', '<h3>Hammett constants', '<h3>Hammett Constants'],
  ],
  'F770 PubChem caption buttons': [['src/ui/pubchem-panel.ts', '>Name caption<', '>Name Caption<'], ['src/ui/pubchem-panel.ts', '>Hazards caption<', '>Hazards Caption<']],
  'F785 ruler tooltips describe the command': [
    ['src/ui/ruler.ts', 'click the ruler to put one there', 'Tab Type: '], ['src/ui/ruler.ts', "'Click to put a tab stop here", "'Tab Stop (the button at the left"],
  ],
  'F813 status-bar hints say rotate': [['src/ui/tool-help.ts', "'Drag to turn'", "'Drag to rotate'"], ['src/ui/tool-help.ts', 'a tilt handle to turn one way only', 'a tilt handle to rotate it one way only']],
  'F816 a renamed toolbox\'s close button follows the name': [['src/ui/toolboxes.ts', 'Hide ${def.title} (View', "if (close) { close.title = hideTip(def.title);"]],
  'F822 3-D viewer says rotate': [
    ['src/ui/viewer3d.ts', "'Drag to turn,", "'Drag to rotate,"], ['src/ui/viewer3d.ts', "'Turn the model slowly", "'Rotate the model slowly"], ['src/ui/viewer3d.ts', 'Turned the model', 'Rotated the model'],
  ],
  'F974 Spectra link style': [['src/ui/si-mode.ts', "choice(links, 'Look'", "choice(links, 'Link Style'"], ['src/ui/si-mode.ts', "spectrum’s own look", "spectrum’s own settings"]],
  'F992 X-ray tip grammar': [['src/ui/si-xray.ts', 'rotate it, changes its style', 'rotate it or change its style']],
  'F780 the group crumb\'s sentence is behind an "i"': [['src/ui/ribbon-editor.ts', 'crumb.append(back, t);', 'addInfo(nameLabel, tip)']],
  'F782 the ribbon bar\'s sentence is behind an "i"': [['src/ui/ribbon-live.ts', "say.textContent = 'Drag groups or buttons", "addInfo(say, 'Drag groups or buttons"]],
  'F761 the journal source line is behind an "i"': [['src/ui/preflight-pane.ts', "src.textContent = `Rules from", "setInfo(this.sourceInfo, `Rules from"]],
  'F718 Import review explanation behind an "i"': [['src/ui/import-review.ts', "el('p', { className: 'muted', textContent: o.note })", 'addInfo(title, o.note)']],
};

describe('wording in screens too big to open here', () => {
  for (const [name, list] of Object.entries(rows)) {
    it(name, () => {
      for (const [file, was, now] of list) {
        const text = read(file);
        expect(text.includes(now), `${file} should say ${now}`).toBe(true);
        expect(text.includes(was), `${file} still says ${was}`).toBe(false);
      }
    });
  }
});
