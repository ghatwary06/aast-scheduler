// @vitest-environment jsdom
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  checkActivation, controlInfo, guardedActivate, installSubmitBlocker, pageOf, postbackTarget, SafetyError,
} from '../../src/portal/safety';
import { loadFixture } from './load';

const BASE = 'https://alexreg.aast.edu/aastreg/';

function decisions(fixture: string, url: string) {
  const doc = loadFixture(fixture);
  return Array.from(doc.querySelectorAll('a')).map((a) => ({ c: controlInfo(a), d: checkActivation(pageOf(url), controlInfo(a)) }));
}

describe('pageOf / postbackTarget', () => {
  test('recognises portal pages', () => {
    expect(pageOf(`${BASE}frm_Register.aspx`)).toBe('register');
    expect(pageOf(`${BASE}frm_CourseClassReg.aspx?pg=3`)).toBe('groupList');
    expect(pageOf(`${BASE}frm_Menu.aspx`)).toBe('other');
  });
  test('extracts postback targets', () => {
    expect(postbackTarget("javascript:__doPostBack('ctl00$ContentPlaceHolder1$lbtn_changeReg','')")).toBe('ctl00$ContentPlaceHolder1$lbtn_changeReg');
    expect(postbackTarget('frm_CourseClassReg.aspx?pg=2')).toBeNull();
  });
});

describe('checkActivation on the real saved pages', () => {
  test('registered view: only "Change Registered Courses" is allowed', () => {
    const ds = decisions('register-registered.html', `${BASE}frm_Register.aspx`);
    expect(ds.filter((x) => x.d.allowed).map((x) => x.c.text)).toEqual(['Change Registered Courses']);
    for (const text of ['Delete Registration', 'Logout', 'Home', 'Print Schedule', 'Print Guidance Card']) {
      expect(ds.find((x) => x.c.text === text)?.d.allowed, text).toBe(false);
    }
  });

  test('? pages: page links and Back are allowed; Select and Home are not', () => {
    for (const f of ['group-page-1.html', 'group-page-2.html']) {
      const ds = decisions(f, `${BASE}frm_CourseClassReg.aspx?pg=1`);
      const allowed = ds.filter((x) => x.d.allowed).map((x) => x.c.text);
      expect(allowed).toEqual(['Back', ...Array.from({ length: 16 }, (_, i) => String(i + 1))]);
      expect(ds.find((x) => x.c.text === 'Select')?.d.allowed).toBe(false);
      expect(ds.find((x) => x.c.text === 'Home')?.d.allowed).toBe(false);
    }
  });

  test('menu page: nothing is allowed', () => {
    expect(decisions('menu-registration-unavailable.html', `${BASE}frm_Menu.aspx`).some((x) => x.d.allowed)).toBe(false);
  });

  test('"Back" id on the registered view is Logout there, so it is refused', () => {
    const logout = { id: 'ctl00_ContentPlaceHolder1_LinkButton2', text: 'Logout', href: "javascript:__doPostBack('ctl00$ContentPlaceHolder1$LinkButton2','')" };
    expect(checkActivation('register', logout).allowed).toBe(false);
    expect(checkActivation('groupList', { ...logout, text: 'Back' }).allowed).toBe(true);
  });
});

describe('denylist beats allowlist', () => {
  const change = { id: 'ctl00_ContentPlaceHolder1_lbtn_changeReg', href: "javascript:__doPostBack('ctl00$ContentPlaceHolder1$lbtn_changeReg','')" };
  test.each(['Confirm Registration', 'Select', 'Delete Registration', 'Add', 'Insert Term Courses', 'Logout', 'Save', 'Submit'])(
    'an allowlisted id labelled "%s" is refused',
    (text) => {
      const d = checkActivation('register', { ...change, text });
      expect(d.allowed).toBe(false);
    },
  );
  test('denylisted ids and postback targets are refused whatever the label', () => {
    expect(checkActivation('register', { id: 'ctl00_x_btn_Confirm', text: 'OK', href: '' }).allowed).toBe(false);
    expect(checkActivation('groupList', { id: 'a', text: 'Back', href: "javascript:__doPostBack('ctl00$x$btn_select_cls','')" }).allowed).toBe(false);
  });
});

