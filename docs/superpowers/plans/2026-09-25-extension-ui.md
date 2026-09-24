# AASTMT Schedule Planner: Plan 3, Extension UI

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A loadable Brave/Chrome MV3 extension with three parts:
- a popup
- a full-tab app with data import/export, the rules panel, the Gemini plain-English box, results cards, mark-as-full, and a PDF export with a share mode
- a data tab and a settings tab

**Architecture:** Vanilla TypeScript DOM with no framework, built by Vite into `dist/`. The pieces:

| Module | What it does |
|---|---|
| `rulesModel` | rule defaults, descriptions and strict validation |
| `gemini` | builds the prompt, calls the REST API with model fallback, validates the reply |
| `diff` | reports what changed between two datasets |
| `storage` | `chrome.storage.local`, with an in-memory fallback |
| `view` | DOM builders for timetables and result cards |
| `app` | state, wiring and every tab |

**The extension has no content scripts and no access to the portal yet.** Portal reading comes in a later plan, once the change page can be captured. So Plan 3 cannot touch a registration at all.

**Tech Stack:** TypeScript, Vite 8, Vitest 5 + jsdom, `@types/chrome`.

**Spec:** `docs/superpowers/specs/2026-09-25-aast-scheduler-design.md`

## Global Constraints

- **Spec §2 still holds.** Plan 3 adds no content script and no portal host permission. Its only host permission is `https://generativelanguage.googleapis.com/*`.
- **The Gemini key is stored only in `chrome.storage.local`.** It is sent only in the `x-goog-api-key` header, never in a URL.
- **Gemini output is validated with `validateRules` before it is applied.** Invalid output is shown as an error and never applied.
- **Share-mode cards contain no change counts, "(change)" markers, "Keeps" tags or full buttons.**
- **Deviation from spec §10:** prefer rules are reordered with ↑/↓ buttons instead of drag-and-drop. It's simpler, accessible, and gives the same ranking semantics.
- **Layer-4 scan scope:** the no-dropdown-writes scan now covers `src/core` and `src/portal`, the code that can run on portal pages. Extension pages (`src/app`, `src/popup`) run on the extension's own origin and have their own form inputs.

---

## File Structure

| File | Responsibility |
|---|---|
| `vite.config.ts`, `vitest.config.ts` | build (two pages) and test config |
| `public/manifest.json` | MV3 manifest |
| `src/sample/sept24.ts` | the verified Sept 2026 dataset, moved from `tests/fixtures/` (now re-exported there) |
| `src/app/rulesModel.ts` | `RULE_KINDS`, `KIND_LABELS`, `newRule`, `defaultRules`, `describeRule`, `validateRules` |
| `src/app/gemini.ts` | `DEFAULT_MODELS`, `buildPrompt`, `rulesFromText` |
| `src/app/diff.ts` | `diffDatasets` |
| `src/app/storage.ts` | `Store`, `memoryStore`, `chromeStore`, `defaultStore` |
| `src/app/view.ts` | `h`, `COURSE_COLORS`, `courseColor`, `renderTimetable`, `renderCard` |
| `src/app/app.ts` | `mountApp` |
| `src/app/main.ts`, `src/app/app.html`, `src/app/app.css` | page entry |
| `src/popup/popup.html`, `src/popup/popup.ts` | toolbar popup |

---

### Task 1: Setup, sample data move, rule model

**Files:**
- Create: `vite.config.ts`, `vitest.config.ts`, `src/sample/sept24.ts`, `src/app/rulesModel.ts`
- Modify: `tests/fixtures/sept24.ts` (becomes a re-export), `tsconfig.json` (`"types": ["node", "chrome"]`), `package.json` scripts, `tests/portal/safety.test.ts` (scan scope)
- Test: `tests/app/rulesModel.test.ts`

**Interfaces:**
- Produces:
  - `RULE_KINDS`, `type RuleKind`, `KIND_LABELS: Record<RuleKind, string>`
  - `newRule(kind: RuleKind, id: string, ds: Dataset | null): Rule`
  - `defaultRules(): Rule[]`, with ids `days-off`, `gaps`, `late`, `changes`
  - `describeRule(r: Rule, ds: Dataset | null): string`
  - `type RulesResult = { ok: true; rules: Rule[] } | { ok: false; errors: string[] }`
  - `validateRules(input: unknown, ds: Dataset | null): RulesResult`
  - `sept24` now lives at `src/sample/sept24.ts`

- [x] **Step 1: Move the sample dataset and add the build config**

Run:
```bash
mkdir -p src/sample src/app src/popup public tests/app
sed -e "s#'../../src/core/types'#'../core/types'#" tests/fixtures/sept24.ts > src/sample/sept24.ts
printf "export { sept24 } from '../../src/sample/sept24';\n" > tests/fixtures/sept24.ts
node -e 'const f="tsconfig.json",fs=require("fs"),j=JSON.parse(fs.readFileSync(f));j.compilerOptions.types=["node","chrome"];fs.writeFileSync(f,JSON.stringify(j,null,2)+"\n")'
node -e 'const f="package.json",fs=require("fs"),j=JSON.parse(fs.readFileSync(f));j.scripts={...j.scripts,build:"vite build",preview:"vite preview --port 4173"};fs.writeFileSync(f,JSON.stringify(j,null,2)+"\n")'
```

Write `vite.config.ts`:
```ts
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: here('./src'),
  base: './',
  publicDir: here('./public'),
  build: {
    outDir: here('./dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: { app: here('./src/app/app.html'), popup: here('./src/popup/popup.html') },
    },
  },
});
```

Write `vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['tests/**/*.test.ts'] },
});
```

In `tests/portal/safety.test.ts`, change the scan to the portal-reachable code only. Replace `walk(join(process.cwd(), 'src'));` with:
```ts
    walk(join(process.cwd(), 'src', 'core'));
    walk(join(process.cwd(), 'src', 'portal'));
```

Run: `npx vitest run && npx tsc --noEmit`
Expected: the existing 67 tests still PASS.

- [x] **Step 2: Write the failing test `tests/app/rulesModel.test.ts`**

```ts
import { describe, expect, test } from 'vitest';
import { defaultRules, describeRule, newRule, RULE_KINDS, validateRules } from '../../src/app/rulesModel';
import { sept24 } from '../fixtures/sept24';

describe('rulesModel', () => {
  test('default rules and a new rule of every kind validate', () => {
    expect(validateRules(defaultRules(), sept24).ok).toBe(true);
    expect(validateRules(RULE_KINDS.map((k, i) => newRule(k, `r${i}`, sept24)), sept24).ok).toBe(true);
  });

  test('describes rules in plain words', () => {
    const d = defaultRules();
    expect(d.map((r) => r.id)).toEqual(['days-off', 'gaps', 'late', 'changes']);
    expect(describeRule(d[0], sept24)).toBe('At least 3 days off');
    expect(describeRule(d[1], sept24)).toBe('No gaps');
    expect(describeRule(d[2], sept24)).toBe('No classes in periods 9-16 (every day)');
    expect(describeRule(d[3], sept24)).toBe('Fewest changes from my current groups');
    expect(describeRule({ id: 'k', strength: 'must', kind: 'keepGroup', course: 'CCS2303', group: 'J' }, sept24)).toBe(
      'Stay in Object-Oriented Programming J',
    );
  });

  test('rejects malformed rules with precise messages', () => {
    const r = validateRules(
      [
        { id: 'a', strength: 'must', kind: 'teleport' },
        { id: 'a', strength: 'maybe', kind: 'maxChanges', max: 1 },
        { id: 'b', strength: 'must', kind: 'bannedPeriods', from: 10, to: 9, days: ['Funday'] },
        { id: 'c', strength: 'must', kind: 'keepGroup', course: 'XYZ999', group: 'A' },
        { id: 'd', strength: 'must', kind: 'avoidGroup', course: 'CCS2201', group: 'Z' },
        { id: 'e', strength: 'prefer', kind: 'gaps', maxTotal: 1, maxPerDay: 1, maxSingle: 99, colour: 'red' },
        { id: 'f', strength: 'prefer', kind: 'daysOff', minOff: 3 },
      ],
      sept24,
    );
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(r.errors).toEqual([
        'rules[0].kind: unknown rule "teleport"',
        'rules[1].id: duplicate "a"',
        'rules[1].strength: must be must, prefer or off',
        'rules[2].days: must be a list of days (Sat, Sun, Mon, Tue, Wed, Thu, Fri)',
        'rules[2]: from is after to',
        'rules[3].course: unknown course "XYZ999"',
        'rules[4].group: unknown group "Z" in CCS2201',
        'rules[5].colour: not a field of gaps',
        'rules[6].mustOff: must be a list of days (Sat, Sun, Mon, Tue, Wed, Thu, Fri)',
      ]);
  });

  test('without a dataset, course/group names are not checked', () => {
    expect(validateRules([{ id: 'k', strength: 'must', kind: 'keepGroup', course: 'ANY', group: 'X' }], null).ok).toBe(true);
    expect(validateRules('nope', null)).toEqual({ ok: false, errors: ['rules: must be a list'] });
  });
});
```

