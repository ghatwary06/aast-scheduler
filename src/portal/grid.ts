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

/** day + spacer + 16 period columns. */
const COLUMNS = 18;

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

/**
 * Reads a portal timetable. Follows the HTML table rules for rowspan/colspan, so a day whose
 * classes are stacked in one slot (the day cell spans several rows) is read correctly. Columns:
 * 0 = day, 1 = blank spacer, 2..17 = periods 1..16. Any row that doesn't add up throws.
 */
export function parseScheduleTable(table: Element | null): GridEntry[] {
  if (!table || table.nodeName !== 'TABLE') throw new PortalParseError('timetable table not found');
  const rows = Array.from((table as HTMLTableElement).rows);
  const header = rows.shift();
  const nums = header ? Array.from(header.cells).slice(2).map((c) => clean(c.textContent)) : [];
  if (nums.join(',') !== Array.from({ length: 16 }, (_, i) => String(i + 1)).join(',')) {
    throw new PortalParseError('timetable header is not periods 1-16');
  }

  const entries: GridEntry[] = [];
  let carried = new Map<number, number>(); // column -> rows still covered by a rowspan from above
  let day: Day | null = null;
  let dayName = '';
  for (const row of rows) {
    const cells = Array.from(row.cells);
    if (!carried.has(0)) {
      if (cells[0]?.nodeName !== 'TH') throw new PortalParseError(`a timetable row has no day ("${clean(cells[0]?.textContent)}")`);
      dayName = clean(cells[0].textContent);
      day = DAY_NAMES[dayName.toLowerCase()] ?? null;
      if (!day) throw new PortalParseError(`unknown day row "${dayName}"`);
    }
    if (!day) throw new PortalParseError('a timetable row has no day');
    const next = new Map<number, number>();
    for (const [c, left] of carried) if (left > 1) next.set(c, left - 1);
    let col = 0;
    let covered = carried.size;
    for (const cell of cells) {
      while (carried.has(col)) col++;
      const span = cell.colSpan || 1;
      if (cell.rowSpan > 1) for (let c = col; c < col + span; c++) next.set(c, cell.rowSpan - 1);
      if (cell.nodeName === 'TD') {
        const items = Array.from(cell.querySelectorAll('span[id$="_lbSelect"]'));
        if (items.length === 0 && clean(cell.textContent) !== '') {
          throw new PortalParseError(`${dayName}: unexpected cell content "${clean(cell.textContent)}"`);
        }
        for (const item of items) {
          const [first = '', type = '', lecturer = ''] = lines(item);
          const code = first.match(/([A-Z]{2,4})\s*(\d{3,4})/);
          if (!code) throw new PortalParseError(`${dayName}: no course code in "${first}"`);
          const from = col - 1;
          const to = col + span - 2;
          if (from < 1 || to > 16) throw new PortalParseError(`${dayName}: session outside periods 1-16`);
          entries.push({ day, from, to, courseCode: code[1] + code[2], type: parseType(type), lecturer });
        }
      }
      covered += span;
      col += span;
    }
    if (covered !== COLUMNS) throw new PortalParseError(`${dayName} row has ${covered - 2} columns, expected 16`);
    carried = next;
  }
  return entries;
}
