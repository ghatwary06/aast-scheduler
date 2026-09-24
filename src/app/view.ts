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
