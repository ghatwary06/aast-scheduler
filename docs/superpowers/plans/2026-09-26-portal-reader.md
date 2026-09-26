# AASTMT Schedule Planner: Plan 4, Portal Reader

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From the popup on the registration portal's change page, read every course's groups, times and open/full status into a `Dataset`, with **no clicks, no page changes, and no way to send Confirm Registration**.

**Architecture: requests, not clicks.** This is a design change from spec §6, approved on 2026-09-26. For each course, the reader:
1. sends in the background the exact POST the ? icon would send (the form data plus `<? button name>.x/.y`)
2. then GETs `frm_CourseClassReg.aspx?pg=1..N`

The visible page never changes, so there's no "Back" and nothing is clicked.

Every request passes `checkPortalRequest`, a strict allowlist:
- **GET:** only `?pg=N` group pages
- **POST:** only a single ? submitter, with an empty `__EVENTTARGET`

It sits on top of the submit/postback blocker from Plan 2, which is installed in the page's JS world during the read.

**Tech Stack:** TypeScript, Vitest + jsdom, MV3 `chrome.scripting` with `activeTab` (no permanent portal host permission), Vite library builds for the two content scripts.

**Spec:** `docs/superpowers/specs/2026-09-25-aast-scheduler-design.md` (§2 still absolute; §6 superseded as above)

## Global Constraints

- **Spec §2:** never send, click or trigger Confirm Registration, Select, Delete (course or registration), Add, Insert Term Courses or Logout, and never change a dropdown.
- **Observed on the change page (saved 2026-09-26):**
  - **? icon:** an `<input type="image" name="ctl00$ContentPlaceHolder1$grdvw_courses$ctlNN$btn_grp_time_table_details" title="Click To View Course Time Table Details">`.
  - **The 🗑 icon next to it is structurally identical** except for `$btn_delete`.
  - **Class dropdown:** `select[id$="_drp_cls"]`. Changing it submits a postback.
  - **Open groups are the dropdown options**, minus `-99` "Any". Full groups are absent.
  - **The course table's Group column is the truth for the current group.** When the current group is full, the dropdown shows another option as selected.
  - **Option labels:** `<group> -<class> -<campus>`, e.g. `T3 Class B -L -Alexandria`, `T3 Class O Extra-Y -Alexandria`, `Share -I -Alexandria`.
- **The reader only runs on the change page.** On the plain registered view, it stops and asks the student to press Change Registered Courses themselves.
- **Unknown or odd portal output becomes a warning or an abort. Never a guess.** A ? page for the wrong course aborts ("stopped to be safe").
- **Fixture `tests/fixtures/portal/register-change.html`:**
  - sanitized by `tools/sanitize-portal-page.py`
  - anonymized to the made-up student: K/F/I/H/K/B, with DLD F and DB B full
  - staff names → `Staff`

---

## File Structure

| File | Responsibility |
|---|---|
| `src/portal/changeView.ts` | `parseDropdownLabel`, `parseChangeView` |
| `src/portal/requests.ts` | `DETAILS_BUTTON`, `buildDetailsRequest`, `checkPortalRequest` |
| `src/portal/reader.ts` | `readPortal` (the orchestration; injectable fetch) |
| `src/content/reader.ts` | content-script entry (isolated world): runs `readPortal`, stores the result/status |
| `src/content/blocker.ts` | MAIN-world entry: installs the submit blocker until the reader finishes |
| `tools/build-content.mjs` | builds the two entries as self-contained IIFE scripts into `dist/content/` |
| Modify `src/portal/registered.ts`, `src/portal/groupPage.ts` | accept labels without the `T3` prefix; expose the raw group label |
| Modify `src/popup/*`, `public/manifest.json`, `src/app/app.ts`, `package.json`, `tests/portal/safety.test.ts`, `tests/portal/pages.test.ts` | wiring, permissions, warnings display, scan scope |

---

### Task 1: Change-view parser

**Files:**
- Create: `src/portal/changeView.ts`
- Modify: `src/portal/registered.ts` (`groupIdFromLabel` accepts labels without `T\d`), `src/portal/groupPage.ts` (`GroupPageItem.label`), `tests/portal/pages.test.ts` (the old "Group J throws" expectation)
- Test: `tests/portal/changeView.test.ts`

**Interfaces:**
- Produces:
  - `parseDropdownLabel(label: string): { group: string; classLetter: string }`
  - `interface DropdownOption { value: string; label: string; group: string; classLetter: string }`
  - `interface ChangeCourse { row: string; code: string; name: string; current: string; currentClass: string; options: DropdownOption[]; detailsButton: string }`
  - `parseChangeView(doc: Document): ChangeCourse[]`
  - `GroupPageItem` gains `label: string`, the raw `lbl_grp` text

- [x] **Step 1: Relax `groupIdFromLabel` and expose the raw label**

