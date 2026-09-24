import { describe, expect, test } from 'vitest';
import { overlaps, weekStats } from '../src/core/week';
import { validateDataset } from '../src/core/dataset';
import type { Session } from '../src/core/types';
import { sept24 } from './fixtures/sept24';

const s = (day: Session['day'], from: number, to: number): Session => ({ day, from, to, type: 'Lec', lecturer: '' });

describe('fixture', () => {
  test('sept24 passes validation', () => {
    expect(validateDataset(sept24).ok).toBe(true);
  });
});

describe('overlaps', () => {
  test('same day, overlapping periods', () => expect(overlaps(s('Sat', 1, 2), s('Sat', 2, 3))).toBe(true));
  test('same day, touching but not overlapping', () => expect(overlaps(s('Sat', 1, 2), s('Sat', 3, 4))).toBe(false));
  test('different days', () => expect(overlaps(s('Sat', 1, 2), s('Sun', 1, 2))).toBe(false));
});

describe('weekStats', () => {
  test("Option 1's Wednesday has one 2-period gap", () => {
    // Option 1 Wednesday: DB Lec 1-2, gap 3-4, OOP Sec 5-6, Net Sec 7-8, Prob Lec 9-10
    const w = weekStats([s('Wed', 1, 2), s('Wed', 5, 6), s('Wed', 7, 8), s('Wed', 9, 10), s('Sat', 1, 2)]);
    const wed = w.days.find((d) => d.day === 'Wed')!;
    expect(wed).toMatchObject({ sessions: 4, first: 1, last: 10, gapPeriods: 2, longestGap: 2 });
    expect(w.totalGapPeriods).toBe(2);
    expect(w.usedDays).toEqual(['Sat', 'Wed']);
    expect(w.offDays).toEqual(['Sun', 'Mon', 'Tue', 'Thu', 'Fri']);
  });

  test('longest gap measures the biggest single hole', () => {
    const w = weekStats([s('Mon', 1, 2), s('Mon', 5, 6), s('Mon', 11, 12)]);
    expect(w.days[0]).toMatchObject({ gapPeriods: 6, longestGap: 4 });
  });

  test('empty week has every day off', () => {
    expect(weekStats([]).offDays).toHaveLength(7);
  });
});
