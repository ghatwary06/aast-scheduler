import { describe, expect, test, vi } from 'vitest';
import { buildPrompt, rulesFromText, type FetchLike } from '../../src/app/gemini';
import { defaultRules } from '../../src/app/rulesModel';
import { sept24 } from '../fixtures/sept24';

const reply = (status: number, rules: unknown) => ({
  ok: status === 200,
  status,
  text: async () =>
    status === 200 ? JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ rules }) }] } }] }) : 'quota exceeded',
});
const good = [{ id: 'no910', strength: 'must', kind: 'bannedPeriods', from: 9, to: 10, days: [] }];

describe('buildPrompt', () => {
  test('includes courses, groups, the current registration, current rules and the request', () => {
    const p = buildPrompt('no 9-10 please', sept24, defaultRules());
    expect(p).toContain('CCS2201 "Introduction to Networks": groups C, D, F, H, I, K, L, M, O, Extra (currently K)');
    expect(p).toContain('"id":"days-off"');
    expect(p).toContain('no 9-10 please');
  });
});

describe('rulesFromText', () => {
  test('returns validated rules and sends the key in a header, not the URL', async () => {
    const fetchFn = vi.fn<FetchLike>(async () => reply(200, good));
    const r = await rulesFromText('no 9-10', sept24, [], 'KEY123', ['m1'], fetchFn);
    expect(r).toEqual({ ok: true, rules: good, model: 'm1' });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/m1:generateContent');
    expect(url).not.toContain('KEY123');
    expect(init.headers['x-goog-api-key']).toBe('KEY123');
  });

  test('falls back to the next model on 429', async () => {
    const fetchFn = vi.fn<FetchLike>().mockResolvedValueOnce(reply(429, null)).mockResolvedValueOnce(reply(200, good));
    const r = await rulesFromText('no 9-10', sept24, [], 'k', ['m1', 'm2'], fetchFn);
    expect(r.ok && r.model).toBe('m2');
  });

  test('rejects invalid rules from Gemini instead of applying them', async () => {
    const fetchFn = vi.fn<FetchLike>(async () => reply(200, [{ id: 'x', strength: 'must', kind: 'keepGroup', course: 'NOPE', group: 'A' }]));
    const r = await rulesFromText('keep nope', sept24, [], 'k', ['m1'], fetchFn);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toContain('unknown course "NOPE"');
  });

  test('non-JSON output is an error; a missing key makes no request', async () => {
    const chatty = vi.fn<FetchLike>(async () => ({
      ok: true,
      status: 200,
      text: async () => '{"candidates":[{"content":{"parts":[{"text":"sure! here you go"}]}}]}',
    }));
    expect((await rulesFromText('x', sept24, [], 'k', ['m1'], chatty)).ok).toBe(false);
    const never = vi.fn<FetchLike>();
    expect(await rulesFromText('x', sept24, [], '  ', ['m1'], never)).toEqual({ ok: false, errors: ['No Gemini API key set (Settings).'] });
    expect(never).not.toHaveBeenCalled();
  });
});
