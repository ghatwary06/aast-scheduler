import { describe, expect, test } from 'vitest';
import { solve, type Solution } from '../src/core/solver';
import { overlaps } from '../src/core/week';
import type { Rule } from '../src/core/rules';
import { sept24 } from './fixtures/sept24';

const daysOff3: Rule = { id: 'off', strength: 'must', kind: 'daysOff', minOff: 3, mustOff: [] };
const noGaps: Rule = { id: 'gaps', strength: 'must', kind: 'gaps', maxTotal: 0, maxPerDay: 0, maxSingle: 99 };
const gapRule: Rule = { id: 'gaps', strength: 'must', kind: 'gaps', maxTotal: 2, maxPerDay: 1, maxSingle: 99 };
const no910: Rule = { id: 'no910', strength: 'must', kind: 'bannedPeriods', from: 9, to: 10, days: [] };
const OPTION1 = { EBA2204: 'J', CCS2102: 'D', EBA2203: 'E', CCS2303: 'J', CCS2201: 'I', CIS2101: 'G' };
const isOption1 = (s: Solution) => Object.entries(OPTION1).every(([c, g]) => s.picks[c].includes(g));

describe('solve on the 2026-09-24 data', () => {
  test('57 schedules with Friday + 2 more days off', () => {
    const r = solve(sept24, [daysOff3], { limit: 1000 });
    expect(r.total).toBe(57);
    expect(r.solutions).toHaveLength(57);
    expect(r.nearMisses).toEqual([]);
  });

  test('no solution has a clash', () => {
    for (const s of solve(sept24, [daysOff3], { limit: 1000 }).solutions) {
      for (let i = 0; i < s.sessions.length; i++)
        for (let j = i + 1; j < s.sessions.length; j++)
          expect(overlaps(s.sessions[i].session, s.sessions[j].session)).toBe(false);
    }
  });

  test('Database G and H are merged into one result', () => {
    const sols = solve(sept24, [daysOff3], { limit: 1000 }).solutions;
    const withG = sols.filter((s) => s.picks.CIS2101.includes('G'));
    expect(withG).toHaveLength(17);
    for (const s of withG) expect(s.picks.CIS2101).toEqual(['G', 'H']);
  });

  test('8 of them are gap-free', () => {
    expect(solve(sept24, [daysOff3, noGaps]).total).toBe(8);
  });

  test('the Option 1 schedule is found, with 1 gap slot on Wednesday', () => {
    const reg = solve(sept24, [daysOff3], { limit: 1000 }).solutions.filter(isOption1);
    expect(reg).toHaveLength(1);
    expect(reg[0].stats.days.filter((d) => d.gapPeriods > 0).map((d) => [d.day, d.gapPeriods])).toEqual([['Wed', 2]]);
    expect(reg[0].stats.offDays).toEqual(['Tue', 'Thu', 'Fri']);
  });

  test('no 9-10 + gap rule has 0 results but near-misses breaking exactly 1 rule', () => {
    const r = solve(sept24, [daysOff3, gapRule, no910]);
    expect(r.total).toBe(0);
    expect(r.solutions).toEqual([]);
    expect(r.nearMisses.length).toBeGreaterThan(0);
    expect(r.nearMisses.length).toBeLessThanOrEqual(20);
    expect(r.nearMisses[0].mustBroken).toHaveLength(1);
    const first = r.nearMisses[0].mustBroken[0];
    expect(first.messages.length).toBeGreaterThan(0);
  });

  test('keeping OOP J and Networks I leaves only Option 1', () => {
    const r = solve(sept24, [
      daysOff3,
      { id: 'k1', strength: 'must', kind: 'keepGroup', course: 'CCS2303', group: 'J' },
      { id: 'k2', strength: 'must', kind: 'keepGroup', course: 'CCS2201', group: 'I' },
    ]);
    expect(r.total).toBe(1);
    expect(isOption1(r.solutions[0])).toBe(true);
  });

  test('marking Networks K as full removes it', () => {
    const r = solve(sept24, [daysOff3], { excluded: { CCS2201: ['K'] }, limit: 1000 });
    expect(r.total).toBe(50);
    expect(r.solutions.every((s) => !s.picks.CCS2201.includes('K'))).toBe(true);
  });

  test('prefer "fewest changes" ranks the current (example) registration first', () => {
    const r = solve(sept24, [daysOff3, { id: 'ch', strength: 'prefer', kind: 'maxChanges', max: 0 }]);
    const current = Object.fromEntries(sept24.courses.map((c) => [c.code, c.current!]));
    expect(Object.entries(current).every(([c, g]) => r.solutions[0].picks[c].includes(g))).toBe(true);
    expect(r.solutions[0].changes).toEqual([]);
    expect(r.solutions[0].preferCosts).toEqual([0]);
    const costs = r.solutions.map((s) => s.preferCosts[0]);
    expect(costs).toEqual([...costs].sort((a, b) => a - b));
  });

  test('rules switched off are ignored', () => {
    expect(solve(sept24, [daysOff3, { ...noGaps, strength: 'off' }], { limit: 1000 }).total).toBe(57);
  });

  test('results are deterministic', () => {
    const a = solve(sept24, [daysOff3], { limit: 1000 }).solutions.map((s) => JSON.stringify(s.picks));
    const b = solve(sept24, [daysOff3], { limit: 1000 }).solutions.map((s) => JSON.stringify(s.picks));
    expect(a).toEqual(b);
  });

  test('limit caps returned solutions but not total', () => {
    const r = solve(sept24, [daysOff3], { limit: 5 });
    expect(r.total).toBe(57);
    expect(r.solutions).toHaveLength(5);
  });
});
