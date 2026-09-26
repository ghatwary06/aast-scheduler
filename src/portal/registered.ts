import { clean, parseScheduleTable, PortalParseError, type GridEntry } from './grid';

export interface RegisteredCourse {
  code: string;
  name: string;
  group: string;
  classLetter: string;
}

export function groupIdFromLabel(label: string): string {
  const m = clean(label).match(/^(?:T\d+\s+)?(?:Class\s+)?(.*)$/);
  if (!m || !m[1]) throw new PortalParseError(`unrecognised group label "${label}"`);
  return m[1];
}

export function parseRegisteredView(doc: Document): { courses: RegisteredCourse[]; entries: GridEntry[] } {
  const table = doc.getElementById('ctl00_ContentPlaceHolder1_grdvw_courses') as HTMLTableElement | null;
  if (!table) throw new PortalParseError('registered courses table not found');
  const courses = Array.from(table.rows)
    .slice(1)
    .map((row) => {
      const cells = row.cells;
      if (cells.length < 7) throw new PortalParseError(`course row has ${cells.length} cells, expected 7`);
      const code = clean(cells[0].querySelector('span[id$="_Label1"]')?.textContent);
      const classLetter = clean(cells[6].querySelector('span[id$="_txt_cls"]')?.textContent);
      if (!code || !classLetter) throw new PortalParseError('course row is missing its code or class');
      return { code, name: clean(cells[1].textContent), group: groupIdFromLabel(cells[5].textContent ?? ''), classLetter };
    });
  const entries = parseScheduleTable(doc.querySelector('#ctl00_ContentPlaceHolder1_Schedule1 table'));
  return { courses, entries };
}