In `src/portal/registered.ts` replace:
```ts
  const m = clean(label).match(/^T\d+\s+(?:Class\s+)?(.+)$/);
  if (!m) throw new PortalParseError(`unrecognised group label "${label}"`);
  return m[1];
```
with:
```ts
  const m = clean(label).match(/^(?:T\d+\s+)?(?:Class\s+)?(.*)$/);
  if (!m || !m[1]) throw new PortalParseError(`unrecognised group label "${label}"`);
  return m[1];
```

In `src/portal/groupPage.ts`, add `label: string;` to `GroupPageItem` and `label: clean(grp.textContent),` to the returned item.

In `tests/portal/pages.test.ts` replace `expect(() => groupIdFromLabel('Group J')).toThrow(PortalParseError);` with:
```ts
    expect(groupIdFromLabel('Share')).toBe('Share');
    expect(() => groupIdFromLabel('   ')).toThrow(PortalParseError);
```

- [x] **Step 2: Write the failing test `tests/portal/changeView.test.ts`**

```ts
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
```

- [x] **Step 3: Run it and check that it fails**

Run: `npx vitest run tests/portal/changeView.test.ts`
Expected: FAIL, because `changeView` doesn't exist yet.

- [x] **Step 4: Write `src/portal/changeView.ts`**

```ts
import { clean, PortalParseError } from './grid';
import { groupIdFromLabel } from './registered';

export interface DropdownOption {
  value: string;
  label: string;
  group: string;
  classLetter: string;
}

export interface ChangeCourse {
  /** grid row id, e.g. ctl02 */
  row: string;
  code: string;
  name: string;
  /** current group id, from the course table's Group column (the dropdown can't be trusted for this) */
  current: string;
  currentClass: string;
  /** open groups: the Class dropdown's options, minus "Any" */
  options: DropdownOption[];
  /** name of this row's ? image button */
  detailsButton: string;
}

/** "T3 Class B -L -Alexandria" -> { group: "B", classLetter: "L" } */
export function parseDropdownLabel(label: string): { group: string; classLetter: string } {
  const m = clean(label).match(/^(.*?)\s*-\s*(\S+)\s*-\s*(\S.*)$/);
  if (!m) throw new PortalParseError(`unrecognised class option "${label}"`);
  return { group: groupIdFromLabel(m[1]), classLetter: m[2] };
}

export function parseChangeView(doc: Document): ChangeCourse[] {
  const table = doc.getElementById('ctl00_ContentPlaceHolder1_grdvw_courses') as HTMLTableElement | null;
  if (!table) throw new PortalParseError('registered courses table not found');
  const rows = Array.from(table.rows).slice(1);
  if (!rows.some((r) => r.querySelector('select[id$="_drp_cls"]'))) {
    throw new PortalParseError('This is not the change page. Press "Change Registered Courses" yourself, then read again.');
  }
  return rows.map((row) => {
    const cells = row.cells;
    const code = clean(cells[0]?.querySelector('span[id$="_Label1"]')?.textContent);
    const select = row.querySelector('select[id$="_drp_cls"]') as HTMLSelectElement | null;
    const button = row.querySelector('input[type="image"][name$="$btn_grp_time_table_details"]') as HTMLInputElement | null;
    if (!code || !select || !button) throw new PortalParseError(`course row ${code || '?'} is missing its dropdown or ? button`);
    const options = Array.from(select.options)
      .filter((o) => !['', '-99'].includes(clean(o.value)))
      .map((o) => ({ value: clean(o.value), label: clean(o.textContent), ...parseDropdownLabel(o.textContent ?? '') }));
    return {
      row: button.name.match(/\$(ctl\d+)\$/)?.[1] ?? '',
      code,
      name: clean(cells[1]?.textContent),
      current: groupIdFromLabel(cells[5]?.textContent ?? ''),
      currentClass: clean(row.querySelector('span[id$="_txt_cls"]')?.textContent),
      options,
      detailsButton: button.name,
    };
  });
}
```

- [x] **Step 5: Run the tests and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all PASS.

---

### Task 2: Request guard

**Files:**
- Create: `src/portal/requests.ts`
- Test: `tests/portal/requests.test.ts`

**Interfaces:**
- Consumes: `SafetyError`, `pageOf` (Plan 2 `safety.ts`); `parseChangeView` (Task 1)
- Produces:
  - `DETAILS_BUTTON: RegExp`
  - `interface PortalRequest { method: 'GET' | 'POST'; url: string; body?: string }`
  - `buildDetailsRequest(form: HTMLFormElement, buttonName: string, pageUrl: string): PortalRequest`
  - `checkPortalRequest(req: PortalRequest): void`, which throws `SafetyError` unless the request is allowed

- [x] **Step 1: Write the failing test `tests/portal/requests.test.ts`**

