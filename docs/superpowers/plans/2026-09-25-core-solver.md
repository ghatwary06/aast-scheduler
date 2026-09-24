# AASTMT Schedule Planner: Plan 1, Core Solver

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure, browser-free core of the extension: the dataset format with validation, week statistics, rule evaluation, and the solver. It is proven against the hand-verified results from 2026-09-24.

**Architecture:** Four small TypeScript modules under `src/core/`, with no DOM and no network:

- `types.ts`: the data shapes
- `dataset.ts`: validates imported or read data
- `week.ts`: day, gap and off-day statistics for a set of sessions
- `rules.ts`: evaluates one rule against one candidate schedule, returning a cost where 0 means satisfied
- `solver.ts`: backtracking search with clash bitmasks, must-rule pruning, equivalent-group merging, lexicographic ranking and near-misses

Later plans (portal reader, extension UI) only consume these modules.

**Tech Stack:** TypeScript (strict), Vitest, Node 26 / npm 12.

**Spec:** `docs/superpowers/specs/2026-09-25-aast-scheduler-design.md`

**Plan series:**
1. **This plan:** the core solver.
2. Portal reader + safety guard. Written after the student saves real portal pages and spec §13 is answered.
3. Extension UI: popup, app page, Gemini parser, PDF export.

## Global Constraints

- **Hard safety rule (spec §2):** nothing in this codebase may ever click, submit or trigger Confirm Registration, Select, Delete Registration, the delete icons, Add, Insert Term Courses or Logout, or change a dropdown value. Plan 1 contains no DOM code at all, so it cannot.
- The data format is exactly spec §7, with `schemaVersion: 1`. No personal data (name, registration number, GPA) is stored.
- Periods are integers 1–16, and `from`/`to` are inclusive. Days are `Sat Sun Mon Tue Wed Thu Fri`.
- Gaps are counted in 2-period slots, meaning empty periods between a day's first and last session ÷ 2 (spec §8).
- Ranking is lexicographic by the order of the prefer rules. No weights.
- Groups with identical sessions (day, from, to, type) are merged into one result, e.g. Database `G or H`.
- `src/core/**` must not import from any DOM, browser or extension API.

---

## File Structure

| File | Responsibility |
|---|---|
| `package.json`, `tsconfig.json`, `.gitignore` | project setup |
| `src/core/types.ts` | `Day`, `Session`, `Group`, `Course`, `Dataset` and constants |
| `src/core/dataset.ts` | `validateDataset(unknown)` |
| `src/core/week.ts` | `Placed`, `overlaps`, `weekStats` |
| `src/core/rules.ts` | `Rule` union, `Candidate`, `evaluate`, `changedCourses` |
| `src/core/solver.ts` | `solve(dataset, rules, options)` |
| `tests/fixtures/sept24.ts` | the verified 2026-09-24 dataset (Digital Logic C removed, Digital Logic F lecture Sat 7-8) |
| `tests/*.test.ts` | one test file per module |

---

### Task 1: Project setup, types and dataset validation

**Files:**
- Create: `package.json`, `tsconfig.json`, `.gitignore`
- Create: `src/core/types.ts`, `src/core/dataset.ts`
- Test: `tests/dataset.test.ts`

**Interfaces:**
- Produces:
  - `DAYS: readonly Day[]`, `SESSION_TYPES`, `MIN_PERIOD = 1`, `MAX_PERIOD = 16`
  - the types `Day`, `SessionType`, `Session`, `Group`, `Course`, `Dataset`
  - `validateDataset(input: unknown): { ok: true; data: Dataset } | { ok: false; errors: string[] }`

- [x] **Step 1: Create the project files**

`package.json`:
```json
{
  "name": "aast-scheduler",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true
  },
  "include": ["src", "tests"]
}
```

`.gitignore`:
```
node_modules/
dist/
tests/fixtures/portal/*.html
```

Run: `npm install -D typescript vitest`

- [x] **Step 2: Write `src/core/types.ts`**

