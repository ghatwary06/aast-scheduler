# AASTMT Schedule Planner: Plan 2, Portal Parsers + Safety Guard

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read the real AASTMT portal pages exactly, and make it impossible for the extension to activate anything that can change a registration.

**Architecture:** Pure functions that take a `Document`, so the same code runs in the content script and in Vitest (jsdom):

- `grid.ts`: reads the portal's timetable table, using cell position and `colspan`
- `registered.ts`: reads the registered view (current groups and timetable)
- `groupPage.ts`: reads a `?` page (`frm_CourseClassReg.aspx?pg=N`)
- `safety.ts`: holds the allowlist/denylist guard (spec §2 layers 1–2) and the submit/postback blocker (layer 3)

Layer 4 (no dropdown writes) is enforced by a source-scanning test. Everything is tested against sanitized copies of the student's real saved pages.

**Tech Stack:** TypeScript, Vitest, jsdom.

**Spec:** `docs/superpowers/specs/2026-09-25-aast-scheduler-design.md`

## Global Constraints

- **Spec §2 is absolute:** never click, submit or trigger Confirm Registration, Select, Delete Registration, the delete icons, Add, Insert Term Courses or Logout, and never change a dropdown.
- **Portal facts, observed from the saved pages on 2026-09-25:**
  - **Every button is an ASP.NET `__doPostBack('<target>','')` link.**
  - **The same element id means different things on different pages.** `ctl00_ContentPlaceHolder1_LinkButton2` is **Logout** on `frm_Register.aspx` but **Back** on `frm_CourseClassReg.aspx`, so every guard decision is page-aware.
  - **? page links are plain GETs:** `frm_CourseClassReg.aspx?pg=N`.
  - **Timetable tables:** the header is `th(blank), th(blank spacer), th 1..16`. Each day row is `th(day)`, then one blank spacer `td`, then period cells, with `colspan` giving a session's length. Every row sums to 17 columns.
  - **Session cell text:** `span[id$="_lbSelect"]` with `<br>`-separated lines. On the registered view it's `Course Name (CODE )`, `Lect.|Sec.|Lab.`, lecturer. On a ? page it's `CODE`, `Lec.|Sec.|Lab.`, lecturer.
- **Fixtures come only from `tools/sanitize-portal-page.py`.** Raw saves live in `tests/fixtures/portal/raw/`, which is gitignored.
- Any unexpected layout throws `PortalParseError`. It never guesses.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/portal/grid.ts` | `PortalParseError`, `clean`, `parseType`, `parseScheduleTable` |
| `src/portal/registered.ts` | `groupIdFromLabel`, `parseRegisteredView` |
| `src/portal/groupPage.ts` | `parseGroupPage`, `toSession` |
| `src/portal/safety.ts` | `pageOf`, `controlInfo`, `postbackTarget`, `checkActivation`, `guardedActivate`, `installSubmitBlocker`, `SafetyError` |
| `tests/portal/*.test.ts` | parser + safety tests (jsdom) |
| `tests/portal/load.ts` | fixture loader |

---

### Task 1: Timetable grid parser

**Files:**
- Create: `src/portal/grid.ts`, `tests/portal/load.ts`
- Test: `tests/portal/grid.test.ts`

**Interfaces:**
- Consumes: `Day`, `SessionType` (Plan 1 `src/core/types.ts`)
- Produces:
  - `class PortalParseError extends Error`
  - `clean(s: string | null | undefined): string`
  - `parseType(raw: string): SessionType`
  - `interface GridEntry { day: Day; from: number; to: number; courseCode: string; type: SessionType; lecturer: string }`
  - `parseScheduleTable(table: Element | null): GridEntry[]`
  - `loadFixture(name: string): Document` (tests only)

- [x] **Step 1: Write `tests/portal/load.ts`**

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Vitest runs from the project root; under jsdom, import.meta.url is not a file URL. */
export function loadFixture(name: string): Document {
  const html = readFileSync(join(process.cwd(), 'tests/fixtures/portal', name), 'utf8');
  return new DOMParser().parseFromString(html, 'text/html');
}
```

- [x] **Step 2: Write the failing test `tests/portal/grid.test.ts`**

```ts
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
```

- [x] **Step 3: Run it and check that it fails**

Run: `npx vitest run tests/portal/grid.test.ts`
Expected: FAIL, because `../../src/portal/grid` doesn't exist yet.

- [x] **Step 4: Write `src/portal/grid.ts`**

```ts
import type { Day, SessionType } from '../core/types';