```ts
// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { parseChangeView } from '../../src/portal/changeView';
import { buildDetailsRequest, checkPortalRequest, type PortalRequest } from '../../src/portal/requests';
import { SafetyError } from '../../src/portal/safety';
import { loadFixture } from './load';

const PAGE = 'https://alexreg.aast.edu/aastreg/frm_Register.aspx';
const doc = loadFixture('register-change.html');
const form = doc.getElementById('aspnetForm') as HTMLFormElement;
const courses = parseChangeView(doc);
const details = courses[0].detailsButton;
const post = (body: Record<string, string>): PortalRequest => ({ method: 'POST', url: PAGE, body: new URLSearchParams(body).toString() });

describe('buildDetailsRequest', () => {
  test('builds exactly what clicking a ? icon sends, for every course', () => {
    for (const c of courses) {
      const req = buildDetailsRequest(form, c.detailsButton, PAGE);
      const p = new URLSearchParams(req.body);
      expect(req.method).toBe('POST');
      expect(req.url).toBe(PAGE);
      expect(p.get(`${c.detailsButton}.x`)).toBe('0');
      expect(p.get(`${c.detailsButton}.y`)).toBe('0');
      expect(p.get('__EVENTTARGET')).toBe('');
      expect([...p.keys()].filter((k) => /\.(x|y)$/.test(k))).toHaveLength(2);
      expect(p.has('ctl00$ContentPlaceHolder1$grdvw_courses$ctl02$drp_cls')).toBe(true); // the form's own fields travel as-is
    }
  });

  test.each([
    'ctl00$ContentPlaceHolder1$grdvw_courses$ctl02$btn_delete',
    'ctl00$ContentPlaceHolder1$lbtn_confirm',
    'ctl00$ContentPlaceHolder1$lbtn_add',
    'ctl00$ContentPlaceHolder1$lbtn_grpdetails',
  ])('refuses to build a request for %s', (name) => {
    expect(() => buildDetailsRequest(form, name, PAGE)).toThrow(SafetyError);
  });
});

describe('checkPortalRequest', () => {
  test('allows group-page GETs and a single ? POST', () => {
    expect(() => checkPortalRequest({ method: 'GET', url: 'https://alexreg.aast.edu/aastreg/frm_CourseClassReg.aspx?pg=3' })).not.toThrow();
    expect(() => checkPortalRequest(post({ __EVENTTARGET: '', [`${details}.x`]: '0', [`${details}.y`]: '0' }))).not.toThrow();
  });

  test.each<[string, PortalRequest]>([
    ['Confirm as event target', post({ __EVENTTARGET: 'ctl00$ContentPlaceHolder1$lbtn_confirm', [`${details}.x`]: '0' })],
    ['Delete Registration as event target', post({ __EVENTTARGET: 'ctl00$ContentPlaceHolder1$lbtn_cancelReg' })],
    ['a dropdown postback', post({ __EVENTTARGET: 'ctl00$ContentPlaceHolder1$grdvw_courses$ctl02$drp_cls' })],
    ['the delete icon', post({ 'ctl00$ContentPlaceHolder1$grdvw_courses$ctl02$btn_delete.x': '0' })],
    ['two buttons at once', post({ [`${details}.x`]: '0', 'ctl00$ContentPlaceHolder1$grdvw_courses$ctl03$btn_delete.x': '0' })],
    ['no button at all', post({ __EVENTTARGET: '' })],
    ['a POST to the group pages', { method: 'POST', url: 'https://alexreg.aast.edu/aastreg/frm_CourseClassReg.aspx?pg=1', body: '' }],
    ['a GET of the registration page', { method: 'GET', url: PAGE }],
    ['another site', { method: 'GET', url: 'https://example.com/frm_CourseClassReg.aspx?pg=1' }],
    ['a strange page query', { method: 'GET', url: 'https://alexreg.aast.edu/aastreg/frm_CourseClassReg.aspx?pg=1&x=confirm' }],
  ])('refuses %s', (_, req) => {
    expect(() => checkPortalRequest(req)).toThrow(SafetyError);
  });
});
```

- [x] **Step 2: Run it and check that it fails**

Run: `npx vitest run tests/portal/requests.test.ts`
Expected: FAIL, because `requests` doesn't exist yet.

- [x] **Step 3: Write `src/portal/requests.ts`**

