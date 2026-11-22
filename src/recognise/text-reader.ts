// Reading the text in a picture (Make Editable on a picture of a scheme: reagents, conditions,
// compound numbers): Tesseract (Apache-2.0), run on this computer in a worker, with its English
// model. Everything it needs comes with the app and loads the first time it is used; nothing
// is sent anywhere.

import type { Pixels } from './picture';
import { lineCrop, textLineBoxes, type ReadLine } from './scheme-extras';
import { rgbaToPng } from '../render/emf-read';
import workerUrl from 'tesseract.js/dist/worker.min.js?url';
import coreUrl from 'tesseract.js-core/tesseract-core-simd-lstm.wasm.js?url';
import engUrl from '@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz?url';

type Worker = Awaited<ReturnType<typeof import('tesseract.js')['createWorker']>>;
let worker: Promise<Worker> | null = null;

function start(): Promise<Worker> {
  worker ??= (async () => {
    const { createWorker, OEM, PSM } = await import('tesseract.js');
    const abs = (u: string) => new URL(u, location.href).href;
    // (the app's own files: no worker made from a blob, nothing fetched from elsewhere; the
    // model's folder, as Tesseract asks for it, is where the app keeps eng.traineddata.gz)
    const w = await createWorker('eng', OEM.LSTM_ONLY, {
      workerPath: abs(workerUrl), corePath: abs(coreUrl), langPath: abs(engUrl).replace(/\/eng\.traineddata\.gz(\?.*)?$/, ''),
      workerBlobURL: false, cacheMethod: 'none', gzip: true,
    });
    await w.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE, preserve_interword_spaces: '1' });
    return w;
  })();
  worker.catch(() => { worker = null; });
  return worker;
}

/** The lines of text in the picture, each word with its box (the picture's pixels) and how sure the reader is (0 to 100). */
export async function readText(p: Pixels): Promise<ReadLine[]> {
  const boxes = textLineBoxes(p);
  if (!boxes.length) return [];
  const w = await start();
  const out: ReadLine[] = [];
  for (const b of boxes) {
    const c = lineCrop(p, b);
    const png = rgbaToPng(new Uint8Array(c.pixels.data.buffer, c.pixels.data.byteOffset, c.pixels.data.byteLength), c.pixels.width, c.pixels.height);
    const r = await w.recognize(new Blob([png as Uint8Array<ArrayBuffer>], { type: 'image/png' }), {}, { blocks: true, text: false });
    const back = (v: number, o: number) => o + v / c.scale;
    for (const blk of r.data.blocks ?? []) for (const para of blk.paragraphs) for (const l of para.lines) {
      out.push({
        words: l.words.map((wd) => ({ t: wd.text, box: [back(wd.bbox.x0, c.x), back(wd.bbox.y0, c.y), back(wd.bbox.x1, c.x), back(wd.bbox.y1, c.y)], c: wd.confidence })),
        base: back((l.baseline.y0 + l.baseline.y1) / 2, c.y),
      });
    }
  }
  return out;
}