export class PortalParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PortalParseError';
  }
}

export interface GridEntry {
  day: Day;
  from: number;
  to: number;
  courseCode: string;
  type: SessionType;
  lecturer: string;
}

const DAY_NAMES: Record<string, Day> = {
  saturday: 'Sat',
  sunday: 'Sun',
  monday: 'Mon',
  tuesday: 'Tue',
  wednesday: 'Wed',
  thursday: 'Thu',
  friday: 'Fri',
};

/** 1 spacer column + 16 period columns. */
const COLUMNS = 17;

export function clean(s: string | null | undefined): string {
  return (s ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
}

export function parseType(raw: string): SessionType {
  const t = clean(raw).toLowerCase();
  if (t.startsWith('lec')) return 'Lec';
  if (t.startsWith('sec')) return 'Sec';
  if (t.startsWith('lab')) return 'Lab';
  throw new PortalParseError(`unknown session type "${raw}"`);
}

/** Text lines of an element, split at <br>. */
function lines(el: Element): string[] {
  const out = [''];
  const walk = (node: Node) => {
    node.childNodes.forEach((n) => {
      if (n.nodeType === 3) out[out.length - 1] += n.textContent ?? '';
      else if (n.nodeName === 'BR') out.push('');
      else walk(n);
    });
  };
  walk(el);
  return out.map(clean).filter((l) => l !== '');
}

export function parseScheduleTable(table: Element | null): GridEntry[] {
  if (!table || table.nodeName !== 'TABLE') throw new PortalParseError('timetable table not found');
  const rows = Array.from((table as HTMLTableElement).rows);
  const header = rows.shift();
  const nums = header ? Array.from(header.cells).slice(2).map((c) => clean(c.textContent)) : [];
  if (nums.join(',') !== Array.from({ length: 16 }, (_, i) => String(i + 1)).join(',')) {
    throw new PortalParseError('timetable header is not periods 1-16');
  }

  const entries: GridEntry[] = [];
  for (const row of rows) {
    const [dayCell, ...cells] = Array.from(row.cells);
    const dayName = clean(dayCell?.textContent);
    const day = DAY_NAMES[dayName.toLowerCase()];
    if (!day || dayCell.nodeName !== 'TH') throw new PortalParseError(`unknown day row "${dayName}"`);
    let col = 0;
    for (const td of cells) {
      const span = td.colSpan || 1;
      const items = Array.from(td.querySelectorAll('span[id$="_lbSelect"]'));
      if (items.length === 0 && clean(td.textContent) !== '') {
        throw new PortalParseError(`${dayName}: unexpected cell content "${clean(td.textContent)}"`);
      }
      for (const item of items) {
        const [first = '', type = '', lecturer = ''] = lines(item);
        const code = first.match(/([A-Z]{2,4})\s*(\d{3,4})/);
        if (!code) throw new PortalParseError(`${dayName}: no course code in "${first}"`);
        if (col < 1 || col + span - 1 > 16) throw new PortalParseError(`${dayName}: session outside periods 1-16`);
        entries.push({ day, from: col, to: col + span - 1, courseCode: code[1] + code[2], type: parseType(type), lecturer });
      }
      col += span;
    }
    if (col !== COLUMNS) throw new PortalParseError(`${dayName} row has ${col - 1} columns, expected 16`);
  }
  return entries;
}
```

- [x] **Step 5: Run the tests and typecheck**

Run: `npx vitest run tests/portal/grid.test.ts && npx tsc --noEmit`
Expected: 4 tests PASS, no type errors.

---

### Task 2: Registered view and ? page parsers

**Files:**
- Create: `src/portal/registered.ts`, `src/portal/groupPage.ts`
- Test: `tests/portal/pages.test.ts`

**Interfaces:**
- Consumes: `parseScheduleTable`, `clean`, `GridEntry`, `PortalParseError` (Task 1); `Session` (Plan 1); `sept24` fixture (Plan 1)
- Produces:
  - `groupIdFromLabel(label: string): string`: `"T3 Class J"` → `"J"`, `"T3 Extra"` → `"Extra"`, `"T3 Class M NH"` → `"M NH"`
  - `interface RegisteredCourse { code: string; name: string; group: string; classLetter: string }`
  - `parseRegisteredView(doc: Document): { courses: RegisteredCourse[]; entries: GridEntry[] }`
  - `interface GroupPageItem { group: string; classLetter: string; lecturers: string; entries: GridEntry[] }`
  - `interface GroupPage { courseCode: string; courseName: string; page: number; pageCount: number; items: GroupPageItem[] }`
  - `parseGroupPage(doc: Document): GroupPage`
  - `toSession(e: GridEntry): Session`

- [x] **Step 1: Write the failing test `tests/portal/pages.test.ts`**

```ts
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
    expect(() => groupIdFromLabel('Group J')).toThrow(PortalParseError);
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

  test('throws on a page that is not a ? page', () => {
    expect(() => parseGroupPage(loadFixture('register-registered.html'))).toThrow(PortalParseError);
  });
});
```

- [x] **Step 2: Run it and check that it fails**

Run: `npx vitest run tests/portal/pages.test.ts`
Expected: FAIL, because the modules don't exist yet.

- [x] **Step 3: Write `src/portal/registered.ts`**

```ts
import { clean, parseScheduleTable, PortalParseError, type GridEntry } from './grid';

