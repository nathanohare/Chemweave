// Slide Show ▸ Record on a Mac (macOS 12, 2026-11-26) kept only 3.0 s of every slide's narration:
// that WebKit keeps only about 3 seconds of a MediaRecorder paused right after start(), however
// long it then records (the Record countdown paused it at once; so did a slide shown while paused).
// The Recorder now never starts a recorder only to pause it: a piece asked for while paused waits,
// and a pause just after a start drops that recorder and starts a new one when the pause ends.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Recorder, JUST_STARTED_MS } from '../src/deck/narration';

type Call = [number, string];
let calls: Call[];
let made = 0;
class FakeRecorder {
  state: 'inactive' | 'recording' | 'paused' = 'inactive';
  mimeType = 'audio/mp4';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  id = ++made;
  start() { this.state = 'recording'; calls.push([this.id, 'start']); }
  pause() { this.state = 'paused'; calls.push([this.id, 'pause']); }
  resume() { this.state = 'recording'; calls.push([this.id, 'resume']); }
  stop() {
    this.state = 'inactive';
    calls.push([this.id, 'stop']);
    // (as in WebKit: the data and the stop arrive later, after the next piece may have started)
    setTimeout(() => { this.ondataavailable?.({ data: new Blob([`piece ${this.id}`]) }); this.onstop?.(); }, 5);
  }
}

let now = 0;
beforeEach(async () => {
  calls = [];
  made = 0;
  now = 0;
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) } });
});

async function opened(): Promise<Recorder> {
  const r = new Recorder();
  expect(await r.open()).toBe(true);
  return r;
}

describe('narration recorder: never paused right after it starts', () => {
  it('a piece started while paused waits, and records from when the pause ends', async () => {
    const r = await opened();
    r.start(true);
    expect(calls).toEqual([]);
    expect(r.paused).toBe(true);
    now = 3000;
    r.pause(false);
    expect(calls).toEqual([[1, 'start']]);
    now = 10_000;
    await expect(r.finish()).resolves.toBeInstanceOf(Blob);
    expect(calls.map((c) => c[1])).not.toContain('pause');
  });

  it('the countdown pausing a piece that just started drops that recorder and starts a fresh one after', async () => {
    const r = await opened();
    r.start();
    now = 50;
    r.pause(true);
    expect(calls).toEqual([[1, 'start'], [1, 'stop']]);
    expect(r.paused).toBe(true);
    now = 3050;
    r.pause(false);
    expect(calls.at(-1)).toEqual([2, 'start']);
    await expect(r.finish()).resolves.toBeInstanceOf(Blob);
    expect(calls.map((c) => c[1])).not.toContain('pause');
  });

  it('a pause in the middle of a piece is an ordinary pause', async () => {
    const r = await opened();
    r.start();
    now = JUST_STARTED_MS + 3000;
    r.pause(true);
    now += 2000;
    r.pause(false);
    expect(calls).toEqual([[1, 'start'], [1, 'pause'], [1, 'resume']]);
  });

  it('finishing a piece that never started gives nothing', async () => {
    const r = await opened();
    r.start(true);
    await expect(r.finish()).resolves.toBeNull();
    expect(r.paused).toBe(false);
  });
});

describe('narration recorder: each slide keeps its own sound', () => {
  it("a finished piece's data, arriving after the next piece started, stays with its own piece", async () => {
    const r = await opened();
    r.start();
    now = 4000;
    const one = r.finish();
    r.start();
    now = 13_000;
    const two = r.finish();
    const [a, b] = await Promise.all([one, two]);
    expect(await a!.text()).toBe('piece 1');
    expect(await b!.text()).toBe('piece 2');
  });
});
