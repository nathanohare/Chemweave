// @vitest-environment jsdom
//
// Code review batch 24 (Send Feedback and the error log): each test fails on the code before the fix.

import { describe, expect, it } from 'vitest';
import { issueUrl, mailUrl, relayReport, sendReport } from '../src/feedback';
import { Diagnostics, errorReport, redact } from '../src/diagnostics';
import { memoryStore } from '../src/keep/store';

describe('cutting long feedback never splits an emoji', () => {
  // 😀 is U+1D83D U+DE00 in UTF-16: two code units; encodeURIComponent throws on half of one
  const emoji = '😀';

  it('the GitHub address is made for any cut position', () => {
    for (let pad = 0; pad < 4; pad++) {
      const body = 'a'.repeat(pad) + emoji.repeat(3000);
      const made = issueUrl({ title: 'T', body }, 2500);
      expect(made.cut).toBe(true);
      // reads back without a broken character
      const text = decodeURIComponent(made.url.split('&body=')[1]);
      expect(text).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
      expect(text).toContain('cut here');
    }
  });

  it('the email address is made however the text is cut', () => {
    for (let pad = 0; pad < 4; pad++) {
      const issue = { title: 'T', body: 'a'.repeat(pad) + emoji.repeat(2000) };
      const url = mailUrl(issue, 'team@lab.edu');
      expect(decodeURIComponent(url)).toContain('cut short');
      expect(decodeURIComponent(url.split('&body=')[1])).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    }
  });
});

describe('the send time limit covers the answer\'s text', () => {
  it('an answer that starts and then stalls ends with the plain message instead of waiting forever', async () => {
    const f = { kind: 'problem' as const, title: 'Wedge flips', details: 'x' };
    const stalls = (async (_url: string, init: RequestInit) => ({
      ok: true,
      status: 200,
      // the headers came; the text never does, until the time limit stops it
      json: () => new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))),
    })) as unknown as typeof fetch;
    const out = await Promise.race([
      sendReport(relayReport(f, 'private'), 'https://r.example', stalls, 50).then(() => 'sent', (e: Error) => e.message),
      new Promise<string>((r) => setTimeout(() => r('still waiting'), 2000)),
    ]);
    expect(out).toMatch(/no internet connection/);
  });

  it('a good answer still comes back', async () => {
    const f = { kind: 'problem' as const, title: 'T', details: 'x' };
    const ok = (async () => new Response(JSON.stringify({ number: 3, visibility: 'private' }), { status: 200 })) as unknown as typeof fetch;
    expect(await sendReport(relayReport(f, 'private'), 'https://r.example', ok, 50)).toEqual({ number: 3, visibility: 'private', url: undefined });
  });
});

describe('hiding the person\'s name in paths', () => {
  it('hides all of a Windows account folder that has a space in its name', () => {
    expect(redact('Could not save C:\\Users\\Jane Doe\\Documents\\a.cdxml')).toBe('Could not save ~\\Documents\\a.cdxml');
    expect(redact('C:/Users/Jane Q Doe/AppData/x')).toBe('~/AppData/x');
  });

  it('hides a Mac or Linux home folder with a space', () => {
    expect(redact('at /Users/Jane Doe/Library/x.js')).toBe('at ~/Library/x.js');
    expect(redact('/home/lab tech/b')).toBe('~/b');
  });

  it('does not swallow the words after a folder that has no space', () => {
    expect(redact('C:\\Users\\nate failed to open D:\\x')).toBe('~ failed to open D:\\x');
    expect(redact('/home/nate failed at /etc/x')).toBe('~ failed at /etc/x');
    expect(redact('C:\\Users\\nate: boom')).toBe('~: boom');
  });
});

describe('a report about an error that has left the log', () => {
  it('still carries the error and the newest entries', () => {
    const d = new Diagnostics({ store: memoryStore() });
    const first = d.record('error', 'the first error');
    for (let i = 0; i < 260; i++) d.record('warning', `later ${i}`);
    expect(d.entries).not.toContain(first);
    const text = d.reportText(2500, first);
    expect(text).toContain('the first error');
    expect(text).toContain('later 259');
    expect(errorReport(d, { entry: first }).extra).toContain('the first error');
  });

  it('is as before for an error still in the log', () => {
    const d = new Diagnostics({ store: memoryStore() });
    for (let i = 0; i < 5; i++) d.record('warning', `w${i}`);
    const e = d.record('error', 'now');
    d.record('warning', 'after');
    const text = d.reportText(2500, e);
    expect(text).toContain('now');
    expect(text).not.toContain('after');
  });
});
