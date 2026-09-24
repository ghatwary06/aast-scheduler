import type { Dataset, Group } from '../core/types';

const fmt = (g: Group) =>
  g.sessions
    .map((s) => `${s.day} ${s.from}-${s.to} ${s.type}`)
    .sort()
    .join(', ');

export function diffDatasets(prev: Dataset, next: Dataset): string[] {
  const out: string[] = [];
  for (const c of next.courses) {
    const old = prev.courses.find((x) => x.code === c.code);
    if (!old) {
      out.push(`New course: ${c.name}`);
      continue;
    }
    for (const g of c.groups) {
      const og = old.groups.find((x) => x.id === g.id);
      if (!og) {
        out.push(`${c.name} ${g.id}: new group (${fmt(g)})`);
        continue;
      }
      if (fmt(og) !== fmt(g)) out.push(`${c.name} ${g.id}: ${fmt(og)} → ${fmt(g)}`);
      if (og.open !== g.open) out.push(`${c.name} ${g.id}: now ${g.open ? 'open' : 'full'}`);
    }
    for (const og of old.groups) if (!c.groups.some((g) => g.id === og.id)) out.push(`${c.name} ${og.id}: removed`);
  }
  for (const oc of prev.courses) if (!next.courses.some((c) => c.code === oc.code)) out.push(`Course removed: ${oc.name}`);
  return out;
}