- [x] **Step 3: Run it and check that it fails**

Run: `npx vitest run tests/app/rulesModel.test.ts`
Expected: FAIL, because `rulesModel` doesn't exist yet.

- [x] **Step 4: Write `src/app/rulesModel.ts`**

```ts
import { DAYS, MAX_PERIOD, MIN_PERIOD, type Dataset, type Day } from '../core/types';
import type { Rule } from '../core/rules';

export const RULE_KINDS = [
  'daysOff',
  'gaps',
  'bannedPeriods',
  'dayWindow',
  'keepGroup',
  'avoidGroup',
  'maxChanges',
  'noSingleSessionDays',
] as const;
export type RuleKind = (typeof RULE_KINDS)[number];

export const KIND_LABELS: Record<RuleKind, string> = {
  daysOff: 'Days off',
  gaps: 'Gaps',
  bannedPeriods: 'Banned periods',
  dayWindow: 'Start / finish times',
  keepGroup: 'Keep a group',
  avoidGroup: 'Avoid a group',
  maxChanges: 'Changes from current groups',
  noSingleSessionDays: 'No 1-class days',
};

const FIELDS: Record<RuleKind, string[]> = {
  daysOff: ['minOff', 'mustOff'],
  gaps: ['maxTotal', 'maxPerDay', 'maxSingle'],
  bannedPeriods: ['from', 'to', 'days'],
  dayWindow: ['earliest', 'latest', 'days'],
  keepGroup: ['course', 'group'],
  avoidGroup: ['course', 'group'],
  maxChanges: ['max'],
  noSingleSessionDays: [],
};

export function newRule(kind: RuleKind, id: string, ds: Dataset | null): Rule {
  const course = ds?.courses[0];
  const target = { course: course?.code ?? '', group: course?.groups[0]?.id ?? '' };
  switch (kind) {
    case 'daysOff':
      return { id, strength: 'must', kind, minOff: 3, mustOff: [] };
    case 'gaps':
      return { id, strength: 'prefer', kind, maxTotal: 0, maxPerDay: 0, maxSingle: 99 };
    case 'bannedPeriods':
      return { id, strength: 'prefer', kind, from: 9, to: 10, days: [] };
    case 'dayWindow':
      return { id, strength: 'prefer', kind, earliest: 1, latest: 8, days: [] };
    case 'keepGroup':
      return { id, strength: 'must', kind, ...target };
    case 'avoidGroup':
      return { id, strength: 'must', kind, ...target };
    case 'maxChanges':
      return { id, strength: 'prefer', kind, max: 0 };
    case 'noSingleSessionDays':
      return { id, strength: 'prefer', kind };
  }
}

export function defaultRules(): Rule[] {
  return [
    newRule('daysOff', 'days-off', null),
    newRule('gaps', 'gaps', null),
    { id: 'late', strength: 'prefer', kind: 'bannedPeriods', from: 9, to: 16, days: [] },
    newRule('maxChanges', 'changes', null),
  ];
}

const dayList = (d: Day[]) => (d.length ? d.join(', ') : 'every day');
const nameOf = (ds: Dataset | null, code: string) => ds?.courses.find((c) => c.code === code)?.name ?? code;

export function describeRule(r: Rule, ds: Dataset | null): string {
  switch (r.kind) {
    case 'daysOff':
      return `At least ${r.minOff} days off${r.mustOff.length ? `, including ${r.mustOff.join(', ')}` : ''}`;
    case 'gaps': {
      const base = r.maxTotal === 0 ? 'No gaps' : `At most ${r.maxTotal} gaps, ${r.maxPerDay} per day`;
      return r.maxSingle < 99 ? `${base}, none longer than ${r.maxSingle} slot(s)` : base;
    }
    case 'bannedPeriods':
      return `No classes in periods ${r.from}-${r.to} (${dayList(r.days)})`;
    case 'dayWindow':
      return `Classes only between periods ${r.earliest} and ${r.latest} (${dayList(r.days)})`;
    case 'keepGroup':
      return `Stay in ${nameOf(ds, r.course)} ${r.group}`;
    case 'avoidGroup':
      return `Never ${nameOf(ds, r.course)} ${r.group}`;
    case 'maxChanges':
      return r.max === 0 ? 'Fewest changes from my current groups' : `At most ${r.max} group changes`;
    case 'noSingleSessionDays':
      return 'No days with only 1 class';
  }
}

export type RulesResult = { ok: true; rules: Rule[] } | { ok: false; errors: string[] };

const isInt = (v: unknown, min: number, max: number): v is number => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;

export function validateRules(input: unknown, ds: Dataset | null): RulesResult {
  if (!Array.isArray(input)) return { ok: false, errors: ['rules: must be a list'] };
  const errors: string[] = [];
  const ids = new Set<string>();
  input.forEach((r: unknown, i) => {
    const p = `rules[${i}]`;
    if (typeof r !== 'object' || r === null || Array.isArray(r)) return void errors.push(`${p}: not an object`);
    const o = r as Record<string, unknown>;
    if (typeof o.id !== 'string' || o.id === '') errors.push(`${p}.id: must be a non-empty string`);
    else if (ids.has(o.id)) errors.push(`${p}.id: duplicate "${o.id}"`);
    else ids.add(o.id);
    if (!['must', 'prefer', 'off'].includes(o.strength as string)) errors.push(`${p}.strength: must be must, prefer or off`);
    if (!(RULE_KINDS as readonly unknown[]).includes(o.kind)) return void errors.push(`${p}.kind: unknown rule "${String(o.kind)}"`);
    const kind = o.kind as RuleKind;
    for (const k of Object.keys(o)) {
      if (!['id', 'strength', 'kind', ...FIELDS[kind]].includes(k)) errors.push(`${p}.${k}: not a field of ${kind}`);
    }
    const int = (k: string, min: number, max: number) => {
      if (!isInt(o[k], min, max)) errors.push(`${p}.${k}: must be a whole number ${min}-${max}`);
    };
    const days = (k: string) => {
      const v = o[k];
      if (!Array.isArray(v) || v.some((d) => !(DAYS as readonly unknown[]).includes(d))) {
        errors.push(`${p}.${k}: must be a list of days (${DAYS.join(', ')})`);
      }
    };
    switch (kind) {
      case 'daysOff':
        int('minOff', 0, 7);
        days('mustOff');
        break;
      case 'gaps':
        int('maxTotal', 0, 99);
        int('maxPerDay', 0, 99);
        int('maxSingle', 0, 99);
        break;
      case 'bannedPeriods':
        int('from', MIN_PERIOD, MAX_PERIOD);
        int('to', MIN_PERIOD, MAX_PERIOD);
        days('days');
        if (isInt(o.from, MIN_PERIOD, MAX_PERIOD) && isInt(o.to, MIN_PERIOD, MAX_PERIOD) && o.from > o.to) errors.push(`${p}: from is after to`);
        break;
      case 'dayWindow':
        int('earliest', MIN_PERIOD, MAX_PERIOD);
        int('latest', MIN_PERIOD, MAX_PERIOD);
        days('days');
        if (isInt(o.earliest, MIN_PERIOD, MAX_PERIOD) && isInt(o.latest, MIN_PERIOD, MAX_PERIOD) && o.earliest > o.latest) {
          errors.push(`${p}: earliest is after latest`);
        }
        break;
      case 'keepGroup':
      case 'avoidGroup': {
        const course = ds?.courses.find((c) => c.code === o.course);
        if (typeof o.course !== 'string' || (ds && !course)) errors.push(`${p}.course: unknown course "${String(o.course)}"`);
        else if (typeof o.group !== 'string' || (course && !course.groups.some((g) => g.id === o.group))) {
          errors.push(`${p}.group: unknown group "${String(o.group)}" in ${o.course}`);
        }
        break;
      }
      case 'maxChanges':
        int('max', 0, 99);
        break;
      case 'noSingleSessionDays':
        break;
    }
  });
  return errors.length ? { ok: false, errors } : { ok: true, rules: input as Rule[] };
}
```

