// @vitest-environment jsdom
import { describe, expect, test, vi } from 'vitest';
import { mountApp } from '../../src/app/app';
import type { FetchLike } from '../../src/app/gemini';
import { memoryStore } from '../../src/app/storage';
import type { Dataset } from '../../src/core/types';
import { sept24 } from '../fixtures/sept24';

const text = (el: Element) => el.textContent ?? '';
const sample = (): Dataset => JSON.parse(JSON.stringify(sept24));

describe('app', () => {
  test('starts empty; the example data gives 57 schedules with the default rules', async () => {
    const root = document.createElement('div');
    const app = await mountApp(root, memoryStore());
    expect(text(root)).toContain('No timetable data yet');
    await app.loadDataset(sample());
    expect(text(root)).toContain('57 schedules');
    expect(root.querySelectorAll('article.card')).toHaveLength(57);
  });

  test('marking a group full re-solves and persists', async () => {
    const store = memoryStore();
    const root = document.createElement('div');
    const app = await mountApp(root, store);
    await app.loadDataset(sample());
    (root.querySelector('button[title="Mark Introduction to Networks K as full"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(text(root)).toContain('50 schedules'));
    expect(await store.get('excluded')).toEqual({ CCS2201: ['K'] });
  });

  test('rules and data persist across reloads', async () => {
    const store = memoryStore();
    const app = await mountApp(document.createElement('div'), store);
    await app.loadDataset(sample());
    await app.setRules([
      { id: 'off', strength: 'must', kind: 'daysOff', minOff: 3, mustOff: [] },
      { id: 'g', strength: 'must', kind: 'gaps', maxTotal: 0, maxPerDay: 0, maxSingle: 99 },
    ]);
    const root2 = document.createElement('div');
    await mountApp(root2, store);
    expect(text(root2)).toContain('8 schedules');
  });

  test('Gemini text replaces the rules and highlights what changed', async () => {
    const rules = [
      { id: 'days-off', strength: 'must', kind: 'daysOff', minOff: 3, mustOff: [] },
      { id: 'no910', strength: 'must', kind: 'bannedPeriods', from: 9, to: 10, days: [] },
    ];
    const fetchFn: FetchLike = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ rules }) }] } }] }),
    });
    const root = document.createElement('div');
    const app = await mountApp(root, memoryStore({ settings: { apiKey: 'k', models: ['m1'] } }), fetchFn);
    await app.loadDataset(sample());
    await app.applyText('no 9-10');
    expect(app.state.rules).toEqual(rules);
    expect(root.querySelector('.rule.highlight')?.textContent).toContain('No classes in periods 9-10');
    expect(text(root)).toContain('closest');
  });

  test('an invalid import shows the errors and keeps the old data', async () => {
    const root = document.createElement('div');
    const app = await mountApp(root, memoryStore());
    await app.loadDataset(sample());
    await app.importText('{"schemaVersion": 2}');
    expect(text(root)).toContain('schemaVersion: expected 1, got 2');
    expect(text(root)).toContain('57 schedules');
  });
});
