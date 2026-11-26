// What the app's libraries use that WebKit on macOS 12 and older iPads (Safari 15.4) lacks.
// Imported first by the app, its workers and the PDF worker.

type Resolvers = { promise: Promise<unknown>; resolve: (v: unknown) => void; reject: (e: unknown) => void };
const P = Promise as unknown as { withResolvers?: () => Resolvers };

// (Safari 17.4; pdf.js needs it to open a PDF)
P.withResolvers ??= function withResolvers(this: PromiseConstructor): Resolvers {
  let resolve!: Resolvers['resolve'], reject!: Resolvers['reject'];
  const promise = new this<unknown>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

// (Safari 16: boxes, pictures and map boxes are drawn with it)
type Corners = number | number[];
function roundRect(this: CanvasPath, x: number, y: number, w: number, h: number, radii: Corners = 0): void {
  const given = (Array.isArray(radii) ? radii : [radii]).map((n) => Math.max(0, Number(n) || 0));
  const [a, b = a, c = a, d = b] = given.length ? given : [0];
  // top left, top right, bottom right, bottom left, as seen with positive sizes
  let [tl, tr, br, bl] = [a, b, c, d];
  if (w < 0) { x += w; w = -w; [tl, tr, br, bl] = [tr, tl, bl, br]; }
  if (h < 0) { y += h; h = -h; [tl, tr, br, bl] = [bl, br, tr, tl]; }
  const over = (sum: number, side: number) => (sum > 0 ? side / sum : 1);
  const k = Math.min(1, over(tl + tr, w), over(bl + br, w), over(tl + bl, h), over(tr + br, h));
  [tl, tr, br, bl] = [tl * k, tr * k, br * k, bl * k];
  this.moveTo(x + tl, y);
  this.lineTo(x + w - tr, y);
  if (tr) this.arcTo(x + w, y, x + w, y + tr, tr);
  this.lineTo(x + w, y + h - br);
  if (br) this.arcTo(x + w, y + h, x + w - br, y + h, br);
  this.lineTo(x + bl, y + h);
  if (bl) this.arcTo(x, y + h, x, y + h - bl, bl);
  this.lineTo(x, y + tl);
  if (tl) this.arcTo(x, y, x + tl, y, tl);
  this.closePath();
  this.moveTo(x, y);
}
const g = globalThis as unknown as Record<string, { prototype: Record<string | symbol, unknown> } | undefined>;
for (const name of ['CanvasRenderingContext2D', 'OffscreenCanvasRenderingContext2D', 'Path2D']) {
  const proto = g[name]?.prototype;
  if (proto) proto.roundRect ??= roundRect;
}

// (pdf.js reads a page's text with for await over a stream)
const stream = g.ReadableStream?.prototype;
if (stream && !stream[Symbol.asyncIterator]) {
  stream[Symbol.asyncIterator] = async function* (this: ReadableStream<unknown>) {
    const reader = this.getReader();
    let done = false;
    try {
      for (;;) {
        const next = await reader.read();
        if ((done = next.done)) return;
        yield next.value;
      }
    } finally {
      if (!done) void reader.cancel();
      reader.releaseLock();
    }
  };
}

export {};
