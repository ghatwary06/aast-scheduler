# AASTMT Schedule Planner: Design Spec

**Date:** 2026-09-25
**Status:** Implemented (Plans 1–4). Live portal read verified on 2026-09-26. Sections 6 and 13 were updated after building.
**Form:** Brave/Chrome browser extension (Manifest V3); everything runs inside the extension

## 1. Purpose

AASTMT students pick one **group** per course, and each group comes with its own lecture, section and lab times. When a timing changes, the portal can reshuffle a student into unwanted groups. Finding a good replacement by hand means screenshotting every group and checking combinations, which is slow and error-prone.

The extension does three things:

1. Reads every group's exact times, and which groups are still open, directly from the student's own logged-in registration portal.
2. Finds every clash-free combination that satisfies the student's rules, ranked by their preferences.
3. Shows the results as colour-coded timetables, with a PDF export to share with friends.

It **never changes the registration**. The student makes any switch themselves in the portal.

## 2. Hard safety rule: the extension never registers anything

> **The extension must never click, submit, trigger or simulate "Confirm Registration". The same applies to anything else that can change a registration.**

"Anything else" covers these controls:

- **Confirm Registration**
- **Select** (on the group ? pages)
- **Delete Registration**
- the per-course delete icons
- **Add** and **Insert Term Courses**
- **Logout**
- **changing any Class or Group dropdown value**

It holds even when a bug, a portal layout change, or a Gemini output suggests otherwise. It is enforced in five independent layers:

1. **Allowlist.** The portal reader can only activate elements that match an explicit allowlist:
   - the **Change Registered Courses** button
   - the per-course **?** icons
   - the **page-number links** on the ? pages
   - the **Back** button

   Every activation goes through one guarded function. There is no other code path that clicks, submits or navigates.
2. **Denylist check inside the guard.** Before acting on any element, the guard checks its id, name, value, text and postback target against a denylist (e.g. `Confirm`, `Select`, `Delete`, `Add`, `Insert`, `Logout`). If any of them match, the guard refuses and aborts the whole read with an error. A match on both lists counts as denied.
3. **Submit blocker while running.** For the duration of a read, the extension blocks any form submission or `__doPostBack` call whose event target is a denylisted control, and cancels it. It is removed once the read ends, so it never interferes with the student's own use of the portal.
4. **No dropdown writes.** Dropdowns are only ever **read** (their `<option>` lists). The reader has no code that sets `.value`, fires `change`, or selects an option.
5. **Tests.** An automated test runs the full reader against saved copies of every portal page, with a fake click layer that records every action. The test fails if any denylisted control is ever activated or any dropdown is ever written. A second test feeds the guard each denylisted control directly and checks that each one is refused.

Clicking "Change Registered Courses" is allowed. The student confirmed that nothing in that mode takes effect until Confirm Registration is pressed, and the extension never presses it.

## 3. Scope

**v1 (this spec):**
- Read the live portal.
- Solver with must/prefer rules.
- Gemini plain-English rule input.
- Results page, "mark as full", PDF export with a share mode.
- Data import/export.

**Later (separate specs):**
- **Schedule PDFs.** AASTMT releases schedules as PDFs before the portal opens, so there will be a PDF reader that produces the same data format. Before designing it, check whether the PDFs contain selectable text (exact parsing) or are scanned images (AI vision, with an accuracy risk).
- **Friends.** Distribute the extension so other students can use it with their own logins. v1 must not hardcode anything about one student.

**Out of scope:**
- Making registration changes.
- Storing the student's portal credentials.
- Any server or hosted backend.

## 4. Portal navigation (observed)

1. `frm_login.aspx`: the login form (registration number + PIN).
2. `frm_choice.aspx`: the **Register Major** button.
3. `frm_Menu.aspx`: the **Online Registration** link.
4. `frm_Register.aspx`: the registration page.
   - The **registered view** shows the course table (code, name, Group, Class), a timetable, and the **Change Registered Courses** and **Delete Registration** buttons.
   - The **change view** shows a Class dropdown per course, a ? icon per course, a timetable, and **Confirm Registration**.
5. `frm_CourseClassReg.aspx?pg=N`: the ? page for one course.
   - It has one page per group, e.g. Linear Algebra has 16.
   - Each page shows the group name (e.g. `T3 Class A - I`), its lecturers, a timetable with `Lec.`/`Sec.`/`Lab.` entries, a **Select** button (**denylisted**), a **Back** button, and page links 1..N.

The student does steps 1–4 **by hand in their own Brave**. The extension is used only once the student is on `frm_Register.aspx`.

**Timetable grid:** days Saturday–Friday, periods 1–16. Sessions usually span 2 periods (1-2, 3-4, 5-6, 7-8, 9-10). Periods are read from the cell's position and `colspan` in the HTML, never from pixel positions.

## 5. Components

