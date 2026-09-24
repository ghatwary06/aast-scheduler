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