```ts
import { pageOf, SafetyError } from './safety';

/**
 * Spec §2 for the request-based reader. The reader never clicks. It only sends requests, and every
 * request must pass checkPortalRequest: GET of a ?pg=N group page, or one POST that presses a
 * single ? (group details) button with no postback target.
 */

export const DETAILS_BUTTON = /^ctl00\$ContentPlaceHolder1\$grdvw_courses\$ctl\d+\$btn_grp_time_table_details$/;
const DETAILS_TITLE = 'Click To View Course Time Table Details';
const DENY = /(confirm|delete|cancel|logout|insert|remove|drop|save|submit|select_cls|lbtn_add|btn_?add)/i;
const PORTAL_ORIGIN = 'https://alexreg.aast.edu';

export interface PortalRequest {
  method: 'GET' | 'POST';
  url: string;
  body?: string;
}

export function checkPortalRequest(req: PortalRequest): void {
  const url = new URL(req.url);
  if (url.origin !== PORTAL_ORIGIN) throw new SafetyError(`refused: request to ${url.origin}`);
  const page = pageOf(url.href);
  if (req.method === 'GET') {
    if (page === 'groupList' && /^\?pg=\d+$/.test(url.search) && !req.body) return;
    throw new SafetyError(`refused: GET ${url.pathname}${url.search}`);
  }
  if (req.method !== 'POST' || page !== 'register' || req.body === undefined) {
    throw new SafetyError(`refused: ${req.method} ${url.pathname}`);
  }
  const p = new URLSearchParams(req.body);
  if ((p.get('__EVENTTARGET') ?? '') !== '' || (p.get('__EVENTARGUMENT') ?? '') !== '') {
    throw new SafetyError(`refused: request carries a postback target "${p.get('__EVENTTARGET')}"`);
  }
  const pressed = [...new Set([...p.keys()].filter((k) => /\.(x|y)$/.test(k)).map((k) => k.slice(0, -2)))];
  if (pressed.length !== 1 || !DETAILS_BUTTON.test(pressed[0]) || DENY.test(pressed[0])) {
    throw new SafetyError(`refused: request would press ${pressed.join(' + ') || 'no button'}`);
  }
}

export function buildDetailsRequest(form: HTMLFormElement, buttonName: string, pageUrl: string): PortalRequest {
  if (!DETAILS_BUTTON.test(buttonName)) throw new SafetyError(`refused: "${buttonName}" is not a ? (group details) button`);
  // form.elements never lists <input type=image> (HTML spec), so look among the form's image inputs
  const button = Array.from(form.querySelectorAll<HTMLInputElement>('input[type="image"]')).find((el) => el.name === buttonName);
  if (!button || button.type !== 'image' || button.title !== DETAILS_TITLE) {
    throw new SafetyError(`refused: "${buttonName}" is not the ? button it claims to be`);
  }
  const params = new URLSearchParams();
  for (const [k, v] of new FormData(form)) if (typeof v === 'string') params.append(k, v);
  params.set('__EVENTTARGET', '');
  params.set('__EVENTARGUMENT', '');
  params.append(`${buttonName}.x`, '0');
  params.append(`${buttonName}.y`, '0');
  const req: PortalRequest = { method: 'POST', url: new URL(form.getAttribute('action') ?? '', pageUrl).href, body: params.toString() };
  checkPortalRequest(req);
  return req;
}
```

- [x] **Step 4: Run the tests and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all PASS.

---

### Task 3: The reader

**Files:**
- Create: `src/portal/reader.ts`
- Test: `tests/portal/reader.test.ts`

**Interfaces:**
- Consumes: `parseChangeView` (Task 1); `buildDetailsRequest`, `checkPortalRequest`, `PortalRequest` (Task 2); `parseGroupPage`, `toSession`, `GroupPageItem` (Plan 2); `validateDataset`, `Dataset`, `Group` (Plan 1); `pageOf`, `PortalParseError`, `clean`
- Produces:
  - `interface HttpText { ok: boolean; status: number; url: string; text: string }`
  - `type FetchText = (url: string, init: { method: 'GET' | 'POST'; headers?: Record<string, string>; body?: string; credentials: 'include'; redirect: 'follow' }) => Promise<HttpText>`
  - `interface ReadResult { dataset: Dataset; warnings: string[] }`
  - `readPortal(doc, pageUrl, fetchText, opts?: { delayMs?: number; onProgress?: (msg: string) => void; parse?: (html: string) => Document }): Promise<ReadResult>`

- [x] **Step 1: Write the failing test `tests/portal/reader.test.ts`**

