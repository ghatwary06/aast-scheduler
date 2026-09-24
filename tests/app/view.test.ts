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
