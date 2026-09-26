import type { Session } from '../core/types';
import { clean, parseScheduleTable, PortalParseError, type GridEntry } from './grid';
import { groupIdFromLabel } from './registered';

export interface GroupPageItem {
  group: string;
  label: string;
  classLetter: string;
  lecturers: string;
  entries: GridEntry[];
}

export interface GroupPage {
  courseCode: string;
  courseName: string;
  page: number;
  pageCount: number;
  items: GroupPageItem[];
  /** groups on this page whose timetable couldn't be read; left out, with the reason */
  skipped: { label: string; classLetter: string; reason: string }[];
}

const PAGE_LINK = /frm_CourseClassReg\.aspx\?pg=(\d+)$/i;

export function toSession(e: GridEntry): Session {
  return { day: e.day, from: e.from, to: e.to, type: e.type, lecturer: e.lecturer };
}

export function parseGroupPage(doc: Document): GroupPage {
  const courseCode = clean(doc.getElementById('ctl00_ContentPlaceHolder1_lbl_crs_code')?.textContent);
  const courseName = clean(doc.getElementById('ctl00_ContentPlaceHolder1_lbl_CrsName')?.textContent);
  if (!courseCode) throw new PortalParseError('not a group page: course code not found');

  const action = doc.querySelector('form#aspnetForm')?.getAttribute('action') ?? '';
  const page = Number(action.match(PAGE_LINK)?.[1] ?? NaN);
  if (!Number.isInteger(page)) throw new PortalParseError(`cannot read page number from "${action}"`);
  const linked = Array.from(doc.querySelectorAll('a[href]'))
    .map((a) => Number(a.getAttribute('href')!.match(PAGE_LINK)?.[1] ?? NaN))
    .filter(Number.isInteger);
  const pageCount = Math.max(page, ...linked);

  const items: GroupPageItem[] = [];
  const skipped: GroupPage['skipped'] = [];
  for (const grp of Array.from(doc.querySelectorAll('span[id$="_lbl_grp"]'))) {
    const prefix = grp.id.slice(0, -'_lbl_grp'.length);
    const label = clean(grp.textContent);
    const classLetter = clean(doc.getElementById(`${prefix}_lbl_class`)?.textContent);
    try {
      const entries = parseScheduleTable(doc.querySelector(`[id="${prefix}_Schedule1"] table`));
      for (const e of entries) {
        if (e.courseCode !== courseCode) throw new PortalParseError(`its timetable lists ${e.courseCode}, not ${courseCode}`);
      }
      items.push({ group: groupIdFromLabel(label), label, classLetter, lecturers: clean(doc.getElementById(`${prefix}_lbl_lecturer`)?.textContent), entries });
    } catch (e) {
      if (!(e instanceof PortalParseError)) throw e;
      skipped.push({ label, classLetter, reason: e.message });
    }
  }
  if (items.length === 0 && skipped.length === 0) throw new PortalParseError('group page has no groups');
  return { courseCode, courseName, page, pageCount, items, skipped };
}