```ts
// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { validateDataset } from '../../src/core/dataset';
import { parseChangeView, type ChangeCourse } from '../../src/portal/changeView';
import { readPortal, type FetchText } from '../../src/portal/reader';
import { DETAILS_BUTTON } from '../../src/portal/requests';
import { loadFixture } from './load';

const PAGE = 'https://alexreg.aast.edu/aastreg/frm_Register.aspx';
const TEMPLATE = readFileSync(join(process.cwd(), 'tests/fixtures/portal/group-page-1.html'), 'utf8');

/** A fake portal: the ? POST selects a course; ?pg=N serves one group page per open group, plus the current group if full, plus a full "Z". */
function fakePortal(courses: ChangeCourse[], opts: { wrongCourse?: boolean; loggedOut?: boolean } = {}) {
  const groupsFor = new Map(
    courses.map((c) => [
      c.code,
      [
        ...c.options.map((o) => ({ group: o.group, cls: o.classLetter })),
        ...(c.options.some((o) => o.group === c.current) ? [] : [{ group: c.current, cls: c.currentClass }]),
        { group: 'Z', cls: 'Z' },
      ],
    ]),
  );
  const requests: { method: string; url: string; body?: string }[] = [];
  let selected = '';
  const fetchText: FetchText = async (url, init) => {
    requests.push({ method: init.method, url, body: init.body });
    if (opts.loggedOut) return { ok: true, status: 200, url: 'https://alexreg.aast.edu/aastreg/frm_login.aspx', text: '' };
    if (init.method === 'POST') {
      const pressed = [...new URLSearchParams(init.body).keys()].find((k) => k.endsWith('.x'))!.slice(0, -2);
      selected = courses.find((c) => c.detailsButton === pressed)!.code;
      return { ok: true, status: 200, url: 'https://alexreg.aast.edu/aastreg/frm_CourseClassReg.aspx?pg=1', text: '' };
    }
    const pg = Number(new URL(url).searchParams.get('pg'));
    const gs = groupsFor.get(selected)!;
    const g = gs[pg - 1];
    const code = opts.wrongCourse ? 'XXX9999' : selected;
    const html = TEMPLATE.replaceAll('EBA2204', code)
      .replace('action="frm_CourseClassReg.aspx?pg=1"', `action="frm_CourseClassReg.aspx?pg=${pg}"`)
      .replace(/(_lbl_grp">)[^<]*/, `$1T3 Class ${g.group} `)
      .replace(/(_lbl_class">)[^<]*/, `$1${g.cls} `)
      .replace(/<a href="frm_CourseClassReg\.aspx\?pg=(\d+)">\d+<\/a>/g, (m, n) => (Number(n) <= gs.length ? m : ''));
    return { ok: true, status: 200, url, text: html };
  };
  return { fetchText, requests, groupsFor };
}

describe('readPortal', () => {
  const doc = loadFixture('register-change.html');
  const courses = parseChangeView(doc);

  test('reads every course into a valid dataset with open/full groups and current groups', async () => {
    const portal = fakePortal(courses);
    const progress: string[] = [];
    const { dataset, warnings } = await readPortal(doc, PAGE, portal.fetchText, { delayMs: 0, onProgress: (m) => progress.push(m) });
    expect(validateDataset(dataset).ok).toBe(true);
    expect(dataset.source).toBe('portal');
    expect(dataset.term).toBe('First Semester 2026/2027');
    expect(dataset.courses.map((c) => [c.code, c.current])).toEqual(courses.map((c) => [c.code, c.current]));
    for (const c of dataset.courses) {
      expect(c.groups).toHaveLength(portal.groupsFor.get(c.code)!.length);
      expect(c.groups.find((g) => g.id === 'Z')!.open).toBe(false);
    }
    const dld = dataset.courses.find((c) => c.code === 'CCS2102')!;
    expect(dld.groups.find((g) => g.id === 'F')!.open).toBe(false); // the current group is full
    expect(dld.groups.find((g) => g.id === 'E')).toMatchObject({ open: true, portalLabel: 'T3 Class E -E -Alexandria' });
    expect(warnings).toEqual([]);
    expect(progress.length).toBeGreaterThan(6);
  });

  test('sends only ? POSTs and group-page GETs, never anything else', async () => {
    const portal = fakePortal(courses);
    await readPortal(doc, PAGE, portal.fetchText, { delayMs: 0 });
    const posts = portal.requests.filter((r) => r.method === 'POST');
    expect(posts).toHaveLength(6);
    for (const r of posts) {
      const p = new URLSearchParams(r.body);
      expect(p.get('__EVENTTARGET')).toBe('');
      const pressed = [...new Set([...p.keys()].filter((k) => /\.(x|y)$/.test(k)).map((k) => k.slice(0, -2)))];
      expect(pressed).toHaveLength(1);
      expect(pressed[0]).toMatch(DETAILS_BUTTON);
      expect(r.body).not.toMatch(/confirm|btn_delete|cancelReg/i);
    }
    const gets = portal.requests.filter((r) => r.method === 'GET');
    expect(gets.every((r) => /frm_CourseClassReg\.aspx\?pg=\d+$/.test(r.url))).toBe(true);
    expect(gets).toHaveLength([...portal.groupsFor.values()].reduce((n, g) => n + g.length, 0));
  });

  test('refuses to start on the plain registered view, without sending anything', async () => {
    const portal = fakePortal(courses);
    await expect(readPortal(loadFixture('register-registered.html'), PAGE, portal.fetchText, { delayMs: 0 })).rejects.toThrow(/Change Registered Courses/);
    expect(portal.requests).toHaveLength(0);
  });

  test('stops if the portal shows a different course than asked', async () => {
    const portal = fakePortal(courses, { wrongCourse: true });
    await expect(readPortal(doc, PAGE, portal.fetchText, { delayMs: 0 })).rejects.toThrow(/stopped to be safe/);
    expect(portal.requests.filter((r) => r.method === 'POST')).toHaveLength(1);
  });

  test('stops when logged out', async () => {
    const portal = fakePortal(courses, { loggedOut: true });
    await expect(readPortal(doc, PAGE, portal.fetchText, { delayMs: 0 })).rejects.toThrow(/logged out/);
  });

  test('refuses to run on any page other than the registration page', async () => {
    const portal = fakePortal(courses);
    await expect(readPortal(doc, 'https://alexreg.aast.edu/aastreg/frm_Menu.aspx', portal.fetchText, { delayMs: 0 })).rejects.toThrow(/registration page/);
    expect(portal.requests).toHaveLength(0);
  });
});
```