- [x] **Step 5: Run the tests and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all PASS.

---

### Task 2: Gemini rule parser, dataset diff, storage

**Files:**
- Create: `src/app/gemini.ts`, `src/app/diff.ts`, `src/app/storage.ts`
- Test: `tests/app/gemini.test.ts`, `tests/app/diff.test.ts`

**Interfaces:**
- Consumes: `validateRules`, `RulesResult` (Task 1)
- Produces:
  - `DEFAULT_MODELS: string[]`
  - `interface HttpResponse { ok: boolean; status: number; text(): Promise<string> }`
  - `type FetchLike = (url: string, init: { method: 'POST'; headers: Record<string, string>; body: string }) => Promise<HttpResponse>`
  - `type ParseResult = { ok: true; rules: Rule[]; model: string } | { ok: false; errors: string[] }`
  - `buildPrompt(text: string, ds: Dataset | null, current: Rule[]): string`
  - `rulesFromText(text, ds, current, apiKey, models?, fetchFn?): Promise<ParseResult>`
  - `diffDatasets(prev: Dataset, next: Dataset): string[]`
  - `interface Store { get<T>(key: string): Promise<T | undefined>; set(key: string, value: unknown): Promise<void> }`
  - `memoryStore(initial?: Record<string, unknown>): Store`, `chromeStore(): Store`, `defaultStore(): Store`

- [x] **Step 1: Write the failing test `tests/app/gemini.test.ts`**

```ts
import { describe, expect, test, vi } from 'vitest';
import { buildPrompt, rulesFromText, type FetchLike } from '../../src/app/gemini';
import { defaultRules } from '../../src/app/rulesModel';
import { sept24 } from '../fixtures/sept24';

const reply = (status: number, rules: unknown) => ({
  ok: status === 200,
  status,
  text: async () =>
    status === 200 ? JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ rules }) }] } }] }) : 'quota exceeded',
});
const good = [{ id: 'no910', strength: 'must', kind: 'bannedPeriods', from: 9, to: 10, days: [] }];

describe('buildPrompt', () => {
  test('includes courses, groups, the current registration, current rules and the request', () => {
    const p = buildPrompt('no 9-10 please', sept24, defaultRules());
    expect(p).toContain('CCS2201 "Introduction to Networks": groups C, D, F, H, I, K, L, M, O, Extra (currently K)');
    expect(p).toContain('"id":"days-off"');
    expect(p).toContain('no 9-10 please');
  });
});

describe('rulesFromText', () => {
  test('returns validated rules and sends the key in a header, not the URL', async () => {
    const fetchFn = vi.fn<FetchLike>(async () => reply(200, good));
    const r = await rulesFromText('no 9-10', sept24, [], 'KEY123', ['m1'], fetchFn);
    expect(r).toEqual({ ok: true, rules: good, model: 'm1' });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/m1:generateContent');
    expect(url).not.toContain('KEY123');
    expect(init.headers['x-goog-api-key']).toBe('KEY123');
  });

  test('falls back to the next model on 429', async () => {
    const fetchFn = vi.fn<FetchLike>().mockResolvedValueOnce(reply(429, null)).mockResolvedValueOnce(reply(200, good));
    const r = await rulesFromText('no 9-10', sept24, [], 'k', ['m1', 'm2'], fetchFn);
    expect(r.ok && r.model).toBe('m2');
  });

  test('rejects invalid rules from Gemini instead of applying them', async () => {
    const fetchFn = vi.fn<FetchLike>(async () => reply(200, [{ id: 'x', strength: 'must', kind: 'keepGroup', course: 'NOPE', group: 'A' }]));
    const r = await rulesFromText('keep nope', sept24, [], 'k', ['m1'], fetchFn);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toContain('unknown course "NOPE"');
  });

  test('non-JSON output is an error; a missing key makes no request', async () => {
    const chatty = vi.fn<FetchLike>(async () => ({
      ok: true,
      status: 200,
      text: async () => '{"candidates":[{"content":{"parts":[{"text":"sure! here you go"}]}}]}',
    }));
    expect((await rulesFromText('x', sept24, [], 'k', ['m1'], chatty)).ok).toBe(false);
    const never = vi.fn<FetchLike>();
    expect(await rulesFromText('x', sept24, [], '  ', ['m1'], never)).toEqual({ ok: false, errors: ['No Gemini API key set (Settings).'] });
    expect(never).not.toHaveBeenCalled();
  });
});
```

- [x] **Step 2: Write the failing test `tests/app/diff.test.ts`**

```ts
import { describe, expect, test } from 'vitest';
import { diffDatasets } from '../../src/app/diff';
import type { Dataset } from '../../src/core/types';
import { sept24 } from '../fixtures/sept24';

const clone = (d: Dataset): Dataset => JSON.parse(JSON.stringify(d));

describe('diffDatasets', () => {
  test('identical data has no changes', () => expect(diffDatasets(sept24, clone(sept24))).toEqual([]));

  test('reports moved sessions, full groups, new and removed groups', () => {
    const next = clone(sept24);
    const net = next.courses.find((c) => c.code === 'CCS2201')!;
    net.groups.find((g) => g.id === 'I')!.sessions[1] = { day: 'Thu', from: 3, to: 4, type: 'Sec', lecturer: '' };
    net.groups.find((g) => g.id === 'K')!.open = false;
    net.groups = net.groups.filter((g) => g.id !== 'C');
    net.groups.push({ id: 'Z', portalLabel: 'T3 Class Z', pageLabel: '', open: true, sessions: [{ day: 'Sat', from: 1, to: 2, type: 'Lec', lecturer: '' }] });
    expect(diffDatasets(sept24, next)).toEqual([
      'Introduction to Networks I: Sun 3-4 Lec, Wed 7-8 Sec → Sun 3-4 Lec, Thu 3-4 Sec',
      'Introduction to Networks K: now full',
      'Introduction to Networks Z: new group (Sat 1-2 Lec)',
      'Introduction to Networks C: removed',
    ]);
  });
});
```

- [x] **Step 3: Run them and check that they fail**

Run: `npx vitest run tests/app/gemini.test.ts tests/app/diff.test.ts`
Expected: FAIL, because the modules don't exist yet.

- [x] **Step 4: Write `src/app/gemini.ts`**

```ts
import type { Rule } from '../core/rules';
import type { Dataset } from '../core/types';
import { validateRules } from './rulesModel';

/** Tried in order; each has its own free-tier daily quota, so a 429 moves on to the next. */
export const DEFAULT_MODELS = ['gemini-2.5-flash', 'gemini-flash-lite-latest', 'gemini-2.5-flash-lite'];

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const RETRY = new Set([429, 500, 503]);

export interface HttpResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}
export type FetchLike = (url: string, init: { method: 'POST'; headers: Record<string, string>; body: string }) => Promise<HttpResponse>;
export type ParseResult = { ok: true; rules: Rule[]; model: string } | { ok: false; errors: string[] };

export function buildPrompt(text: string, ds: Dataset | null, current: Rule[]): string {
  const courses = ds
    ? ds.courses
        .map((c) => `- ${c.code} "${c.name}": groups ${c.groups.map((g) => g.id).join(', ')}${c.current ? ` (currently ${c.current})` : ''}`)
        .join('\n')
    : '(no timetable data loaded)';
  return [
    "You convert a university student's timetable wishes into scheduling rules for a solver.",
    'Return ONLY JSON of the form {"rules": [ ... ]}: the COMPLETE new rule list. Keep the current rules unless the request changes or removes them.',
    '',
    'Days: Sat, Sun, Mon, Tue, Wed, Thu, Fri. Periods are 1-16; classes use 2-period slots (1-2, 3-4, 5-6, 7-8, 9-10, ...). "The 9-10 slot" means from 9 to 10.',
    'Each rule has "id" (short unique string), "strength" ("must" = required, "prefer" = nice to have and ranked in list order, "off" = disabled), "kind", and exactly these fields:',
    '- daysOff: minOff (days off per week including Friday, 0-7), mustOff (days that must be free)',
    '- gaps: maxTotal, maxPerDay, maxSingle (counted in 2-period slots; 99 = no limit)',
    '- bannedPeriods: from, to (periods), days ([] = every day)',
    '- dayWindow: earliest, latest (periods classes must stay within), days ([] = every day)',
    '- keepGroup / avoidGroup: course (course code), group (group id)',
    '- maxChanges: max (group changes from the current registration; 0 with "prefer" = fewest changes)',
    '- noSingleSessionDays: (no extra fields)',
    'Use "must" for must/never/no/need and "prefer" for prefer/ideally/if possible/rather.',
    '',
    'Courses and groups:',
    courses,
    '',
    'Current rules:',
    JSON.stringify(current),
    '',
    'Student request:',
    text,
  ].join('\n');
}

export async function rulesFromText(
  text: string,
  ds: Dataset | null,
  current: Rule[],
  apiKey: string,
  models: string[] = DEFAULT_MODELS,
  fetchFn: FetchLike = (url, init) => fetch(url, init),
): Promise<ParseResult> {
  if (!apiKey.trim()) return { ok: false, errors: ['No Gemini API key set (Settings).'] };
  if (!text.trim()) return { ok: false, errors: ['Type what you want first.'] };
  const body = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: buildPrompt(text, ds, current) }] }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0 },
  });
  const failures: string[] = [];
  for (const model of models) {
    const res = await fetchFn(`${ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey.trim() },
      body,
    });
    if (!res.ok) {
      failures.push(`${model}: HTTP ${res.status}`);
      if (RETRY.has(res.status)) continue;
      return { ok: false, errors: [`Gemini error (${model}, HTTP ${res.status}): ${(await res.text()).slice(0, 200)}`] };
    }
    let rules: unknown;
    try {
      const data = JSON.parse(await res.text()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      const out = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
      rules = (JSON.parse(out) as { rules?: unknown }).rules;
    } catch {
      return { ok: false, errors: [`Gemini (${model}) did not return valid JSON.`] };
    }
    const v = validateRules(rules, ds);
    return v.ok ? { ok: true, rules: v.rules, model } : { ok: false, errors: [`Gemini (${model}) returned rules that don't fit:`, ...v.errors] };
  }
  return { ok: false, errors: [`Every Gemini model is busy or over quota: ${failures.join('; ')}`] };
}
```

- [x] **Step 5: Write `src/app/diff.ts`**

```ts
import type { Dataset, Group } from '../core/types';

