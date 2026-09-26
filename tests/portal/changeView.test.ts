// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { parseChangeView, parseDropdownLabel } from '../../src/portal/changeView';
import { PortalParseError } from '../../src/portal/grid';
import { loadFixture } from './load';

describe('parseDropdownLabel', () => {
  test.each([
    ['T3 Class B -L -Alexandria', 'B', 'L'],
    ['T3 Class M NH -X -Alexandria', 'M NH', 'X'],
    ['T3 Class O Extra-Y -Alexandria', 'O Extra', 'Y'],
    ['T3 Extra -W -Alexandria', 'Extra', 'W'],
    ['T3 Class L -6 -Alexandria', 'L', '6'],
    ['Share -I -Alexandria', 'Share', 'I'],
  ])('%s', (label, group, classLetter) => {
    expect(parseDropdownLabel(label)).toEqual({ group, classLetter });
  });
  test('rejects labels without a class part', () => {
    expect(() => parseDropdownLabel('Any')).toThrow(PortalParseError);
  });
});

describe('parseChangeView', () => {
  const courses = parseChangeView(loadFixture('register-change.html'));

  test('reads each course, its current group from the table, and its ? button', () => {
    expect(courses.map((c) => [c.code, c.current, c.currentClass, c.row])).toEqual([
      ['EBA2204', 'K', 'U', 'ctl02'],
      ['CCS2102', 'F', 'F', 'ctl03'],
      ['EBA2203', 'I', 'S', 'ctl04'],
      ['CCS2303', 'H', 'H', 'ctl05'],
      ['CCS2201', 'K', 'K', 'ctl06'],
      ['CIS2101', 'B', 'B', 'ctl07'],
    ]);
    expect(courses[0].detailsButton).toBe('ctl00$ContentPlaceHolder1$grdvw_courses$ctl02$btn_grp_time_table_details');
  });

  test('open groups are the dropdown options without "Any"; full groups are missing', () => {
    const dld = courses.find((c) => c.code === 'CCS2102')!;
    expect(dld.options.map((o) => `${o.group}/${o.classLetter}`)).toEqual(['E/E', 'G/G', 'H/H']);
    expect(dld.options.some((o) => o.group === dld.current)).toBe(false); // current group F is full
    const la = courses.find((c) => c.code === 'EBA2204')!;
    expect(la.options).toHaveLength(11);
    expect(la.options.every((o) => o.value !== '-99')).toBe(true);
    const prob = courses.find((c) => c.code === 'EBA2203')!;
    expect(prob.options.map((o) => o.label)).toContain('Share -I -Alexandria');
  });

  test('the plain registered view is refused with instructions', () => {
    expect(() => parseChangeView(loadFixture('register-registered.html'))).toThrow(/Change Registered Courses/);
  });
});
