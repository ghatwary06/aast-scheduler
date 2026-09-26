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
  const readerWarnings = (await store.get<string[]>('readerWarnings')) ?? [];
  if (readerWarnings.length) state.message = `Portal read warnings:\n${readerWarnings.join('\n')}`;

  async function loadDataset(ds: Dataset) {
    state.previous = state.dataset;
    state.dataset = ds;
    state.excluded = {};
    state.rules = state.rules.filter((r) => validateRules([r], ds).ok);
    state.message = '';
    await store.set('readerWarnings', []); // warnings belong to the read that produced them
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
