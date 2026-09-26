import { pageOf, SafetyError } from './safety';

/**
 * Spec §2 for the request-based reader. The reader never clicks. It only sends requests, and every
 * request must pass checkPortalRequest: GET of a ?pg=N group page, or one POST that presses a
 * single ? (group details) button with no postback target.
 */

export const DETAILS_BUTTON = /^ctl00\$ContentPlaceHolder1\$grdvw_courses\$ctl\d+\$btn_grp_time_table_details$/;
const DETAILS_TITLE = 'Click To View Course Time Table Details';
const DENY = /(confirm|delete|cancel|logout|insert|remove|drop|save|submit|select_cls|lbtn_add|btn_?add)/i;
const PORTAL_ORIGIN = 'https://alexreg.aast.edu';

export interface PortalRequest {
  method: 'GET' | 'POST';
  url: string;
  body?: string;
}

export function checkPortalRequest(req: PortalRequest): void {
  const url = new URL(req.url);
  if (url.origin !== PORTAL_ORIGIN) throw new SafetyError(`refused: request to ${url.origin}`);
  const page = pageOf(url.href);
  if (req.method === 'GET') {
    if (page === 'groupList' && /^\?pg=\d+$/.test(url.search) && !req.body) return;
    throw new SafetyError(`refused: GET ${url.pathname}${url.search}`);
  }
  if (req.method !== 'POST' || page !== 'register' || req.body === undefined) {
    throw new SafetyError(`refused: ${req.method} ${url.pathname}`);
  }
  const p = new URLSearchParams(req.body);
  if ((p.get('__EVENTTARGET') ?? '') !== '' || (p.get('__EVENTARGUMENT') ?? '') !== '') {
    throw new SafetyError(`refused: request carries a postback target "${p.get('__EVENTTARGET')}"`);
  }
  const pressed = [...new Set([...p.keys()].filter((k) => /\.(x|y)$/.test(k)).map((k) => k.slice(0, -2)))];
  if (pressed.length !== 1 || !DETAILS_BUTTON.test(pressed[0]) || DENY.test(pressed[0])) {
    throw new SafetyError(`refused: request would press ${pressed.join(' + ') || 'no button'}`);
  }
}

export function buildDetailsRequest(form: HTMLFormElement, buttonName: string, pageUrl: string): PortalRequest {
  if (!DETAILS_BUTTON.test(buttonName)) throw new SafetyError(`refused: "${buttonName}" is not a ? (group details) button`);
  // form.elements never lists <input type=image> (HTML spec), so look among the form's image inputs
  const button = Array.from(form.querySelectorAll<HTMLInputElement>('input[type="image"]')).find((el) => el.name === buttonName);
  if (!button || button.type !== 'image' || button.title !== DETAILS_TITLE) {
    throw new SafetyError(`refused: "${buttonName}" is not the ? button it claims to be`);
  }
  const params = new URLSearchParams();
  for (const [k, v] of new FormData(form)) if (typeof v === 'string') params.append(k, v);
  params.set('__EVENTTARGET', '');
  params.set('__EVENTARGUMENT', '');
  params.append(`${buttonName}.x`, '0');
  params.append(`${buttonName}.y`, '0');
  const req: PortalRequest = { method: 'POST', url: new URL(form.getAttribute('action') ?? '', pageUrl).href, body: params.toString() };
  checkPortalRequest(req);
  return req;
}