const fmt = (g: Group) =>
  g.sessions
    .map((s) => `${s.day} ${s.from}-${s.to} ${s.type}`)
    .sort()
    .join(', ');

export function diffDatasets(prev: Dataset, next: Dataset): string[] {
  const out: string[] = [];
  for (const c of next.courses) {
    const old = prev.courses.find((x) => x.code === c.code);
    if (!old) {
      out.push(`New course: ${c.name}`);
      continue;
    }
    for (const g of c.groups) {
      const og = old.groups.find((x) => x.id === g.id);
      if (!og) {
        out.push(`${c.name} ${g.id}: new group (${fmt(g)})`);
        continue;
      }
      if (fmt(og) !== fmt(g)) out.push(`${c.name} ${g.id}: ${fmt(og)} → ${fmt(g)}`);
      if (og.open !== g.open) out.push(`${c.name} ${g.id}: now ${g.open ? 'open' : 'full'}`);
    }
    for (const og of old.groups) if (!c.groups.some((g) => g.id === og.id)) out.push(`${c.name} ${og.id}: removed`);
  }
  for (const oc of prev.courses) if (!next.courses.some((c) => c.code === oc.code)) out.push(`Course removed: ${oc.name}`);
  return out;
}
```

- [x] **Step 6: Write `src/app/storage.ts`**

```ts
export interface Store {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
}

const copy = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

export function memoryStore(initial: Record<string, unknown> = {}): Store {
  const data = new Map<string, unknown>(Object.entries(copy(initial)));
  return {
    async get<T>(key: string) {
      return copy(data.get(key)) as T | undefined;
    },
    async set(key: string, value: unknown) {
      data.set(key, copy(value));
    },
  };
}

export function chromeStore(): Store {
  return {
    async get<T>(key: string) {
      const r = await chrome.storage.local.get(key);
      return r[key] as T | undefined;
    },
    async set(key: string, value: unknown) {
      await chrome.storage.local.set({ [key]: value });
    },
  };
}

export function defaultStore(): Store {
  return typeof chrome !== 'undefined' && chrome.storage?.local ? chromeStore() : memoryStore();
}
```

- [x] **Step 7: Run the tests and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all PASS.

---

### Task 3: Timetable and result-card views

**Files:**
- Create: `src/app/view.ts`
- Test: `tests/app/view.test.ts`

**Interfaces:**
- Consumes: `Solution` (Plan 1 solver), `Placed` (Plan 1 week), `Dataset`, `DAYS`, `Day`
- Produces:
  - `h(tag, attrs?, ...children)`: attributes via `setAttribute`, `on*` functions as listeners, `false`/`undefined` skipped
  - `COURSE_COLORS`, `courseColor(ds, code): string`
  - `renderTimetable(ds: Dataset, sessions: Placed[]): HTMLTableElement`
    - rows: header, then Sat–Thu, with Fri only if used
    - empty days: one `td.off` "OFF"
    - sessions: `td.cls` with `colspan`
    - empty periods between a day's first and last class: `td.gap`
  - `interface CardOptions { share: boolean; onFull?: (course: string, group: string) => void; keeps?: string[] }`
  - `renderCard(ds: Dataset, sol: Solution, n: number, opts: CardOptions): HTMLElement`

- [x] **Step 1: Write the failing test `tests/app/view.test.ts`**

```ts
// @vitest-environment jsdom
import { describe, expect, test, vi } from 'vitest';
import { solve } from '../../src/core/solver';
import { renderCard, renderTimetable } from '../../src/app/view';
import { sept24 } from '../fixtures/sept24';

const OPTION1 = { EBA2204: 'J', CCS2102: 'D', EBA2203: 'E', CCS2303: 'J', CCS2201: 'I', CIS2101: 'G' };
const all = solve(sept24, [{ id: 'off', strength: 'must', kind: 'daysOff', minOff: 3, mustOff: [] }], { limit: 100 }).solutions;
const registered = all.find((s) => Object.entries(OPTION1).every(([c, g]) => s.picks[c].includes(g)))!;

describe('renderTimetable', () => {
  test('shows off days, the Wednesday gap, and 2-period cells', () => {
    const t = renderTimetable(sept24, registered.sessions);
    expect(Array.from(t.rows).map((r) => r.cells[0].textContent)).toEqual(['', 'Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday']);
    expect(t.rows[4].cells[1].textContent).toBe('OFF');
    const wed = t.rows[5];
    expect(wed.querySelectorAll('td.gap')).toHaveLength(2);
    expect(wed.querySelectorAll('td.cls')).toHaveLength(4);
    expect((wed.querySelector('td.cls') as HTMLTableCellElement).colSpan).toBe(2);
  });
});

describe('renderCard', () => {
  test('personal mode shows changes, kept groups and full buttons; share mode hides them', () => {
    const onFull = vi.fn();
    const changed = all.find((s) => s.changes.length > 0)!;
    const personal = renderCard(sept24, changed, 1, { share: false, onFull, keeps: ['OOP J'] });
    expect(personal.textContent).toContain('(change)');
    expect(personal.textContent).toContain('Keeps: OOP J');
    (personal.querySelector('button.full') as HTMLButtonElement).click();
    expect(onFull).toHaveBeenCalledTimes(1);

    const share = renderCard(sept24, changed, 1, { share: true, onFull, keeps: ['OOP J'] });
    expect(share.textContent).not.toContain('(change)');
    expect(share.textContent).not.toContain('Keeps');
    expect(share.textContent).not.toMatch(/\d+ changes?/);
    expect(share.querySelector('button')).toBeNull();
  });

  test('merged equivalent groups are shown as alternatives', () => {
    const card = renderCard(sept24, registered, 1, { share: true });
    expect(card.textContent).toContain('T3 Class G -G -Alexandria  or  T3 Class H -H -Alexandria');
  });
});
```

- [x] **Step 2: Run it and check that it fails**

Run: `npx vitest run tests/app/view.test.ts`
Expected: FAIL, because `view` doesn't exist yet.

- [x] **Step 3: Write `src/app/view.ts`**

```ts
import type { Solution } from '../core/solver';
import { DAYS, type Dataset, type Day } from '../core/types';
import type { Placed } from '../core/week';

type Child = Node | string | null | undefined | false;
type Attrs = Record<string, string | number | boolean | EventListener | undefined>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