export interface RegisteredCourse {
  code: string;
  name: string;
  group: string;
  classLetter: string;
}

export function groupIdFromLabel(label: string): string {
  const m = clean(label).match(/^T\d+\s+(?:Class\s+)?(.+)$/);
  if (!m) throw new PortalParseError(`unrecognised group label "${label}"`);
  return m[1];
}

export function parseRegisteredView(doc: Document): { courses: RegisteredCourse[]; entries: GridEntry[] } {
  const table = doc.getElementById('ctl00_ContentPlaceHolder1_grdvw_courses') as HTMLTableElement | null;
  if (!table) throw new PortalParseError('registered courses table not found');
  const courses = Array.from(table.rows)
    .slice(1)
    .map((row) => {
      const cells = row.cells;
      if (cells.length < 7) throw new PortalParseError(`course row has ${cells.length} cells, expected 7`);
      const code = clean(cells[0].querySelector('span[id$="_Label1"]')?.textContent);
      const classLetter = clean(cells[6].querySelector('span[id$="_txt_cls"]')?.textContent);
      if (!code || !classLetter) throw new PortalParseError('course row is missing its code or class');
      return { code, name: clean(cells[1].textContent), group: groupIdFromLabel(cells[5].textContent ?? ''), classLetter };
    });
  const entries = parseScheduleTable(doc.querySelector('#ctl00_ContentPlaceHolder1_Schedule1 table'));
  return { courses, entries };
}
```

- [x] **Step 4: Write `src/portal/groupPage.ts`**

```ts
import type { Session } from '../core/types';
import { clean, parseScheduleTable, PortalParseError, type GridEntry } from './grid';
import { groupIdFromLabel } from './registered';

export interface GroupPageItem {
  group: string;
  classLetter: string;
  lecturers: string;
  entries: GridEntry[];
}

export interface GroupPage {
  courseCode: string;
  courseName: string;
  page: number;
  pageCount: number;
  items: GroupPageItem[];
}

const PAGE_LINK = /frm_CourseClassReg\.aspx\?pg=(\d+)$/i;

export function toSession(e: GridEntry): Session {
  return { day: e.day, from: e.from, to: e.to, type: e.type, lecturer: e.lecturer };
}

