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