```ts
export const DAYS = ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'] as const;
export type Day = (typeof DAYS)[number];

export const SESSION_TYPES = ['Lec', 'Sec', 'Lab'] as const;
export type SessionType = (typeof SESSION_TYPES)[number];

export const MIN_PERIOD = 1;
export const MAX_PERIOD = 16;

export interface Session {
  day: Day;
  from: number;
  to: number;
  type: SessionType;
  lecturer: string;
}

export interface Group {
  id: string;
  portalLabel: string;
  pageLabel: string;
  open: boolean;
  sessions: Session[];
}

export interface Course {
  code: string;
  name: string;
  current: string | null;
  groups: Group[];
}

export interface Dataset {
  schemaVersion: 1;
  source: 'portal' | 'pdf' | 'import';
  fetchedAt: string;
  term: string;
  courses: Course[];
}
```

- [x] **Step 3: Write the failing test `tests/dataset.test.ts`**

```ts
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
```

- [x] **Step 4: Run it and check that it fails**

Run: `npx vitest run tests/dataset.test.ts`
Expected: FAIL, because `../src/core/dataset` doesn't exist yet.

- [x] **Step 5: Write `src/core/dataset.ts`**

```ts
import { DAYS, MAX_PERIOD, MIN_PERIOD, SESSION_TYPES, type Dataset } from './types';

export type ValidationResult = { ok: true; data: Dataset } | { ok: false; errors: string[] };

const SOURCES = ['portal', 'pdf', 'import'];

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isPeriod(v: unknown): v is number {
  return Number.isInteger(v) && (v as number) >= MIN_PERIOD && (v as number) <= MAX_PERIOD;
}

export function validateDataset(input: unknown): ValidationResult {
  const errors: string[] = [];
  const err = (path: string, msg: string) => void errors.push(`${path}: ${msg}`);

  if (!isObj(input)) return { ok: false, errors: ['dataset: not an object'] };
  if (input.schemaVersion !== 1) err('schemaVersion', `expected 1, got ${JSON.stringify(input.schemaVersion)}`);
  if (typeof input.source !== 'string' || !SOURCES.includes(input.source)) err('source', `must be one of ${SOURCES.join(', ')}`);
  if (typeof input.fetchedAt !== 'string' || Number.isNaN(Date.parse(input.fetchedAt))) err('fetchedAt', 'must be an ISO date string');
  if (typeof input.term !== 'string') err('term', 'must be a string');
  if (!Array.isArray(input.courses) || input.courses.length === 0) {
    err('courses', 'must be a non-empty array');
    return { ok: false, errors };
  }

  const codes = new Set<string>();
  input.courses.forEach((c: unknown, ci) => {
    const cp = `courses[${ci}]`;
    if (!isObj(c)) return err(cp, 'not an object');
    if (typeof c.code !== 'string' || c.code === '') err(`${cp}.code`, 'must be a non-empty string');
    else if (codes.has(c.code)) err(`${cp}.code`, `duplicate course ${c.code}`);
    else codes.add(c.code);
    if (typeof c.name !== 'string') err(`${cp}.name`, 'must be a string');
    if (!Array.isArray(c.groups) || c.groups.length === 0) return err(`${cp}.groups`, 'must be a non-empty array');

    const ids = new Set<string>();
    c.groups.forEach((g: unknown, gi) => {
      const gp = `${cp}.groups[${gi}]`;
      if (!isObj(g)) return err(gp, 'not an object');
      if (typeof g.id !== 'string' || g.id === '') err(`${gp}.id`, 'must be a non-empty string');
      else if (ids.has(g.id)) err(`${gp}.id`, `duplicate group ${g.id}`);
      else ids.add(g.id);
      if (typeof g.portalLabel !== 'string') err(`${gp}.portalLabel`, 'must be a string');
      if (typeof g.pageLabel !== 'string') err(`${gp}.pageLabel`, 'must be a string');
      if (typeof g.open !== 'boolean') err(`${gp}.open`, 'must be true or false');
      if (!Array.isArray(g.sessions) || g.sessions.length === 0) return err(`${gp}.sessions`, 'must be a non-empty array');

      g.sessions.forEach((s: unknown, si) => {
        const sp = `${gp}.sessions[${si}]`;
        if (!isObj(s)) return err(sp, 'not an object');
        if (!(DAYS as readonly unknown[]).includes(s.day)) err(`${sp}.day`, `${JSON.stringify(s.day)} is not a day`);
        if (!isPeriod(s.from)) err(`${sp}.from`, `must be a period ${MIN_PERIOD}-${MAX_PERIOD}`);
        if (!isPeriod(s.to)) err(`${sp}.to`, `must be a period ${MIN_PERIOD}-${MAX_PERIOD}`);
        if (isPeriod(s.from) && isPeriod(s.to) && s.from > s.to) err(sp, 'from is after to');
        if (!(SESSION_TYPES as readonly unknown[]).includes(s.type)) err(`${sp}.type`, `${JSON.stringify(s.type)} is not Lec/Sec/Lab`);
        if (typeof s.lecturer !== 'string') err(`${sp}.lecturer`, 'must be a string');
      });
    });

    if (c.current !== null && (typeof c.current !== 'string' || !ids.has(c.current))) {
      err(`${cp}.current`, "must be null or one of the course's group ids");
    }
  });

  return errors.length ? { ok: false, errors } : { ok: true, data: input as unknown as Dataset };
}
```

