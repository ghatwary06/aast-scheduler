const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

$('open').addEventListener('click', () => {
  void chrome.tabs.create({ url: chrome.runtime.getURL('app/app.html') });
  window.close();
});

type Status = { state: string; message: string; warnings?: string[] };
function show(s: Status | undefined) {
  const el = $('status');
  el.className = s?.state ?? '';
  el.textContent = s ? s.message + (s.warnings?.length ? `\n⚠ ${s.warnings.length} warning(s): shown in the planner.` : '') : '';
}
chrome.storage.onChanged.addListener((changes) => {
  if (changes.readerStatus) show(changes.readerStatus.newValue as Status);
});

void chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
  const onRegister = /^https:\/\/alexreg\.aast\.edu\/aastreg\/frm_register\.aspx/i.test(tab?.url ?? '');
  const read = $<HTMLButtonElement>('read');
  read.hidden = !onRegister;
  $('portal').textContent = onRegister
    ? 'On the "Change Registered Courses" page? Read every group, open and full. Nothing is clicked, and Confirm Registration can never be sent. Don\'t touch the tab for about a minute.'
    : 'Go to the registration page and press "Change Registered Courses" to read live data. This extension never changes your registration.';
  read.addEventListener('click', async () => {
    if (!tab?.id) return;
    read.disabled = true;
    show({ state: 'running', message: 'Starting…' });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', files: ['content/blocker.js'] });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/reader.js'] });
  });
});
