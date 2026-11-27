// @vitest-environment jsdom
// Code review 2026-11-26, batch 18: the Assistant bar. F149 (a "Will send" item that starts off can
// be turned on and stays on when the question is sent), F150 (two questions in a row: each answer
// is shown, no "Thinking…" is left), F670 (Accept can be tried again after a failure), F671 (a
// card's Undo only takes back its own proposal).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssistantBar, type AssistantHost } from '../src/ui/assistant-bar';
import { clearRequestLog, type AssistantAction, type SendItem } from '../src/ai/assistant';
import type { AiPrefs } from '../src/ai/link';

const tick = () => new Promise((r) => setTimeout(r, 0));

interface Setup {
  bar: AssistantBar;
  applied: AssistantAction[];
  undo: ReturnType<typeof vi.fn>;
  /** Move the history position (something else was done on the page). */
  step: () => void;
  said: { value: string };
  items: SendItem[];
}

function setup(items: SendItem[], applyOutcome: () => string = () => 'Drew the structure.'): Setup {
  const prefs: AiPrefs = { provider: 'compatible', model: 'qwen3', base: 'http://localhost:11434/v1', localOnly: true, assistant: true };
  const applied: AssistantAction[] = [];
  let at = 0;
  const undo = vi.fn();
  const tab = {};
  const host: AssistantHost = {
    prefs: () => prefs,
    savePrefs: () => {},
    mode: () => 'document',
    items: async () => items.map((i) => ({ ...i })),
    apply: async (a) => { applied.push(a); const said = applyOutcome(); if (/^(Replaced|Drew|Added)/.test(said)) at++; return said; },
    markStep: () => true,
    undo,
    position: () => [at],
    openSettings: async () => {},
    area: () => new DOMRect(0, 0, 1000, 700),
    tab: () => tab,
  };
  return { bar: new AssistantBar(host), applied, undo, step: () => { at++; }, said: { value: '' }, items };
}

const reply = (text: string) => new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
const proposal = (smiles: string) => `A structure.\n\n\`\`\`json\n{"actions":[{"type":"structure","smiles":"${smiles}"}]}\n\`\`\``;
const click = (bar: AssistantBar, label: string, nth = 0) => {
  const b = [...bar.el.querySelectorAll('button')].filter((x) => x.textContent === label)[nth];
  if (!b) throw new Error(`no ${label} button`);
  b.click();
};
const ask = (bar: AssistantBar, text: string) => {
  const ta = bar.el.querySelector('textarea')!;
  ta.value = text;
  click(bar, 'Send');
};

afterEach(() => { vi.unstubAllGlobals(); clearRequestLog(); document.body.replaceChildren(); });

