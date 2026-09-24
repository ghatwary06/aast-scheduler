import { DAYS, type Day, type Session } from './types';

export interface Placed {
  course: string;
  courseName: string;
  group: string;
  session: Session;
}

export interface DayStats {
  day: Day;
  sessions: number;
  first: number;
  last: number;
  gapPeriods: number;
  longestGap: number;
}

export interface WeekStats {
  usedDays: Day[];
  offDays: Day[];
  days: DayStats[];
  totalGapPeriods: number;
}

export function overlaps(a: Session, b: Session): boolean {
  return a.day === b.day && a.from <= b.to && b.from <= a.to;
}

export function weekStats(sessions: Session[]): WeekStats {
  const days: DayStats[] = [];
  for (const day of DAYS) {
    const today = sessions.filter((s) => s.day === day);
    if (today.length === 0) continue;
    const first = Math.min(...today.map((s) => s.from));
    const last = Math.max(...today.map((s) => s.to));
    let gapPeriods = 0;
    let longestGap = 0;
    let run = 0;
    for (let p = first; p <= last; p++) {
      if (today.some((s) => s.from <= p && p <= s.to)) {
        run = 0;
      } else {
        gapPeriods++;
        run++;
        longestGap = Math.max(longestGap, run);
      }
    }
    days.push({ day, sessions: today.length, first, last, gapPeriods, longestGap });
  }
  const usedDays = days.map((d) => d.day);
  return {
    usedDays,
    offDays: DAYS.filter((d) => !usedDays.includes(d)),
    days,
    totalGapPeriods: days.reduce((n, d) => n + d.gapPeriods, 0),
  };
}
