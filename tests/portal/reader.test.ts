// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { validateDataset } from '../../src/core/dataset';
import { parseChangeView, type ChangeCourse } from '../../src/portal/changeView';
import { readPortal, type FetchText } from '../../src/portal/reader';
import { DETAILS_BUTTON } from '../../src/portal/requests';
import { loadFixture } from './load';

const PAGE = 'https://alexreg.aast.edu/aastreg/frm_Register.aspx';
const TEMPLATE = readFileSync(join(process.cwd(), 'tests/fixtures/portal/group-page-1.html'), 'utf8');

/** A fake portal: the ? POST selects a course; ?pg=N serves one group page per open group, plus the current group if full, plus a full "Z". */
function fakePortal(courses: ChangeCourse[], opts: { wrongCourse?: boolean; loggedOut?: boolean } = {}) {
  const groupsFor = new Map(
    courses.map((c) => [
      c.code,
      [
        ...c.options.map((o) => ({ group: o.group, cls: o.classLetter })),
        ...(c.options.some((o) => o.group === c.current) ? [] : [{ group: c.current, cls: c.currentClass }]),
        { group: 'Z', cls: 'Z' },
      ],
    ]),
  );
  const requests: { method: string; url: string; body?: string }[] = [];
  let selected = '';
  const fetchText: FetchText = async (url, init) => {
    requests.push({ method: init.method, url, body: init.body });
    if (opts.loggedOut) return { ok: true, status: 200, url: 'https://alexreg.aast.edu/aastreg/frm_login.aspx', text: '' };
    if (init.method === 'POST') {
      const pressed = [...new URLSearchParams(init.body).keys()].find((k) => k.endsWith('.x'))!.slice(0, -2);
      selected = courses.find((c) => c.detailsButton === pressed)!.code;
      return { ok: true, status: 200, url: 'https://alexreg.aast.edu/aastreg/frm_CourseClassReg.aspx?pg=1', text: '' };
    }
    const pg = Number(new URL(url).searchParams.get('pg'));
    const gs = groupsFor.get(selected)!;
    const g = gs[pg - 1];
    const code = opts.wrongCourse ? 'XXX9999' : selected;
    const html = TEMPLATE.replaceAll('EBA2204', code)
      .replace('action="frm_CourseClassReg.aspx?pg=1"', `action="frm_CourseClassReg.aspx?pg=${pg}"`)
      .replace(/(_lbl_grp">)[^<]*/, `$1T3 Class ${g.group} `)
      .replace(/(_lbl_class">)[^<]*/, `$1${g.cls} `)
      .replace(/<a href="frm_CourseClassReg\.aspx\?pg=(\d+)">\d+<\/a>/g, (m, n) => (Number(n) <= gs.length ? m : ''));
    return { ok: true, status: 200, url, text: html };
  };
  return { fetchText, requests, groupsFor };
}

describe('readPortal', () => {
  const doc = loadFixture('register-change.html');
  const courses = parseChangeView(doc);

  test('reads every course into a valid dataset with open/full groups and current groups', async () => {
    const portal = fakePortal(courses);
    const progress: string[] = [];
    const { dataset, warnings } = await readPortal(doc, PAGE, portal.fetchText, { delayMs: 0, onProgress: (m) => progress.push(m) });
    expect(validateDataset(dataset).ok).toBe(true);
    expect(dataset.source).toBe('portal');
    expect(dataset.term).toBe('First Semester 2026/2027');
    expect(dataset.courses.map((c) => [c.code, c.current])).toEqual(courses.map((c) => [c.code, c.current]));
    for (const c of dataset.courses) {
      expect(c.groups).toHaveLength(portal.groupsFor.get(c.code)!.length);
      expect(c.groups.find((g) => g.id === 'Z')!.open).toBe(false);
    }
    const dld = dataset.courses.find((c) => c.code === 'CCS2102')!;
    expect(dld.groups.find((g) => g.id === 'F')!.open).toBe(false); // the current group is full
    expect(dld.groups.find((g) => g.id === 'E')).toMatchObject({ open: true, portalLabel: 'T3 Class E -E -Alexandria' });
    expect(warnings).toEqual([]);
    expect(progress.length).toBeGreaterThan(6);
  });

  test('sends only ? POSTs and group-page GETs, never anything else', async () => {
    const portal = fakePortal(courses);
    await readPortal(doc, PAGE, portal.fetchText, { delayMs: 0 });
    const posts = portal.requests.filter((r) => r.method === 'POST');
    expect(posts).toHaveLength(6);
    for (const r of posts) {
      const p = new URLSearchParams(r.body);
      expect(p.get('__EVENTTARGET')).toBe('');
      const pressed = [...new Set([...p.keys()].filter((k) => /\.(x|y)$/.test(k)).map((k) => k.slice(0, -2)))];
      expect(pressed).toHaveLength(1);
      expect(pressed[0]).toMatch(DETAILS_BUTTON);
      expect(r.body).not.toMatch(/confirm|btn_delete|cancelReg/i);
    }
    const gets = portal.requests.filter((r) => r.method === 'GET');
    expect(gets.every((r) => /frm_CourseClassReg\.aspx\?pg=\d+$/.test(r.url))).toBe(true);
    expect(gets).toHaveLength([...portal.groupsFor.values()].reduce((n, g) => n + g.length, 0));
  });

  test('refuses to start on the plain registered view, without sending anything', async () => {
    const portal = fakePortal(courses);
    await expect(readPortal(loadFixture('register-registered.html'), PAGE, portal.fetchText, { delayMs: 0 })).rejects.toThrow(/Change Registered Courses/);
    expect(portal.requests).toHaveLength(0);
  });

  test('stops if the portal shows a different course than asked', async () => {
    const portal = fakePortal(courses, { wrongCourse: true });
    await expect(readPortal(doc, PAGE, portal.fetchText, { delayMs: 0 })).rejects.toThrow(/stopped to be safe/);
    expect(portal.requests.filter((r) => r.method === 'POST')).toHaveLength(1);
  });

  test('stops when logged out', async () => {
    const portal = fakePortal(courses, { loggedOut: true });
    await expect(readPortal(doc, PAGE, portal.fetchText, { delayMs: 0 })).rejects.toThrow(/logged out/);
  });

  test('refuses to run on any page other than the registration page', async () => {
    const portal = fakePortal(courses);
    await expect(readPortal(doc, 'https://alexreg.aast.edu/aastreg/frm_Menu.aspx', portal.fetchText, { delayMs: 0 })).rejects.toThrow(/registration page/);
    expect(portal.requests).toHaveLength(0);
  });
});