export function parseGroupPage(doc: Document): GroupPage {
  const courseCode = clean(doc.getElementById('ctl00_ContentPlaceHolder1_lbl_crs_code')?.textContent);
  const courseName = clean(doc.getElementById('ctl00_ContentPlaceHolder1_lbl_CrsName')?.textContent);
  if (!courseCode) throw new PortalParseError('not a group page: course code not found');

  const action = doc.querySelector('form#aspnetForm')?.getAttribute('action') ?? '';
  const page = Number(action.match(PAGE_LINK)?.[1] ?? NaN);
  if (!Number.isInteger(page)) throw new PortalParseError(`cannot read page number from "${action}"`);
  const linked = Array.from(doc.querySelectorAll('a[href]'))
    .map((a) => Number(a.getAttribute('href')!.match(PAGE_LINK)?.[1] ?? NaN))
    .filter(Number.isInteger);
  const pageCount = Math.max(page, ...linked);

  const items = Array.from(doc.querySelectorAll('span[id$="_lbl_grp"]')).map((grp) => {
    const prefix = grp.id.slice(0, -'_lbl_grp'.length);
    const entries = parseScheduleTable(doc.querySelector(`[id="${prefix}_Schedule1"] table`));
    for (const e of entries) {
      if (e.courseCode !== courseCode) throw new PortalParseError(`group page for ${courseCode} lists ${e.courseCode}`);
    }
    return {
      group: groupIdFromLabel(grp.textContent ?? ''),
      classLetter: clean(doc.getElementById(`${prefix}_lbl_class`)?.textContent),
      lecturers: clean(doc.getElementById(`${prefix}_lbl_lecturer`)?.textContent),
      entries,
    };
  });
  if (items.length === 0) throw new PortalParseError('group page has no groups');
  return { courseCode, courseName, page, pageCount, items };
}
```

- [x] **Step 5: Run the tests and typecheck**

Run: `npx vitest run tests/portal && npx tsc --noEmit`
Expected: all portal tests PASS, no type errors.

---

### Task 3: Safety guard, submit blocker, and the no-dropdown-writes check

**Files:**
- Create: `src/portal/safety.ts`
- Test: `tests/portal/safety.test.ts`

**Interfaces:**
- Consumes: `clean` (Task 1)
- Produces:
  - `type PortalPage = 'register' | 'groupList' | 'other'`
  - `pageOf(url: string): PortalPage`
  - `interface ControlInfo { id: string; text: string; href: string }`
  - `controlInfo(el: Element): ControlInfo`
  - `postbackTarget(href: string): string | null`
  - `type Decision = { allowed: true; rule: string } | { allowed: false; reason: string }`
  - `checkActivation(page: PortalPage, c: ControlInfo): Decision`
  - `class SafetyError extends Error`
  - `guardedActivate(el: Element, pageUrl: string, activate: (el: Element) => void): void`
  - `installSubmitBlocker(win: Window, page: PortalPage): () => void`

- [x] **Step 1: Write the failing test `tests/portal/safety.test.ts`**

```ts
// @vitest-environment jsdom
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  checkActivation, controlInfo, guardedActivate, installSubmitBlocker, pageOf, postbackTarget, SafetyError,
} from '../../src/portal/safety';
import { loadFixture } from './load';

const BASE = 'https://alexreg.aast.edu/aastreg/';

function decisions(fixture: string, url: string) {
  const doc = loadFixture(fixture);
  return Array.from(doc.querySelectorAll('a')).map((a) => ({ c: controlInfo(a), d: checkActivation(pageOf(url), controlInfo(a)) }));
}

describe('pageOf / postbackTarget', () => {
  test('recognises portal pages', () => {
    expect(pageOf(`${BASE}frm_Register.aspx`)).toBe('register');
    expect(pageOf(`${BASE}frm_CourseClassReg.aspx?pg=3`)).toBe('groupList');
    expect(pageOf(`${BASE}frm_Menu.aspx`)).toBe('other');
  });
  test('extracts postback targets', () => {
    expect(postbackTarget("javascript:__doPostBack('ctl00$ContentPlaceHolder1$lbtn_changeReg','')")).toBe('ctl00$ContentPlaceHolder1$lbtn_changeReg');
    expect(postbackTarget('frm_CourseClassReg.aspx?pg=2')).toBeNull();
  });
});

describe('checkActivation on the real saved pages', () => {
  test('registered view: only "Change Registered Courses" is allowed', () => {
    const ds = decisions('register-registered.html', `${BASE}frm_Register.aspx`);
    expect(ds.filter((x) => x.d.allowed).map((x) => x.c.text)).toEqual(['Change Registered Courses']);
    for (const text of ['Delete Registration', 'Logout', 'Home', 'Print Schedule', 'Print Guidance Card']) {
      expect(ds.find((x) => x.c.text === text)?.d.allowed, text).toBe(false);
    }
  });

  test('? pages: page links and Back are allowed; Select and Home are not', () => {
    for (const f of ['group-page-1.html', 'group-page-2.html']) {
      const ds = decisions(f, `${BASE}frm_CourseClassReg.aspx?pg=1`);
      const allowed = ds.filter((x) => x.d.allowed).map((x) => x.c.text);
      expect(allowed).toEqual(['Back', ...Array.from({ length: 16 }, (_, i) => String(i + 1))]);
      expect(ds.find((x) => x.c.text === 'Select')?.d.allowed).toBe(false);
      expect(ds.find((x) => x.c.text === 'Home')?.d.allowed).toBe(false);
    }
  });

  test('menu page: nothing is allowed', () => {
    expect(decisions('menu-registration-unavailable.html', `${BASE}frm_Menu.aspx`).some((x) => x.d.allowed)).toBe(false);
  });

  test('"Back" id on the registered view is Logout there, so it is refused', () => {
    const logout = { id: 'ctl00_ContentPlaceHolder1_LinkButton2', text: 'Logout', href: "javascript:__doPostBack('ctl00$ContentPlaceHolder1$LinkButton2','')" };
    expect(checkActivation('register', logout).allowed).toBe(false);
    expect(checkActivation('groupList', { ...logout, text: 'Back' }).allowed).toBe(true);
  });
});

