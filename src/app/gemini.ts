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