| Component | Runs in | Responsibility | Depends on |
|---|---|---|---|
| **Portal reader** | content script in the student's registration tab | Reads current registration, open groups, and every group's sessions. Includes the safety guard (§2). | the portal DOM only |
| **Data store** | extension storage | Holds the latest dataset plus the previous one (for change detection). Imports/exports a JSON file. | nothing |
| **Solver** | extension (pure module, no DOM, no network) | Enumerates valid combinations, applies must rules, ranks by prefer rules, dedupes, finds near-misses. | dataset + rules |
| **Rule parser** | extension → Gemini API | Plain English → rule object, validated against the rule schema. | Gemini API key |
| **App page** | full extension tab | Rules UI, results, data review, settings, PDF export. | all of the above |
| **Popup** | extension toolbar popup | "Read portal" + progress when on the registration page; otherwise "Open app". | reader, app page |

The solver is a pure module so it can be unit-tested without a browser. A future PDF reader only has to produce the same dataset format.

## 6. Reading flow (as built: requests, not clicks)

The first design had the reader clicking ?, the page numbers and Back. When the real change page was captured, it turned out the 🗑 delete icon is structurally identical to the ? icon, apart from its name. So the reader was changed to **never click anything** (Plan 4):

1. The student opens **Change Registered Courses** themselves, then the popup's **Read this page's groups**. On any other page the reader refuses to start.
2. The popup injects the submit blocker (§2, layer 3) into the page's JS world, then the reader (content script).
3. The reader reads the change view:
   - the course table gives the **current group**
   - each Class dropdown gives the **open groups**
   - each row gives its ? button's exact name
4. For each course:
   - it sends, in the background, the exact POST the ? icon would send: the form's own fields, plus `<name>.x/.y`, with no postback target
   - it then GETs `frm_CourseClassReg.aspx?pg=1..N`
   - every request must pass `checkPortalRequest` (`src/portal/requests.ts`), or it is refused before leaving the browser
5. It saves the dataset. The blocker removes itself, and the popup offers **Open planner**.

The visible page never changes. Progress is shown in the popup (e.g. "Networks: group 7 of 12"), with a short delay between requests. **Aborts:** the wrong page, logged out, a ? page showing a different course, or a refused request. **Warnings instead of aborts:** a group whose timetable can't be read is skipped, and a dropdown option with no ? page is noted.

## 7. Data format

```json
{
  "schemaVersion": 1,
  "source": "portal",
  "fetchedAt": "2026-09-25T17:02:00+03:00",
  "term": "First Semester 2026/2027",
  "courses": [
    {
      "code": "CCS2201",
      "name": "Introduction to Networks",
      "current": "I",
      "groups": [
        {
          "id": "I",
          "portalLabel": "T3 Class I -I -Alexandria",
          "pageLabel": "T3 Class I - I",
          "open": true,
          "sessions": [
            { "day": "Sun", "from": 3, "to": 4, "type": "Lec", "lecturer": "..." },
            { "day": "Wed", "from": 7, "to": 8, "type": "Sec", "lecturer": "..." }
          ]
        }
      ]
    }
  ]
}
```

- `from`/`to` are inclusive period numbers (1–16).
- Groups that are on the ? pages but not selectable in the dropdown are stored with `"open": false`.
- **No personal data is stored:** no name, registration number or GPA.

## 8. Solver

**Search.** Backtracking, one course at a time. A partial combination is dropped as soon as it clashes, or as soon as it breaks a must rule that can already be checked (e.g. a banned period, or a day that must be off). Only `open` groups and groups not marked full are used.

**Rules.** Each rule can be set to **must** (a filter) or **prefer** (used for ranking):

| Rule | Parameters |
|---|---|
| Days off | minimum number off; specific days that must be off (Friday is normally off already) |
| Gaps | max gap periods total; max per day; max length of a single gap |
| Banned periods | periods to avoid, everywhere or on specific days (e.g. no 9-10) |
| Earliest start / latest finish | per day or everywhere |
| Keep group | e.g. keep OOP J |
| Avoid group | e.g. never Linear Algebra K |
| Fewest changes | from the current registration |
| No single-class days | a day on campus must have at least 2 sessions |

- **Gaps** are measured in empty 2-period blocks between the first and last session of a day. This matches how gaps were counted during the 2026-09-24 session.
- **Ranking** is lexicographic by the prefer rules' order, which the student sets by dragging. No weights.
- **Dedupe:** results with identical timetables are merged, e.g. Database G and H, and shown as "G *or* H".
- **Near-misses:** if no combination satisfies every must rule, show the ones that break the fewest must rules. Each is labelled with exactly what it breaks (e.g. "breaks: no 9-10, Thu 9-10 Prob Lect").
- **Mark as full:** excludes a group for this session of use and re-solves instantly. A later portal read replaces it with fresh open/full data.

## 9. Gemini rule parser

