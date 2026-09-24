import type { Day, SessionType } from '../core/types';

export class PortalParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PortalParseError';
  }
}

export interface GridEntry {
  day: Day;
  from: number;
  to: number;
  courseCode: string;
  type: SessionType;
  lecturer: string;
}

const DAY_NAMES: Record<string, Day> = {
  saturday: 'Sat',
  sunday: 'Sun',
  monday: 'Mon',
  tuesday: 'Tue',
  wednesday: 'Wed',
  thursday: 'Thu',
  friday: 'Fri',
};

/** 1 spacer column + 16 period columns. */
const COLUMNS = 17;

export function clean(s: string | null | undefined): string {
  return (s ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
}

export function parseType(raw: string): SessionType {
  const t = clean(raw).toLowerCase();
  if (t.startsWith('lec')) return 'Lec';
  if (t.startsWith('sec')) return 'Sec';
  if (t.startsWith('lab')) return 'Lab';
  throw new PortalParseError(`unknown session type "${raw}"`);
}

/** Text lines of an element, split at <br>. */
function lines(el: Element): string[] {
  const out = [''];
  const walk = (node: Node) => {
    node.childNodes.forEach((n) => {
      if (n.nodeType === 3) out[out.length - 1] += n.textContent ?? '';
      else if (n.nodeName === 'BR') out.push('');
      else walk(n);
    });
  };
  walk(el);
  return out.map(clean).filter((l) => l !== '');
}

export function parseScheduleTable(table: Element | null): GridEntry[] {
  if (!table || table.nodeName !== 'TABLE') throw new PortalParseError('timetable table not found');
  const rows = Array.from((table as HTMLTableElement).rows);
  const header = rows.shift();
  const nums = header ? Array.from(header.cells).slice(2).map((c) => clean(c.textContent)) : [];
  if (nums.join(',') !== Array.from({ length: 16 }, (_, i) => String(i + 1)).join(',')) {
    throw new PortalParseError('timetable header is not periods 1-16');
  }

  const entries: GridEntry[] = [];
  for (const row of rows) {
    const [dayCell, ...cells] = Array.from(row.cells);
    const dayName = clean(dayCell?.textContent);
    const day = DAY_NAMES[dayName.toLowerCase()];
    if (!day || dayCell.nodeName !== 'TH') throw new PortalParseError(`unknown day row "${dayName}"`);
    let col = 0;
    for (const td of cells) {
      const span = td.colSpan || 1;
      const items = Array.from(td.querySelectorAll('span[id$="_lbSelect"]'));
      if (items.length === 0 && clean(td.textContent) !== '') {
        throw new PortalParseError(`${dayName}: unexpected cell content "${clean(td.textContent)}"`);
      }
      for (const item of items) {
        const [first = '', type = '', lecturer = ''] = lines(item);
        const code = first.match(/([A-Z]{2,4})\s*(\d{3,4})/);
        if (!code) throw new PortalParseError(`${dayName}: no course code in "${first}"`);
        if (col < 1 || col + span - 1 > 16) throw new PortalParseError(`${dayName}: session outside periods 1-16`);
        entries.push({ day, from: col, to: col + span - 1, courseCode: code[1] + code[2], type: parseType(type), lecturer });
      }
      col += span;
    }
    if (col !== COLUMNS) throw new PortalParseError(`${dayName} row has ${col - 1} columns, expected 16`);
  }
  return entries;
}
