// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { parseScheduleTable, parseType, PortalParseError } from '../../src/portal/grid';
import { loadFixture } from './load';

const fmt = (e: { day: string; from: number; to: number; courseCode: string; type: string }) =>
  `${e.day} ${e.from}-${e.to} ${e.courseCode} ${e.type}`;

describe('parseType', () => {
  test('normalises portal spellings', () => {
    expect(parseType('Lect.')).toBe('Lec');
    expect(parseType(' Lec. ')).toBe('Lec');
    expect(parseType('Sec.')).toBe('Sec');
    expect(parseType('Lab.')).toBe('Lab');
    expect(() => parseType('Tutorial')).toThrow(PortalParseError);
  });
});

describe('parseScheduleTable', () => {
  test('reads the registered timetable exactly (14 sessions, example student)', () => {
    const doc = loadFixture('register-registered.html');
    const entries = parseScheduleTable(doc.querySelector('#ctl00_ContentPlaceHolder1_Schedule1 table'));
    expect(entries.map(fmt).sort()).toEqual(
      [
        'Sat 1-2 CCS2303 Lec', 'Sat 3-4 CCS2201 Sec', 'Sat 5-6 CIS2101 Sec', 'Sat 7-8 CCS2102 Lec',
        'Mon 5-6 EBA2204 Sec', 'Mon 7-8 CCS2102 Sec',
        'Wed 1-2 EBA2204 Lec', 'Wed 3-4 CCS2201 Lec', 'Wed 5-6 CIS2101 Lec',
        'Thu 1-2 CCS2102 Lab', 'Thu 3-4 CCS2303 Sec', 'Thu 5-6 EBA2203 Sec', 'Thu 7-8 CCS2303 Lab', 'Thu 9-10 EBA2203 Lec',
      ].sort(),
    );
    expect(entries.every((e) => e.lecturer.length > 0)).toBe(true);
  });

  test('reads a ? page timetable', () => {
    const doc = loadFixture('group-page-2.html');
    const entries = parseScheduleTable(doc.querySelector('[id$="_Schedule1"] table'));
    expect(entries.map(fmt).sort()).toEqual(['Sat 3-4 EBA2204 Sec', 'Sun 1-2 EBA2204 Lec']);
  });

  test('throws on a missing table or a changed layout', () => {
    expect(() => parseScheduleTable(null)).toThrow(PortalParseError);
    const doc = loadFixture('group-page-2.html');
    const table = doc.querySelector('[id$="_Schedule1"] table')!;
    table.querySelector('tr:nth-child(2) td')!.remove(); // Saturday row now sums to 16 columns
    expect(() => parseScheduleTable(table)).toThrow(/Saturday row has 15 columns/);
  });
});
