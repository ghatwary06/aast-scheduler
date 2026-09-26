// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { groupIdFromLabel, parseRegisteredView } from '../../src/portal/registered';
import { parseGroupPage, toSession } from '../../src/portal/groupPage';
import { PortalParseError } from '../../src/portal/grid';
import { sept24 } from '../fixtures/sept24';
import { loadFixture } from './load';

describe('groupIdFromLabel', () => {
  test('strips the term prefix', () => {
    expect(groupIdFromLabel('T3 Class J')).toBe('J');
    expect(groupIdFromLabel(' T3 Extra ')).toBe('Extra');
    expect(groupIdFromLabel('T3 Class M NH')).toBe('M NH');
    expect(groupIdFromLabel('Share')).toBe('Share');
    expect(() => groupIdFromLabel('   ')).toThrow(PortalParseError);
  });
});

describe('parseRegisteredView', () => {
  const view = parseRegisteredView(loadFixture('register-registered.html'));

  test('reads the current groups', () => {
    expect(view.courses).toEqual([
      { code: 'EBA2204', name: 'Linear Algebra', group: 'K', classLetter: 'U' },
      { code: 'CCS2102', name: 'Digital Logic Design', group: 'F', classLetter: 'F' },
      { code: 'EBA2203', name: 'Probability & Statistics', group: 'I', classLetter: 'S' },
      { code: 'CCS2303', name: 'Object-Oriented Programming', group: 'H', classLetter: 'H' },
      { code: 'CCS2201', name: 'Introduction to Networks', group: 'K', classLetter: 'K' },
      { code: 'CIS2101', name: 'Database Systems', group: 'B', classLetter: 'B' },
    ]);
  });

  test('the portal timetable matches the Sept 24 group data', () => {
    for (const c of view.courses) {
      const parsed = view.entries.filter((e) => e.courseCode === c.code).map(toSession).map((s) => `${s.day} ${s.from}-${s.to} ${s.type}`).sort();
      const course = sept24.courses.find((x) => x.code === c.code)!;
      const expected = course.groups.find((g) => g.id === c.group)!.sessions.map((s) => `${s.day} ${s.from}-${s.to} ${s.type}`).sort();
      expect(parsed, c.code).toEqual(expected);
    }
  });

  test('throws when the course table is missing', () => {
    expect(() => parseRegisteredView(loadFixture('group-page-1.html'))).toThrow(PortalParseError);
  });
});

describe('parseGroupPage', () => {
  test('page 1: Linear Algebra group A (class I)', () => {
    const p = parseGroupPage(loadFixture('group-page-1.html'));
    expect(p).toMatchObject({ courseCode: 'EBA2204', courseName: 'Linear Algebra', page: 1, pageCount: 16 });
    expect(p.items).toHaveLength(1);
    expect(p.items[0]).toMatchObject({ group: 'A', classLetter: 'I' });
    expect(p.items[0].entries.map((e) => `${e.day} ${e.from}-${e.to} ${e.type}`).sort()).toEqual(['Mon 3-4 Sec', 'Sun 1-2 Lec']);
  });

  test('page 2: Linear Algebra group B (class L)', () => {
    const p = parseGroupPage(loadFixture('group-page-2.html'));
    expect(p).toMatchObject({ page: 2, pageCount: 16 });
    expect(p.items[0]).toMatchObject({ group: 'B', classLetter: 'L' });
    expect(p.items[0].lecturers.length).toBeGreaterThan(0);
    expect(p.items[0].entries.map((e) => `${e.day} ${e.from}-${e.to} ${e.type}`).sort()).toEqual(['Sat 3-4 Sec', 'Sun 1-2 Lec']);
  });

  test('a group whose timetable cannot be read is skipped with a reason, not fatal', () => {
    const doc = loadFixture('group-page-2.html');
    doc.querySelector('[id$="_Schedule1"] table tr:nth-child(2) td')!.remove();
    const p = parseGroupPage(doc);
    expect(p.items).toHaveLength(0);
    expect(p.skipped).toEqual([{ label: 'T3 Class B', classLetter: 'L', reason: expect.stringMatching(/Saturday row has 15 columns/) }]);
  });

  test('throws on a page that is not a ? page', () => {
    expect(() => parseGroupPage(loadFixture('register-registered.html'))).toThrow(PortalParseError);
  });
});
