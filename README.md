# AAST Schedule Planner

A Brave/Chrome extension that finds every clash-free AASTMT timetable that fits your rules: days off, no gaps, no late periods, keeping a friend's group, and so on. It ranks the results and exports them as a PDF.

**It never changes your registration.** It only reads timetables. You make any switch yourself in the portal.

## Status

| Part | State |
|---|---|
| Solver, rules, results page, Gemini rules, PDF export | ✅ working, tested |
| Planning from imported data / the built-in example | ✅ working |
| Reading the live registration portal | 🟡 parsers and safety guard built and tested; wiring waits for the next registration window |
| Importing the schedule PDFs AASTMT publishes before registration | ⏳ planned |

## Features

- **Rules:** days off, gaps, banned periods, start/finish times, keep/avoid a group, fewest changes, no 1-class days.
  - Each rule can be a **must** (a filter), a **prefer** (ranked in the order you set) or **off**.
- **Closest misses:** when nothing fits every must rule, it shows the schedules that break the fewest rules, and says exactly what each one breaks.
- **Merged groups:** groups with identical times (e.g. Database G/H) are merged into one result, so you get a backup group for free.
- **Mark as full:** one click on a group removes it and re-solves instantly.
- **Plain-English rules (optional):** type what you want and Gemini fills in the rule settings.
  - The output is validated before it's applied, and the changed rules are highlighted.
  - Your API key stays in the browser and is only sent to Google's Gemini API.
- **PDF export:** a share mode hides your personal changes, so you can send the options to friends.
- **Change detection:** when you import new data, it lists every group that moved or became full.

## Safety

Nothing in this extension can click **Confirm Registration**, **Select**, **Delete Registration**, **Add**, **Insert** or **Logout**, or change a dropdown. That's enforced in layers, all covered by tests (`tests/portal/safety.test.ts`):

1. **A page-aware allowlist** of the only controls the reader may use: Change Registered Courses, the ? icons, page numbers and Back.
2. **A denylist that always wins**, even over the allowlist.
3. **A form-submit/postback blocker** that runs while reading.
4. **A source scan** that fails the build if portal-facing code ever writes to a form field.

The current build has no content scripts and no permission to access the portal at all.

## Install (unpacked)

```bash
npm ci
npm run build
```

Then in Brave or Chrome:
1. Open `brave://extensions` (or `chrome://extensions`) and turn on **Developer mode**.
2. Click **Load unpacked** and select the `dist/` folder.
3. Click the extension icon, then **Open planner**, then **Load example**.

## Development

```bash
npm test            # Vitest: solver, portal parsers, safety guard, UI
npm run typecheck
npm run build && npm run preview   # then open http://localhost:4173/app/app.html?demo
```

| Folder | What's in it |
|---|---|
| `src/core/` | data format, rules and solver (no DOM) |
| `src/portal/` | portal page parsers + the safety guard |
| `src/app/`, `src/popup/` | the extension pages |
| `tests/fixtures/portal/` | real portal pages with all personal data removed by `tools/sanitize-portal-page.py` |
| `docs/superpowers/` | the design spec and build plans |

## Notes

- **The example data** is real Fall 2026 group times for 6 computer-science courses. The "current registration" in it belongs to a made-up student.
- **Not affiliated with AASTMT.**
- **How it was built:** with [Claude Code](https://claude.com/claude-code) (Anthropic's AI coding assistant), from requirements, testing and real portal pages provided by [@ghatwary06](https://github.com/ghatwary06).

## License

MIT