- [x] **Step 6: Run the tests and typecheck**

Run: `npx vitest run tests/dataset.test.ts && npx tsc --noEmit`
Expected: 4 tests PASS, no type errors.

---

### Task 2: Week statistics and the verified fixture

**Files:**
- Create: `src/core/week.ts`, `tests/fixtures/sept24.ts`
- Test: `tests/week.test.ts`

**Interfaces:**
- Consumes: `Day`, `Session`, `DAYS`, `Dataset`, `validateDataset` (Task 1)
- Produces:
  - `interface Placed { course: string; courseName: string; group: string; session: Session }`
  - `interface DayStats { day: Day; sessions: number; first: number; last: number; gapPeriods: number; longestGap: number }`
  - `interface WeekStats { usedDays: Day[]; offDays: Day[]; days: DayStats[]; totalGapPeriods: number }`
  - `overlaps(a: Session, b: Session): boolean`
  - `weekStats(sessions: Session[]): WeekStats`
  - `sept24: Dataset` (the fixture)

- [x] **Step 1: Write the fixture `tests/fixtures/sept24.ts`**

These are the verified group times from the 2026-09-24 screenshots:
- Digital Logic C is removed (no longer available).
- The Digital Logic F lecture is Sat 7-8, as confirmed by a live portal screenshot.
- Lecturer names are left out.

```ts
import type { Dataset, Day, Group, SessionType, Course } from '../../src/core/types';

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
```

- [x] **Step 2: Write the failing test `tests/week.test.ts`**

```ts
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
```

- [x] **Step 3: Run it and check that it fails**

Run: `npx vitest run tests/week.test.ts`
Expected: FAIL, because `../src/core/week` doesn't exist yet.

- [x] **Step 4: Write `src/core/week.ts`**

```ts
import { DAYS, type Day, type Session } from './types';

export interface Placed {
  course: string;
  courseName: string;
  group: string;
  session: Session;
}

export interface DayStats {
  day: Day;
  sessions: number;
  first: number;
  last: number;
  gapPeriods: number;
  longestGap: number;
}

export interface WeekStats {
  usedDays: Day[];
  offDays: Day[];
  days: DayStats[];
  totalGapPeriods: number;
}

export function overlaps(a: Session, b: Session): boolean {
  return a.day === b.day && a.from <= b.to && b.from <= a.to;
}

export function weekStats(sessions: Session[]): WeekStats {
  const days: DayStats[] = [];
  for (const day of DAYS) {
    const today = sessions.filter((s) => s.day === day);
    if (today.length === 0) continue;
    const first = Math.min(...today.map((s) => s.from));
    const last = Math.max(...today.map((s) => s.to));
    let gapPeriods = 0;
    let longestGap = 0;
    let run = 0;
    for (let p = first; p <= last; p++) {
      if (today.some((s) => s.from <= p && p <= s.to)) {
        run = 0;
      } else {
        gapPeriods++;
        run++;
        longestGap = Math.max(longestGap, run);
      }
    }
    days.push({ day, sessions: today.length, first, last, gapPeriods, longestGap });
  }
  const usedDays = days.map((d) => d.day);
  return {
    usedDays,
    offDays: DAYS.filter((d) => !usedDays.includes(d)),
    days,
    totalGapPeriods: days.reduce((n, d) => n + d.gapPeriods, 0),
  };
}
```

- [x] **Step 5: Run the tests and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all tests PASS, no type errors.

---

### Task 3: Rule evaluation

**Files:**
- Create: `src/core/rules.ts`
- Test: `tests/rules.test.ts`