export const COURSE_COLORS = ['#b3d5e2', '#72b9c9', '#80c1ab', '#e8c47c', '#c795aa', '#dcd6c0', '#b7c7e8', '#e3a98f'];
const TYPE_LABEL = { Lec: 'Lecture', Sec: 'Section', Lab: 'Lab' } as const;
const DAY_NAMES: Record<Day, string> = {
  Sat: 'Saturday',
  Sun: 'Sunday',
  Mon: 'Monday',
  Tue: 'Tuesday',
  Wed: 'Wednesday',
  Thu: 'Thursday',
  Fri: 'Friday',
};

export function courseColor(ds: Dataset, code: string): string {
  const i = ds.courses.findIndex((c) => c.code === code);
  return COURSE_COLORS[Math.max(i, 0) % COURSE_COLORS.length];
}

export function renderTimetable(ds: Dataset, sessions: Placed[]): HTMLTableElement {
  const last = Math.max(10, ...sessions.map((p) => p.session.to));
  const width = last % 2 ? last + 1 : last;
  const table = h('table', { class: 'tt' });
  const head = h('tr', {}, h('th', {}));
  for (let p = 1; p <= width; p += 2) head.append(h('th', { colspan: 2 }, `${p}-${p + 1}`));
  table.append(head);

  for (const day of DAYS.filter((d) => d !== 'Fri' || sessions.some((p) => p.session.day === 'Fri'))) {
    const today = sessions.filter((p) => p.session.day === day);
    const row = h('tr', {}, h('th', { class: 'day' }, DAY_NAMES[day]));
    if (today.length === 0) {
      row.append(h('td', { class: 'off', colspan: width }, 'OFF'));
      table.append(row);
      continue;
    }
    const first = Math.min(...today.map((p) => p.session.from));
    const lastP = Math.max(...today.map((p) => p.session.to));
    for (let p = 1; p <= width; ) {
      const s = today.find((x) => x.session.from === p);
      if (s) {
        row.append(
          h(
            'td',
            { class: 'cls', colspan: s.session.to - s.session.from + 1, style: `background:${courseColor(ds, s.course)}` },
            h('b', {}, s.courseName),
            h('br'),
            TYPE_LABEL[s.session.type],
          ),
        );
        p = s.session.to + 1;
      } else {
        row.append(h('td', { class: p > first && p < lastP ? 'gap' : undefined }));
        p++;
      }
    }
    table.append(row);
  }
  return table;
}

export interface CardOptions {
  share: boolean;
  onFull?: (course: string, group: string) => void;
  keeps?: string[];
}

export function renderCard(ds: Dataset, sol: Solution, n: number, opts: CardOptions): HTMLElement {
  const tag = (text: string, cls = '') => h('span', { class: `tag ${cls}`.trim() }, text);
  const gaps = sol.stats.totalGapPeriods / 2;
  const late = sol.stats.days.filter((d) => d.last > 8).map((d) => d.day);
  const tags = [
    tag(`Off: ${sol.stats.offDays.join(', ')}`),
    tag(`${gaps} gap${gaps === 1 ? '' : 's'}`, gaps === 0 ? 'good' : ''),
    tag(`9-10+: ${late.join(', ') || 'none'}`, late.length ? 'warn' : 'good'),
  ];
  if (!opts.share) {
    tags.push(tag(`${sol.changes.length} change${sol.changes.length === 1 ? '' : 's'}`));
    if (opts.keeps?.length) tags.push(tag(`Keeps: ${opts.keeps.join(', ')}`, 'good'));
  }
  const card = h('article', { class: 'card' }, h('header', {}, h('b', {}, `#${n}`), h('div', { class: 'tags' }, ...tags)));
  if (sol.mustBroken.length) {
    card.append(h('p', { class: 'broken' }, `Breaks: ${sol.mustBroken.map((b) => b.messages.join('; ')).join(' | ')}`));
  }
  card.append(renderTimetable(ds, sol.sessions));

  const picks = h('ul', { class: 'picks' });
  for (const c of ds.courses) {
    const ids = sol.picks[c.code] ?? [];
    const changed = !opts.share && sol.changes.includes(c.code);
    const labels = ids.map((id) => c.groups.find((g) => g.id === id)?.portalLabel || id).join('  or  ');
    const li = h(
      'li',
      { class: changed ? 'changed' : undefined, style: `background:${courseColor(ds, c.code)}` },
      h('b', {}, `${c.name}: `),
      labels,
      changed ? ' (change)' : '',
    );
    if (!opts.share && opts.onFull) {
      for (const id of ids) {
        li.append(h('button', { class: 'full no-print', title: `Mark ${c.name} ${id} as full`, onclick: () => opts.onFull!(c.code, id) }, `${id} full`));
      }
    }
    picks.append(li);
  }
  card.append(picks);
  return card;
}
```

- [x] **Step 4: Run the tests and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all PASS.

---

### Task 4: The app (state, tabs, rules panel, results) and extension shell

**Files:**
- Create: `src/app/app.ts`, `src/app/main.ts`, `src/app/app.html`, `src/app/app.css`, `src/popup/popup.html`, `src/popup/popup.ts`, `public/manifest.json`
- Test: `tests/app/app.test.ts`

**Interfaces:**
- Consumes: everything above; `solve`, `Solution`, `validateDataset`, `sept24`
- Produces:
  - `interface Settings { apiKey: string; models: string[] }`
  - `interface App { state: AppState; render(): void; loadDataset(ds): Promise<void>; importText(text): Promise<void>; setRules(rules): Promise<void>; applyText(text): Promise<void> }`
  - `mountApp(root: HTMLElement, store?: Store, fetchFn?: FetchLike): Promise<App>`
  - **Store keys:** `dataset`, `previousDataset`, `rules`, `excluded`, `settings`

- [x] **Step 1: Write the failing test `tests/app/app.test.ts`**

```ts
// @vitest-environment jsdom
import { describe, expect, test, vi } from 'vitest';
import { mountApp } from '../../src/app/app';
import type { FetchLike } from '../../src/app/gemini';
import { memoryStore } from '../../src/app/storage';
import type { Dataset } from '../../src/core/types';
import { sept24 } from '../fixtures/sept24';

const text = (el: Element) => el.textContent ?? '';
const sample = (): Dataset => JSON.parse(JSON.stringify(sept24));

describe('app', () => {
  test('starts empty; the example data gives 57 schedules with the default rules', async () => {
    const root = document.createElement('div');
    const app = await mountApp(root, memoryStore());
    expect(text(root)).toContain('No timetable data yet');
    await app.loadDataset(sample());
    expect(text(root)).toContain('57 schedules');
    expect(root.querySelectorAll('article.card')).toHaveLength(57);
  });

  test('marking a group full re-solves and persists', async () => {
    const store = memoryStore();
    const root = document.createElement('div');
    const app = await mountApp(root, store);
    await app.loadDataset(sample());
    (root.querySelector('button[title="Mark Introduction to Networks K as full"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(text(root)).toContain('50 schedules'));
    expect(await store.get('excluded')).toEqual({ CCS2201: ['K'] });
  });

  test('rules and data persist across reloads', async () => {
    const store = memoryStore();
    const app = await mountApp(document.createElement('div'), store);
    await app.loadDataset(sample());
    await app.setRules([
      { id: 'off', strength: 'must', kind: 'daysOff', minOff: 3, mustOff: [] },
      { id: 'g', strength: 'must', kind: 'gaps', maxTotal: 0, maxPerDay: 0, maxSingle: 99 },
    ]);
    const root2 = document.createElement('div');
    await mountApp(root2, store);
    expect(text(root2)).toContain('8 schedules');
  });

  test('Gemini text replaces the rules and highlights what changed', async () => {
    const rules = [
      { id: 'days-off', strength: 'must', kind: 'daysOff', minOff: 3, mustOff: [] },
      { id: 'no910', strength: 'must', kind: 'bannedPeriods', from: 9, to: 10, days: [] },
    ];
    const fetchFn: FetchLike = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ rules }) }] } }] }),
    });
    const root = document.createElement('div');
    const app = await mountApp(root, memoryStore({ settings: { apiKey: 'k', models: ['m1'] } }), fetchFn);
    await app.loadDataset(sample());
    await app.applyText('no 9-10');
    expect(app.state.rules).toEqual(rules);
    expect(root.querySelector('.rule.highlight')?.textContent).toContain('No classes in periods 9-10');
    expect(text(root)).toContain('closest');
  });

  test('an invalid import shows the errors and keeps the old data', async () => {
    const root = document.createElement('div');
    const app = await mountApp(root, memoryStore());
    await app.loadDataset(sample());
    await app.importText('{"schemaVersion": 2}');
    expect(text(root)).toContain('schemaVersion: expected 1, got 2');
    expect(text(root)).toContain('57 schedules');
  });
});
```

- [x] **Step 2: Run it and check that it fails**

Run: `npx vitest run tests/app/app.test.ts`
Expected: FAIL, because `app` doesn't exist yet.

- [x] **Step 3: Write `src/app/app.ts`**

```ts
import { validateDataset } from '../core/dataset';
import type { AvoidGroupRule, KeepGroupRule, Rule } from '../core/rules';
import { solve, type Solution } from '../core/solver';
import { DAYS, type Dataset, type Day } from '../core/types';
import { sept24 } from '../sample/sept24';
import { diffDatasets } from './diff';
import { DEFAULT_MODELS, rulesFromText, type FetchLike } from './gemini';
import { defaultRules, describeRule, KIND_LABELS, newRule, RULE_KINDS, validateRules, type RuleKind } from './rulesModel';
import { defaultStore, type Store } from './storage';
import { h, renderCard, renderTimetable } from './view';

