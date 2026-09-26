import { clean, PortalParseError } from './grid';
import { groupIdFromLabel } from './registered';

export interface DropdownOption {
  value: string;
  label: string;
  group: string;
  classLetter: string;
}

export interface ChangeCourse {
  /** grid row id, e.g. ctl02 */
  row: string;
  code: string;
  name: string;
  /** current group id, from the course table's Group column (the dropdown can't be trusted for this) */
  current: string;
  currentClass: string;
  /** open groups: the Class dropdown's options, minus "Any" */
  options: DropdownOption[];
  /** name of this row's ? image button */
  detailsButton: string;
}

/** "T3 Class B -L -Alexandria" -> { group: "B", classLetter: "L" } */
export function parseDropdownLabel(label: string): { group: string; classLetter: string } {
  const m = clean(label).match(/^(.*?)\s*-\s*(\S+)\s*-\s*(\S.*)$/);
  if (!m) throw new PortalParseError(`unrecognised class option "${label}"`);
  return { group: groupIdFromLabel(m[1]), classLetter: m[2] };
}

export function parseChangeView(doc: Document): ChangeCourse[] {
  const table = doc.getElementById('ctl00_ContentPlaceHolder1_grdvw_courses') as HTMLTableElement | null;
  if (!table) throw new PortalParseError('registered courses table not found');
  const rows = Array.from(table.rows).slice(1);
  if (!rows.some((r) => r.querySelector('select[id$="_drp_cls"]'))) {
    throw new PortalParseError('This is not the change page. Press "Change Registered Courses" yourself, then read again.');
  }
  return rows.map((row) => {
    const cells = row.cells;
    const code = clean(cells[0]?.querySelector('span[id$="_Label1"]')?.textContent);
    const select = row.querySelector('select[id$="_drp_cls"]') as HTMLSelectElement | null;
    const button = row.querySelector('input[type="image"][name$="$btn_grp_time_table_details"]') as HTMLInputElement | null;
    if (!code || !select || !button) throw new PortalParseError(`course row ${code || '?'} is missing its dropdown or ? button`);
    const options = Array.from(select.options)
      .filter((o) => !['', '-99'].includes(clean(o.value)))
      .map((o) => ({ value: clean(o.value), label: clean(o.textContent), ...parseDropdownLabel(o.textContent ?? '') }));
    return {
      row: button.name.match(/\$(ctl\d+)\$/)?.[1] ?? '',
      code,
      name: clean(cells[1]?.textContent),
      current: groupIdFromLabel(cells[5]?.textContent ?? ''),
      currentClass: clean(row.querySelector('span[id$="_txt_cls"]')?.textContent),
      options,
      detailsButton: button.name,
    };
  });
}