- [x] **Step 2: Run it and check that it fails**

Run: `npx vitest run tests/portal/reader.test.ts`
Expected: FAIL, because `reader` doesn't exist yet.

- [x] **Step 3: Write `src/portal/reader.ts`**

```ts
import { validateDataset } from '../core/dataset';
import type { Course, Dataset, Group } from '../core/types';
import { parseChangeView } from './changeView';
import { clean, PortalParseError } from './grid';
import { parseGroupPage, toSession, type GroupPageItem } from './groupPage';
import { buildDetailsRequest, checkPortalRequest, type PortalRequest } from './requests';
import { pageOf } from './safety';

export interface HttpText {
  ok: boolean;
  status: number;
  url: string;
  text: string;
}

export type FetchText = (
  url: string,
  init: { method: 'GET' | 'POST'; headers?: Record<string, string>; body?: string; credentials: 'include'; redirect: 'follow' },
) => Promise<HttpText>;

export interface ReadResult {
  dataset: Dataset;
  warnings: string[];
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const key = (group: string, cls: string) => `${norm(group)}|${norm(cls)}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function readPortal(
  doc: Document,
  pageUrl: string,
  fetchText: FetchText,
  opts: { delayMs?: number; onProgress?: (msg: string) => void; parse?: (html: string) => Document } = {},
): Promise<ReadResult> {
  const delayMs = opts.delayMs ?? 350;
  const progress = opts.onProgress ?? (() => {});
  const parse = opts.parse ?? ((html: string) => new DOMParser().parseFromString(html, 'text/html'));

  if (pageOf(pageUrl) !== 'register') throw new PortalParseError('Open the registration page (Change Registered Courses) first.');
  const courses = parseChangeView(doc);
  const form = doc.getElementById('aspnetForm') as HTMLFormElement | null;
  if (!form) throw new PortalParseError('registration form not found');

  const send = async (req: PortalRequest): Promise<string> => {
    checkPortalRequest(req);
    const res = await fetchText(req.url, {
      method: req.method,
      headers: req.body !== undefined ? { 'Content-Type': 'application/x-www-form-urlencoded' } : undefined,
      body: req.body,
      credentials: 'include',
      redirect: 'follow',
    });
    if (/frm_login\.aspx/i.test(res.url)) throw new PortalParseError('You were logged out. Log in again and re-run.');
    if (!res.ok) throw new PortalParseError(`the portal answered HTTP ${res.status} for ${req.method} ${new URL(req.url).pathname}`);
    return res.text;
  };

  const warnings: string[] = [];
  const out: Course[] = [];
  for (const course of courses) {
    progress(`${course.name}: opening its group list`);
    await send(buildDetailsRequest(form, course.detailsButton, pageUrl));

    const items: GroupPageItem[] = [];
    let pageCount = 1;
    for (let pg = 1; pg <= pageCount; pg++) {
      await sleep(delayMs);
      const page = parseGroupPage(parse(await send({ method: 'GET', url: new URL(`frm_CourseClassReg.aspx?pg=${pg}`, pageUrl).href })));
      if (page.courseCode !== course.code) {
        throw new PortalParseError(`asked for ${course.code} but the portal showed ${page.courseCode}, so I stopped to be safe`);
      }
      pageCount = page.pageCount;
      items.push(...page.items);
      progress(`${course.name}: group ${pg} of ${pageCount}`);
    }

    const open = new Map(course.options.map((o) => [key(o.group, o.classLetter), o]));
    const used = new Set<string>();
    const groups: Group[] = [];
    let current: string | null = null;
    for (const it of items) {
      if (it.entries.length === 0) {
        warnings.push(`${course.name} ${it.group}: its ? page has no timetable, skipped`);
        continue;
      }
      const id = groups.some((g) => g.id === it.group) ? `${it.group} (${it.classLetter})` : it.group;
      const k = key(it.group, it.classLetter);
      const opt = open.get(k);
      if (opt) used.add(k);
      if (norm(it.group) === norm(course.current) && norm(it.classLetter) === norm(course.currentClass)) current = id;
      groups.push({ id, portalLabel: opt?.label ?? '', pageLabel: `${it.label} - ${it.classLetter}`, open: Boolean(opt), sessions: it.entries.map(toSession) });
    }
    for (const o of course.options) if (!used.has(key(o.group, o.classLetter))) warnings.push(`${course.name}: dropdown option "${o.label}" has no ? page`);
    if (current === null) warnings.push(`${course.name}: your current group ${course.current} was not found on its ? pages`);
    out.push({ code: course.code, name: course.name, current, groups });
  }

  const term = clean(doc.getElementById('ctl00_UC_Student1_lbl_semester')?.textContent).replace(/^for the\s+/i, '') || 'Unknown term';
  const dataset: Dataset = { schemaVersion: 1, source: 'portal', fetchedAt: new Date().toISOString(), term, courses: out };
  const v = validateDataset(dataset);
  if (!v.ok) throw new PortalParseError(`the data read from the portal failed validation: ${v.errors.slice(0, 3).join('; ')}`);
  progress('Done');
  return { dataset, warnings };
}
```

- [x] **Step 4: Run the tests and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all PASS.

---

### Task 4: Extension wiring (content scripts, popup, permissions, warnings) and live check

**Files:**
- Create: `src/content/reader.ts`, `src/content/blocker.ts`, `tools/build-content.mjs`
- Modify:
  - `src/popup/popup.html`, `src/popup/popup.ts`
  - `public/manifest.json`
  - `package.json` (`build` script)
  - `src/app/app.ts` (show reader warnings)
  - `tests/portal/safety.test.ts` (scan `src/content` too)
  - `tests/app/app.test.ts` (warnings test)

**Interfaces:**
- **Storage keys written by the reader:** `dataset`, `previousDataset`, `excluded` (reset to `{}`), `readerStatus: { state: 'running' | 'done' | 'error'; message: string; warnings?: string[] }`, `readerWarnings: string[]`
- **DOM event:** `aast-reader-finished`, dispatched on `document` by the reader. The MAIN-world blocker listens for it and uninstalls itself.

- [x] **Step 1: Write `src/content/reader.ts`**

```ts
import { readPortal } from '../portal/reader';

