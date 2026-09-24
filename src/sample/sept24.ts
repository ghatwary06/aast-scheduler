import type { Dataset, Day, Group, SessionType, Course } from '../core/types';

type S = [Day, number, number, SessionType];
const group = (id: string, portalLabel: string, sessions: S[]): Group => ({
  id,
  portalLabel,
  pageLabel: '',
  open: true,
  sessions: sessions.map(([day, from, to, type]) => ({ day, from, to, type, lecturer: '' })),
});
const course = (code: string, name: string, current: string, groups: Group[]): Course => ({ code, name, current, groups });

export const sept24: Dataset = {
  schemaVersion: 1,
  source: 'import',
  fetchedAt: '2026-09-24T15:41:00+03:00',
  term: 'First Semester 2026/2027',
  courses: [
  course('EBA2204', 'Linear Algebra', 'K', [
    group('D', 'T3 Class D -N -Alexandria', [['Sun', 3, 4, 'Lec'], ['Thu', 3, 4, 'Sec']]),
    group('F', 'T3 Class F -P -Alexandria', [['Mon', 5, 6, 'Lec'], ['Sun', 3, 4, 'Sec']]),
    group('G', 'T3 Class G -Q -Alexandria', [['Mon', 1, 2, 'Sec'], ['Mon', 3, 4, 'Lec']]),
    group('H', 'T3 Class H -R -Alexandria', [['Mon', 3, 4, 'Lec'], ['Wed', 3, 4, 'Sec']]),
    group('I', 'T3 Class I -S -Alexandria', [['Mon', 1, 2, 'Lec'], ['Sat', 5, 6, 'Sec']]),
    group('J', 'T3 Class J -T -Alexandria', [['Sun', 1, 2, 'Sec'], ['Mon', 1, 2, 'Lec']]),
    group('K', 'T3 Class K -U -Alexandria', [['Wed', 1, 2, 'Lec'], ['Mon', 5, 6, 'Sec']]),
    group('L', 'T3 Class L -V -Alexandria', [['Wed', 1, 2, 'Lec'], ['Wed', 5, 6, 'Sec']]),
    group('M', 'T3 Class M NH -X -Alexandria', [['Sat', 1, 2, 'Sec'], ['Wed', 5, 6, 'Lec']]),
    group('Extra', 'T3 Extra -W -Alexandria', [['Wed', 1, 2, 'Sec'], ['Wed', 3, 4, 'Lec']]),
  ]),
  course('CCS2102', 'Digital Logic Design', 'F', [
    group('D', 'T3 Class D -D -Alexandria', [['Sat', 5, 6, 'Lec'], ['Sun', 5, 6, 'Lab'], ['Mon', 3, 4, 'Sec']]),
    group('F', 'T3 Class F -F -Alexandria', [['Sat', 7, 8, 'Lec'], ['Mon', 7, 8, 'Sec'], ['Thu', 1, 2, 'Lab']]),
    group('G', 'T3 Class G -G -Alexandria', [['Sun', 7, 8, 'Lab'], ['Wed', 3, 4, 'Sec'], ['Wed', 9, 10, 'Lec']]),
    group('H', 'T3 Class H -H -Alexandria', [['Mon', 1, 2, 'Sec'], ['Wed', 9, 10, 'Lec'], ['Thu', 5, 6, 'Lab']]),
  ]),
  course('EBA2203', 'Probability & Statistics', 'I', [
    group('C', 'T3 Class C -M -Alexandria', [['Wed', 1, 2, 'Sec'], ['Thu', 7, 8, 'Lec']]),
    group('D', 'T3 Class D -N -Alexandria', [['Mon', 5, 6, 'Sec'], ['Wed', 9, 10, 'Lec']]),
    group('E', 'T3 Class E -O -Alexandria', [['Sat', 1, 2, 'Sec'], ['Wed', 9, 10, 'Lec']]),
    group('F', 'T3 Class F -P -Alexandria', [['Wed', 3, 4, 'Sec'], ['Thu', 7, 8, 'Lec']]),
    group('G', 'T3 Class G -Q -Alexandria', [['Sun', 5, 6, 'Sec'], ['Wed', 7, 8, 'Lec']]),
    group('H', 'T3 Class H -R -Alexandria', [['Wed', 7, 8, 'Lec'], ['Thu', 1, 2, 'Sec']]),
    group('I', 'T3 Class I -S -Alexandria', [['Thu', 5, 6, 'Sec'], ['Thu', 9, 10, 'Lec']]),
    group('J', 'T3 Class J -T -Alexandria', [['Sat', 5, 6, 'Sec'], ['Thu', 9, 10, 'Lec']]),
    group('K', 'T3 Class K -U -Alexandria', [['Tue', 5, 6, 'Lec'], ['Wed', 5, 6, 'Sec']]),
    group('M', 'T3 Class M NH -X -Alexandria', [['Tue', 1, 2, 'Sec'], ['Thu', 3, 4, 'Lec']]),
    group('Extra', 'T3 Extra -W -Alexandria', [['Thu', 3, 4, 'Sec'], ['Thu', 5, 6, 'Lec']]),
  ]),
  course('CCS2303', 'Object-Oriented Programming', 'H', [
    group('G', 'T3 Class G -G -Alexandria', [['Sat', 1, 2, 'Lec'], ['Thu', 1, 2, 'Sec'], ['Thu', 5, 6, 'Lab']]),
    group('H', 'T3 Class H -H -Alexandria', [['Sat', 1, 2, 'Lec'], ['Thu', 3, 4, 'Sec'], ['Thu', 7, 8, 'Lab']]),
    group('I', 'T3 Class I -I -Alexandria', [['Sat', 3, 4, 'Lec'], ['Wed', 1, 2, 'Sec'], ['Thu', 3, 4, 'Lab']]),
    group('J', 'T3 Class J -J -Alexandria', [['Sat', 3, 4, 'Lec'], ['Mon', 7, 8, 'Lab'], ['Wed', 5, 6, 'Sec']]),
    group('K', 'T3 Class K -K -Alexandria', [['Sun', 1, 2, 'Lec'], ['Mon', 9, 10, 'Lab'], ['Tue', 3, 4, 'Sec']]),
  ]),
  course('CCS2201', 'Introduction to Networks', 'K', [
    group('C', 'T3 Class C -C -Alexandria', [['Mon', 5, 6, 'Sec'], ['Wed', 5, 6, 'Lec']]),
    group('D', 'T3 Class D -D -Alexandria', [['Wed', 5, 6, 'Lec'], ['Thu', 5, 6, 'Sec']]),
    group('F', 'T3 Class F -F -Alexandria', [['Wed', 5, 6, 'Sec'], ['Wed', 7, 8, 'Lec']]),
    group('H', 'T3 Class H -H -Alexandria', [['Sun', 1, 2, 'Lec'], ['Mon', 7, 8, 'Sec']]),
    group('I', 'T3 Class I -I -Alexandria', [['Sun', 3, 4, 'Lec'], ['Wed', 7, 8, 'Sec']]),
    group('K', 'T3 Class K -K -Alexandria', [['Sat', 3, 4, 'Sec'], ['Wed', 3, 4, 'Lec']]),
    group('L', 'T3 Class L -L -Alexandria', [['Sat', 5, 6, 'Sec'], ['Wed', 3, 4, 'Lec']]),
    group('M', 'T3 Class M NH -M -Alexandria', [['Sat', 5, 6, 'Sec'], ['Wed', 1, 2, 'Lec']]),
    group('O', 'T3 Class O Extra-Y -Alexandria', [['Sat', 7, 8, 'Sec'], ['Wed', 5, 6, 'Lec']]),
    group('Extra', 'T3 Extra -N -Alexandria', [['Wed', 5, 6, 'Lec'], ['Thu', 1, 2, 'Sec']]),
  ]),
  course('CIS2101', 'Database Systems', 'B', [
    group('B', 'T3 Class B -B -Alexandria', [['Sat', 5, 6, 'Sec'], ['Wed', 5, 6, 'Lec']]),
    group('G', 'T3 Class G -G -Alexandria', [['Wed', 1, 2, 'Lec'], ['Mon', 5, 6, 'Sec']]),
    group('H', 'T3 Class H -H -Alexandria', [['Wed', 1, 2, 'Lec'], ['Mon', 5, 6, 'Sec']]),
    group('I', 'T3 Class I -I -Alexandria', [['Wed', 3, 4, 'Lec'], ['Wed', 5, 6, 'Sec']]),
    group('L', 'T3 Class L -6 -Alexandria', [['Sun', 7, 8, 'Lec'], ['Thu', 3, 4, 'Sec']]),
    group('M', 'T3 Class M NH -V -Alexandria', [['Sat', 3, 4, 'Sec'], ['Wed', 7, 8, 'Lec']]),
  ]),
  ],
};