describe('denylist beats allowlist', () => {
  const change = { id: 'ctl00_ContentPlaceHolder1_lbtn_changeReg', href: "javascript:__doPostBack('ctl00$ContentPlaceHolder1$lbtn_changeReg','')" };
  test.each(['Confirm Registration', 'Select', 'Delete Registration', 'Add', 'Insert Term Courses', 'Logout', 'Save', 'Submit'])(
    'an allowlisted id labelled "%s" is refused',
    (text) => {
      const d = checkActivation('register', { ...change, text });
      expect(d.allowed).toBe(false);
    },
  );
  test('denylisted ids and postback targets are refused whatever the label', () => {
    expect(checkActivation('register', { id: 'ctl00_x_btn_Confirm', text: 'OK', href: '' }).allowed).toBe(false);
    expect(checkActivation('groupList', { id: 'a', text: 'Back', href: "javascript:__doPostBack('ctl00$x$btn_select_cls','')" }).allowed).toBe(false);
  });
});

describe('guardedActivate', () => {
  test('never calls activate for a refused control, and throws SafetyError', () => {
    const doc = loadFixture('register-registered.html');
    const del = doc.getElementById('ctl00_ContentPlaceHolder1_lbtn_cancelReg')!;
    const activate = vi.fn();
    expect(() => guardedActivate(del, `${BASE}frm_Register.aspx`, activate)).toThrow(SafetyError);
    expect(activate).not.toHaveBeenCalled();
  });
  test('calls activate for an allowed control', () => {
    const doc = loadFixture('register-registered.html');
    const change = doc.getElementById('ctl00_ContentPlaceHolder1_lbtn_changeReg')!;
    const activate = vi.fn();
    guardedActivate(change, `${BASE}frm_Register.aspx`, activate);
    expect(activate).toHaveBeenCalledWith(change);
  });
});

describe('installSubmitBlocker', () => {
  type W = Window & { __doPostBack?: (t: string, a: string) => void };
  const realSubmit = HTMLFormElement.prototype.submit;
  afterEach(() => {
    HTMLFormElement.prototype.submit = realSubmit;
    delete (window as W).__doPostBack;
    document.body.innerHTML = '';
  });

  function setup() {
    document.body.innerHTML = '<form id="aspnetForm"><input type="hidden" name="__EVENTTARGET" value=""></form>';
    const form = document.getElementById('aspnetForm') as HTMLFormElement;
    const submitted = vi.fn();
    HTMLFormElement.prototype.submit = submitted;
    // ASP.NET's own __doPostBack: set the target, then form.submit()
    (window as W).__doPostBack = (t: string) => {
      (form.elements.namedItem('__EVENTTARGET') as HTMLInputElement).value = t;
      form.submit();
    };
    return { form, submitted };
  }

  test.each([
    'ctl00$ContentPlaceHolder1$lbtn_cancelReg',
    'ctl00$ContentPlaceHolder1$DL_CrsTimeTbl$ctl01$btn_select_cls',
    'ctl00$ContentPlaceHolder1$btn_Confirm',
    'ctl00$ContentPlaceHolder1$LinkButton2',
  ])('blocks postback %s on the registered view', (target) => {
    const { submitted } = setup();
    const uninstall = installSubmitBlocker(window, 'register');
    expect(() => (window as W).__doPostBack!(target, '')).toThrow(SafetyError);
    expect(submitted).not.toHaveBeenCalled();
    uninstall();
  });

  test('blocks a direct form.submit() and a submit event with a non-allowlisted target', () => {
    const { form, submitted } = setup();
    const uninstall = installSubmitBlocker(window, 'register');
    expect(() => form.submit()).toThrow(SafetyError);
    const ev = new Event('submit', { cancelable: true, bubbles: true });
    form.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(submitted).not.toHaveBeenCalled();
    uninstall();
  });

  test('lets the allowlisted postback through, and uninstall restores everything', () => {
    const { submitted } = setup();
    const original = (window as W).__doPostBack;
    const uninstall = installSubmitBlocker(window, 'register');
    (window as W).__doPostBack!('ctl00$ContentPlaceHolder1$lbtn_changeReg', '');
    expect(submitted).toHaveBeenCalledTimes(1);
    uninstall();
    expect((window as W).__doPostBack).toBe(original);
    expect(HTMLFormElement.prototype.submit).toBe(submitted);
  });

  test('Back is allowed only on ? pages', () => {
    const { submitted } = setup();
    const uninstall = installSubmitBlocker(window, 'groupList');
    (window as W).__doPostBack!('ctl00$ContentPlaceHolder1$LinkButton2', '');
    expect(submitted).toHaveBeenCalledTimes(1);
    uninstall();
  });
});