**Interfaces:**
- Consumes: `Day` (Task 1), `Placed`, `WeekStats`, `weekStats` (Task 2)
- Produces:
  - `type Strength = 'must' | 'prefer' | 'off'`
  - the `Rule` union, with `kind` ∈ `daysOff | gaps | bannedPeriods | dayWindow | keepGroup | avoidGroup | maxChanges | noSingleSessionDays` and fields exactly as in Step 3
  - `interface Candidate { picks: Record<string, string[]>; sessions: Placed[]; stats: WeekStats; current: Record<string, string | null> }`
  - `interface Verdict { cost: number; broken: string[] }`
  - `evaluate(rule: Rule, c: Candidate): Verdict`
  - `changedCourses(c: Candidate): string[]`
  - `PERIODS_PER_SLOT = 2`

- [x] **Step 1: Write the failing test `tests/rules.test.ts`**

```ts
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
```

- [x] **Step 2: Run it and check that it fails**

Run: `npx vitest run tests/rules.test.ts`
Expected: FAIL, because `../src/core/rules` doesn't exist yet.

- [x] **Step 3: Write `src/core/rules.ts`**

```ts
import type { Day } from './types';
import type { Placed, WeekStats } from './week';

export type Strength = 'must' | 'prefer' | 'off';

interface RuleBase {
  id: string;
  strength: Strength;
}

export interface DaysOffRule extends RuleBase { kind: 'daysOff'; minOff: number; mustOff: Day[] }
/** Limits are in 2-period slots. */
export interface GapsRule extends RuleBase { kind: 'gaps'; maxTotal: number; maxPerDay: number; maxSingle: number }
/** `days: []` means every day. */
export interface BannedPeriodsRule extends RuleBase { kind: 'bannedPeriods'; from: number; to: number; days: Day[] }
/** Sessions must lie within [earliest, latest]. `days: []` means every day. */
export interface DayWindowRule extends RuleBase { kind: 'dayWindow'; earliest: number; latest: number; days: Day[] }
export interface KeepGroupRule extends RuleBase { kind: 'keepGroup'; course: string; group: string }
export interface AvoidGroupRule extends RuleBase { kind: 'avoidGroup'; course: string; group: string }
export interface MaxChangesRule extends RuleBase { kind: 'maxChanges'; max: number }
export interface NoSingleSessionDaysRule extends RuleBase { kind: 'noSingleSessionDays' }

export type Rule =
  | DaysOffRule
  | GapsRule
  | BannedPeriodsRule
  | DayWindowRule
  | KeepGroupRule
  | AvoidGroupRule
  | MaxChangesRule
  | NoSingleSessionDaysRule;

export const PERIODS_PER_SLOT = 2;

export interface Candidate {
  /** course code → equivalent group ids the student can pick */
  picks: Record<string, string[]>;
  sessions: Placed[];
  stats: WeekStats;
  /** course code → currently registered group id */
  current: Record<string, string | null>;
}

/** cost 0 = rule satisfied; higher = further from satisfied. */
export interface Verdict {
  cost: number;
  broken: string[];
}

const describe = (p: Placed) => `${p.session.day} ${p.session.from}-${p.session.to} ${p.courseName} ${p.session.type}`;
const onDays = (days: Day[], d: Day) => days.length === 0 || days.includes(d);

export function changedCourses(c: Candidate): string[] {
  return Object.keys(c.picks).filter((code) => {
    const cur = c.current[code];
    return cur != null && !c.picks[code].includes(cur);
  });
}

export function evaluate(rule: Rule, c: Candidate): Verdict {
  const broken: string[] = [];
  let cost = 0;
  switch (rule.kind) {
    case 'daysOff': {
      const short = rule.minOff - c.stats.offDays.length;
      if (short > 0) {
        cost += short;
        broken.push(`only ${c.stats.offDays.length} days off (need ${rule.minOff})`);
      }
      for (const d of rule.mustOff) {
        if (c.stats.usedDays.includes(d)) {
          cost++;
          broken.push(`${d} is not off`);
        }
      }
      break;
    }
    case 'gaps': {
      const total = c.stats.totalGapPeriods / PERIODS_PER_SLOT;
      if (total > rule.maxTotal) {
        cost += total - rule.maxTotal;
        broken.push(`${total} gaps in total (max ${rule.maxTotal})`);
      }
      for (const d of c.stats.days) {
        const n = d.gapPeriods / PERIODS_PER_SLOT;
        if (n > rule.maxPerDay) {
          cost += n - rule.maxPerDay;
          broken.push(`${d.day} has ${n} gaps (max ${rule.maxPerDay})`);
        }
        const longest = d.longestGap / PERIODS_PER_SLOT;
        if (longest > rule.maxSingle) {
          cost += longest - rule.maxSingle;
          broken.push(`${d.day} has a ${longest}-slot gap (max ${rule.maxSingle})`);
        }
      }
      break;
    }
    case 'bannedPeriods':
      for (const p of c.sessions) {
        if (onDays(rule.days, p.session.day) && p.session.from <= rule.to && rule.from <= p.session.to) {
          cost++;
          broken.push(describe(p));
        }
      }
      break;
    case 'dayWindow':
      for (const p of c.sessions) {
        if (onDays(rule.days, p.session.day) && (p.session.from < rule.earliest || p.session.to > rule.latest)) {
          cost++;
          broken.push(describe(p));
        }
      }
      break;
    case 'keepGroup':
      if (!(c.picks[rule.course] ?? []).includes(rule.group)) {
        cost = 1;
        broken.push(`not in ${rule.course} ${rule.group}`);
      }
      break;
    case 'avoidGroup': {
      const ids = c.picks[rule.course] ?? [];
      if (ids.length > 0 && ids.every((g) => g === rule.group)) {
        cost = 1;
        broken.push(`in ${rule.course} ${rule.group}`);
      }
      break;
    }
    case 'maxChanges': {
      const n = changedCourses(c).length;
      if (n > rule.max) {
        cost = n - rule.max;
        broken.push(`${n} changes (max ${rule.max})`);
      }
      break;
    }
    case 'noSingleSessionDays':
      for (const d of c.stats.days) {
        if (d.sessions === 1) {
          cost++;
          broken.push(`${d.day} has only 1 class`);
        }
      }
      break;
  }
  return { cost, broken };
}
```

