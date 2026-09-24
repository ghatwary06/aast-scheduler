import { describe, expect, test } from 'vitest';
import { validateDataset } from '../src/core/dataset';

const good = () => ({
  schemaVersion: 1,
  source: 'import',
  fetchedAt: '2026-09-24T15:41:00+03:00',
  term: 'First Semester 2026/2027',
  courses: [
    {
      code: 'CCS2201',
      name: 'Introduction to Networks',
      current: 'I',
      groups: [
        {
          id: 'I',
          portalLabel: 'T3 Class I -I -Alexandria',
          pageLabel: '',
          open: true,
          sessions: [
            { day: 'Sun', from: 3, to: 4, type: 'Lec', lecturer: '' },
            { day: 'Wed', from: 7, to: 8, type: 'Sec', lecturer: '' },
          ],
        },
      ],
    },
  ],
});

describe('validateDataset', () => {
  test('accepts a valid dataset', () => {
    const r = validateDataset(good());
    expect(r.ok).toBe(true);
  });

  test('rejects non-objects and wrong schema version', () => {
    expect(validateDataset(null).ok).toBe(false);
    const d = { ...good(), schemaVersion: 2 };
    const r = validateDataset(d);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toContain('schemaVersion: expected 1, got 2');
  });

  test('rejects bad sessions with a precise path', () => {
    const d = good();
    d.courses[0].groups[0].sessions[0] = { day: 'Xyz', from: 0, to: 17, type: 'Talk', lecturer: '' } as never;
    const r = validateDataset(d);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toContain('courses[0].groups[0].sessions[0].day: "Xyz" is not a day');
      expect(r.errors).toContain('courses[0].groups[0].sessions[0].from: must be a period 1-16');
      expect(r.errors).toContain('courses[0].groups[0].sessions[0].to: must be a period 1-16');
      expect(r.errors).toContain('courses[0].groups[0].sessions[0].type: "Talk" is not Lec/Sec/Lab');
    }
  });

  test('rejects from after to, duplicate groups, unknown current, empty sessions', () => {
    const d = good();
    d.courses[0].groups[0].sessions[0] = { day: 'Sun', from: 4, to: 3, type: 'Lec', lecturer: '' };
    d.courses[0].groups.push({ ...d.courses[0].groups[0], sessions: [] });
    d.courses[0].current = 'Z';
    const r = validateDataset(d);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toContain('courses[0].groups[0].sessions[0]: from is after to');
      expect(r.errors).toContain('courses[0].groups[1].id: duplicate group I');
      expect(r.errors).toContain('courses[0].groups[1].sessions: must be a non-empty array');
      expect(r.errors).toContain("courses[0].current: must be null or one of the course's group ids");
    }
  });
});