describe('layer 4: no code can write to a dropdown', () => {
  test('src/ never assigns .value / .selected / selectedIndex or fires change events', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.ts')) files.push(readFileSync(p, 'utf8'));
      }
    };
    walk(join(process.cwd(), 'src'));
    expect(files.length).toBeGreaterThan(5);
    for (const src of files) {
      expect(src).not.toMatch(/\.value\s*=[^=]/);
      expect(src).not.toMatch(/\.selected\s*=[^=]/);
      expect(src).not.toMatch(/selectedIndex\s*=[^=]/);
      expect(src).not.toMatch(/new\s+Event\(\s*['"](change|input)['"]/);
    }
  });
});
```

- [x] **Step 2: Run it and check that it fails**

Run: `npx vitest run tests/portal/safety.test.ts`
Expected: FAIL, because `../../src/portal/safety` doesn't exist yet.

- [x] **Step 3: Write `src/portal/safety.ts`**

```ts
import { clean } from './grid';

/**
 * Spec §2: the extension must never activate anything that can change a registration.
 * Layer 1: allowlist (page-aware). Layer 2: denylist, which beats the allowlist.
 * Layer 3: installSubmitBlocker. Layer 4: tests/portal/safety.test.ts scans src/ for dropdown writes.
 */

export type PortalPage = 'register' | 'groupList' | 'other';

export interface ControlInfo {
  id: string;
  text: string;
  href: string;
}

export type Decision = { allowed: true; rule: string } | { allowed: false; reason: string };

export class SafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SafetyError';
  }
}

const DENY_TEXT = /\b(confirm|select|delete|cancel|log ?out|add|insert|remove|drop|save|submit)\b/i;
const DENY_ID = /(confirm|select|delete|cancel|logout|insert|remove|drop|save|submit|btn_?add|add_?btn)/i;

const CHANGE_REG = 'ctl00$ContentPlaceHolder1$lbtn_changeReg';
const BACK = 'ctl00$ContentPlaceHolder1$LinkButton2';

/** Postback targets the blocker lets through, per page. LinkButton2 is Back only on ? pages (it is Logout elsewhere). */
const ALLOWED_POSTBACKS: Record<PortalPage, ReadonlySet<string>> = {
  register: new Set([CHANGE_REG]),
  groupList: new Set([BACK]),
  other: new Set(),
};

interface AllowRule {
  page: PortalPage;
  name: string;
  match: (c: ControlInfo) => boolean;
}

const ALLOW: AllowRule[] = [
  {
    page: 'register',
    name: 'Change Registered Courses',
    match: (c) => c.id === 'ctl00_ContentPlaceHolder1_lbtn_changeReg' && c.text === 'Change Registered Courses' && postbackTarget(c.href) === CHANGE_REG,
  },
  {
    page: 'groupList',
    name: 'group page link',
    match: (c) => /^frm_CourseClassReg\.aspx\?pg=\d+$/.test(c.href) && /^\d+$/.test(c.text),
  },
  {
    page: 'groupList',
    name: 'Back',
    match: (c) => c.id === 'ctl00_ContentPlaceHolder1_LinkButton2' && c.text === 'Back' && postbackTarget(c.href) === BACK,
  },
];

export function pageOf(url: string): PortalPage {
  const path = new URL(url, 'https://alexreg.aast.edu/aastreg/').pathname.toLowerCase();
  if (path.endsWith('/frm_register.aspx')) return 'register';
  if (path.endsWith('/frm_courseclassreg.aspx')) return 'groupList';
  return 'other';
}