- [x] **Step 4: Run the tests and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all tests PASS, no type errors.

---

### Task 4: Solver, with search, merging, ranking and near-misses

**Files:**
- Create: `src/core/solver.ts`
- Test: `tests/solver.test.ts`

**Interfaces:**
- Consumes: `Dataset`, `DAYS`, `Day`, `Session` (Task 1); `weekStats`, `Placed`, `WeekStats` (Task 2); `Rule`, `DaysOffRule`, `Candidate`, `evaluate`, `changedCourses` (Task 3)
- Produces:
  - `interface SolveOptions { excluded?: Record<string, string[]>; limit?: number; nearMissLimit?: number }`
  - `interface BrokenRule { ruleId: string; messages: string[] }`
  - `interface Solution { picks: Record<string, string[]>; sessions: Placed[]; stats: WeekStats; changes: string[]; mustBroken: BrokenRule[]; mustCost: number; preferCosts: number[] }`
  - `interface SolveResult { total: number; solutions: Solution[]; nearMisses: Solution[] }`
  - `solve(ds: Dataset, rules: Rule[], opts?: SolveOptions): SolveResult`

These are the expected values, all hand-verified during the 2026-09-24 session with an independent Python search:

| Rules | Expected |
|---|---|
| must: ≥3 days off | **57** schedules |
| + must: 0 gaps | **8** |
| + must: no 9-10, ≤2 gaps, ≤1 per day | **0**, with near-misses breaking exactly 1 must rule |
| must: ≥3 days off, keep OOP J + Net I | **1**, Option 1 |
| must: ≥3 days off, Networks K marked full | **50** |
| must: ≥3 days off, Database G (merged G/H) | **17** of the 57 |

- [x] **Step 1: Write the failing test `tests/solver.test.ts`**

```ts
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

  test('prefer "fewest changes" ranks the registered schedule first', () => {
    const r = solve(sept24, [daysOff3, { id: 'ch', strength: 'prefer', kind: 'maxChanges', max: 0 }]);
    expect(isOption1(r.solutions[0])).toBe(true);
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
```

- [x] **Step 2: Run it and check that it fails**

Run: `npx vitest run tests/solver.test.ts`
Expected: FAIL, because `../src/core/solver` doesn't exist yet.

- [x] **Step 3: Write `src/core/solver.ts`**

