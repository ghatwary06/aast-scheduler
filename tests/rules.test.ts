import { describe, expect, test } from 'vitest';
import { evaluate, changedCourses, type Candidate, type Rule } from '../src/core/rules';
import { weekStats, type Placed } from '../src/core/week';
import type { Day, SessionType } from '../src/core/types';

const p = (course: string, group: string, day: Day, from: number, to: number, type: SessionType = 'Lec'): Placed => ({
  course,
  courseName: course,
  group,
  session: { day, from, to, type, lecturer: '' },
});

function cand(sessions: Placed[], picks: Record<string, string[]>, current: Record<string, string | null> = {}): Candidate {
  return { picks, sessions, stats: weekStats(sessions.map((x) => x.session)), current };
}

// Option 1: off Fri, Tue, Thu; one Wed gap at 3-4; Prob Lec Wed 9-10.
const registered = cand(
  [
    p('Prob', 'E', 'Sat', 1, 2, 'Sec'), p('OOP', 'J', 'Sat', 3, 4), p('DLD', 'D', 'Sat', 5, 6),
    p('LA', 'J', 'Sun', 1, 2, 'Sec'), p('Net', 'I', 'Sun', 3, 4), p('DLD', 'D', 'Sun', 5, 6, 'Lab'),
    p('LA', 'J', 'Mon', 1, 2), p('DLD', 'D', 'Mon', 3, 4, 'Sec'), p('DB', 'G', 'Mon', 5, 6, 'Sec'), p('OOP', 'J', 'Mon', 7, 8, 'Lab'),
    p('DB', 'G', 'Wed', 1, 2), p('OOP', 'J', 'Wed', 5, 6, 'Sec'), p('Net', 'I', 'Wed', 7, 8, 'Sec'), p('Prob', 'E', 'Wed', 9, 10),
  ],
  { LA: ['J'], DLD: ['D'], Prob: ['E'], OOP: ['J'], Net: ['I'], DB: ['G', 'H'] },
  { LA: 'G', DLD: 'G', Prob: 'I', OOP: 'J', Net: 'I', DB: 'H' },
);

const base = { id: 'r', strength: 'must' as const };

describe('evaluate', () => {
  test('daysOff: 3 off passes, 4 off fails by 1, mustOff day used fails', () => {
    expect(evaluate({ ...base, kind: 'daysOff', minOff: 3, mustOff: [] }, registered).cost).toBe(0);
    const v = evaluate({ ...base, kind: 'daysOff', minOff: 4, mustOff: ['Sun'] }, registered);
    expect(v.cost).toBe(2);
    expect(v.broken).toEqual(['only 3 days off (need 4)', 'Sun is not off']);
  });

  test('gaps: 1 slot on Wednesday', () => {
    expect(evaluate({ ...base, kind: 'gaps', maxTotal: 2, maxPerDay: 1, maxSingle: 99 }, registered).cost).toBe(0);
    const v = evaluate({ ...base, kind: 'gaps', maxTotal: 0, maxPerDay: 0, maxSingle: 99 }, registered);
    expect(v.cost).toBe(2);
    expect(v.broken).toEqual(['1 gaps in total (max 0)', 'Wed has 1 gaps (max 0)']);
  });

  test('bannedPeriods: the 9-10 Probability lecture', () => {
    const v = evaluate({ ...base, kind: 'bannedPeriods', from: 9, to: 10, days: [] }, registered);
    expect(v).toEqual({ cost: 1, broken: ['Wed 9-10 Prob Lec'] });
    expect(evaluate({ ...base, kind: 'bannedPeriods', from: 9, to: 10, days: ['Thu'] }, registered).cost).toBe(0);
  });

  test('dayWindow: finishing by 8 breaks only the 9-10 session', () => {
    const v = evaluate({ ...base, kind: 'dayWindow', earliest: 1, latest: 8, days: [] }, registered);
    expect(v.cost).toBe(1);
  });

  test('keepGroup and avoidGroup respect merged equivalents', () => {
    expect(evaluate({ ...base, kind: 'keepGroup', course: 'OOP', group: 'J' }, registered).cost).toBe(0);
    expect(evaluate({ ...base, kind: 'keepGroup', course: 'Prob', group: 'I' }, registered).cost).toBe(1);
    expect(evaluate({ ...base, kind: 'avoidGroup', course: 'DB', group: 'G' }, registered).cost).toBe(0); // H is still pickable
    expect(evaluate({ ...base, kind: 'avoidGroup', course: 'LA', group: 'J' }, registered).cost).toBe(1);
  });

  test('maxChanges counts courses whose current group is not among the picks', () => {
    expect(changedCourses(registered)).toEqual(['LA', 'DLD', 'Prob']); // DB current H is in [G, H]
    expect(evaluate({ ...base, kind: 'maxChanges', max: 0 }, registered).cost).toBe(3);
    expect(evaluate({ ...base, kind: 'maxChanges', max: 3 }, registered).cost).toBe(0);
  });

  test('noSingleSessionDays', () => {
    const lonely = cand([p('A', 'X', 'Thu', 7, 8), p('B', 'Y', 'Sat', 1, 2), p('C', 'Z', 'Sat', 3, 4)], {});
    expect(evaluate({ ...base, kind: 'noSingleSessionDays' }, lonely)).toEqual({ cost: 1, broken: ['Thu has only 1 class'] });
  });

  test('every Rule kind is handled', () => {
    const rules: Rule[] = [
      { ...base, kind: 'daysOff', minOff: 0, mustOff: [] },
      { ...base, kind: 'gaps', maxTotal: 9, maxPerDay: 9, maxSingle: 9 },
      { ...base, kind: 'bannedPeriods', from: 15, to: 16, days: [] },
      { ...base, kind: 'dayWindow', earliest: 1, latest: 16, days: [] },
      { ...base, kind: 'keepGroup', course: 'OOP', group: 'J' },
      { ...base, kind: 'avoidGroup', course: 'OOP', group: 'K' },
      { ...base, kind: 'maxChanges', max: 6 },
      { ...base, kind: 'noSingleSessionDays' },
    ];
    for (const r of rules) expect(evaluate(r, registered).cost).toBe(0);
  });
});