- Optional. The student's API key is stored in `chrome.storage.local` and sent only to the Gemini API.
- **Input:** the plain-English text, plus the course codes and group ids from the current dataset.
- **Output:** JSON matching the rule schema. It is validated strictly: unknown courses or groups, bad periods or wrong types are rejected with a message.
- The parsed rules are **filled into the rules panel with the changes highlighted**. They are applied only when the student runs the solver. Gemini never reads portal pages and never runs the solver.
- With no key or a failed call, the text box is disabled with a message. The clickable rules still work.

## 10. App page

- **Top bar:**
  - dataset status (read time, number of courses, number of open groups)
  - a change-detection warning comparing against the previous dataset (e.g. "Networks I lecture moved Wed 5-6 → Thu 3-4"), expandable
  - Import/Export data
  - Settings (Gemini key)
- **Rules panel (left):**
  - the plain-English box
  - must rules
  - the prefer priority list (drag to reorder)
- **Results (right):**
  - the count, or near-misses when nothing fits
  - one card per result:
    - a colour-coded timetable, with gaps shaded and empty days marked OFF
    - tags: days off, gaps, 9-10 days, changes, kept groups
    - the 6 dropdown names to pick, with changes from the current registration highlighted
    - a **full** button per group
- **Data tab:** every group's timetable, course by course, with full groups greyed out. It is for spot-checking against the portal.
- **PDF export:** a print-styled page, saved with the browser's own Save as PDF.
  - **Personal mode** shows changes and kept groups.
  - **Share mode** removes the change counts, the kept-group tags, the current-registration marker and the intro text. It keeps days off, gaps, 9-10, the rules flag and the dropdown names.

## 11. Error handling

| Situation | Behaviour |
|---|---|
| Logged out / session expired during a read | Abort, discard the partial data, and tell the student to log in and re-run. |
| An expected element is missing (layout change) | Abort, naming the page and the element. Never guess or save partial data. |
| The guard refuses an element (§2) | Abort the whole read with an error naming the element. Treat it as a bug to investigate. |
| The popup is used on a page that isn't `frm_Register.aspx` | "Read portal" is unavailable. |
| An open dropdown group has no ? page, or a ? page group is missing from the dropdown | Report it on the data tab. A dropdown group with no ? page aborts the read. |
| Gemini error or invalid output | Show the error. Leave the rules untouched. |
| An imported file has the wrong schema | Reject it with a message. |

## 12. Testing

- **Solver (unit).** A fixture built from the 2026-09-24 data (Digital Logic F lecture = Sat 7-8, Digital Logic C removed, Database G/H identical) must reproduce the hand-verified answers:
  - **57** distinct timetables with Friday + 2 other days off
  - **8** of them gap-free
  - **0** satisfying "no 9-10" + "≤2 gaps, ≤1 per day"
  - the Option 1 combination (LA J, DLD D, Prob E, OOP J, Net I, DB G; Fri/Tue/Thu off) present, with 1 gap on Wednesday
- **Portal reader (fixture).**
  - The student saves real `frm_Register.aspx` pages (registered and change views) and a few `frm_CourseClassReg.aspx?pg=N` pages. Name, registration number and GPA are **removed from them before they're used**.
  - The reader must produce the expected dataset from these copies.
- **Safety (fixture + unit).** The §2 layer-5 tests: no denylisted activation during a full read, no dropdown writes, and every denylisted control refused by the guard.
- **Gemini parser.** Uses mocked responses, including invalid ones that must be rejected. No real API calls in tests.
- **Live check.** One supervised read on the real portal. The student compares several groups against the ? pages and confirms that Confirm Registration was never touched and the registration is unchanged.

## 13. Portal questions (answered on the real portal, 2026-09-26)

1. **Full groups are missing from the Class dropdown**, not disabled. So open = listed, excluding `-99` "Any". When your own group is full, the dropdown shows a different option as selected, so the current group is read from the course table.
2. **The ? icon is an `<input type="image">` that submits the form.** Page links are plain `?pg=N` GETs. The server remembers which course is selected, which is why each course needs its ? POST before its page GETs.
3. **Labels:**
   - dropdown: `<group> -<class> -<campus>`, e.g. `T3 Class B -L -Alexandria`, `T3 Class O Extra-Y -Alexandria`, `Share -I -Alexandria`
   - ? page: `lbl_grp` = `T3 Class B`, `lbl_class` = `L`
   - Groups are matched by (group, class).
4. **The ? pages list every group, open and full** (e.g. 16 for Linear Algebra versus 11 in the dropdown).
5. **Timetables can stack two classes in one slot:** the day cell spans several rows. The parser follows the HTML rowspan/colspan rules.

## 14. Tech

- Manifest V3 extension, written in TypeScript and built with Vite.
- Tests with Vitest. Portal-reader tests use saved HTML files in jsdom.
- No external services except the Gemini API (optional).