```ts
import { DAYS, type Dataset, type Day, type Session } from './types';
import { weekStats, type Placed, type WeekStats } from './week';
import { changedCourses, evaluate, type Candidate, type DaysOffRule, type Rule } from './rules';

export interface SolveOptions {
  /** course code → group ids marked full by the student */
  excluded?: Record<string, string[]>;
  /** max solutions returned (total is always the full count). Default 200. */
  limit?: number;
  /** max near-misses returned when nothing satisfies every must rule. Default 20. */
  nearMissLimit?: number;
}

export interface BrokenRule {
  ruleId: string;
  messages: string[];
}

export interface Solution {
  /** course code → equivalent group ids (identical times), e.g. ['G', 'H'] */
  picks: Record<string, string[]>;
  sessions: Placed[];
  stats: WeekStats;
  /** course codes whose current group is not among the picks */
  changes: string[];
  mustBroken: BrokenRule[];
  mustCost: number;
  /** one cost per prefer rule, in rule order; lower is better */
  preferCosts: number[];
}

export interface SolveResult {
  total: number;
  solutions: Solution[];
  nearMisses: Solution[];
}

interface Unit {
  ids: string[];
  placed: Placed[];
  masks: Partial<Record<Day, number>>;
}

interface CourseUnits {
  code: string;
  units: Unit[];
}

function maskOf(s: Session): number {
  let m = 0;
  for (let p = s.from; p <= s.to; p++) m |= 1 << p;
  return m;
}

/**
 * One unit per distinct timetable in each course. Groups with identical sessions merge into one unit.
 * In strict mode, groups ruled out by must keep/avoid/bannedPeriods/dayWindow rules are dropped up front.
 */
function buildUnits(ds: Dataset, must: Rule[], excluded: Record<string, string[]>): CourseUnits[] {
  return ds.courses
    .map((course) => {
      const byKey = new Map<string, Unit>();
      for (const g of course.groups) {
        if (!g.open || (excluded[course.code] ?? []).includes(g.id)) continue;
        if (must.some((r) => r.kind === 'keepGroup' && r.course === course.code && r.group !== g.id)) continue;
        if (must.some((r) => r.kind === 'avoidGroup' && r.course === course.code && r.group === g.id)) continue;
        const placed = g.sessions.map((session) => ({ course: course.code, courseName: course.name, group: g.id, session }));
        const probe: Candidate = { picks: {}, sessions: placed, stats: weekStats(g.sessions), current: {} };
        if (must.some((r) => (r.kind === 'bannedPeriods' || r.kind === 'dayWindow') && evaluate(r, probe).cost > 0)) continue;
        const key = g.sessions.map((s) => `${s.day}${s.from}-${s.to}${s.type}`).sort().join('|');
        const existing = byKey.get(key);
        if (existing) {
          existing.ids.push(g.id);
          continue;
        }
        const masks: Partial<Record<Day, number>> = {};
        for (const s of g.sessions) masks[s.day] = (masks[s.day] ?? 0) | maskOf(s);
        byKey.set(key, { ids: [g.id], placed, masks });
      }
      return { code: course.code, units: [...byKey.values()] };
    })
    .sort((a, b) => a.units.length - b.units.length);
}

/** Depth-first search over one unit per course, skipping clashes. `prune(usedDays)` cuts a branch early. */
function search(courses: CourseUnits[], prune: (used: Set<Day>) => boolean, onLeaf: (chosen: Unit[]) => void): void {
  const occ: Partial<Record<Day, number>> = {};
  const chosen: Unit[] = [];
  const rec = (i: number): void => {
    if (i === courses.length) {
      onLeaf(chosen);
      return;
    }
    for (const u of courses[i].units) {
      const days = Object.keys(u.masks) as Day[];
      if (days.some((d) => (occ[d] ?? 0) & u.masks[d]!)) continue;
      for (const d of days) occ[d] = (occ[d] ?? 0) | u.masks[d]!;
      if (!prune(new Set(DAYS.filter((d) => occ[d])))) {
        chosen.push(u);
        rec(i + 1);
        chosen.pop();
      }
      for (const d of days) occ[d] = occ[d]! & ~u.masks[d]!;
    }
  };
  rec(0);
}

function compareCosts(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

export function solve(ds: Dataset, rules: Rule[], opts: SolveOptions = {}): SolveResult {
  const excluded = opts.excluded ?? {};
  const limit = opts.limit ?? 200;
  const nearMissLimit = opts.nearMissLimit ?? 20;
  const must = rules.filter((r) => r.strength === 'must');
  const prefer = rules.filter((r) => r.strength === 'prefer');
  const dayRules = must.filter((r): r is DaysOffRule => r.kind === 'daysOff');
  const current = Object.fromEntries(ds.courses.map((c) => [c.code, c.current]));
  const courseOrder = ds.courses.map((c) => c.code);

  const key = (s: Solution) => courseOrder.map((c) => s.picks[c].join('/')).join(',');
  const byPrefer = (a: Solution, b: Solution) => compareCosts(a.preferCosts, b.preferCosts) || key(a).localeCompare(key(b));

  const toSolution = (courses: CourseUnits[], chosen: Unit[]): Solution => {
    const picks: Record<string, string[]> = {};
    chosen.forEach((u, i) => (picks[courses[i].code] = [...u.ids]));
    const sessions = chosen.flatMap((u) => u.placed);
    const cand: Candidate = { picks, sessions, stats: weekStats(sessions.map((p) => p.session)), current };
    const verdicts = must.map((r) => ({ ruleId: r.id, v: evaluate(r, cand) })).filter((x) => x.v.cost > 0);
    return {
      picks,
      sessions,
      stats: cand.stats,
      changes: changedCourses(cand),
      mustBroken: verdicts.map((x) => ({ ruleId: x.ruleId, messages: x.v.broken })),
      mustCost: verdicts.reduce((n, x) => n + x.v.cost, 0),
      preferCosts: prefer.map((r) => evaluate(r, cand).cost),
    };
  };

  // Strict pass: every must rule enforced.
  const strict = buildUnits(ds, must, excluded);
  const solutions: Solution[] = [];
  search(
    strict,
    (used) => dayRules.some((r) => DAYS.length - used.size < r.minOff || r.mustOff.some((d) => used.has(d))),
    (chosen) => {
      const s = toSolution(strict, chosen);
      if (s.mustBroken.length === 0) solutions.push(s);
    },
  );
  if (solutions.length > 0) {
    solutions.sort(byPrefer);
    return { total: solutions.length, solutions: solutions.slice(0, limit), nearMisses: [] };
  }

  // Relaxed pass: only clashes and full groups are hard; rank by how little the must rules are broken.
  const relaxed = buildUnits(ds, [], excluded);
  const all: Solution[] = [];
  search(relaxed, () => false, (chosen) => all.push(toSolution(relaxed, chosen)));
  all.sort((a, b) => a.mustBroken.length - b.mustBroken.length || a.mustCost - b.mustCost || byPrefer(a, b));
  return { total: 0, solutions: [], nearMisses: all.slice(0, nearMissLimit) };
}
```

