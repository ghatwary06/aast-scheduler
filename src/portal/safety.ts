import { clean } from './grid';

/**
 * Spec §2: the extension must never activate anything that can change a registration.
 * Layer 1: allowlist (page-aware). Layer 2: denylist, which beats the allowlist.
 * Layer 3: installSubmitBlocker. Layer 4: tests/portal/safety.test.ts scans src/ for dropdown writes.
 */

export type PortalPage = 'register' | 'groupList' | 'other';

export interface ControlInfo {
  id: string;
  text: string;
  href: string;
}

export type Decision = { allowed: true; rule: string } | { allowed: false; reason: string };

export class SafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SafetyError';
  }
}

const DENY_TEXT = /\b(confirm|select|delete|cancel|log ?out|add|insert|remove|drop|save|submit)\b/i;
const DENY_ID = /(confirm|select|delete|cancel|logout|insert|remove|drop|save|submit|btn_?add|add_?btn)/i;

const CHANGE_REG = 'ctl00$ContentPlaceHolder1$lbtn_changeReg';
const BACK = 'ctl00$ContentPlaceHolder1$LinkButton2';

/** Postback targets the blocker lets through, per page. LinkButton2 is Back only on ? pages (it is Logout elsewhere). */
const ALLOWED_POSTBACKS: Record<PortalPage, ReadonlySet<string>> = {
  register: new Set([CHANGE_REG]),
  groupList: new Set([BACK]),
  other: new Set(),
};

interface AllowRule {
  page: PortalPage;
  name: string;
  match: (c: ControlInfo) => boolean;
}

const ALLOW: AllowRule[] = [
  {
    page: 'register',
    name: 'Change Registered Courses',
    match: (c) => c.id === 'ctl00_ContentPlaceHolder1_lbtn_changeReg' && c.text === 'Change Registered Courses' && postbackTarget(c.href) === CHANGE_REG,
  },
  {
    page: 'groupList',
    name: 'group page link',
    match: (c) => /^frm_CourseClassReg\.aspx\?pg=\d+$/.test(c.href) && /^\d+$/.test(c.text),
  },
  {
    page: 'groupList',
    name: 'Back',
    match: (c) => c.id === 'ctl00_ContentPlaceHolder1_LinkButton2' && c.text === 'Back' && postbackTarget(c.href) === BACK,
  },
];

export function pageOf(url: string): PortalPage {
  const path = new URL(url, 'https://alexreg.aast.edu/aastreg/').pathname.toLowerCase();
  if (path.endsWith('/frm_register.aspx')) return 'register';
  if (path.endsWith('/frm_courseclassreg.aspx')) return 'groupList';
  return 'other';
}

export function postbackTarget(href: string): string | null {
  return href.match(/__doPostBack\(\s*'([^']*)'/)?.[1] ?? null;
}

export function controlInfo(el: Element): ControlInfo {
  return { id: el.id, text: clean(el.textContent), href: el.getAttribute('href') ?? '' };
}

function denied(text: string, id: string, target: string): boolean {
  return DENY_TEXT.test(text) || DENY_ID.test(id) || DENY_ID.test(target);
}

export function checkActivation(page: PortalPage, c: ControlInfo): Decision {
  if (denied(c.text, c.id, postbackTarget(c.href) ?? '')) {
    return { allowed: false, reason: `refused: "${c.text || c.id}" can change a registration` };
  }
  const rule = ALLOW.find((r) => r.page === page && r.match(c));
  return rule ? { allowed: true, rule: rule.name } : { allowed: false, reason: `refused: "${c.text || c.id}" is not on the ${page} allowlist` };
}

export function guardedActivate(el: Element, pageUrl: string, activate: (el: Element) => void): void {
  const d = checkActivation(pageOf(pageUrl), controlInfo(el));
  if (!d.allowed) throw new SafetyError(d.reason);
  activate(el);
}

type PostBackWindow = Window & { __doPostBack?: (target: string, arg: string) => void; HTMLFormElement: typeof HTMLFormElement };

/**
 * While a read runs, refuse every form submission and postback except the page's allowlisted
 * targets. Must run in the page's own JS world (MAIN) to wrap __doPostBack. Returns an uninstaller.
 */
export function installSubmitBlocker(win: Window, page: PortalPage): () => void {
  const w = win as PostBackWindow;
  const allowed = ALLOWED_POSTBACKS[page];
  const proto = w.HTMLFormElement.prototype;
  const origSubmit = proto.submit;
  const origRequestSubmit = proto.requestSubmit;
  const origPostBack = w.__doPostBack;

  const check = (target: string) => {
    if (!allowed.has(target) || denied('', '', target)) throw new SafetyError(`blocked submission (target "${target || 'none'}")`);
  };
  const targetOf = (form: HTMLFormElement) => (form.elements.namedItem('__EVENTTARGET') as HTMLInputElement | null)?.value ?? '';

  proto.submit = function (this: HTMLFormElement) {
    check(targetOf(this));
    return origSubmit.call(this);
  };
  proto.requestSubmit = function (this: HTMLFormElement, submitter?: HTMLElement | null) {
    check(targetOf(this));
    return origRequestSubmit.call(this, submitter);
  };
  const onSubmit = (e: Event) => {
    try {
      check(targetOf(e.target as HTMLFormElement));
    } catch {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  };
  w.document.addEventListener('submit', onSubmit, true);
  if (origPostBack) {
    w.__doPostBack = (target: string, arg: string) => {
      check(target);
      return origPostBack(target, arg);
    };
  }

  return () => {
    proto.submit = origSubmit;
    proto.requestSubmit = origRequestSubmit;
    w.document.removeEventListener('submit', onSubmit, true);
    if (origPostBack) w.__doPostBack = origPostBack;
  };
}
