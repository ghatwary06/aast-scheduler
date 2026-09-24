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
