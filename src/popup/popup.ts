const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

$('open').addEventListener('click', () => {
  void chrome.tabs.create({ url: chrome.runtime.getURL('app/app.html') });
  window.close();
});

type Status = { state: string; message: string; warnings?: string[]; at?: number };
/** A read that hasn't reported progress for this long is treated as dead (tab closed, page reloaded). */
const STALE_MS = 60_000;
const isRunning = (s?: Status) => s?.state === 'running' && Date.now() - (s.at ?? 0) < STALE_MS;

function show(s: Status | undefined) {
  const el = $('status');
  el.className = s?.state ?? '';
  el.textContent = s ? s.message + (s.warnings?.length ? `\n⚠ ${s.warnings.length} warning(s): shown in the planner.` : '') : '';
  $<HTMLButtonElement>('read').disabled = isRunning(s);
}
chrome.storage.onChanged.addListener((changes) => {
  if (changes.readerStatus) show(changes.readerStatus.newValue as Status);
});

void chrome.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
  const onRegister = /^https:\/\/alexreg\.aast\.edu\/aastreg\/frm_register\.aspx/i.test(tab?.url ?? '');
  const read = $<HTMLButtonElement>('read');
  read.hidden = !onRegister;
  $('portal').textContent = onRegister
    ? 'On the "Change Registered Courses" page? Read every group, open and full. Nothing is clicked, and Confirm Registration can never be sent. Don\'t touch the tab for about a minute.'
    : 'Go to the registration page and press "Change Registered Courses" to read live data. This extension never changes your registration.';
  const { readerStatus } = await chrome.storage.local.get('readerStatus');
  show(readerStatus as Status | undefined);

  read.addEventListener('click', async () => {
    if (!tab?.id) return;
    const { readerStatus: now } = await chrome.storage.local.get('readerStatus');
    if (isRunning(now as Status | undefined)) return; // a read is already going in some tab
    const target = { tabId: tab.id };
    read.disabled = true;
    show({ state: 'running', message: 'Starting…', at: Date.now() });
    try {
      await chrome.scripting.executeScript({ target, world: 'MAIN', files: ['content/blocker.js'] });
    } catch (e) {
      return show({ state: 'error', message: `Couldn't start: ${e instanceof Error ? e.message : String(e)}` });
    }
    try {
      await chrome.scripting.executeScript({ target, files: ['content/reader.js'] });
    } catch (e) {
      // The blocker is already in the page; take it out again so the portal isn't left unusable.
      await chrome.scripting
        .executeScript({ target, world: 'MAIN', func: () => void document.dispatchEvent(new CustomEvent('aast-reader-finished')) })
        .catch(() => undefined);
      show({ state: 'error', message: `Couldn't start the reader: ${e instanceof Error ? e.message : String(e)}` });
    }
  });
});
