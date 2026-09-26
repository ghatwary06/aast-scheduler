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

/**
 * Keeps only the best `k` items seen so far (by `cmp`) while counting everything. Live portal data
 * has millions of combinations, so storing every candidate would run out of memory.
 */
function topK<T>(k: number, cmp: (a: T, b: T) => number) {
  let items: T[] = [];
  let count = 0;
  return {
    add(x: T) {
      count++;
      items.push(x);
      if (items.length >= k * 4 + 256) {
        items.sort(cmp);
        items = items.slice(0, k);
      }
    },
    result: () => items.sort(cmp).slice(0, k),
    count: () => count,
  };
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
  const best = topK<Solution>(limit, byPrefer);
  search(
    strict,
    (used) => dayRules.some((r) => DAYS.length - used.size < r.minOff || r.mustOff.some((d) => used.has(d))),
    (chosen) => {
      const s = toSolution(strict, chosen);
      if (s.mustBroken.length === 0) best.add(s);
    },
  );
  if (best.count() > 0) return { total: best.count(), solutions: best.result(), nearMisses: [] };

  // Relaxed pass: only clashes and full groups are hard; rank by how little the must rules are broken.
  const relaxed = buildUnits(ds, [], excluded);
  const closest = topK<Solution>(nearMissLimit, (a, b) => a.mustBroken.length - b.mustBroken.length || a.mustCost - b.mustCost || byPrefer(a, b));
  search(relaxed, () => false, (chosen) => closest.add(toSolution(relaxed, chosen)));
  return { total: 0, solutions: [], nearMisses: closest.result() };
}