export interface Settings {
  apiKey: string;
  models: string[];
}

type Tab = 'results' | 'data' | 'settings';

export interface AppState {
  dataset: Dataset | null;
  previous: Dataset | null;
  rules: Rule[];
  excluded: Record<string, string[]>;
  settings: Settings;
  tab: Tab;
  share: boolean;
  highlighted: Set<string>;
  message: string;
  busy: boolean;
}

export interface App {
  state: AppState;
  render(): void;
  loadDataset(ds: Dataset): Promise<void>;
  importText(text: string): Promise<void>;
  setRules(rules: Rule[]): Promise<void>;
  applyText(text: string): Promise<void>;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

function download(name: string, text: string) {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'application/json' })), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export async function mountApp(root: HTMLElement, store: Store = defaultStore(), fetchFn?: FetchLike): Promise<App> {
  const dataset = (await store.get<Dataset>('dataset')) ?? null;
  const storedRules = await store.get<Rule[]>('rules');
  const state: AppState = {
    dataset,
    previous: (await store.get<Dataset>('previousDataset')) ?? null,
    rules: storedRules && validateRules(storedRules, dataset).ok ? storedRules : defaultRules(),
    excluded: (await store.get<Record<string, string[]>>('excluded')) ?? {},
    settings: (await store.get<Settings>('settings')) ?? { apiKey: '', models: DEFAULT_MODELS },
    tab: 'results',
    share: false,
    highlighted: new Set(),
    message: '',
    busy: false,
  };

  async function loadDataset(ds: Dataset) {
    state.previous = state.dataset;
    state.dataset = ds;
    state.excluded = {};
    state.rules = state.rules.filter((r) => validateRules([r], ds).ok);
    state.message = '';
    await store.set('previousDataset', state.previous);
    await store.set('dataset', ds);
    await store.set('excluded', {});
    await store.set('rules', state.rules);
    render();
  }

  async function importText(text: string) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      state.message = 'That file is not valid JSON.';
      return render();
    }
    const v = validateDataset(parsed);
    if (!v.ok) {
      state.message = `Import rejected:\n${v.errors.join('\n')}`;
      return render();
    }
    await loadDataset(v.data);
  }

  async function setRules(rules: Rule[]) {
    state.rules = rules;
    await store.set('rules', rules);
    render();
  }

  async function applyText(text: string) {
    state.busy = true;
    state.message = 'Asking Gemini…';
    render();
    const r = await rulesFromText(text, state.dataset, state.rules, state.settings.apiKey, state.settings.models, fetchFn);
    state.busy = false;
    if (!r.ok) {
      state.message = r.errors.join('\n');
      return render();
    }
    const before = new Map(state.rules.map((x) => [x.id, JSON.stringify(x)]));
    state.highlighted = new Set(r.rules.filter((x) => before.get(x.id) !== JSON.stringify(x)).map((x) => x.id));
    state.message = `Rules updated by ${r.model}. Changed rules are highlighted, so check them before trusting the results.`;
    await setRules(r.rules);
  }

  async function setExcluded(course: string, group: string, full: boolean) {
    const list = (state.excluded[course] ?? []).filter((g) => g !== group);
    state.excluded = { ...state.excluded, [course]: full ? [...list, group] : list };
    if (state.excluded[course].length === 0) delete state.excluded[course];
    await store.set('excluded', state.excluded);
    render();
  }

  function topBar() {
    const ds = state.dataset;
    const changes = ds && state.previous ? diffDatasets(state.previous, ds) : [];
    const file = h('input', {
      type: 'file',
      accept: '.json,application/json',
      class: 'hidden',
      onchange: async (e: Event) => {
        const f = (e.target as HTMLInputElement).files?.[0];
        if (f) await importText(await f.text());
      },
    });
    const openGroups = ds ? ds.courses.reduce((n, c) => n + c.groups.filter((g) => g.open).length, 0) : 0;
    return h(
      'header',
      { class: 'top no-print' },
      h('h1', {}, 'AAST Schedule Planner'),
      h(
        'span',
        { class: 'status' },
        ds
          ? `${ds.term} · data from ${new Date(ds.fetchedAt).toLocaleString()} · ${ds.courses.length} courses · ${openGroups} open groups`
          : 'No timetable data yet: import a file or load the example.',
      ),
      changes.length
        ? h(
            'details',
            { class: 'changes' },
            h('summary', {}, `⚠ ${changes.length} change${changes.length === 1 ? '' : 's'} since the previous data`),
            h('ul', {}, ...changes.map((c) => h('li', {}, c))),
          )
        : null,
      h(
        'span',
        { class: 'actions' },
        h('button', { onclick: () => file.click() }, 'Import data'),
        file,
        ds ? h('button', { onclick: () => download(`aast-timetable-${ds.fetchedAt.slice(0, 10)}.json`, JSON.stringify(ds, null, 2)) }, 'Export data') : null,
        h('button', { onclick: () => loadDataset(clone(sept24)) }, 'Load example (Sept 2026)'),
      ),
      state.message ? h('pre', { class: 'message' }, state.message) : null,
    );
  }

  function tabs() {
    const tab = (t: Tab, label: string) =>
      h('button', { class: state.tab === t ? 'tab active' : 'tab', onclick: () => ((state.tab = t), render()) }, label);
    return h('nav', { class: 'tabs no-print' }, tab('results', 'Plan'), tab('data', 'Data'), tab('settings', 'Settings'));
  }

  function groupPicker(r: KeepGroupRule | AvoidGroupRule, update: (p: Partial<Rule>) => void): Node[] {
    const ds = state.dataset;
    if (!ds) return [h('small', {}, 'Load timetable data to pick a group.')];
    const course = ds.courses.find((c) => c.code === r.course) ?? ds.courses[0];
    return [
      h(
        'select',
        {
          onchange: (e: Event) => {
            const code = (e.target as HTMLSelectElement).value;
            update({ course: code, group: ds.courses.find((c) => c.code === code)!.groups[0].id } as Partial<Rule>);
          },
        },
        ...ds.courses.map((c) => h('option', { value: c.code, selected: c.code === course.code }, c.name)),
      ),
      h(
        'select',
        { onchange: (e: Event) => update({ group: (e.target as HTMLSelectElement).value } as Partial<Rule>) },
        ...course.groups.map((g) => h('option', { value: g.id, selected: g.id === r.group }, g.id + (g.open ? '' : ' (full)'))),
      ),
    ];
  }

  function editors(r: Rule, update: (p: Partial<Rule>) => void): Node[] {
    const num = (label: string, value: number, min: number, max: number, key: string) =>
      h(
        'label',
        {},
        `${label} `,
        h('input', {
          type: 'number',
          min,
          max,
          value,
          onchange: (e: Event) => {
            const v = Number((e.target as HTMLInputElement).value);
            if (Number.isInteger(v) && v >= min && v <= max) update({ [key]: v } as Partial<Rule>);
            else render();
          },
        }),
      );
    const days = (label: string, selected: Day[], key: string) =>
      h(
        'span',
        { class: 'days' },
        `${label} `,
        ...DAYS.map((d) =>
          h(
            'label',
            {},
            h('input', {
              type: 'checkbox',
              checked: selected.includes(d),
              onchange: () => update({ [key]: selected.includes(d) ? selected.filter((x) => x !== d) : [...selected, d] } as Partial<Rule>),
            }),
            d,
          ),
        ),
      );
    switch (r.kind) {
      case 'daysOff':
        return [num('At least', r.minOff, 0, 7, 'minOff'), days('Must be off:', r.mustOff, 'mustOff')];
      case 'gaps':
        return [num('Total', r.maxTotal, 0, 99, 'maxTotal'), num('Per day', r.maxPerDay, 0, 99, 'maxPerDay'), num('Longest (99 = any)', r.maxSingle, 0, 99, 'maxSingle')];
      case 'bannedPeriods':
        return [num('From period', r.from, 1, 16, 'from'), num('to', r.to, 1, 16, 'to'), days('Days (none = all):', r.days, 'days')];
      case 'dayWindow':
        return [num('Earliest', r.earliest, 1, 16, 'earliest'), num('Latest', r.latest, 1, 16, 'latest'), days('Days (none = all):', r.days, 'days')];
      case 'keepGroup':
      case 'avoidGroup':
        return groupPicker(r, update);
      case 'maxChanges':
        return [num('At most (0 = fewest)', r.max, 0, 6, 'max')];
      case 'noSingleSessionDays':
        return [];
    }
  }

  function ruleRow(r: Rule, i: number) {
    const update = (patch: Partial<Rule>) => void setRules(state.rules.map((x, j) => (j === i ? ({ ...x, ...patch } as Rule) : x)));
    const move = (d: number) => {
      const j = i + d;
      if (j < 0 || j >= state.rules.length) return;
      const next = [...state.rules];
      [next[i], next[j]] = [next[j], next[i]];
      void setRules(next);
    };
    const strength = h(
      'select',
      { class: 'strength', onchange: (e: Event) => update({ strength: (e.target as HTMLSelectElement).value as Rule['strength'] }) },
      ...(['must', 'prefer', 'off'] as const).map((s) => h('option', { value: s, selected: r.strength === s }, s)),
    );
    return h(
      'div',
      { class: `rule ${r.strength}${state.highlighted.has(r.id) ? ' highlight' : ''}` },
      h(
        'div',
        { class: 'rule-head' },
        strength,
        h('span', { class: 'desc' }, describeRule(r, state.dataset)),
        h('button', { title: 'Move up', onclick: () => move(-1) }, '↑'),
        h('button', { title: 'Move down', onclick: () => move(1) }, '↓'),
        h('button', { title: 'Remove rule', onclick: () => setRules(state.rules.filter((_, j) => j !== i)) }, '✕'),
      ),
      h('div', { class: 'rule-edit' }, ...editors(r, update)),
    );
  }

  function rulesPanel() {
    const noKey = !state.settings.apiKey;
    const ta = h('textarea', { rows: 3, placeholder: 'e.g. Fri + Sun off, no 9-10, keep OOP J', disabled: noKey || state.busy });
    const add = h('select', {}, ...RULE_KINDS.map((k) => h('option', { value: k }, KIND_LABELS[k])));
    return h(
      'aside',
      { class: 'rules no-print' },
      h('h2', {}, 'Rules'),
      h(
        'div',
        { class: 'ask' },
        ta,
        h('button', { disabled: noKey || state.busy, onclick: () => applyText(ta.value) }, 'Apply with Gemini'),
        noKey ? h('small', {}, 'Add a Gemini API key in Settings to type rules in plain English.') : null,
      ),
      h('p', { class: 'hint' }, 'Must = required. Prefer = ranked top to bottom. Off = ignored.'),
      ...state.rules.map((r, i) => ruleRow(r, i)),
      h(
        'div',
        { class: 'add' },
        add,
        h(
          'button',
          { onclick: () => setRules([...state.rules, newRule(add.value as RuleKind, `${add.value}-${Date.now().toString(36)}`, state.dataset)]) },
          'Add rule',
        ),
      ),
    );
  }

  function resultsPanel() {
    const ds = state.dataset;
    if (!ds) return h('section', { class: 'results' }, h('p', {}, 'Import timetable data (or load the example) to see schedules.'));
    const res = solve(ds, state.rules, { excluded: state.excluded, limit: 100 });
    const list = res.total > 0 ? res.solutions : res.nearMisses;
    const keeps = (sol: Solution) =>
      state.rules
        .filter((r): r is KeepGroupRule => r.kind === 'keepGroup' && r.strength !== 'off' && (sol.picks[r.course] ?? []).includes(r.group))
        .map((r) => `${ds.courses.find((c) => c.code === r.course)?.name ?? r.course} ${r.group}`);
    const full = Object.entries(state.excluded).flatMap(([c, gs]) => gs.map((g) => ({ c, g })));
    return h(
      'section',
      { class: 'results' },
      h(
        'div',
        { class: 'results-head no-print' },
        h(
          'h2',
          {},
          res.total > 0
            ? `${res.total} schedule${res.total === 1 ? '' : 's'}${res.total > list.length ? ` (showing the best ${list.length})` : ''}`
            : 'Nothing fits every must rule. These are the closest:',
        ),
        h(
          'label',
          {},
          h('input', { type: 'checkbox', checked: state.share, onchange: () => ((state.share = !state.share), render()) }),
          ' Share mode (hides changes and kept groups)',
        ),
        h('button', { onclick: () => window.print() }, 'Export PDF'),
      ),
      full.length
        ? h(
            'p',
            { class: 'full-list no-print' },
            'Marked full: ',
            ...full.map(({ c, g }) =>
              h('button', { title: 'Undo', onclick: () => setExcluded(c, g, false) }, `${ds.courses.find((x) => x.code === c)?.name ?? c} ${g} ✕`),
            ),
          )
        : null,
      ...list.map((sol, i) => renderCard(ds, sol, i + 1, { share: state.share, onFull: (c, g) => void setExcluded(c, g, true), keeps: keeps(sol) })),
    );
  }

  function dataTab() {
    const ds = state.dataset;
    if (!ds) return h('main', { class: 'data' }, h('p', {}, 'No timetable data yet.'));
    return h(
      'main',
      { class: 'data' },
      ...ds.courses.map((c) =>
        h(
          'section',
          {},
          h('h2', {}, `${c.name} (${c.code})${c.current ? `: you're in ${c.current}` : ''}`),
          h(
            'div',
            { class: 'groups' },
            ...c.groups.map((g) =>
              h(
                'div',
                { class: g.open ? 'group' : 'group closed' },
                h('h3', {}, `${g.portalLabel || g.id}${g.open ? '' : ' (full)'}`),
                renderTimetable(ds, g.sessions.map((session) => ({ course: c.code, courseName: c.name, group: g.id, session }))),
              ),
            ),
          ),
        ),
      ),
    );
  }

  function settingsTab() {
    const key = h('input', { type: 'password', value: state.settings.apiKey, placeholder: 'Gemini API key', autocomplete: 'off' });
    const models = h('input', { type: 'text', value: state.settings.models.join(', ') });
    return h(
      'main',
      { class: 'settings' },
      h('h2', {}, 'Settings'),
      h('label', {}, "Gemini API key (kept only in this browser, sent only to Google's Gemini API)", key),
      h('label', {}, 'Models to try, in order', models),
      h(
        'button',
        {
          onclick: async () => {
            const list = models.value.split(',').map((m) => m.trim()).filter(Boolean);
            state.settings = { apiKey: key.value.trim(), models: list.length ? list : DEFAULT_MODELS };
            await store.set('settings', state.settings);
            state.message = 'Settings saved.';
            render();
          },
        },
        'Save',
      ),
      h('p', { class: 'hint' }, 'This extension never changes your registration. It only reads timetables.'),
    );
  }

  function render() {
    const body = state.tab === 'results' ? h('main', { class: 'layout' }, rulesPanel(), resultsPanel()) : state.tab === 'data' ? dataTab() : settingsTab();
    root.replaceChildren(topBar(), tabs(), body);
  }

  render();
  return { state, render, loadDataset, importText, setRules, applyText };
}
```

- [x] **Step 4: Run the tests and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all PASS.

- [x] **Step 5: Write the page entry, styles, popup and manifest**

`src/app/main.ts`:
```ts
import { sept24 } from '../sample/sept24';
import { mountApp } from './app';