export function postbackTarget(href: string): string | null {
  return href.match(/__doPostBack\(\s*'([^']*)'/)?.[1] ?? null;
}

export function controlInfo(el: Element): ControlInfo {
  return { id: el.id, text: clean(el.textContent), href: el.getAttribute('href') ?? '' };
}

function denied(text: string, id: string, target: string): boolean {
  return DENY_TEXT.test(text) || DENY_ID.test(id) || DENY_ID.test(target);
}

export function checkActivation(page: PortalPage, c: ControlInfo): Decision {
  if (denied(c.text, c.id, postbackTarget(c.href) ?? '')) {
    return { allowed: false, reason: `refused: "${c.text || c.id}" can change a registration` };
  }
  const rule = ALLOW.find((r) => r.page === page && r.match(c));
  return rule ? { allowed: true, rule: rule.name } : { allowed: false, reason: `refused: "${c.text || c.id}" is not on the ${page} allowlist` };
}

export function guardedActivate(el: Element, pageUrl: string, activate: (el: Element) => void): void {
  const d = checkActivation(pageOf(pageUrl), controlInfo(el));
  if (!d.allowed) throw new SafetyError(d.reason);
  activate(el);
}

type PostBackWindow = Window & { __doPostBack?: (target: string, arg: string) => void; HTMLFormElement: typeof HTMLFormElement };

/**
 * While a read runs, refuse every form submission and postback except the page's allowlisted
 * targets. Must run in the page's own JS world (MAIN) to wrap __doPostBack. Returns an uninstaller.
 */
export function installSubmitBlocker(win: Window, page: PortalPage): () => void {
  const w = win as PostBackWindow;
  const allowed = ALLOWED_POSTBACKS[page];
  const proto = w.HTMLFormElement.prototype;
  const origSubmit = proto.submit;
  const origRequestSubmit = proto.requestSubmit;
  const origPostBack = w.__doPostBack;

  const check = (target: string) => {
    if (!allowed.has(target) || denied('', '', target)) throw new SafetyError(`blocked submission (target "${target || 'none'}")`);
  };
  const targetOf = (form: HTMLFormElement) => (form.elements.namedItem('__EVENTTARGET') as HTMLInputElement | null)?.value ?? '';

  proto.submit = function (this: HTMLFormElement) {
    check(targetOf(this));
    return origSubmit.call(this);
  };
  proto.requestSubmit = function (this: HTMLFormElement, submitter?: HTMLElement | null) {
    check(targetOf(this));
    return origRequestSubmit.call(this, submitter);
  };
  const onSubmit = (e: Event) => {
    try {
      check(targetOf(e.target as HTMLFormElement));
    } catch {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  };
  w.document.addEventListener('submit', onSubmit, true);
  if (origPostBack) {
    w.__doPostBack = (target: string, arg: string) => {
      check(target);
      return origPostBack(target, arg);
    };
  }

  return () => {
    proto.submit = origSubmit;
    proto.requestSubmit = origRequestSubmit;
    w.document.removeEventListener('submit', onSubmit, true);
    if (origPostBack) w.__doPostBack = origPostBack;
  };
}
```

- [x] **Step 4: Run the full suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all tests PASS (Plan 1's 31 + Plan 2's), no type errors.

---

## Not in this plan (needs the change view, captured while registration editing is open)

- The Class dropdown parser: open vs full groups, and label mapping (spec §13 Q1, Q3).
- The `?` icon's postback id, to be added to the allowlist, and the per-course reading loop (§13 Q2).
- Assembling a full `Dataset` from the dropdowns and ? pages.

## Self-Review

- **Spec coverage:** §2 layers 1–5 → Task 3. §4 page facts → Global Constraints. §6 reading pieces available offline → Tasks 1–2. §12 reader fixture tests and safety tests → Tasks 1–3. §13 Q4 (? pages list all groups) is answered: yes (16 pages vs 10 selectable).
- **Placeholders:** none.
- **Types:** these names match everywhere they're used:
  - `GridEntry` (`day`, `from`, `to`, `courseCode`, `type`, `lecturer`)
  - `GroupPageItem` (`group`, `classLetter`, `lecturers`, `entries`)
  - `ControlInfo` (`id`, `text`, `href`)
  - `Decision` (`allowed`, `rule` | `reason`)
