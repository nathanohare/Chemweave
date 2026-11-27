// Slide Show > Record: narration recorded from the microphone while the slides are shown, a
// recording for each slide, put on the slide as a sound that plays by itself as the slide comes
// in, with its icon hidden in the show (as PowerPoint puts recorded narration). Recordings are
// kept as WAV, which PowerPoint and every player can play (the browser records in its own
// format, which PowerPoint can't).

/** The name a narration's sound has (in the Selection Pane and in PowerPoint), which marks it as narration. */
export const NARRATION_NAME = 'Narration';

/** Samples (−1 to 1, one channel) as a 16-bit WAV file. */
export function wavBytes(samples: Float32Array, rate: number): Uint8Array {
  const n = samples.length;
  const out = new Uint8Array(44 + n * 2);
  const v = new DataView(out.buffer);
  const str = (at: number, s: string) => { for (let i = 0; i < s.length; i++) out[at + i] = s.charCodeAt(i); };
  str(0, 'RIFF');
  v.setUint32(4, 36 + n * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // one channel
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const x = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true);
  }
  return out;
}

/** The rate narrations are kept at: clear speech, a quarter of CD size. */
export const NARRATION_RATE = 22050;

/** A recording (in the browser's own format) as WAV, one channel at NARRATION_RATE, and how long it is. */
export async function recordingToWav(blob: Blob): Promise<{ bytes: Uint8Array; seconds: number }> {
  const data = await blob.arrayBuffer();
  const ctx = new AudioContext();
  try {
    const buf = await ctx.decodeAudioData(data);
    const frames = Math.max(1, Math.ceil(buf.duration * NARRATION_RATE));
    const off = new OfflineAudioContext(1, frames, NARRATION_RATE);
    const src = off.createBufferSource();
    src.buffer = buf;
    src.connect(off.destination);
    src.start();
    const mono = await off.startRendering();
    return { bytes: wavBytes(mono.getChannelData(0), NARRATION_RATE), seconds: buf.duration };
  } finally {
    void ctx.close();
  }
}

/** A pause this soon after a piece starts (ms) starts the piece again after the pause instead. */
export const JUST_STARTED_MS = 1000;

/** Records the microphone in pieces: one for each slide, started and finished as the slides change. */
export class Recorder {
  /** The piece being recorded: its own recorder, data and answer, so a finished piece's data, which
   * arrives after the next piece has started, can't end up in that one (found on a Mac, 2026-11-26:
   * every slide got the first slide's sound). */
  private piece: { rec: MediaRecorder; done: Promise<Blob | null> } | null = null;
  private stream: MediaStream | null = null;

  /** Ask for the microphone; false when there is none or it was refused. */
  async open(): Promise<boolean> {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      return true;
    } catch {
      return false;
    }
  }

  /** A piece asked for while paused: its recorder starts when the pause ends. */
  private waiting = false;

  get paused(): boolean { return this.waiting || this.piece?.rec.state === 'paused'; }

  /** When the recorder of this piece started (performance.now). */
  private begunAt = 0;

  /**
   * Start a new piece, or with `paused` get one ready that starts recording when the pause ends.
   * (WebKit on macOS 12 keeps only about 3 seconds of a recording that is paused right after it
   * starts, however long it then records, so a recorder is never started only to be paused at once:
   * found on a Mac, 2026-11-26.)
   */
  start(paused = false): void {
    if (!this.stream) return;
    this.piece = null;
    this.waiting = paused;
    if (!paused) this.begin();
  }

  private begin(): void {
    const stream = this.stream;
    if (!stream) return;
    this.waiting = false;
    this.begunAt = performance.now();
    const rec = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const done = new Promise<Blob | null>((resolve) => {
      rec.onstop = () => resolve(chunks.length ? new Blob(chunks, { type: rec.mimeType }) : null);
    });
    this.piece = { rec, done };
    rec.start();
  }

  pause(on: boolean): void {
    if (!on && this.waiting) { this.begin(); return; }
    const rec = this.piece?.rec;
    if (!rec) return;
    // paused just after it started (the 3, 2, 1 before the first slide): nothing worth keeping was
    // said, so this recorder goes and a new one starts when the pause ends
    if (on && rec.state === 'recording' && performance.now() - this.begunAt < JUST_STARTED_MS) {
      rec.stop();
      this.piece = null;
      this.waiting = true;
      return;
    }
    if (on && rec.state === 'recording') rec.pause();
    else if (!on && rec.state === 'paused') rec.resume();
  }

  /** Finish the piece being recorded: what was said (null when nothing was). */
  finish(): Promise<Blob | null> {
    const piece = this.piece;
    this.piece = null;
    this.waiting = false;
    if (!piece) return Promise.resolve(null);
    // (a recorder the browser has stopped by itself, a microphone unplugged, still has what it caught)
    if (piece.rec.state !== 'inactive') piece.rec.stop();
    return piece.done;
  }

  close(): void {
    for (const t of this.stream?.getTracks() ?? []) t.stop();
    this.stream = null;
  }
}