const root = document.getElementById('app');
if (root) {
  void mountApp(root).then(async (app) => {
    // ?demo loads the example data on an empty install (used for screenshots)
    if (!app.state.dataset && new URLSearchParams(location.search).has('demo')) await app.loadDataset(JSON.parse(JSON.stringify(sept24)));
  });
}
```

`src/app/app.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>AAST Schedule Planner</title>
    <link rel="stylesheet" href="./app.css" />
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
```

`src/app/app.css`:
```css
:root {
  --bg: #f6f4ee;
  --panel: #fff;
  --ink: #1d2330;
  --muted: #5d6474;
  --line: #d4d8df;
  --good: #1a7f37;
  --warn: #b3261e;
  --accent: #2b5d8a;
  font-family: 'Inter', 'Noto Sans', 'DejaVu Sans', sans-serif;
  color: var(--ink);
  background: var(--bg);
}
* { box-sizing: border-box; }
body { margin: 0; }
button { font: inherit; cursor: pointer; border: 1px solid var(--line); background: var(--panel); border-radius: 6px; padding: 4px 10px; }
button:hover { border-color: var(--accent); }
button:disabled { opacity: 0.5; cursor: default; }
.hidden { display: none; }
.top { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; padding: 12px 20px; background: #26344a; color: #fff; }
.top h1 { font-size: 18px; margin: 0; }
.top .status { color: #c8d3e3; font-size: 13px; }
.top .actions { margin-left: auto; display: flex; gap: 6px; }
.top .changes { flex-basis: 100%; font-size: 13px; color: #ffd9a8; }
.top .message { flex-basis: 100%; margin: 0; padding: 8px 10px; background: #fff3; border-radius: 6px; white-space: pre-wrap; font: 13px/1.4 inherit; }
.tabs { display: flex; gap: 4px; padding: 8px 20px 0; }
.tab.active { background: var(--accent); color: #fff; border-color: var(--accent); }
.layout { display: grid; grid-template-columns: minmax(300px, 380px) 1fr; gap: 16px; padding: 12px 20px 40px; align-items: start; }
.rules { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 12px; position: sticky; top: 8px; max-height: calc(100vh - 16px); overflow: auto; }
.rules h2, .results h2 { margin: 0 0 8px; font-size: 16px; }
.ask { display: grid; gap: 6px; margin-bottom: 8px; }
.ask textarea { width: 100%; font: inherit; padding: 6px; border: 1px solid var(--line); border-radius: 6px; }
.hint { color: var(--muted); font-size: 12px; }
.rule { border: 1px solid var(--line); border-left: 4px solid var(--accent); border-radius: 8px; padding: 6px 8px; margin-bottom: 8px; font-size: 13px; }
.rule.prefer { border-left-color: #c79a2b; }
.rule.off { border-left-color: var(--line); opacity: 0.6; }
.rule.highlight { background: #fff6d6; box-shadow: 0 0 0 2px #e8c47c; }
.rule-head { display: flex; gap: 6px; align-items: center; }
.rule-head .desc { flex: 1; font-weight: 600; }
.rule-head button { padding: 0 6px; }
.rule-edit { display: flex; flex-wrap: wrap; gap: 6px 10px; margin-top: 6px; color: var(--muted); }
.rule-edit input[type='number'] { width: 56px; }
.days label { margin-right: 4px; }
.add { display: flex; gap: 6px; margin-top: 8px; }
.results-head { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; margin-bottom: 8px; }
.results-head h2 { margin: 0; }
.full-list button { margin: 0 4px; }
.card { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; margin-bottom: 12px; break-inside: avoid; }
.card header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px; }
.card header b { font-size: 16px; }
.tags { display: flex; flex-wrap: wrap; gap: 4px; justify-content: flex-end; }
.tag { font-size: 12px; background: #eceef2; border-radius: 4px; padding: 1px 7px; }
.tag.good { background: #d7f0dc; color: #135c26; }
.tag.warn { background: #fbe0dd; color: #8c1d14; }
.broken { color: var(--warn); font-size: 12px; margin: 0 0 6px; }
.tt { border-collapse: collapse; width: 100%; table-layout: fixed; font-size: 11px; }
.tt th, .tt td { border: 1px solid var(--line); height: 30px; text-align: center; padding: 0 2px; line-height: 1.15; overflow: hidden; }
.tt th { background: #eef0f3; font-weight: 600; }
.tt th.day { width: 82px; }
.tt td.off { color: #999; background: #f4f4f4; }
.tt td.gap { background: #f6d3cf; }
.picks { list-style: none; padding: 0; margin: 8px 0 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 4px 8px; font-size: 12px; }
.picks li { border-radius: 5px; padding: 3px 6px; }
.picks li.changed { outline: 2px solid var(--warn); font-weight: 600; }
.picks .full { margin-left: 6px; padding: 0 5px; font-size: 11px; }
.data, .settings { padding: 12px 20px 40px; }
.groups { display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 10px; }
.group { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 8px; }
.group.closed { opacity: 0.55; }
.group h3 { margin: 0 0 6px; font-size: 13px; }
.settings label { display: grid; gap: 4px; max-width: 520px; margin-bottom: 10px; font-size: 13px; }
.settings input { font: inherit; padding: 6px; border: 1px solid var(--line); border-radius: 6px; }
@media (max-width: 900px) {
  .layout { grid-template-columns: 1fr; }
  .rules { position: static; max-height: none; }
}
@media print {
  .no-print { display: none !important; }
  body, :root { background: #fff; }
  .layout { display: block; padding: 0; }
  .card { border-color: #999; }
}
```

`src/popup/popup.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>AAST Schedule Planner</title>
    <style>
      body { width: 280px; margin: 0; padding: 12px; font: 13px/1.4 'Inter', 'Noto Sans', sans-serif; color: #1d2330; }
      h1 { font-size: 15px; margin: 0 0 8px; }
      button { width: 100%; padding: 8px; border: 0; border-radius: 6px; background: #2b5d8a; color: #fff; font: inherit; cursor: pointer; }
      p { color: #5d6474; margin: 8px 0 0; }
    </style>
  </head>
  <body>
    <h1>AAST Schedule Planner</h1>
    <button id="open">Open planner</button>
    <p id="portal"></p>
    <script type="module" src="./popup.ts"></script>
  </body>
</html>
```

`src/popup/popup.ts`:
```ts
document.getElementById('open')?.addEventListener('click', () => {
  void chrome.tabs.create({ url: chrome.runtime.getURL('app/app.html') });
  window.close();
});

void chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
  const onPortal = tab?.url?.startsWith('https://alexreg.aast.edu/') ?? false;
  const note = document.getElementById('portal');
  if (note) {
    note.textContent = onPortal
      ? 'Reading the portal directly comes once registration reopens (it needs the Change Registered Courses page). For now, plan with imported data.'
      : 'Plan with imported data or the example. This extension never changes your registration.';
  }
});
```

`public/manifest.json`:
```json
{
  "manifest_version": 3,
  "name": "AAST Schedule Planner",
  "version": "0.1.0",
  "description": "Finds clash-free AASTMT timetables that fit your rules. Never changes your registration.",
  "action": { "default_popup": "popup/popup.html", "default_title": "AAST Schedule Planner" },
  "permissions": ["storage", "activeTab"],
  "host_permissions": ["https://generativelanguage.googleapis.com/*"]
}
```

- [x] **Step 6: Build and check the output**

Run: `npx tsc --noEmit && npx vite build && ls dist dist/app dist/popup && cat dist/manifest.json`
Expected: the build succeeds, `dist/manifest.json`, `dist/app/app.html` and `dist/popup/popup.html` exist, and there are no inline scripts in the HTML.

- [x] **Step 7: Visual check**

Run `npx vite preview --port 4173` in the background, then:
`brave --headless=new --disable-gpu --window-size=1400,1800 --screenshot=<scratch>/app.png 'http://localhost:4173/app/app.html?demo'`
Expected: the screenshot shows the top bar, the rules panel, "57 schedules", and colour-coded timetable cards.

---

## Self-Review

- **Spec coverage:** §10 top bar (status, change warning, import/export), rules panel (text box, must/prefer/off, priority order), results (count or near-misses, cards, tags, dropdown names, full buttons), data tab, PDF export with share mode → Tasks 3–4. §9 Gemini (key in storage, header only, strict validation, highlight, no key = disabled box) → Tasks 2 and 4. §11 errors (bad import, Gemini errors) → Tasks 2 and 4. Deferred: the portal reader popup action (needs the change page).
- **Placeholders:** none.
- **Types:** these names match everywhere they're used:
  - `Rule`, `RuleKind`, `RulesResult`, `ParseResult`, `FetchLike`
  - `Store` (`get`, `set`)
  - `CardOptions` (`share`, `onFull`, `keeps`)
  - `App` (`loadDataset`, `importText`, `setRules`, `applyText`, `state`)