describe('guardedActivate', () => {
  test('never calls activate for a refused control, and throws SafetyError', () => {
    const doc = loadFixture('register-registered.html');
    const del = doc.getElementById('ctl00_ContentPlaceHolder1_lbtn_cancelReg')!;
    const activate = vi.fn();
    expect(() => guardedActivate(del, `${BASE}frm_Register.aspx`, activate)).toThrow(SafetyError);
    expect(activate).not.toHaveBeenCalled();
  });
  test('calls activate for an allowed control', () => {
    const doc = loadFixture('register-registered.html');
    const change = doc.getElementById('ctl00_ContentPlaceHolder1_lbtn_changeReg')!;
    const activate = vi.fn();
    guardedActivate(change, `${BASE}frm_Register.aspx`, activate);
    expect(activate).toHaveBeenCalledWith(change);
  });
});

describe('installSubmitBlocker', () => {
  type W = Window & { __doPostBack?: (t: string, a: string) => void };
  const realSubmit = HTMLFormElement.prototype.submit;
  afterEach(() => {
    HTMLFormElement.prototype.submit = realSubmit;
    delete (window as W).__doPostBack;
    document.body.innerHTML = '';
  });

  function setup() {
    document.body.innerHTML = '<form id="aspnetForm"><input type="hidden" name="__EVENTTARGET" value=""></form>';
    const form = document.getElementById('aspnetForm') as HTMLFormElement;
    const submitted = vi.fn();
    HTMLFormElement.prototype.submit = submitted;
    // ASP.NET's own __doPostBack: set the target, then form.submit()
    (window as W).__doPostBack = (t: string) => {
      (form.elements.namedItem('__EVENTTARGET') as HTMLInputElement).value = t;
      form.submit();
    };
    return { form, submitted };
  }

  test.each([
    'ctl00$ContentPlaceHolder1$lbtn_cancelReg',
    'ctl00$ContentPlaceHolder1$DL_CrsTimeTbl$ctl01$btn_select_cls',
    'ctl00$ContentPlaceHolder1$btn_Confirm',
    'ctl00$ContentPlaceHolder1$LinkButton2',
  ])('blocks postback %s on the registered view', (target) => {
    const { submitted } = setup();
    const uninstall = installSubmitBlocker(window, 'register');
    expect(() => (window as W).__doPostBack!(target, '')).toThrow(SafetyError);
    expect(submitted).not.toHaveBeenCalled();
    uninstall();
  });

  test('blocks a direct form.submit() and a submit event with a non-allowlisted target', () => {
    const { form, submitted } = setup();
    const uninstall = installSubmitBlocker(window, 'register');
    expect(() => form.submit()).toThrow(SafetyError);
    const ev = new Event('submit', { cancelable: true, bubbles: true });
    form.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(submitted).not.toHaveBeenCalled();
    uninstall();
  });

  test('lets the allowlisted postback through, and uninstall restores everything', () => {
    const { submitted } = setup();
    const original = (window as W).__doPostBack;
    const uninstall = installSubmitBlocker(window, 'register');
    (window as W).__doPostBack!('ctl00$ContentPlaceHolder1$lbtn_changeReg', '');
    expect(submitted).toHaveBeenCalledTimes(1);
    uninstall();
    expect((window as W).__doPostBack).toBe(original);
    expect(HTMLFormElement.prototype.submit).toBe(submitted);
  });

  test('Back is allowed only on ? pages', () => {
    const { submitted } = setup();
    const uninstall = installSubmitBlocker(window, 'groupList');
    (window as W).__doPostBack!('ctl00$ContentPlaceHolder1$LinkButton2', '');
    expect(submitted).toHaveBeenCalledTimes(1);
    uninstall();
  });
});

describe('layer 4: no code can write to a dropdown', () => {
  test('src/ never assigns .value / .selected / selectedIndex or fires change events', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.ts')) files.push(readFileSync(p, 'utf8'));
      }
    };
    walk(join(process.cwd(), 'src', 'core'));
    walk(join(process.cwd(), 'src', 'portal'));
    walk(join(process.cwd(), 'src', 'content'));
    expect(files.length).toBeGreaterThan(5);
    for (const src of files) {
      expect(src).not.toMatch(/\.value\s*=[^=]/);
      expect(src).not.toMatch(/\.selected\s*=[^=]/);
      expect(src).not.toMatch(/selectedIndex\s*=[^=]/);
      expect(src).not.toMatch(/new\s+Event\(\s*['"](change|input)['"]/);
    }
  });
});