async function run(): Promise<void> {
  const status = (s: { state: string; message: string; warnings?: string[] }) => chrome.storage.local.set({ readerStatus: s });
  try {
    await status({ state: 'running', message: 'Starting…' });
    const { dataset, warnings } = await readPortal(
      document,
      location.href,
      async (url, init) => {
        const r = await fetch(url, init);
        return { ok: r.ok, status: r.status, url: r.url, text: await r.text() };
      },
      { delayMs: 350, onProgress: (message) => void status({ state: 'running', message }) },
    );
    const { dataset: previous } = await chrome.storage.local.get('dataset');
    await chrome.storage.local.set({ previousDataset: previous ?? null, dataset, excluded: {}, readerWarnings: warnings });
    await status({ state: 'done', message: `Read ${dataset.courses.length} courses. Open the planner to see your options.`, warnings });
  } catch (e) {
    await status({ state: 'error', message: e instanceof Error ? e.message : String(e) });
  } finally {
    document.dispatchEvent(new CustomEvent('aast-reader-finished'));
  }
}

void run();
```

- [x] **Step 2: Write `src/content/blocker.ts`**

```ts
import { installSubmitBlocker, pageOf } from '../portal/safety';

// Runs in the page's own JS world while the reader works. It refuses every form submission and
// postback except the page's allowlisted ones (none are needed by the reader), then removes itself.
const uninstall = installSubmitBlocker(window, pageOf(location.href));
document.addEventListener('aast-reader-finished', () => uninstall(), { once: true });
```

- [x] **Step 3: Write `tools/build-content.mjs`, and update `package.json` and the manifest**

```js
// Builds the content scripts as self-contained classic scripts (chrome.scripting.executeScript files).
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
for (const name of ['reader', 'blocker']) {
  await build({
    configFile: false,
    logLevel: 'warn',
    publicDir: false,
    build: {
      outDir: here('../dist/content'),
      emptyOutDir: false,
      lib: { entry: here(`../src/content/${name}.ts`), formats: ['iife'], name: `aast_${name}`, fileName: () => `${name}.js` },
    },
  });
}
console.log('content scripts built');
```

Run:
```bash
node -e 'const f="package.json",fs=require("fs"),j=JSON.parse(fs.readFileSync(f));j.scripts.build="vite build && node tools/build-content.mjs";fs.writeFileSync(f,JSON.stringify(j,null,2)+"\n")'
```

`public/manifest.json`: set `"permissions": ["storage", "activeTab", "scripting"]`. `host_permissions` stays Gemini-only; `activeTab` grants access to the portal tab only when the student opens the popup there.

- [x] **Step 4: Popup, "Read portal"**

`src/popup/popup.html`: after the `open` button add:
```html
    <button id="read" hidden>Read this page's groups</button>
    <pre id="status"></pre>