describe('F149: a "Will send" item that starts off can be turned on', () => {
  it('sends the whole-document text after its chip was clicked on', async () => {
    const fetch = vi.fn(async () => reply('Fine.'));
    vi.stubGlobal('fetch', fetch);
    const s = setup([{ id: 'document', label: "the whole document's text", text: 'WHOLE DOCUMENT BODY', on: false }]);
    await s.bar.show();
    const chip = () => [...s.bar.el.querySelectorAll<HTMLButtonElement>('.ai-chip')].find((c) => c.textContent === "the whole document's text")!;
    expect(chip().getAttribute('aria-pressed')).toBe('false');
    chip().click();
    expect(chip().getAttribute('aria-pressed')).toBe('true');
    ask(s.bar, 'Summarize it');
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(JSON.stringify((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body)).toContain('WHOLE DOCUMENT BODY');
    // and the chip still shows it on after the question went
    expect(chip().getAttribute('aria-pressed')).toBe('true');
  });
  it('still leaves out an item that starts on and was clicked off', async () => {
    const fetch = vi.fn(async () => reply('Fine.'));
    vi.stubGlobal('fetch', fetch);
    const s = setup([{ id: 'text', label: 'the selected text', text: 'SELECTED WORDS', on: true }]);
    await s.bar.show();
    [...s.bar.el.querySelectorAll<HTMLButtonElement>('.ai-chip')].find((c) => c.textContent === 'the selected text')!.click();
    ask(s.bar, 'Tighten it');
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(JSON.stringify((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body)).not.toContain('SELECTED WORDS');
  });
});

describe('F150: a second question while the first is out', () => {
  it('shows both answers and leaves no "Thinking…"', async () => {
    const waiting: ((r: Response) => void)[] = [];
    const fetch = vi.fn(() => new Promise<Response>((r) => { waiting.push(r); }));
    vi.stubGlobal('fetch', fetch);
    const s = setup([]);
    await s.bar.show();
    ask(s.bar, 'First question');
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    ask(s.bar, 'Second question');
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    waiting[0](reply('Answer to the first.'));
    waiting[1](reply('Answer to the second.'));
    await vi.waitFor(() => expect(s.bar.el.textContent).toContain('Answer to the second.'));
    expect(s.bar.el.textContent).toContain('Answer to the first.');
    expect(s.bar.el.textContent).not.toContain('Thinking…');
  });
  it('sends one question when Enter is pressed twice', async () => {
    const fetch = vi.fn(async () => reply('Once.'));
    vi.stubGlobal('fetch', fetch);
    const s = setup([]);
    await s.bar.show();
    const ta = s.bar.el.querySelector('textarea')!;
    ta.value = 'Only once';
    const enter = () => ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    enter();
    enter();
    await vi.waitFor(() => expect(s.bar.el.textContent).toContain('Once.'));
    await tick();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(ta.value).toBe('');
  });
});

describe('F670: Accept can be tried again after it failed', () => {
  it('re-enables Accept and Reject when the structure was not drawn', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply(proposal('CCO'))));
    let ready = false;
    const s = setup([], () => (ready ? 'Drew the structure.' : 'The chemistry engine is still loading. Try again in a moment.'));
    await s.bar.show();
    ask(s.bar, 'Draw ethanol');
    await vi.waitFor(() => expect(s.bar.el.querySelector('.ai-prop')).not.toBeNull());
    click(s.bar, 'Accept');
    await tick();
    const accept = [...s.bar.el.querySelectorAll('button')].find((b) => b.textContent === 'Accept')!;
    const reject = [...s.bar.el.querySelectorAll('button')].find((b) => b.textContent === 'Reject')!;
    expect(s.bar.el.textContent).toContain('Try again in a moment');
    expect(accept.disabled).toBe(false);
    expect(reject.disabled).toBe(false);
    ready = true;
    accept.click();
    await tick();
    expect(s.applied).toHaveLength(2);
    expect(accept.disabled).toBe(true);
    expect([...s.bar.el.querySelectorAll('button')].some((b) => b.textContent === 'Undo')).toBe(true);
  });
});

describe('F671: the card\'s Undo takes back its own proposal only', () => {
  async function accepted() {
    vi.stubGlobal('fetch', vi.fn(async () => reply(proposal('CCO'))));
    const s = setup([]);
    await s.bar.show();
    ask(s.bar, 'Draw ethanol');
    await vi.waitFor(() => expect(s.bar.el.querySelector('.ai-prop')).not.toBeNull());
    click(s.bar, 'Accept');
    await tick();
    return s;
  }
  it('undoes the proposal while it is still the last step', async () => {
    const s = await accepted();
    click(s.bar, 'Undo');
    expect(s.undo).toHaveBeenCalledOnce();
    expect(s.bar.el.textContent).toContain('Undone.');
  });
  it('does not undo a later change, and says so', async () => {
    const s = await accepted();
    s.step(); // something else was drawn after the proposal
    click(s.bar, 'Undo');
    expect(s.undo).not.toHaveBeenCalled();
    expect(s.bar.el.textContent).not.toContain('Undone.');
    expect(s.bar.el.textContent).toContain('Something else was changed after this');
    expect([...s.bar.el.querySelectorAll('button')].some((b) => b.textContent === 'Undo')).toBe(false);
  });
});