- [x] **Step 4: Run the full suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all tests PASS (dataset 4, week 7, rules 8, solver 12), no type errors.

- [x] **Step 5: Check the solver is fast enough to feel instant**

Run: `npx vitest run tests/solver.test.ts --reporter=verbose`
Expected: every solver test finishes in well under 1 s. The relaxed near-miss test is the slowest, and it should still be under 1 s.

---

## Self-Review

- **Spec coverage:**

  | Spec section | Covered by |
  |---|---|
  | §7 data format + import validation (§11) | Task 1 |
  | §8 gap definition | Tasks 2 and 3 |
  | §8 rule table: all 8 kinds, must/prefer/off | Task 3, plus the off test in Task 4 |
  | §8 search, dedupe/merge, lexicographic ranking, near-misses, mark-as-full | Task 4 |
  | §12 solver fixture numbers (57 / 8 / 0 / registered present) | Task 4 tests |
  | §2 safety, §4–6 portal reading, §9 Gemini, §10 UI | out of scope for this plan; Plans 2 and 3 |

- **Placeholders:** none. Every code step has complete code.
- **Type consistency:** these names match everywhere they're used across Tasks 1–4:
  - `Placed`, `WeekStats` and `DayStats` (`gapPeriods`, `longestGap`)
  - `Candidate` (`picks`, `sessions`, `stats`, `current`)
  - `Verdict` (`cost`, `broken`)
  - `Solution` (`mustBroken`, `mustCost`, `preferCosts`, `changes`)
  - `SolveOptions` (`excluded`, `limit`, `nearMissLimit`)