```
and to the `<style>` add:
```css
      #read { margin-top: 8px; background: #1a7f37; }
      pre { white-space: pre-wrap; font: 12px/1.4 inherit; margin: 8px 0 0; }
      pre.error { color: #b3261e; } pre.done { color: #1a7f37; }
```

`src/popup/popup.ts`:
```ts
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

$('open').addEventListener('click', () => {
  void chrome.tabs.create({ url: chrome.runtime.getURL('app/app.html') });
  window.close();
});

type Status = { state: string; message: string; warnings?: string[] };
function show(s: Status | undefined) {
  const el = $('status');
  el.className = s?.state ?? '';
  el.textContent = s ? s.message + (s.warnings?.length ? `\n⚠ ${s.warnings.length} warning(s): shown in the planner.` : '') : '';
}
chrome.storage.onChanged.addListener((changes) => {
  if (changes.readerStatus) show(changes.readerStatus.newValue as Status);
});

void chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
  const onRegister = /^https:\/\/alexreg\.aast\.edu\/aastreg\/frm_register\.aspx/i.test(tab?.url ?? '');
  const read = $<HTMLButtonElement>('read');
  read.hidden = !onRegister;
  $('portal').textContent = onRegister
    ? 'On the "Change Registered Courses" page? Read every group, open and full. Nothing is clicked, and Confirm Registration can never be sent. Don\'t touch the tab for about a minute.'
    : 'Go to the registration page and press "Change Registered Courses" to read live data. This extension never changes your registration.';
  read.addEventListener('click', async () => {
    if (!tab?.id) return;
    read.disabled = true;
    show({ state: 'running', message: 'Starting…' });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', files: ['content/blocker.js'] });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/reader.js'] });
  });
});
```

- [x] **Step 5: The app shows reader warnings; the safety scan covers `src/content`**

In `src/app/app.ts`, after `const state: AppState = {…};` add:
```ts
  const readerWarnings = (await store.get<string[]>('readerWarnings')) ?? [];
  if (readerWarnings.length) state.message = `Portal read warnings:\n${readerWarnings.join('\n')}`;
```

In `tests/app/app.test.ts`, add inside `describe('app', …)`:
```ts
  test('shows warnings from the last portal read', async () => {
    const root = document.createElement('div');
    await mountApp(root, memoryStore({ readerWarnings: ['Networks: dropdown option "X" has no ? page'] }));
    expect(text(root)).toContain('Portal read warnings');
    expect(text(root)).toContain('dropdown option "X" has no ? page');
  });
```

In `tests/portal/safety.test.ts`, after `walk(join(process.cwd(), 'src', 'portal'));` add `walk(join(process.cwd(), 'src', 'content'));`.

- [x] **Step 6: Full verification**

Run: `npx vitest run && npx tsc --noEmit && npm run build && ls dist/content && grep -c "__doPostBack\|lbtn_confirm" dist/content/reader.js`
Expected:
- all tests PASS
- the build produces `dist/content/reader.js` and `dist/content/blocker.js`
- the reader bundle contains no reference to `lbtn_confirm`; the only `__doPostBack` mention is in the blocker

- [x] **Step 7: Supervised live check (with the student)**

1. In `brave://extensions`, click reload ↻ on the extension.
2. On the portal: registration page → **Change Registered Courses**.
3. Open the popup → **Read this page's groups**. Don't touch the tab. Watch the progress.
4. Open the planner. Check the Data tab against 2–3 groups' ? pages, including one full group, which should be greyed out.
5. Confirm on the portal that the registration is unchanged. The course table should still show the same groups.

---

## Self-Review

- **Spec coverage:**
  - §2 → Task 2 (request guard), plus the Plan 2 blocker installed during reads (Task 4)
  - §6 (superseded by requests) → Tasks 3 and 4
  - §7 source `portal` → Task 3
  - §11 (logged out, wrong course, layout) → Task 3
  - §12 (live check) → Task 4 Step 7
  - §13 Q1–Q4 answered in Global Constraints
- **Deviation:** unmatched dropdown options are **warnings**, shown in the planner, instead of aborting the read (§11). This is so one odd portal option like "Share" can't block the whole read.
- **Placeholders:** none.
- **Types:** these names match everywhere they're used:
  - `ChangeCourse`, `DropdownOption`
  - `PortalRequest`, `FetchText`, `HttpText`, `ReadResult`
  - `GroupPageItem.label`

---

## Fix 1 (2026-09-26, after the first live run)

**What happened:** the live read got through all 16 Linear Algebra groups, then stopped safely on a Digital Logic ? page with `unknown day row "CCS2102 Sec."`. On that page, a day's classes are stacked in one slot: the day cell spans two rows, so the second row has no day name.

**Changes:**
- **`parseScheduleTable` now follows the HTML rowspan/colspan table rules.** Columns are 0 = day, 1 = spacer, 2..17 = periods. A continuation row inherits the day from the spanning day cell. Any row that doesn't cover exactly 18 columns still throws.
- **`parseGroupPage` returns `skipped: { label, classLetter, reason }[]`.** A group whose timetable can't be read is left out instead of failing the page.
- **`readPortal` turns each skipped group into a warning**, which is shown in the planner. Safety stops (wrong course, logged out, refused request) still abort the whole read.

**Tests added:** stacked-slot rows, a no-day row refused, a skipped group on a page, and a read that continues past a broken group.
