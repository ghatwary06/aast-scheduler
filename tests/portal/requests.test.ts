// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { parseChangeView } from '../../src/portal/changeView';
import { buildDetailsRequest, checkPortalRequest, type PortalRequest } from '../../src/portal/requests';
import { SafetyError } from '../../src/portal/safety';
import { loadFixture } from './load';

const PAGE = 'https://alexreg.aast.edu/aastreg/frm_Register.aspx';
const doc = loadFixture('register-change.html');
const form = doc.getElementById('aspnetForm') as HTMLFormElement;
const courses = parseChangeView(doc);
const details = courses[0].detailsButton;
const post = (body: Record<string, string>): PortalRequest => ({ method: 'POST', url: PAGE, body: new URLSearchParams(body).toString() });

describe('buildDetailsRequest', () => {
  test('builds exactly what clicking a ? icon sends, for every course', () => {
    for (const c of courses) {
      const req = buildDetailsRequest(form, c.detailsButton, PAGE);
      const p = new URLSearchParams(req.body);
      expect(req.method).toBe('POST');
      expect(req.url).toBe(PAGE);
      expect(p.get(`${c.detailsButton}.x`)).toBe('0');
      expect(p.get(`${c.detailsButton}.y`)).toBe('0');
      expect(p.get('__EVENTTARGET')).toBe('');
      expect([...p.keys()].filter((k) => /\.(x|y)$/.test(k))).toHaveLength(2);
      expect(p.has('ctl00$ContentPlaceHolder1$grdvw_courses$ctl02$drp_cls')).toBe(true); // the form's own fields travel as-is
    }
  });

  test.each([
    'ctl00$ContentPlaceHolder1$grdvw_courses$ctl02$btn_delete',
    'ctl00$ContentPlaceHolder1$lbtn_confirm',
    'ctl00$ContentPlaceHolder1$lbtn_add',
    'ctl00$ContentPlaceHolder1$lbtn_grpdetails',
  ])('refuses to build a request for %s', (name) => {
    expect(() => buildDetailsRequest(form, name, PAGE)).toThrow(SafetyError);
  });
});

describe('checkPortalRequest', () => {
  test('allows group-page GETs and a single ? POST', () => {
    expect(() => checkPortalRequest({ method: 'GET', url: 'https://alexreg.aast.edu/aastreg/frm_CourseClassReg.aspx?pg=3' })).not.toThrow();
    expect(() => checkPortalRequest(post({ __EVENTTARGET: '', [`${details}.x`]: '0', [`${details}.y`]: '0' }))).not.toThrow();
  });

  test.each<[string, PortalRequest]>([
    ['Confirm as event target', post({ __EVENTTARGET: 'ctl00$ContentPlaceHolder1$lbtn_confirm', [`${details}.x`]: '0' })],
    ['Delete Registration as event target', post({ __EVENTTARGET: 'ctl00$ContentPlaceHolder1$lbtn_cancelReg' })],
    ['a dropdown postback', post({ __EVENTTARGET: 'ctl00$ContentPlaceHolder1$grdvw_courses$ctl02$drp_cls' })],
    ['the delete icon', post({ 'ctl00$ContentPlaceHolder1$grdvw_courses$ctl02$btn_delete.x': '0' })],
    ['two buttons at once', post({ [`${details}.x`]: '0', 'ctl00$ContentPlaceHolder1$grdvw_courses$ctl03$btn_delete.x': '0' })],
    ['no button at all', post({ __EVENTTARGET: '' })],
    ['a POST to the group pages', { method: 'POST', url: 'https://alexreg.aast.edu/aastreg/frm_CourseClassReg.aspx?pg=1', body: '' }],
    ['a GET of the registration page', { method: 'GET', url: PAGE }],
    ['another site', { method: 'GET', url: 'https://example.com/frm_CourseClassReg.aspx?pg=1' }],
    ['a strange page query', { method: 'GET', url: 'https://alexreg.aast.edu/aastreg/frm_CourseClassReg.aspx?pg=1&x=confirm' }],
  ])('refuses %s', (_, req) => {
    expect(() => checkPortalRequest(req)).toThrow(SafetyError);
  });
});
