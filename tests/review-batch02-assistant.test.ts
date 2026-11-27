// Code review 2026-11-26, batch 02: the Assistant's answers.
//   F030: an answer with a fenced block (a SMILES, a scheme) before its ```json proposal kept no actions.
//   F342: an answer the service cut off at its length limit was shown with no word that it was cut.

import { describe, expect, it } from 'vitest';
import { parseAnswer } from '../src/ai/assistant';
import { answerText, CUT_OFF, type AiPrefs } from '../src/ai/link';

describe('F030: the proposal is the last fenced JSON block', () => {
  it('keeps the actions when an earlier block holds a SMILES', () => {
    const text = 'Try:\n```\nCCO\n```\nDone.\n```json\n{"actions":[{"type":"text","text":"x","replace":false}]}\n```';
    const a = parseAnswer(text);
    expect(a.actions).toEqual([{ type: 'text', text: 'x', replace: false }]);
    // the earlier block stays in the words; the proposal's JSON doesn't
    expect(a.prose).toContain('CCO');
    expect(a.prose).not.toContain('"actions"');
  });

  it('skips a block in another language and a last block that is not JSON', () => {
    const text = '```json\n{"actions":[{"type":"structure","smiles":"CC(=O)O"}]}\n```\nAs a scheme:\n```smiles\nCC(=O)O>>CC(=O)OC\n```';
    expect(parseAnswer(text).actions).toEqual([{ type: 'structure', smiles: 'CC(=O)O', replace: false }]);
    expect(parseAnswer('x\n```json\n{not json}\n```').actions).toEqual([]);
  });

  it('reads Windows line ends, tags such as c++ or JSON5, and skips a block holding only a number', () => {
    const json = '{"actions":[{"type":"text","text":"x","replace":false}]}';
    expect(parseAnswer(`A:\r\n\`\`\`c++\r\nint x;\r\n\`\`\`\r\n\`\`\`JSON5\r\n${json}\r\n\`\`\``).actions).toEqual([{ type: 'text', text: 'x', replace: false }]);
    expect(parseAnswer(`\`\`\`json\n${json}\n\`\`\`\nThe count:\n\`\`\`\n2\n\`\`\``).actions).toEqual([{ type: 'text', text: 'x', replace: false }]);
    expect(parseAnswer('```\n2\n```').actions).toEqual([]);
  });
});

describe('F342: an answer cut at the length limit says so', () => {
  const anthropic: AiPrefs = { provider: 'anthropic', model: '', base: '' };
  const openai: AiPrefs = { provider: 'openai', model: '', base: '' };
  const gemini: AiPrefs = { provider: 'gemini', model: '', base: '' };

  it('adds a note to what came, for each service', () => {
    const half = 'Here it is.\n```json\n{"actions":[{"type":"text","text":"To a solu';
    expect(answerText(anthropic, { content: [{ type: 'text', text: half }], stop_reason: 'max_tokens' })).toBe(`${half}\n\n${CUT_OFF}`);
    expect(answerText(openai, { choices: [{ message: { content: half }, finish_reason: 'length' }] })).toContain(CUT_OFF);
    expect(answerText(gemini, { candidates: [{ content: { parts: [{ text: half }] }, finishReason: 'MAX_TOKENS' }] })).toContain(CUT_OFF);
    // a whole answer is as it came
    expect(answerText(anthropic, { content: [{ type: 'text', text: 'CCO' }], stop_reason: 'end_turn' })).toBe('CCO');
  });

  it('says why when the limit was used up before any text', () => {
    // (a thinking model can spend the whole limit before it writes a word)
    expect(() => answerText(gemini, { candidates: [{ content: { parts: [] }, finishReason: 'MAX_TOKENS' }] })).toThrow(/cut off at the length limit/);
    expect(() => answerText(gemini, { candidates: [{ finishReason: 'MAX_TOKENS' }] })).toThrow(/cut off at the length limit/);
  });
});
