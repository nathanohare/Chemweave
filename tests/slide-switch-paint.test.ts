// @vitest-environment jsdom
// Presentation (Nate's findings of 2026-11-23, Presentation 1): going to another slide flickered,
// because its picture was painted a few squares (tiles) per frame and the rest of the window
// showed empty until they came. The slide shown is now painted whole on the next frame.
import { it, expect } from 'vitest';
import { Doc } from '../src/model';
import { Editor } from '../src/editor/editor';
import { Renderer } from '../src/render/renderer';

window.requestAnimationFrame = () => 0;

it('paints a slide just shown whole, then goes back to painting tile by tile', () => {
  const scene = document.createElement('canvas'), overlay = document.createElement('canvas'), host = document.createElement('div');
  host.append(scene, overlay); document.body.append(host);
  const r = new Renderer(scene, overlay);
  const ed = new Editor(new Doc(), r, host);
  const budgets: number[] = [];
  r.renderScene = (_doc: Doc, budget = Infinity) => { budgets.push(budget); };
  // (only the drawing's paint is looked at here; jsdom's canvases can't draw the overlay)
  Object.assign(ed, { drawOverlay: () => undefined });
  ed.requestWholeScene();
  ed.frame();
  ed.requestScene();
  ed.frame();
  expect(budgets).toEqual([Infinity, 10]);
});
