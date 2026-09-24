import { describe, expect, test } from 'vitest';
import { diffDatasets } from '../../src/app/diff';
import type { Dataset } from '../../src/core/types';
import { sept24 } from '../fixtures/sept24';

const clone = (d: Dataset): Dataset => JSON.parse(JSON.stringify(d));

describe('diffDatasets', () => {
  test('identical data has no changes', () => expect(diffDatasets(sept24, clone(sept24))).toEqual([]));

  test('reports moved sessions, full groups, new and removed groups', () => {
    const next = clone(sept24);
    const net = next.courses.find((c) => c.code === 'CCS2201')!;
    net.groups.find((g) => g.id === 'I')!.sessions[1] = { day: 'Thu', from: 3, to: 4, type: 'Sec', lecturer: '' };
    net.groups.find((g) => g.id === 'K')!.open = false;
    net.groups = net.groups.filter((g) => g.id !== 'C');
    net.groups.push({ id: 'Z', portalLabel: 'T3 Class Z', pageLabel: '', open: true, sessions: [{ day: 'Sat', from: 1, to: 2, type: 'Lec', lecturer: '' }] });
    expect(diffDatasets(sept24, next)).toEqual([
      'Introduction to Networks I: Sun 3-4 Lec, Wed 7-8 Sec → Sun 3-4 Lec, Thu 3-4 Sec',
      'Introduction to Networks K: now full',
      'Introduction to Networks Z: new group (Sat 1-2 Lec)',
      'Introduction to Networks C: removed',
    ]);
  });
});
