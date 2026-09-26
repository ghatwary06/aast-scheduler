import { validateDataset } from '../core/dataset';
import type { Course, Dataset, Group } from '../core/types';
import { parseChangeView } from './changeView';
import { clean, PortalParseError } from './grid';
import { parseGroupPage, toSession, type GroupPageItem } from './groupPage';
import { buildDetailsRequest, checkPortalRequest, type PortalRequest } from './requests';
import { pageOf } from './safety';

export interface HttpText {
  ok: boolean;
  status: number;
  url: string;
  text: string;
}

export type FetchText = (
  url: string,
  init: { method: 'GET' | 'POST'; headers?: Record<string, string>; body?: string; credentials: 'include'; redirect: 'follow' },
) => Promise<HttpText>;

export interface ReadResult {
  dataset: Dataset;
  warnings: string[];
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const key = (group: string, cls: string) => `${norm(group)}|${norm(cls)}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function readPortal(
  doc: Document,
  pageUrl: string,
  fetchText: FetchText,
  opts: { delayMs?: number; onProgress?: (msg: string) => void; parse?: (html: string) => Document } = {},
): Promise<ReadResult> {
  const delayMs = opts.delayMs ?? 350;
  const progress = opts.onProgress ?? (() => {});
  const parse = opts.parse ?? ((html: string) => new DOMParser().parseFromString(html, 'text/html'));

  if (pageOf(pageUrl) !== 'register') throw new PortalParseError('Open the registration page (Change Registered Courses) first.');
  const courses = parseChangeView(doc);
  const form = doc.getElementById('aspnetForm') as HTMLFormElement | null;
  if (!form) throw new PortalParseError('registration form not found');

  const send = async (req: PortalRequest): Promise<string> => {
    checkPortalRequest(req);
    const res = await fetchText(req.url, {
      method: req.method,
      headers: req.body !== undefined ? { 'Content-Type': 'application/x-www-form-urlencoded' } : undefined,
      body: req.body,
      credentials: 'include',
      redirect: 'follow',
    });
    if (/frm_login\.aspx/i.test(res.url)) throw new PortalParseError('You were logged out. Log in again and re-run.');
    if (!res.ok) throw new PortalParseError(`the portal answered HTTP ${res.status} for ${req.method} ${new URL(req.url).pathname}`);
    return res.text;
  };

  const warnings: string[] = [];
  const out: Course[] = [];
  for (const course of courses) {
    progress(`${course.name}: opening its group list`);
    await send(buildDetailsRequest(form, course.detailsButton, pageUrl));

    const items: GroupPageItem[] = [];
    let pageCount = 1;
    for (let pg = 1; pg <= pageCount; pg++) {
      await sleep(delayMs);
      const page = parseGroupPage(parse(await send({ method: 'GET', url: new URL(`frm_CourseClassReg.aspx?pg=${pg}`, pageUrl).href })));
      if (page.courseCode !== course.code) {
        throw new PortalParseError(`asked for ${course.code} but the portal showed ${page.courseCode}, so I stopped to be safe`);
      }
      pageCount = page.pageCount;
      items.push(...page.items);
      progress(`${course.name}: group ${pg} of ${pageCount}`);
    }

    const open = new Map(course.options.map((o) => [key(o.group, o.classLetter), o]));
    const used = new Set<string>();
    const groups: Group[] = [];
    let current: string | null = null;
    for (const it of items) {
      if (it.entries.length === 0) {
        warnings.push(`${course.name} ${it.group}: its ? page has no timetable, skipped`);
        continue;
      }
      const id = groups.some((g) => g.id === it.group) ? `${it.group} (${it.classLetter})` : it.group;
      const k = key(it.group, it.classLetter);
      const opt = open.get(k);
      if (opt) used.add(k);
      if (norm(it.group) === norm(course.current) && norm(it.classLetter) === norm(course.currentClass)) current = id;
      groups.push({ id, portalLabel: opt?.label ?? '', pageLabel: `${it.label} - ${it.classLetter}`, open: Boolean(opt), sessions: it.entries.map(toSession) });
    }
    for (const o of course.options) if (!used.has(key(o.group, o.classLetter))) warnings.push(`${course.name}: dropdown option "${o.label}" has no ? page`);
    if (current === null) warnings.push(`${course.name}: your current group ${course.current} was not found on its ? pages`);
    out.push({ code: course.code, name: course.name, current, groups });
  }

  const term = clean(doc.getElementById('ctl00_UC_Student1_lbl_semester')?.textContent).replace(/^for the\s+/i, '') || 'Unknown term';
  const dataset: Dataset = { schemaVersion: 1, source: 'portal', fetchedAt: new Date().toISOString(), term, courses: out };
  const v = validateDataset(dataset);
  if (!v.ok) throw new PortalParseError(`the data read from the portal failed validation: ${v.errors.slice(0, 3).join('; ')}`);
  progress('Done');
  return { dataset, warnings };
}
