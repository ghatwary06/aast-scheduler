import { DAYS, MAX_PERIOD, MIN_PERIOD, SESSION_TYPES, type Dataset } from './types';

export type ValidationResult = { ok: true; data: Dataset } | { ok: false; errors: string[] };

const SOURCES = ['portal', 'pdf', 'import'];

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isPeriod(v: unknown): v is number {
  return Number.isInteger(v) && (v as number) >= MIN_PERIOD && (v as number) <= MAX_PERIOD;
}

export function validateDataset(input: unknown): ValidationResult {
  const errors: string[] = [];
  const err = (path: string, msg: string) => void errors.push(`${path}: ${msg}`);

  if (!isObj(input)) return { ok: false, errors: ['dataset: not an object'] };
  if (input.schemaVersion !== 1) err('schemaVersion', `expected 1, got ${JSON.stringify(input.schemaVersion)}`);
  if (typeof input.source !== 'string' || !SOURCES.includes(input.source)) err('source', `must be one of ${SOURCES.join(', ')}`);
  if (typeof input.fetchedAt !== 'string' || Number.isNaN(Date.parse(input.fetchedAt))) err('fetchedAt', 'must be an ISO date string');
  if (typeof input.term !== 'string') err('term', 'must be a string');
  if (!Array.isArray(input.courses) || input.courses.length === 0) {
    err('courses', 'must be a non-empty array');
    return { ok: false, errors };
  }

  const codes = new Set<string>();
  input.courses.forEach((c: unknown, ci) => {
    const cp = `courses[${ci}]`;
    if (!isObj(c)) return err(cp, 'not an object');
    if (typeof c.code !== 'string' || c.code === '') err(`${cp}.code`, 'must be a non-empty string');
    else if (codes.has(c.code)) err(`${cp}.code`, `duplicate course ${c.code}`);
    else codes.add(c.code);
    if (typeof c.name !== 'string') err(`${cp}.name`, 'must be a string');
    if (!Array.isArray(c.groups) || c.groups.length === 0) return err(`${cp}.groups`, 'must be a non-empty array');

    const ids = new Set<string>();
    c.groups.forEach((g: unknown, gi) => {
      const gp = `${cp}.groups[${gi}]`;
      if (!isObj(g)) return err(gp, 'not an object');
      if (typeof g.id !== 'string' || g.id === '') err(`${gp}.id`, 'must be a non-empty string');
      else if (ids.has(g.id)) err(`${gp}.id`, `duplicate group ${g.id}`);
      else ids.add(g.id);
      if (typeof g.portalLabel !== 'string') err(`${gp}.portalLabel`, 'must be a string');
      if (typeof g.pageLabel !== 'string') err(`${gp}.pageLabel`, 'must be a string');
      if (typeof g.open !== 'boolean') err(`${gp}.open`, 'must be true or false');
      if (!Array.isArray(g.sessions) || g.sessions.length === 0) return err(`${gp}.sessions`, 'must be a non-empty array');

      g.sessions.forEach((s: unknown, si) => {
        const sp = `${gp}.sessions[${si}]`;
        if (!isObj(s)) return err(sp, 'not an object');
        if (!(DAYS as readonly unknown[]).includes(s.day)) err(`${sp}.day`, `${JSON.stringify(s.day)} is not a day`);
        if (!isPeriod(s.from)) err(`${sp}.from`, `must be a period ${MIN_PERIOD}-${MAX_PERIOD}`);
        if (!isPeriod(s.to)) err(`${sp}.to`, `must be a period ${MIN_PERIOD}-${MAX_PERIOD}`);
        if (isPeriod(s.from) && isPeriod(s.to) && s.from > s.to) err(sp, 'from is after to');
        if (!(SESSION_TYPES as readonly unknown[]).includes(s.type)) err(`${sp}.type`, `${JSON.stringify(s.type)} is not Lec/Sec/Lab`);
        if (typeof s.lecturer !== 'string') err(`${sp}.lecturer`, 'must be a string');
      });
    });

    if (c.current !== null && (typeof c.current !== 'string' || !ids.has(c.current))) {
      err(`${cp}.current`, "must be null or one of the course's group ids");
    }
  });

  return errors.length ? { ok: false, errors } : { ok: true, data: input as unknown as Dataset };
}
